import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Local presentation primitives for the warehouse profile.
class WarehouseUi {
  WarehouseUi._();

  /// Dark executive background shared by warehouse screens.
  static const List<Color> executiveGradient = [
    Color(0xFF07111F),
    Color(0xFF111927),
    Color(0xFF172033),
  ];

  /// Full-page dark gradient background for warehouse views.
  static BoxDecoration background() {
    return const BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: executiveGradient,
      ),
    );
  }

  /// Raised operational panel with an accent tint and restrained shadow.
  static BoxDecoration executiveSurface({
    Color accent = AppTheme.info,
    double radius = AppTheme.radiusLg,
    double borderAlpha = 0.24,
    double accentAlpha = 0.08,
    bool elevated = true,
  }) {
    return BoxDecoration(
      color: AppTheme.raisedSurface,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: accent.withValues(alpha: borderAlpha)),
      boxShadow: elevated ? AppTheme.elevation1 : null,
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          accent.withValues(alpha: accentAlpha),
          AppTheme.raisedSurface,
          AppTheme.softPanel.withValues(alpha: 0.55),
        ],
      ),
    );
  }

  /// Header panel used at the top of warehouse tabs and planner surfaces.
  static BoxDecoration headerSurface({
    Color accent = AppTheme.info,
    double radius = AppTheme.radiusLg,
  }) {
    return BoxDecoration(
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: accent.withValues(alpha: 0.28)),
      boxShadow: [
        BoxShadow(
          color: AppTheme.inkSurface.withValues(alpha: 0.24),
          blurRadius: 18,
          offset: const Offset(0, 10),
        ),
      ],
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          accent.withValues(alpha: 0.16),
          AppTheme.raisedSurface,
          AppTheme.softPanel.withValues(alpha: 0.7),
        ],
      ),
    );
  }

  /// Wraps a screen in the warehouse background.
  static Widget pageShell({required Widget child}) {
    return DecoratedBox(
      decoration: background(),
      child: child,
    );
  }

  /// Compact title row with icon and optional action buttons.
  static Widget sectionHeader({
    required IconData icon,
    required String title,
    required String subtitle,
    Color accent = AppTheme.info,
    List<Widget> actions = const [],
  }) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      padding: const EdgeInsets.all(12),
      decoration: headerSurface(accent: accent),
      child: Row(
        children: [
          iconTile(icon: icon, color: accent, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: accent,
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    letterSpacing: 0,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          if (actions.isNotEmpty) ...[
            const SizedBox(width: 8),
            Wrap(spacing: 4, children: actions),
          ],
        ],
      ),
    );
  }

  /// Dense metric chip for small KPI rows.
  static Widget metricPill({
    required String value,
    required String label,
    required Color color,
    IconData? icon,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: executiveSurface(
        accent: color,
        radius: AppTheme.radiusMd,
        borderAlpha: 0.22,
        accentAlpha: 0.07,
        elevated: false,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 6),
          ],
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                value,
                style: TextStyle(
                  color: color,
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0,
                ),
              ),
              Text(
                label,
                style: TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// Small status chip with optional icon.
  static Widget statusPill({
    required String text,
    required Color color,
    IconData? icon,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.24)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            text,
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.w800,
              letterSpacing: 0,
            ),
          ),
        ],
      ),
    );
  }

  /// Generic tinted surface retained for existing warehouse widgets.
  static BoxDecoration surface({
    Color? color,
    Color? borderColor,
    double borderAlpha = 1,
    double radius = AppTheme.radiusMd,
    List<BoxShadow>? boxShadow,
  }) {
    final surfaceColor = color ?? AppTheme.raisedSurface;
    final outlineColor = borderColor ?? AppTheme.borderColor;
    return BoxDecoration(
      gradient: surfaceColor == AppTheme.raisedSurface
          ? AppTheme.cardGradient
          : LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                surfaceColor.withValues(alpha: 0.20),
                AppTheme.raisedSurface,
                surfaceColor.withValues(alpha: 0.08),
              ],
              stops: const [0.0, 0.58, 1.0],
            ),
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(
        color: outlineColor.withValues(
          alpha: (borderAlpha + 0.14).clamp(0, 1).toDouble(),
        ),
      ),
      boxShadow: boxShadow ?? AppTheme.elevation1,
    );
  }

  /// Square icon tile with accent fill.
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
        borderAlpha: 0.34,
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.12),
            blurRadius: 16,
          ),
        ],
      ),
      child: Icon(icon, color: color, size: size),
    );
  }

  /// Shared icon button style for warehouse toolbar actions.
  static ButtonStyle iconButtonStyle(Color color) {
    return IconButton.styleFrom(
      backgroundColor: color.withValues(alpha: 0.14),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        side: BorderSide(color: color.withValues(alpha: 0.34)),
      ),
    );
  }
}
