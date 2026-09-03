/// Price Warning Dialog
/// ====================
/// Alert when price is below minimum
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';

class PriceWarningDialog extends StatelessWidget {
  const PriceWarningDialog({
    required this.price,
    required this.minPrice,
    super.key,
  });
  final double price;
  final double minPrice;

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
      backgroundColor: AppTheme.raisedSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: [
          Icon(Icons.warning_amber_rounded, color: AppTheme.warning, size: 24),
          SizedBox(width: 8),
          Text(
            'Precio bajo',
            style: TextStyle(color: AppColors.themedWhite, fontSize: 18),
          ),
        ],
      ),
      content: Text(
        'El precio (${PedidosFormatters.money(price, decimals: 3)}) es inferior al minimo (${PedidosFormatters.money(minPrice, decimals: 3)})',
        style: TextStyle(color: AppColors.themedWhite70, fontSize: 14),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: Text('Cancelar',
              style: TextStyle(color: AppColors.themedWhite54)),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          child:
              const Text('Aceptar', style: TextStyle(color: AppTheme.warning)),
        ),
      ],
    );
  }
}
