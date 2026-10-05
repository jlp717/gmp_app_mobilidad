import 'package:gmp_app_mobilidad/core/models/estado_entrega.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

/// Visual tone of a rutero row. Red is only for a mandatory cobro that is
/// still open. A pending delivery without that cobro is a different tone.
enum RuteroRowTone {
  cobroObligatorio,
  entregaPendiente,
  cobroOpcional,
  entregado,
  incidencia,
}

class RuteroRowVisual {
  const RuteroRowVisual({
    required this.tone,
    required this.label,
  });

  final RuteroRowTone tone;
  final String label;
}

/// Mandatory cobro is the domain flag already persisted as `esCTR`
/// (payment condition / route cobro flag). It is not inferred here.
bool ruteroCobroObligatorioPendiente(AlbaranEntrega albaran) {
  if (albaran.hasAppCobro) return false;
  if (!_entregaAbierta(albaran.estado)) return false;
  return albaran.esCTR;
}

bool _entregaAbierta(EstadoEntrega estado) {
  return estado == EstadoEntrega.pendiente || estado == EstadoEntrega.enRuta;
}

RuteroRowVisual ruteroRowVisual(AlbaranEntrega albaran) {
  switch (albaran.estado) {
    case EstadoEntrega.entregado:
      return const RuteroRowVisual(
        tone: RuteroRowTone.entregado,
        label: 'Entregado',
      );
    case EstadoEntrega.parcial:
      return const RuteroRowVisual(
        tone: RuteroRowTone.incidencia,
        label: 'Entrega parcial',
      );
    case EstadoEntrega.noEntregado:
      return const RuteroRowVisual(
        tone: RuteroRowTone.incidencia,
        label: 'No entregado',
      );
    case EstadoEntrega.rechazado:
      return const RuteroRowVisual(
        tone: RuteroRowTone.incidencia,
        label: 'Rechazado',
      );
    case EstadoEntrega.pendiente:
    case EstadoEntrega.enRuta:
      break;
  }
  if (ruteroCobroObligatorioPendiente(albaran)) {
    return const RuteroRowVisual(
      tone: RuteroRowTone.cobroObligatorio,
      label: 'Cobro obligatorio',
    );
  }
  if (albaran.puedeCobrarse && !albaran.hasAppCobro) {
    return const RuteroRowVisual(
      tone: RuteroRowTone.cobroOpcional,
      label: 'Entrega pendiente · cobro opcional',
    );
  }
  return const RuteroRowVisual(
    tone: RuteroRowTone.entregaPendiente,
    label: 'Entrega pendiente',
  );
}

/// One sentence a driver can act on without asking what the row means.
String ruteroStopActionHint(AlbaranEntrega albaran) {
  switch (albaran.estado) {
    case EstadoEntrega.entregado:
      return 'Entrega cerrada. La nota está en el detalle y en Histórico.';
    case EstadoEntrega.parcial:
    case EstadoEntrega.noEntregado:
    case EstadoEntrega.rechazado:
      return 'Hay una incidencia. Ábrela y revisa qué se entregó antes de seguir.';
    case EstadoEntrega.pendiente:
    case EstadoEntrega.enRuta:
      break;
  }
  if (albaran.cobradoPorComercial ||
      (albaran.hasAppCobro && !albaran.tieneSaldoCobrable)) {
    return 'Ya está cobrado. Solo hay que entregarlo; no uses Cobrar.';
  }
  if (albaran.hasAppCobro && albaran.tieneSaldoCobrable) {
    final pending = albaran.importePendienteCobro;
    if (pending != null) {
      return 'Cobro parcial. Queda ${pending.toStringAsFixed(2)} € por cobrar.';
    }
    return 'Cobro parcial. Cobra el resto que queda del documento.';
  }
  if (albaran.isPendingPrice) {
    return 'El precio aún no está en el ERP. Puedes entregar; el cobro espera el precio.';
  }
  if (!albaran.tieneSaldoCobrable) {
    return 'El documento es 0,00 €. Puedes entregarlo sin cobrar.';
  }
  if (ruteroCobroObligatorioPendiente(albaran)) {
    return 'Hay saldo. El cierre exige el cobro junto con la entrega.';
  }
  return 'Puedes cobrar el saldo o entregar sin cobrar.';
}
