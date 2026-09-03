/// Order Filters Bar
/// =================
/// Complete filter bar: search, status chips, date range, presets, advanced filters.
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

class OrderFiltersBar extends StatefulWidget {
  const OrderFiltersBar({
    required this.searchQuery,
    required this.statusFilter,
    required this.dateFrom,
    required this.dateTo,
    required this.minAmount,
    required this.maxAmount,
    required this.sortBy,
    required this.sortOrder,
    required this.onSearchChanged,
    required this.onStatusChanged,
    required this.onDateFromChanged,
    required this.onDateToChanged,
    required this.onMinAmountChanged,
    required this.onMaxAmountChanged,
    required this.onSortByChanged,
    required this.onSortOrderChanged,
    required this.onApplyAdvanced,
    required this.onClearAll,
    super.key,
  });
  final String searchQuery;
  final String? statusFilter;
  final DateTime? dateFrom;
  final DateTime? dateTo;
  final double? minAmount;
  final double? maxAmount;
  final String sortBy;
  final String sortOrder;

  final ValueChanged<String> onSearchChanged;
  final ValueChanged<String?> onStatusChanged;
  final ValueChanged<DateTime?> onDateFromChanged;
  final ValueChanged<DateTime?> onDateToChanged;
  final ValueChanged<double?> onMinAmountChanged;
  final ValueChanged<double?> onMaxAmountChanged;
  final ValueChanged<String> onSortByChanged;
  final ValueChanged<String> onSortOrderChanged;
  final VoidCallback onApplyAdvanced;
  final VoidCallback onClearAll;

  @override
  State<OrderFiltersBar> createState() => _OrderFiltersBarState();
}

