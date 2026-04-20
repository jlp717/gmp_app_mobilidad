import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';

class TabDefinition {
  const TabDefinition({
    required this.id,
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.color,
    required this.allowedRoles,
    required this.pageBuilder,
    this.requiredFeatures,
  });
  final String id;
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final Color color;
  final List<String> allowedRoles;
  final List<String>? requiredFeatures;
  final Widget Function(BuildContext) pageBuilder;

  bool isAccessible(UserModel? user) {
    if (user == null) return false;

    final userRole = user.role;
    if (!allowedRoles.contains(userRole)) return false;

    if (requiredFeatures != null) {
      for (final feature in requiredFeatures!) {
        if (!_userHasFeature(user, feature)) return false;
      }
    }

    return true;
  }

  bool _userHasFeature(UserModel user, String feature) {
    switch (feature) {
      case 'showCommissions':
        return user.showCommissions == true;
      case 'isJefeVentas':
        return user.isJefeVentas == true;
      case 'canViewPanel':
        return user.isJefeVentas == true;
      default:
        return false;
    }
  }
}

class TabConfig {
  const TabConfig({
    required this.allTabs,
    required this.defaultTabId,
  });
  final List<TabDefinition> allTabs;
  final String defaultTabId;

  List<TabDefinition> getTabsForUser(UserModel? user) {
    return allTabs.where((tab) => tab.isAccessible(user)).toList();
  }

  TabDefinition? getTabById(String id) {
    try {
      return allTabs.firstWhere((tab) => tab.id == id);
    } catch (_) {
      return null;
    }
  }

  int getDefaultIndex(UserModel? user) {
    final tabs = getTabsForUser(user);
    if (tabs.isEmpty) return 0;

    final index = tabs.indexWhere((tab) => tab.id == defaultTabId);
    return index >= 0 ? index : 0;
  }
}
