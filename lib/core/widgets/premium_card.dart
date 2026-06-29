import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Executive card wrapper with consistent border, density, and depth.
///
/// The legacy name is retained because it is used throughout feature code.
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

  final Widget child;
  final Color? accentColor;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final double? borderRadius;

  /// Retained for API compatibility. It now uses a denser raised surface.
  final bool glassmorphism;

  @override
  Widget build(BuildContext context) {
    final color = accentColor ?? AppTheme.info;

    return AnimatedContainer(
      duration: AppTheme.animFast,
      curve: Curves.easeOutCubic,
      margin: margin ?? const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        gradient:
            glassmorphism ? AppTheme.commandGradient : AppTheme.cardGradient,
        borderRadius: BorderRadius.circular(borderRadius ?? AppTheme.radiusLg),
        border: Border.all(
          color: color.withValues(alpha: 0.24),
        ),
        boxShadow: [
          ...AppTheme.elevation2,
          BoxShadow(
            color: color.withValues(alpha: 0.08),
            blurRadius: 22,
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius ?? AppTheme.radiusLg),
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border(
              left: BorderSide(color: color.withValues(alpha: 0.72), width: 3),
              top: BorderSide(color: Colors.white.withValues(alpha: 0.045)),
            ),
          ),
          child: padding != EdgeInsets.zero
              ? Padding(padding: padding, child: child)
              : child,
        ),
      ),
    );
  }
}

/// KPI metric card for numeric dashboard values.
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
    final color = accentColor ?? AppTheme.info;

    return PremiumCard(
      accentColor: color,
      padding: const EdgeInsets.all(14),
      margin: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        color.withValues(alpha: 0.24),
                        color.withValues(alpha: 0.07),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                    border: Border.all(color: color.withValues(alpha: 0.28)),
                    boxShadow: [
                      BoxShadow(
                        color: color.withValues(alpha: 0.10),
                        blurRadius: 16,
                      ),
                    ],
                  ),
                  child: Icon(icon, size: 16, color: color),
                ),
                const SizedBox(width: 8),
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
          if (trend != null || trendLabel != null) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                if (trend != null) Icon(trend, size: 14, color: color),
                if (trendLabel != null) ...[
                  const SizedBox(width: 4),
                  Flexible(
                    child: Text(
                      trendLabel!,
                      style: AppTheme.captionText,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
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

/// Section header with optional action button.
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
    final color = accentColor ?? AppTheme.info;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: AppTheme.glassMorphism(),
      child: Row(
        children: [
          if (icon != null) ...[
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    color.withValues(alpha: 0.24),
                    color.withValues(alpha: 0.07),
                  ],
                ),
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(color: color.withValues(alpha: 0.30)),
                boxShadow: [
                  BoxShadow(
                    color: color.withValues(alpha: 0.10),
                    blurRadius: 16,
                  ),
                ],
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
                  style: AppTheme.headline.copyWith(
                    fontSize: 16,
                    color: AppTheme.textPrimary,
                  ),
                ),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      subtitle!,
                      style: AppTheme.captionText,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
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
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0,
                ),
              ),
              child: Text(actionLabel!),
            ),
        ],
      ),
    );
  }
}
