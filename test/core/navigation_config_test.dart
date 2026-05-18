// GMP Navigation Config Service Tests
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/services/navigation_config_service.dart';

void main() {
  group('NavigationConfigService Tests', () {
    test('returns almacen items when isAlmacen true', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );

      expect(items.length, 5);
      expect(items.any((i) => i.label == 'Expediciones'), true);
      expect(items.any((i) => i.label == 'Vehiculos'), true);
    });

    test('returns repartidor items when isRepartidor true', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: false,
        showCommissions: false,
      );

      expect(items.any((i) => i.label == 'Clientes'), true);
      expect(items.any((i) => i.label == 'Rutero'), true);
      expect(items.any((i) => i.label == 'Histórico'), true);
    });

    test('adds panel for jefe in repartidor mode', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: true,
        showCommissions: false,
      );

      expect(items.first.label, 'Panel');
    });

    test('returns ventas items for jefe ventas', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: false,
      );

      expect(items.any((i) => i.label == 'Panel'), true);
      expect(items.any((i) => i.label == 'Clientes'), true);
      expect(items.any((i) => i.label == 'Ruta'), true);
    });

    test('removes comisiones for non-jefe without showCommissions', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );

      expect(items.any((i) => i.label == 'Comisiones'), false);
    });

    test('includes comisiones when showCommissions is true', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: true,
      );

      expect(items.any((i) => i.label == 'Comisiones'), true);
    });

    test('includes all expected sales items', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: true,
      );

      expect(items.any((i) => i.label == 'Clientes'), true);
      expect(items.any((i) => i.label == 'Ruta'), true);
      expect(items.any((i) => i.label == 'Objetivos'), true);
      expect(items.any((i) => i.label == 'Comisiones'), true);
      expect(items.any((i) => i.label == 'Facturas'), true);
      expect(items.any((i) => i.label == 'Pedidos'), true);
      expect(items.any((i) => i.label == 'Glacius'), true);
      expect(items.any((i) => i.label == 'Cobros'), true);
      expect(items.any((i) => i.label == 'Chat IA'), true);
    });
  });

  group('NavItem Tests', () {
    test('NavItem creates correctly', () {
      const item = NavItem(
        icon: Icons.home,
        selectedIcon: Icons.home_filled,
        label: 'Home',
        color: Colors.blue,
      );

      expect(item.icon, Icons.home);
      expect(item.label, 'Home');
    });
  });
}
