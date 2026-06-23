/// Order Status Badge
/// ==================
/// Reusable badge showing order status with color, icon and animation.
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class OrderTheme {
  const OrderTheme({
    required this.primary,
    required this.gradient,
    required this.icon,
    required this.label,
  });
  final Color primary;
  final List<Color> gradient;
  final IconData icon;
  final String label;
}

class OrderStatusConfig {
  /// Estados visibles para comerciales: Borrador y Confirmado.
  static const Map<String, OrderTheme> themes = {
    'BORRADOR': OrderTheme(
      primary: Color(0xFFF97316),
      gradient: [Color(0xFF1E293B), Color(0xFF2D1B00)],
      icon: Icons.edit_note,
      label: 'Borrador',
    ),
    'CONFIRMADO': OrderTheme(
      primary: Color(0xFF22C55E),
      gradient: [Color(0xFF1E293B), Color(0xFF0A2E1A)],
      icon: Icons.check_circle,
      label: 'Confirmado',
    ),
  };

  /// Colapsa estados intermedios/legacy a los 2 estados comerciales.
  static String canonicalDisplayStatus(String? estado) {
    switch ((estado ?? '').trim().toUpperCase()) {
      case 'CONFIRMADO':
      case 'ENVIADO':
      case 'FACTURADO':
        return 'CONFIRMADO';
      case 'BORRADOR':
      case 'PENDIENTE':
      case 'PENDIENTE_APROBACION':
      case 'PEND_APROB':
      case 'CONFIRMANDO':
      case 'ANULADO':
        return 'BORRADOR';
      default:
        return 'BORRADOR';
    }
  }

  static OrderTheme getTheme(String? estado) {
    final key = canonicalDisplayStatus(estado);
    return themes[key] ??
        const OrderTheme(
          primary: Color(0xFF9CA3AF),
          gradient: [Color(0xFF1E293B), Color(0xFF1E293B)],
          icon: Icons.help_outline,
          label: 'Desconocido',
        );
  }

  static Color getColor(String? estado) => getTheme(estado).primary;
  static IconData getIcon(String? estado) => getTheme(estado).icon;
  static String getLabel(String? estado) => getTheme(estado).label;
}

class OrderStatusBadge extends StatelessWidget {
  const OrderStatusBadge({
    required this.estado,
    super.key,
    this.fontSize = 11,
    this.showIcon = true,
  });
  final String estado;
  final double fontSize;
  final bool showIcon;

  @override
  Widget build(BuildContext context) {
    final theme = OrderStatusConfig.getTheme(estado);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            theme.primary.withValues(alpha: 0.2),
            theme.primary.withValues(alpha: 0.1),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: theme.primary.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showIcon) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: theme.primary,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: theme.primary.withValues(alpha: 0.6),
                    blurRadius: 4,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
          ],
          Text(
            theme.label,
            style: TextStyle(
              color: theme.primary,
              fontSize: fontSize,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }
}
