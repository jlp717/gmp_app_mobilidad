import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class OfflineSyncNotifier {
  static final scaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

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

  static void genericSyncSucceeded(int count) {
    if (count <= 0) return;
    _show(
      count == 1
          ? 'Operacion pendiente sincronizada.'
          : '$count operaciones pendientes sincronizadas.',
      backgroundColor: AppTheme.success,
    );
  }

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
