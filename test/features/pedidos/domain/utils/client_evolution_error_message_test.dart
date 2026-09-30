import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/utils/client_evolution_error_message.dart';

void main() {
  group('clientEvolutionErrorMessage', () {
    test('maps network and authorization failures to actionable guidance', () {
      expect(
        clientEvolutionErrorMessage(ApiException('raw', statusCode: 0)),
        contains('conexión'),
      );
      expect(
        clientEvolutionErrorMessage(ApiException('raw', statusCode: 403)),
        contains('acceso'),
      );
    });

    test('does not expose a database diagnostic to the user', () {
      final message = clientEvolutionErrorMessage(
        ApiException('SQLSTATE 22003 secret bind', statusCode: 500),
      );

      expect(message, contains('servicio'));
      expect(message, isNot(contains('22003')));
      expect(message, isNot(contains('secret bind')));
    });
  });
}
