/// WAREHOUSE SHELL PAGE
/// Contenedor principal del perfil Almacén con 5 tabs:
/// EXPEDICIONES | VEHICULOS | ARTICULOS | HISTORIAL | PERSONAL
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/articles_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/load_history_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/personnel_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/vehicles_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/warehouse_config_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/warehouse_dashboard_page.dart';

class WarehouseShellPage extends StatefulWidget {
  const WarehouseShellPage({super.key});

  @override
  State<WarehouseShellPage> createState() => _WarehouseShellPageState();
}

class _WarehouseShellPageState extends State<WarehouseShellPage> {
  int _currentIndex = 0;

  final List<Widget> _pages = const [
    WarehouseDashboardPage(),
    VehiclesPage(),
    ArticlesPage(),
    LoadHistoryPage(),
    PersonnelPage(),
    WarehouseConfigPage(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: IndexedStack(
        index: _currentIndex,
        children: _pages,
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          border: Border(
            top: BorderSide(
              color: AppTheme.info.withValues(alpha: 0.15),
            ),
          ),
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex,
          onTap: (i) => setState(() => _currentIndex = i),
          backgroundColor: Colors.transparent,
          elevation: 0,
          selectedItemColor: AppTheme.info,
          unselectedItemColor: Colors.white38,
          selectedLabelStyle: const TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 10,
            letterSpacing: 0,
          ),
          unselectedLabelStyle: const TextStyle(fontSize: 9, letterSpacing: 0),
          type: BottomNavigationBarType.fixed,
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.warehouse_outlined),
              activeIcon: Icon(Icons.warehouse_rounded),
              label: 'EXPEDICIONES',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.local_shipping_outlined),
              activeIcon: Icon(Icons.local_shipping_rounded),
              label: 'VEHICULOS',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.inventory_2_outlined),
              activeIcon: Icon(Icons.inventory_2_rounded),
              label: 'ARTICULOS',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.history_outlined),
              activeIcon: Icon(Icons.history_rounded),
              label: 'HISTORIAL',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.groups_outlined),
              activeIcon: Icon(Icons.groups_rounded),
              label: 'PERSONAL',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.settings_outlined),
              activeIcon: Icon(Icons.settings_rounded),
              label: 'CONFIG',
            ),
          ],
        ),
      ),
    );
  }
}
