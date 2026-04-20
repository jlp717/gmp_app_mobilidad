// GMP Services Unit Tests
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/services/navigation_config_service.dart';

void main() {
  group('NavigationConfigService - Comprehensive Tests', () {
    test('Almacen has exactly 5 items in order', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );

      expect(items.length, 5);
      expect(items[0].label, 'Expediciones');
      expect(items[1].label, 'Vehiculos');
      expect(items[2].label, 'Articulos');
      expect(items[3].label, 'Historial');
      expect(items[4].label, 'Personal');
    });

    test('Repartidor regular has exactly 4 items', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: false,
        showCommissions: false,
      );

      expect(items.length, 4);
      expect(items.any((i) => i.label == 'Panel'), false);
      expect(items[0].label, 'Clientes');
    });

    test('Repartidor (jefe) has Panel as first item', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: true,
        showCommissions: false,
      );

      expect(items.length, 5);
      expect(items[0].label, 'Panel');
    });

    test('Jefe Ventas has all items', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: true,
      );

      expect(items.length, 10);
      expect(items[0].label, 'Panel');
    });

    test('Comercial shows Comisiones when showCommissions is true', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: true,
      );

      expect(items.any((i) => i.label == 'Comisiones'), true);
    });

    test('Comercial hides Comisiones when showCommissions is false', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );

      expect(items.any((i) => i.label == 'Comisiones'), false);
    });

    test('NavItem has correct icon type', () {
      final item = NavItem(
        icon: Icons.home,
        selectedIcon: Icons.home_filled,
        label: 'Test',
        color: Colors.green,
      );

      expect(item.icon, Icons.home);
      expect(item.selectedIcon, Icons.home_filled);
    });
  });
}
