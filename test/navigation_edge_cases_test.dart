// GMP Navigation Edge Cases Tests
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/services/navigation_config_service.dart';

void main() {
  group('Navigation Edge Cases Tests', () {
    test('all roles return non-empty list', () {
      final almacen = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(almacen.isNotEmpty, true);

      final repartidor = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(repartidor.isNotEmpty, true);

      final comercial = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: true,
      );
      expect(comercial.isNotEmpty, true);

      final jefe = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: true,
      );
      expect(jefe.isNotEmpty, true);
    });

    test('no role gets empty list from ventas items', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(items.isEmpty, false);
    });

    test('all items have non-empty labels', () {
      final allCombos = [
        [true, false, false, false],
        [false, true, false, false],
        [false, false, true, true],
      ];

      for (final combo in allCombos) {
        final items = NavigationConfigService.getNavItems(
          isAlmacen: combo[0],
          isRepartidor: combo[1],
          isJefeVentas: combo[2],
          showCommissions: combo[3],
        );

        for (final item in items) {
          expect(item.label.isNotEmpty, true,
              reason: 'Item with empty label found');
        }
      }
    });

    test('all items have valid colors', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );

      for (final item in items) {
        expect(item.color.value, greaterThan(0));
      }
    });

    test('items are returned in consistent order for same role', () {
      final items1 = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );

      final items2 = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );

      for (var i = 0; i < items1.length; i++) {
        expect(items1[i].label, items2[i].label);
      }
    });
  });

  group('Navigation Permission Tests', () {
    test('almacen never sees Panel', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(items.any((i) => i.label == 'Panel'), false);
    });

    test('almacen never sees Clientes', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(items.any((i) => i.label == 'Clientes'), false);
    });

    test('repartidor never sees Objetivo', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(items.any((i) => i.label == 'Objetivos'), false);
    });

    test('repartidor never sees Facturas', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(items.any((i) => i.label == 'Facturas'), false);
    });

    test('comercial sees correct items', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: true,
      );

      expect(items.any((i) => i.label == 'Clientes'), true);
      expect(items.any((i) => i.label == 'Ruta'), true);
      expect(items.any((i) => i.label == 'Facturas'), true);
      expect(items.any((i) => i.label == 'Pedidos'), true);
    });
  });
}
