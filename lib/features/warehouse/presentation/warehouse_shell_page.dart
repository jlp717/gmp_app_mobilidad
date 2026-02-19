/// WAREHOUSE SHELL PAGE
/// Contenedor principal del perfil Almacén con tabs:
/// - Dashboard de Expediciones
/// - Personal de Almacén

import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import 'pages/warehouse_dashboard_page.dart';
import 'pages/personnel_page.dart';

class WarehouseShellPage extends StatefulWidget {
  const WarehouseShellPage({super.key});

  @override
  State<WarehouseShellPage> createState() => _WarehouseShellPageState();
}

class _WarehouseShellPageState extends State<WarehouseShellPage> {
  int _currentIndex = 0;

  final List<Widget> _pages = const [
    WarehouseDashboardPage(),
    PersonnelPage(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: IndexedStack(
        index: _currentIndex,
        children: _pages,
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          border: Border(
            top: BorderSide(
                color: AppTheme.neonBlue.withValues(alpha: 0.15)),
          ),
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex,
          onTap: (i) => setState(() => _currentIndex = i),
          backgroundColor: Colors.transparent,
          elevation: 0,
          selectedItemColor: AppTheme.neonBlue,
          unselectedItemColor: Colors.white38,
          selectedLabelStyle: const TextStyle(
              fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 0.5),
          unselectedLabelStyle:
              const TextStyle(fontSize: 10, letterSpacing: 0.3),
          type: BottomNavigationBarType.fixed,
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.warehouse_rounded),
              activeIcon: Icon(Icons.warehouse_rounded),
              label: 'EXPEDICIONES',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.groups_outlined),
              activeIcon: Icon(Icons.groups_rounded),
              label: 'PERSONAL',
            ),
          ],
        ),
      ),
    );
  }
}
