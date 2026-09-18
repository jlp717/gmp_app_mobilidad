import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/objectives/domain/working_days_calendar.dart';

void main() {
  test('JEFE ALL treats empty and ALL as the company calendar', () {
    expect(
      isAllAgentsObjectivesView(
        isJefeVentas: true,
        includeAllVendorOption: true,
        selectedVendor: 'ALL',
      ),
      isTrue,
    );
    expect(
      isAllAgentsObjectivesView(
        isJefeVentas: true,
        includeAllVendorOption: true,
        selectedVendor: null,
      ),
      isTrue,
    );
    expect(
      isAllAgentsObjectivesView(
        isJefeVentas: true,
        includeAllVendorOption: true,
        selectedVendor: '35',
      ),
      isFalse,
    );
  });

  test('septiembre 2026 ALL is 26 lun–sáb, so pin/26 is 51.182 not 60.487', () {
    expect(countMonSatWorkingDays(2026, 9), 26);
    const pin = 1330723.63;
    expect((pin / 22 * 100).round() / 100, 60487.44);
    expect((pin / 26 * 100).round() / 100, 51181.68);
  });

  test('18 sep 2026 counts 16 lun–sáb days passed', () {
    expect(
      countMonSatDaysPassed(2026, 9, DateTime(2026, 9, 18)),
      16,
    );
  });
}
