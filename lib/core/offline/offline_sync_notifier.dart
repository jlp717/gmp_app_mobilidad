import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_audit_log.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class OfflineSyncSnapshot {
  const OfflineSyncSnapshot({
    required this.synced,
    required this.failed,
    required this.pending,
    required this.at,
    this.message,
  });

  final int synced;
  final int failed;
  final int pending;
  final DateTime at;
  final String? message;
}

class OfflineSyncNotifier {
  static final scaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

  /// Live counters for UI badges (queue + pedidos).
  static final ValueNotifier<int> pendingCount = ValueNotifier<int>(0);
  static final ValueNotifier<int> failedCount = ValueNotifier<int>(0);
  static OfflineSyncSnapshot? lastResult;

  static void refreshCounts({int? pending, int? failed}) {
    if (pending != null) pendingCount.value = pending;
    if (failed != null) failedCount.value = failed;
  }

  static void reportSyncRun({
    required int queueSynced,
    required int queueFailed,
    required int queuePending,
    required int pedidosSynced,
    required int pedidosFailed,
    required int pedidosPending,
  }) {
    final synced = queueSynced + pedidosSynced;
    final failed = queueFailed + pedidosFailed;
    final pending = queuePending + pedidosPending;
    lastResult = OfflineSyncSnapshot(
      synced: synced,
      failed: failed,
      pending: pending,
      at: DateTime.now(),
      message:
          'queue=$queueSynced/$queueFailed pedidos=$pedidosSynced/$pedidosFailed',
    );
    refreshCounts(pending: pending, failed: failed);
    syncStatusSummary(pending: pending, failed: failed, synced: synced);
  }

  static void orderQueued({required String clientName}) {
    _show(
      'Pedido guardado localmente para $clientName. Se enviara al recuperar conexion.',
      backgroundColor: Colors.orange.shade700,
    );
  }

  static void orderSyncSucceeded(int count) {
    if (count <= 0) return;
    _show(
      count == 1
          ? 'Pedido offline enviado correctamente.'
          : '$count pedidos offline enviados correctamente.',
      backgroundColor: AppTheme.success,
    );
  }

  static void orderSyncFailed(int count) {
    if (count <= 0) return;
    _show(
      count == 1
          ? 'Un pedido offline quedo en borrador pendiente de revisar.'
          : '$count pedidos offline quedaron pendientes de revisar.',
      backgroundColor: AppTheme.error,
    );
  }

  static void deliveryQueued() {
    _show(
      'Entrega guardada sin conexion. Se enviara al recuperar red.',
      backgroundColor: Colors.orange.shade700,
    );
  }

  static void genericSyncSucceeded(int count) {
    if (count <= 0) return;
    _show(
      count == 1
          ? 'Operacion pendiente sincronizada.'
          : '$count operaciones pendientes sincronizadas.',
      backgroundColor: AppTheme.success,
    );
  }

  static void queueManualReview(int count) {
    if (count <= 0) return;
    _show(
      count == 1
          ? 'Una operacion offline requiere revision manual.'
          : '$count operaciones offline requieren revision manual.',
      backgroundColor: AppTheme.error,
    );
  }

  /// Resumen con pendientes / fallidas / ultimo resultado.
  static void syncStatusSummary({
    required int pending,
    required int failed,
    required int synced,
  }) {
    if (synced <= 0 && pending <= 0 && failed <= 0) return;

    final parts = <String>[];
    if (synced > 0) {
      parts.add(synced == 1 ? '1 sincronizada' : '$synced sincronizadas');
    }
    if (pending > 0) {
      parts.add(pending == 1 ? '1 pendiente' : '$pending pendientes');
    }
    if (failed > 0) {
      parts.add(failed == 1 ? '1 fallida' : '$failed fallidas');
    }
    if (parts.isEmpty) return;

    final color = failed > 0
        ? AppTheme.error
        : pending > 0
            ? Colors.orange.shade700
            : AppTheme.success;

    _show(
      'Sync offline: ${parts.join(', ')}.',
      backgroundColor: color,
    );
  }

  /// Debug/settings helper — last audit rows.
  static List<SyncAuditEntry> recentAudit({int limit = 20}) =>
      SyncAuditLog.recent(limit: limit);

  static void _show(
    String message, {
    required Color backgroundColor,
  }) {
    void showNow() {
      final messenger = scaffoldMessengerKey.currentState;
      if (messenger == null) {
        debugPrint('[OfflineSyncNotifier] $message');
        return;
      }
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(message),
            backgroundColor: backgroundColor,
            duration: const Duration(seconds: 5),
          ),
        );
    }

    final phase = WidgetsBinding.instance.schedulerPhase;
    if (phase == SchedulerPhase.idle ||
        phase == SchedulerPhase.postFrameCallbacks) {
      showNow();
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) => showNow());
    }
  }
}
