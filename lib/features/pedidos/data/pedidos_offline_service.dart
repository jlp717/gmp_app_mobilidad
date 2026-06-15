/// Pedidos Offline Service
/// =======================
/// Hive-based local storage for draft orders and offline sync queue
library;

import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:hive_flutter/hive_flutter.dart';

class PedidosOfflineService {
  static const _draftsBoxName = 'pedidos_drafts';
  static const _syncQueueBoxName = 'pedidos_sync_queue';
  static const _defaultMaxBatchSize = 25;
  static const _maxBatchSize = 50;
  static const _maxConcurrentSyncs = 1;
  static const _defaultYieldEvery = 5;

  static Box<dynamic>? _draftsBox;
  static Box<dynamic>? _syncQueueBox;

  static Future Function(
      {required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String? clientRequestId}) _createOrder = _defaultCreateOrder;

  /// Initialize Hive boxes
  static Future<void> init() async {
    final key = _generateEncryptionKey();
    final cipher = HiveAesCipher(key);
    _draftsBox = await Hive.openBox(_draftsBoxName, encryptionCipher: cipher);
    _syncQueueBox =
        await Hive.openBox(_syncQueueBoxName, encryptionCipher: cipher);
  }

  static List<int> _generateEncryptionKey() {
    const seed = 'gmp_app_pedidos_offline_key_v1';
    return sha256.convert(utf8.encode(seed)).bytes;
  }

  // ── Draft Orders ──

  /// Save current cart as a draft
  static Future<String> saveDraft({
    required String clientCode,
    required String clientName,
    required String saleType,
    required String vendedorCode,
    required List<OrderLine> lines,
    String? draftKey,
  }) async {
    final box = _draftsBox ?? await Hive.openBox(_draftsBoxName);
    final key = draftKey ??
        'draft_${clientCode}_${DateTime.now().millisecondsSinceEpoch}';
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
    return key;
  }

