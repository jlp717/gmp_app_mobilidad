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
      expect(items[1].label, 'Vehículos');
      expect(items[2].label, 'Artículos');
      expect(items[3].label, 'Historial');
      expect(items[4].label, 'Personal');
    });

    test('Repartidor regular has financial items isolated from sales', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: false,
        showCommissions: true,
      );

      expect(items.length, 8);
      expect(items.any((i) => i.label == 'Panel'), false);
      expect(items[0].label, 'Clientes');
      expect(items.any((i) => i.label == 'Liquidación'), true);
      expect(items.any((i) => i.label == 'Vencimientos'), true);
      expect(items.any((i) => i.label == 'Comisiones'), true);
      expect(items.any((i) => i.label == 'Cobros'), false);
    });

    test('Repartidor (jefe) has Panel as first item', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: true,
        showCommissions: false,
      );

      expect(items.length, 8);
      expect(items.any((i) => i.label == 'Comisiones'), false);
      expect(items[0].label, 'Panel');
    });

    test('Jefe Ventas has all items', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: true,
      );

      expect(items.length, 13);
      expect(items[0].label, 'Panel');
      expect(items.any((i) => i.label == 'Liquidación'), true);
      expect(items.any((i) => i.label == 'Bolsa'), true);
      expect(items.any((i) => i.label == 'Evolución'), true);
    });

    test('Ventas puts liquidacion between cobros and bolsa', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: true,
      );

      expect(
        items[items.indexWhere((i) => i.label == 'Cobros') + 1].label,
        'Liquidación',
      );
      expect(
        items[items.indexWhere((i) => i.label == 'Liquidación') + 1].label,
        'Bolsa',
      );
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
