import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/services/secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('persists session keys through fallback storage', () async {
    await SecureStorage.writeSecureData('user_token', 'access-token');
    await SecureStorage.writeSecureData('refresh_token', 'refresh-token');
    await SecureStorage.writeSecureData('user_data', '{"id":"V1"}');
    await SecureStorage.writeSecureData('session_expires_at', '123456789');

    expect(await SecureStorage.readSecureData('user_token'), 'access-token');
    expect(await SecureStorage.readSecureData('refresh_token'), 'refresh-token');
    expect(await SecureStorage.readSecureData('user_data'), '{"id":"V1"}');
    expect(
      await SecureStorage.readSecureData('session_expires_at'),
      '123456789',
    );
  });

  test('deletes fallback session keys on logout cleanup', () async {
    await SecureStorage.writeSecureData('user_token', 'access-token');
    await SecureStorage.writeSecureData('refresh_token', 'refresh-token');
    await SecureStorage.writeSecureData('user_data', '{"id":"V1"}');
    await SecureStorage.writeSecureData('session_expires_at', '123456789');

    await SecureStorage.deleteSecureData('user_token');
    await SecureStorage.deleteSecureData('refresh_token');
    await SecureStorage.deleteSecureData('user_data');
    await SecureStorage.deleteSecureData('session_expires_at');

    expect(await SecureStorage.readSecureData('user_token'), isNull);
    expect(await SecureStorage.readSecureData('refresh_token'), isNull);
    expect(await SecureStorage.readSecureData('user_data'), isNull);
    expect(await SecureStorage.readSecureData('session_expires_at'), isNull);
  });
}
