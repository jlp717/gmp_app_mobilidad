import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../utils/responsive.dart';

/// Beautiful "Coming Soon" placeholder for features under development.
/// Preserves existing code while showing a professional placeholder.
class ComingSoonPlaceholder extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color accentColor;

  const ComingSoonPlaceholder({
    super.key,
    required this.title,
    this.subtitle = 'Estamos trabajando en esta funcionalidad.\nDisponible próximamente.',
    this.icon = Icons.rocket_launch,
    this.accentColor = AppTheme.neonPurple,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Center(
        child: Padding(
          padding: EdgeInsets.all(Responsive.padding(context, small: 24, large: 40)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Responsive icon container
              Builder(builder: (context) {
                final outerSize = Responsive.value(context, phone: 80, desktop: 120);
                final innerSize = Responsive.value(context, phone: 56, desktop: 80);
                final iconSz = Responsive.iconSize(context, phone: 28, desktop: 40);
                return Container(
                  width: outerSize,
                  height: outerSize,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        accentColor.withOpacity(0.2),
                        accentColor.withOpacity(0.05),
                        Colors.transparent,
                      ],
                      stops: const [0.3, 0.7, 1.0],
                    ),
                  ),
                  child: Center(
                    child: Container(
                      width: innerSize,
                      height: innerSize,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: accentColor.withOpacity(0.1),
                        border: Border.all(color: accentColor.withOpacity(0.3), width: 2),
                      ),
                      child: Icon(icon, size: iconSz, color: accentColor),
                    ),
                  ),
                );
              }),
              const SizedBox(height: 32),
              // Responsive title
              Text(
                title,
                style: TextStyle(
                  fontSize: Responsive.fontSize(context, small: 18, large: 24),
                  fontWeight: FontWeight.bold,
                  color: AppTheme.textPrimary,
                  letterSpacing: 0.5,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              // Subtitle
              Text(
                subtitle,
                style: TextStyle(
                  fontSize: 14,
                  color: AppTheme.textSecondary.withOpacity(0.8),
                  height: 1.5,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),
              // Badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  color: accentColor.withOpacity(0.1),
                  border: Border.all(color: accentColor.withOpacity(0.3)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.construction, size: 16, color: accentColor),
                    const SizedBox(width: 8),
                    Text(
                      'EN DESARROLLO',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: accentColor,
                        letterSpacing: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
