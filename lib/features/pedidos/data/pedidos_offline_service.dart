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
import 'package:gmp_app_mobilidad/core/offline/sync_mutation_policy.dart';
import 'package:gmp_app_mobilidad/core/storage/hive_secure_box.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:hive_flutter/hive_flutter.dart';

class PedidosOfflineService {
  static const _draftsBoxName = 'pedidos_drafts';
  static const _syncQueueBoxName = 'pedidos_sync_queue';
  static const _defaultMaxBatchSize = 25;
  static const _maxBatchSize = 50;
  static const _defaultMaxConcurrentSyncs = 1;
  static const _maxConcurrentSyncs = 3;
  static const _defaultYieldEvery = 5;
  static const _maxTransientAttempts = 8;
  static const String _anonymousScope = 'anon';

  static Box<dynamic>? _draftsBox;
  static Box<dynamic>? _syncQueueBox;
  static String _scope = _anonymousScope;
  static final Map<String, Future<Map<String, dynamic>>> _activeSyncsByScope =
      {};
  static DateTime Function() _now = DateTime.now;
  static int Function() _authEpoch = _defaultAuthEpoch;
  static bool _bindRequestsToApiAuthEpoch = true;
  static int _syncKeySequence = 0;
  static final Map<String, Future<void>> _thresholdTriggersInFlight = {};

  /// Bridge hook used to wake the durable queue when a persisted deadline is
  /// reached. The scope is opaque and never contains the account identifier.
  static void Function(String scope, DateTime retryAt)? onRetryScheduled;
  static Future<void> Function(String scope, String vendedorCode)?
      onAutoSyncThresholdReached;
  static void Function(String scope)? onScopeActivated;

  static Future Function({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    required String tipoVenta,
    required List lines,
    required String observaciones,
    required String? clientRequestId,
    double descuentoGlobal,
  }) _createOrder = _defaultCreateOrder;
  static Future<Map<String, dynamic>> Function(
    int orderId,
    String saleType, {
    String? deliveryDate,
    String? vehicleCode,
    String? driverCode,
    String? routeCode,
    bool cobroPropio,
  }) _confirmOrder = PedidosService.confirmOrder;

  static Future<void> Function()? onChanged;

  /// Initialize Hive boxes
  static Future<void> init() async {
    _draftsBox = await _openDraftsBox();
    _syncQueueBox = await _openSyncQueueBox();
    onScopeActivated?.call(_scope);
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
    onScopeActivated?.call(_scope);
  }

  static void clearScope() {
    _scope = _anonymousScope;
    onScopeActivated?.call(_scope);
  }

  /// Opaque current queue scope for single-flight orchestration.
  static String get currentScopeId => _scope;

  static String _scopedKey(String key) => '$_scope::$key';

  static String _scopedKeyFor(String scope, String key) => '$scope::$key';

  static String _ensureScopedKey(String key) {
    if (_isCurrentScopeKey(key)) return key;
    final unscoped = key.contains('::') ? key.split('::').last : key;
    return _scopedKey(unscoped);
  }

  static bool _isCurrentScopeKey(dynamic key) {
    return _isScopeKey(key, _scope);
  }

