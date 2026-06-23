import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_order_api.dart';

void main() {
  group('PedidosOrderApi', () {
    test('PedidosServiceOrderApi implements PedidosOrderApi', () {
      final api = PedidosServiceOrderApi();
      expect(api, isA<PedidosOrderApi>());
    });
  });

  group('OfflineAwareApi write queue contract', () {
    test('does not queue business-rule or conflict ApiException responses',
        () async {
      final interceptor = InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.method == 'POST' &&
              options.path == '/offline-aware/business-rule') {
            handler.reject(
              DioException(
                requestOptions: options,
                response: Response<Map<String, dynamic>>(
                  requestOptions: options,
                  statusCode: 409,
                  data: const {
                    'code': 'BOLSA_INSUFICIENTE',
                    'error': 'BOLSA_INSUFICIENTE',
                  },
                ),
                type: DioExceptionType.badResponse,
              ),
            );
            return;
          }
          handler.next(options);
        },
      );
      ApiClient.dio.interceptors.add(interceptor);
      addTearDown(() => ApiClient.dio.interceptors.remove(interceptor));

      await expectLater(
        OfflineAwareApi.post(
          '/offline-aware/business-rule',
          {'x': 1},
          syncType: 'pedido_create',
        ),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'statusCode', 409)
              .having((e) => e.code, 'code', 'BOLSA_INSUFICIENTE'),
        ),
      );
    });

    test('queues only verified network/timeout/server-unreachable failures',
        () async {
      final interceptor = InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.method == 'POST' &&
              options.path == '/offline-aware/network-timeout') {
            handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.sendTimeout,
              ),
            );
            return;
          }
          handler.next(options);
        },
      );
      ApiClient.dio.interceptors.add(interceptor);
      addTearDown(() => ApiClient.dio.interceptors.remove(interceptor));

      final result = await OfflineAwareApi.post(
        '/offline-aware/network-timeout',
        {'x': 1},
        syncType: 'pedido_create',
      );

      expect(result['queued'], isTrue);
      expect(result['syncId'], startsWith('pedido_create_'));
    });
  });

  group('SyncOperation failure preservation', () {
    test('serializes failed operations without losing last error evidence', () {
      final failedAt = DateTime.utc(2026, 6, 14, 1, 2, 3);
      final op = SyncOperation(
        id: 'op-1',
        type: 'pedido_create',
        endpoint: '/pedidos',
        method: 'POST',
        payload: const {'clientRequestId': 'req00001'},
        attempts: 5,
        lastError: 'timeout',
        failedAt: failedAt,
      );

      final restored = SyncOperation.fromJson(op.toJson());

      expect(restored.isFailed, isTrue);
      expect(restored.attempts, 5);
      expect(restored.lastError, 'timeout');
      expect(restored.failedAt, failedAt);
    });
  });
}
