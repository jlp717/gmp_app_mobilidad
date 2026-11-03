import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:hive/hive.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory hiveDir;

  setUpAll(() async {
    hiveDir = await Directory.systemTemp.createTemp('pedidos_ack_contract_');
    Hive.init(hiveDir.path);
    await PedidosOfflineService.init();
  });

  setUp(() {
    PedidosOfflineService.setScope('off-bag-ack-contract');
  });

  tearDown(() async {
    await PedidosOfflineService.clearAll();
    PedidosOfflineService.clearScope();
    PedidosOfflineService.debugResetClockForTesting();
    PedidosOfflineService.debugResetCreateOrderForTesting();
    PedidosOfflineService.debugResetConfirmOrderForTesting();
    PedidosOfflineService.onVerifiedOrdersSynced = null;
  });

  tearDownAll(() async {
    await Hive.close();
    if (await hiveDir.exists()) await hiveDir.delete(recursive: true);
  });

  test('real create and confirm ACKs delete exactly one queued order',
      () async {
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async =>
        {
          'success': true,
          'order': {
            'header': {'id': 4101, 'estado': 'BORRADOR'},
            'lines': <Object>[],
          },
        });
    PedidosOfflineService.debugSetConfirmOrderForTesting(
      (
        orderId,
        saleType, {
        deliveryDate,
        vehicleCode,
        driverCode,
        routeCode,
        cobroPropio = false,
      }) async =>
          {
        'success': true,
        'order': {
          'header': {'id': orderId, 'estado': 'CONFIRMADO'},
          'lines': <Object>[],
        },
      },
    );
    await _queue('ack-real-0001');

    final result = await PedidosOfflineService.syncPendingOrdersWithResult();

    expect(result['synced'], 1);
    expect(PedidosOfflineService.getPendingSyncs(), isEmpty);
  });

  test('malformed 200 confirmation never removes durable queue record',
      () async {
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async =>
        {
          'success': true,
          'header': {'id': 4102, 'estado': 'BORRADOR'},
        });
    PedidosOfflineService.debugSetConfirmOrderForTesting(
      (
        orderId,
        saleType, {
        deliveryDate,
        vehicleCode,
        driverCode,
        routeCode,
        cobroPropio = false,
      }) async =>
          {
        'success': true,
        'header': {'id': orderId + 1, 'estado': 'CONFIRMADO'},
      },
    );
    await _queue('ack-malformed-0001');

    final result = await PedidosOfflineService.syncPendingOrdersWithResult();

    expect(result['synced'], 0);
    expect(result['failed'], 1);
    expect(PedidosOfflineService.getFailedSyncs(), hasLength(1));
  });

  test('lost create ACK replays the same clientRequestId', () async {
    final requestIds = <String?>[];
    var creates = 0;
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      requestIds.add(clientRequestId);
      creates++;
      if (creates == 1) throw StateError('network timeout');
      return {
        'success': true,
        'idempotent': true,
        'header': {'id': 4103, 'estado': 'BORRADOR'},
      };
    });
    PedidosOfflineService.debugSetConfirmOrderForTesting(
      (
        orderId,
        saleType, {
        deliveryDate,
        vehicleCode,
        driverCode,
        routeCode,
        cobroPropio = false,
      }) async =>
          {
        'success': true,
        'header': {'id': orderId, 'estado': 'CONFIRMADO'},
      },
    );
    await _queue('lost-create-0001');

    final first = await PedidosOfflineService.syncPendingOrdersWithResult();
    expect(first['transientFailed'], 1);
    final pending = PedidosOfflineService.getPendingSyncs().single as Map;
    expect(requestIds.single, pending['clientRequestId']);
    expect(
        await PedidosOfflineService.retryFailedSync(
            pending['syncKey'].toString()),
        isFalse);

    // Move the durable retry deadline without changing its identity.
    PedidosOfflineService.debugSetClockForTesting(
      () => DateTime.now().add(const Duration(minutes: 1)),
    );
    final second = await PedidosOfflineService.syncPendingOrdersWithResult();

    expect(second['synced'], 1);
    expect(requestIds, hasLength(2));
    expect(requestIds[1], requestIds[0]);
    PedidosOfflineService.debugResetClockForTesting();
  });

  test('lost confirm ACK retries persisted server id without recreating',
      () async {
    var createCalls = 0;
    final confirmedIds = <int>[];
    var confirmCalls = 0;
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      createCalls++;
      return {
        'success': true,
        'header': {'id': 4104, 'estado': 'BORRADOR'},
      };
    });
    PedidosOfflineService.debugSetConfirmOrderForTesting(
      (
        orderId,
        saleType, {
        deliveryDate,
        vehicleCode,
        driverCode,
        routeCode,
        cobroPropio = false,
      }) async {
        confirmedIds.add(orderId);
        confirmCalls++;
        if (confirmCalls == 1) throw StateError('network timeout');
        return {
          'success': true,
          'idempotent': true,
          'header': {'id': orderId, 'estado': 'CONFIRMADO'},
        };
      },
    );
    await _queue('lost-confirm-0001');

    expect(
      (await PedidosOfflineService.syncPendingOrdersWithResult())[
          'transientFailed'],
      1,
    );
    expect(
        (PedidosOfflineService.getPendingSyncs().single
            as Map)['serverOrderId'],
        4104);
    PedidosOfflineService.debugSetClockForTesting(
      () => DateTime.now().add(const Duration(minutes: 1)),
    );
    expect(
      (await PedidosOfflineService.syncPendingOrdersWithResult())['synced'],
      1,
    );

    expect(createCalls, 1);
    expect(confirmedIds, [4104, 4104]);
    PedidosOfflineService.debugResetClockForTesting();
  });

  test('verified callback receives only canonically confirmed ids', () async {
    List<int>? verifiedIds;
    String? verifiedScope;
    int? verifiedAuthEpoch;
    PedidosOfflineService.onVerifiedOrdersSynced =
        (scope, authEpoch, ids) async {
      verifiedScope = scope;
      verifiedAuthEpoch = authEpoch;
      verifiedIds = ids;
    };
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async =>
        {
          'success': true,
          'header': {'id': 4105, 'estado': 'BORRADOR'},
        });
    PedidosOfflineService.debugSetConfirmOrderForTesting(
      (
        orderId,
        saleType, {
        deliveryDate,
        vehicleCode,
        driverCode,
        routeCode,
        cobroPropio = false,
      }) async =>
          {
        'success': true,
        'header': {'id': orderId, 'estado': 'CONFIRMADO'},
      },
    );
    await _queue('verified-refresh-0001');

    await PedidosOfflineService.syncPendingOrdersWithResult();

    expect(verifiedScope, PedidosOfflineService.currentScopeId);
    expect(verifiedAuthEpoch, 0);
    expect(verifiedIds, [4105]);
  });

  test('top-level-only create acknowledgement remains queued', () async {
    PedidosOfflineService.debugSetRawCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async =>
        {'success': true, 'id': 4106, 'estado': 'BORRADOR'});
    await _queue('top-level-create-0001');

    final result = await PedidosOfflineService.syncPendingOrdersWithResult();

    expect(result['synced'], 0);
    expect(PedidosOfflineService.getFailedSyncs(), hasLength(1));
  });

  test('top-level-only confirm acknowledgement remains queued', () async {
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async =>
        {
          'success': true,
          'header': {'id': 4107, 'estado': 'BORRADOR'},
        });
    PedidosOfflineService.debugSetRawConfirmOrderForTesting(
      (
        orderId,
        saleType, {
        deliveryDate,
        vehicleCode,
        driverCode,
        routeCode,
        cobroPropio = false,
      }) async =>
          {'success': true, 'id': orderId, 'estado': 'CONFIRMADO'},
    );
    await _queue('top-level-confirm-0001');

    final result = await PedidosOfflineService.syncPendingOrdersWithResult();

    expect(result['synced'], 0);
    expect(PedidosOfflineService.getFailedSyncs(), hasLength(1));
    expect(
      PedidosOfflineService.getFailedSyncs().single['serverOrderId'],
      4107,
    );
  });
}

Future<void> _queue(String requestId) {
  final compactRequestId = requestId.replaceAll('-', '');
  return PedidosOfflineService.queueOrderForSync(
    clientCode: '4300040687',
    clientName: 'Cliente contrato OFF-BAG',
    vendedorCode: '35',
    saleType: 'CC',
    lines: [
      OrderLine(
        codigoArticulo: '1412',
        descripcion: 'Articulo real',
        cantidadEnvases: 1,
        cantidadUnidades: 0,
        unidadMedida: 'CAJAS',
        precioVenta: 10,
      ),
    ],
    observaciones: 'Contrato OFF-BAG',
    clientRequestId: compactRequestId.length >= 18
        ? compactRequestId.substring(0, 18)
        : compactRequestId.padRight(18, '0'),
    notifyQueued: false,
  );
}
