import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';

class BolsaMovementTypeFilters extends StatelessWidget {
  const BolsaMovementTypeFilters({
    required this.selectedType,
    required this.totalCount,
    required this.counts,
    required this.onSelected,
    super.key,
  });

  final BolsaMovimientoTipo? selectedType;
  final int totalCount;
  final Map<BolsaMovimientoTipo, int> counts;
  final ValueChanged<BolsaMovimientoTipo?> onSelected;

  @override
  Widget build(BuildContext context) {
    final filters = [
      _buildFilter('Todos', null, Icons.list_alt),
      _buildFilter(
        'Acumulación',
        BolsaMovimientoTipo.acumulacion,
        Icons.trending_up,
      ),
      _buildFilter(
        'Consumo',
        BolsaMovimientoTipo.consumo,
        Icons.trending_down,
      ),
      _buildFilter('Ajustes', BolsaMovimientoTipo.ajuste, Icons.tune),
    ];
    return LayoutBuilder(
      builder: (context, constraints) => Semantics(
        container: true,
        label: 'Tipo de movimiento',
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final filter in filters)
                ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: constraints.maxWidth),
                  child: filter,
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilter(
    String label,
    BolsaMovimientoTipo? type,
    IconData icon,
  ) {
    final selected = selectedType == type;
    final count = type == null ? totalCount : counts[type] ?? 0;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Semantics(
        key: ValueKey('bolsa-type-${type?.name ?? 'all'}'),
        selected: selected,
        child: OutlinedButton.icon(
          onPressed: () => onSelected(type),
          icon: Icon(selected ? Icons.check_rounded : icon),
          label: Text('$label · $count'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(56, 56),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            foregroundColor: AppColors.themedWhite,
            backgroundColor: selected
                ? AppTheme.info.withValues(alpha: 0.16)
                : AppTheme.inkSurface.withValues(alpha: 0.34),
            side: BorderSide(
              color: selected ? AppTheme.info : AppTheme.borderColor,
              width: selected ? 2 : 1,
            ),
            textStyle: TextStyle(
              fontSize: 18,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}
