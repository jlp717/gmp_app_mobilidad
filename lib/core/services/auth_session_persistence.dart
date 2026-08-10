import 'package:gmp_app_mobilidad/core/services/secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

typedef SecureSessionWrite = Future<void> Function(String key, String value);
typedef SecureSessionDelete = Future<void> Function(String key);
typedef PreferenceStringWrite = Future<void> Function(String key, String value);
typedef PreferenceStringListWrite = Future<void> Function(
  String key,
  List<String> value,
);
typedef PreferenceDelete = Future<void> Function(String key);

/// Complete local projection of one canonical backend authentication session.
class CanonicalLocalAuthSession {
  const CanonicalLocalAuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.userJson,
    required this.vendedorCodes,
    required this.activeMode,
    required this.expiresAt,
  });

  final String accessToken;
  final String refreshToken;
  final String userJson;
  final List<String> vendedorCodes;
  final String activeMode;
  final DateTime expiresAt;
}

/// Persists a rotated session as one fail-closed local transaction.
///
/// Secure storage and preferences do not provide a cross-store transaction.
/// Therefore any failed write deletes every session fragment and forces a new
/// login. The application must never continue with mixed old/new credentials.
class AuthSessionPersistence {
  AuthSessionPersistence({
    required SecureSessionWrite writeSecure,
    required SecureSessionDelete deleteSecure,
    required PreferenceStringWrite writeString,
    required PreferenceStringListWrite writeStringList,
    required PreferenceDelete deletePreference,
  })  : _writeSecure = writeSecure,
        _deleteSecure = deleteSecure,
        _writeString = writeString,
        _writeStringList = writeStringList,
        _deletePreference = deletePreference;

  factory AuthSessionPersistence.secure() {
    return AuthSessionPersistence(
      writeSecure: SecureStorage.writeSecureData,
      deleteSecure: SecureStorage.deleteSecureData,
      writeString: (key, value) async {
        final preferences = await SharedPreferences.getInstance();
        if (!await preferences.setString(key, value)) {
          throw StateError('Preference write failed: $key');
        }
      },
      writeStringList: (key, value) async {
        final preferences = await SharedPreferences.getInstance();
        if (!await preferences.setStringList(key, value)) {
          throw StateError('Preference write failed: $key');
        }
      },
      deletePreference: (key) async {
        final preferences = await SharedPreferences.getInstance();
        await preferences.remove(key);
      },
    );
  }

  final SecureSessionWrite _writeSecure;
  final SecureSessionDelete _deleteSecure;
  final PreferenceStringWrite _writeString;
  final PreferenceStringListWrite _writeStringList;
  final PreferenceDelete _deletePreference;

  Future<void> commit(CanonicalLocalAuthSession session) async {
    try {
      await _writeSecure('user_token', session.accessToken);
      await _writeSecure('refresh_token', session.refreshToken);
      await _writeSecure('user_data', session.userJson);
      await _writeSecure(
        'session_expires_at',
        session.expiresAt.millisecondsSinceEpoch.toString(),
      );
      await _writeStringList('vendedor_codes', session.vendedorCodes);
      await _writeString('auth_active_mode', session.activeMode);
    } catch (error) {
      await clear();
      throw AuthSessionPersistenceException(error);
    }
  }

  Future<void> clear() async {
    for (final key in const [
      'user_token',
      'refresh_token',
      'user_data',
      'session_expires_at',
    ]) {
      await _bestEffort(() => _deleteSecure(key));
    }
    for (final key in const [
      'vendedor_codes',
      'auth_active_mode',
      'global_filter_vendor',
    ]) {
      await _bestEffort(() => _deletePreference(key));
    }
  }

  Future<void> _bestEffort(Future<void> Function() operation) async {
    try {
      await operation();
    } catch (_) {
      // Continue clearing every remaining fragment. The caller also clears the
      // in-memory bearer and scope, so a failed platform delete cannot be used.
    }
  }
}

class AuthSessionPersistenceException implements Exception {
  const AuthSessionPersistenceException(this.cause);

  final Object cause;

  @override
  String toString() => 'No se pudo guardar la sesion de forma segura.';
}
