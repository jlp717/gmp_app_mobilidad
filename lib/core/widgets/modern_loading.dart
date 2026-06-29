import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Shared loading indicator with the executive visual language.
class ModernLoading extends StatelessWidget {
  const ModernLoading({
    super.key,
    this.message,
    this.size = 80,
  });

  final String? message;
  final double size;

  @override
  Widget build(BuildContext context) {
    final indicatorSize = size.clamp(32, 64).toDouble();
    final reduceMotion = MediaQuery.of(context).disableAnimations;

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: indicatorSize + 18,
            height: indicatorSize + 18,
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: AppTheme.cardGradient,
              border: Border.all(
                color: AppTheme.activeRing.withValues(alpha: 0.22),
              ),
              boxShadow: [
                ...AppTheme.elevation2,
                BoxShadow(
                  color: AppTheme.activeRing.withValues(alpha: 0.12),
                  blurRadius: 26,
                ),
              ],
            ),
            child: reduceMotion
                ? const Icon(
                    Icons.data_usage_rounded,
                    color: AppTheme.activeRing,
                  )
                : CircularProgressIndicator(
                    strokeWidth: indicatorSize > 48 ? 3 : 2.5,
                    color: AppTheme.activeRing,
                    backgroundColor: AppTheme.mutedPanel,
                  ),
          ),
          if (message != null) ...[
            const SizedBox(height: 18),
            Text(
              message!,
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 13,
                fontWeight: FontWeight.w600,
                letterSpacing: 0,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }
}
