import 'package:gmp_app_mobilidad/core/money/money.dart';

/// Totals used to prepare a commercial settlement.
///
/// Canonical money API is [Money]-based: the `...Money` getters and the
/// `fromMoney` factories. Domain math runs in integer cents.
///
/// The legacy `double` members stay as render/wire compat (JSON/API emit
/// identical `double` numbers; backend N/N-1 compat) and are deprecated.
/// Batch 2 renames call sites in
/// `presentation/pages/comercial_liquidacion_diaria_page.dart` and
/// `data/comercial_liquidacion_service.dart`, then removes the doubles.
class ComercialLiquidacionSummary {
  /// Creates settlement totals, deriving [totalAIngresar] when omitted.
  const ComercialLiquidacionSummary({
    @Deprecated('Usar totalEfectivoMoney') this.totalEfectivo = 0,
    @Deprecated('Usar totalChequesMoney') this.totalCheques = 0,
    @Deprecated('Usar totalPostdatadosMoney') this.totalPostdatados = 0,
    @Deprecated('Usar saldoActualMoney') this.saldoActual = 0,
    @Deprecated('Usar devolucionesYaCobradasMoney')
    this.devolucionesYaCobradas = 0,
    this.source = 'COBROS',
    this.porcentajeMinimoVendedor = 0,
    @Deprecated('Usar totalAIngresarMoney') double? totalAIngresar,
  }) : totalAIngresar =
            totalAIngresar ??
            totalEfectivo + totalCheques + totalPostdatados + saldoActual;

  /// Canonical constructor: exact cent math, no float drift.
  factory ComercialLiquidacionSummary.fromMoney({
    Money totalEfectivo = Money.zero,
    Money totalCheques = Money.zero,
    Money totalPostdatados = Money.zero,
    Money saldoActual = Money.zero,
    Money devolucionesYaCobradas = Money.zero,
    String source = 'COBROS',
    double porcentajeMinimoVendedor = 0,
    Money? totalAIngresar,
  }) {
    final total =
        totalAIngresar ??
        totalEfectivo + totalCheques + totalPostdatados + saldoActual;
    return ComercialLiquidacionSummary(
      // ignore: deprecated_member_use_from_same_package
      totalEfectivo: totalEfectivo.toDouble(),
      // ignore: deprecated_member_use_from_same_package
      totalCheques: totalCheques.toDouble(),
      // ignore: deprecated_member_use_from_same_package
      totalPostdatados: totalPostdatados.toDouble(),
      // ignore: deprecated_member_use_from_same_package
      saldoActual: saldoActual.toDouble(),
      // ignore: deprecated_member_use_from_same_package
      devolucionesYaCobradas: devolucionesYaCobradas.toDouble(),
      source: source,
      porcentajeMinimoVendedor: porcentajeMinimoVendedor,
      // ignore: deprecated_member_use_from_same_package
      totalAIngresar: total.toDouble(),
    );
  }

  /// Cash collected during the settlement period.
  @Deprecated('Usar totalEfectivoMoney. Solo render/compat.')
  final double totalEfectivo;

  /// Cheques collected during the settlement period.
  @Deprecated('Usar totalChequesMoney. Solo render/compat.')
  final double totalCheques;

  /// Post-dated payments collected during the settlement period.
  @Deprecated('Usar totalPostdatadosMoney. Solo render/compat.')
  final double totalPostdatados;

  /// Outstanding balance carried into the settlement.
  @Deprecated('Usar saldoActualMoney. Solo render/compat.')
  final double saldoActual;

  /// Absolute amount of merchandise returns. Shown apart; never subtracted
  /// from LQD.
  @Deprecated('Usar devolucionesYaCobradasMoney. Solo render/compat.')
  final double devolucionesYaCobradas;

  /// Source of deposit total: DSEDAC.LQD or app cobros.
  final String source;

  /// Vendor minimum collection percent from DSEDAC.VDDX.PORCENTAJEMINIMOCOBRO.
  /// Percentage, not money: stays `double`.
  final double porcentajeMinimoVendedor;

  /// Total amount the commercial employee must deposit.
  @Deprecated('Usar totalAIngresarMoney. Solo render/compat.')
  final double totalAIngresar;

  /// Canonical money views (exact; derived from cent-rounded values).
  Money get totalEfectivoMoney => Money.fromDouble(totalEfectivo);

