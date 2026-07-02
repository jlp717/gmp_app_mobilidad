import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Secure storage wrapper with error handling
/// Uses FlutterSecureStorage for encrypted storage
class SecureStorage {
  static const FlutterSecureStorage _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(
      encryptedSharedPreferences: true,
    ),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );
  static const String _fallbackPrefix = 'gmp_secure_fallback_';
  static const Set<String> _sensitiveKeys = {
    'user_token',
    'refresh_token',
    'user_data',
  };
  static const Set<String> _fallbackEligibleKeys = {
    'session_expires_at',
  };

  static bool _canUseFallback(String key) =>
      _fallbackEligibleKeys.contains(key);
  static bool _isSensitive(String key) => _sensitiveKeys.contains(key);
  static String _fallbackKey(String key) => '$_fallbackPrefix$key';

  static Future<void> _writeFallback(String key, String value) async {
    if (!_canUseFallback(key)) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_fallbackKey(key), value);
  }

  static Future<String?> _readFallback(String key) async {
    if (!_canUseFallback(key)) return null;
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_fallbackKey(key));
  }

  static Future<void> _deleteFallback(String key) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_fallbackKey(key));
  }

  /// Write data to secure storage with error handling
  static Future<void> writeSecureData(String key, String value) async {
    try {
      await _storage.write(key: key, value: value);
      if (_canUseFallback(key)) {
        await _writeFallback(key, value);
      } else {
        await _deleteFallback(key);
      }
      if (kDebugMode) {
        debugPrint('[SecureStorage] Wrote: $key');
      }
    } catch (e) {
      debugPrint('[SecureStorage] Error writing $key: $e');
      if (_isSensitive(key)) {
        throw StateError('Secure storage unavailable for sensitive key: $key');
      }
      try {
        await _writeFallback(key, value);
        if (kDebugMode && _canUseFallback(key)) {
          debugPrint('[SecureStorage] Wrote fallback: $key');
        }
      } catch (fallbackError) {
        debugPrint(
          '[SecureStorage] Error writing fallback $key: $fallbackError',
        );
      }
    }
  }

  /// Read data from secure storage with error handling
  static Future<String?> readSecureData(String key) async {
    try {
      final value = await _storage.read(key: key);
      if (value != null && _isSensitive(key)) {
        await _deleteFallback(key);
      }
      if (value == null) {
        final fallback = await _readFallback(key);
        if (fallback != null) {
          if (kDebugMode) {
            debugPrint('[SecureStorage] Read fallback: $key = exists');
          }
          return fallback;
        }
      }
      if (kDebugMode) {
        debugPrint(
          '[SecureStorage] Read: $key = ${value != null ? "exists" : "null"}',
        );
      }
      return value;
    } catch (e) {
      debugPrint('[SecureStorage] Error reading $key: $e');
      if (_isSensitive(key)) {
        return null;
      }
      try {
        final fallback = await _readFallback(key);
        if (fallback != null && kDebugMode) {
          debugPrint(
            '[SecureStorage] Read fallback after error: $key = exists',
          );
        }
        return fallback;
      } catch (fallbackError) {
        debugPrint(
          '[SecureStorage] Error reading fallback $key: $fallbackError',
        );
        return null;
      }
    }
  }

  /// Delete data from secure storage
  static Future<void> deleteSecureData(String key) async {
    try {
      await _storage.delete(key: key);
      await _deleteFallback(key);
      if (kDebugMode) {
        debugPrint('[SecureStorage] Deleted: $key');
      }
    } catch (e) {
      debugPrint('[SecureStorage] Error deleting $key: $e');
      try {
        await _deleteFallback(key);
      } catch (fallbackError) {
        debugPrint(
          '[SecureStorage] Error deleting fallback $key: $fallbackError',
        );
      }
    }
  }

  /// Delete all secure data
  static Future<void> deleteAllSecureData() async {
    try {
      await _storage.deleteAll();
      final prefs = await SharedPreferences.getInstance();
      final fallbackKeys = prefs
          .getKeys()
          .where((key) => key.startsWith(_fallbackPrefix))
          .toList();
      for (final key in fallbackKeys) {
        await prefs.remove(key);
      }
      if (kDebugMode) {
        debugPrint('[SecureStorage] Deleted all');
      }
    } catch (e) {
      debugPrint('[SecureStorage] Error deleting all: $e');
      try {
        final prefs = await SharedPreferences.getInstance();
        final fallbackKeys = prefs
            .getKeys()
            .where((key) => key.startsWith(_fallbackPrefix))
            .toList();
        for (final key in fallbackKeys) {
          await prefs.remove(key);
        }
      } catch (fallbackError) {
        debugPrint(
          '[SecureStorage] Error deleting all fallback: $fallbackError',
        );
      }
    }
  }

  /// Check if secure storage is available
  static Future<bool> isAvailable() async {
    try {
      await _storage.read(key: '__test__');
      return true;
    } catch (e) {
      debugPrint('[SecureStorage] Not available: $e');
      return false;
    }
  }
}
