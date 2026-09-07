import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_cobro_api.dart';

void main() {
  group('RuteroCobroApi idempotency', () {
    test('200 replay with idempotent true is confirmed and not created',
        () async {
      final api = RuteroCobroApi(
        post: (endpoint, data, {syncType, idempotent = false}) async {
          expect(endpoint, RuteroCobroApi.endpoint);
          expect(syncType, 'register_cobro');
          expect(idempotent, isTrue);
          return {
            'success': true,
            'idempotent': true,
            'created': false,
            'id': 'cobro-42',
          };
        },
      );

      final result = await api.register({'importeCobrado': 10});
      expect(result.queued, isFalse);
      expect(result.created, isFalse);
      expect(result.cobroId, 'cobro-42');
    });

    test('offline queue marker does not claim a created cobro', () async {
      final api = RuteroCobroApi(
        post: (endpoint, data, {syncType, idempotent = false}) async => {
          'queued': true,
          'syncId': 'q-7',
        },
      );

      final result = await api.register({'importeCobrado': 10});
      expect(result.queued, isTrue);
      expect(result.created, isFalse);
      expect(result.cobroId, 'q-7');
    });

    test('409 IDEMPOTENCY_CONFLICT is not swallowed as success', () async {
      final api = RuteroCobroApi(
        post: (endpoint, data, {syncType, idempotent = false}) async {
          throw ApiException(
            'Token de idempotencia reutilizado con otro payload',
            statusCode: 409,
            code: 'IDEMPOTENCY_CONFLICT',
          );
        },
      );

      await expectLater(
        api.register({'importeCobrado': 10}),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'statusCode', 409)
              .having((e) => e.code, 'code', 'IDEMPOTENCY_CONFLICT'),
        ),
      );
    });
  });
}
