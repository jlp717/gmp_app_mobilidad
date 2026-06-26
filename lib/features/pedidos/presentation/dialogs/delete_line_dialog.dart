/// Delete Line Dialog
/// ==================
/// Confirmation dialog for removing an order line
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class DeleteLineDialog extends StatelessWidget {
  const DeleteLineDialog({
    required this.productName,
    super.key,
  });
  final String productName;

  /// Show the dialog and return true if user confirms deletion
  static Future<bool?> show(
    BuildContext context, {
    required String productName,
  }) {
    return showDialog<bool>(
      context: context,
      builder: (_) => DeleteLineDialog(productName: productName),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.raisedSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: const Row(
        children: [
          Icon(Icons.delete_outline, color: AppTheme.error, size: 24),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              'Borrar linea',
              style: TextStyle(color: Colors.white, fontSize: 18),
            ),
          ),
        ],
      ),
      content: Text(
        'Borrar linea de $productName?',
        style: const TextStyle(color: Colors.white70, fontSize: 14),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text(
            'Cancelar',
            style: TextStyle(color: Colors.white54),
          ),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text(
            'Borrar',
            style: TextStyle(color: AppTheme.error),
          ),
        ),
      ],
    );
  }
}
