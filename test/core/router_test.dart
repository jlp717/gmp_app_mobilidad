// GMP App Router Test
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/navigation/app_router.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';

void main() {
  group('AppRouter Tests', () {
    test('AppRouter initializes with all pages', () {
      final router = AppRouter();

      expect(router.pages.isNotEmpty, true);
      expect(router.pages.containsKey('panel'), true);
      expect(router.pages.containsKey('clientes'), true);
      expect(router.pages.containsKey('pedidos'), true);
    });

    test('getRouteForId returns correct route', () {
      final router = AppRouter();

      expect(router.getRouteForId('panel'), '/panel');
      expect(router.getRouteForId('clientes'), '/clientes');
      expect(router.getRouteForId('pedidos'), '/pedidos');
    });

    test('getPagesForUser filters by role correctly', () {
      final router = AppRouter();

      final jefeUser = UserModel(
        id: '1',
        code: '01',
        name: 'Test User',
        company: 'GMP',
        role: 'JEFE_VENTAS',
        isJefeVentas: true,
      );

      final pages = router.getPagesForUser(jefeUser);

      expect(pages.isNotEmpty, true);
      expect(pages.any((p) => p.route == '/panel'), true);
    });

    test('getPagesForUser returns empty for null user', () {
      final router = AppRouter();

      final pages = router.getPagesForUser(null);

      expect(pages, isEmpty);
    });

    test('getDefaultIndex returns correct index for role', () {
      final router = AppRouter();

      final jefeUser = UserModel(
        id: '1',
        code: '01',
        name: 'Test User',
        company: 'GMP',
        role: 'JEFE_VENTAS',
        isJefeVentas: true,
      );

      expect(router.getDefaultIndex(jefeUser), 0);
    });

    test('getDefaultPage returns route for user role', () {
      final router = AppRouter();

      final jefeUser = UserModel(
        id: '1',
        code: '01',
        name: 'Test User',
        company: 'GMP',
        role: 'JEFE_VENTAS',
        isJefeVentas: true,
      );

      expect(router.getDefaultPage(jefeUser), 'panel');
    });

    test('getIdForRoute returns correct id', () {
      final router = AppRouter();

      expect(router.getIdForRoute('/panel'), 'panel');
      expect(router.getIdForRoute('/clientes'), 'clientes');
    });
  });
}
