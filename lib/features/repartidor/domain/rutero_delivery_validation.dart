import 'package:gmp_app_mobilidad/core/money/money.dart';
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
    this.paymentMethod = 'EFECTIVO',
    this.numeroTalon = '',
    this.fechaVencimientoTalon = '',
    this.nombreBanco = '',
    this.codigoEntidadBancaria = '',
    this.cobroNotas = '',
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
  // Legacy wire/render compat: domain math must use the `...Money` getters
  // below (exact cents). The doubles stay so callers outside this cage
  // (rutero_detail_modal, rutero_detail_payment, print preview) keep
  // compiling; toJson-equivalent doubles are unchanged (cent-rounded).
  final double importeTotal;
  final String paymentMethod;
  final String numeroTalon;
  final String fechaVencimientoTalon;
  final String nombreBanco;
  final String codigoEntidadBancaria;
  final String cobroNotas;
  final double? importeDisponibleCobro;

  /// Server-enforced ceiling for the payment amount. On a complete delivery
  /// it equals the pending balance; on a partial one it is capped by the
  /// delivered-lines sum, mirroring the backend assertPayment rule.
  final double? importeMaxCobrable;

  /// Effective ceiling applied to the payment field.
  /// Never exceeds this albarán/factura; CVC leftover above the document
  /// belongs to other effects, not to this stop.
  double get effectiveMaxCobro => effectiveMaxCobroMoney.toDouble();

  /// Canonical money views (exact cents). New code must use these.
  Money get importeTotalMoney => Money.fromDouble(importeTotal);
  Money get importeDisponibleCobroMoney =>
      Money.moneyValue(importeDisponibleCobro, fallback: importeTotalMoney);
  Money? get importeMaxCobrableMoney =>
      importeMaxCobrable == null ? null : Money.fromDouble(importeMaxCobrable!);
  Money get effectiveMaxCobroMoney {
    final document = importeTotalMoney;
    if (!document.isPositive) return Money.zero;
    final ceiling = importeMaxCobrableMoney ?? document;
    return capSaldoCobrableAlDocumentoMoney(
      documentAmount: document,
      collectableAmount: ceiling,
    );
  }

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

/// Caps a CVC/partial collectable to the document being delivered.
/// Canonical money version: exact cents, no binary-float drift.
Money capSaldoCobrableAlDocumentoMoney({
  required Money documentAmount,
  required Money collectableAmount,
}) {
  if (collectableAmount.isZero || collectableAmount.isNegative) {
    return Money.zero;
  }
  if (documentAmount.isZero || documentAmount.isNegative) return Money.zero;
  return collectableAmount < documentAmount
      ? collectableAmount
      : documentAmount;
}

/// Caps a CVC/partial collectable to the document being delivered.
///
/// Legacy `double` compat (callers outside this cage). New code must use
/// [capSaldoCobrableAlDocumentoMoney]; the `double` comeback is render-only.
double capSaldoCobrableAlDocumento({
  required double documentAmount,
  required double collectableAmount,
}) =>
    capSaldoCobrableAlDocumentoMoney(
      documentAmount: Money.fromDouble(documentAmount),
      collectableAmount: Money.fromDouble(collectableAmount),
    ).toDouble();

/// One money identity for an albarán across list, sheet, cobro and PDFs.
///
/// Untouched document → ERP header already shown on the list
/// (`CPC.IMPORTETOTAL` via `resolveDeliveryAmount`). Do NOT substitute the
/// LAC qty×price sum: that is net of VAT and per-line rounded.
/// After the driver changes delivered qty (or unchecks a line) → live
/// delivered line sum, which is what liquidación and histórico must persist.
/// Canonical money version: exact cents, no binary-float drift.
Money canonicalRuteroDocumentAmountMoney({
  required Money headerAmount,
  required Money deliveredLineSum,
  required bool quantitiesChanged,
}) {
  if (!quantitiesChanged) return headerAmount;
  return deliveredLineSum.isZero ? headerAmount : deliveredLineSum;
}

