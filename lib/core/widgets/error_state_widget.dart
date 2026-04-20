import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Shared error state widget used across multiple pages.
/// Displays an error icon, message, and optional retry button.
class ErrorStateWidget extends StatelessWidget {

  const ErrorStateWidget({
    required this.message, super.key,
    this.onRetry,
    this.retryLabel = 'Reintentar',
  });
  final String message;
  final VoidCallback? onRetry;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.error_outline,
            color: AppTheme.error,
            size: 48,
          ),
          const SizedBox(height: 12),
          Text(
            message,
            style: const TextStyle(color: AppTheme.textSecondary),
            textAlign: TextAlign.center,
          ),
          if (onRetry != null) ...[
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: Text(retryLabel),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.neonGreen,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
