import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Legacy card API restyled as an executive data surface.
class HolographicCard extends StatefulWidget {
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
  State<HolographicCard> createState() => _HolographicCardState();
}

class _HolographicCardState extends State<HolographicCard> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final accent = (widget.gradientColors?.isNotEmpty ?? false)
        ? widget.gradientColors!.first
        : AppTheme.activeRing;
    final radius = BorderRadius.circular(AppTheme.radiusLg);
    final card = AnimatedScale(
      duration: AppTheme.animFast,
      curve: Curves.easeOutCubic,
      scale: widget.animateOnHover && _hovered ? 1.012 : 1,
      child: Container(
        width: widget.width,
        height: widget.height,
        margin: widget.margin,
        decoration: AppTheme.holoCard(glowColor: accent),
        child: ClipRRect(
          borderRadius: radius,
          child: Stack(
            children: [
              if (widget.showHolographicEffect)
                Positioned.fill(
                  child: IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            Colors.white.withValues(alpha: 0.060),
                            Colors.transparent,
                            accent.withValues(alpha: 0.050),
                          ],
                          stops: const [0.0, 0.45, 1.0],
                        ),
                      ),
                    ),
                  ),
                ),
              Positioned(
                left: 0,
                right: 0,
                top: 0,
                child: Container(
                  height: 1.2,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Colors.transparent,
                        accent.withValues(alpha: 0.66),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),
              Padding(
                padding: widget.padding ?? const EdgeInsets.all(16),
                child: widget.child,
              ),
            ],
          ),
        ),
      ),
    );

    if (!widget.isInteractive || widget.onTap == null) return card;

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: InkWell(
        onTap: widget.onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        child: card,
      ),
    );
  }
}

/// Legacy button API restyled as a command action.
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
    final color = primaryColor ?? AppTheme.activeRing;

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        boxShadow: isEnabled
            ? [
                BoxShadow(
                  color: color.withValues(alpha: 0.22),
                  blurRadius: 18,
                ),
              ]
            : null,
      ),
      child: ElevatedButton(
        onPressed: isEnabled ? onPressed : null,
        style: (style ??
                ElevatedButton.styleFrom(
                  backgroundColor: color,
                  foregroundColor: const Color(0xFF061014),
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
                  valueColor: AlwaysStoppedAnimation<Color>(Color(0xFF061014)),
                ),
              )
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null) ...[
                    Icon(icon, color: const Color(0xFF061014), size: 18),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    text,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFF061014),
                      letterSpacing: 0,
                    ),
                  ),
                ],
              ),
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
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      color.withValues(alpha: 0.22),
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
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: AppTheme.inkSurface,
              border: Border.all(
                color: progressColor.withValues(alpha: 0.18),
              ),
            ),
            child: LinearProgressIndicator(
              minHeight: 9,
              value: value.clamp(0, 1),
              backgroundColor: AppTheme.inkSurface,
              valueColor: AlwaysStoppedAnimation<Color>(progressColor),
            ),
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
      decoration: AppTheme.glassMorphism(),
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
                  gradient: isActive
                      ? LinearGradient(
                          colors: [
                            active.withValues(alpha: 0.24),
                            active.withValues(alpha: 0.08),
                          ],
                        )
                      : null,
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                  border: Border.all(
                    color: isActive
                        ? active.withValues(alpha: 0.42)
                        : Colors.transparent,
                  ),
                  boxShadow: isActive
                      ? [
                          BoxShadow(
                            color: active.withValues(alpha: 0.12),
                            blurRadius: 16,
                          ),
                        ]
                      : null,
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