class _OrderFiltersBarState extends State<OrderFiltersBar> {
  bool _showAdvanced = false;
  final _searchCtrl = TextEditingController();
  final _minAmountCtrl = TextEditingController();
  final _maxAmountCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _searchCtrl.text = widget.searchQuery;
    _minAmountCtrl.text =
        widget.minAmount != null ? widget.minAmount!.toStringAsFixed(2) : '';
    _maxAmountCtrl.text =
        widget.maxAmount != null ? widget.maxAmount!.toStringAsFixed(2) : '';
  }

  @override
  void didUpdateWidget(covariant OrderFiltersBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Sincronizar el texto cuando el padre limpia los filtros desde fuera
    // ("Limpiar"): antes el TextField conservaba el texto antiguo aunque
    // el filtro ya estuviera vacío.
    if (widget.searchQuery != oldWidget.searchQuery &&
        widget.searchQuery != _searchCtrl.text.trim()) {
      _searchCtrl.text = widget.searchQuery;
    }
    if (widget.minAmount == null &&
        oldWidget.minAmount != null &&
        _minAmountCtrl.text.isNotEmpty) {
      _minAmountCtrl.clear();
    }
    if (widget.maxAmount == null &&
        oldWidget.maxAmount != null &&
        _maxAmountCtrl.text.isNotEmpty) {
      _maxAmountCtrl.clear();
    }
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    _minAmountCtrl.dispose();
    _maxAmountCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        gradient: AppTheme.commandGradient,
        border: Border(
          bottom:
              BorderSide(color: AppTheme.activeRing.withValues(alpha: 0.18)),
        ),
        boxShadow: [
          ...AppTheme.elevation2,
          BoxShadow(
            color: AppTheme.activeRing.withValues(alpha: 0.06),
            blurRadius: 24,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Search bar
          TextField(
            controller: _searchCtrl,
            style: TextStyle(color: AppColors.themedWhite, fontSize: 13),
            decoration: InputDecoration(
              hintText: 'Buscar por pedido, cliente o código...',
              hintStyle:
                  TextStyle(color: AppColors.themedWhite38, fontSize: 12),
              prefixIcon: const Icon(
                Icons.manage_search_rounded,
                color: AppTheme.activeRing,
                size: 20,
              ),
              suffixIcon: widget.searchQuery.isNotEmpty
                  ? IconButton(
                      icon: Icon(
                        Icons.clear,
                        color: AppColors.themedWhite54,
                        size: 16,
                      ),
                      onPressed: () {
                        _searchCtrl.clear();
                        widget.onSearchChanged('');
                      },
                    )
                  : null,
              filled: true,
              fillColor: AppTheme.inkSurface.withValues(alpha: 0.56),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                borderSide: BorderSide(
                  color: AppTheme.activeRing.withValues(alpha: 0.14),
                ),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                borderSide: BorderSide(
                  color: AppTheme.activeRing.withValues(alpha: 0.14),
                ),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                borderSide:
                    const BorderSide(color: AppTheme.activeRing, width: 1.6),
              ),
            ),
            onChanged: (v) => widget.onSearchChanged(v.trim()),
          ),
          const SizedBox(height: 8),
          // Status chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _statusChip('Todos', null, null),
                const SizedBox(width: 6),
                _statusChip('Borrador', 'BORRADOR', AppColors.legacyFFF97316),
                const SizedBox(width: 6),
                _statusChip(
                  'Confirmado',
                  'CONFIRMADO',
                  AppColors.legacyFF22C55E,
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          // Date range
          Row(
            children: [
              Expanded(
                child: _dateField(
                  'Desde',
                  widget.dateFrom,
                  () => _pickDate(context, true),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _dateField(
                  'Hasta',
                  widget.dateTo,
                  () => _pickDate(context, false),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          // Date presets
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _presetChip('Hoy', () => _setPreset('Hoy')),
                const SizedBox(width: 4),
                _presetChip('Semana', () => _setPreset('Semana')),
                const SizedBox(width: 4),
                _presetChip('Mes', () => _setPreset('Mes')),
                const SizedBox(width: 4),
                _presetChip('Año', () => _setPreset('Año')),
                const SizedBox(width: 4),
                _presetChip('7 días', () => _setPreset('7d')),
                const SizedBox(width: 4),
                _presetChip('30 días', () => _setPreset('30d')),
                const SizedBox(width: 4),
                _presetChip('Mes ant.', () => _setPreset('MesAnt')),
              ],
            ),
          ),
          // Advanced toggle
          const SizedBox(height: 6),
          GestureDetector(
            onTap: () => setState(() => _showAdvanced = !_showAdvanced),
            child: Row(
              children: [
                Icon(
                  _showAdvanced ? Icons.expand_less : Icons.expand_more,
                  color: AppTheme.info,
                  size: 16,
                ),
                const SizedBox(width: 4),
                const Text(
                  'Más filtros',
                  style: TextStyle(
                    color: AppTheme.info,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                if (_hasAdvancedFilters)
                  GestureDetector(
                    onTap: widget.onClearAll,
                    child: Text(
                      'Limpiar',
                      style: TextStyle(
                        color: AppTheme.error.withValues(alpha: 0.8),
                        fontSize: 11,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          // Advanced filters
          if (_showAdvanced) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: AppTheme.glassMorphism(),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: _amountField(
                          'Importe mín.',
                          _minAmountCtrl,
                          (v) => widget.onMinAmountChanged(v),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _amountField(
                          'Importe máx.',
                          _maxAmountCtrl,
                          (v) => widget.onMaxAmountChanged(v),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          initialValue: widget.sortBy,
                          decoration: InputDecoration(
                            labelText: 'Ordenar por',
                            labelStyle: TextStyle(
                              color: AppColors.themedWhite54,
                              fontSize: 11,
                            ),
                            filled: true,
                            fillColor: AppTheme.raisedSurface,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide.none,
                            ),
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 8,
                            ),
                          ),
                          dropdownColor: AppTheme.raisedSurface,
                          style: TextStyle(
                            color: AppColors.themedWhite,
                            fontSize: 12,
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'fecha',
                              child: Text('Fecha'),
                            ),
                            DropdownMenuItem(
                              value: 'importe',
                              child: Text('Importe'),
                            ),
                            DropdownMenuItem(
                              value: 'cliente',
                              child: Text('Cliente'),
                            ),
                            DropdownMenuItem(
                              value: 'numero',
                              child: Text('Nº Pedido'),
                            ),
                          ],
                          onChanged: (v) {
                            if (v != null) widget.onSortByChanged(v);
                          },
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          initialValue: widget.sortOrder,
                          decoration: InputDecoration(
                            labelText: 'Orden',
                            labelStyle: TextStyle(
                              color: AppColors.themedWhite54,
                              fontSize: 11,
                            ),
                            filled: true,
                            fillColor: AppTheme.raisedSurface,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide.none,
                            ),
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 8,
                            ),
                          ),
                          dropdownColor: AppTheme.raisedSurface,
                          style: TextStyle(
                            color: AppColors.themedWhite,
                            fontSize: 12,
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'DESC',
                              child: Text('Descendente'),
                            ),
                            DropdownMenuItem(
                              value: 'ASC',
                              child: Text('Ascendente'),
                            ),
                          ],
                          onChanged: (v) {
                            if (v != null) widget.onSortOrderChanged(v);
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: widget.onApplyAdvanced,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.info,
                        foregroundColor: AppTheme.inkSurface,
                        minimumSize: const Size.fromHeight(38),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                      child: const Text(
                        'Aplicar filtros',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _statusChip(String label, String? status, Color? color) {
    final isSelected = widget.statusFilter == status;
    return GestureDetector(
      onTap: () => widget.onStatusChanged(status),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          gradient: isSelected
              ? LinearGradient(
                  colors: [
                    (color ?? AppTheme.activeRing).withValues(alpha: 0.26),
                    (color ?? AppTheme.activeRing).withValues(alpha: 0.08),
                  ],
                )
              : null,
          color:
              isSelected ? null : AppTheme.inkSurface.withValues(alpha: 0.42),
          borderRadius: BorderRadius.circular(AppTheme.radiusFull),
          border: Border.all(
            color: isSelected
                ? (color ?? AppTheme.activeRing).withValues(alpha: 0.55)
                : AppTheme.activeRing.withValues(alpha: 0.12),
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color:
                        (color ?? AppTheme.activeRing).withValues(alpha: 0.14),
                    blurRadius: 16,
                  ),
                ]
              : null,
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected
                ? (color ?? AppTheme.activeRing)
                : AppTheme.textSecondary,
            fontSize: Responsive.fontSize(context, small: 11, large: 12),
            fontWeight: isSelected ? FontWeight.w800 : FontWeight.w600,
          ),
        ),
      ),
    );
  }

  Widget _dateField(String label, DateTime? date, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          gradient: AppTheme.cardGradient,
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border:
              Border.all(color: AppTheme.activeRing.withValues(alpha: 0.14)),
        ),
        child: Row(
          children: [
            Icon(
              Icons.calendar_today,
              color: AppTheme.activeRing.withValues(alpha: 0.82),
              size: 14,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                date != null
                    ? '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}'
                    : label,
                style: TextStyle(
                  color: date != null
                      ? AppColors.themedWhite
                      : AppColors.themedWhite54,
                  fontSize: 11,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _presetChip(String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: AppTheme.surfaceCommand,
          borderRadius: BorderRadius.circular(AppTheme.radiusFull),
          border:
              Border.all(color: AppTheme.activeRing.withValues(alpha: 0.14)),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: AppColors.themedWhite70,
            fontSize: 10,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }

  Widget _amountField(
    String label,
    TextEditingController ctrl,
    ValueChanged<double?> onChanged,
  ) {
    // Controlador persistente: crear uno nuevo en cada build reseteaba el
    // texto y el cursor con cada pulsación (no se podía teclear el importe).
    return TextField(
      controller: ctrl,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      style: TextStyle(color: AppColors.themedWhite, fontSize: 12),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: AppColors.themedWhite54, fontSize: 10),
        filled: true,
        fillColor: AppTheme.raisedSurface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        isDense: true,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide.none,
        ),
      ),
      onChanged: (v) {
        final normalized = v.replaceAll(',', '.').trim();
        onChanged(normalized.isEmpty ? null : double.tryParse(normalized));
      },
    );
  }

  bool get _hasAdvancedFilters =>
      widget.minAmount != null ||
      widget.maxAmount != null ||
      widget.sortBy != 'fecha' ||
      widget.sortOrder != 'DESC';

  Future<void> _pickDate(BuildContext context, bool isFrom) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom
          ? widget.dateFrom ?? DateTime.now()
          : widget.dateTo ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
      builder: (ctx, child) {
        return Theme(
          data: Theme.of(ctx).copyWith(
            colorScheme: ColorScheme.dark(
              primary: AppTheme.info,
              onPrimary: AppColors.themedWhite,
              surface: AppTheme.raisedSurface,
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked != null) {
      if (isFrom) {
        widget.onDateFromChanged(picked);
      } else {
        widget.onDateToChanged(picked);
      }
    }
  }

  void _setPreset(String preset) {
    final now = DateTime.now();
    DateTime? from;
    DateTime? to = now;

    switch (preset) {
      case 'Hoy':
        from = DateTime(now.year, now.month, now.day);
        to = from;
      case 'Semana':
        from = now.subtract(Duration(days: now.weekday - 1));
        from = DateTime(from.year, from.month, from.day);
      case 'Mes':
        from = DateTime(now.year, now.month);
      case 'MesAnt':
        from = DateTime(now.year, now.month - 1);
        to = DateTime(now.year, now.month, 0);
      case '7d':
        from = now.subtract(const Duration(days: 6));
        from = DateTime(from.year, from.month, from.day);
      case '30d':
        from = now.subtract(const Duration(days: 29));
        from = DateTime(from.year, from.month, from.day);
      case 'Año':
        from = DateTime(now.year);
    }

    widget.onDateFromChanged(from);
    widget.onDateToChanged(to);
  }
}