/// Legacy `double` compat (callers outside this cage). New code must use
/// [canonicalRuteroDocumentAmountMoney]; the `double` comeback is render-only.
double canonicalRuteroDocumentAmount({
  required double headerAmount,
  required double deliveredLineSum,
  required bool quantitiesChanged,
}) =>
    canonicalRuteroDocumentAmountMoney(
      headerAmount: Money.fromDouble(headerAmount),
      deliveredLineSum: Money.fromDouble(deliveredLineSum),
      quantitiesChanged: quantitiesChanged,
    ).toDouble();

/// Yellow footer on the Finalizar tab. Empty after a completed delivery so
/// the driver never sees "Falta: Nombre…" on a stop that already has PDFs.
List<String> ruteroFinalizeGaps({
  required bool isCompleted,
  required RepartoDeliveryStatus status,
  required String nombre,
  required String apellidos,
  required String dni,
  required bool signatureEmpty,
  required bool hasPersistedSignature,
}) {
  if (isCompleted) return const <String>[];
  if (status == RepartoDeliveryStatus.noEntregado) {
    return const <String>[];
  }
  final gaps = <String>[];
  if (nombre.trim().isEmpty) gaps.add('Nombre');
  if (apellidos.trim().isEmpty) gaps.add('Apellidos');
  if (dni.trim().isEmpty) gaps.add('DNI');
  if (signatureEmpty && !hasPersistedSignature) gaps.add('Firma');
  return gaps;
}

String? ruteroFinalizeGapsMessage(List<String> gaps) {
  if (gaps.isEmpty) return null;
  return 'Falta: ${gaps.join(', ')}. Está justo encima del botón.';
}

const kRuteroTalonRequiredMessage =
    'El talón requiere número, vencimiento y banco validado.';

bool isRuteroTalonPaymentMethod(String method) {
  final normalized = method.trim().toUpperCase();
  return const {
    'TALON',
    'TALÓN',
    'CHEQUE',
    'CH',
    'TALON BANCARIO',
    'TRANSFERENCIA',
    'TRANSFER',
    'TR',
    'T0',
  }.contains(normalized);
}

/// Blocks confirm when Talón is selected and any of the 3 required fields
/// (número, vencimiento, banco ENB) is missing.
String? validateRuteroTalonFields({
  required String paymentMethod,
  required String numeroTalon,
  required String fechaVencimiento,
  required String nombreBanco,
  String codigoEntidad = '',
}) {
  if (!isRuteroTalonPaymentMethod(paymentMethod)) return null;
  if (numeroTalon.trim().isEmpty) return kRuteroTalonRequiredMessage;
  if (fechaVencimiento.trim().isEmpty) return kRuteroTalonRequiredMessage;
  final hasName = nombreBanco.trim().length >= 3;
  final hasCode = RegExp(r'^\d{4}$').hasMatch(codigoEntidad.trim());
  if (!hasName && !hasCode) return kRuteroTalonRequiredMessage;
  return null;
}

/// Canonical money parser: ES/international decimal text, exact cents.
/// Returns `null` for empty/invalid text. New code must use this.
Money? parseRuteroMoneyValue(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;
  final parsed = Money.tryParse(trimmed);
  if (parsed == null) return null;
  return parsed;
}

/// Legacy `double` compat (callers outside this cage). New code must use
/// [parseRuteroMoneyValue]; the `double` comeback is render-only.
double? parseRuteroMoney(String value) =>
    parseRuteroMoneyValue(value)?.toDouble();

/// Returns the next automatic payment suggestion only while the current
/// value still matches the previous suggestion. This lets repeated quantity
/// edits follow the partial-delivery ceiling without overwriting manual input.
/// Canonical money version: exact cent comparison, no epsilon drift.
Money? nextRuteroSuggestedPaymentAmountMoney({
  required Money? currentAmount,
  required Money? lastSuggestedAmount,
  required Money? maximumAmount,
}) {
  if (lastSuggestedAmount == null || maximumAmount == null) {
    return null;
  }
  final matchesPreviousSuggestion =
      currentAmount != null && currentAmount == lastSuggestedAmount;
  final isEmptyZeroSuggestion =
      currentAmount == null && lastSuggestedAmount.isZero;
  if (!matchesPreviousSuggestion && !isEmptyZeroSuggestion) return null;
  return maximumAmount.isPositive ? maximumAmount : Money.zero;
}

