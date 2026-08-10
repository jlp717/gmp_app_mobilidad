import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/services/auth_session_persistence.dart';

void main() {
  AuthSessionPersistence persistence({
    required Map<String, String> secure,
    required Map<String, Object> preferences,
    int? failAtWrite,
  }) {
    var writeIndex = 0;

    Future<void> maybeFail() async {
      if (writeIndex == failAtWrite) {
        writeIndex++;
        throw StateError('injected persistence failure');
      }
      writeIndex++;
    }

    return AuthSessionPersistence(
      writeSecure: (key, value) async {
        await maybeFail();
        secure[key] = value;
      },
      deleteSecure: (key) async => secure.remove(key),
      writeString: (key, value) async {
        await maybeFail();
        preferences[key] = value;
      },
      writeStringList: (key, value) async {
        await maybeFail();
        preferences[key] = List<String>.from(value);
      },
      deletePreference: (key) async => preferences.remove(key),
    );
  }

  CanonicalLocalAuthSession session() => CanonicalLocalAuthSession(
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        userJson: '{"id":"V050"}',
        vendedorCodes: const ['050'],
        activeMode: 'REPARTIDOR',
        expiresAt: DateTime.fromMillisecondsSinceEpoch(123456789),
      );

  test('complete canonical session is committed with no mixed fields',
      () async {
    final secure = <String, String>{};
    final preferences = <String, Object>{};

    await persistence(secure: secure, preferences: preferences)
        .commit(session());

    expect(secure, {
      'user_token': 'access-new',
      'refresh_token': 'refresh-new',
      'user_data': '{"id":"V050"}',
      'session_expires_at': '123456789',
    });
    expect(preferences, {
      'vendedor_codes': ['050'],
      'auth_active_mode': 'REPARTIDOR',
    });
  });

  for (var failAt = 0; failAt < 6; failAt++) {
    test('write failure at step $failAt clears every old/new fragment',
        () async {
      final secure = <String, String>{
        'user_token': 'access-old',
        'refresh_token': 'refresh-old',
        'user_data': '{"id":"old"}',
        'session_expires_at': '1',
      };
      final preferences = <String, Object>{
        'vendedor_codes': ['999'],
        'auth_active_mode': 'COMERCIAL',
        'global_filter_vendor': '999',
      };

      await expectLater(
        persistence(
          secure: secure,
          preferences: preferences,
          failAtWrite: failAt,
        ).commit(session()),
        throwsA(isA<AuthSessionPersistenceException>()),
      );

      expect(secure, isEmpty);
      expect(preferences, isEmpty);
    });
  }
}
