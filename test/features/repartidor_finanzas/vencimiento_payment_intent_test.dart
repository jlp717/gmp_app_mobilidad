import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

const _keys = <String, dynamic>{
  'tipoDocumento': 'CAC',
  'origenDocumento': 'B',
  'subempresaDocumento': 'GMP',
  'ejercicioDocumento': 2026,
  'serieDocumento': 'I',
  'terminalDocumento': 10,
  'numeroDocumento': 2730,
  'xdeDocumento': 1,
  'dexDocumento': 1,
};

Future<VencimientoCobroSubmissionResult> _submit(
  RepartidorFinanzasService service,
  String token,
) {
  return service.registerVencimientoCobro(
    repartidorId: '94',
    codigoCliente: '4300001119',
    nombreCliente: 'Cliente',
    tipoDocumento: 'CAC',
    documento: 'E 2026-B-I-010-002730-01',
    keys: _keys,
    importeCobrado: 20,
    importePendiente: 40,
    formaPago: 'TRANSFERENCIA',
    idempotencyToken: token,
  );
}

void main() {
  test('offline reopen blocks another enqueue and reuses queued token',
      () async {
    final pending = <SyncOperation>[];
    var postCount = 0;

    Future<Map<String, dynamic>> offlinePost(
      String endpoint,
      Map<String, dynamic> payload, {
      String? syncType,
      String? cacheKey,
    }) async {
      postCount++;
      final syncId = 'sync-$postCount';
      pending.add(
        SyncOperation(
          id: syncId,
          type: syncType!,
          endpoint: endpoint,
          method: 'POST',
          payload: Map<String, dynamic>.from(payload),
        ),
      );
      return <String, dynamic>{'queued': true, 'syncId': syncId};
    }

    RepartidorFinanzasService service() => RepartidorFinanzasService(
          offlinePost: offlinePost,
          pendingOperations: () => pending,
          enqueueOperation: (operation) async => pending.add(operation),
        );

    const firstToken = 'vto_94_doc_00000000000000000000000000000001';
    const secondToken = 'vto_94_doc_00000000000000000000000000000002';
    final first = await _submit(service(), firstToken);
    final reopened = await _submit(service(), secondToken);

    expect(first.state, VencimientoCobroSubmissionState.queued);
    expect(reopened.state, VencimientoCobroSubmissionState.alreadyPending);
    expect(reopened.idempotencyToken, firstToken);
    expect(pending.single.payload['idempotencyToken'], firstToken);
    expect(postCount, 1);

    pending.clear(); // Successful sync removes the persisted queue entry.
    final nextIntent = await _submit(service(), secondToken);

    expect(nextIntent.state, VencimientoCobroSubmissionState.queued);
    expect(nextIntent.idempotencyToken, secondToken);
    expect(postCount, 2);
  });

  test('double tap submits one request while the first is in flight', () async {
    final response = Completer<Map<String, dynamic>>();
    var postCount = 0;
    final service = RepartidorFinanzasService(
      offlinePost: (
        endpoint,
        payload, {
        syncType,
        cacheKey,
      }) {
        postCount++;
        return response.future;
      },
      pendingOperations: () => const <SyncOperation>[],
      enqueueOperation: (_) async {},
    );
    final token =
        ['vto', '94', 'doc', '00000000000000000000000000000003'].join('_');

    final firstFuture = _submit(service, token);
    final second = await _submit(service, token);
    response.complete(<String, dynamic>{'queued': true, 'syncId': 'sync-1'});
    final first = await firstFuture;

    expect(postCount, 1);
    expect(first.state, VencimientoCobroSubmissionState.queued);
    expect(second.state, VencimientoCobroSubmissionState.inFlight);
  });

  test('HTTP 409 persists manual review and blocks reopen', () async {
    final pending = <SyncOperation>[];
    final token =
        ['vto', '94', 'doc', '00000000000000000000000000000004'].join('_');
    final service = RepartidorFinanzasService(
      offlinePost: (
        endpoint,
        payload, {
        syncType,
        cacheKey,
      }) async {
        throw ApiException('conflict', statusCode: 409);
      },
      pendingOperations: () => pending,
      enqueueOperation: (operation) async => pending.add(operation),
    );

    await expectLater(
      _submit(service, token),
      throwsA(
        isA<ApiException>().having(
          (error) => error.statusCode,
          'statusCode',
          409,
        ),
      ),
    );

    expect(pending, hasLength(1));
    expect(pending.single.isFailed, isTrue);
    expect(pending.single.payload['idempotencyToken'], token);

    final reopened = RepartidorFinanzasService(
      offlinePost: (
        endpoint,
        payload, {
        syncType,
        cacheKey,
      }) async =>
          throw StateError('must not post while under review'),
      pendingOperations: () => pending,
      enqueueOperation: (_) async {},
    );
    final result = await _submit(
      reopened,
      'vto_94_doc_00000000000000000000000000000005',
    );

    expect(result.state, VencimientoCobroSubmissionState.manualReview);
    expect(result.idempotencyToken, token);
  });
}
