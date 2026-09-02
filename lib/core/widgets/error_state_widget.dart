import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Shared error state widget with retry support.
class ErrorStateWidget extends StatelessWidget {
  const ErrorStateWidget({
    required this.message,
    super.key,
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
    final reduceMotion = MediaQuery.of(context).disableAnimations;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: AppTheme.cardGradient,
                border: Border.all(
                  color: AppTheme.error.withValues(alpha: 0.48),
                ),
                boxShadow: [
                  ...AppTheme.elevation2,
                  BoxShadow(
                    color: AppTheme.error.withValues(alpha: 0.14),
                    blurRadius: 26,
                  ),
                ],
              ),
              child: Icon(
                Icons.error_outline_rounded,
                color: AppTheme.error,
                size: iconSize,
              ),
            ).animate().fadeIn(duration: reduceMotion ? 1.ms : 220.ms).scale(
                  begin: reduceMotion
                      ? const Offset(1, 1)
                      : const Offset(0.96, 0.96),
                ),
            const SizedBox(height: 16),
            Text(
              message,
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 14,
                height: 1.5,
                letterSpacing: 0,
              ),
              textAlign: TextAlign.center,
            ).animate().fadeIn(delay: 80.ms, duration: 180.ms),
            if (onRetry != null) ...[
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: Text(retryLabel),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.error,
                  side: BorderSide(
                    color: AppTheme.error.withValues(alpha: 0.38),
                  ),
                ),
              ).animate().fadeIn(delay: 120.ms, duration: 180.ms),
            ],
          ],
        ),
      ),
    );
  }
}
