// GMP Integration Test - MainShell Navigation
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/services/navigation_config_service.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';

void main() {
  group('MainShell Navigation Integration Tests', () {
    test('NavigationConfigService provides items for all roles', () {
      // Test for JEFE_VENTAS
      final jefeItems = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: true,
      );
      expect(jefeItems.isNotEmpty, true);
      expect(jefeItems.first.label, 'Panel');

      // Test for COMERCIAL
      final comercialItems = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: true,
      );
      expect(comercialItems.isNotEmpty, true);

      // Test for REPARTIDOR
      final repartidorItems = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(repartidorItems.isNotEmpty, true);
      expect(repartidorItems.any((i) => i.label == 'Panel'), false);

      // Test for ALMACEN
      final almacenItems = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(almacenItems.isNotEmpty, true);
      expect(almacenItems.first.label, 'Expediciones');
    });

    test('NavigationConfigService filters correctly', () {
      // Remove comisiones for non-jefe without permission
      final withoutComisiones = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(withoutComisiones.any((i) => i.label == 'Comisiones'), false);

      // Add comisiones when showCommissions true
      final withComisiones = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: true,
      );
      expect(withComisiones.any((i) => i.label == 'Comisiones'), true);
    });

    test('NavItem has correct properties', () {
      const item = NavItem(
        icon: Icons.home,
        selectedIcon: Icons.home_filled,
        label: 'Home',
        color: Colors.blue,
      );

      expect(item.icon, Icons.home);
      expect(item.selectedIcon, Icons.home_filled);
      expect(item.label, 'Home');
      expect(item.color, Colors.blue);
    });

    test('Navigation items count per role', () {
      // Almacen: 5 items
      final almacen = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(almacen.length, 5);

      // Repartidor (jefe): Panel + 8 items
      final repartidorJefe = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: true,
        showCommissions: false,
      );
      expect(repartidorJefe.length, 9);

      // Repartidor (regular): 8 items
      final repartidor = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(repartidor.length, 8);

      // Jefe Ventas: 13 items (Panel + 12)
      final jefe = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: true,
      );
      expect(jefe.length, 13);
      expect(jefe.any((i) => i.label == 'Liquidación'), true);
    });
  });
}
