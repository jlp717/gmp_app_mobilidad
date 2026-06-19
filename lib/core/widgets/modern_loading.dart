import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Modern loading indicator — V2 Premium.
/// Futuristic spinner with layered animations and subtle glow effects.
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
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Futuristic Spinner
          SizedBox(
            width: size,
            height: size,
            child: Stack(
              alignment: Alignment.center,
              children: [
                // Outer Glow Ring
                Container(
                  width: size,
                  height: size,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: AppTheme.neonBlue.withValues(alpha: 0.08),
                      width: 1,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.neonBlue.withValues(alpha: 0.06),
                        blurRadius: 16,
                        spreadRadius: 1,
                      ),
                    ],
                  ),
                ).animate(onPlay: (c) => c.repeat(reverse: true)).scaleXY(
                    begin: 0.92,
                    end: 1.08,
                    duration: 1.8.seconds,
                    curve: Curves.easeInOut),

                // Rotating Arc — outer
                SizedBox(
                  width: size * 0.85,
                  height: size * 0.85,
                  child: CircularProgressIndicator(
                    color: AppTheme.neonBlue.withValues(alpha: 0.6),
                    strokeWidth: 2.5,
                    backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.06),
                  ),
                ).animate(onPlay: (c) => c.repeat()).rotate(
                    begin: 0,
                    end: 1,
                    duration: 2.seconds,
                    curve: Curves.linear),

                // Rotating Arc — inner (counter-rotate)
                SizedBox(
                  width: size * 0.55,
                  height: size * 0.55,
                  child: CircularProgressIndicator(
                    color: AppTheme.neonPurple.withValues(alpha: 0.4),
                    strokeWidth: 2,
                    backgroundColor:
                        AppTheme.neonPurple.withValues(alpha: 0.04),
                  ),
                ).animate(onPlay: (c) => c.repeat()).rotate(
                    begin: 1,
                    end: 0,
                    duration: 1.5.seconds,
                    curve: Curves.linear),

                // Inner Pulse
                Container(
                  width: size * 0.2,
                  height: size * 0.2,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppTheme.neonBlue.withValues(alpha: 0.15),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.neonBlue.withValues(alpha: 0.1),
                        blurRadius: 8,
                      ),
                    ],
                  ),
                ).animate(onPlay: (c) => c.repeat(reverse: true)).fade(
                    begin: 0.2,
                    end: 0.7,
                    duration: 1.2.seconds,
                    curve: Curves.easeInOut),
              ],
            ),
          ),

          if (message != null) ...[
            const SizedBox(height: 24),
            Text(
              message!,
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 14,
                fontWeight: FontWeight.w500,
                letterSpacing: 0.8,
              ),
            ).animate().fadeIn(duration: 500.ms).shimmer(
                duration: 2.5.seconds,
                color: Colors.white.withValues(alpha: 0.3)),
          ],
        ],
      ),
    );
  }
}
