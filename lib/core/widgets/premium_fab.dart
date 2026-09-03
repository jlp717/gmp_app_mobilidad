import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Shared floating action button.
///
/// The legacy class name is retained for compatibility with existing screens.
class PremiumFloatingActionButton extends StatelessWidget {
  const PremiumFloatingActionButton({
    required this.onPressed,
    this.icon,
    this.label,
    this.accentColor,
    this.size = 56,
    super.key,
  });

  final VoidCallback onPressed;
  final IconData? icon;
  final String? label;
  final Color? accentColor;
  final double size;

  @override
  Widget build(BuildContext context) {
    final color = accentColor ?? AppTheme.info;
    final isExtended = label != null;

    final button = Material(
      color: color,
      elevation: 4,
      shadowColor: AppColors.systemBlack.withValues(alpha: 0.24),
      shape: isExtended
          ? RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusFull),
            )
          : const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        borderRadius: isExtended
            ? BorderRadius.circular(AppTheme.radiusFull)
            : BorderRadius.circular(size / 2),
        child: isExtended
            ? Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (icon != null) ...[
                      Icon(icon, size: 20, color: AppColors.themedWhite),
                      const SizedBox(width: 8),
                    ],
                    Text(
                      label!,
                      style: TextStyle(
                        color: AppColors.themedWhite,
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                        letterSpacing: 0,
                      ),
                    ),
                  ],
                ),
              )
            : SizedBox(
                width: size,
                height: size,
                child: Center(
                  child: Icon(icon ?? Icons.add,
                      size: 24, color: AppColors.themedWhite),
                ),
              ),
      ),
    );

    return AnimatedScale(
      scale: 1,
      duration: AppTheme.animFast,
      curve: Curves.easeOut,
      child: button,
    );
  }
}
