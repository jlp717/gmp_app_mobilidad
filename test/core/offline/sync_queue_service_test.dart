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
    try {
      await Hive.close().timeout(const Duration(seconds: 2));
    } catch (_) {
      // Hive.close can hang under parallel Dio mocks; temp dir cleanup is enough.
    }
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
        required String fingerprint,
        required String idempotencyKey,
        String? cobroId,
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
        required String fingerprint,
        required String idempotencyKey,
        String? cobroId,
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

  group('parallel drain + drain timeouts', () {
    test('same-type ops drain concurrently (wall-clock < serial sum)',
        () async {
      var inFlight = 0;
      var peakInFlight = 0;
      ApiClient.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) async {
            expect(
                options.extra['maxRetries'], SyncQueueService.drainMaxRetries);
            expect(
                options.receiveTimeout, SyncQueueService.drainReceiveTimeout);
            inFlight++;
            if (inFlight > peakInFlight) peakInFlight = inFlight;
            await Future<void>.delayed(const Duration(milliseconds: 80));
            inFlight--;
            handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                statusCode: 200,
                data: const {'success': true},
              ),
            );
          },
        ),
      );

      for (var i = 0; i < 3; i++) {
        await queue.enqueue(
          SyncOperation(
            id: 'cobro-$i',
            type: 'register_cobro',
            endpoint: '/sync-test/cobro',
            method: 'POST',
            payload: {'id': i},
            headers: {'Idempotency-Key': 'cobro-$i'},
          ),
        );
      }

      final sw = Stopwatch()..start();
      final result = await queue.processAllWithResult(maxConcurrentPerType: 3);
      sw.stop();

      expect(result.synced, 3);
      expect(peakInFlight, greaterThanOrEqualTo(2));
      // Serial would be ~240ms; parallel pool of 3 ≈ one RTT.
      expect(sw.elapsedMilliseconds, lessThan(200));
    });

    test('distinct types drain in parallel buckets', () async {
      var inFlight = 0;
      var peakInFlight = 0;
      ApiClient.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) async {
            inFlight++;
            if (inFlight > peakInFlight) peakInFlight = inFlight;
            await Future<void>.delayed(const Duration(milliseconds: 60));
            inFlight--;
            final ok = options.path.contains('confirm')
                ? <String, dynamic>{
                    'success': true,
                    'confirmationId': 'c-1',
                  }
                : <String, dynamic>{'success': true};
            handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                statusCode: 200,
                data: ok,
              ),
            );
          },
        ),
      );
      SyncQueueService.confirmDeliveryReconciler = ({
        required String deliveryId,
        required String confirmationId,
        required String fingerprint,
        required String idempotencyKey,
        String? cobroId,
      }) async {};

      await queue.enqueue(_confirmDeliveryOperation(id: 'type-confirm'));
      await queue.enqueue(
        SyncOperation(
          id: 'type-cobro',
          type: 'register_cobro',
          endpoint: '/sync-test/cobro',
          method: 'POST',
          payload: const {'id': 1},
          headers: const {'Idempotency-Key': 'type-cobro'},
        ),
      );

      final result = await queue.processAllWithResult();
      expect(result.synced, 2);
      expect(peakInFlight, greaterThanOrEqualTo(2));
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
