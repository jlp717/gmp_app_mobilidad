import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/features/dashboard/domain/entities/dashboard_metrics.dart';
import 'package:gmp_app_mobilidad/core/utils/formatters.dart';

/// [MetricsCards] - Tarjetas de métricas principales del dashboard
///
/// MUESTRA:
/// - Vencimientos (398 pendientes, 156,591.09 €)
/// - Cobros (0 realizados)
/// - Pedidos (33 pendientes, 2,613.77 €)
class MetricsCards extends StatelessWidget {
  const MetricsCards({
    super.key,
    required this.vencimientos,
    required this.cobros,
    required this.pedidos,
  });

  final VencimientosMetrics vencimientos;
  final CobrosMetrics cobros;
  final PedidosMetrics pedidos;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Vencimientos
        _MetricCard(
          icon: Icons.calendar_today,
          title: 'Vencimientos',
          count: vencimientos.pendingCount,
          countLabel: 'pendientes',
          amount: vencimientos.totalAmount,
          color: Colors.orange,
          onTap: () {
            // Navegar a detalle de vencimientos
          },
        ),

        const SizedBox(height: 12),

        // Cobros
        _MetricCard(
          icon: Icons.payments,
          title: 'Cobros',
          count: cobros.realizedCount,
          countLabel: 'realizados',
          amount: cobros.totalAmount,
          color: Colors.green,
          onTap: () {
            // Navegar a detalle de cobros
          },
        ),

        const SizedBox(height: 12),

        // Pedidos
        _MetricCard(
          icon: Icons.shopping_cart,
          title: 'Pedidos',
          count: pedidos.pendingCount,
          countLabel: 'pendientes',
          amount: pedidos.totalAmount,
          color: Colors.blue,
          onTap: () {
            // Navegar a detalle de pedidos
          },
        ),
      ],
    );
  }
}

/// [_MetricCard] - Tarjeta individual de métrica
class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.icon,
    required this.title,
    required this.count,
    required this.countLabel,
    required this.amount,
    required this.color,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final int count;
  final String countLabel;
  final double amount;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      elevation: 2,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              // Icono
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  icon,
                  color: color,
                  size: 32,
                ),
              ),

              const SizedBox(width: 16),

              // Información
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '$count $countLabel',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      Formatters.currency(amount),
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: color,
                      ),
                    ),
                  ],
                ),
              ),

              // Chevron
              Icon(
                Icons.chevron_right,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