  /// Auto-save: Overwrites a single draft per client
  static Future<void> saveAutoDraft({
    required String clientCode,
    required String clientName,
    required String saleType,
    required String vendedorCode,
    required List<OrderLine> lines,
  }) async {
    await saveDraft(
      draftKey: 'draft_auto_$clientCode',
      clientCode: clientCode,
      clientName: clientName,
      saleType: saleType,
      vendedorCode: vendedorCode,
      lines: lines,
    );
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
    drafts.sort(
      (a, b) => (b['savedAt']?.toString() ?? '')
          .compareTo(a['savedAt']?.toString() ?? ''),
    );
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
  static Future queueOrderForSync({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    required String saleType,
    required List lines,
  }) async {
    final box = _syncQueueBox ?? await Hive.openBox(_syncQueueBoxName);
    final key = await _nextSyncKey(box);
    final lineJson = [];
    for (final line in lines) {
      lineJson.add((line as OrderLine).toJson());
    }
    final data = {
      "clientCode": clientCode,
      "clientName": clientName,
      "vendedorCode": vendedorCode,
      "saleType": saleType,
      "lines": lineJson,
      "clientRequestId": "pedido_offline_$key",
      "queuedAt": DateTime.now().toIso8601String(),
      "status": "pending",
      "attempts": 0,
    };
    await box.put(key, jsonEncode(data));
    debugPrint("[PedidosOffline] Order queued for sync: $key");
  }

  /// Get all pending sync items in stable queue order.
  static List getPendingSyncs() {
    return _getSyncsByStatus("pending");
  }

  /// Get failed sync items preserved for manual review or retry.
  static List getFailedSyncs() {
    return _getSyncsByStatus("failed");
  }

  /// Mark a failed queued order as pending for the next bounded retry.
  static Future retryFailedSync(String syncKey) async {
    final box = _syncQueueBox ?? await Hive.openBox(_syncQueueBoxName);
    final data = _decodeSyncItem(box, syncKey);
    if (data == null) return false;
    if (data["status"] == "failed") {
      data["status"] = "pending";
    } else {
      return false;
    }
    data.remove("error");
    data.remove("failedAt");
    await box.put(syncKey, jsonEncode(data));
    return true;
  }

  /// Sync pending orders with bounded batch size and explicit progress.
  static Future syncPendingOrdersWithResult({
    int maxBatchSize = _defaultMaxBatchSize,
    int maxConcurrency = _maxConcurrentSyncs,
    int yieldEvery = _defaultYieldEvery,
  }) async {
    final box = _syncQueueBox ?? await Hive.openBox(_syncQueueBoxName);
    final pending = getPendingSyncs();
    final batchLimit = maxBatchSize.clamp(1, _maxBatchSize).toInt();
    final effectiveConcurrency =
        maxConcurrency.clamp(1, _maxConcurrentSyncs).toInt();
    final selected = pending.take(batchLimit).toList(growable: false);
    final failures = [];
    var processed = 0;
    var synced = 0;

    for (final item in selected) {
      final syncKey = item["syncKey"].toString();
      try {
        final prepared = await _prepareSyncItem(box, syncKey, item);
        final response = await _createOrder(
          clientCode: prepared["clientCode"].toString(),
          clientName: prepared["clientName"].toString(),
          vendedorCode: prepared["vendedorCode"].toString(),
          tipoVenta: prepared["saleType"] as String? ?? "CC",
          lines: _decodeOrderLines(prepared["lines"]),
          clientRequestId: prepared["clientRequestId"] as String?,
        );
        if (response is Map) {
          if (response["queued"] == true) {
            throw StateError(
                "Pedido no confirmado por servidor; conservado para revision.");
          }
        }
        await box.delete(syncKey);
        synced++;
      } catch (e) {
        failures.add(await _markSyncFailed(box, syncKey, e));
      }
      processed++;
      if (yieldEvery == 0) {
      } else if (processed % yieldEvery == 0) {
        await Future.delayed(Duration.zero);
      }
    }

    final remainingPending = getPendingSyncs().length;
    final preservedFailures = getFailedSyncs().length;
    return {
      "totalPendingAtStart": pending.length,
      "selectedForRun": selected.length,
      "processed": processed,
      "synced": synced,
      "failed": failures.length,
      "remainingPending": remainingPending,
      "preservedFailures": preservedFailures,
      "batchLimit": batchLimit,
      "maxConcurrency": effectiveConcurrency,
      "isBackpressured": remainingPending == 0 ? false : true,
      "failures": failures,
    };
  }

  /// Sync all pending orders to the server, preserving the legacy count API.
  static Future syncPendingOrders() async {
    final result = await syncPendingOrdersWithResult();
    return result["synced"] as int;
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

  @visibleForTesting
  static void debugSetCreateOrderForTesting(
      Future Function(
              {required String clientCode,
              required String clientName,
              required String vendedorCode,
              required String tipoVenta,
              required List lines,
              required String? clientRequestId})
          createOrder) {
    _createOrder = createOrder;
  }

  @visibleForTesting
  static void debugResetCreateOrderForTesting() {
    _createOrder = _defaultCreateOrder;
  }

  static Future _defaultCreateOrder({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    required String tipoVenta,
    required List lines,
    required String? clientRequestId,
  }) {
    return PedidosService.createOrder(
      clientCode: clientCode,
      clientName: clientName,
      vendedorCode: vendedorCode,
      tipoVenta: tipoVenta,
      lines: lines.cast(),
      clientRequestId: clientRequestId,
    );
  }

  static Future _nextSyncKey(Box box) async {
    var key = "sync_${DateTime.now().microsecondsSinceEpoch}";
    while (box.containsKey(key)) {
      await Future.delayed(Duration.zero);
      key = "sync_${DateTime.now().microsecondsSinceEpoch}";
    }
    return key;
  }

  static List _getSyncsByStatus(String status) {
    final box = _syncQueueBox;
    if (box == null) return [];
    if (box.isEmpty) return [];

    final items = [];
    for (final key in box.keys) {
      try {
        final data = _decodeSyncItem(box, key.toString());
        if (data == null) {
        } else if (data["status"] == status) {
          data["syncKey"] = key;
          items.add(data);
        }
      } catch (e) {
        debugPrint("[PedidosOffline] Error reading sync item $key: $e");
      }
    }
    items.sort((a, b) {
      final byQueuedAt = (a["queuedAt"]?.toString() ?? "")
          .compareTo(b["queuedAt"]?.toString() ?? "");
      if (byQueuedAt == 0) {
        return a["syncKey"].toString().compareTo(b["syncKey"].toString());
      }
      return byQueuedAt;
    });
    return items;
  }

  static Map? _decodeSyncItem(Box box, String syncKey) {
    final raw = box.get(syncKey);
    if (raw is String) {
      return jsonDecode(raw) as Map;
    }
    return null;
  }

  static Future _prepareSyncItem(Box box, String syncKey, Map item) async {
    final data = Map.from(item);
    data.remove("syncKey");
    final existingRequestId = data["clientRequestId"]?.toString().trim();
    if (existingRequestId == null) {
      data["clientRequestId"] = "pedido_offline_$syncKey";
    } else if (existingRequestId.isEmpty) {
      data["clientRequestId"] = "pedido_offline_$syncKey";
    }
    data["status"] = "pending";
    data["attempts"] = _asInt(data["attempts"]);
    data["lastSyncStartedAt"] = DateTime.now().toIso8601String();
    await box.put(syncKey, jsonEncode(data));
    return data;
  }

  static List _decodeOrderLines(Object? rawLines) {
    if (rawLines is List) {
      final lines = [];
      for (final line in rawLines) {
        lines.add(OrderLine.fromJson((line as Map).cast()));
      }
      return lines;
    }
    throw const FormatException("Pedido offline sin lineas validas.");
  }

  static Future _markSyncFailed(Box box, String syncKey, Object error) async {
    final data = _decodeSyncItem(box, syncKey) ?? {};
    final attempts = _asInt(data["attempts"]) + 1;
    data["status"] = "failed";
    data["attempts"] = attempts;
    data["error"] = error.toString();
    data["failedAt"] = DateTime.now().toIso8601String();
    data.putIfAbsent("clientRequestId", () {
      return "pedido_offline_$syncKey";
    });
    await box.put(syncKey, jsonEncode(data));
    debugPrint("[PedidosOffline] Sync failed for $syncKey: $error");
    return {
      "syncKey": syncKey,
      "clientRequestId": data["clientRequestId"],
      "error": error.toString(),
      "attempts": attempts,
    };
  }

  static int _asInt(Object? value) {
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? "") ?? 0;
  }
}
