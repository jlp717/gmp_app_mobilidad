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
import '../../../../core/widgets/smart_product_image.dart';

class OrderLineTile extends StatelessWidget {
  final OrderLine line;
  final int index;
  final VoidCallback onDismissed;
  final VoidCallback onTap;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;
  // Called with the new claseLinea value ('VT' or 'SC') when badge is tapped
  final void Function(String)? onClaseLineaToggle;

  const OrderLineTile({
    Key? key,
    required this.line,
    required this.index,
    required this.onDismissed,
    required this.onTap,
    required this.onIncrement,
    required this.onDecrement,
    this.onClaseLineaToggle,
  }) : super(key: key);

  String _getQtyLabel() {
    final unit = line.unidadMedida.toUpperCase().trim();
    final isWeight = unit == 'KILOGRAMOS' || unit == 'LITROS';

    if (isWeight && line.cantidadUnidades > 0) {
      final abbr = unit == 'LITROS' ? 'L' : 'kg';
      return '${PedidosFormatters.number(line.cantidadUnidades, decimals: 2)} $abbr';
    }

    // Dual-field: cajas + loose units
    final isDualField = line.unidadesCaja > 1 &&
        line.unidadesFraccion > 0 &&
        line.unidadesFraccion < line.unidadesCaja;
    if (isDualField &&
        unit == 'CAJAS' &&
        line.cantidadEnvases > 0 &&
        line.cantidadUnidades > 0) {
      return '${PedidosFormatters.number(line.cantidadEnvases)} cj'
          ' (${PedidosFormatters.number(line.cantidadUnidades)} ud)';
    }

    if (unit == 'CAJAS' && line.cantidadEnvases > 0) {
      if (line.unidadesCaja > 1) {
        final total = line.cantidadEnvases * line.unidadesCaja;
        return '${PedidosFormatters.number(line.cantidadEnvases)} cj'
            ' (${PedidosFormatters.number(total)} uds)';
      }
      return '${PedidosFormatters.number(line.cantidadEnvases)} cj';
    }

    // Explicit sub-unit: BANDEJAS, ESTUCHES, PIEZAS, etc.
    final label = Product.unitLabel(unit);
    if (line.unidadesCaja > 1 && line.cantidadUnidades > 0) {
      final pzTotal = line.cantidadUnidades * line.unidadesCaja;
      return '${PedidosFormatters.number(line.cantidadUnidades)} $label'
          ' (${PedidosFormatters.number(pzTotal)} pz)';
    }
    return '${PedidosFormatters.number(line.cantidadUnidades)} $label';
  }

  String _priceLabel() {
    if (line.precioVenta <= 0) return '';
    final abbr = _unitAbbr(line.unidadMedida);
    return '@ ${PedidosFormatters.money(line.precioVenta, decimals: 3)} €/$abbr';
  }

  static String _unitAbbr(String unit) {
    switch (unit.toUpperCase().trim()) {
      case 'CAJAS': return 'cj';
      case 'CAJA': return 'cj';
      case 'KILOGRAMOS': return 'kg';
      case 'KILO': return 'kg';
      case 'KG': return 'kg';
      case 'LITROS': return 'L';
      case 'LITRO': return 'L';
      case 'BANDEJAS': return 'band';
      case 'BANDEJA': return 'band';
      case 'ESTUCHES': case 'ESTUCHE': return 'est';
      case 'BOLSAS': case 'BOLSA': return 'bol';
      case 'UNIDADES': return 'uds';
      case 'UNIDAD': return 'uds';
      case 'PIEZAS': return 'pzs';
      case 'PIEZA': return 'pzs';
      default: return unit.toLowerCase();
    }
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
                    child: SmartProductImage(
                      imageUrl: '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(line.codigoArticulo.trim())}/image',
                      productCode: line.codigoArticulo,
                      productName: line.descripcion,
                      headers: ApiClient.authHeaders,
                      fit: BoxFit.cover,
                      borderRadius: BorderRadius.circular(6),
                      showCodeOnFallback: false,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                // Product name + VT/SC badge + stepper
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
                          // Tappable VT / SC badge
                          GestureDetector(
                            onTap: onClaseLineaToggle == null
                                ? null
                                : () => onClaseLineaToggle!(
                                    line.claseLinea == 'SC' ? 'VT' : 'SC'),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 5, vertical: 1),
                              decoration: BoxDecoration(
                                color: line.claseLinea == 'SC'
                                    ? Colors.blueGrey.withValues(alpha: 0.25)
                                    : AppTheme.neonPurple
                                        .withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(
                                  color: line.claseLinea == 'SC'
                                      ? Colors.blueGrey
                                      : Colors.transparent,
                                  width: 0.5,
                                ),
                              ),
                              child: Text(
                                line.claseLinea == 'SC' ? 'SC' : 'VT',
                                style: TextStyle(
                                  color: line.claseLinea == 'SC'
                                      ? Colors.blueGrey.shade200
                                      : AppTheme.neonPurple,
                                  fontSize: Responsive.fontSize(context,
                                      small: 9, large: 10),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          // Qty Stepper
                          Container(
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.05),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Material(
                                  color: Colors.transparent,
                                  child: InkWell(
                                    onTap: line.cantidadEnvases > 0 ||
                                            line.cantidadUnidades > 0
                                        ? onDecrement
                                        : null,
                                    borderRadius:
                                        const BorderRadius.horizontal(
                                            left: Radius.circular(6)),
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 6, vertical: 3),
                                      child: Icon(Icons.remove,
                                          size: 14,
                                          color: Colors.white70),
                                    ),
                                  ),
                                ),
                                Padding(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 4),
                                  child: Text(
                                    _getQtyLabel(),
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: Responsive.fontSize(context,
                                          small: 11, large: 12),
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                                Material(
                                  color: Colors.transparent,
                                  child: InkWell(
                                    onTap: onIncrement,
                                    borderRadius:
                                        const BorderRadius.horizontal(
                                            right: Radius.circular(6)),
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 6, vertical: 3),
                                      child: Icon(Icons.add,
                                          size: 14,
                                          color: AppTheme.neonBlue),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      // Price per unit sub-label
                      if (_priceLabel().isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          _priceLabel(),
                          style: const TextStyle(
                              color: Colors.white38, fontSize: 10),
                        ),
                      ],
                    ],
                  ),
                ),
                // Importe
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    if (line.importeVenta == 0) ...[
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.warning_amber_rounded,
                              color: AppTheme.warning, size: 13),
                          const SizedBox(width: 3),
                          Text(
                            '0,00 €',
                            style: TextStyle(
                              color: AppTheme.error,
                              fontWeight: FontWeight.bold,
                              fontSize: Responsive.fontSize(context,
                                  small: 13, large: 15),
                            ),
                          ),
                        ],
                      ),
                    ] else ...[
                      Text(
                        PedidosFormatters.money(line.precioVenta,
                            decimals: 3),
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
