import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Shared surface decoration for commission cards and panels.
///
/// F3-02 extraction from `commissions_page.dart` — body verbatim, UI identical.
BoxDecoration commissionSurfaceDecoration({
  Color? color,
  Color? borderColor,
  double borderAlpha = 1,
  double radius = AppTheme.radiusMd,
}) {
  final surfaceColor = color ?? AppTheme.raisedSurface;
  final outlineColor = borderColor ?? AppTheme.borderColor;
  final hasVisibleSurface = surfaceColor != AppColors.transparent;
  return BoxDecoration(
    color: surfaceColor,
    gradient: hasVisibleSurface
        ? LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              surfaceColor,
              AppTheme.softPanel.withValues(alpha: 0.88),
              outlineColor.withValues(alpha: 0.035),
            ],
          )
        : null,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: outlineColor.withValues(alpha: borderAlpha)),
    boxShadow: hasVisibleSurface
        ? [
            BoxShadow(
              color: AppColors.systemBlack.withValues(alpha: 0.12),
              blurRadius: 12,
              offset: const Offset(0, 5),
            ),
          ]
        : null,
  );
}
