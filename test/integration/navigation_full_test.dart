// GMP Navigation Integration Tests
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/services/navigation_config_service.dart';

void main() {
  group('Navigation Integration Tests', () {
    test('all roles get correct navigation items count', () {
      // Almacen
      final almacen = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(almacen.length, 5);

      // Repartidor regular
      final repartidor = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(repartidor.length, 8);

      // Repartidor jefe
      final repartidorJefe = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: true,
        showCommissions: false,
      );
      expect(repartidorJefe.length, 9);

      // Comercial
      final comercial = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(comercial.length, 9);

      // Jefe Ventas
      final jefe = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: true,
      );
      expect(jefe.length, 11);
    });

    test('NavItem icons are correctly assigned', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );

      expect(items[0].icon, Icons.warehouse_outlined);
      expect(items[1].icon, Icons.local_shipping_outlined);
      expect(items[2].icon, Icons.inventory_2_outlined);
    });

    test('NavItem selectedIcon differs from icon', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );

      expect(items[0].selectedIcon, Icons.warehouse_rounded);
      expect(items[0].icon, isNot(items[0].selectedIcon));
    });

    test('Comisiones visibility rules work correctly', () {
      // Jefe siempre ve comisiones
      final jefe = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: false,
      );
      expect(jefe.any((i) => i.label == 'Comisiones'), true);

      // Comercial con showCommissions=true ve comisiones
      final comercialCon = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: true,
      );
      expect(comercialCon.any((i) => i.label == 'Comisiones'), true);

      // Comercial sin showCommissions no ve comisiones
      final comercialSin = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(comercialSin.any((i) => i.label == 'Comisiones'), false);
    });

    test('Panel only for jefe roles', () {
      // Jefe Ventas ve Panel
      final jefe = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: true,
      );
      expect(jefe.any((i) => i.label == 'Panel'), true);

      // Comercial no ve Panel
      final comercial = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: true,
      );
      expect(comercial.any((i) => i.label == 'Panel'), false);

      // Repartidor regular no ve Panel
      final repartidor = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: false,
        showCommissions: false,
      );
      expect(repartidor.any((i) => i.label == 'Panel'), false);

      // Repartidor jefe SI ve Panel
      final repartidorJefe = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: true,
        isJefeVentas: true,
        showCommissions: false,
      );
      expect(repartidorJefe.any((i) => i.label == 'Panel'), true);
    });

    test('Almacen has correct items order', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: true,
        isRepartidor: false,
        isJefeVentas: false,
        showCommissions: false,
      );

      expect(items[0].label, 'Expediciones');
      expect(items[1].label, 'Vehiculos');
      expect(items[2].label, 'Articulos');
      expect(items[3].label, 'Historial');
      expect(items[4].label, 'Personal');
    });

    test('Ventas items complete for jefe', () {
      final items = NavigationConfigService.getNavItems(
        isAlmacen: false,
        isRepartidor: false,
        isJefeVentas: true,
        showCommissions: true,
      );

      final labels = items.map((i) => i.label).toList();
      expect(labels, contains('Panel'));
      expect(labels, contains('Clientes'));
      expect(labels, contains('Ruta'));
      expect(labels, contains('Objetivos'));
      expect(labels, contains('Comisiones'));
      expect(labels, contains('Facturas'));
      expect(labels, contains('Pedidos'));
      expect(labels, contains('Glacius'));
      expect(labels, contains('Cobros'));
      expect(labels, contains('Bolsa'));
      expect(labels, contains('Chat IA'));
    });
  });
}
