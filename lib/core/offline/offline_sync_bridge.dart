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

class OfflineSyncBridge {
  OfflineSyncBridge._();

  static bool _inProgress = false;

  /// Process both offline queues. Safe to call on every online transition.
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
    try {
      final queue = await SyncQueueService.instance.processAllWithResult();
      await PedidosOfflineService.init();
      final pedidos = await PedidosOfflineService.syncPendingOrdersWithResult();
      final pedidosSynced = pedidos['synced'] as int? ?? 0;
      final pedidosFailed = pedidos['failed'] as int? ?? 0;
      final pedidosPending = pedidos['remainingPending'] as int? ??
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
        'pedidos=$pedidosSynced/$pedidosFailed',
      );
      return result;
    } finally {
      _inProgress = false;
    }
  }
}
