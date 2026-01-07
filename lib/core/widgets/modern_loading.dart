import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../theme/app_theme.dart';

class ModernLoading extends StatelessWidget {
  final String? message;
  final double size;

  const ModernLoading({
    super.key,
    this.message,
    this.size = 80,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Futuristic Spinner Container
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
                      color: AppTheme.neonBlue.withOpacity(0.1),
                      width: 1,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.neonBlue.withOpacity(0.1),
                        blurRadius: 20,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                ).animate(onPlay: (c) => c.repeat(reverse: true))
                 .scaleXY(begin: 0.9, end: 1.1, duration: 1.5.seconds),

                // Rotating Arcs
                SizedBox(
                  width: size * 0.8,
                  height: size * 0.8,
                  child: CircularProgressIndicator(
                    color: AppTheme.neonBlue,
                    strokeWidth: 3,
                    backgroundColor: AppTheme.neonBlue.withOpacity(0.1),
                  ),
                ),
                
                // Inner Pulse
                Container(
                  width: size * 0.3,
                  height: size * 0.3,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppTheme.neonBlue.withOpacity(0.2),
                  ),
                ).animate(onPlay: (c) => c.repeat(reverse: true))
                 .fade(begin: 0.2, end: 0.8, duration: 1.seconds),
              ],
            ),
          ),

          if (message != null) ...[
            const SizedBox(height: 24),
            Text(
              message!,
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 15,
                fontWeight: FontWeight.w500,
                letterSpacing: 1.2,
              ),
            ).animate()
             .fadeIn(duration: 500.ms)
             .shimmer(duration: 2.seconds, color: Colors.white.withOpacity(0.5)),
          ],
        ],
      ),
    );
  }
}
