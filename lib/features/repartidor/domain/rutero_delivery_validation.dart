import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';

enum RuteroDeliveryTab { products, payment, finalize }

/// Which nested scroll pane owns a validation field.
enum RuteroScrollPane { products, payment, finalize }

RuteroScrollPane ruteroScrollPaneForField(String field) {
  switch (field) {
    case 'items':
    case 'productsStatus':
      return RuteroScrollPane.products;
    case 'pago':
    case 'importe':
      return RuteroScrollPane.payment;
    default:
      return RuteroScrollPane.finalize;
  }
}

/// One blocking field error in the three-tab delivery sheet.
class RuteroFieldIssue {
  const RuteroFieldIssue({
    required this.tab,
    required this.field,
    required this.message,
  });

  final RuteroDeliveryTab tab;
  final String field;
  final String message;

  int get tabIndex {
    switch (tab) {
      case RuteroDeliveryTab.products:
        return 0;
      case RuteroDeliveryTab.payment:
        return 1;
      case RuteroDeliveryTab.finalize:
        return 2;
    }
  }
}

class RuteroDeliveryValidationInput {
  const RuteroDeliveryValidationInput({
    required this.isLoadingItems,
    required this.loadError,
    required this.hasItems,
    required this.anyQtyModified,
    required this.anyUnchecked,
    required this.status,
    required this.nombre,
    required this.apellidos,
    required this.dni,
    required this.observaciones,
    required this.incidenciaMotivo,
    required this.isUrgent,
    required this.isPaid,
    required this.signatureEmpty,
    required this.hasPersistedSignature,
    required this.importeCobradoText,
    required this.importeTotal,
    this.importeDisponibleCobro,
    this.importeMaxCobrable,
  });

  final bool isLoadingItems;
  final String? loadError;
  final bool hasItems;
  final bool anyQtyModified;
  final bool anyUnchecked;
  final RepartoDeliveryStatus status;
  final String nombre;
  final String apellidos;
  final String dni;
  final String observaciones;
  final String incidenciaMotivo;
  final bool isUrgent;
  final bool isPaid;
  final bool signatureEmpty;
  final bool hasPersistedSignature;
  final String importeCobradoText;
  final double importeTotal;
  final double? importeDisponibleCobro;

  /// Server-enforced ceiling for the payment amount. On a complete delivery
  /// it equals the pending balance; on a partial one it is capped by the
  /// delivered-lines sum, mirroring the backend assertPayment rule.
  final double? importeMaxCobrable;

  /// Effective ceiling applied to the payment field.
  double get effectiveMaxCobro =>
      importeMaxCobrable ?? importeDisponibleCobro ?? importeTotal;

  bool get hasDiscrepancy => anyQtyModified || anyUnchecked;
}

class RuteroDeliveryValidationResult {
  const RuteroDeliveryValidationResult(this.issues);

  final List<RuteroFieldIssue> issues;

  bool get isValid => issues.isEmpty;

  int get firstTabIndex {
    if (issues.isEmpty) return 0;
    return issues
        .map((issue) => issue.tabIndex)
        .reduce((a, b) => a < b ? a : b);
  }

  int countForTab(RuteroDeliveryTab tab) =>
      issues.where((issue) => issue.tab == tab).length;

  String? messageFor(String field) {
    for (final issue in issues) {
      if (issue.field == field) return issue.message;
    }
    return null;
  }
}

bool isValidRuteroDniNie(String value) {
  final cleaned = value.trim().toUpperCase();
  final regex = RegExp(r'^([XYZ]\d{7}|\d{8})[A-Z]$');
  if (!regex.hasMatch(cleaned)) return false;
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  var numStr = cleaned.substring(0, cleaned.length - 1);
  numStr = numStr
      .replaceFirst('X', '0')
      .replaceFirst('Y', '1')
      .replaceFirst('Z', '2');
  final parsed = int.tryParse(numStr);
  if (parsed == null) return false;
  return cleaned[cleaned.length - 1] == letters[parsed % 23];
}

