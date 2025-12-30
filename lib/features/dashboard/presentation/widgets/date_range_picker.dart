import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/date_formatter.dart';

/// Date range picker dialog
class DateRangePicker extends StatelessWidget {
  final DateTime? startDate;
  final DateTime? endDate;
  final Function(DateTime? start, DateTime? end) onDateRangeSelected;

  const DateRangePicker({
    super.key,
    this.startDate,
    this.endDate,
    required this.onDateRangeSelected,
  });

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(
        Icons.calendar_month,
        color: (startDate != null && endDate != null) ? AppTheme.neonGreen : Colors.white70,
      ),
      tooltip: 'Seleccionar rango de fechas',
      onPressed: () => _showDateRangePicker(context),
    );
  }

  Future<void> _showDateRangePicker(BuildContext context) async {
    DateTime? tempStart = startDate;
    DateTime? tempEnd = endDate;

    await showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          backgroundColor: AppTheme.surfaceColor,
          title: const Text('Rango de Fechas', style: TextStyle(color: Colors.white)),
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
                      tempStart = DateTime(now.year, now.month, 1);
                      tempEnd = DateTime(now.year, now.month + 1, 0);
                    });
                  }),
                  _buildPresetChip('Este trimestre', () {
                    final now = DateTime.now();
                    final quarter = ((now.month - 1) ~/ 3) + 1;
                    setState(() {
                      tempStart = DateTime(now.year, (quarter - 1) * 3 + 1, 1);
                      tempEnd = DateTime(now.year, quarter * 3 + 1, 0);
                    });
                  }),
                  _buildPresetChip('Este año', () {
                    final now = DateTime.now();
                    setState(() {
                      tempStart = DateTime(now.year, 1, 1);
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
              child: const Text('Limpiar', style: TextStyle(color: Colors.redAccent)),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              onPressed: tempStart != null && tempEnd != null
                  ? () {
                      onDateRangeSelected(tempStart, tempEnd);
                      Navigator.pop(context);
                    }
                  : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.neonBlue,
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
      backgroundColor: AppTheme.darkBase,
      labelStyle: const TextStyle(color: Colors.white70),
    );
  }

  Widget _buildDateButton(BuildContext context, String label, DateTime? date, Function(DateTime?) onDateSelected) {
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
                  primary: AppTheme.neonBlue,
                  surface: AppTheme.surfaceColor,
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
        backgroundColor: AppTheme.darkBase,
        side: BorderSide(color: date != null ? AppTheme.neonGreen : Colors.white30),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: const TextStyle(color: Colors.white54, fontSize: 10)),
          const SizedBox(height: 4),
          Text(
            date != null ? '${date.day}/${date.month}/${date.year}' : '--/--/----',
            style: TextStyle(
              color: date != null ? AppTheme.neonGreen : Colors.white30,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
