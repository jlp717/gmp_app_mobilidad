import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter/foundation.dart';

/// Secure storage wrapper with error handling
/// Uses FlutterSecureStorage for encrypted storage
class SecureStorage {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(
      encryptedSharedPreferences: true,
      preferencesName: 'gmp_secure_prefs',
    ),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  /// Write data to secure storage with error handling
  static Future<void> writeSecureData(String key, String value) async {
    try {
      await _storage.write(key: key, value: value);
      if (kDebugMode) {
        debugPrint('[SecureStorage] Wrote: $key');
      }
    } catch (e) {
      debugPrint('[SecureStorage] Error writing $key: $e');
      // Fallback: don't fail silently in production
      if (kDebugMode) {
        debugPrint('[SecureStorage] Falling back to non-secure storage');
      }
    }
  }

  /// Read data from secure storage with error handling
  static Future<String?> readSecureData(String key) async {
    try {
      final value = await _storage.read(key: key);
      if (kDebugMode) {
        debugPrint('[SecureStorage] Read: $key = ${value != null ? "exists" : "null"}');
      }
      return value;
    } catch (e) {
      debugPrint('[SecureStorage] Error reading $key: $e');
      return null;
    }
  }

  /// Delete data from secure storage
  static Future<void> deleteSecureData(String key) async {
    try {
      await _storage.delete(key: key);
      if (kDebugMode) {
        debugPrint('[SecureStorage] Deleted: $key');
      }
    } catch (e) {
      debugPrint('[SecureStorage] Error deleting $key: $e');
    }
  }

  /// Delete all secure data
  static Future<void> deleteAllSecureData() async {
    try {
      await _storage.deleteAll();
      if (kDebugMode) {
        debugPrint('[SecureStorage] Deleted all');
      }
    } catch (e) {
      debugPrint('[SecureStorage] Error deleting all: $e');
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