double? parseRuteroMoney(String value) {
  final trimmed = value.trim();
  final normalized = trimmed.contains(',')
      ? trimmed.replaceAll('.', '').replaceAll(',', '.')
      : trimmed;
  if (normalized.isEmpty) return null;
  final parsed = double.tryParse(normalized);
  if (parsed == null || parsed.isNaN || parsed.isInfinite) return null;
  return double.parse(parsed.toStringAsFixed(2));
}

/// Returns the next automatic payment suggestion only while the current
/// value still matches the previous suggestion. This lets repeated quantity
/// edits follow the partial-delivery ceiling without overwriting manual input.
double? nextRuteroSuggestedPaymentAmount({
  required double? currentAmount,
  required double? lastSuggestedAmount,
  required double? maximumAmount,
}) {
  if (lastSuggestedAmount == null || maximumAmount == null) {
    return null;
  }
  final matchesPreviousSuggestion = currentAmount != null &&
      (currentAmount - lastSuggestedAmount).abs() < 0.005;
  final isEmptyZeroSuggestion =
      currentAmount == null && lastSuggestedAmount.abs() < 0.005;
  if (!matchesPreviousSuggestion && !isEmptyZeroSuggestion) return null;
  return maximumAmount > 0.004
      ? double.parse(maximumAmount.toStringAsFixed(2))
      : 0;
}