  /// Canonical money views (exact; derived from cent-rounded values).
  Money get totalChequesMoney => Money.fromDouble(totalCheques);

  /// Canonical money views (exact; derived from cent-rounded values).
  Money get totalPostdatadosMoney => Money.fromDouble(totalPostdatados);

  /// Canonical money views (exact; derived from cent-rounded values).
  Money get saldoActualMoney => Money.fromDouble(saldoActual);

  /// Canonical money views (exact; derived from cent-rounded values).
  Money get devolucionesYaCobradasMoney =>
      Money.fromDouble(devolucionesYaCobradas);

  /// Canonical money views (exact; derived from cent-rounded values).
  Money get totalAIngresarMoney => Money.fromDouble(totalAIngresar);
}

/// One merchandise return that affects commercial settlement.
class ComercialDevolucionItem {
  /// Creates a return document visible in daily settlement.
  const ComercialDevolucionItem({
    required this.documento,
    required this.cliente,
    @Deprecated('Usar amountMoney') required this.amount,
    this.date,
    this.vendedor = '',
    this.yaCobrada = false,
    this.formaPago,
    this.impactoLqd,
    this.albaranOrigen,
    this.vencimiento,
    this.formaPagoDias,
    this.pendienteTecnicoMovimiento = false,
  });

  /// Canonical constructor: exact cent math, no float drift.
  factory ComercialDevolucionItem.fromMoney({
    required String documento,
    required String cliente,
    required Money amount,
    String? date,
    String vendedor = '',
    bool yaCobrada = false,
    String? formaPago,
    String? impactoLqd,
    String? albaranOrigen,
    String? vencimiento,
    int? formaPagoDias,
    bool pendienteTecnicoMovimiento = false,
  }) {
    return ComercialDevolucionItem(
      documento: documento,
      cliente: cliente,
      // ignore: deprecated_member_use_from_same_package
      amount: amount.toDouble(),
      date: date,
      vendedor: vendedor,
      yaCobrada: yaCobrada,
      formaPago: formaPago,
      impactoLqd: impactoLqd,
      albaranOrigen: albaranOrigen,
      vencimiento: vencimiento,
      formaPagoDias: formaPagoDias,
      pendienteTecnicoMovimiento: pendienteTecnicoMovimiento,
    );
  }

  /// Document key, typically series-number.
  final String documento;

  /// Client code owning the return.
  final String cliente;

  /// Signed LACLAE amount; cash impact uses the absolute value.
  @Deprecated('Usar amountMoney. Solo render/compat.')
  final double amount;

  /// Canonical money view (exact; derived from cent-rounded value).
  Money get amountMoney => Money.fromDouble(amount);

  /// Business date of the return document.
  final String? date;

  /// Vendor who sold the original document.
  final String vendedor;

  /// True when CVC marks the return as already collected (PG / pendiente 0).
  final bool yaCobrada;

  /// Payment form of the original document, typically PG / P1.
  final String? formaPago;

  /// LQD cash bucket impacted. `YA_COBRADOS` matches the whiteboard flow.
  final String? impactoLqd;

  /// Linked delivery note from CAC, e.g. P-2-1.
  final String? albaranOrigen;

  /// Due date of the collected pagaré.
  final String? vencimiento;

  /// Real FPG.PRIMERPAGO days painted as "N D F.Factura".
  final int? formaPagoDias;

  /// TEST overlay is pending ERP technical movement (LAC/CVC/LQD not written).
  final bool pendienteTecnicoMovimiento;
}

/// Editable values for one commercial settlement.
///
/// Same dual-surface contract as [ComercialLiquidacionSummary]: legacy
/// `double` members are deprecated compat; `...Money` getters and
/// [ComercialLiquidacionDraft.fromMoney] are canonical.
class ComercialLiquidacionDraft {
  /// Creates a draft for an employee and settlement date.
  const ComercialLiquidacionDraft({
    required this.employeeCode,
    required this.date,
    @Deprecated('Usar expectedTotalMoney') required this.expectedTotal,
    @Deprecated('Usar ingresoBancoMoney') required this.ingresoBanco,
    @Deprecated('Usar entregadoMoney') required this.entregado,
  });

