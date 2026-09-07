import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/dashboard/domain/dashboard_load_policy.dart';

void main() {
  group('isDashboardManagerRole', () {
    test('true for jefe and admin', () {
      expect(
        isDashboardManagerRole(isJefeVentas: true, role: 'COMERCIAL'),
        isTrue,
      );
      expect(
        isDashboardManagerRole(isJefeVentas: false, role: 'ADMIN'),
        isTrue,
      );
      expect(
        isDashboardManagerRole(isJefeVentas: false, role: 'JEFE_VENTAS'),
        isTrue,
      );
      expect(
        isDashboardManagerRole(isJefeVentas: false, role: ' jefe_ventas '),
        isTrue,
      );
    });

    test('false for scoped commercial', () {
      expect(
        isDashboardManagerRole(isJefeVentas: false, role: 'COMERCIAL'),
        isFalse,
      );
    });
  });

  group('defaultDashboardHierarchy', () {
    test('jefe defaults to vendor-only first paint', () {
      expect(defaultDashboardHierarchy(isJefeVentas: true), ['vendor']);
      expect(
        defaultDashboardHierarchy(
          isJefeVentas: isDashboardManagerRole(
            isJefeVentas: false,
            role: 'JEFE_VENTAS',
          ),
        ),
        ['vendor'],
      );
      expect(
        defaultDashboardHierarchy(
          isJefeVentas: isDashboardManagerRole(
            isJefeVentas: false,
            role: 'ADMIN',
          ),
        ),
        ['vendor'],
      );
    });

    test('comercial keeps vendor+client', () {
      expect(
        defaultDashboardHierarchy(isJefeVentas: false),
        ['vendor', 'client'],
      );
    });
  });

  group('dashboardMatrixRowLimit', () {
    test('shrinks with hierarchy depth', () {
      expect(dashboardMatrixRowLimit(['vendor']), 240);
      expect(dashboardMatrixRowLimit(['vendor', 'client']), 500);
      expect(dashboardMatrixRowLimit(['vendor', 'client', 'product']), 1000);
    });
  });

  group('dashboardMonthsQuery', () {
    test('sorts and joins valid months', () {
      expect(dashboardMonthsQuery({12, 1, 3}), '1,3,12');
    });

    test('drops out-of-range months', () {
      expect(dashboardMonthsQuery({0, 13, 2}), '2');
    });

    test('empty or invalid sets become an empty query param', () {
      expect(dashboardMonthsQuery(<int>{}), '');
      expect(dashboardMonthsQuery({0, 13}), '');
    });
  });
}
