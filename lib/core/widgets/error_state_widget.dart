import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Shared error state widget — V2 Premium.
/// Displays an error icon, message, and optional retry button with modern styling.
class ErrorStateWidget extends StatelessWidget {

  const ErrorStateWidget({
    required this.message, super.key,
    this.onRetry,
    this.retryLabel = 'Reintentar',
    this.iconSize = 48,
  });
  final String message;
  final VoidCallback? onRetry;
  final String retryLabel;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Icon with glow
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTheme.error.withValues(alpha: 0.08),
                border: Border.all(color: AppTheme.error.withValues(alpha: 0.15)),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.error.withValues(alpha: 0.1),
                    blurRadius: 20,
                    spreadRadius: 4,
                  ),
                ],
              ),
              child: Icon(
                Icons.error_outline_rounded,
                color: AppTheme.error,
                size: iconSize,
              ),
            ).animate().fadeIn(duration: 400.ms).scale(begin: const Offset(0.8, 0.8)),
            const SizedBox(height: 16),
            Text(
              message,
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 14,
                height: 1.5,
              ),
              textAlign: TextAlign.center,
            ).animate().fadeIn(delay: 200.ms),
            if (onRetry != null) ...[
              const SizedBox(height: 20),
              ElevatedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: Text(retryLabel),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.error.withValues(alpha: 0.15),
                  foregroundColor: AppTheme.error,
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                    side: BorderSide(color: AppTheme.error.withValues(alpha: 0.3)),
                  ),
                  elevation: 0,
                ),
              ).animate().fadeIn(delay: 300.ms),
            ],
          ],
        ),
      ),
    );
  }
}
