import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Senior confirmation used by every repartidor mutating action.
///
/// Shown with the root navigator so it stacks above the rutero bottom sheet
/// instead of painting behind it (which looks like a dead Confirmar entrega).
Future<bool> confirmRepartidorAction(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'Sí, continuar',
  String cancelLabel = 'Cancelar',
  bool destructive = false,
}) async {
  if (!context.mounted) return false;
  final result = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    useRootNavigator: true,
    barrierColor: AppColors.systemBlack.withValues(alpha: 0.72),
    builder: (dialogContext) {
      return AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Semantics(
          header: true,
          child: Text(
            title,
            style: TextStyle(
              color: AppTheme.textPrimary,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        content: Semantics(
          liveRegion: true,
          child: SingleChildScrollView(
            child: Text(
              message,
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 14),
            ),
          ),
        ),
        actions: [
          Semantics(
            button: true,
            label: cancelLabel,
            child: TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(cancelLabel),
            ),
          ),
          Semantics(
            button: true,
            label: confirmLabel,
            child: FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              style: FilledButton.styleFrom(
                backgroundColor: destructive ? AppTheme.error : AppTheme.info,
                foregroundColor: AppColors.themedWhite,
              ),
              child: Text(confirmLabel),
            ),
          ),
        ],
      );
    },
  );
  return result == true;
}

Future<bool> confirmRuteroDeliveryWrite(
  BuildContext context, {
  required bool noEntrega,
  required String documentLabel,
  required String amountLabel,
  String? receiverLine,
  String? incidentLine,
  bool paid = false,
  String? paymentLabel,
}) {
  final buffer = StringBuffer();
  if (noEntrega) {
    buffer.write(
      'Se registrará $documentLabel ($amountLabel) como no entregado, '
      'sin cobro ni firma.',
    );
    final incident = incidentLine?.trim() ?? '';
    if (incident.isNotEmpty) {
      buffer.write('\n\nMotivo: $incident');
    }
  } else {
    buffer.write(
      'Se confirmará la entrega de $documentLabel ($amountLabel) '
      'con los datos actuales.',
    );
    final receiver = receiverLine?.trim() ?? '';
    if (receiver.isNotEmpty) {
      buffer.write('\n\nReceptor: $receiver');
    }
    if (paid && (paymentLabel ?? '').trim().isNotEmpty) {
      buffer.write('\nCobro: ${paymentLabel!.trim()}');
    }
  }
  return confirmRepartidorAction(
    context,
    title: noEntrega ? '¿Registrar la no entrega?' : '¿Confirmar la entrega?',
    message: buffer.toString(),
    confirmLabel: noEntrega ? 'Registrar no entrega' : 'Confirmar entrega',
    destructive: noEntrega,
  );
}

Future<bool> confirmRuteroNoEntregaIntent(BuildContext context) {
  return confirmRepartidorAction(
    context,
    title: '¿Registrar no entrega?',
    message: 'El establecimiento se marcará como cerrado o no disponible. '
        'En Finalizar indica el motivo y confirma para grabar. '
        'No computa como entrega realizada.',
    confirmLabel: 'Continuar a Finalizar',
    destructive: true,
  );
}