/// Returns the next automatic payment suggestion only while the current
/// value still matches the previous suggestion. This lets repeated quantity
/// edits follow the partial-delivery ceiling without overwriting manual input.
///
/// Legacy `double` compat (callers outside this cage). New code must use
/// [nextRuteroSuggestedPaymentAmountMoney].
double? nextRuteroSuggestedPaymentAmount({
  required double? currentAmount,
  required double? lastSuggestedAmount,
  required double? maximumAmount,
}) =>
    nextRuteroSuggestedPaymentAmountMoney(
      currentAmount:
          currentAmount == null ? null : Money.fromDouble(currentAmount),
      lastSuggestedAmount: lastSuggestedAmount == null
          ? null
          : Money.fromDouble(lastSuggestedAmount),
      maximumAmount:
          maximumAmount == null ? null : Money.fromDouble(maximumAmount),
    )?.toDouble();

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
  if (!input.hasItems && !input.importeTotalMoney.isZero) {
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
  final hasCollectibleBalance = input.importeTotalMoney.isPositive;
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

  if (input.isPaid && !hasCollectibleBalance) {
    issues.add(
      const RuteroFieldIssue(
        tab: RuteroDeliveryTab.payment,
        field: 'pago',
        message: 'No existe saldo cobrable en este documento.',
      ),
    );
  } else if (input.isPaid) {
    final importe = parseRuteroMoneyValue(input.importeCobradoText);
    final hasRealCobro = importe != null && importe.isPositive;
    final cobroNotes = input.cobroNotas.trim();
    // Observaciones only when there is a real cobro (>0). Credit / Sin cobro
    // must never block with an empty notes field.
    if (hasRealCobro && cobroNotes.isEmpty) {
      issues.add(
        const RuteroFieldIssue(
          tab: RuteroDeliveryTab.payment,
          field: 'pago',
          message: 'Las observaciones de cobro son obligatorias.',
        ),
      );
    }
    if (importe == null || !importe.isPositive) {
      issues.add(
        const RuteroFieldIssue(
          tab: RuteroDeliveryTab.payment,
          field: 'importe',
          message: 'Indica el importe cobrado.',
        ),
      );
    } else {
      final maxCobro = input.effectiveMaxCobroMoney;
      if (importe > maxCobro) {
        final isPartialCeiling =
            input.status == RepartoDeliveryStatus.parcial &&
                input.importeMaxCobrableMoney != null &&
                input.importeDisponibleCobro != null &&
                input.importeMaxCobrableMoney! <
                    Money.fromDouble(input.importeDisponibleCobro!);
        issues.add(
          RuteroFieldIssue(
            tab: RuteroDeliveryTab.payment,
            field: 'importe',
            message: isPartialCeiling
                ? 'En entrega parcial el cobro no puede superar lo '
                    'entregado (${maxCobro.toDouble().toStringAsFixed(2).replaceAll(
                          '.',
                          ',',
                        )} €).'
                : 'El importe no puede superar el saldo cobrable de este documento.',
          ),
        );
      }
    }
    final talonError = validateRuteroTalonFields(
      paymentMethod: input.paymentMethod,
      numeroTalon: input.numeroTalon,
      fechaVencimiento: input.fechaVencimientoTalon,
      nombreBanco: input.nombreBanco,
      codigoEntidad: input.codigoEntidadBancaria,
    );
    if (talonError != null) {
      issues.add(
        RuteroFieldIssue(
          tab: RuteroDeliveryTab.payment,
          field: 'pago',
          message: talonError,
        ),
      );
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
