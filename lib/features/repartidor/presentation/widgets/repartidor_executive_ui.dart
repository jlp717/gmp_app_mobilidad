import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/premium_card.dart';

class RepartidorExecutivePanel extends StatelessWidget {
  const RepartidorExecutivePanel({
    required this.child,
    super.key,
    this.accentColor = AppTheme.info,
    this.padding = const EdgeInsets.all(14),
    this.margin,
    this.borderRadius,
    this.onTap,
    this.selected = false,
  });

  final Widget child;
  final Color accentColor;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final double? borderRadius;
  final VoidCallback? onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final radius = borderRadius ?? AppTheme.radiusLg;
    final content = PremiumCard(
      accentColor: accentColor,
      padding: EdgeInsets.zero,
      margin: margin ?? EdgeInsets.zero,
      borderRadius: radius,
      glassmorphism: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              accentColor.withValues(alpha: selected ? 0.14 : 0.07),
              AppTheme.raisedSurface.withValues(alpha: 0),
            ],
          ),
        ),
        child: Padding(
          padding: padding,
          child: child,
        ),
      ),
    );

    if (onTap == null) return content;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(radius),
        child: content,
      ),
    );
  }
}

class RepartidorExecutiveIcon extends StatelessWidget {
  const RepartidorExecutiveIcon({
    required this.icon,
    required this.color,
    super.key,
    this.size = 20,
  });

  final IconData icon;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: color.withValues(alpha: 0.24)),
      ),
      child: Icon(icon, color: color, size: size),
    );
  }
}

class RepartidorExecutivePill extends StatelessWidget {
  const RepartidorExecutivePill({
    required this.label,
    required this.color,
    super.key,
    this.icon,
    this.selected = false,
    this.onTap,
  });

  final String label;
  final Color color;
  final IconData? icon;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? color : AppTheme.textSecondary;
    final bg = selected ? color.withValues(alpha: 0.15) : AppTheme.softPanel;
    final border =
        selected ? color.withValues(alpha: 0.5) : AppTheme.borderColor;

    final child = AnimatedContainer(
      duration: AppTheme.animFast,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: border, width: selected ? 1.4 : 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: fg),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: TextStyle(
              color: fg,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );

    if (onTap == null) return child;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: child,
    );
  }
}

class RepartidorExecutiveSheet extends StatelessWidget {
  const RepartidorExecutiveSheet({
    required this.child,
    super.key,
    this.accentColor = AppTheme.info,
    this.height,
    this.showHandle = true,
  });

  final Widget child;
  final Color accentColor;
  final double? height;
  final bool showHandle;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(AppTheme.radiusXl),
        ),
        border: Border(
          top: BorderSide(color: accentColor.withValues(alpha: 0.34)),
        ),
        boxShadow: AppTheme.elevation3,
      ),
      child: Column(
        mainAxisSize: height == null ? MainAxisSize.min : MainAxisSize.max,
        children: [
          if (showHandle)
            Container(
              margin: const EdgeInsets.only(top: 12, bottom: 8),
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: accentColor.withValues(alpha: 0.36),
                borderRadius: BorderRadius.circular(AppTheme.radiusFull),
              ),
            ),
          if (height == null) child else Expanded(child: child),
        ],
      ),
    );
  }
}
