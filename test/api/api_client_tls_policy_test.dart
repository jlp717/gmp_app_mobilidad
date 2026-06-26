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

  group('ApiClient auth session deadline', () {
    tearDown(() {
      ApiClient.authSessionExpiresAt = null;
    });

    test('treats a missing local deadline as not expired', () {
      ApiClient.authSessionExpiresAt = null;

      expect(ApiClient.isAuthSessionExpired, isFalse);
    });

    test('expires the local auth session when the deadline has passed', () {
      ApiClient.authSessionExpiresAt =
          DateTime.now().subtract(const Duration(milliseconds: 1));

      expect(ApiClient.isAuthSessionExpired, isTrue);
    });

    test('keeps the local auth session active before the deadline', () {
      ApiClient.authSessionExpiresAt =
          DateTime.now().add(const Duration(days: 1));

      expect(ApiClient.isAuthSessionExpired, isFalse);
    });
  });
}
