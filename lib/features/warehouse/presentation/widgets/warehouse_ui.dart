import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class WarehouseUi {
  WarehouseUi._();

  static BoxDecoration surface({
    Color color = AppTheme.raisedSurface,
    Color borderColor = AppTheme.borderColor,
    double borderAlpha = 1,
    double radius = AppTheme.radiusMd,
    List<BoxShadow>? boxShadow,
  }) {
    return BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: borderColor.withValues(alpha: borderAlpha)),
      boxShadow: boxShadow,
    );
  }

  static Widget iconTile({
    required IconData icon,
    required Color color,
    double size = 20,
  }) {
    return Container(
      width: 36,
      height: 36,
      decoration: surface(
        color: color.withValues(alpha: 0.12),
        borderColor: color,
        borderAlpha: 0.28,
      ),
      child: Icon(icon, color: color, size: size),
    );
  }

  static ButtonStyle iconButtonStyle(Color color) {
    return IconButton.styleFrom(
      backgroundColor: color.withValues(alpha: 0.1),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        side: BorderSide(color: color.withValues(alpha: 0.24)),
      ),
    );
  }
}
