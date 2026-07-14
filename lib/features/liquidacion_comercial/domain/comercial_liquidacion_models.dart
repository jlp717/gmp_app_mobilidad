// ignore_for_file: public_member_api_docs

import 'package:gmp_app_mobilidad/core/models/minimum_cobro_obligation.dart';

export 'package:gmp_app_mobilidad/core/models/minimum_cobro_obligation.dart';

typedef JsonMap = Map<String, dynamic>;

double _doubleValue(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

int _intValue(dynamic value, {int fallback = 0}) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

List<String> _stringList(dynamic value) {
  if (value is! List) return const [];
  return [for (final item in value) item.toString()];
}

class RegisteredCobrosSummary {
  const RegisteredCobrosSummary({this.registeredCents = 0});

  factory RegisteredCobrosSummary.fromJson(JsonMap json) {
    return RegisteredCobrosSummary(
      registeredCents: _intValue(json['registeredCents']),
    );
  }

  final int registeredCents;
}

class ComercialLiquidacionCloseability {
  const ComercialLiquidacionCloseability({
    this.canClose = true,
    this.reasons = const [],
  });

  factory ComercialLiquidacionCloseability.fromJson(JsonMap json) {
    return ComercialLiquidacionCloseability(
      canClose: json['canClose'] != false,
      reasons: _stringList(json['reasons']),
    );
  }

  final bool canClose;
  final List<String> reasons;
}

class ComercialLiquidacionSummary {
  const ComercialLiquidacionSummary({
    this.totalEfectivo = 0,
    this.totalCheques = 0,
    this.totalPostdatados = 0,
    this.saldoActual = 0,
    this.totalTarjeta = 0,
    this.totalCobrosDia = 0,
    this.liquidacionNumero = 0,
    this.ingresoBanco = 0,
    this.registeredCobros = const RegisteredCobrosSummary(),
    this.obligation = const MinimumCobroObligation(),
    this.closeability = const ComercialLiquidacionCloseability(),
    double? totalAIngresar,
  }) : totalAIngresar = totalAIngresar ??
            totalEfectivo + totalCheques + totalPostdatados + saldoActual;

  final double totalEfectivo;
  final double totalCheques;
  final double totalPostdatados;
  final double saldoActual;
  final double totalTarjeta;
  final double totalCobrosDia;
  final int liquidacionNumero;
  final double ingresoBanco;
  final double totalAIngresar;
  final RegisteredCobrosSummary registeredCobros;
  final MinimumCobroObligation obligation;
  final ComercialLiquidacionCloseability closeability;

  double get deltaFromBanco => totalAIngresar - ingresoBanco;

  bool get hasData =>
      liquidacionNumero > 0 ||
      totalEfectivo != 0 ||
      totalAIngresar != 0 ||
      totalCobrosDia != 0;

  bool get isPopulated => hasData;

  factory ComercialLiquidacionSummary.fromJson(JsonMap json) {
    final totalEfectivo = _doubleValue(json['totalEfectivo']);
    final totalCheques = _doubleValue(json['totalCheques']);
    final totalPostdatados = _doubleValue(json['totalPostdatados']);
    final saldoActual = _doubleValue(json['saldoActual']);
    final totalAIngresarRaw = json['totalAIngresar'];
    return ComercialLiquidacionSummary(
      totalEfectivo: totalEfectivo,
      totalCheques: totalCheques,
      totalPostdatados: totalPostdatados,
      saldoActual: saldoActual,
      totalTarjeta: _doubleValue(json['totalTarjeta']),
      totalCobrosDia: _doubleValue(json['totalCobrosDia']),
      liquidacionNumero: _intValue(json['liquidacionNumero']),
      ingresoBanco: _doubleValue(json['ingresoBanco']),
      registeredCobros: json['registeredCobros'] is Map
          ? RegisteredCobrosSummary.fromJson(
              Map<String, dynamic>.from(json['registeredCobros'] as Map),
            )
          : const RegisteredCobrosSummary(),
      obligation: json['obligation'] is Map
          ? MinimumCobroObligation.fromJson(
              Map<String, dynamic>.from(json['obligation'] as Map),
            )
          : const MinimumCobroObligation(),
      closeability: json['closeability'] is Map
          ? ComercialLiquidacionCloseability.fromJson(
              Map<String, dynamic>.from(json['closeability'] as Map),
            )
          : const ComercialLiquidacionCloseability(),
      totalAIngresar:
          totalAIngresarRaw == null ? null : _doubleValue(totalAIngresarRaw),
    );
  }
}

class ComercialLiquidacionDraft {
  const ComercialLiquidacionDraft({
    required this.employeeCode,
    required this.date,
    required this.expectedTotal,
    required this.ingresoBanco,
    required this.entregado,
    this.summary,
  });

  final String employeeCode;
  final DateTime date;
  final double expectedTotal;
  final double ingresoBanco;
  final double entregado;
  final ComercialLiquidacionSummary? summary;

  double get registrado => ingresoBanco + entregado;
  double get diferencia => expectedTotal - registrado;
  bool get isBalanced => diferencia.abs() < 0.01;
}

class ComercialLiquidacionDailyResult {
  const ComercialLiquidacionDailyResult({
    required this.vendorCode,
    required this.date,
    required this.summary,
    this.vendorEmail,
  });

  factory ComercialLiquidacionDailyResult.fromJson(JsonMap json) {
    final summaryJson = json['summary'];
    final summary = summaryJson is Map
        ? ComercialLiquidacionSummary.fromJson(
            Map<String, dynamic>.from(summaryJson),
          )
        : ComercialLiquidacionSummary.fromJson(json);
    return ComercialLiquidacionDailyResult(
      vendorCode: (json['vendorCode'] ?? json['vendedorId'])?.toString() ?? '',
      date: json['date']?.toString() ?? '',
      vendorEmail: json['vendorEmail']?.toString(),
      summary: summary,
    );
  }

  final String vendorCode;
  final String date;
  final ComercialLiquidacionSummary summary;
  final String? vendorEmail;
}

class ComercialLiquidacionCloseResult {
  const ComercialLiquidacionCloseResult({
    required this.created,
    this.emailWarnings = const [],
  });

  factory ComercialLiquidacionCloseResult.fromJson(JsonMap json) {
    final warnings = json['emailWarnings'];
    return ComercialLiquidacionCloseResult(
      created: json['created'] == true,
      emailWarnings: warnings is List
          ? [
              for (final item in warnings)
                if (item is Map) Map<String, dynamic>.from(item),
            ]
          : const [],
    );
  }

  final bool created;
  final List<JsonMap> emailWarnings;
}
