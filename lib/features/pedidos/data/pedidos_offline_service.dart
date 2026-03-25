/// Pedidos Offline Service
/// =======================
/// Hive-based local storage for draft orders and offline sync queue

import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'pedidos_service.dart';

class PedidosOfflineService {
  static const _draftsBoxName = 'pedidos_drafts';
  static const _syncQueueBoxName = 'pedidos_sync_queue';

  static Box<dynamic>? _draftsBox;
  static Box<dynamic>? _syncQueueBox;

  /// Initialize Hive boxes
  static Future<void> init() async {
    _draftsBox = await Hive.openBox(_draftsBoxName);
    _syncQueueBox = await Hive.openBox(_syncQueueBoxName);
  }

  // ── Draft Orders ──

  /// Save current cart as a draft
  static Future<void> saveDraft({
    required String clientCode,
    required String clientName,
    required String saleType,
    required String vendedorCode,
    required List<OrderLine> lines,
  }) async {
    final box = _draftsBox ?? await Hive.openBox(_draftsBoxName);
    final key = 'draft_${clientCode}_${DateTime.now().millisecondsSinceEpoch}';
    final data = {
      'clientCode': clientCode,
      'clientName': clientName,
      'saleType': saleType,
      'vendedorCode': vendedorCode,
      'lines': lines.map((l) => l.toJson()).toList(),
      'savedAt': DateTime.now().toIso8601String(),
    };
    await box.put(key, jsonEncode(data));
    debugPrint('[PedidosOffline] Draft saved: $key');
  }

  /// Load all saved drafts
  static List<Map<String, dynamic>> getDrafts() {
    final box = _draftsBox;
    if (box == null || box.isEmpty) return [];

    final drafts = <Map<String, dynamic>>[];
    for (final key in box.keys) {
      try {
        final raw = box.get(key);
        if (raw is String) {
          final data = jsonDecode(raw) as Map<String, dynamic>;
          data['draftKey'] = key;
          drafts.add(data);
        }
      } catch (e) {
        debugPrint('[PedidosOffline] Error reading draft $key: $e');
      }
    }
    // Sort by savedAt descending
    drafts.sort((a, b) => (b['savedAt']?.toString() ?? '').compareTo(a['savedAt']?.toString() ?? ''));
    return drafts;
  }

  /// Delete a draft
  static Future<void> deleteDraft(String key) async {
    final box = _draftsBox ?? await Hive.openBox(_draftsBoxName);
    await box.delete(key);
  }

  /// Get draft count
  static int get draftCount => _draftsBox?.length ?? 0;

  // ── Sync Queue (offline order confirmations) ──

  /// Queue a confirmed order for sync when back online
  static Future<void> queueOrderForSync({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    required String saleType,
    required List<OrderLine> lines,
  }) async {
    final box = _syncQueueBox ?? await Hive.openBox(_syncQueueBoxName);
    final key = 'sync_${DateTime.now().millisecondsSinceEpoch}';
    final data = {
      'clientCode': clientCode,
      'clientName': clientName,
      'vendedorCode': vendedorCode,
      'saleType': saleType,
      'lines': lines.map((l) => l.toJson()).toList(),
      'queuedAt': DateTime.now().toIso8601String(),
      'status': 'pending',
    };
    await box.put(key, jsonEncode(data));
    debugPrint('[PedidosOffline] Order queued for sync: $key');
  }

  /// Get all pending sync items
  static List<Map<String, dynamic>> getPendingSyncs() {
    final box = _syncQueueBox;
    if (box == null || box.isEmpty) return [];

    final items = <Map<String, dynamic>>[];
    for (final key in box.keys) {
      try {
        final raw = box.get(key);
        if (raw is String) {
          final data = jsonDecode(raw) as Map<String, dynamic>;
          if (data['status'] == 'pending') {
            data['syncKey'] = key;
            items.add(data);
          }
        }
      } catch (e) {
        debugPrint('[PedidosOffline] Error reading sync item $key: $e');
      }
    }
    return items;
  }

  /// Sync all pending orders to the server
  static Future<int> syncPendingOrders() async {
    final pending = getPendingSyncs();
    if (pending.isEmpty) return 0;

    int synced = 0;
    for (final item in pending) {
      try {
        final lines = (item['lines'] as List)
            .map((l) => OrderLine.fromJson(l as Map<String, dynamic>))
            .toList();

        await PedidosService.createOrder(
          clientCode: item['clientCode'] as String,
          clientName: item['clientName'] as String,
          vendedorCode: item['vendedorCode'] as String,
          tipoVenta: item['saleType'] as String? ?? 'CC',
          lines: lines,
        );

        // Mark as synced
        final box = _syncQueueBox ?? await Hive.openBox(_syncQueueBoxName);
        await box.delete(item['syncKey']);
        synced++;
      } catch (e) {
        debugPrint('[PedidosOffline] Sync failed for ${item['syncKey']}: $e');
        // Mark as failed
        final box = _syncQueueBox ?? await Hive.openBox(_syncQueueBoxName);
        final data = jsonDecode(box.get(item['syncKey']) as String) as Map<String, dynamic>;
        data['status'] = 'failed';
        data['error'] = e.toString();
        await box.put(item['syncKey'], jsonEncode(data));
      }
    }
    debugPrint('[PedidosOffline] Synced $synced/${pending.length} orders');
    return synced;
  }

  /// Get count of pending syncs
  static int get pendingSyncCount {
    return getPendingSyncs().length;
  }

  /// Clear all data (for testing)
  static Future<void> clearAll() async {
    await _draftsBox?.clear();
    await _syncQueueBox?.clear();
  }
}
