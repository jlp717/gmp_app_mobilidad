import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/services/secure_storage.dart';
import 'package:hive_flutter/hive_flutter.dart';

class HiveSecureBox {
  static Future<Box<T>> open<T>(
    String boxName, {
    List<int>? legacyKey,
    bool migrateUnencryptedLegacy = false,
  }) async {
    final key = await _keyForBox(boxName);
    final cipher = HiveAesCipher(key);

    try {
      return await Hive.openBox<T>(boxName, encryptionCipher: cipher);
    } catch (secureError) {
      final migrated = await _migrateLegacyBox<T>(
        boxName,
        targetCipher: cipher,
        legacyKey: legacyKey,
        migrateUnencryptedLegacy: migrateUnencryptedLegacy,
      );
      if (migrated) {
        return Hive.openBox<T>(boxName, encryptionCipher: cipher);
      }
      debugPrint('[HiveSecureBox] Could not open encrypted box $boxName');
      rethrow;
    }
  }

  static Future<List<int>> _keyForBox(String boxName) async {
    final storageKey = 'hive_secure_key_v2_$boxName';
    final existing = await SecureStorage.readSecureData(storageKey);
    if (existing != null && existing.isNotEmpty) {
      try {
        final decoded = base64Decode(existing);
        if (decoded.length == 32) return decoded;
      } catch (_) {
        // Replace malformed key below.
      }
    }

    final key = Hive.generateSecureKey();
    await SecureStorage.writeSecureData(storageKey, base64Encode(key));
    return key;
  }

  static Future<bool> _migrateLegacyBox<T>(
    String boxName, {
    required HiveAesCipher targetCipher,
    required List<int>? legacyKey,
    required bool migrateUnencryptedLegacy,
  }) async {
    Future<Box<dynamic>> Function()? legacyOpen;
    if (legacyKey != null) {
      legacyOpen = () => Hive.openBox<dynamic>(
            boxName,
            encryptionCipher: HiveAesCipher(legacyKey),
          );
    } else if (migrateUnencryptedLegacy) {
      legacyOpen = () => Hive.openBox<dynamic>(boxName);
    }
    if (legacyOpen == null) return false;

    Box<dynamic>? legacyBox;
    try {
      if (Hive.isBoxOpen(boxName)) {
        await Hive.box<dynamic>(boxName).close();
      }
      legacyBox = await legacyOpen();
      final entries = Map<dynamic, dynamic>.from(legacyBox.toMap());
      await legacyBox.close();
      await Hive.deleteBoxFromDisk(boxName);

      final targetBox = await Hive.openBox<dynamic>(
        boxName,
        encryptionCipher: targetCipher,
      );
      await targetBox.putAll(entries);
      await targetBox.close();
      debugPrint('[HiveSecureBox] Migrated legacy box $boxName');
      return true;
    } catch (e) {
      try {
        await legacyBox?.close();
      } catch (_) {}
      debugPrint('[HiveSecureBox] Legacy migration skipped for $boxName: $e');
      return false;
    }
  }
}
