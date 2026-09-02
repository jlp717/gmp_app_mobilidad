import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

class RuteroStopStatusBadges extends StatelessWidget {
  const RuteroStopStatusBadges({super.key, required this.albaran});
  final AlbaranEntrega albaran;

  @override
  Widget build(BuildContext context) {
    final statusColor = switch (albaran.estado) {
      EstadoEntrega.entregado => AppTheme.success,
      EstadoEntrega.parcial || EstadoEntrega.noEntregado => AppTheme.warning,
      EstadoEntrega.rechazado => AppTheme.error,
      EstadoEntrega.pendiente || EstadoEntrega.enRuta => AppTheme.obligatorio,
    };
    final payment = albaran.hasAppCobro
        ? albaran.cobroParcial
            ? albaran.importePendienteCobro == null
                ? 'Cobro parcial · saldo por actualizar'
                : 'Cobro parcial · pendiente ${albaran.importePendienteCobro!.toStringAsFixed(2)} €'
            : albaran.importePendienteCobro == null
                ? 'Cobro registrado · saldo por actualizar'
                : 'Cobrado'
        : albaran.esCTR || albaran.puedeCobrarse
            ? 'Cobro pendiente'
            : 'Sin cobro registrado';
    return Wrap(spacing: 8, runSpacing: 4, children: [
      _badge(
          albaran.estado.icon, 'Entrega: ${albaran.estado.label}', statusColor),
      _badge(
          Icons.payments_outlined,
          payment,
          albaran.hasAppCobro &&
                  !albaran.cobroParcial &&
                  albaran.importePendienteCobro != null
              ? AppTheme.success
              : AppTheme.warning),
    ]);
  }

  Widget _badge(IconData icon, String label, Color color) => Semantics(
        label: label,
        child: ExcludeSemantics(
            child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 4),
          Flexible(
              child: Text(label,
                  style: TextStyle(
                      color: AppTheme.textPrimary, fontSize: 12))),
        ])),
      );
}
