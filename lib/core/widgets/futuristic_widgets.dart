import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Legacy card API restyled as an operational surface.
class HolographicCard extends StatelessWidget {
  const HolographicCard({
    required this.child,
    super.key,
    this.margin,
    this.padding,
    this.onTap,
    this.animateOnHover = true,
    this.isInteractive = true,
    this.gradientColors,
    this.width,
    this.height,
    this.showHolographicEffect = true,
  });

  final Widget child;
  final EdgeInsetsGeometry? margin;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final bool animateOnHover;
  final bool isInteractive;
  final List<Color>? gradientColors;
  final double? width;
  final double? height;
  final bool showHolographicEffect;

  @override
  Widget build(BuildContext context) {
    final card = Container(
      width: width,
      height: height,
      margin: margin,
      padding: padding ?? const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: AppTheme.borderColor.withValues(alpha: 0.84)),
        boxShadow: AppTheme.elevation1,
      ),
      child: child,
    );

    if (!isInteractive || onTap == null) return card;

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        child: card,
      ),
    );
  }
}

/// Legacy button API restyled as a normal primary action.
class NeonButton extends StatelessWidget {
  const NeonButton({
    required this.text,
    super.key,
    this.onPressed,
    this.icon,
    this.isLoading = false,
    this.isDisabled = false,
    this.style,
    this.primaryColor,
    this.secondaryColor,
  });

  final String text;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool isLoading;
  final bool isDisabled;
  final ButtonStyle? style;
  final Color? primaryColor;
  final Color? secondaryColor;

  @override
  Widget build(BuildContext context) {
    final isEnabled = !isDisabled && !isLoading && onPressed != null;
    final color = primaryColor ?? AppTheme.info;

    return ElevatedButton(
      onPressed: isEnabled ? onPressed : null,
      style: (style ??
              ElevatedButton.styleFrom(
                backgroundColor: color,
                foregroundColor: Colors.white,
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                ),
              ))
          .copyWith(
        elevation: WidgetStateProperty.all(0),
        shadowColor: WidgetStateProperty.all(Colors.transparent),
      ),
      child: isLoading
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
              ),
            )
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[
                  Icon(icon, color: Colors.white, size: 18),
                  const SizedBox(width: 8),
                ],
                Text(
                  text,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    letterSpacing: 0,
                  ),
                ),
              ],
            ),
    );
  }
}

/// Compact metric card.
class DataVizCard extends StatelessWidget {
  const DataVizCard({
    required this.title,
    required this.value,
    required this.icon,
    super.key,
    this.subtitle,
    this.iconColor,
    this.valueColor,
    this.trend,
    this.trendColor,
    this.trendIcon,
  });

  final String title;
  final String value;
  final String? subtitle;
  final IconData icon;
  final Color? iconColor;
  final Color? valueColor;
  final String? trend;
  final Color? trendColor;
  final IconData? trendIcon;

  @override
  Widget build(BuildContext context) {
    final color = iconColor ?? AppTheme.info;

    return HolographicCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                  border: Border.all(color: color.withValues(alpha: 0.18)),
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            value,
            style: AppTheme.metricValue.copyWith(
              color: valueColor ?? AppTheme.textPrimary,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              subtitle!,
              style: const TextStyle(
                fontSize: 12,
                color: AppTheme.textSecondary,
                letterSpacing: 0,
              ),
            ),
          ],
          if (trend != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(
                  trendIcon ??
                      (trend!.startsWith('+')
                          ? Icons.trending_up
                          : Icons.trending_down),
                  size: 14,
                  color: trendColor ??
                      (trend!.startsWith('+')
                          ? AppTheme.success
                          : AppTheme.error),
                ),
                const SizedBox(width: 4),
                Text(
                  trend!,
                  style: TextStyle(
                    fontSize: 12,
                    color: trendColor ??
                        (trend!.startsWith('+')
                            ? AppTheme.success
                            : AppTheme.error),
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Linear progress indicator with label support.
class HolographicProgressIndicator extends StatelessWidget {
  const HolographicProgressIndicator({
    required this.value,
    super.key,
    this.color,
    this.label,
    this.percentage,
  });

  final double value;
  final Color? color;
  final String? label;
  final String? percentage;

  @override
  Widget build(BuildContext context) {
    final progressColor = color ?? AppTheme.info;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null || percentage != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                if (label != null)
                  Text(
                    label!,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                      letterSpacing: 0,
                    ),
                  ),
                if (percentage != null)
                  Text(
                    percentage!,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0,
                    ),
                  ),
              ],
            ),
          ),
        ClipRRect(
          borderRadius: BorderRadius.circular(AppTheme.radiusFull),
          child: LinearProgressIndicator(
            minHeight: 8,
            value: value.clamp(0, 1),
            backgroundColor: AppTheme.raisedSurface,
            valueColor: AlwaysStoppedAnimation<Color>(progressColor),
          ),
        ),
      ],
    );
  }
}

/// Segmented tab control.
class FuturisticTabBar extends StatelessWidget {
  const FuturisticTabBar({
    required this.tabs,
    required this.selectedIndex,
    super.key,
    this.onTap,
    this.activeColor,
    this.inactiveColor,
  });

  final List<String> tabs;
  final int selectedIndex;
  final ValueChanged<int>? onTap;
  final Color? activeColor;
  final Color? inactiveColor;

  @override
  Widget build(BuildContext context) {
    final active = activeColor ?? AppTheme.info;
    final inactive = inactiveColor ?? AppTheme.textSecondary;

    return Container(
      height: 46,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Row(
        children: List.generate(tabs.length, (index) {
          final isActive = index == selectedIndex;
          return Expanded(
            child: InkWell(
              onTap: () => onTap?.call(index),
              borderRadius: BorderRadius.circular(AppTheme.radiusSm),
              child: AnimatedContainer(
                duration: AppTheme.animFast,
                decoration: BoxDecoration(
                  color: isActive
                      ? active.withValues(alpha: 0.12)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                  border: Border.all(
                    color: isActive
                        ? active.withValues(alpha: 0.25)
                        : Colors.transparent,
                  ),
                ),
                child: Center(
                  child: Text(
                    tabs[index],
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                      color: isActive ? active : inactive,
                      letterSpacing: 0,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