  static bool _isScopeKey(dynamic key, String scope) =>
      key.toString().startsWith('$scope::');

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
            'draft_${clientCode}_${DateTime.now().millisecondsSinceEpoch}',
          );
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
    bool cobroPropio = false,
    bool notifyQueued = true,
  }) async {
    final capturedScope = _scope;
    final box = await _syncQueue();
    final key = _nextSyncKey(box, capturedScope);
    final lineJson = [];
    for (final line in lines) {
      lineJson.add((line as OrderLine).toJson());
    }
    final data = {
      'scope': capturedScope,
      'clientCode': clientCode,
      'clientName': clientName,
      'vendedorCode': vendedorCode,
      'saleType': saleType,
      'observaciones': observaciones,
      'globalDiscountPct': globalDiscountPct,
      'cobroPropio': cobroPropio,
      'lines': lineJson,
      'deliveryDate': deliveryDate,
      'vehicleCode': vehicleCode,
      'driverCode': driverCode,
      'routeCode': routeCode,
      'clientRequestId': _isValidClientRequestId(clientRequestId)
          ? clientRequestId!.trim()
          : _clientRequestIdForSyncKey(key),
      'queuedAt': _now().toIso8601String(),
      'status': 'pending',
      'attempts': 0,
    };
    await box.put(key, jsonEncode(data));
    debugPrint('[PedidosOffline] Order queued for sync');
    if (notifyQueued) {
      OfflineSyncNotifier.orderQueued(clientName: clientName);
    }
    _notifyChanged();
    _triggerAutoSyncThresholdIfReached(capturedScope, vendedorCode);
    return key;
  }

  static Future<void> deleteQueuedOrder(String syncKey) async {
    final capturedScope = _scope;
    final box = await _syncQueue();
    if (!_isScopeKey(syncKey, capturedScope)) return;
    await box.delete(syncKey);
    _notifyChanged();
  }

  static Future<void> markQueuedOrderFailed(
    String syncKey,
    Object error,
  ) async {
    final capturedScope = _scope;
    final box = await _syncQueue();
    await _markSyncFailed(box, syncKey, capturedScope, error);
    _notifyChanged();
  }

  static void notifyQueuedOrder(String syncKey) {
    final box = _syncQueueBox;
    if (box == null || !box.containsKey(syncKey)) return;
    if (!_isCurrentScopeKey(syncKey)) return;
    final data = _decodeSyncItem(box, syncKey);
    if (data == null) return;
    OfflineSyncNotifier.orderQueued(
      clientName: data['clientName']?.toString() ?? 'cliente',
    );
  }

  /// Get all pending sync items in stable queue order.
  static List getPendingSyncs() {
    return _getSyncsByStatus('pending');
  }

  /// Get failed sync items preserved for manual review or retry.
  static List getFailedSyncs() {
    return _getSyncsByStatus('failed');
  }

  /// Mark a failed queued order as pending for the next bounded retry.
  static Future retryFailedSync(String syncKey) async {
    final capturedScope = _scope;
    final box = await _syncQueue();
    final data = _decodeScopedSyncItem(box, syncKey, capturedScope);
    if (data == null) return false;
    if (data['status'] == 'failed') {
      data['status'] = 'pending';
    } else {
      return false;
    }
    data
      ..['attempts'] = 0
      ..remove('error')
      ..remove('failedAt')
      ..remove('nextRetryAt')
      ..remove('lastTransientError')
      ..remove('lastAttemptAt')
      ..remove('lastSyncStartedAt');
    await box.put(syncKey, jsonEncode(data));
    _notifyChanged();
    return true;
  }

  /// Sync pending orders with bounded batch size and explicit progress.
  ///
  /// Product calls are FIFO by default. Calls for the same captured account
  /// share one in-flight operation so connectivity/resume/manual triggers cannot
  /// upload the same order concurrently.
  static Future<Map<String, dynamic>> syncPendingOrdersWithResult({
    int maxBatchSize = _defaultMaxBatchSize,
    int maxConcurrency = _defaultMaxConcurrentSyncs,
    int yieldEvery = _defaultYieldEvery,
  }) {
    final capturedScope = _scope;
    final capturedAuthEpoch = _authEpoch();
    final active = _activeSyncsByScope[capturedScope];
    if (active != null) return active;

    late final Future<Map<String, dynamic>> operation;
    operation = _syncPendingOrdersForScope(
      capturedScope,
      capturedAuthEpoch: capturedAuthEpoch,
      maxBatchSize: maxBatchSize,
      maxConcurrency: maxConcurrency,
      yieldEvery: yieldEvery,
    ).whenComplete(() {
      if (identical(_activeSyncsByScope[capturedScope], operation)) {
        _activeSyncsByScope.remove(capturedScope);
      }
    });
    _activeSyncsByScope[capturedScope] = operation;
    return operation;
  }

  static Future<Map<String, dynamic>> _syncPendingOrdersForScope(
    String capturedScope, {
    required int capturedAuthEpoch,
    required int maxBatchSize,
    required int maxConcurrency,
    required int yieldEvery,
  }) async {
    final box = await _syncQueue();
    final pending = _getSyncsByStatusForScope('pending', capturedScope);
    final now = _now();
    final eligible = pending
        .where((item) => _isRetryDue(item as Map, now))
        .toList(growable: false);
    final batchLimit = maxBatchSize.clamp(1, _maxBatchSize);
    final effectiveConcurrency = maxConcurrency.clamp(1, _maxConcurrentSyncs);
    final selected = eligible.take(batchLimit).toList(growable: false);
    final failures = <dynamic>[];
    var transientFailures = 0;
    var processed = 0;
    var synced = 0;
    var identityDeferred = 0;
    var nextIndex = 0;

    Future<void> processOne(Map item) async {
      final syncKey = item['syncKey'].toString();
      try {
        final prepared = await _prepareSyncItem(box, syncKey, capturedScope);
        var orderId = _asIntOrNull(prepared['serverOrderId']);
        final saleType = prepared['saleType'] as String? ?? 'CC';

        if (orderId == null) {
          _ensureMutationIdentity(capturedScope, capturedAuthEpoch);
          final response = await _runForCapturedAuthEpoch(
            capturedAuthEpoch,
            () => _createOrder(
              clientCode: prepared['clientCode'].toString(),
              clientName: prepared['clientName'].toString(),
              vendedorCode: prepared['vendedorCode'].toString(),
              tipoVenta: saleType,
              lines: _decodeOrderLines(prepared['lines']),
              observaciones: prepared['observaciones']?.toString() ?? '',
              clientRequestId: prepared['clientRequestId'] as String?,
              descuentoGlobal:
                  (prepared['globalDiscountPct'] as num?)?.toDouble() ?? 0,
            ),
          );
          if (response is Map && response['queued'] == true) {
            throw StateError(
              'Pedido no confirmado por servidor; conservado para revision.',
            );
          }
          orderId =
              _asIntOrNull((response as Map)['id'] ?? response['orderId']);
          if (orderId == null) {
            throw StateError('Pedido sincronizado sin id de servidor.');
          }
          prepared['serverOrderId'] = orderId;
          final preserved = await _putScopedSyncItem(
            box,
            syncKey,
            capturedScope,
            prepared,
          );
          if (!preserved) {
            throw StateError(
              'Pedido offline retirado durante la sincronizacion.',
            );
          }
        }

        _ensureMutationIdentity(capturedScope, capturedAuthEpoch);
        final confirmResult = await _runForCapturedAuthEpoch(
          capturedAuthEpoch,
          () => _confirmOrder(
            orderId!,
            saleType,
            deliveryDate: prepared['deliveryDate'] as String?,
            vehicleCode: prepared['vehicleCode'] as String?,
            driverCode: prepared['driverCode'] as String?,
            routeCode: prepared['routeCode'] as String?,
            cobroPropio: prepared['cobroPropio'] == true,
          ),
        );
        if (confirmResult['queued'] == true ||
            confirmResult['blocked'] == true ||
            (confirmResult.containsKey('success') &&
                confirmResult['success'] != true)) {
          final reason = confirmResult['message'] ??
              confirmResult['reason'] ??
              confirmResult['code'] ??
              'El servidor rechazo la confirmacion.';
          throw _ServerBlockedSyncException(reason.toString());
        }
        _ensureMutationIdentity(capturedScope, capturedAuthEpoch);
        if (_decodeScopedSyncItem(box, syncKey, capturedScope) != null) {
          await box.delete(syncKey);
        }
        synced++;
      } on _SyncIdentityChanged catch (e) {
        await _deferForIdentityChange(
          box,
          syncKey,
          capturedScope,
          e,
        );
        identityDeferred++;
      } catch (e) {
        final failure = await _markSyncAttemptFailed(
          box,
          syncKey,
          capturedScope,
          e,
        );
        if (failure is Map && failure['transient'] == true) {
          transientFailures++;
        } else {
          failures.add(failure);
        }
      }
      processed++;
      if (yieldEvery > 0 && processed % yieldEvery == 0) {
        await Future<void>.delayed(Duration.zero);
      }
    }

    Future<void> worker() async {
      while (true) {
        // Take next index before any await (single-threaded claim).
        if (nextIndex >= selected.length) return;
        final claim = nextIndex;
        nextIndex = claim + 1;
        await processOne(selected[claim] as Map);
      }
    }

    final workers =
        selected.isEmpty ? 0 : effectiveConcurrency.clamp(1, selected.length);
    if (selected.isNotEmpty) {
      await Future.wait(
        List.generate(workers, (_) => worker()),
      );
    }

    final remainingPending =
        _getSyncsByStatusForScope('pending', capturedScope).length;
    final preservedFailures =
        _getSyncsByStatusForScope('failed', capturedScope).length;
    final nextRetryAt = earliestRetryAtForScope(capturedScope);
    if (processed > 0 || synced > 0 || failures.isNotEmpty) {
      _notifyChanged();
    }
    return {
      'totalPendingAtStart': pending.length,
      'selectedForRun': selected.length,
      'deferredByBackoff': pending.length - eligible.length,
      'processed': processed,
      'synced': synced,
      'failed': failures.length,
      'transientFailed': transientFailures,
      'identityDeferred': identityDeferred,
      'remainingPending': remainingPending,
      'preservedFailures': preservedFailures,
      'batchLimit': batchLimit,
      'maxConcurrency': effectiveConcurrency,
      'isBackpressured': remainingPending == 0 ? false : true,
      'nextRetryAt': nextRetryAt?.toIso8601String(),
      'failures': failures,
    };
  }

  /// Sync all pending orders to the server, preserving the legacy count API.
  static Future<int> syncPendingOrders() async {
    final result = await syncPendingOrdersWithResult();
    return result['synced'] as int;
  }

  /// Get count of pending syncs
  static int get pendingSyncCount {
    return getPendingSyncs().length;
  }

  /// Stores the ERP auto-sync threshold for this account and seller.
  static Future<void> configureAutoSyncThreshold({
    required String vendedorCode,
    required int threshold,
  }) async {
    final capturedScope = _scope;
    final vendor = _normalizeVendorCode(vendedorCode);
    if (vendor.isEmpty) return;
    final box = await _syncQueue();
    final key = _thresholdConfigKey(capturedScope, vendor);
    if (threshold <= 0) {
      await box.delete(key);
      return;
    }
    await box.put(
      key,
      jsonEncode({
        'kind': 'autoSyncThreshold',
        'scope': capturedScope,
        'vendedorCode': vendor,
        'threshold': threshold,
        'updatedAt': _now().toIso8601String(),
      }),
    );
    _triggerAutoSyncThresholdIfReached(capturedScope, vendor);
  }

  /// Earliest durable retry deadline for an opaque queue scope.
  static DateTime? earliestRetryAtForScope(String scope) {
    DateTime? earliest;
    for (final item in _getSyncsByStatusForScope('pending', scope)) {
      final raw = (item as Map)['nextRetryAt']?.toString();
      final candidate = raw == null ? null : DateTime.tryParse(raw);
      if (candidate == null) continue;
      if (earliest == null || candidate.isBefore(earliest)) {
        earliest = candidate;
      }
    }
    return earliest;
  }

  /// Clear all data (for testing)
  static Future<void> clearAll() async {
    await _draftsBox?.clear();
    await _syncQueueBox?.clear();
    _thresholdTriggersInFlight.clear();
    _notifyChanged();
  }

  /// Overrides wall-clock reads so retry deadlines are deterministic in tests.
  @visibleForTesting
  static void debugSetClockForTesting(DateTime Function() clock) {
    _now = clock;
  }

  /// Restores the system wall clock after a test override.
  @visibleForTesting
  static void debugResetClockForTesting() {
    _now = DateTime.now;
  }

  @visibleForTesting
  static void debugSetAuthEpochForTesting(int Function() epoch) {
    _authEpoch = epoch;
    _bindRequestsToApiAuthEpoch = false;
  }

  @visibleForTesting
  static void debugResetAuthEpochForTesting() {
    _authEpoch = _defaultAuthEpoch;
    _bindRequestsToApiAuthEpoch = true;
  }

  @visibleForTesting
  static void debugSetCreateOrderForTesting(
    Future Function({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal,
    }) createOrder,
  ) {
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
      bool cobroPropio,
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
    double descuentoGlobal = 0,
  }) {
    return PedidosService.createOrder(
      clientCode: clientCode,
      clientName: clientName,
      vendedorCode: vendedorCode,
      tipoVenta: tipoVenta,
      lines: lines.cast(),
      observaciones: observaciones,
      clientRequestId: clientRequestId,
      descuentoGlobal: descuentoGlobal,
    );
  }

  static int _defaultAuthEpoch() => ApiClient.authMutationEpoch;

  static Future<T> _runForCapturedAuthEpoch<T>(
    int capturedAuthEpoch,
    Future<T> Function() action,
  ) async {
    try {
      if (!_bindRequestsToApiAuthEpoch) return await action();
      return await ApiClient.runForAuthEpoch(capturedAuthEpoch, action);
    } on ApiException catch (error) {
      if (error.code == 'AUTH_CONTEXT_CHANGED') {
        throw const _SyncIdentityChanged();
      }
      rethrow;
    }
  }

  static void _ensureMutationIdentity(
    String capturedScope,
    int capturedAuthEpoch,
  ) {
    if (_scope != capturedScope || _authEpoch() != capturedAuthEpoch) {
      throw const _SyncIdentityChanged();
    }
  }

  static String _nextSyncKey(Box box, String scope) {
    final timestamp = _now().microsecondsSinceEpoch;
    var key = _scopedKeyFor(scope, 'sync_${timestamp}_${_syncKeySequence++}');
    while (box.containsKey(key)) {
      key = _scopedKeyFor(scope, 'sync_${timestamp}_${_syncKeySequence++}');
    }
    return key;
  }

  static String _normalizeVendorCode(String value) =>
      value.trim().toUpperCase();

  static String _thresholdConfigKey(String scope, String vendedorCode) =>
      _scopedKeyFor(scope, 'config_threshold_$vendedorCode');

  static int _configuredThreshold(String scope, String vendedorCode) {
    final box = _syncQueueBox;
    if (box == null) return 0;
    final data = _decodeSyncItem(
      box,
      _thresholdConfigKey(scope, vendedorCode),
    );
    if (data == null || data['kind'] != 'autoSyncThreshold') return 0;
    return _asInt(data['threshold']);
  }

  static void _triggerAutoSyncThresholdIfReached(
    String scope,
    String rawVendedorCode,
  ) {
    final callback = onAutoSyncThresholdReached;
    if (callback == null || scope != _scope) return;
    final vendedorCode = _normalizeVendorCode(rawVendedorCode);
    final threshold = _configuredThreshold(scope, vendedorCode);
    if (threshold <= 0) return;
    final pendingForVendor = _getSyncsByStatusForScope('pending', scope)
        .where(
          (item) =>
              _normalizeVendorCode(
                (item as Map)['vendedorCode']?.toString() ?? '',
              ) ==
              vendedorCode,
        )
        .length;
    if (pendingForVendor < threshold) return;

    final triggerKey = '$scope::$vendedorCode';
    if (_thresholdTriggersInFlight.containsKey(triggerKey)) return;
    late final Future<void> operation;
    operation = () async {
      try {
        await callback(scope, vendedorCode);
      } catch (error) {
        debugPrint(
          '[PedidosOffline] Automatic threshold sync could not start: $error',
        );
      } finally {
        if (identical(_thresholdTriggersInFlight[triggerKey], operation)) {
          final _ = _thresholdTriggersInFlight.remove(triggerKey);
        }
      }
    }();
    _thresholdTriggersInFlight[triggerKey] = operation;
    unawaited(operation);
  }

  static List _getSyncsByStatus(String status) {
    return _getSyncsByStatusForScope(status, _scope);
  }

  static List _getSyncsByStatusForScope(String status, String scope) {
    final box = _syncQueueBox;
    if (box == null) return [];
    if (box.isEmpty) return [];

    final items = [];
    for (final key in box.keys.where((key) => _isScopeKey(key, scope))) {
      try {
        final data = _decodeSyncItem(box, key.toString());
        if (data == null) {
        } else if (data['scope'] == scope && data['status'] == status) {
          data['syncKey'] = key;
          items.add(data);
        }
      } catch (e) {
        debugPrint('[PedidosOffline] Error reading sync item: $e');
      }
    }
    items.sort((a, b) {
      final byQueuedAt = (a['queuedAt']?.toString() ?? '')
          .compareTo(b['queuedAt']?.toString() ?? '');
      if (byQueuedAt == 0) {
        return a['syncKey'].toString().compareTo(b['syncKey'].toString());
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

  static Map? _decodeScopedSyncItem(
    Box box,
    String syncKey,
    String scope,
  ) {
    if (!_isScopeKey(syncKey, scope)) return null;
    final data = _decodeSyncItem(box, syncKey);
    if (data == null || data['scope'] != scope) return null;
    return data;
  }

  static bool _isRetryDue(Map item, DateTime now) {
    final raw = item['nextRetryAt']?.toString();
    if (raw == null || raw.isEmpty) return true;
    final nextRetryAt = DateTime.tryParse(raw);
    return nextRetryAt == null || !now.isBefore(nextRetryAt);
  }

  static Future<bool> _putScopedSyncItem(
    Box box,
    String syncKey,
    String scope,
    Map data,
  ) async {
    if (_decodeScopedSyncItem(box, syncKey, scope) == null) return false;
    await box.put(syncKey, jsonEncode(data));
    return true;
  }

  static Future<Map<String, dynamic>> _prepareSyncItem(
    Box box,
    String syncKey,
    String scope,
  ) async {
    final current = _decodeScopedSyncItem(box, syncKey, scope);
    if (current == null) {
      throw StateError('Pedido offline no disponible para esta cuenta.');
    }
    final data = Map.from(current);
    data.remove('syncKey');
    final existingRequestId = data['clientRequestId']?.toString().trim();
    if (!_isValidClientRequestId(existingRequestId)) {
      data['clientRequestId'] = _clientRequestIdForSyncKey(syncKey);
    }
    data['status'] = 'pending';
    data['attempts'] = _asInt(data['attempts']);
    data['lastSyncStartedAt'] = _now().toIso8601String();
    data.remove('nextRetryAt');
    await box.put(syncKey, jsonEncode(data));
    return Map<String, dynamic>.from(data);
  }

  static List _decodeOrderLines(Object? rawLines) {
    if (rawLines is List) {
      final lines = [];
      for (final line in rawLines) {
        lines.add(OrderLine.fromJson((line as Map).cast()));
      }
      return lines;
    }
    throw const FormatException('Pedido offline sin lineas validas.');
  }

  static bool _isTransientSyncError(Object error) {
    if (error is ApiException) {
      final status = error.statusCode ?? 0;
      return status == 0 || status == 408 || status == 429 || status >= 500;
    }
    final text = error.toString().toLowerCase();
    return text.contains('connection') ||
        text.contains('timeout') ||
        text.contains('socket') ||
        text.contains('offline') ||
        text.contains('network');
  }

  static Future _markSyncAttemptFailed(
    Box box,
    String syncKey,
    String scope,
    Object error,
  ) async {
    final data = _decodeScopedSyncItem(box, syncKey, scope);
    if (data == null) {
      return {
        'syncKey': syncKey,
        'error': error.toString(),
        'attempts': 0,
        'preserved': false,
      };
    }
    final attempts = _asInt(data['attempts']) + 1;
    if (_isTransientSyncError(error) && attempts < _maxTransientAttempts) {
      final attemptedAt = _now();
      data['status'] = 'pending';
      data['attempts'] = attempts;
      data['lastTransientError'] = error.toString();
      data['lastAttemptAt'] = attemptedAt.toIso8601String();
      data['nextRetryAt'] = attemptedAt
          .add(SyncMutationPolicy.calculateBackoff(attempts))
          .toIso8601String();
      final nextRetryAt = DateTime.parse(data['nextRetryAt'].toString());
      if (!_isValidClientRequestId(data['clientRequestId']?.toString())) {
        data['clientRequestId'] = _clientRequestIdForSyncKey(syncKey);
      }
      await box.put(syncKey, jsonEncode(data));
      onRetryScheduled?.call(scope, nextRetryAt);
      debugPrint('[PedidosOffline] Transient sync error; kept pending: $error');
      return {
        'syncKey': syncKey,
        'clientRequestId': data['clientRequestId'],
        'error': error.toString(),
        'attempts': attempts,
        'transient': true,
      };
    }
    return _markSyncFailed(
      box,
      syncKey,
      scope,
      error,
      attempts: attempts,
    );
  }

  static Future _markSyncFailed(
    Box box,
    String syncKey,
    String scope,
    Object error, {
    int? attempts,
  }) async {
    final data = _decodeScopedSyncItem(box, syncKey, scope);
    if (data == null) {
      return {
        'syncKey': syncKey,
        'error': error.toString(),
        'attempts': attempts ?? 0,
        'preserved': false,
      };
    }
    final nextAttempts = attempts ?? _asInt(data['attempts']) + 1;
    data['status'] = 'failed';
    data['attempts'] = nextAttempts;
    data['error'] = error.toString();
    data['failedAt'] = _now().toIso8601String();
    data.remove('nextRetryAt');
    if (!_isValidClientRequestId(data['clientRequestId']?.toString())) {
      data['clientRequestId'] = _clientRequestIdForSyncKey(syncKey);
    }
    await box.put(syncKey, jsonEncode(data));
    debugPrint('[PedidosOffline] Sync failed: $error');
    return {
      'syncKey': syncKey,
      'clientRequestId': data['clientRequestId'],
      'error': error.toString(),
      'attempts': nextAttempts,
    };
  }

  static Future<void> _deferForIdentityChange(
    Box box,
    String syncKey,
    String scope,
    Object error,
  ) async {
    final data = _decodeScopedSyncItem(box, syncKey, scope);
    if (data == null) return;
    data['status'] = 'pending';
    data['lastTransientError'] = error.toString();
    data['identityDeferredAt'] = _now().toIso8601String();
    data.remove('nextRetryAt');
    await box.put(syncKey, jsonEncode(data));
  }

  static int _asInt(Object? value) {
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  static int? _asIntOrNull(Object? value) {
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? '');
  }

  static void _notifyChanged() {
    final callback = onChanged;
    if (callback == null) return;
    unawaited(callback());
  }
}

class _SyncIdentityChanged implements Exception {
  const _SyncIdentityChanged();

  @override
  String toString() =>
      'La cuenta cambio durante la sincronizacion; pedido aplazado de forma segura.';
}

class _ServerBlockedSyncException implements Exception {
  const _ServerBlockedSyncException(this.reason);

  final String reason;

  @override
  String toString() => 'Pedido bloqueado por el servidor: $reason';
}
