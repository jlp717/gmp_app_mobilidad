/// Pedidos Favorites Service
/// =========================
/// Hive-based local storage for product favorites

import 'package:hive_flutter/hive_flutter.dart';
import 'dart:convert';
import 'package:crypto/crypto.dart';

class PedidosFavoritesService {
  static const _boxName = 'pedidos_favorites';
  static Box<dynamic>? _box;

  static Future<void> init() async {
    final key = _generateEncryptionKey();
    final cipher = HiveAesCipher(key);
    _box = await Hive.openBox(_boxName, encryptionCipher: cipher);
  }

  static List<int> _generateEncryptionKey() {
    final seed = 'gmp_app_pedidos_favorites_key_v1';
    return sha256.convert(utf8.encode(seed)).bytes;
  }

  static List<String> getFavorites() {
    final box = _box;
    if (box == null || box.isEmpty) return [];
    return box.values.whereType<String>().toList();
  }

  static Future<void> addFavorite(String productCode) async {
    final box = _box ?? await Hive.openBox(_boxName);
    if (!box.values.contains(productCode)) {
      await box.add(productCode);
    }
  }

  static Future<void> removeFavorite(String productCode) async {
    final box = _box ?? await Hive.openBox(_boxName);
    final key = box.keys.firstWhere(
      (k) => box.get(k) == productCode,
      orElse: () => null,
    );
    if (key != null) await box.delete(key);
  }

  static Future<void> toggleFavorite(String productCode) async {
    if (isFavorite(productCode)) {
      await removeFavorite(productCode);
    } else {
      await addFavorite(productCode);
    }
  }

  static bool isFavorite(String productCode) {
    return _box?.values.contains(productCode) ?? false;
  }

  static int get count => _box?.length ?? 0;
}
