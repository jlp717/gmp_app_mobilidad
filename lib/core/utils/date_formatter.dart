/// Spanish date formatting utilities
class DateFormatter {
  // Spanish month names
  static const List<String> monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  static const List<String> monthNamesShort = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
  ];

  /// Get Spanish month name from number (1-12)
  static String getMonthName(int month, {bool short = false}) {
    if (month < 1 || month > 12) return '';
    return short ? monthNamesShort[month - 1] : monthNames[month - 1];
  }

  /// Format week: "Semana 12 (20-26 Mar)"
  static String formatWeek(int week, {int? weekStart, int? weekEnd, int? month}) {
    if (weekStart != null && weekEnd != null && month != null) {
      final monthShort = getMonthName(month, short: true);
      return 'Semana $week ($weekStart-$weekEnd $monthShort)';
    }
    return 'Semana $week';
  }

  /// Format period based on granularity
  static String formatPeriod(String periodStr, String granularity) {
    if (granularity == 'week') {
      // Format: "2025-W12" -> "Semana 12"
      final parts = periodStr.split('-W');
      if (parts.length == 2) {
        return 'Semana ${parts[1]}';
      }
    } else {
      // Format: "2025-03" -> "Marzo 2025"
      final parts = periodStr.split('-');
      if (parts.length == 2) {
        final year = parts[0];
        final month = int.tryParse(parts[1]);
        if (month != null) {
          return '${getMonthName(month)} $year';
        }
      }
    }
    return periodStr;
  }
}
