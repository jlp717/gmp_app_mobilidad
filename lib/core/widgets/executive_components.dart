import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class ExecutiveSurface extends StatelessWidget {
  const ExecutiveSurface({
    required this.child,
    super.key,
    this.accentColor,
    this.padding = const EdgeInsets.all(14),
    this.margin,
    this.onTap,
    this.isCommand = false,
  });

  final Widget child;
  final Color? accentColor;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final VoidCallback? onTap;
  final bool isCommand;

  @override
  Widget build(BuildContext context) {
    final accent = accentColor ?? AppTheme.activeRing;
    final radius = BorderRadius.circular(AppTheme.radiusLg);
    final content = Container(
      margin: margin,
      decoration: BoxDecoration(
        gradient: isCommand ? AppTheme.commandGradient : AppTheme.cardGradient,
        borderRadius: radius,
        border: Border.all(color: accent.withValues(alpha: 0.24)),
        boxShadow: [
          ...AppTheme.elevation2,
          BoxShadow(color: accent.withValues(alpha: 0.08), blurRadius: 22),
        ],
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border(
              top: BorderSide(
                  color: AppColors.themedWhite.withValues(alpha: 0.045)),
              left: BorderSide(color: accent.withValues(alpha: 0.46), width: 2),
            ),
          ),
          child: Padding(padding: padding, child: child),
        ),
      ),
    );

    if (onTap == null) return content;
    return InkWell(
      onTap: onTap,
      borderRadius: radius,
      child: content,
    );
  }
}

class ExecutiveSectionHeader extends StatelessWidget {
  const ExecutiveSectionHeader({
    required this.title,
    super.key,
    this.subtitle,
    this.icon,
    this.accentColor,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final Color? accentColor;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final accent = accentColor ?? AppTheme.activeRing;
    return ExecutiveSurface(
      accentColor: accent,
      isCommand: true,
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          if (icon != null) ...[
            _ExecutiveIcon(icon: icon!, color: accent, size: 20),
            const SizedBox(width: 12),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: AppTheme.headline.copyWith(
                    color: AppTheme.textPrimary,
                    fontSize: 17,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    subtitle!,
                    style: AppTheme.captionText,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null) ...[
            const SizedBox(width: 12),
            trailing!,
          ],
        ],
      ),
    );
  }
}

class ExecutiveCommandBar extends StatelessWidget {
  const ExecutiveCommandBar({
    required this.children,
    super.key,
    this.title,
    this.subtitle,
    this.icon,
    this.accentColor,
    this.actions = const [],
  });

  final String? title;
  final String? subtitle;
  final IconData? icon;
  final Color? accentColor;
  final List<Widget> children;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final accent = accentColor ?? AppTheme.activeRing;
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    final headerVisible = title != null || subtitle != null || icon != null;

    return ExecutiveSurface(
      accentColor: accent,
      isCommand: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (headerVisible) ...[
            Row(
              children: [
                if (icon != null) ...[
                  _ExecutiveIcon(icon: icon!, color: accent),
                  const SizedBox(width: 10),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (title != null)
                        Text(
                          title!,
                          style: AppTheme.headline.copyWith(
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      if (subtitle != null)
                        Text(
                          subtitle!,
                          style: AppTheme.captionText,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                    ],
                  ),
                ),
                ...actions,
              ],
            ),
            const SizedBox(height: 12),
          ],
          Wrap(
            spacing: 10,
            runSpacing: 10,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: children
                .asMap()
                .entries
                .map(
                  (entry) => reduceMotion
                      ? entry.value
                      : entry.value
                          .animate(delay: (entry.key * 20).ms)
                          .fadeIn(duration: 160.ms)
                          .slideY(begin: 0.06, end: 0),
                )
                .toList(),
          ),
        ],
      ),
    );
  }
}

class ExecutiveFilterChip extends StatelessWidget {
  const ExecutiveFilterChip({
    required this.label,
    required this.selected,
    super.key,
    this.value,
    this.count,
    this.icon,
    this.color,
    this.onTap,
    this.onDeleted,
  });

  final String label;
  final String? value;
  final int? count;
  final IconData? icon;
  final Color? color;
  final bool selected;
  final VoidCallback? onTap;
  final VoidCallback? onDeleted;

  @override
  Widget build(BuildContext context) {
    final accent = color ?? AppTheme.activeRing;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTheme.radiusFull),
      child: AnimatedContainer(
        duration: AppTheme.animFast,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          gradient: selected
              ? LinearGradient(
                  colors: [
                    accent.withValues(alpha: 0.28),
                    accent.withValues(alpha: 0.10),
                  ],
                )
              : null,
          color: selected ? null : AppTheme.surfaceCommand,
          borderRadius: BorderRadius.circular(AppTheme.radiusFull),
          border: Border.all(
            color: accent.withValues(alpha: selected ? 0.48 : 0.20),
          ),
          boxShadow: selected
              ? [
                  BoxShadow(
                    color: accent.withValues(alpha: 0.12),
                    blurRadius: 18,
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(
                icon,
                color: selected ? accent : AppTheme.textSecondary,
                size: 16,
              ),
              const SizedBox(width: 7),
            ],
            Text(
              value == null ? label : '$label: $value',
              style: TextStyle(
                color: selected ? AppTheme.textPrimary : AppTheme.textSecondary,
                fontSize: 12,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
              ),
            ),
            if (count != null) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                ),
                child: Text(
                  '$count',
                  style: TextStyle(
                    color: accent,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
            if (onDeleted != null) ...[
              const SizedBox(width: 6),
              GestureDetector(
                onTap: onDeleted,
                child: Icon(Icons.close_rounded, color: accent, size: 15),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class ExecutiveSearchField extends StatelessWidget {
  const ExecutiveSearchField({
    required this.controller,
    required this.onChanged,
    super.key,
    this.hintText = 'Buscar',
    this.accentColor,
    this.onClear,
    this.enabled = true,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final String hintText;
  final Color? accentColor;
  final VoidCallback? onClear;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final accent = accentColor ?? AppTheme.activeRing;
    return SizedBox(
      width: 320,
      child: TextField(
        controller: controller,
        enabled: enabled,
        onChanged: onChanged,
        style: TextStyle(color: AppTheme.textPrimary, fontSize: 13),
        decoration: InputDecoration(
          hintText: hintText,
          prefixIcon: Icon(Icons.manage_search_rounded, color: accent),
          suffixIcon: controller.text.isEmpty
              ? null
              : IconButton(
                  onPressed: onClear,
                  icon: Icon(Icons.close_rounded, color: accent),
                ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            borderSide: BorderSide(color: accent, width: 1.6),
          ),
        ),
      ),
    );
  }
}

class _ExecutiveIcon extends StatelessWidget {
  const _ExecutiveIcon({
    required this.icon,
    required this.color,
    this.size = 18,
  });

  final IconData icon;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size + 18,
      height: size + 18,
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
        border: Border.all(color: color.withValues(alpha: 0.30)),
        boxShadow: [
          BoxShadow(color: color.withValues(alpha: 0.10), blurRadius: 16),
        ],
      ),
      child: Icon(icon, color: color, size: size),
    );
  }
}
