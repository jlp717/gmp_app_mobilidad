/// Pedidos Favorites Service
/// =========================
/// Hive-based local storage for product favorites
library;

import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/storage/hive_secure_box.dart';
import 'package:hive_flutter/hive_flutter.dart';

class PedidosFavoritesService {
  static const _boxName = 'pedidos_favorites';
  static Box<dynamic>? _box;
  static const String _anonymousScope = 'anon';
  static String _scope = _anonymousScope;

  static Future<void> init() async {
    _box = await _openBox();
  }

  static List<int> _generateEncryptionKey() {
    const seed = 'gmp_app_pedidos_favorites_key_v1';
    return sha256.convert(utf8.encode(seed)).bytes;
  }

  static Future<Box<dynamic>> _openBox() {
    return HiveSecureBox.open<dynamic>(
      _boxName,
      legacyKey: _generateEncryptionKey(),
    );
  }

  static Future<Box<dynamic>> _favoritesBox() async {
    final box = _box;
    if (box != null && box.isOpen) return box;
    _box = await _openBox();
    return _box!;
  }

  static void setScope(String rawScope) {
    final normalized = rawScope.trim();
    if (normalized.isEmpty) {
      clearScope();
      return;
    }
    _scope =
        sha256.convert(utf8.encode(normalized)).toString().substring(0, 16);
    debugPrint('[PedidosFavorites] Scope changed');
  }

  static void clearScope() {
    _scope = _anonymousScope;
  }

  static String _favoriteKey(String productCode) => '$_scope::$productCode';

  static List<String> getFavorites() {
    final box = _box;
    if (box == null || box.isEmpty) return [];
    final prefix = '$_scope::';
    return box.keys
        .where((key) => key.toString().startsWith(prefix))
        .map(box.get)
        .whereType<String>()
        .toList(growable: false);
  }

  static Future<void> addFavorite(String productCode) async {
    final box = await _favoritesBox();
    await box.put(_favoriteKey(productCode), productCode);
  }

  static Future<void> removeFavorite(String productCode) async {
    final box = await _favoritesBox();
    await box.delete(_favoriteKey(productCode));
  }

  static Future<void> toggleFavorite(String productCode) async {
    if (isFavorite(productCode)) {
      await removeFavorite(productCode);
    } else {
      await addFavorite(productCode);
    }
  }

  static bool isFavorite(String productCode) {
    return _box?.containsKey(_favoriteKey(productCode)) ?? false;
  }

  static int get count => getFavorites().length;
}
