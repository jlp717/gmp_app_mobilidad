import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

Future<bool> confirmRepartidorAction(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'Sí, continuar',
  String cancelLabel = 'Cancelar',
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) {
      return AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
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
          child: Text(
            message,
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 14),
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
