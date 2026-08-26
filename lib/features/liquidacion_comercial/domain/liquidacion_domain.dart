/// Totals used to prepare a commercial settlement.
class ComercialLiquidacionSummary {
  /// Creates settlement totals, deriving [totalAIngresar] when omitted.
  const ComercialLiquidacionSummary({
    this.totalEfectivo = 0,
    this.totalCheques = 0,
    this.totalPostdatados = 0,
    this.saldoActual = 0,
    double? totalAIngresar,
  }) : totalAIngresar = totalAIngresar ??
            totalEfectivo + totalCheques + totalPostdatados + saldoActual;

  /// Cash collected during the settlement period.
  final double totalEfectivo;

  /// Cheques collected during the settlement period.
  final double totalCheques;

  /// Post-dated payments collected during the settlement period.
  final double totalPostdatados;

  /// Outstanding balance carried into the settlement.
  final double saldoActual;

  /// Total amount the commercial employee must deposit.
  final double totalAIngresar;
}

/// Editable values for one commercial settlement.
class ComercialLiquidacionDraft {
  /// Creates a draft for an employee and settlement date.
  const ComercialLiquidacionDraft({
    required this.employeeCode,
    required this.date,
    required this.expectedTotal,
    required this.ingresoBanco,
    required this.entregado,
  });

  /// Employee identifier owning the settlement.
  final String employeeCode;

  /// Business date covered by the settlement.
  final DateTime date;

  /// Amount expected from collections.
  final double expectedTotal;

  /// Amount deposited directly into the bank.
  final double ingresoBanco;

  /// Amount physically handed over.
  final double entregado;

  /// Sum of bank deposit and handed-over amount.
  double get registrado => ingresoBanco + entregado;

  /// Difference between expected and registered amounts.
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
  final amount = value == null ? null : parseAmount(value);
  if (amount == null) return 'Introduce un importe válido';
  if (amount > 999999.99) return 'Importe demasiado alto';
  return null;
}

/// Parses Spanish or international decimal amount text.
double? parseAmount(String value) {
  var normalized = value.trim().replaceAll(' ', '');
  if (normalized.isEmpty) return 0;

  final comma = normalized.lastIndexOf(',');
  final dot = normalized.lastIndexOf('.');
  if (comma != -1 && dot != -1) {
    if (comma > dot) {
      normalized = normalized.replaceAll('.', '').replaceAll(',', '.');
    } else {
      normalized = normalized.replaceAll(',', '');
    }
  } else {
    normalized = normalized.replaceAll(',', '.');
  }

  final amount = double.tryParse(normalized);
  if (amount == null || amount < 0) return null;
  return amount;
}
