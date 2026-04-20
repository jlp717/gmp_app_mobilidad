import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';

class NavigationConfigService {
  static List<NavItem> getNavItems({
    required bool isAlmacen,
    required bool isRepartidor,
    required bool isJefeVentas,
    required bool showCommissions,
  }) {
    final items = <NavItem>[];

    // ALMACÉN MODE
    if (isAlmacen) {
      items.addAll(_almacenItems);
      return items;
    }

    // REPARTIDOR MODE
    if (isRepartidor) {
      if (isJefeVentas) {
        items.add(const NavItem(
          icon: Icons.dashboard_outlined,
          selectedIcon: Icons.dashboard,
          label: 'Panel',
          color: Colors.orange,
        ),);
      }
      items.addAll(_repartidorItems);
      if (!isJefeVentas && showCommissions) {
        items.add(const NavItem(
          icon: Icons.euro_outlined,
          selectedIcon: Icons.euro,
          label: 'Comisiones',
          color: Color(0xFF00FF88),
        ),);
      }
      return items;
    }

    // SALES MODE (Jefe / Comercial)
    if (isJefeVentas) {
      items.add(const NavItem(
        icon: Icons.dashboard_outlined,
        selectedIcon: Icons.dashboard,
        label: 'Panel',
        color: Color(0xFF00D4FF),
      ),);
    }
    items.addAll(_ventasItems);

    // Filter comisiones based on permission
    if (!isJefeVentas && !showCommissions) {
      items.removeWhere((item) => item.label == 'Comisiones');
    }

    return items;
  }

  static const _almacenItems = [
    NavItem(
        icon: Icons.warehouse_outlined,
        selectedIcon: Icons.warehouse_rounded,
        label: 'Expediciones',
        color: Color(0xFF00D4FF),),
    NavItem(
        icon: Icons.local_shipping_outlined,
        selectedIcon: Icons.local_shipping_rounded,
        label: 'Vehiculos',
        color: Color(0xFF9C27B0),),
    NavItem(
        icon: Icons.inventory_2_outlined,
        selectedIcon: Icons.inventory_2_rounded,
        label: 'Articulos',
        color: Color(0xFF00FF88),),
    NavItem(
        icon: Icons.history_outlined,
        selectedIcon: Icons.history_rounded,
        label: 'Historial',
        color: Color(0xFFFFC107),),
    NavItem(
        icon: Icons.groups_outlined,
        selectedIcon: Icons.groups_rounded,
        label: 'Personal',
        color: Color(0xFF9C27B0),),
  ];

  static const _repartidorItems = [
    NavItem(
        icon: Icons.people_outline,
        selectedIcon: Icons.people,
        label: 'Clientes',
        color: Color(0xFF00FF88),),
    NavItem(
        icon: Icons.route_outlined,
        selectedIcon: Icons.route,
        label: 'Rutero',
        color: Color(0xFF00D4FF),),
    NavItem(
        icon: Icons.history_outlined,
        selectedIcon: Icons.history,
        label: 'Histórico',
        color: Color(0xFF9C27B0),),
    NavItem(
        icon: Icons.smart_toy_outlined,
        selectedIcon: Icons.smart_toy,
        label: 'Chat IA',
        color: Color(0xFFFF4081),),
  ];

  static const _ventasItems = [
    NavItem(
        icon: Icons.people_outline,
        selectedIcon: Icons.people,
        label: 'Clientes',
        color: Color(0xFF00FF88),),
    NavItem(
        icon: Icons.route_outlined,
        selectedIcon: Icons.route,
        label: 'Ruta',
        color: Color(0xFF9C27B0),),
    NavItem(
        icon: Icons.track_changes_outlined,
        selectedIcon: Icons.track_changes,
        label: 'Objetivos',
        color: Color(0xFFFF9800),),
    NavItem(
        icon: Icons.euro_outlined,
        selectedIcon: Icons.euro,
        label: 'Comisiones',
        color: Color(0xFF00FF88),),
    NavItem(
        icon: Icons.receipt_long_outlined,
        selectedIcon: Icons.receipt_long,
        label: 'Facturas',
        color: Color(0xFF009688),),
    NavItem(
        icon: Icons.shopping_cart_outlined,
        selectedIcon: Icons.shopping_cart,
        label: 'Pedidos',
        color: Color(0xFFFF5722),),
    NavItem(
        icon: Icons.ac_unit_outlined,
        selectedIcon: Icons.ac_unit,
        label: 'Glacius',
        color: Color(0xFF84FFFF),),
    NavItem(
        icon: Icons.payments_outlined,
        selectedIcon: Icons.payments,
        label: 'Cobros',
        color: Color(0xFF2196F3),),
    NavItem(
        icon: Icons.smart_toy_outlined,
        selectedIcon: Icons.smart_toy,
        label: 'Chat IA',
        color: Color(0xFFFF4081),),
  ];
}

class NavItem {

  const NavItem({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.color,
  });
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final Color color;
}
