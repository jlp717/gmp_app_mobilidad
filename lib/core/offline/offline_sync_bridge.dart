import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_sync_notifier.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_offline.dart';

/// Unified reconnect sync: SyncQueue (deliveries/cobros/…) + Pedidos queue.
class OfflineSyncRunResult {
  const OfflineSyncRunResult({
    required this.queueSynced,
    required this.queueFailed,
    required this.queuePending,
    required this.pedidosSynced,
    required this.pedidosFailed,
    required this.pedidosPending,
  });

  final int queueSynced;
  final int queueFailed;
  final int queuePending;
  final int pedidosSynced;
  final int pedidosFailed;
  final int pedidosPending;

  int get totalSynced => queueSynced + pedidosSynced;
  int get totalFailed => queueFailed + pedidosFailed;
  int get totalPending => queuePending + pedidosPending;
}

/// Live progress for sync UI (avoids frozen progress bars during long drains).
class OfflineSyncProgress {
  const OfflineSyncProgress({
    required this.phase,
    required this.message,
    this.fraction,
  });

  /// `queue` | `pedidos` | `maintenance` | `done`
  final String phase;
  final String message;
  final double? fraction;
}

class OfflineSyncBridge {
  OfflineSyncBridge._();

  static bool _inProgress = false;
  static String? _activeScope;
  static final Set<String> _queuedRerunScopes = <String>{};
  static final Map<String, Timer> _retryTimersByScope = <String, Timer>{};
  static final Map<String, DateTime> _retryDeadlinesByScope =
      <String, DateTime>{};
  static DateTime Function() _now = DateTime.now;
  static FutureOr<bool> Function()? _canAutoSync;
  static Completer<void> _idleCompleter = Completer<void>()..complete();

  @visibleForTesting
  static Future<void> Function()? retryRunnerOverride;

  /// Bumped during [syncAll] so headers/modals can animate instead of freezing.
  static final ValueNotifier<OfflineSyncProgress?> progress =
      ValueNotifier<OfflineSyncProgress?>(null);

  static void _setProgress(OfflineSyncProgress? value) {
    progress.value = value;
  }

  /// Installs durable pedidos hooks once during application bootstrap.
  static void bindPedidosQueueHooks({
    FutureOr<bool> Function()? canAutoSync,
  }) {
    _canAutoSync = canAutoSync;
    PedidosOfflineService.onRetryScheduled = _schedulePedidoRetry;
    PedidosOfflineService.onScopeActivated = _activatePedidosScope;
    PedidosOfflineService.onAutoSyncThresholdReached =
        _runThresholdSyncForScope;
    _activatePedidosScope(PedidosOfflineService.currentScopeId);
  }

  static Future<void> _runThresholdSyncForScope(
    String scope,
    String _,
  ) async {
    if (PedidosOfflineService.currentScopeId != scope) return;
    final gate = _canAutoSync;
    if (gate != null && !await gate()) return;
    await syncAll(notify: true);
  }

