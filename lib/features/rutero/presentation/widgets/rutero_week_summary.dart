import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

class RuteroWeekSummary extends StatelessWidget {
  const RuteroWeekSummary({
    super.key,
    required this.selectedYear,
    required this.selectedMonth,
    required this.selectedWeek,
    required this.weeksInMonth,
    required this.totalUniqueClients,
    required this.weekData,
    required this.selectedDay,
    required this.onWeekChange,
    required this.onDaySelected,
    required this.monthNames,
  });

  final int selectedYear;
  final int selectedMonth;
  final int selectedWeek;
  final int weeksInMonth;
  final int totalUniqueClients;
  final Map<String, int> weekData;
  final String selectedDay;
  final void Function(int delta) onWeekChange;
  final void Function(String day) onDaySelected;
  final List<String> monthNames;

  static const List<String> weekdays = [
    'lunes',
    'martes',
    'miercoles',
    'jueves',
    'viernes',
    'sabado',
    'domingo',
  ];

  static const Map<String, String> weekdayLabels = {
    'lunes': 'LUN',
    'martes': 'MAR',
    'miercoles': 'MIÉ',
    'jueves': 'JUE',
    'viernes': 'VIE',
    'sabado': 'SÁB',
    'domingo': 'DOM',
  };

  (int startDay, int endDay) _getWeekDates(int year, int month, int weekNum) {
    final firstOfMonth = DateTime(year, month);
    final lastOfMonth = DateTime(year, month + 1, 0);
    final firstWeekday = firstOfMonth.weekday;

    var startDay = 1 + (weekNum - 1) * 7 - (firstWeekday - 1);
    if (startDay < 1) startDay = 1;

    var endDay = startDay + 6;
    if (endDay > lastOfMonth.day) endDay = lastOfMonth.day;

    return (startDay, endDay);
  }

  @override
  Widget build(BuildContext context) {
    final (startDay, endDay) =
        _getWeekDates(selectedYear, selectedMonth, selectedWeek);
    final monthName = monthNames[selectedMonth - 1];

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildWeekNavigator(context, startDay, endDay, monthName),
        const SizedBox(height: 4),
        SizedBox(
          height: 50,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: weekdays.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, index) {
              final day = weekdays[index];
              final isSelected = day == selectedDay;
              final count = weekData[day] ?? 0;
              return _CompactDayChip(
                day: day,
                count: count,
                isSelected: isSelected,
                onTap: () => onDaySelected(day),
              );
            },
          ),
        ),
        const SizedBox(height: 4),
      ],
    );
  }

  Widget _buildWeekNavigator(
      BuildContext context, int startDay, int endDay, String monthName) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              IconButton(
                onPressed: () => onWeekChange(-1),
                icon: const Icon(
                  Icons.chevron_left,
                  size: 20,
                  color: Colors.white,
                ),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
              const SizedBox(width: 8),
              Text(
                'Semana $selectedWeek ($startDay - $endDay $monthName)',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: Responsive.isSmall(context) ? 12 : 13,
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                onPressed: () => onWeekChange(1),
                icon: const Icon(
                  Icons.chevron_right,
                  size: 20,
                  color: Colors.white,
                ),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: AppTheme.neonPink.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              'Total: $totalUniqueClients',
              style: TextStyle(
                color: AppTheme.neonPink,
                fontSize: Responsive.isSmall(context) ? 10 : 11,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CompactDayChip extends StatelessWidget {
  const _CompactDayChip({
    required this.day,
    required this.count,
    required this.isSelected,
    required this.onTap,
  });

  final String day;
  final int count;
  final bool isSelected;
  final VoidCallback onTap;

  String get label {
    return RuteroWeekSummary.weekdayLabels[day] ??
        day.substring(0, 3).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 50,
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.neonPink : AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(8),
          border: isSelected ? null : Border.all(color: AppTheme.borderColor),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                color: isSelected ? Colors.white : AppTheme.textSecondary,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              '$count',
              style: TextStyle(
                fontSize: 12,
                color: isSelected ? Colors.white : AppTheme.textPrimary,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
