/// Pedidos Offline Service
/// =======================
/// Hive-based local storage for draft orders and offline sync queue
library;

import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_sync_notifier.dart';
import 'package:gmp_app_mobilidad/core/storage/hive_secure_box.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:hive_flutter/hive_flutter.dart';

class PedidosOfflineService {
  static const _draftsBoxName = 'pedidos_drafts';
  static const _syncQueueBoxName = 'pedidos_sync_queue';
  static const _defaultMaxBatchSize = 25;
  static const _maxBatchSize = 50;
  static const _maxConcurrentSyncs = 1;
  static const _defaultYieldEvery = 5;
  static const _maxTransientAttempts = 8;
  static const String _anonymousScope = 'anon';

  static Box<dynamic>? _draftsBox;
  static Box<dynamic>? _syncQueueBox;
  static String _scope = _anonymousScope;

  static Future Function(
      {required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId}) _createOrder = _defaultCreateOrder;
  static Future<Map<String, dynamic>> Function(
    int orderId,
    String saleType, {
    String? deliveryDate,
    String? vehicleCode,
    String? driverCode,
    String? routeCode,
  }) _confirmOrder = PedidosService.confirmOrder;

  static Future<void> Function()? onChanged;

  /// Initialize Hive boxes
  static Future<void> init() async {
    _draftsBox = await _openDraftsBox();
    _syncQueueBox = await _openSyncQueueBox();
  }

  static List<int> _generateEncryptionKey() {
    const seed = 'gmp_app_pedidos_offline_key_v1';
    return sha256.convert(utf8.encode(seed)).bytes;
  }

  static void setScope(String rawScope) {
    final normalized = rawScope.trim();
    if (normalized.isEmpty) {
      clearScope();
      return;
    }
    _scope =
        sha256.convert(utf8.encode(normalized)).toString().substring(0, 16);
    debugPrint('[PedidosOffline] Scope changed');
  }

  static void clearScope() {
    _scope = _anonymousScope;
  }

  static String _scopedKey(String key) => '$_scope::$key';

  static String _ensureScopedKey(String key) {
    if (_isCurrentScopeKey(key)) return key;
    final unscoped = key.contains('::') ? key.split('::').last : key;
    return _scopedKey(unscoped);
  }

  static bool _isCurrentScopeKey(dynamic key) {
    return key.toString().startsWith('$_scope::');
  }

  static Future<Box<dynamic>> _openDraftsBox() {
    return HiveSecureBox.open<dynamic>(
      _draftsBoxName,
      legacyKey: _generateEncryptionKey(),
    );
  }

  static Future<Box<dynamic>> _drafts() async {
    final box = _draftsBox;
    if (box != null && box.isOpen) return box;
    _draftsBox = await _openDraftsBox();
    return _draftsBox!;
  }

  static Future<Box<dynamic>> _openSyncQueueBox() {
    return HiveSecureBox.open<dynamic>(
      _syncQueueBoxName,
      legacyKey: _generateEncryptionKey(),
    );
  }

  static Future<Box<dynamic>> _syncQueue() async {
    final box = _syncQueueBox;
    if (box != null && box.isOpen) return box;
    _syncQueueBox = await _openSyncQueueBox();
    return _syncQueueBox!;
  }

  static bool _isValidClientRequestId(String? value) {
    final token = value?.trim() ?? '';
    return RegExp(r'^[A-Za-z0-9]{8,28}$').hasMatch(token);
  }

  static String _clientRequestIdForSyncKey(String syncKey) {
    final digest = sha256.convert(utf8.encode(syncKey)).toString();
    return 'po${digest.substring(0, 22)}';
  }

  // ── Draft Orders ──

  /// Save current cart as a draft
  static Future<String> saveDraft({
    required String clientCode,
    required String clientName,
    required String saleType,
    required String vendedorCode,
    required List<OrderLine> lines,
    double globalDiscountPct = 0,
    String? draftKey,
  }) async {
    final box = await _drafts();
    final key = draftKey != null
        ? _ensureScopedKey(draftKey)
        : _scopedKey(
            'draft_${clientCode}_${DateTime.now().millisecondsSinceEpoch}');
    final data = {
      'scope': _scope,
      'clientCode': clientCode,
      'clientName': clientName,
      'saleType': saleType,
      'vendedorCode': vendedorCode,
      'globalDiscountPct': globalDiscountPct,
      'lines': lines.map((l) => l.toJson()).toList(),
      'savedAt': DateTime.now().toIso8601String(),
    };
    await box.put(key, jsonEncode(data));
    debugPrint('[PedidosOffline] Draft saved');
    _notifyChanged();
    return key;
  }

