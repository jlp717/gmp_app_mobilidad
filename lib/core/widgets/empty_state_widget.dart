import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Shared empty state widget — V2 Premium.
/// Displays an icon, title, optional subtitle, and optional action button with modern styling.
class EmptyStateWidget extends StatelessWidget {

  const EmptyStateWidget({
    required this.title, super.key,
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Icon container with subtle glow
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withValues(alpha: 0.03),
                border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
              ),
              child: Icon(
                icon,
                color: iconColor ?? Colors.white.withValues(alpha: 0.2),
                size: 48,
              ),
            ).animate().fadeIn(duration: 400.ms).scale(begin: const Offset(0.85, 0.85)),
            const SizedBox(height: 20),
            Text(
              title,
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 15,
                fontWeight: FontWeight.w500,
                height: 1.4,
              ),
              textAlign: TextAlign.center,
            ).animate().fadeIn(delay: 150.ms),
            if (subtitle != null) ...[
              const SizedBox(height: 8),
              Text(
                subtitle!,
                style: const TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: 13,
                  height: 1.5,
                ),
                textAlign: TextAlign.center,
              ).animate().fadeIn(delay: 250.ms),
            ],
            if (onAction != null && actionLabel != null) ...[
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: onAction,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: Text(actionLabel!),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.12),
                  foregroundColor: AppTheme.neonBlue,
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                    side: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.25)),
                  ),
                  elevation: 0,
                ),
              ).animate().fadeIn(delay: 350.ms),
            ],
          ],
        ),
      ),
    );
  }
}
