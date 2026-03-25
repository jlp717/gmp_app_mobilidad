/// Order Line Tile
/// ================
/// Single order line in the cart summary with swipe-to-delete

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';

class OrderLineTile extends StatelessWidget {
  final OrderLine line;
  final int index;
  final VoidCallback onDismissed;
  final VoidCallback onTap;

  const OrderLineTile({
    Key? key,
    required this.line,
    required this.index,
    required this.onDismissed,
    required this.onTap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final marginColor = line.porcentajeMargen >= 15
        ? AppTheme.neonGreen
        : line.porcentajeMargen >= 5
            ? Colors.orange
            : AppTheme.error;

    return Dismissible(
      key: ValueKey('line_${line.codigoArticulo}_$index'),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: AppTheme.error.withOpacity(0.2),
          borderRadius: BorderRadius.circular(10),
        ),
        child: const Icon(Icons.delete_outline, color: AppTheme.error),
      ),
      confirmDismiss: (_) async {
        onDismissed();
        return false; // The callback handles deletion after confirmation
      },
      child: Card(
        color: AppTheme.darkCard,
        margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: BorderSide(color: AppTheme.borderColor.withOpacity(0.2)),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                // Product name + VT badge
                Expanded(
                  flex: 3,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        line.descripcion,
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w500,
                          fontSize: Responsive.fontSize(context,
                              small: 12, large: 14),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          // VT badge
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 5, vertical: 1),
                            decoration: BoxDecoration(
                              color: AppTheme.neonPurple.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              'VT',
                              style: TextStyle(
                                color: AppTheme.neonPurple,
                                fontSize: Responsive.fontSize(context,
                                    small: 9, large: 10),
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          // Qty
                          Text(
                            '${line.cantidadEnvases.toStringAsFixed(0)} c / ${line.cantidadUnidades.toStringAsFixed(0)} u',
                            style: TextStyle(
                              color: Colors.white54,
                              fontSize: Responsive.fontSize(context,
                                  small: 11, large: 12),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                // Price
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '\u20AC${line.precioVenta.toStringAsFixed(3)}',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: Responsive.fontSize(context,
                            small: 11, large: 12),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '\u20AC${line.importeVenta.toStringAsFixed(2)}',
                      style: TextStyle(
                        color: AppTheme.neonGreen,
                        fontWeight: FontWeight.bold,
                        fontSize: Responsive.fontSize(context,
                            small: 13, large: 15),
                      ),
                    ),
                  ],
                ),
                const SizedBox(width: 8),
                // Margin indicator
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
                  decoration: BoxDecoration(
                    color: marginColor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '${line.porcentajeMargen.toStringAsFixed(1)}%',
                    style: TextStyle(
                      color: marginColor,
                      fontSize: Responsive.fontSize(context,
                          small: 10, large: 11),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
