import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Shared loading indicator with a quiet operational style.
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

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: indicatorSize,
            height: indicatorSize,
            child: CircularProgressIndicator(
              strokeWidth: indicatorSize > 48 ? 3 : 2.5,
              color: AppTheme.info,
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
