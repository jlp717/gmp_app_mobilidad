import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/services/secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const secureStorageChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final secureValues = <String, String>{};

  setUp(() {
    secureValues.clear();
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, (call) async {
      final args = Map<String, dynamic>.from(call.arguments as Map);
      final key = args['key'] as String?;

      switch (call.method) {
        case 'write':
          secureValues[key!] = args['value'] as String;
          return null;
        case 'read':
          return secureValues[key];
        case 'delete':
          secureValues.remove(key);
          return null;
        case 'deleteAll':
          secureValues.clear();
          return null;
      }
      return null;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, null);
  });

  test('keeps sensitive session keys out of fallback storage', () async {
    await SecureStorage.writeSecureData('user_token', 'access-token');
    await SecureStorage.writeSecureData('refresh_token', 'refresh-token');
    await SecureStorage.writeSecureData('user_data', '{"id":"V1"}');
    await SecureStorage.writeSecureData('session_expires_at', '123456789');

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('gmp_secure_fallback_user_token'), isNull);
    expect(prefs.getString('gmp_secure_fallback_refresh_token'), isNull);
    expect(prefs.getString('gmp_secure_fallback_user_data'), isNull);
    expect(
      prefs.getString('gmp_secure_fallback_session_expires_at'),
      '123456789',
    );

    expect(await SecureStorage.readSecureData('user_token'), 'access-token');
    expect(
      await SecureStorage.readSecureData('refresh_token'),
      'refresh-token',
    );
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
