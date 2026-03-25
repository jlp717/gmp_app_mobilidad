/// Price Warning Dialog
/// ====================
/// Alert when price is below minimum

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

class PriceWarningDialog extends StatelessWidget {
  final double price;
  final double minPrice;

  const PriceWarningDialog({
    Key? key,
    required this.price,
    required this.minPrice,
  }) : super(key: key);

  /// Show the dialog and return true if user accepts
  static Future<bool?> show(
    BuildContext context, {
    required double price,
    required double minPrice,
  }) {
    return showDialog<bool>(
      context: context,
      builder: (_) => PriceWarningDialog(price: price, minPrice: minPrice),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.darkSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: [
          Icon(Icons.warning_amber_rounded,
              color: AppTheme.warning, size: 24),
          const SizedBox(width: 8),
          const Text('Precio bajo',
              style: TextStyle(color: Colors.white, fontSize: 18)),
        ],
      ),
      content: Text(
        'El precio (\u20AC${price.toStringAsFixed(3)}) es inferior al minimo (\u20AC${minPrice.toStringAsFixed(3)})',
        style: const TextStyle(color: Colors.white70, fontSize: 14),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancelar',
              style: TextStyle(color: Colors.white54)),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Aceptar',
              style: TextStyle(color: AppTheme.warning)),
        ),
      ],
    );
  }
}
