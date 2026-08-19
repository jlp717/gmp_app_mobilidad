import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory hiveDir;
  late SyncQueueService queue;

  setUpAll(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    hiveDir = await Directory.systemTemp.createTemp('sync_queue_service_test_');
    Hive.init(hiveDir.path);
    queue = SyncQueueService.instance;
    await queue.initialize();
  });

  setUp(() async {
    ApiClient.resetForTesting();
    SyncQueueService.confirmDeliveryReconciler = null;
    await queue.clear();
  });

  tearDown(() async {
    SyncQueueService.confirmDeliveryReconciler = null;
    await queue.clear();
    ApiClient.resetForTesting();
  });

  tearDownAll(() async {
    await Hive.close();
    if (await hiveDir.exists()) {
      await hiveDir.delete(recursive: true);
    }
  });

  group('confirm_delivery journal reconciliation', () {
    test('keeps the operation queued when journal reconciliation fails',
        () async {
      _respondWithAcceptedConfirmation();
      SyncQueueService.confirmDeliveryReconciler = ({
        required String deliveryId,
        required String confirmationId,
        String? cobroId,
        required String fingerprint,
        required String idempotencyKey,
      }) async {
        throw StateError('journal unavailable');
      };
      await queue.enqueue(_confirmDeliveryOperation(id: 'reconcile-fails'));

      final result = await queue.processAllWithResult();

      expect(result.synced, 0);
      expect(result.pending, 1);
      expect(queue.pending, hasLength(1));
      final retained = queue.pending.single;
      expect(retained.attempts, 1);
      expect(retained.isFailed, isFalse);
      expect(retained.lastError, contains('journal unavailable'));
    });

    test('dequeues only after journal reconciliation succeeds', () async {
      _respondWithAcceptedConfirmation();
      final reconciled = <String, String>{};
      SyncQueueService.confirmDeliveryReconciler = ({
        required String deliveryId,
        required String confirmationId,
        String? cobroId,
        required String fingerprint,
        required String idempotencyKey,
      }) async {
        reconciled
          ..['deliveryId'] = deliveryId
          ..['confirmationId'] = confirmationId
          ..['fingerprint'] = fingerprint
          ..['idempotencyKey'] = idempotencyKey;
      };
      await queue.enqueue(_confirmDeliveryOperation(id: 'reconcile-succeeds'));

      final result = await queue.processAllWithResult();

      expect(result.synced, 1);
      expect(result.pending, 0);
      expect(queue.pending, isEmpty);
      expect(
        reconciled,
        {
          'deliveryId': 'delivery-42',
          'confirmationId': 'confirmation-99',
          'fingerprint': 'fingerprint-42',
          'idempotencyKey': 'idempotency-42',
        },
      );
    });
  });
}

void _respondWithAcceptedConfirmation() {
  ApiClient.dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        if (options.path == '/sync-test/confirm-delivery') {
          handler.resolve(
            Response<Map<String, dynamic>>(
              requestOptions: options,
              statusCode: 200,
              data: const {
                'success': true,
                'confirmationId': 'confirmation-99',
              },
            ),
          );
          return;
        }
        handler.next(options);
      },
    ),
  );
}

SyncOperation _confirmDeliveryOperation({required String id}) => SyncOperation(
      id: id,
      type: 'confirm_delivery',
      endpoint: '/sync-test/confirm-delivery',
      method: 'POST',
      payload: const {
        'itemId': 'delivery-42',
        '_journalFingerprint': 'fingerprint-42',
        '_journalIdempotencyKey': 'idempotency-42',
      },
      headers: const {'Idempotency-Key': 'idempotency-42'},
    );
