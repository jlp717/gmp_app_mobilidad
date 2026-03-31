/// Order Empty State
/// =================
/// Contextual empty state with illustration and CTA.

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

class OrderEmptyState extends StatelessWidget {
  final bool hasActiveFilters;
  final VoidCallback? onClearFilters;

  const OrderEmptyState({
    Key? key,
    this.hasActiveFilters = false,
    this.onClearFilters,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              hasActiveFilters
                  ? Icons.filter_list_off_outlined
                  : Icons.receipt_long_outlined,
              color: Colors.white24,
              size: 56,
            ),
            const SizedBox(height: 16),
            Text(
              hasActiveFilters ? 'Sin resultados' : 'No hay pedidos',
              style: TextStyle(
                color: Colors.white54,
                fontSize: Responsive.fontSize(context, small: 15, large: 17),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              hasActiveFilters
                  ? 'Prueba a cambiar los filtros de búsqueda'
                  : 'Los pedidos confirmados aparecerán aquí',
              style: TextStyle(
                color: Colors.white38,
                fontSize: Responsive.fontSize(context, small: 12, large: 14),
              ),
              textAlign: TextAlign.center,
            ),
            if (hasActiveFilters && onClearFilters != null) ...[
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: onClearFilters,
                icon: const Icon(Icons.clear_all, size: 16),
                label: const Text('Limpiar filtros'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.neonBlue,
                  foregroundColor: AppTheme.darkBase,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
