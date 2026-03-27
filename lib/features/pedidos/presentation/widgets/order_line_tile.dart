/// Order Line Tile
/// ================
/// Single order line in the cart summary with swipe-to-delete

import 'package:flutter/material.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';
import '../utils/pedidos_formatters.dart';

class OrderLineTile extends StatelessWidget {
  final OrderLine line;
  final int index;
  final VoidCallback onDismissed;
  final VoidCallback onTap;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;

  const OrderLineTile({
    Key? key,
    required this.line,
    required this.index,
    required this.onDismissed,
    required this.onTap,
    required this.onIncrement,
    required this.onDecrement,
  }) : super(key: key);

  String _getQtyLabel() {
    bool isWeight = line.unidadMedida == 'KILOGRAMOS' || line.unidadMedida == 'LITROS';
    if (isWeight && line.cantidadUnidades > 0) {
      return '${PedidosFormatters.number(line.cantidadUnidades, decimals: 2)} ${Product.unitLabel(line.unidadMedida)}';
    }
    
    // Check if it's a dual-field product by calculating: U/F > 0 and U/F < U/C 
    // AND it actually has envases && unidades in the line
    bool isDualField = line.unidadesCaja > 1 && line.unidadesFraccion > 0 && line.unidadesFraccion < line.unidadesCaja;
    
    if (isDualField && line.cantidadEnvases > 0 && line.cantidadUnidades > 0 && line.unidadMedida == 'CAJAS') {
      return '${PedidosFormatters.number(line.cantidadEnvases)} cj (${PedidosFormatters.number(line.cantidadUnidades)} ud)';
    }

    if (line.cantidadEnvases > 0 && line.unidadMedida == 'CAJAS') {
      return '${PedidosFormatters.number(line.cantidadEnvases)} cj';
    }
    
    // For single-field units like BANDEJAS, ESTUCHE, PIEZAS, UNIDADES
    final label = Product.unitLabel(line.unidadMedida);
    return '${PedidosFormatters.number(line.cantidadUnidades)} $label';
  }

  @override
  Widget build(BuildContext context) {
    final marginColor = line.porcentajeMargen >= 15
        ? AppTheme.neonGreen
        : line.porcentajeMargen >= 5
            ? Colors.orange
            : AppTheme.error;

    return Dismissible(
      key: ObjectKey(line),
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
                // Product thumbnail (Mejora 7)
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: SizedBox(
                    width: 40,
                    height: 40,
                    child: Image.network(
                      '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(line.codigoArticulo.trim())}/image',
                      headers: ApiClient.authHeaders,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                        color: AppTheme.darkCard,
                        child: const Icon(Icons.image_not_supported_outlined, color: Colors.white24, size: 18),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
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
                          // Qty Stepper
                          Container(
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.05),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Material(
                                  color: Colors.transparent,
                                  child: InkWell(
                                    onTap: line.cantidadEnvases > 0 || line.cantidadUnidades > 0 ? onDecrement : null,
                                    borderRadius: const BorderRadius.horizontal(left: Radius.circular(6)),
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                                      child: Icon(Icons.remove, size: 14, color: Colors.white70),
                                    ),
                                  ),
                                ),
                                Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 4),
                                  child: Text(
                                    _getQtyLabel(),
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: Responsive.fontSize(context, small: 11, large: 12),
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                                Material(
                                  color: Colors.transparent,
                                  child: InkWell(
                                    onTap: onIncrement,
                                    borderRadius: const BorderRadius.horizontal(right: Radius.circular(6)),
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                                      child: Icon(Icons.add, size: 14, color: AppTheme.neonBlue),
                                    ),
                                  ),
                                ),
                              ],
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
                      PedidosFormatters.money(line.precioVenta, decimals: 3),
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: Responsive.fontSize(context,
                            small: 11, large: 12),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      PedidosFormatters.money(line.importeVenta),
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
