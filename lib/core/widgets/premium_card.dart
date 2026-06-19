import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Premium card wrapper with consistent gradient, border, and shadow.
///
/// Wrap existing card content to instantly apply the V2.5 premium look.
///
/// Features:
/// - Subtle gradient background (top-left → bottom-right)
/// - Neon border glow
/// - Multi-layered shadow (ambient + directional)
/// - Optional accent color for border glow
/// - Optional glassmorphism effect
class PremiumCard extends StatelessWidget {
  const PremiumCard({
    required this.child,
    this.accentColor,
    this.padding = EdgeInsets.zero,
    this.margin,
    this.borderRadius,
    this.glassmorphism = false,
    super.key,
  });

  /// The card content
  final Widget child;

  /// Accent color for border glow. Defaults to [AppTheme.neonBlue].
  final Color? accentColor;

  /// Internal padding
  final EdgeInsetsGeometry padding;

  /// External margin
  final EdgeInsetsGeometry? margin;

  /// Custom border radius. Defaults to [AppTheme.radiusLg].
  final double? borderRadius;

  /// Whether to use glassmorphism effect
  final bool glassmorphism;

  @override
  Widget build(BuildContext context) {
    final color = accentColor ?? AppTheme.neonBlue;

    return Container(
      margin: margin ?? const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: glassmorphism ? AppTheme.darkCard.withValues(alpha: 0.6) : null,
        gradient: glassmorphism
            ? null
            : LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppTheme.darkCard,
                  AppTheme.darkCard.withValues(alpha: 0.85),
                ],
              ),
        borderRadius: BorderRadius.circular(borderRadius ?? AppTheme.radiusLg),
        border: Border.all(
          color: color.withValues(alpha: 0.15),
          width: 1,
        ),
        boxShadow: [
          // Ambient shadow
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
          // Accent glow
          BoxShadow(
            color: color.withValues(alpha: 0.05),
            blurRadius: 16,
            spreadRadius: 1,
          ),
          // Deep shadow
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.1),
            blurRadius: 24,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: padding != EdgeInsets.zero
          ? Padding(padding: padding, child: child)
          : child,
    );
  }
}

/// Premium KPI metric card — for numeric dashboard values.
///
/// Shows a label, value, optional trend indicator, and an icon
/// in a compact premium card format.
class PremiumKpiCard extends StatelessWidget {
  const PremiumKpiCard({
    required this.label,
    required this.value,
    this.icon,
    this.accentColor,
    this.trend,
    this.trendLabel,
    this.valueStyle,
    super.key,
  });

  final String label;
  final String value;
  final IconData? icon;
  final Color? accentColor;
  final IconData? trend;
  final String? trendLabel;
  final TextStyle? valueStyle;

  @override
  Widget build(BuildContext context) {
    final color = accentColor ?? AppTheme.neonBlue;

    return PremiumCard(
      accentColor: color,
      padding: const EdgeInsets.all(14),
      margin: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Icon + label row
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: color),
                const SizedBox(width: 6),
              ],
              Flexible(
                child: Text(
                  label,
                  style: AppTheme.bodyLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // Value
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: valueStyle ??
                  AppTheme.metricValue.copyWith(
                    color: color,
                  ),
              maxLines: 1,
            ),
          ),
          // Trend indicator
          if (trend != null || trendLabel != null) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                if (trend != null) Icon(trend, size: 14, color: color),
                if (trendLabel != null) ...[
                  const SizedBox(width: 4),
                  Text(
                    trendLabel!,
                    style: AppTheme.captionText,
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Premium section header with optional action button.
class PremiumSectionHeader extends StatelessWidget {
  const PremiumSectionHeader({
    required this.title,
    this.subtitle,
    this.icon,
    this.accentColor,
    this.action,
    this.actionLabel,
    super.key,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final Color? accentColor;
  final VoidCallback? action;
  final String? actionLabel;

  @override
  Widget build(BuildContext context) {
    final color = accentColor ?? AppTheme.neonBlue;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          if (icon != null) ...[
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              ),
              child: Icon(icon, size: 18, color: color),
            ),
            const SizedBox(width: 12),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: AppTheme.headline,
                ),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      subtitle!,
                      style: AppTheme.captionText,
                    ),
                  ),
              ],
            ),
          ),
          if (action != null && actionLabel != null)
            TextButton(
              onPressed: action,
              style: TextButton.styleFrom(
                foregroundColor: color,
                textStyle: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              child: Text(actionLabel!),
            ),
        ],
      ),
    );
  }
}
