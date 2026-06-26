import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class RuteroDetailTabBar extends StatelessWidget {
  const RuteroDetailTabBar({
    required this.tabController,
    required this.isUrgent,
    super.key,
  });

  final TabController tabController;
  final bool isUrgent;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom: BorderSide(color: AppTheme.borderColor),
        ),
      ),
      child: TabBar(
        controller: tabController,
        indicatorColor: AppTheme.info,
        indicatorWeight: 2,
        labelColor: AppTheme.info,
        unselectedLabelColor: AppTheme.textSecondary,
        labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
        tabs: [
          const Tab(
            icon: Icon(Icons.inventory_2_outlined, size: 20),
            text: 'PRODUCTOS',
          ),
          Tab(
            icon: Icon(
              Icons.payment,
              size: 20,
              color: isUrgent ? AppTheme.obligatorio : null,
            ),
            child: Text(
              'COBRO',
              style: TextStyle(
                color: isUrgent ? AppTheme.obligatorio : null,
              ),
            ),
          ),
          const Tab(
            icon: Icon(Icons.check_circle_outline, size: 20),
            text: 'FINALIZAR',
          ),
        ],
      ),
    );
  }
}
