/// COBROS FILTERS WIDGET
/// Panel de filtros para entregas/cobros

import 'package:flutter/material.dart';

import '../../../../core/theme/app_theme.dart';

class CobrosFilters extends StatefulWidget {
  final Function(String) onEstadoChanged;
  final Function(String) onClienteChanged;
  final String estadoActual;

  const CobrosFilters({
    super.key,
    required this.onEstadoChanged,
    required this.onClienteChanged,
    this.estadoActual = 'todos',
  });

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
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Título
          Row(
            children: [
              Icon(
                Icons.filter_list,
                color: AppTheme.neonPurple,
                size: 18,
              ),
              const SizedBox(width: 8),
              const Text(
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
              color: Colors.white.withOpacity(0.05),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.white.withOpacity(0.08)),
            ),
            child: TextField(
              controller: _searchController,
              style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
              decoration: InputDecoration(
                hintText: 'Buscar cliente...',
                hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
                prefixIcon: Icon(
                  Icons.search,
                  color: AppTheme.textSecondary.withOpacity(0.5),
                  size: 18,
                ),
                border: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
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
                onTap: () => widget.onEstadoChanged(estado['value'] as String),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? AppTheme.neonPurple.withOpacity(0.2)
                        : Colors.white.withOpacity(0.05),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: isSelected
                          ? AppTheme.neonPurple.withOpacity(0.5)
                          : Colors.white.withOpacity(0.1),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        estado['icon'] as IconData,
                        size: 12,
                        color: isSelected
                            ? AppTheme.neonPurple
                            : AppTheme.textSecondary,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        estado['label'] as String,
                        style: TextStyle(
                          color: isSelected
                              ? AppTheme.neonPurple
                              : AppTheme.textSecondary,
                          fontSize: 11,
                          fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
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
