import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_stop_visual.dart';

class RuteroStopStatusBadges extends StatelessWidget {
  const RuteroStopStatusBadges({super.key, required this.albaran});
  final AlbaranEntrega albaran;

  @override
  Widget build(BuildContext context) {
    final visual = ruteroRowVisual(albaran);
    final statusColor = switch (visual.tone) {
      RuteroRowTone.cobroObligatorio => AppTheme.obligatorio,
      RuteroRowTone.entregaPendiente => AppTheme.info,
      RuteroRowTone.cobroOpcional => AppTheme.opcional,
      RuteroRowTone.entregado => AppTheme.success,
      RuteroRowTone.incidencia => AppTheme.warning,
    };
    final payment = albaran.hasAppCobro
        ? albaran.cobroParcial
            ? albaran.importePendienteCobro == null
                ? 'Cobro parcial · saldo por actualizar'
                : 'Cobro parcial · pendiente ${albaran.importePendienteCobro!.toStringAsFixed(2)} €'
            : albaran.importePendienteCobro == null
                ? 'Cobro registrado · saldo por actualizar'
                : 'Cobrado'
        : visual.label;
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
                  style: TextStyle(color: AppTheme.textPrimary, fontSize: 12))),
        ])),
      );
}
