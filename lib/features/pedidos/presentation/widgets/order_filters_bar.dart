/// Order Filters Bar
/// =================
/// Complete filter bar: search, status chips, date range, presets, advanced filters.

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

class OrderFiltersBar extends StatefulWidget {
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

  const OrderFiltersBar({
    Key? key,
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
  }) : super(key: key);

  @override
  State<OrderFiltersBar> createState() => _OrderFiltersBarState();
}

class _OrderFiltersBarState extends State<OrderFiltersBar> {
  bool _showAdvanced = false;
  final _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _searchCtrl.text = widget.searchQuery;
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppTheme.darkSurface,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Search bar
          TextField(
            controller: _searchCtrl,
            style: const TextStyle(color: Colors.white, fontSize: 13),
            decoration: InputDecoration(
              hintText: 'Buscar por pedido, cliente o código...',
              hintStyle: const TextStyle(color: Colors.white38, fontSize: 12),
              prefixIcon:
                  const Icon(Icons.search, color: AppTheme.neonBlue, size: 18),
              suffixIcon: widget.searchQuery.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear,
                          color: Colors.white54, size: 16),
                      onPressed: () {
                        _searchCtrl.clear();
                        widget.onSearchChanged('');
                      },
                    )
                  : null,
              filled: true,
              fillColor: AppTheme.darkCard,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
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
                _statusChip('Borrador', 'BORRADOR', const Color(0xFFF97316)),
                const SizedBox(width: 6),
                _statusChip(
                    'Confirmado', 'CONFIRMADO', const Color(0xFF3B82F6)),
                const SizedBox(width: 6),
                _statusChip('Enviado', 'ENVIADO', const Color(0xFF22C55E)),
                const SizedBox(width: 6),
                _statusChip('Facturado', 'FACTURADO', const Color(0xFFA855F7)),
                const SizedBox(width: 6),
                _statusChip('Anulado', 'ANULADO', const Color(0xFFEF4444)),
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
                  color: AppTheme.neonBlue,
                  size: 16,
                ),
                const SizedBox(width: 4),
                Text(
                  'Más filtros',
                  style: TextStyle(
                    color: AppTheme.neonBlue,
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
                        color: AppTheme.error.withOpacity(0.8),
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
              decoration: BoxDecoration(
                color: AppTheme.darkCard,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: _amountField(
                          'Importe mín.',
                          widget.minAmount,
                          (v) => widget.onMinAmountChanged(v),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _amountField(
                          'Importe máx.',
                          widget.maxAmount,
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
                          value: widget.sortBy,
                          decoration: InputDecoration(
                            labelText: 'Ordenar por',
                            labelStyle: const TextStyle(
                                color: Colors.white54, fontSize: 11),
                            filled: true,
                            fillColor: AppTheme.darkSurface,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide.none,
                            ),
                            contentPadding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 8),
                          ),
                          dropdownColor: AppTheme.darkSurface,
                          style: const TextStyle(
                              color: Colors.white, fontSize: 12),
                          items: const [
                            DropdownMenuItem(
                                value: 'fecha', child: Text('Fecha')),
                            DropdownMenuItem(
                                value: 'importe', child: Text('Importe')),
                            DropdownMenuItem(
                                value: 'cliente', child: Text('Cliente')),
                            DropdownMenuItem(
                                value: 'numero', child: Text('Nº Pedido')),
                          ],
                          onChanged: (v) {
                            if (v != null) widget.onSortByChanged(v);
                          },
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: widget.sortOrder,
                          decoration: InputDecoration(
                            labelText: 'Orden',
                            labelStyle: const TextStyle(
                                color: Colors.white54, fontSize: 11),
                            filled: true,
                            fillColor: AppTheme.darkSurface,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide.none,
                            ),
                            contentPadding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 8),
                          ),
                          dropdownColor: AppTheme.darkSurface,
                          style: const TextStyle(
                              color: Colors.white, fontSize: 12),
                          items: const [
                            DropdownMenuItem(
                                value: 'DESC', child: Text('Descendente')),
                            DropdownMenuItem(
                                value: 'ASC', child: Text('Ascendente')),
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
                        backgroundColor: AppTheme.neonBlue,
                        foregroundColor: AppTheme.darkBase,
                        minimumSize: const Size.fromHeight(38),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                      child: const Text(
                        'Aplicar filtros',
                        style: TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 13),
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
          color: isSelected
              ? (color ?? AppTheme.neonBlue).withOpacity(0.2)
              : AppTheme.darkCard,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected
                ? (color ?? AppTheme.neonBlue).withOpacity(0.5)
                : AppTheme.borderColor,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? (color ?? Colors.white) : Colors.white70,
            fontSize: Responsive.fontSize(context, small: 11, large: 12),
            fontWeight: FontWeight.w600,
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
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Row(
          children: [
            Icon(Icons.calendar_today,
                color: AppTheme.neonBlue.withOpacity(0.7), size: 14),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                date != null
                    ? '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}'
                    : label,
                style: TextStyle(
                  color: date != null ? Colors.white : Colors.white54,
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
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Text(
          label,
          style: const TextStyle(
            color: Colors.white70,
            fontSize: 10,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }

  Widget _amountField(
      String label, double? value, ValueChanged<double?> onChanged) {
    final ctrl = TextEditingController(
      text: value != null ? value.toStringAsFixed(2) : '',
    );
    return TextField(
      controller: ctrl,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      style: const TextStyle(color: Colors.white, fontSize: 12),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Colors.white54, fontSize: 10),
        filled: true,
        fillColor: AppTheme.darkSurface,
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
            colorScheme: const ColorScheme.dark(
              primary: AppTheme.neonBlue,
              onPrimary: Colors.white,
              surface: AppTheme.darkSurface,
              onSurface: Colors.white,
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
        break;
      case 'Semana':
        from = now.subtract(Duration(days: now.weekday - 1));
        from = DateTime(from.year, from.month, from.day);
        break;
      case 'Mes':
        from = DateTime(now.year, now.month, 1);
        break;
      case 'MesAnt':
        from = DateTime(now.year, now.month - 1, 1);
        to = DateTime(now.year, now.month, 0);
        break;
      case '7d':
        from = now.subtract(const Duration(days: 6));
        from = DateTime(from.year, from.month, from.day);
        break;
      case '30d':
        from = now.subtract(const Duration(days: 29));
        from = DateTime(from.year, from.month, from.day);
        break;
      case 'Año':
        from = DateTime(now.year, 1, 1);
        break;
    }

    widget.onDateFromChanged(from);
    widget.onDateToChanged(to);
  }
}