  /// Process both offline queues. Safe to call on every online transition.
  ///
  /// PERF: SyncQueue (entregas/cobros) and Pedidos queue are independent —
  /// run them in parallel so wall-clock ≈ max(queue, pedidos) instead of sum.
  static Future<OfflineSyncRunResult> syncAll({
    bool notify = true,
  }) async {
    final runScope = PedidosOfflineService.currentScopeId;
    PedidosOfflineService.onRetryScheduled = _schedulePedidoRetry;
    if (_inProgress) {
      // The active drain works from a bounded snapshot. Queue one follow-up
      // even for the same account so an order added during that snapshot is
      // never stranded below the automatic threshold.
      _queuedRerunScopes.add(runScope);
      return OfflineSyncRunResult(
        queueSynced: 0,
        queueFailed: SyncQueueService.instance.failedCount,
        queuePending: SyncQueueService.instance.pendingCount,
        pedidosSynced: 0,
        pedidosFailed: PedidosOfflineService.getFailedSyncs().length,
        pedidosPending: PedidosOfflineService.pendingSyncCount,
      );
    }

    _inProgress = true;
    _activeScope = runScope;
    if (_idleCompleter.isCompleted) _idleCompleter = Completer<void>();
    _setProgress(
      const OfflineSyncProgress(
        phase: 'queue',
        message: 'Sincronizando pendientes…',
        fraction: 0.05,
      ),
    );
    try {
      late final SyncProcessResult queue;
      late final Map<String, dynamic> pedidosMap;

      await Future.wait<void>([
        () async {
          queue = await SyncQueueService.instance.processAllWithResult(
            onProgress: (done, total) {
              if (total <= 0) return;
              final fraction = 0.1 + (0.55 * (done / total));
              _setProgress(
                OfflineSyncProgress(
                  phase: 'queue',
                  message: 'Enviando entregas y cobros ($done/$total)…',
                  fraction: fraction.clamp(0.1, 0.65),
                ),
              );
            },
          );
        }(),
        () async {
          _setProgress(
            const OfflineSyncProgress(
              phase: 'pedidos',
              message: 'Enviando pedidos offline…',
              fraction: 0.25,
            ),
          );
          await PedidosOfflineService.init();
          pedidosMap =
              await PedidosOfflineService.syncPendingOrdersWithResult();
        }(),
      ]);

      final pedidosSynced = pedidosMap['synced'] as int? ?? 0;
      final pedidosFailed = pedidosMap['failed'] as int? ?? 0;
      final pedidosPending = pedidosMap['remainingPending'] as int? ??
          PedidosOfflineService.pendingSyncCount;
      if (pedidosMap['postSyncRefreshFailed'] == true) {
        OfflineSyncNotifier.orderPostSyncRefreshFailed();
      }
      final nextRetryAt =
          DateTime.tryParse(pedidosMap['nextRetryAt']?.toString() ?? '');
      if (nextRetryAt != null) {
        _schedulePedidoRetry(runScope, nextRetryAt);
      } else {
        _retryTimersByScope.remove(runScope)?.cancel();
        _retryDeadlinesByScope.remove(runScope);
      }

      final result = OfflineSyncRunResult(
        queueSynced: queue.synced,
        queueFailed: queue.failed,
        queuePending: queue.pending,
        pedidosSynced: pedidosSynced,
        pedidosFailed: pedidosFailed,
        pedidosPending: pedidosPending,
      );

      // EARS-5: after every drain, stale evidence inbox records escalate
      // manualReview and their bytes are dropped. Never blocks the run.
      _setProgress(
        const OfflineSyncProgress(
          phase: 'maintenance',
          message: 'Limpiando evidencias…',
          fraction: 0.9,
        ),
      );
      await runRepartoEvidenceInboxMaintenance();

      if (notify) {
        OfflineSyncNotifier.reportSyncRun(
          queueSynced: result.queueSynced,
          queueFailed: result.queueFailed,
          queuePending: result.queuePending,
          pedidosSynced: result.pedidosSynced,
          pedidosFailed: result.pedidosFailed,
          pedidosPending: result.pedidosPending,
        );
      } else {
        OfflineSyncNotifier.refreshCounts(
          pending: result.totalPending,
          failed: result.totalFailed,
        );
      }

      debugPrint(
        '[OfflineSyncBridge] queue=${queue.synced}/${queue.failed} '
        'pedidos=$pedidosSynced/$pedidosFailed (parallel)',
      );
      _setProgress(
        const OfflineSyncProgress(
          phase: 'done',
          message: 'Sync listo',
          fraction: 1,
        ),
      );
      return result;
    } finally {
      _inProgress = false;
      _activeScope = null;
      // Clear after a beat so listeners can show "done" briefly.
      unawaited(
        Future<void>.delayed(const Duration(milliseconds: 400), () {
          if (!_inProgress) _setProgress(null);
        }),
      );
      final currentScope = PedidosOfflineService.currentScopeId;
      if (_queuedRerunScopes.remove(currentScope)) {
        unawaited(
          Future<void>.microtask(() async {
            await syncAll(notify: notify);
          }),
        );
      } else if (!_idleCompleter.isCompleted) {
        _idleCompleter.complete();
      }
    }
  }

  static void _schedulePedidoRetry(String scope, DateTime retryAt) {
    final existing = _retryDeadlinesByScope[scope];
    if (existing != null &&
        !retryAt.isBefore(existing) &&
        _retryTimersByScope.containsKey(scope)) {
      return;
    }

    _retryTimersByScope.remove(scope)?.cancel();
    _retryDeadlinesByScope[scope] = retryAt;
    final delay = retryAt.difference(_now());
    _retryTimersByScope[scope] = Timer(
      delay.isNegative ? Duration.zero : delay,
      () {
        _retryTimersByScope.remove(scope);
        if (PedidosOfflineService.currentScopeId != scope) return;
        _retryDeadlinesByScope.remove(scope);
        final runner = retryRunnerOverride;
        unawaited(runner == null ? syncAll(notify: true) : runner());
      },
    );
  }

  static void _activatePedidosScope(String scope) {
    for (final entry in _retryTimersByScope.entries.toList()) {
      if (entry.key == scope) continue;
      entry.value.cancel();
      _retryTimersByScope.remove(entry.key);
    }

    final retryAt = PedidosOfflineService.earliestRetryAtForScope(scope) ??
        _retryDeadlinesByScope[scope];
    if (retryAt != null) _schedulePedidoRetry(scope, retryAt);

    if (!_inProgress &&
        PedidosOfflineService.currentScopeId == scope &&
        _queuedRerunScopes.remove(scope)) {
      unawaited(syncAll(notify: true));
    }
  }

  @visibleForTesting
  static void debugSchedulePedidoRetry(String scope, DateTime retryAt) {
    _schedulePedidoRetry(scope, retryAt);
  }

  @visibleForTesting
  static void debugSetClockForTesting(DateTime Function() clock) {
    _now = clock;
  }

  @visibleForTesting
  static Future<void> debugWaitUntilIdle() => _idleCompleter.future;

  @visibleForTesting
  static void debugResetRetryScheduler() {
    for (final timer in _retryTimersByScope.values) {
      timer.cancel();
    }
    _retryTimersByScope.clear();
    _retryDeadlinesByScope.clear();
    _queuedRerunScopes.clear();
    _now = DateTime.now;
    _canAutoSync = null;
    retryRunnerOverride = null;
    if (!_idleCompleter.isCompleted) _idleCompleter.complete();
    PedidosOfflineService.onRetryScheduled = null;
    PedidosOfflineService.onScopeActivated = null;
    PedidosOfflineService.onAutoSyncThresholdReached = null;
  }
}
