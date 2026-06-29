/// COBROS FILTERS WIDGET
/// Panel de filtros para entregas/cobros
library;

import 'package:flutter/material.dart';

import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

class CobrosFilters extends StatefulWidget {
  const CobrosFilters({
    required this.onEstadoChanged,
    required this.onClienteChanged,
    super.key,
    this.estadoActual = 'todos',
  });
  final Function(String) onEstadoChanged;
  final Function(String) onClienteChanged;
  final String estadoActual;

  @override
  State<CobrosFilters> createState() => _CobrosFiltersState();
}

class _CobrosFiltersState extends State<CobrosFilters> {
  final _searchController = TextEditingController();

  final _estados = [
    {'value': 'todos', 'label': 'Todos', 'icon': Icons.all_inclusive},
    {'value': 'pendiente', 'label': 'Pendientes', 'icon': Icons.schedule},
    {'value': 'enRuta', 'label': 'En Ruta', 'icon': Icons.local_shipping},
    {'value': 'entregado', 'label': 'Entregados', 'icon': Icons.check_circle},
    {'value': 'parcial', 'label': 'Parciales', 'icon': Icons.pending},
  ];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding:
          EdgeInsets.all(Responsive.padding(context, small: 10, large: 16)),
      decoration: BoxDecoration(
        gradient: AppTheme.commandGradient,
        borderRadius: BorderRadius.circular(AppTheme.radiusXl),
        border:
            Border.all(color: AppTheme.accentIndigo.withValues(alpha: 0.28)),
        boxShadow: [
          ...AppTheme.elevation2,
          BoxShadow(
            color: AppTheme.accentIndigo.withValues(alpha: 0.09),
            blurRadius: 24,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Título
          const Row(
            children: [
              Icon(
                Icons.tune_rounded,
                color: AppTheme.accentIndigo,
                size: 18,
              ),
              SizedBox(width: 8),
              Text(
                'Filtros',
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // Buscador
          Container(
            decoration: BoxDecoration(
              gradient: AppTheme.cardGradient,
              borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              border: Border.all(
                color: AppTheme.accentIndigo.withValues(alpha: 0.18),
              ),
            ),
            child: TextField(
              controller: _searchController,
              style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
              decoration: InputDecoration(
                hintText: 'Buscar cliente...',
                hintStyle: TextStyle(
                    color: AppTheme.textSecondary.withValues(alpha: 0.5)),
                prefixIcon: Icon(
                  Icons.manage_search_rounded,
                  color: AppTheme.accentIndigo.withValues(alpha: 0.82),
                  size: 18,
                ),
                border: InputBorder.none,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              ),
              onChanged: widget.onClienteChanged,
            ),
          ),

          const SizedBox(height: 16),

          // Estados
          const Text(
            'Estado',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 8),

          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: _estados.map((estado) {
              final isSelected = widget.estadoActual == estado['value'];
              return GestureDetector(
                onTap: () => widget.onEstadoChanged(estado['value']! as String),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? AppTheme.accentIndigo.withValues(alpha: 0.24)
                        : AppTheme.surfaceCommand,
                    borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                    border: Border.all(
                      color: isSelected
                          ? AppTheme.accentIndigo.withValues(alpha: 0.5)
                          : AppTheme.activeRing.withValues(alpha: 0.12),
                    ),
                    boxShadow: isSelected
                        ? [
                            BoxShadow(
                              color:
                                  AppTheme.accentIndigo.withValues(alpha: 0.13),
                              blurRadius: 16,
                            ),
                          ]
                        : null,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        estado['icon']! as IconData,
                        size: 12,
                        color: isSelected
                            ? AppTheme.accentIndigo
                            : AppTheme.textSecondary,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        estado['label']! as String,
                        style: TextStyle(
                          color: isSelected
                              ? AppTheme.accentIndigo
                              : AppTheme.textSecondary,
                          fontSize: 11,
                          fontWeight:
                              isSelected ? FontWeight.w600 : FontWeight.normal,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}
