import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/navigation/tab_definition.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';

final navigationServiceProvider = Provider<NavigationService>((ref) {
  return NavigationService(ref);
});

class NavigationService {
  NavigationService(this._ref) {
    tabConfig = _buildTabConfig();
  }
  final Ref _ref;
  late final TabConfig tabConfig;

  TabConfig _buildTabConfig() {
    return TabConfig(
      defaultTabId: 'panel',
      allTabs: _allTabsDefinition,
    );
  }

  List<TabDefinition> getNavItems(UserModel? user) {
    return tabConfig.getTabsForUser(user);
  }

  List<TabDefinition> getNavItemsForMode({
    required bool isJefeVentas,
    required bool isRepartidor,
    required bool isAlmacen,
    required bool showCommissions,
  }) {
    final items = <TabDefinition>[];

    for (final tab in _allTabsDefinition) {
      var include = false;

      if (isAlmacen && tab.allowedRoles.contains('ALMACEN')) {
        include = true;
      } else if (isRepartidor && tab.allowedRoles.contains('REPARTIDOR')) {
        if (isJefeVentas) {
          include = true;
        } else if (tab.id != 'panel') {
          include = true;
        }
      } else if (tab.allowedRoles.contains('JEFE_VENTAS') ||
          tab.allowedRoles.contains('COMERCIAL')) {
        if (isJefeVentas || showCommissions) {
          if (tab.id == 'comisiones' || tab.id != 'comisiones') {
            include = true;
          }
        } else if (tab.allowedRoles.contains('COMERCIAL')) {
          include = true;
        }
      }

      if (include) {
        items.add(tab);
      }
    }

    return items;
  }

  List<TabDefinition> getAlmacenTabs() {
    return _allTabsDefinition
        .where((tab) => tab.allowedRoles.contains('ALMACEN'))
        .toList();
  }

  List<TabDefinition> getRepartidorTabs({required bool isJefe}) {
    final tabs = <TabDefinition>[];

    if (isJefe) {
      tabs.addAll(
        _allTabsDefinition.where((tab) => tab.id == 'panel').toList(),
      );
    }

    tabs.addAll(
      _allTabsDefinition
          .where(
            (tab) =>
                tab.allowedRoles.contains('REPARTIDOR') && tab.id != 'panel',
          )
          .toList(),
    );

    return tabs;
  }

  List<TabDefinition> getVentasTabs({
    required bool isJefe,
    required bool showCommissions,
  }) {
    final tabs = <TabDefinition>[];

    final salesTabs = _allTabsDefinition
        .where(
          (tab) =>
              tab.allowedRoles.contains('JEFE_VENTAS') ||
              tab.allowedRoles.contains('COMERCIAL'),
        )
        .toList();

    for (final tab in salesTabs) {
      if (tab.id == 'comisiones' && !isJefe && !showCommissions) {
        continue;
      }
      tabs.add(tab);
    }

    return tabs;
  }

  int getDefaultIndex(UserModel? user) {
    return tabConfig.getDefaultIndex(user);
  }

  TabDefinition? getTabById(String id) {
    return tabConfig.getTabById(id);
  }

  Widget buildPage(BuildContext context, String tabId) {
    final tab = tabConfig.getTabById(tabId);
    if (tab != null) {
      return tab.pageBuilder(context);
    }
    return const SizedBox.shrink();
  }

  bool shouldShowComisiones({
    required bool isJefeVentas,
    required bool showCommissionsFlag,
  }) {
    return isJefeVentas || showCommissionsFlag;
  }
}

final _allTabsDefinition = <TabDefinition>[
  TabDefinition(
    id: 'panel',
    icon: Icons.dashboard_outlined,
    selectedIcon: Icons.dashboard,
    label: 'Panel',
    color: AppColors.info,
    allowedRoles: ['JEFE_VENTAS'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'clientes',
    icon: Icons.people_outline,
    selectedIcon: Icons.people,
    label: 'Clientes',
    color: AppColors.success,
    allowedRoles: ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'ruta',
    icon: Icons.route_outlined,
    selectedIcon: Icons.route,
    label: 'Ruta',
    color: AppColors.accentIndigo,
    allowedRoles: ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'objetivos',
    icon: Icons.track_changes_outlined,
    selectedIcon: Icons.track_changes,
    label: 'Objetivos',
    color: AppColors.warning,
    allowedRoles: ['JEFE_VENTAS'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'comisiones',
    icon: Icons.euro_outlined,
    selectedIcon: Icons.euro,
    label: 'Comisiones',
    color: AppColors.success,
    allowedRoles: ['JEFE_VENTAS', 'COMERCIAL'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'facturas',
    icon: Icons.receipt_long_outlined,
    selectedIcon: Icons.receipt_long,
    label: 'Facturas',
    color: AppColors.accentMint,
    allowedRoles: ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'pedidos',
    icon: Icons.shopping_cart_outlined,
    selectedIcon: Icons.shopping_cart,
    label: 'Pedidos',
    color: AppColors.accentRose,
    allowedRoles: ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'glacius',
    icon: Icons.ac_unit_outlined,
    selectedIcon: Icons.ac_unit,
    label: 'Alertas',
    color: AppColors.info,
    allowedRoles: ['JEFE_VENTAS', 'COMERCIAL'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'cobros',
    icon: Icons.payments_outlined,
    selectedIcon: Icons.payments,
    label: 'Cobros',
    color: AppColors.info,
    allowedRoles: ['JEFE_VENTAS', 'COMERCIAL'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'chat',
    icon: Icons.smart_toy_outlined,
    selectedIcon: Icons.smart_toy,
    label: 'Asistente',
    color: AppColors.accentRose,
    allowedRoles: ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'expediciones',
    icon: Icons.warehouse_outlined,
    selectedIcon: Icons.warehouse_rounded,
    label: 'Expediciones',
    color: AppColors.info,
    allowedRoles: ['ALMACEN'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'vehiculos',
    icon: Icons.local_shipping_outlined,
    selectedIcon: Icons.local_shipping_rounded,
    label: 'Vehiculos',
    color: AppColors.accentIndigo,
    allowedRoles: ['ALMACEN'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'articulos',
    icon: Icons.inventory_2_outlined,
    selectedIcon: Icons.inventory_2_rounded,
    label: 'Articulos',
    color: AppColors.success,
    allowedRoles: ['ALMACEN'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'historial',
    icon: Icons.history_outlined,
    selectedIcon: Icons.history_rounded,
    label: 'Historial',
    color: AppColors.accentAmber,
    allowedRoles: ['ALMACEN', 'REPARTIDOR'],
    pageBuilder: (context) => const SizedBox(),
  ),
  TabDefinition(
    id: 'personal',
    icon: Icons.groups_outlined,
    selectedIcon: Icons.groups_rounded,
    label: 'Personal',
    color: AppColors.accentIndigo,
    allowedRoles: ['ALMACEN'],
    pageBuilder: (context) => const SizedBox(),
  ),
];
