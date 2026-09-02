import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Date range picker dialog
class DateRangePicker extends StatelessWidget {
  const DateRangePicker({
    required this.onDateRangeSelected,
    super.key,
    this.startDate,
    this.endDate,
  });
  final DateTime? startDate;
  final DateTime? endDate;
  final Function(DateTime? start, DateTime? end) onDateRangeSelected;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(
        Icons.calendar_month,
        color: (startDate != null && endDate != null)
            ? AppTheme.success
            : AppTheme.textSecondary,
      ),
      tooltip: 'Seleccionar rango de fechas',
      onPressed: () => _showDateRangePicker(context),
    );
  }

  Future<void> _showDateRangePicker(BuildContext context) async {
    var tempStart = startDate;
    var tempEnd = endDate;

    await showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          backgroundColor: AppTheme.raisedSurface,
          title: Text(
            'Rango de Fechas',
            style: TextStyle(color: AppTheme.textPrimary),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Quick presets
              Wrap(
                spacing: 8,
                children: [
                  _buildPresetChip('Este mes', () {
                    final now = DateTime.now();
                    setState(() {
                      tempStart = DateTime(now.year, now.month);
                      tempEnd = DateTime(now.year, now.month + 1, 0);
                    });
                  }),
                  _buildPresetChip('Este trimestre', () {
                    final now = DateTime.now();
                    final quarter = ((now.month - 1) ~/ 3) + 1;
                    setState(() {
                      tempStart = DateTime(now.year, (quarter - 1) * 3 + 1);
                      tempEnd = DateTime(now.year, quarter * 3 + 1, 0);
                    });
                  }),
                  _buildPresetChip('Este año', () {
                    final now = DateTime.now();
                    setState(() {
                      tempStart = DateTime(now.year);
                      tempEnd = DateTime(now.year, 12, 31);
                    });
                  }),
                ],
              ),
              const SizedBox(height: 16),
              // Date selection
              Row(
                children: [
                  Expanded(
                    child: _buildDateButton(
                      context,
                      'Desde',
                      tempStart,
                      (date) => setState(() => tempStart = date),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _buildDateButton(
                      context,
                      'Hasta',
                      tempEnd,
                      (date) => setState(() => tempEnd = date),
                    ),
                  ),
                ],
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                onDateRangeSelected(null, null);
                Navigator.pop(context);
              },
              child: const Text(
                'Limpiar',
                style: TextStyle(color: AppTheme.error),
              ),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(
                'Cancelar',
                style: TextStyle(color: AppTheme.textTertiary),
              ),
            ),
            ElevatedButton(
              onPressed: tempStart != null && tempEnd != null
                  ? () {
                      onDateRangeSelected(tempStart, tempEnd);
                      Navigator.pop(context);
                    }
                  : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.info,
              ),
              child: const Text('Aplicar'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPresetChip(String label, VoidCallback onTap) {
    return ActionChip(
      label: Text(label, style: const TextStyle(fontSize: 11)),
      onPressed: onTap,
      backgroundColor: AppTheme.inkSurface,
      labelStyle: TextStyle(color: AppTheme.textSecondary),
    );
  }

  Widget _buildDateButton(
    BuildContext context,
    String label,
    DateTime? date,
    Function(DateTime?) onDateSelected,
  ) {
    return OutlinedButton(
      onPressed: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: date ?? DateTime.now(),
          firstDate: DateTime(2020),
          lastDate: DateTime(2030),
          builder: (context, child) {
            return Theme(
              data: ThemeData.dark().copyWith(
                colorScheme: ColorScheme.dark(
                  primary: AppTheme.info,
                  surface: AppTheme.raisedSurface,
                ),
              ),
              child: child!,
            );
          },
        );
        if (picked != null) {
          onDateSelected(picked);
        }
      },
      style: OutlinedButton.styleFrom(
        backgroundColor: AppTheme.inkSurface,
        side:
            BorderSide(color: date != null ? AppTheme.success : AppTheme.textTertiary),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(color: AppTheme.textTertiary, fontSize: 10),
          ),
          const SizedBox(height: 4),
          Text(
            date != null
                ? '${date.day}/${date.month}/${date.year}'
                : '--/--/----',
            style: TextStyle(
              color: date != null ? AppTheme.success : AppTheme.textTertiary,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
