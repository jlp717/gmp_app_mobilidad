import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

/// Coming Soon placeholder — V2 Premium.
/// Animated, modern design for features under development.
class ComingSoonPlaceholder extends StatelessWidget {
  const ComingSoonPlaceholder({
    required this.title,
    super.key,
    this.subtitle =
        'Estamos trabajando en esta funcionalidad.\nDisponible próximamente.',
    this.icon = Icons.rocket_launch,
    this.accentColor = AppTheme.neonPurple,
  });
  final String title;
  final String subtitle;
  final IconData icon;
  final Color accentColor;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Center(
        child: Padding(
          padding:
              EdgeInsets.all(Responsive.padding(context, small: 24, large: 40)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Animated icon with glow
              Builder(builder: (context) {
                final outerSize =
                    Responsive.value(context, phone: 90, desktop: 130);
                final innerSize =
                    Responsive.value(context, phone: 60, desktop: 88);
                final iconSz =
                    Responsive.iconSize(context, phone: 30, desktop: 44);
                return Container(
                  width: outerSize,
                  height: outerSize,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        accentColor.withValues(alpha: 0.15),
                        accentColor.withValues(alpha: 0.04),
                        Colors.transparent,
                      ],
                      stops: const [0.3, 0.7, 1.0],
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: accentColor.withValues(alpha: 0.08),
                        blurRadius: 30,
                        spreadRadius: 4,
                      ),
                    ],
                  ),
                  child: Center(
                    child: Container(
                      width: innerSize,
                      height: innerSize,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: accentColor.withValues(alpha: 0.08),
                        border: Border.all(
                          color: accentColor.withValues(alpha: 0.2),
                          width: 1.5,
                        ),
                      ),
                      child: Icon(icon, size: iconSz, color: accentColor),
                    ),
                  ),
                )
                    .animate()
                    .fadeIn(duration: 600.ms)
                    .scale(
                        begin: const Offset(0.85, 0.85),
                        curve: Curves.easeOutCubic)
                    .then()
                    .shimmer(
                        duration: 3.seconds,
                        color: accentColor.withValues(alpha: 0.15));
              }),
              const SizedBox(height: 32),
              // Title with gradient
              ShaderMask(
                shaderCallback: (bounds) => LinearGradient(
                  colors: [accentColor, accentColor.withValues(alpha: 0.7)],
                ).createShader(bounds),
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize:
                        Responsive.fontSize(context, small: 20, large: 26),
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    letterSpacing: -0.3,
                  ),
                  textAlign: TextAlign.center,
                ),
              ).animate().fadeIn(delay: 200.ms).slideY(begin: 0.1),
              const SizedBox(height: 12),
              // Subtitle
              Text(
                subtitle,
                style: TextStyle(
                  fontSize: 14,
                  color: AppTheme.textSecondary,
                  height: 1.6,
                ),
                textAlign: TextAlign.center,
              ).animate().fadeIn(delay: 350.ms),
              const SizedBox(height: 32),
              // Badge
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                  color: accentColor.withValues(alpha: 0.08),
                  border: Border.all(color: accentColor.withValues(alpha: 0.2)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.construction_rounded,
                        size: 14, color: accentColor),
                    const SizedBox(width: 8),
                    Text(
                      'EN DESARROLLO',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: accentColor,
                        letterSpacing: 1.2,
                      ),
                    ),
                  ],
                ),
              ).animate().fadeIn(delay: 500.ms),
            ],
          ),
        ),
      ),
    );
  }
}
