import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/features/dashboard/domain/entities/dashboard_metrics.dart';
import 'package:gmp_app_mobilidad/core/utils/formatters.dart';

/// [VentasCards] - Tarjetas de métricas de ventas del vendedor
///
/// MUESTRA DATOS REALES:
/// - Ventas de Hoy (total, cantidad de operaciones, margen)
/// - Ventas del Mes (total, cantidad, comparativa mes anterior)
/// - Ventas del Año (total acumulado)
/// - Clientes Atendidos (hoy, mes)
class VentasCards extends StatelessWidget {
  const VentasCards({
    super.key,
    required this.ventasHoy,
    required this.ventasMes,
    required this.ventasAnio,
    required this.clientesAtendidos,
    required this.pedidosPendientes,
  });

  final VentasMetrics ventasHoy;
  final VentasMesMetrics ventasMes;
  final VentasMetrics ventasAnio;
  final ClientesAtendidos clientesAtendidos;
  final int pedidosPendientes;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Fila superior: Ventas Hoy y Ventas Mes
        Row(
          children: [
            Expanded(
              child: _VentaCardCompact(
                title: 'Ventas Hoy',
                total: ventasHoy.total,
                subtitle: '${ventasHoy.cantidad} operaciones',
                margen: ventasHoy.margen,
                color: Colors.blue,
                icon: Icons.today,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _VentaCardCompact(
                title: 'Ventas Mes',
                total: ventasMes.total,
                subtitle: '${ventasMes.cantidad} operaciones',
                margen: ventasMes.margen,
                color: Colors.green,
                icon: Icons.calendar_month,
                variacion: ventasMes.comparativaMesAnterior,
              ),
            ),
          ],
        ),

        const SizedBox(height: 12),

        // Fila inferior: Ventas Año y Clientes
        Row(
          children: [
            Expanded(
              child: _VentaCardCompact(
                title: 'Ventas Año',
                total: ventasAnio.total,
                subtitle: '${ventasAnio.cantidad} operaciones',
                margen: ventasAnio.margen,
                color: Colors.purple,
                icon: Icons.calendar_today,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _ClientesCard(
                clientesHoy: clientesAtendidos.hoy,
                clientesMes: clientesAtendidos.mes,
                pedidosPendientes: pedidosPendientes,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// [_VentaCardCompact] - Tarjeta compacta de ventas
class _VentaCardCompact extends StatelessWidget {
  const _VentaCardCompact({
    required this.title,
    required this.total,
    required this.subtitle,
    required this.margen,
    required this.color,
    required this.icon,
    this.variacion,
  });

  final String title;
  final double total;
  final String subtitle;
  final double margen;
  final Color color;
  final IconData icon;
  final double? variacion;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Cabecera con icono y título
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    icon,
                    color: color,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 12),

            // Importe total
            Text(
              Formatters.currency(total),
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),

            const SizedBox(height: 4),

            // Subtítulo con cantidad de operaciones
            Text(
              subtitle,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),

            const SizedBox(height: 8),

            // Margen y variación
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Margen: ${Formatters.currency(margen)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: Colors.grey[600],
                  ),
                ),
                if (variacion != null)
                  _buildVariacion(context, variacion!),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVariacion(BuildContext context, double variacion) {
    final isPositive = variacion >= 0;
    final color = isPositive ? Colors.green : Colors.red;
    final icon = isPositive ? Icons.trending_up : Icons.trending_down;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: color, size: 14),
        const SizedBox(width: 2),
        Text(
          '${variacion.toStringAsFixed(1)}%',
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}

/// [_ClientesCard] - Tarjeta de clientes atendidos
class _ClientesCard extends StatelessWidget {
  const _ClientesCard({
    required this.clientesHoy,
    required this.clientesMes,
    required this.pedidosPendientes,
  });

  final int clientesHoy;
  final int clientesMes;
  final int pedidosPendientes;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Cabecera
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.orange.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.people,
                    color: Colors.orange,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Clientes',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 12),

            // Clientes Hoy
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Hoy:',
                  style: theme.textTheme.bodyMedium,
                ),
                Text(
                  '$clientesHoy',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: Colors.orange,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 4),

            // Clientes Mes
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Este Mes:',
                  style: theme.textTheme.bodyMedium,
                ),
                Text(
                  '$clientesMes',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: Colors.orange.shade700,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 8),

            // Pedidos pendientes
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.red.withOpacity(0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.pending, color: Colors.red, size: 14),
                  const SizedBox(width: 4),
                  Text(
                    '$pedidosPendientes pendientes',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: Colors.red,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
