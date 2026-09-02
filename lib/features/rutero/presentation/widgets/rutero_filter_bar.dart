import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class RuteroFilterBar extends StatelessWidget {
  const RuteroFilterBar({
    required this.searchQuery,
    required this.searchController,
    required this.sortMode,
    required this.selectedAlertType,
    required this.onlyWithAlerts,
    required this.onSearchChanged,
    required this.onSortChanged,
    required this.onAlertTypeChanged,
    required this.onOnlyWithAlertsChanged,
    super.key,
  });

  final String searchQuery;
  final TextEditingController searchController;
  final String sortMode;
  final String selectedAlertType;
  final bool onlyWithAlerts;
  final void Function(String) onSearchChanged;
  final void Function(String) onSortChanged;
  final void Function(String) onAlertTypeChanged;
  final void Function(bool) onOnlyWithAlertsChanged;

  static const Map<String, String> sortModeLabels = {
    'sales_desc': 'Mayor Acumulado',
    'sales_asc': 'Menor Acumulado',
    'route': 'Ruta Original',
    'custom': 'Orden Personalizado',
  };

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        gradient: AppTheme.commandGradient,
        borderRadius: BorderRadius.circular(AppTheme.radiusXl),
        border: Border.all(color: AppTheme.accentRose.withValues(alpha: 0.20)),
        boxShadow: [
          ...AppTheme.elevation2,
          BoxShadow(
            color: AppTheme.accentRose.withValues(alpha: 0.08),
            blurRadius: 24,
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildKpiFilters(context),
          _buildSearchBar(),
          _buildSortSelector(),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      height: 36,
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: TextField(
        controller: searchController,
        style: const TextStyle(fontSize: 13),
        textAlignVertical: TextAlignVertical.center,
        onChanged: onSearchChanged,
        decoration: InputDecoration(
          hintText: 'Buscar...',
          hintStyle: TextStyle(
            color: AppTheme.textSecondary.withValues(alpha: 0.7),
            fontSize: 13,
          ),
          prefixIcon: const Icon(
            Icons.manage_search_rounded,
            size: 16,
            color: AppTheme.accentRose,
          ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 8),
          isDense: true,
          filled: true,
          fillColor: AppTheme.inkSurface.withValues(alpha: 0.48),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            borderSide: BorderSide(
              color: AppTheme.accentRose.withValues(alpha: 0.18),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSortSelector() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Row(
        children: [
          Icon(Icons.sort, size: 16, color: AppTheme.textSecondary),
          const SizedBox(width: 8),
          Text(
            'Ordenar:',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              height: 32,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                gradient: AppTheme.cardGradient,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(
                  color: AppTheme.activeRing.withValues(alpha: 0.14),
                ),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: sortMode,
                  isExpanded: true,
                  icon: Icon(
                    Icons.arrow_drop_down,
                    size: 16,
                    color: AppTheme.textSecondary,
                  ),
                  dropdownColor: AppTheme.raisedSurface,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppTheme.textPrimary,
                  ),
                  items: sortModeLabels.entries
                      .map(
                        (e) => DropdownMenuItem(
                          value: e.key,
                          child: Text(
                            e.value,
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) {
                      onSortChanged(value);
                    }
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildKpiFilters(BuildContext context) {
    final alertTypes = {
      'ALL': 'Filtro Alertas: Todas',
      'DESVIACION_VENTAS': 'Ventas vs Objetivo',
      'CUOTA_SIN_COMPRA': 'Sin Compras',
      'DESVIACION_REFERENCIACION': 'Productos Pendientes',
      'PROMOCION': 'Promociones',
      'ALTA_CLIENTE': 'Cliente Nuevo',
      'AVISO': 'Avisos',
      'MEDIOS_CLIENTE': 'Equipamiento',
    };

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Container(
              height: 32,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                gradient: AppTheme.cardGradient,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(
                  color: selectedAlertType != 'ALL'
                      ? AppTheme.accentRose
                      : AppTheme.activeRing.withValues(alpha: 0.14),
                ),
                boxShadow: selectedAlertType != 'ALL'
                    ? [
                        BoxShadow(
                          color: AppTheme.accentRose.withValues(alpha: 0.12),
                          blurRadius: 16,
                        ),
                      ]
                    : null,
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: selectedAlertType,
                  isExpanded: true,
                  dropdownColor: AppTheme.raisedSurface,
                  icon: Icon(
                    Icons.bolt,
                    size: 14,
                    color: selectedAlertType != 'ALL'
                        ? AppTheme.accentRose
                        : AppTheme.textSecondary,
                  ),
                  style: TextStyle(
                    fontSize: 11,
                    color: selectedAlertType != 'ALL'
                        ? AppTheme.accentRose
                        : AppTheme.textPrimary,
                    fontWeight: selectedAlertType != 'ALL'
                        ? FontWeight.bold
                        : FontWeight.normal,
                  ),
                  items: alertTypes.entries
                      .map(
                        (e) => DropdownMenuItem(
                          value: e.key,
                          child: Text(e.value),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) {
                      onAlertTypeChanged(value);
                    }
                  },
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            height: 32,
            child: FilterChip(
              label: const Text('Con Alertas'),
              selected: onlyWithAlerts,
              selectedColor: AppTheme.accentRose.withValues(alpha: 0.2),
              backgroundColor: AppTheme.surfaceCommand,
              checkmarkColor: AppTheme.accentRose,
              padding: EdgeInsets.zero,
              labelStyle: TextStyle(
                fontSize: 10,
                color: onlyWithAlerts
                    ? AppTheme.accentRose
                    : AppTheme.textSecondary,
                fontWeight:
                    onlyWithAlerts ? FontWeight.bold : FontWeight.normal,
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
                side: BorderSide(
                  color: onlyWithAlerts
                      ? AppTheme.accentRose
                      : AppTheme.activeRing.withValues(alpha: 0.14),
                ),
              ),
              onSelected: onOnlyWithAlertsChanged,
            ),
          ),
        ],
      ),
    );
  }
}
