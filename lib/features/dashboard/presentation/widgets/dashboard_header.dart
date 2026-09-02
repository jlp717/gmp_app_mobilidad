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
        borderRadius: AppTheme.radiusLg,
        glowColor: AppTheme.info,
        glowBlur: 20,
      ),
      child: Row(
        children: [
          // Avatar operativo compacto.
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppTheme.info,
              shape: BoxShape.circle,
              border: Border.all(
                color: AppTheme.textPrimary.withValues(alpha: 0.12),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.18),
                  blurRadius: 8,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Center(
              child: Text(
                initials,
                style: TextStyle(
                  color: AppTheme.inkSurface,
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
                color: AppTheme.info.withValues(alpha: 0.16),
                borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                border: Border.all(
                  color: AppTheme.info.withValues(alpha: 0.36),
                ),
              ),
              child: Text(
                user!.zone!,
                style: TextStyle(
                  color: AppTheme.textPrimary,
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
