/// Calendario de ritmo diario ALL: lunes a sábado, sin domingo.
///
/// JEFE ALL no usa el rutero de un comercial. GMP vende en sábado, así que
/// Necesitas/día = pin del mes / días lun–sáb (26 en sept 2026, no 22 lun–vie).
library;

const _nationalHolidays = <String>{
  '1-1',
  '1-6',
  '5-1',
  '8-15',
  '10-12',
  '11-1',
  '12-6',
  '12-8',
  '12-25',
};

bool isAllAgentsObjectivesView({
  required bool isJefeVentas,
  required bool includeAllVendorOption,
  required String? selectedVendor,
}) {
  if (!isJefeVentas || !includeAllVendorOption) return false;
  final code = (selectedVendor ?? '').trim();
  return code.isEmpty || code.toUpperCase() == 'ALL';
}

int countMonSatWorkingDays(int year, int month) {
  final lastDay = DateTime(year, month + 1, 0).day;
  return _countMonSat(year, month, lastDay);
}

int countMonSatDaysPassed(int year, int month, DateTime now) {
  if (year < now.year || (year == now.year && month < now.month)) {
    return countMonSatWorkingDays(year, month);
  }
  if (year > now.year || (year == now.year && month > now.month)) {
    return 0;
  }
  return _countMonSat(year, month, now.day);
}

int _countMonSat(int year, int month, int lastDay) {
  var count = 0;
  for (var day = 1; day <= lastDay; day++) {
    final date = DateTime(year, month, day);
    if (date.weekday == DateTime.sunday) continue;
    if (_nationalHolidays.contains('${date.month}-${date.day}')) continue;
    count++;
  }
  return count;
}
