/// Order Status Badge
/// ==================
/// Reusable badge showing order status with color, icon and animation.

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

class OrderTheme {
  final Color primary;
  final List<Color> gradient;
  final IconData icon;
  final String label;

  const OrderTheme({
    required this.primary,
    required this.gradient,
    required this.icon,
    required this.label,
  });
}

class OrderStatusConfig {
  static const Map<String, OrderTheme> themes = {
    'BORRADOR': OrderTheme(
      primary: Color(0xFFF97316),
      gradient: [Color(0xFF1E293B), Color(0xFF2D1B00)],
      icon: Icons.edit_note,
      label: 'Borrador',
    ),
    'CONFIRMADO': OrderTheme(
      primary: Color(0xFF3B82F6),
      gradient: [Color(0xFF1E293B), Color(0xFF0C1A3A)],
      icon: Icons.check_circle,
      label: 'Confirmado',
    ),
    'ENVIADO': OrderTheme(
      primary: Color(0xFF22C55E),
      gradient: [Color(0xFF1E293B), Color(0xFF0A2E1A)],
      icon: Icons.local_shipping,
      label: 'Enviado',
    ),
    'FACTURADO': OrderTheme(
      primary: Color(0xFFA855F7),
      gradient: [Color(0xFF1E293B), Color(0xFF1A0A2E)],
      icon: Icons.receipt_long,
      label: 'Facturado',
    ),
    'ANULADO': OrderTheme(
      primary: Color(0xFFEF4444),
      gradient: [Color(0xFF1E293B), Color(0xFF2E0A0A)],
      icon: Icons.cancel,
      label: 'Anulado',
    ),
  };

  static OrderTheme getTheme(String? estado) {
    return themes[estado?.toUpperCase()] ??
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
  final String estado;
  final double fontSize;
  final bool showIcon;

  const OrderStatusBadge({
    Key? key,
    required this.estado,
    this.fontSize = 11,
    this.showIcon = true,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final theme = OrderStatusConfig.getTheme(estado);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            theme.primary.withOpacity(0.2),
            theme.primary.withOpacity(0.1)
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: theme.primary.withOpacity(0.4)),
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
                      color: theme.primary.withOpacity(0.6), blurRadius: 4),
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
