/// Pedidos Catalog Prefs Service
/// =============================
/// Hive-based local storage for catalog sort preference.
library;

import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/storage/hive_secure_box.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/catalog_product_sort.dart';
import 'package:hive_flutter/hive_flutter.dart';

class PedidosCatalogPrefsService {
  static const _boxName = 'pedidos_catalog_prefs';
  static const _sortKey = 'catalog_sort';
  static Box<dynamic>? _box;

  static Future<void> init() async {
    _box = await _openBox();
  }

  static List<int> _generateEncryptionKey() {
    const seed = 'gmp_app_pedidos_catalog_prefs_key_v1';
    return sha256.convert(utf8.encode(seed)).bytes;
  }

  static Future<Box<dynamic>> _openBox() {
    return HiveSecureBox.open<dynamic>(
      _boxName,
      legacyKey: _generateEncryptionKey(),
    );
  }

  static Future<Box<dynamic>> _prefsBox() async {
    final box = _box;
    if (box != null && box.isOpen) return box;
    _box = await _openBox();
    return _box!;
  }

  static CatalogProductSort getSort() {
    final raw = _box?.get(_sortKey);
    return CatalogProductSortX.fromStorage(raw?.toString());
  }

  static Future<void> setSort(CatalogProductSort sort) async {
    final box = await _prefsBox();
    await box.put(_sortKey, sort.storageKey);
    if (kDebugMode) {
      debugPrint('[PedidosCatalogPrefs] sort=${sort.storageKey}');
    }
  }
}
