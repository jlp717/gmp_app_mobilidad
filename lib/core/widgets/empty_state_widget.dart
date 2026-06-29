import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Shared empty state widget.
class EmptyStateWidget extends StatelessWidget {
  const EmptyStateWidget({
    required this.title,
    super.key,
    this.icon = Icons.inbox_outlined,
    this.subtitle,
    this.onAction,
    this.actionLabel,
    this.iconColor,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onAction;
  final String? actionLabel;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final color = iconColor ?? AppTheme.textTertiary;
    final reduceMotion = MediaQuery.of(context).disableAnimations;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: AppTheme.cardGradient,
                border: Border.all(color: color.withValues(alpha: 0.30)),
                boxShadow: [
                  ...AppTheme.elevation2,
                  BoxShadow(
                    color: color.withValues(alpha: 0.10),
                    blurRadius: 24,
                  ),
                ],
              ),
              child: Icon(icon, color: color, size: 42),
            ).animate().fadeIn(duration: reduceMotion ? 1.ms : 220.ms).scale(
                  begin: reduceMotion
                      ? const Offset(1, 1)
                      : const Offset(0.96, 0.96),
                ),
            const SizedBox(height: 18),
            Text(
              title,
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 15,
                fontWeight: FontWeight.w700,
                height: 1.35,
                letterSpacing: 0,
              ),
              textAlign: TextAlign.center,
            ).animate().fadeIn(delay: 80.ms, duration: 180.ms),
            if (subtitle != null) ...[
              const SizedBox(height: 8),
              Text(
                subtitle!,
                style: const TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: 13,
                  height: 1.45,
                  letterSpacing: 0,
                ),
                textAlign: TextAlign.center,
              ).animate().fadeIn(delay: 120.ms, duration: 180.ms),
            ],
            if (onAction != null && actionLabel != null) ...[
              const SizedBox(height: 22),
              OutlinedButton.icon(
                onPressed: onAction,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: Text(actionLabel!),
              ).animate().fadeIn(delay: 160.ms, duration: 180.ms),
            ],
          ],
        ),
      ),
    );
  }
}