  /// Canonical constructor: exact cent math, no float drift.
  factory ComercialLiquidacionDraft.fromMoney({
    required String employeeCode,
    required DateTime date,
    required Money expectedTotal,
    required Money ingresoBanco,
    required Money entregado,
  }) {
    return ComercialLiquidacionDraft(
      employeeCode: employeeCode,
      date: date,
      // ignore: deprecated_member_use_from_same_package
      expectedTotal: expectedTotal.toDouble(),
      // ignore: deprecated_member_use_from_same_package
      ingresoBanco: ingresoBanco.toDouble(),
      // ignore: deprecated_member_use_from_same_package
      entregado: entregado.toDouble(),
    );
  }

  /// Employee identifier owning the settlement.
  final String employeeCode;

  /// Business date covered by the settlement.
  final DateTime date;

  /// Amount expected from collections.
  @Deprecated('Usar expectedTotalMoney. Solo render/compat.')
  final double expectedTotal;

  /// Amount deposited directly into the bank.
  @Deprecated('Usar ingresoBancoMoney. Solo render/compat.')
  final double ingresoBanco;

  /// Amount physically handed over.
  @Deprecated('Usar entregadoMoney. Solo render/compat.')
  final double entregado;

  /// Canonical money views (exact; derived from cent-rounded values).
  Money get expectedTotalMoney => Money.fromDouble(expectedTotal);

  /// Canonical money views (exact; derived from cent-rounded values).
  Money get ingresoBancoMoney => Money.fromDouble(ingresoBanco);

  /// Canonical money views (exact; derived from cent-rounded values).
  Money get entregadoMoney => Money.fromDouble(entregado);

  /// Sum of bank deposit and handed-over amount, exact in cents.
  Money get registradoMoney => ingresoBancoMoney + entregadoMoney;

  /// Difference between expected and registered amounts, exact in cents.
  Money get diferenciaMoney => expectedTotalMoney - registradoMoney;

  /// Whether the cent-exact difference is strictly below one cent.
  bool get isBalancedExact => diferenciaMoney.cents.abs() < 1;

  /// Sum of bank deposit and handed-over amount.
  @Deprecated('Usar registradoMoney. Solo render/compat.')
  double get registrado => ingresoBanco + entregado;

  /// Difference between expected and registered amounts.
  @Deprecated('Usar diferenciaMoney. Solo render/compat.')
  double get diferencia => expectedTotal - registrado;

  /// Whether difference is strictly below one cent.
  bool get isBalanced => diferencia.abs() + 1e-9 < 0.01;
}

/// Validation state of a commercial settlement.
enum LiquidacionStatusKind {
  /// No amount has been entered yet.
  pending,

  /// Entered amounts match expected total within tolerance.
  balanced,

  /// Entered amounts do not match expected total.
  mismatch,

  /// At least one entered amount is invalid.
  invalid,
}

/// Classifies [draft] from input presence and amount validity.
LiquidacionStatusKind classifyLiquidacionStatus(
  ComercialLiquidacionDraft draft, {
  required bool hasInput,
  required bool amountsAreValid,
}) {
  if (!amountsAreValid) return LiquidacionStatusKind.invalid;
  if (!hasInput) return LiquidacionStatusKind.pending;
  if (draft.isBalanced) return LiquidacionStatusKind.balanced;
  return LiquidacionStatusKind.mismatch;
}

/// Returns a user-facing validation error for an amount.
String? validateAmount(String? value) {
  final amount = value == null ? null : parseMoney(value);
  if (amount == null) return 'Introduce un importe válido';
  if (amount > Money.fromDouble(999999.99)) {
    return 'Importe demasiado alto';
  }
  return null;
}

/// Canonical amount parser: Spanish or international decimal text.
/// Empty input maps to [Money.zero] (legacy UX parity); invalid or negative
/// input returns `null`.
Money? parseMoney(String value) {
  final normalized = value.trim();
  if (normalized.isEmpty) return Money.zero;
  final parsed = Money.tryParse(normalized);
  if (parsed == null || parsed.isNegative) return null;
  return parsed;
}

/// Parses Spanish or international decimal amount text.
///
/// Legacy `double` compat (used by presentation outside this cage).
/// New code must use [parseMoney]; the `double` comeback is render-only.
@Deprecated('Usar parseMoney. El double es solo render.')
double? parseAmount(String value) => parseMoney(value)?.toDouble();
