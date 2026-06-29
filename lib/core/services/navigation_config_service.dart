import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

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
        items.add(
          const NavItem(
            icon: Icons.dashboard_outlined,
            selectedIcon: Icons.dashboard,
            label: 'Panel',
            color: AppTheme.warning,
          ),
        );
      }
      items.addAll(_repartidorItems);
      return items;
    }

    // SALES MODE (Jefe / Comercial)
    if (isJefeVentas) {
      items.add(
        const NavItem(
          icon: Icons.dashboard_outlined,
          selectedIcon: Icons.dashboard,
          label: 'Panel',
          color: AppTheme.info,
        ),
      );
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
      color: AppTheme.info,
    ),
    NavItem(
      icon: Icons.local_shipping_outlined,
      selectedIcon: Icons.local_shipping_rounded,
      label: 'Vehículos',
      color: AppTheme.accentIndigo,
    ),
    NavItem(
      icon: Icons.inventory_2_outlined,
      selectedIcon: Icons.inventory_2_rounded,
      label: 'Artículos',
      color: AppTheme.success,
    ),
    NavItem(
      icon: Icons.history_outlined,
      selectedIcon: Icons.history_rounded,
      label: 'Historial',
      color: AppTheme.warning,
    ),
    NavItem(
      icon: Icons.groups_outlined,
      selectedIcon: Icons.groups_rounded,
      label: 'Personal',
      color: AppTheme.accentRose,
    ),
  ];

  static const _repartidorItems = [
    NavItem(
      icon: Icons.people_outline,
      selectedIcon: Icons.people,
      label: 'Clientes',
      color: AppTheme.success,
    ),
    NavItem(
      icon: Icons.route_outlined,
      selectedIcon: Icons.route,
      label: 'Rutero',
      color: AppTheme.info,
    ),
    NavItem(
      icon: Icons.account_balance_wallet_outlined,
      selectedIcon: Icons.account_balance_wallet,
      label: 'Liquidación',
      color: AppTheme.success,
    ),
    NavItem(
      icon: Icons.event_available_outlined,
      selectedIcon: Icons.event_available,
      label: 'Vencimientos',
      color: AppTheme.warning,
    ),
    NavItem(
      icon: Icons.show_chart_outlined,
      selectedIcon: Icons.show_chart,
      label: 'Evolución',
      color: AppTheme.info,
    ),
    NavItem(
      icon: Icons.euro_outlined,
      selectedIcon: Icons.euro,
      label: 'Comisiones',
      color: AppTheme.success,
    ),
    NavItem(
      icon: Icons.history_outlined,
      selectedIcon: Icons.history,
      label: 'Histórico',
      color: AppTheme.accentIndigo,
    ),
    NavItem(
      icon: Icons.smart_toy_outlined,
      selectedIcon: Icons.smart_toy,
      label: 'Asistente',
      color: AppTheme.accentRose,
    ),
  ];

  static const _ventasItems = [
    NavItem(
      icon: Icons.people_outline,
      selectedIcon: Icons.people,
      label: 'Clientes',
      color: AppTheme.success,
    ),
    NavItem(
      icon: Icons.route_outlined,
      selectedIcon: Icons.route,
      label: 'Ruta',
      color: AppTheme.accentIndigo,
    ),
    NavItem(
      icon: Icons.track_changes_outlined,
      selectedIcon: Icons.track_changes,
      label: 'Objetivos',
      color: AppTheme.warning,
    ),
    NavItem(
      icon: Icons.euro_outlined,
      selectedIcon: Icons.euro,
      label: 'Comisiones',
      color: AppTheme.success,
    ),
    NavItem(
      icon: Icons.receipt_long_outlined,
      selectedIcon: Icons.receipt_long,
      label: 'Facturas',
      color: AppTheme.info,
    ),
    NavItem(
      icon: Icons.shopping_cart_outlined,
      selectedIcon: Icons.shopping_cart,
      label: 'Pedidos',
      color: AppTheme.accentRose,
    ),
    NavItem(
      icon: Icons.ac_unit_outlined,
      selectedIcon: Icons.ac_unit,
      label: 'Alertas',
      color: AppTheme.info,
    ),
    NavItem(
      icon: Icons.payments_outlined,
      selectedIcon: Icons.payments,
      label: 'Cobros',
      color: AppTheme.info,
    ),
    NavItem(
      icon: Icons.point_of_sale_outlined,
      selectedIcon: Icons.point_of_sale,
      label: 'Liquidación',
      color: AppTheme.success,
    ),
    // Req #3: Bolsa Comercial
    NavItem(
      icon: Icons.account_balance_wallet_outlined,
      selectedIcon: Icons.account_balance_wallet,
      label: 'Bolsa',
      color: AppTheme.warning,
    ),
    NavItem(
      icon: Icons.show_chart_outlined,
      selectedIcon: Icons.show_chart,
      label: 'Evolución',
      color: AppTheme.accentIndigo,
    ),
    NavItem(
      icon: Icons.smart_toy_outlined,
      selectedIcon: Icons.smart_toy,
      label: 'Asistente',
      color: AppTheme.accentRose,
    ),
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
