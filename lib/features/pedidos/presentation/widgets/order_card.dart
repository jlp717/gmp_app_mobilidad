/// Order Card
/// ==========
/// Operational card showing order info with status-aware actions.
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/client_balance_badge.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_status_badge.dart';

class OrderCard extends StatelessWidget {
  const OrderCard({
    required this.order,
    required this.onTap,
    super.key,
    this.onDuplicate,
    this.onViewAlbaran,
    this.onResend,
    this.onDelete,
    this.isMarginVisible = false,
  });
  final OrderSummary order;
  final VoidCallback onTap;
  final VoidCallback? onDuplicate;
  final VoidCallback? onViewAlbaran;
  final VoidCallback? onResend;
  final VoidCallback? onDelete;

  /// Margen visible solo para JEFE_VENTAS. Default false para que el rol
  /// COMERCIAL nunca lo vea por accidente si la pagina olvida pasarlo.
  final bool isMarginVisible;

  @override
  Widget build(BuildContext context) {
    final theme = OrderStatusConfig.getTheme(order.estado);
    final marginColor = _marginColor(order.margen);
    final displayEstado =
        OrderStatusConfig.canonicalDisplayStatus(order.estado);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: theme.primary.withValues(alpha: 0.32)),
        boxShadow: AppTheme.elevation1,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top row: status + date
                Row(
                  children: [
                    OrderStatusBadge(estado: displayEstado, fontSize: 10),
                    const Spacer(),
                    Icon(
                      Icons.calendar_today_outlined,
                      size: 12,
                      color: AppTheme.textPrimary.withValues(alpha: 0.4),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      order.fechaFormatted.isNotEmpty
                          ? order.fechaFormatted
                          : order.fecha,
                      style: TextStyle(
                        color: AppTheme.textPrimary.withValues(alpha: 0.5),
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                // Client + order number
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: theme.primary.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                        border: Border.all(
                            color: theme.primary.withValues(alpha: 0.3)),
                      ),
                      child: Icon(
                        theme.icon,
                        color: theme.primary,
                        size: 22,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            order.clienteName,
                            style: const TextStyle(
                              color: AppTheme.textPrimary,
                              fontWeight: FontWeight.w700,
                              fontSize: 14,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '#${order.numeroPedidoFormatted}  ·  ${order.clienteCode}',
                            style: TextStyle(
                              color: theme.primary.withValues(alpha: 0.8),
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          ClientDebtStatusChip(
                            balance: {
                              if (order.saldoPendiente != null)
                                'saldoPendiente': order.saldoPendiente,
                              if (order.importeVencido != null)
                                'vencido': order.importeVencido,
                              if (order.deudaEstado.isNotEmpty)
                                'balanceStatus': order.deudaEstado,
                            },
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                // Stats row
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.textPrimary.withValues(alpha: 0.03),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _statItem(
                        Icons.format_list_numbered,
                        '${order.lineCount} líneas',
                        AppTheme.textSecondary,
                      ),
                      _statItem(
                        Icons.euro,
                        PedidosFormatters.money(order.total),
                        AppTheme.success,
                      ),
                      if (isMarginVisible)
                        _statItem(
                          Icons.trending_up,
                          '${order.margen.toStringAsFixed(1)}%',
                          marginColor,
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                _buildBolsaChip(displayEstado),
                // Actions row (if available)
                if (onDuplicate != null ||
                    onViewAlbaran != null ||
                    onResend != null ||
                    onDelete != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      children: [
                        if (onResend != null)
                          _actionChip(
                            context,
                            Icons.send_outlined,
                            'Confirmar',
                            AppTheme.success,
                            onResend!,
                          ),
                        if (onDelete != null)
                          _actionChip(
                            context,
                            Icons.delete_outline,
                            'Eliminar',
                            AppTheme.error,
                            onDelete!,
                          ),
                        if (onDuplicate != null)
                          _actionChip(
                            context,
                            Icons.copy_all_outlined,
                            'Duplicar',
                            AppTheme.info,
                            onDuplicate!,
                          ),
                        if (onViewAlbaran != null)
                          _actionChip(
                            context,
                            Icons.description_outlined,
                            'Albarán',
                            AppTheme.accentIndigo,
                            onViewAlbaran!,
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _statItem(IconData icon, String value, Color color) {
    return Column(
      children: [
        Icon(icon, color: color.withValues(alpha: 0.7), size: 14),
        const SizedBox(height: 2),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 11,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Widget _actionChip(
    BuildContext context,
    IconData icon,
    String label,
    Color color,
    VoidCallback onTap,
  ) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: color.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: color, size: 12),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _marginColor(double margin) {
    if (margin >= 15) return AppTheme.success;
    if (margin >= 5) return AppTheme.warning;
    return AppTheme.error;
  }

  Widget _buildBolsaChip(String displayEstado) {
    if (displayEstado == 'BORRADOR') {
      return _bolsaStatusChip(
        Icons.account_balance_wallet_outlined,
        'Bolsa: pendiente de confirmar',
        AppTheme.textTertiary,
      );
    }
    final generada = order.bolsaGenerada;
    final neto = order.bolsaNeto;
    final hasBolsaImpact = (generada ?? false) || neto.abs() > 0.0001;
    if (hasBolsaImpact) {
      final netoLabel = neto == 0
          ? ''
          : ' (${neto > 0 ? '+' : ''}${PedidosFormatters.money(neto)})';
      final label = neto > 0
          ? 'Bolsa generada$netoLabel'
          : neto < 0
              ? 'Bolsa usada$netoLabel'
              : 'Bolsa compensada';
      final color = neto >= 0 ? AppTheme.success : AppTheme.warning;
      return _bolsaStatusChip(
        Icons.account_balance_wallet,
        label,
        color,
      );
    }
    if (generada == false) {
      return _bolsaStatusChip(
        Icons.account_balance_wallet_outlined,
        'Bolsa: sin impacto',
        AppTheme.textSecondary,
      );
    }
    return _bolsaStatusChip(
      Icons.info_outline,
      'Bolsa: ver detalle del pedido',
      AppTheme.warning,
    );
  }

  Widget _bolsaStatusChip(IconData icon, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 14),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 10,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
