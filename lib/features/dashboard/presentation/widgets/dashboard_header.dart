import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/formatters.dart';
import 'package:gmp_app_mobilidad/features/authentication/domain/entities/user.dart';

/// [DashboardHeader] - Header del dashboard premium V2.5
///
/// CARACTERÍSTICAS:
/// - Saludo personalizado según hora del día
/// - Avatar con gradiente premium
/// - Último acceso con icono animado
/// - Glassmorphism sutil
class DashboardHeader extends StatelessWidget {
  const DashboardHeader({
    super.key,
    this.user,
  });

  final User? user;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final greeting = _getGreeting(now.hour);
    final initials = user?.initials ?? 'U';
    final name = user?.name ?? 'Usuario';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.glassMorphismPremium(
        borderRadius: AppTheme.radiusLg.toDouble(),
        glowColor: AppTheme.neonBlue,
        glowBlur: 20,
      ),
      child: Row(
        children: [
          // Avatar premium con gradiente
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              gradient: AppTheme.primaryGradient,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: AppTheme.neonBlue.withValues(alpha: 0.3),
                  blurRadius: 12,
                  spreadRadius: 1,
                ),
              ],
            ),
            child: Center(
              child: Text(
                initials,
                style: const TextStyle(
                  color: AppTheme.darkBase,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),

          const SizedBox(width: 16),

          // Información del usuario
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  greeting,
                  style: AppTheme.bodyLabel.copyWith(
                    color: AppTheme.textSecondary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  name,
                  style: AppTheme.displayTitle.copyWith(
                    color: AppTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Icon(
                      Icons.access_time,
                      size: 13,
                      color: AppTheme.textTertiary,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'Último acceso: ${Formatters.dateTimeShort(user?.lastLoginAt ?? now)}',
                      style: AppTheme.captionText,
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Badge de zona premium
          if (user?.zone != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppTheme.neonBlue, AppTheme.neonPurple],
                ),
                borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.neonBlue.withValues(alpha: 0.25),
                    blurRadius: 8,
                  ),
                ],
              ),
              child: Text(
                user!.zone!,
                style: const TextStyle(
                  color: AppTheme.darkBase,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
        ],
      ),
    );
  }

  String _getGreeting(int hour) {
    if (hour < 12) {
      return 'Buenos días';
    } else if (hour < 19) {
      return 'Buenas tardes';
    } else {
      return 'Buenas noches';
    }
  }
}
