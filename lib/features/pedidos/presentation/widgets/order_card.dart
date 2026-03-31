/// Order Card
/// ==========
/// Premium card showing order info with gradient by status, swipe actions.

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';
import '../utils/pedidos_formatters.dart';
import 'order_status_badge.dart';

class OrderCard extends StatelessWidget {
  final OrderSummary order;
  final VoidCallback onTap;
  final VoidCallback? onDuplicate;
  final VoidCallback? onCancel;
  final VoidCallback? onViewAlbaran;

  const OrderCard({
    Key? key,
    required this.order,
    required this.onTap,
    this.onDuplicate,
    this.onCancel,
    this.onViewAlbaran,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final theme = OrderStatusConfig.getTheme(order.estado);
    final marginColor = _marginColor(order.margen);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: theme.gradient,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.primary.withOpacity(0.25)),
        boxShadow: [
          BoxShadow(
            color: theme.primary.withOpacity(0.1),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top row: status + date
                Row(
                  children: [
                    OrderStatusBadge(estado: order.estado, fontSize: 10),
                    const Spacer(),
                    Icon(Icons.calendar_today_outlined,
                        size: 12, color: Colors.white.withOpacity(0.4)),
                    const SizedBox(width: 4),
                    Text(
                      order.fechaFormatted.isNotEmpty
                          ? order.fechaFormatted
                          : order.fecha,
                      style: TextStyle(
                        color: Colors.white.withOpacity(0.5),
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
                        gradient: LinearGradient(
                          colors: [
                            theme.primary.withOpacity(0.2),
                            theme.primary.withOpacity(0.08),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(12),
                        border:
                            Border.all(color: theme.primary.withOpacity(0.3)),
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
                              color: Colors.white,
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
                              color: theme.primary.withOpacity(0.8),
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
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
                    color: Colors.white.withOpacity(0.03),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _statItem(
                        Icons.format_list_numbered,
                        '${order.lineCount} líneas',
                        Colors.white70,
                      ),
                      _statItem(
                        Icons.euro,
                        PedidosFormatters.money(order.total),
                        AppTheme.neonGreen,
                      ),
                      _statItem(
                        Icons.trending_up,
                        '${order.margen.toStringAsFixed(1)}%',
                        marginColor,
                      ),
                    ],
                  ),
                ),
                // Actions row (if available)
                if (onDuplicate != null ||
                    onCancel != null ||
                    onViewAlbaran != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      children: [
                        if (onDuplicate != null)
                          _actionChip(
                            context,
                            Icons.copy_all_outlined,
                            'Duplicar',
                            AppTheme.neonBlue,
                            onDuplicate!,
                          ),
                        if (onViewAlbaran != null)
                          _actionChip(
                            context,
                            Icons.description_outlined,
                            'Albarán',
                            AppTheme.neonPurple,
                            onViewAlbaran!,
                          ),
                        if (onCancel != null)
                          _actionChip(
                            context,
                            Icons.cancel_outlined,
                            'Anular',
                            AppTheme.error,
                            onCancel!,
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
        Icon(icon, color: color.withOpacity(0.7), size: 14),
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
            color: color.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: color.withOpacity(0.3)),
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
    if (margin >= 15) return AppTheme.neonGreen;
    if (margin >= 5) return Colors.orange;
    return AppTheme.error;
  }
}
