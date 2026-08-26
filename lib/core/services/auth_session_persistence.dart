import 'dart:convert';

import 'package:gmp_app_mobilidad/core/services/secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
/// Every session fragment lives in flutter_secure_storage (Android Keystore /
/// iOS Keychain). SharedPreferences holds no authentication data anymore;
/// legacy keys written by older builds are migrated on first read and deleted.
class AuthSessionPersistence {
  const AuthSessionPersistence();

  static const String _kToken = 'user_token';
  static const String _kRefresh = 'refresh_token';
  static const String _kUser = 'user_data';
  static const String _kExpiresAt = 'session_expires_at';
  static const String _kVendedorCodes = 'vendedor_codes';
  static const String _kActiveMode = 'auth_active_mode';

  Future<void> commit(CanonicalLocalAuthSession session) async {
    try {
      await SecureStorage.writeSecureData(_kToken, session.accessToken);
      await SecureStorage.writeSecureData(_kRefresh, session.refreshToken);
      await SecureStorage.writeSecureData(_kUser, session.userJson);
      await SecureStorage.writeSecureData(
        _kExpiresAt,
        session.expiresAt.millisecondsSinceEpoch.toString(),
      );
      await SecureStorage.writeSecureData(
        _kVendedorCodes,
        jsonEncode(session.vendedorCodes),
      );
      await SecureStorage.writeSecureData(_kActiveMode, session.activeMode);
    } catch (error) {
      await clear();
      throw AuthSessionPersistenceException(error);
    }
  }

  Future<void> clear() async {
    for (final key in const [
      _kToken,
      _kRefresh,
      _kUser,
      _kExpiresAt,
      _kVendedorCodes,
      _kActiveMode,
    ]) {
      await _bestEffort(() => SecureStorage.deleteSecureData(key));
    }
    // Remove legacy SharedPreferences fragments from older installs.
    await _bestEffort(() async {
      final preferences = await SharedPreferences.getInstance();
      await preferences.remove(_kVendedorCodes);
      await preferences.remove(_kActiveMode);
    });
  }

  /// Reads vendor codes, migrating the legacy SharedPreferences copy once.
  static Future<List<String>> readVendedorCodes() async {
    final raw = await SecureStorage.readSecureData(_kVendedorCodes);
    if (raw != null && raw.isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is List) {
          return decoded.map((entry) => entry.toString()).toList();
        }
      } catch (_) {
        // Corrupt payload falls through to legacy migration below.
      }
    }
    try {
      final preferences = await SharedPreferences.getInstance();
      final legacy = preferences.getStringList(_kVendedorCodes);
      if (legacy != null && legacy.isNotEmpty) {
        await SecureStorage.writeSecureData(
          _kVendedorCodes,
          jsonEncode(legacy),
        );
        await preferences.remove(_kVendedorCodes);
        return legacy;
      }
    } catch (_) {
      // Migration is best-effort; an empty list forces re-login upstream.
    }
    return const <String>[];
  }

  /// Reads the saved UI mode, migrating the legacy SharedPreferences copy once.
  static Future<String?> readActiveMode() async {
    final saved = await SecureStorage.readSecureData(_kActiveMode);
    if (saved != null && saved.isNotEmpty) return saved;
    try {
      final preferences = await SharedPreferences.getInstance();
      final legacy = preferences.getString(_kActiveMode);
      if (legacy != null && legacy.isNotEmpty) {
        await SecureStorage.writeSecureData(_kActiveMode, legacy);
        await preferences.remove(_kActiveMode);
        return legacy;
      }
    } catch (_) {
      // Best-effort migration only.
    }
    return null;
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