  /// Auto-save: Overwrites a single draft per client
  static Future<void> saveAutoDraft({
    required String clientCode,
    required String clientName,
    required String saleType,
    required String vendedorCode,
    required List<OrderLine> lines,
    double globalDiscountPct = 0,
  }) async {
    await saveDraft(
      draftKey: _scopedKey('draft_auto_$clientCode'),
      clientCode: clientCode,
      clientName: clientName,
      saleType: saleType,
      vendedorCode: vendedorCode,
      lines: lines,
      globalDiscountPct: globalDiscountPct,
    );
  }

  /// Load all saved drafts
  static List<Map<String, dynamic>> getDrafts() {
    final box = _draftsBox;
    if (box == null || box.isEmpty) return [];

    final drafts = <Map<String, dynamic>>[];
    for (final key in box.keys.where(_isCurrentScopeKey)) {
      try {
        final raw = box.get(key);
        if (raw is String) {
          final data = jsonDecode(raw) as Map<String, dynamic>;
          data['draftKey'] = key;
          drafts.add(data);
        }
      } catch (e) {
        debugPrint('[PedidosOffline] Error reading draft: $e');
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
    final box = await _drafts();
    await box.delete(key);
    _notifyChanged();
  }

  /// Get draft count
  static int get draftCount =>
      _draftsBox?.keys.where(_isCurrentScopeKey).length ?? 0;

  // ── Sync Queue (offline order confirmations) ──

  /// Queue a confirmed order for sync when back online
  static Future<String> queueOrderForSync({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    required String saleType,
    required List lines,
    String observaciones = '',
    String? deliveryDate,
    String? vehicleCode,
    String? driverCode,
    String? routeCode,
    String? clientRequestId,
    double globalDiscountPct = 0,
    bool notifyQueued = true,
  }) async {
    final box = await _syncQueue();
    final key = await _nextSyncKey(box);
    final lineJson = [];
    for (final line in lines) {
      lineJson.add((line as OrderLine).toJson());
    }
    final data = {
      "scope": _scope,
      "clientCode": clientCode,
      "clientName": clientName,
      "vendedorCode": vendedorCode,
      "saleType": saleType,
      "observaciones": observaciones,
      "globalDiscountPct": globalDiscountPct,
      "lines": lineJson,
      "deliveryDate": deliveryDate,
      "vehicleCode": vehicleCode,
      "driverCode": driverCode,
      "routeCode": routeCode,
      "clientRequestId": _isValidClientRequestId(clientRequestId)
          ? clientRequestId!.trim()
          : _clientRequestIdForSyncKey(key),
      "queuedAt": DateTime.now().toIso8601String(),
      "status": "pending",
      "attempts": 0,
    };
    await box.put(key, jsonEncode(data));
    debugPrint("[PedidosOffline] Order queued for sync");
    if (notifyQueued) {
      OfflineSyncNotifier.orderQueued(clientName: clientName);
    }
    _notifyChanged();
    return key;
  }

  static Future<void> deleteQueuedOrder(String syncKey) async {
    final box = await _syncQueue();
    await box.delete(syncKey);
    _notifyChanged();
  }

  static Future<void> markQueuedOrderFailed(
    String syncKey,
    Object error,
  ) async {
    final box = await _syncQueue();
    await _markSyncFailed(box, syncKey, error);
    _notifyChanged();
  }

  static void notifyQueuedOrder(String syncKey) {
    final box = _syncQueueBox;
    if (box == null || !box.containsKey(syncKey)) return;
    final data = _decodeSyncItem(box, syncKey);
    if (data == null) return;
    OfflineSyncNotifier.orderQueued(
      clientName: data["clientName"]?.toString() ?? "cliente",
    );
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
    final box = await _syncQueue();
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
    _notifyChanged();
    return true;
  }

  /// Sync pending orders with bounded batch size and explicit progress.
  static Future syncPendingOrdersWithResult({
    int maxBatchSize = _defaultMaxBatchSize,
    int maxConcurrency = _maxConcurrentSyncs,
    int yieldEvery = _defaultYieldEvery,
  }) async {
    final box = await _syncQueue();
    final pending = getPendingSyncs();
    final batchLimit = maxBatchSize.clamp(1, _maxBatchSize).toInt();
    final effectiveConcurrency =
        maxConcurrency.clamp(1, _maxConcurrentSyncs).toInt();
    final selected = pending.take(batchLimit).toList(growable: false);
    final failures = [];
    var transientFailures = 0;
    var processed = 0;
    var synced = 0;

    for (final item in selected) {
      final syncKey = item["syncKey"].toString();
      try {
        final prepared = await _prepareSyncItem(box, syncKey, item);
        var orderId = _asIntOrNull(prepared["serverOrderId"]);
        final saleType = prepared["saleType"] as String? ?? "CC";

        if (orderId == null) {
          final response = await _createOrder(
            clientCode: prepared["clientCode"].toString(),
            clientName: prepared["clientName"].toString(),
            vendedorCode: prepared["vendedorCode"].toString(),
            tipoVenta: saleType,
            lines: _decodeOrderLines(prepared["lines"]),
            observaciones: prepared["observaciones"]?.toString() ?? "",
            clientRequestId: prepared["clientRequestId"] as String?,
          );
          if (response is Map && response["queued"] == true) {
            throw StateError(
                "Pedido no confirmado por servidor; conservado para revision.");
          }
          orderId =
              _asIntOrNull((response as Map)["id"] ?? response["orderId"]);
          if (orderId == null) {
            throw StateError("Pedido sincronizado sin id de servidor.");
          }
          prepared["serverOrderId"] = orderId;
          await box.put(syncKey, jsonEncode(prepared));
        }

        final confirmResult = await _confirmOrder(
          orderId,
          saleType,
          deliveryDate: prepared["deliveryDate"] as String?,
          vehicleCode: prepared["vehicleCode"] as String?,
          driverCode: prepared["driverCode"] as String?,
          routeCode: prepared["routeCode"] as String?,
        );
        if (confirmResult["queued"] == true) {
          throw StateError(
              "Confirmacion no completada; pedido conservado para retry.");
        }
        await box.delete(syncKey);
        synced++;
      } catch (e) {
        final failure = await _markSyncAttemptFailed(box, syncKey, e);
        if (failure is Map && failure["transient"] == true) {
          transientFailures++;
        } else {
          failures.add(failure);
        }
      }
      processed++;
      if (yieldEvery == 0) {
      } else if (processed % yieldEvery == 0) {
        await Future.delayed(Duration.zero);
      }
    }

    final remainingPending = getPendingSyncs().length;
    final preservedFailures = getFailedSyncs().length;
    if (processed > 0 || synced > 0 || failures.isNotEmpty) {
      _notifyChanged();
    }
    return {
      "totalPendingAtStart": pending.length,
      "selectedForRun": selected.length,
      "processed": processed,
      "synced": synced,
      "failed": failures.length,
      "transientFailed": transientFailures,
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
    _notifyChanged();
  }

  @visibleForTesting
  static void debugSetCreateOrderForTesting(
      Future Function(
              {required String clientCode,
              required String clientName,
              required String vendedorCode,
              required String tipoVenta,
              required List lines,
              required String observaciones,
              required String? clientRequestId})
          createOrder) {
    _createOrder = createOrder;
  }

  @visibleForTesting
  static void debugResetCreateOrderForTesting() {
    _createOrder = _defaultCreateOrder;
  }

  @visibleForTesting
  static void debugSetConfirmOrderForTesting(
    Future<Map<String, dynamic>> Function(
      int orderId,
      String saleType, {
      String? deliveryDate,
      String? vehicleCode,
      String? driverCode,
      String? routeCode,
    }) confirmOrder,
  ) {
    _confirmOrder = confirmOrder;
  }

  @visibleForTesting
  static void debugResetConfirmOrderForTesting() {
    _confirmOrder = PedidosService.confirmOrder;
  }

  static Future _defaultCreateOrder({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    required String tipoVenta,
    required List lines,
    required String observaciones,
    required String? clientRequestId,
  }) {
    return PedidosService.createOrder(
      clientCode: clientCode,
      clientName: clientName,
      vendedorCode: vendedorCode,
      tipoVenta: tipoVenta,
      lines: lines.cast(),
      observaciones: observaciones,
      clientRequestId: clientRequestId,
    );
  }

  static Future _nextSyncKey(Box box) async {
    var key = _scopedKey("sync_${DateTime.now().microsecondsSinceEpoch}");
    while (box.containsKey(key)) {
      await Future.delayed(Duration.zero);
      key = _scopedKey("sync_${DateTime.now().microsecondsSinceEpoch}");
    }
    return key;
  }

  static List _getSyncsByStatus(String status) {
    final box = _syncQueueBox;
    if (box == null) return [];
    if (box.isEmpty) return [];

    final items = [];
    for (final key in box.keys.where(_isCurrentScopeKey)) {
      try {
        final data = _decodeSyncItem(box, key.toString());
        if (data == null) {
        } else if (data["scope"] == _scope && data["status"] == status) {
          data["syncKey"] = key;
          items.add(data);
        }
      } catch (e) {
        debugPrint("[PedidosOffline] Error reading sync item: $e");
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
    if (!_isValidClientRequestId(existingRequestId)) {
      data["clientRequestId"] = _clientRequestIdForSyncKey(syncKey);
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

  static bool _isTransientSyncError(Object error) {
    if (error is ApiException) {
      final status = error.statusCode ?? 0;
      return status == 0 || status == 408 || status == 429 || status >= 500;
    }
    final text = error.toString().toLowerCase();
    return text.contains("connection") ||
        text.contains("timeout") ||
        text.contains("socket") ||
        text.contains("offline") ||
        text.contains("network");
  }

  static Future _markSyncAttemptFailed(
    Box box,
    String syncKey,
    Object error,
  ) async {
    final data = _decodeSyncItem(box, syncKey) ?? {};
    final attempts = _asInt(data["attempts"]) + 1;
    if (_isTransientSyncError(error) && attempts < _maxTransientAttempts) {
      data["status"] = "pending";
      data["attempts"] = attempts;
      data["lastTransientError"] = error.toString();
      data["lastAttemptAt"] = DateTime.now().toIso8601String();
      if (!_isValidClientRequestId(data["clientRequestId"]?.toString())) {
        data["clientRequestId"] = _clientRequestIdForSyncKey(syncKey);
      }
      await box.put(syncKey, jsonEncode(data));
      debugPrint("[PedidosOffline] Transient sync error; kept pending: $error");
      return {
        "syncKey": syncKey,
        "clientRequestId": data["clientRequestId"],
        "error": error.toString(),
        "attempts": attempts,
        "transient": true,
      };
    }
    return _markSyncFailed(box, syncKey, error, attempts: attempts);
  }

  static Future _markSyncFailed(
    Box box,
    String syncKey,
    Object error, {
    int? attempts,
  }) async {
    final data = _decodeSyncItem(box, syncKey) ?? {};
    final nextAttempts = attempts ?? _asInt(data["attempts"]) + 1;
    data["status"] = "failed";
    data["attempts"] = nextAttempts;
    data["error"] = error.toString();
    data["failedAt"] = DateTime.now().toIso8601String();
    if (!_isValidClientRequestId(data["clientRequestId"]?.toString())) {
      data["clientRequestId"] = _clientRequestIdForSyncKey(syncKey);
    }
    await box.put(syncKey, jsonEncode(data));
    debugPrint("[PedidosOffline] Sync failed: $error");
    return {
      "syncKey": syncKey,
      "clientRequestId": data["clientRequestId"],
      "error": error.toString(),
      "attempts": nextAttempts,
    };
  }

  static int _asInt(Object? value) {
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? "") ?? 0;
  }

  static int? _asIntOrNull(Object? value) {
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? "");
  }

  static void _notifyChanged() {
    final callback = onChanged;
    if (callback == null) return;
    unawaited(callback());
  }
}
