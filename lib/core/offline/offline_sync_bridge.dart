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

  /// Bumped during [syncAll] so headers/modals can animate instead of freezing.
  static final ValueNotifier<OfflineSyncProgress?> progress =
      ValueNotifier<OfflineSyncProgress?>(null);

  static void _setProgress(OfflineSyncProgress? value) {
    progress.value = value;
  }

  /// Process both offline queues. Safe to call on every online transition.
  ///
  /// PERF: SyncQueue (entregas/cobros) and Pedidos queue are independent —
  /// run them in parallel so wall-clock ≈ max(queue, pedidos) instead of sum.
  static Future<OfflineSyncRunResult> syncAll({
    bool notify = true,
  }) async {
    if (_inProgress) {
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
          _setProgress(
            const OfflineSyncProgress(
              phase: 'queue',
              message: 'Enviando entregas y cobros…',
              fraction: 0.15,
            ),
          );
          queue = await SyncQueueService.instance.processAllWithResult();
        }(),
        () async {
          _setProgress(
            const OfflineSyncProgress(
              phase: 'pedidos',
              message: 'Enviando pedidos offline…',
              fraction: 0.2,
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
        OfflineSyncProgress(
          phase: 'done',
          message: 'Sync listo',
          fraction: 1,
        ),
      );
      return result;
    } finally {
      _inProgress = false;
      // Clear after a beat so listeners can show "done" briefly.
      Future<void>.delayed(const Duration(milliseconds: 400), () {
        if (!_inProgress) _setProgress(null);
      });
    }
  }
}
