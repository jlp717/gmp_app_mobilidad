import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/objectives/domain/utils/client_matrix_error_message.dart';

void main() {
  group('clientMatrixErrorMessage', () {
    test('maps session and permission failures to actionable messages', () {
      expect(
        clientMatrixErrorMessage(ApiException('raw', statusCode: 401)),
        contains('sesión'),
      );
      expect(
        clientMatrixErrorMessage(ApiException('raw', statusCode: 403)),
        contains('acceso'),
      );
    });

    test('does not expose server diagnostics or SQL details', () {
      final message = clientMatrixErrorMessage(
        ApiException('SQLSTATE 22003 SELECT secret_bind', statusCode: 500),
      );

      expect(message, contains('servicio'));
      expect(message, isNot(contains('22003')));
      expect(message, isNot(contains('secret_bind')));
    });

    test('maps transport and unknown errors without exposing internals', () {
      expect(
        clientMatrixErrorMessage(ApiException('socket', statusCode: 0)),
        contains('conexión'),
      );
      expect(
        clientMatrixErrorMessage(StateError('internal state')),
        isNot(contains('internal state')),
      );
    });
  });
}
