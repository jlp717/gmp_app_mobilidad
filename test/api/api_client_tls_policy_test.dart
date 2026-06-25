import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

void main() {
  group('ApiClient TLS policy', () {
    test('rejects invalid non-dev certificates even when pinning is empty', () {
      expect(
        ApiClient.shouldBypassInvalidCertificateForHost(
          'api.granjamaripepa.com',
          debugMode: true,
        ),
        isFalse,
      );
      expect(
        ApiClient.shouldBypassInvalidCertificateForHost(
          'api.granjamaripepa.com',
          debugMode: false,
        ),
        isFalse,
      );
    });

    test('allows invalid certificates only for local debug hosts', () {
      expect(
        ApiClient.shouldBypassInvalidCertificateForHost(
          'localhost',
          debugMode: true,
        ),
        isTrue,
      );
      expect(
        ApiClient.shouldBypassInvalidCertificateForHost(
          'localhost',
          debugMode: false,
        ),
        isFalse,
      );
    });
  });
}
