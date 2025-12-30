import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/features/dashboard/domain/entities/dashboard_metrics.dart';
import 'package:gmp_app_mobilidad/core/utils/formatters.dart';

/// [UltimasVentasWidget] - Lista de las últimas ventas realizadas
///
/// Muestra las ventas más recientes del vendedor con:
/// - Fecha de la venta
/// - Nombre del cliente
/// - Importe
/// - Número de albarán
class UltimasVentasWidget extends StatelessWidget {
  const UltimasVentasWidget({
    super.key,
    required this.ultimasVentas,
  });

  final List<UltimaVenta> ultimasVentas;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (ultimasVentas.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Icon(
                Icons.receipt_long_outlined,
                size: 48,
                color: theme.colorScheme.onSurfaceVariant,
              ),
              const SizedBox(height: 8),
              Text(
                'No hay ventas recientes',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      );
    }

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
                    color: Colors.blue.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.receipt_long,
                    color: Colors.blue,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  'Últimas Ventas',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                Text(
                  '${ultimasVentas.length} registros',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 16),
            const Divider(height: 1),

            // Lista de ventas
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: ultimasVentas.length > 5 ? 5 : ultimasVentas.length,
              separatorBuilder: (context, index) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final venta = ultimasVentas[index];
                return _VentaItem(venta: venta);
              },
            ),

            if (ultimasVentas.length > 5) ...[
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: () {
                  // TODO: Navegar a historial completo
                },
                icon: const Icon(Icons.arrow_forward),
                label: const Text('Ver todas'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// [_VentaItem] - Item individual de venta
class _VentaItem extends StatelessWidget {
  const _VentaItem({
    required this.venta,
  });

  final UltimaVenta venta;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Fecha
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.grey.withOpacity(0.1),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              venta.fecha,
              style: theme.textTheme.bodySmall?.copyWith(
                fontWeight: FontWeight.w500,
              ),
            ),
          ),

          const SizedBox(width: 12),

          // Cliente y albarán
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  venta.cliente,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  'Alb: ${venta.numeroAlbaran}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),

          // Importe
          Text(
            Formatters.currency(venta.importe),
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.bold,
              color: Colors.green[700],
            ),
          ),
        ],
      ),
    );
  }
}