/// Collects every visible field error so the sheet can jump to the first
/// failing tab instead of overwriting with the last check.
RuteroDeliveryValidationResult validateRuteroDeliveryForm(
  RuteroDeliveryValidationInput input,
) {
  final issues = <RuteroFieldIssue>[];

  if (input.isLoadingItems) {
    issues.add(
      const RuteroFieldIssue(
        tab: RuteroDeliveryTab.products,
        field: 'items',
        message: 'Espera a que terminen de cargar las líneas de entrega.',
      ),
    );
    return RuteroDeliveryValidationResult(issues);
  }
  if (input.loadError != null && input.loadError!.trim().isNotEmpty) {
    issues.add(
      RuteroFieldIssue(
        tab: RuteroDeliveryTab.products,
        field: 'items',
        message: input.loadError!,
      ),
    );
    return RuteroDeliveryValidationResult(issues);
  }
  if (!input.hasItems && input.importeTotal.abs() >= 0.005) {
    issues.add(
      const RuteroFieldIssue(
        tab: RuteroDeliveryTab.products,
        field: 'items',
        message:
            'La entrega no contiene líneas confirmables. Recarga el reparto.',
      ),
    );
    return RuteroDeliveryValidationResult(issues);
  }

  if (input.status == RepartoDeliveryStatus.entregado && input.hasDiscrepancy) {
    issues.add(
      const RuteroFieldIssue(
        tab: RuteroDeliveryTab.products,
        field: 'productsStatus',
        message:
            'Hay diferencias en productos. Elige PARCIAL, NO ENTREGADO o RECHAZADO.',
      ),
    );
  }
  if (input.status == RepartoDeliveryStatus.parcial && !input.hasDiscrepancy) {
    issues.add(
      const RuteroFieldIssue(
        tab: RuteroDeliveryTab.products,
        field: 'productsStatus',
        message:
            'PARCIAL requiere al menos una cantidad pendiente o un producto no entregado.',
      ),
    );
  }

  final paymentEligibleStatus =
      input.status == RepartoDeliveryStatus.entregado ||
          input.status == RepartoDeliveryStatus.parcial;
  final hasKnownCvcBalance = input.importeDisponibleCobro != null;
  final hasCollectibleBalance =
      !hasKnownCvcBalance || input.importeDisponibleCobro! > 0.004;
  if (paymentEligibleStatus &&
      input.isUrgent &&
      !input.isPaid &&
      hasCollectibleBalance) {
    issues.add(
      const RuteroFieldIssue(
        tab: RuteroDeliveryTab.payment,
        field: 'pago',
        message: 'Cobro obligatorio: marca el pago antes de confirmar.',
      ),
    );
  }

  if (input.isPaid && hasKnownCvcBalance && !hasCollectibleBalance) {
    issues.add(
      const RuteroFieldIssue(
        tab: RuteroDeliveryTab.payment,
        field: 'pago',
        message: 'No existe saldo cobrable en CVC para este documento.',
      ),
    );
  } else if (input.isPaid) {
    final importe = parseRuteroMoney(input.importeCobradoText);
    if (importe == null || importe <= 0) {
      issues.add(
        const RuteroFieldIssue(
          tab: RuteroDeliveryTab.payment,
          field: 'importe',
          message: 'Indica el importe cobrado.',
        ),
      );
    } else {
      final maxCobro = input.effectiveMaxCobro;
      final importeCentimos = (importe * 100).round();
      final maxCobroCentimos = (maxCobro * 100).round();
      if (importeCentimos > maxCobroCentimos) {
        final isPartialCeiling = input.importeMaxCobrable != null &&
            input.importeDisponibleCobro != null &&
            input.importeMaxCobrable! < input.importeDisponibleCobro!;
        issues.add(
          RuteroFieldIssue(
            tab: RuteroDeliveryTab.payment,
            field: 'importe',
            message: isPartialCeiling
                ? 'En entrega parcial el cobro no puede superar lo '
                    'entregado (${maxCobro.toStringAsFixed(2).replaceAll(
                          '.',
                          ',',
                        )} €).'
                : 'El importe no puede superar el saldo cobrable del '
                    'documento.',
          ),
        );
      }
    }
  }

  final observations = input.observaciones.trim();
  if (observations.length > 1000) {
    issues.add(
      const RuteroFieldIssue(
        tab: RuteroDeliveryTab.finalize,
        field: 'observaciones',
        message: 'Las observaciones no pueden superar 1000 caracteres.',
      ),
    );
  }

  final requiresIncident = input.status == RepartoDeliveryStatus.noEntregado ||
      input.status == RepartoDeliveryStatus.rechazado;
  if (requiresIncident &&
      (input.incidenciaMotivo.trim().isEmpty || observations.isEmpty)) {
    issues.add(
      const RuteroFieldIssue(
        tab: RuteroDeliveryTab.finalize,
        field: 'observaciones',
        message: 'La no entrega o rechazo exige incidencia y observaciones.',
      ),
    );
  }

  if (input.hasDiscrepancy && observations.isEmpty) {
    issues.add(
      RuteroFieldIssue(
        tab: RuteroDeliveryTab.finalize,
        field: 'observaciones',
        message: input.anyUnchecked
            ? 'Obligatorio: hay productos sin marcar como entregados.'
            : 'Obligatorio cuando se modifican cantidades.',
      ),
    );
  }

  if (input.status != RepartoDeliveryStatus.noEntregado) {
    if (input.nombre.trim().isEmpty) {
      issues.add(
        const RuteroFieldIssue(
          tab: RuteroDeliveryTab.finalize,
          field: 'nombre',
          message: 'El nombre del receptor es obligatorio.',
        ),
      );
    }
    if (input.apellidos.trim().isEmpty) {
      issues.add(
        const RuteroFieldIssue(
          tab: RuteroDeliveryTab.finalize,
          field: 'apellidos',
          message: 'Los apellidos del receptor son obligatorios.',
        ),
      );
    }
    final dniText = input.dni.trim();
    if (dniText.isEmpty) {
      issues.add(
        const RuteroFieldIssue(
          tab: RuteroDeliveryTab.finalize,
          field: 'dni',
          message: 'El DNI/NIF es obligatorio.',
        ),
      );
    } else if (!isValidRuteroDniNie(dniText)) {
      issues.add(
        const RuteroFieldIssue(
          tab: RuteroDeliveryTab.finalize,
          field: 'dni',
          message: 'Formato no válido (ej: 12345678A o X1234567B).',
        ),
      );
    }
    if (input.signatureEmpty && !input.hasPersistedSignature) {
      issues.add(
        RuteroFieldIssue(
          tab: RuteroDeliveryTab.finalize,
          field: 'firma',
          message: input.anyQtyModified
              ? 'FIRMA OBLIGATORIA: las cantidades no coinciden con el pedido.'
              : 'La firma es obligatoria.',
        ),
      );
    }
  }

  return RuteroDeliveryValidationResult(issues);
}
