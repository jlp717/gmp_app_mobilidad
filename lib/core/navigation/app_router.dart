import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';

final appRouterProvider = Provider<AppRouter>((ref) {
  return AppRouter();
});

class AppRouter {

  AppRouter() {
    _initPages();
  }
  final Map<String, PageConfig> pages = {};

  void _initPages() {
    pages['panel'] = const PageConfig(
      route: '/panel',
      title: 'Panel',
      icon: Icons.dashboard,
      allowedRoles: ['JEFE_VENTAS'],
    );
    pages['clientes'] = const PageConfig(
      route: '/clientes',
      title: 'Clientes',
      icon: Icons.people,
      allowedRoles: ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR'],
    );
    pages['ruta'] = const PageConfig(
      route: '/ruta',
      title: 'Ruta',
      icon: Icons.route,
      allowedRoles: ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR'],
    );
    pages['objetivos'] = const PageConfig(
      route: '/objetivos',
      title: 'Objetivos',
      icon: Icons.track_changes,
      allowedRoles: ['JEFE_VENTAS'],
    );
    pages['comisiones'] = const PageConfig(
      route: '/comisiones',
      title: 'Comisiones',
      icon: Icons.euro,
      allowedRoles: ['JEFE_VENTAS', 'COMERCIAL'],
    );
    pages['facturas'] = const PageConfig(
      route: '/facturas',
      title: 'Facturas',
      icon: Icons.receipt_long,
      allowedRoles: ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR'],
    );
    pages['pedidos'] = const PageConfig(
      route: '/pedidos',
      title: 'Pedidos',
      icon: Icons.shopping_cart,
      allowedRoles: ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR'],
    );
    pages['cobros'] = const PageConfig(
      route: '/cobros',
      title: 'Cobros',
      icon: Icons.payments,
      allowedRoles: ['JEFE_VENTAS', 'COMERCIAL'],
    );
    pages['chat'] = const PageConfig(
      route: '/chat',
      title: 'Chat IA',
      icon: Icons.smart_toy,
      allowedRoles: ['JEFE_VENTAS', 'COMERCIAL', 'REPARTIDOR'],
    );
    pages['expediciones'] = const PageConfig(
      route: '/expediciones',
      title: 'Expediciones',
      icon: Icons.warehouse,
      allowedRoles: ['ALMACEN'],
    );
    pages['vehiculos'] = const PageConfig(
      route: '/vehiculos',
      title: 'Vehículos',
      icon: Icons.local_shipping,
      allowedRoles: ['ALMACEN'],
    );
    pages['articulos'] = const PageConfig(
      route: '/articulos',
      title: 'Artículos',
      icon: Icons.inventory_2,
      allowedRoles: ['ALMACEN'],
    );
    pages['historial'] = const PageConfig(
      route: '/historial',
      title: 'Historial',
      icon: Icons.history,
      allowedRoles: ['ALMACEN', 'REPARTIDOR'],
    );
    pages['personal'] = const PageConfig(
      route: '/personal',
      title: 'Personal',
      icon: Icons.groups,
      allowedRoles: ['ALMACEN'],
    );
  }

  List<PageConfig> getPagesForUser(UserModel? user) {
    if (user == null) return [];

    final role = user.role ?? '';

    return pages.values
        .where((page) => page.allowedRoles.contains(role))
        .toList();
  }

  String? getDefaultPage(UserModel? user) {
    final pages = getPagesForUser(user);
    if (pages.isEmpty) return null;

    if (user?.role == 'JEFE_VENTAS') {
      return 'panel';
    }

    return pages.first.route;
  }

  int getDefaultIndex(UserModel? user) {
    if (user == null) return 0;
    final role = user.role ?? '';

    switch (role) {
      case 'JEFE_VENTAS':
        return 0;
      case 'COMERCIAL':
        return 1;
      case 'REPARTIDOR':
        return 0;
      case 'ALMACEN':
        return 0;
      default:
        return 0;
    }
  }

  String? getRouteForId(String id) {
    return pages[id]?.route;
  }

  String getIdForRoute(String route) {
    for (final entry in pages.entries) {
      if (entry.value.route == route) {
        return entry.key;
      }
    }
    return route.substring(1);
  }
}

class PageConfig {

  const PageConfig({
    required this.route,
    required this.title,
    required this.icon,
    required this.allowedRoles,
  });
  final String route;
  final String title;
  final IconData icon;
  final List<String> allowedRoles;
}
