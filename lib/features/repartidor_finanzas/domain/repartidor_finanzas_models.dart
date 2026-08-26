// ignore_for_file: public_member_api_docs

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

typedef JsonMap = Map<String, dynamic>;

String buildLiquidacionIdempotencyToken(
  String repartidorId,
  DateTime businessDate,
) {
  final normalizedId = repartidorId.trim();
  if (normalizedId.isEmpty) {
    throw ArgumentError.value(
      repartidorId,
      'repartidorId',
      'No puede estar vacio',
    );
  }
  final month = businessDate.month.toString().padLeft(2, '0');
  final day = businessDate.day.toString().padLeft(2, '0');
  return 'liq_${normalizedId}_${businessDate.year}$month$day';
}

/// Generates an opaque token for one structured-entry intent.
///
/// There is deliberately no local durable draft store for financial entries.
/// A token stays stable for the lifetime of the active form/retry only; after
/// an app restart the client must reload the server ledger before submitting a
/// new intent instead of replaying an unknown write.
String createLiquidacionEntryIdempotencyToken(
  String repartidorId,
  DateTime businessDate,
  String entryType, {
  required double amount,
  required String detail,
  String? observation,
  List<int>? entropy,
}) {
  final safeId = repartidorId.trim().replaceAll(RegExp('[^A-Za-z0-9_-]'), '_');
  final safeType =
      entryType.trim().toLowerCase().replaceAll(RegExp('[^a-z0-9_-]'), '_');
  final normalizedDetail = detail.trim();
  final normalizedObservation = observation?.trim() ?? '';
  if (safeId.isEmpty || safeType.isEmpty || normalizedDetail.isEmpty) {
    throw ArgumentError('Repartidor, tipo y detalle son obligatorios');
  }
  final bytes =
      entropy ?? List<int>.generate(16, (_) => Random.secure().nextInt(256));
  if (bytes.length != 16 || bytes.any((byte) => byte < 0 || byte > 255)) {
    throw ArgumentError.value(entropy, 'entropy', 'Debe contener 16 bytes');
  }
  final date =
      '${businessDate.year}${businessDate.month.toString().padLeft(2, '0')}${businessDate.day.toString().padLeft(2, '0')}';
  final random =
      bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  final fingerprint = buildLiquidacionEntryFingerprint(
    safeId,
    businessDate,
    safeType,
    amount: amount,
    detail: normalizedDetail,
    observation: normalizedObservation,
  );
  return 'le_${safeId}_${date}_${safeType}_${fingerprint}_$random';
}

String buildLiquidacionEntryFingerprint(
  String repartidorId,
  DateTime businessDate,
  String entryType, {
  required double amount,
  required String detail,
  String? observation,
}) {
  final date =
      '${businessDate.year}${businessDate.month.toString().padLeft(2, '0')}${businessDate.day.toString().padLeft(2, '0')}';
  final canonical = jsonEncode(<Object?>[
    repartidorId.trim(),
    date,
    entryType.trim().toLowerCase(),
    amount.toStringAsFixed(2),
    detail.trim(),
    observation?.trim() ?? '',
  ]);
  return sha256.convert(utf8.encode(canonical)).toString().substring(0, 24);
}

String createVencimientoCobroIdempotencyToken(
  String repartidorId,
  String documento, {
  List<int>? entropy,
}) {
  String safePart(String value) => value
      .trim()
      .replaceAll(RegExp('[^A-Za-z0-9_-]'), '_')
      .replaceAll(RegExp('_+'), '_');

  final rep = safePart(repartidorId);
  final document = safePart(documento);
  if (rep.isEmpty || document.isEmpty) {
    throw ArgumentError('Repartidor y documento son obligatorios');
  }
  final random = Random.secure();
  final bytes = entropy ?? List<int>.generate(16, (_) => random.nextInt(256));
  if (bytes.length != 16 || bytes.any((byte) => byte < 0 || byte > 255)) {
    throw ArgumentError.value(entropy, 'entropy', 'Debe contener 16 bytes');
  }
  final intentId =
      bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  final prefix = 'vto_${rep}_';
  final suffix = '_$intentId';
  final maxDocumentLength =
      (128 - prefix.length - suffix.length).clamp(1, document.length);
  return '$prefix${document.substring(0, maxDocumentLength)}$suffix';
}

enum VencimientoCobroSubmissionState {
  confirmed,
  queued,
  alreadyPending,
  inFlight,
  manualReview,
}

class VencimientoCobroSubmissionResult {
  const VencimientoCobroSubmissionResult({
    required this.state,
    required this.idempotencyToken,
    this.syncId,
  });

  final VencimientoCobroSubmissionState state;
  final String idempotencyToken;
  final String? syncId;

  bool get isConfirmed => state == VencimientoCobroSubmissionState.confirmed;
  bool get requiresManualReview =>
      state == VencimientoCobroSubmissionState.manualReview;
}

class PendingVencimientoCobroIntent {
  const PendingVencimientoCobroIntent({
    required this.idempotencyToken,
    required this.syncId,
    required this.requiresManualReview,
  });

  final String idempotencyToken;
  final String syncId;
  final bool requiresManualReview;
}

class RepartidorMonthlyLiquidacion {
  const RepartidorMonthlyLiquidacion({
    required this.idempotencyToken,
    required this.date,
    required this.totalLiquidado,
  });

  factory RepartidorMonthlyLiquidacion.fromJson(JsonMap json) {
    return RepartidorMonthlyLiquidacion(
      idempotencyToken: _stringValue(json, const ['idempotencyToken']),
      date: _stringValue(json, const ['date']),
      totalLiquidado: _doubleValue(json['totalLiquidado']),
    );
  }

  final String idempotencyToken;
  final String date;
  final double totalLiquidado;
}

class RepartidorMonthlySummary {
  RepartidorMonthlySummary({
    required this.repartidorId,
    required this.period,
    required this.totalCobrado,
    required this.totalLiquidado,
    required this.saldoPendiente,
    required this.cobrosCount,
    required this.liquidacionesCount,
    List<RepartidorMonthlyLiquidacion> liquidaciones = const [],
  }) : liquidaciones = List.unmodifiable(liquidaciones);

  factory RepartidorMonthlySummary.fromJson(JsonMap json) {
    final summary = _jsonMap(json['summary']);
    final liquidaciones = _jsonMapList(json['liquidaciones'])
        .map(RepartidorMonthlyLiquidacion.fromJson)
        .toList();
    return RepartidorMonthlySummary(
      repartidorId: _stringValue(json, const ['repartidorId']),
      period: RepartidorFinancialPeriod.fromJson(_jsonMap(json['period'])),
      totalCobrado: _doubleValue(summary['totalCobrado']),
      totalLiquidado: _doubleValue(summary['totalLiquidado']),
      saldoPendiente: _doubleValue(summary['saldoPendiente']),
      cobrosCount: _intValue(summary['cobrosCount']),
      liquidacionesCount: _intValue(
        summary['liquidacionesCount'],
        fallback: liquidaciones.length,
      ),
      liquidaciones: liquidaciones,
    );
  }

  final String repartidorId;
  final RepartidorFinancialPeriod period;
  final double totalCobrado;
  final double totalLiquidado;
  final double saldoPendiente;
  final int cobrosCount;
  final int liquidacionesCount;
  final List<RepartidorMonthlyLiquidacion> liquidaciones;

  bool get isEmpty =>
      totalCobrado == 0 &&
      totalLiquidado == 0 &&
      saldoPendiente == 0 &&
      liquidaciones.isEmpty;
}

String _stringValue(
  JsonMap json,
  List<String> keys, {
  String fallback = '',
}) {
  for (final key in keys) {
    final value = json[key];
    if (value != null) return value.toString();
  }
  return fallback;
}

int _intValue(dynamic value, {int fallback = 0}) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

double _doubleValue(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

bool _boolValue(dynamic value) {
  if (value is bool) return value;
  final normalized = value?.toString().toLowerCase();
  return normalized == 'true' || normalized == '1' || normalized == 'yes';
}

JsonMap _jsonMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

List<JsonMap> _jsonMapList(dynamic value) {
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is Map) Map<String, dynamic>.from(item),
  ];
}

class RepartidorFinancialPeriod {
  const RepartidorFinancialPeriod({
    required this.year,
    required this.month,
  });

  factory RepartidorFinancialPeriod.current() {
    final now = DateTime.now();
    return RepartidorFinancialPeriod(year: now.year, month: now.month);
  }

  factory RepartidorFinancialPeriod.fromJson(JsonMap json) {
    final now = DateTime.now();
    return RepartidorFinancialPeriod(
      year: _intValue(json['year'], fallback: now.year),
      month: _intValue(json['month'], fallback: now.month),
    );
  }

  final int year;
  final int month;

  JsonMap toJson() => {
        'year': year,
        'month': month,
      };
}

class ClientCollectionSnapshot {
  const ClientCollectionSnapshot({
    required this.clientId,
    required this.clientName,
    required this.collectable,
    required this.collected,
    required this.percentage,
    required this.thresholdMet,
    required this.thresholdProgress,
    required this.commission,
    required this.tier,
    required this.paymentType,
    required this.numDocuments,
  });

  factory ClientCollectionSnapshot.fromJson(JsonMap json) {
    final clientId = _stringValue(json, const ['clientId', 'codigoCliente']);
    return ClientCollectionSnapshot(
      clientId: clientId,
      clientName: _stringValue(
        json,
        const ['clientName', 'nombreCliente'],
        fallback: clientId,
      ),
      collectable: _doubleValue(json['collectable']),
      collected: _doubleValue(json['collected']),
      percentage: _doubleValue(json['percentage']),
      thresholdMet: _boolValue(json['thresholdMet']),
      thresholdProgress: _doubleValue(json['thresholdProgress']),
      commission: _doubleValue(json['commission']),
      tier: _intValue(json['tier']),
      paymentType: _stringValue(
        json,
        const ['paymentType', 'formaPagoDesc', 'formaPago'],
        fallback: 'Otro',
      ),
      numDocuments: _intValue(json['numDocuments']),
    );
  }

  final String clientId;
  final String clientName;
  final double collectable;
  final double collected;
  final double percentage;
  final bool thresholdMet;
  final double thresholdProgress;
  final double commission;
  final int tier;
  final String paymentType;
  final int numDocuments;

  JsonMap toJson() => {
        'clientId': clientId,
        'clientName': clientName,
        'collectable': collectable,
        'collected': collected,
        'percentage': percentage,
        'thresholdMet': thresholdMet,
        'thresholdProgress': thresholdProgress,
        'commission': commission,
        'tier': tier,
        'paymentType': paymentType,
        'numDocuments': numDocuments,
      };
}

class RepartidorCollectionSummary {
  RepartidorCollectionSummary({
    required this.repartidorId,
    required this.period,
    required this.totalCollectable,
    required this.totalCollected,
    required this.totalCommission,
    required this.overallPercentage,
    required this.thresholdMet,
    required this.clientCount,
    List<ClientCollectionSnapshot> clients = const [],
  }) : clients = List.unmodifiable(clients);

  factory RepartidorCollectionSummary.fromJson(JsonMap json) {
    final summary = _jsonMap(json['summary']);
    return RepartidorCollectionSummary(
      repartidorId: _stringValue(json, const ['repartidorId', 'repartidor']),
      period: RepartidorFinancialPeriod.fromJson(_jsonMap(json['period'])),
      totalCollectable: _doubleValue(summary['totalCollectable']),
      totalCollected: _doubleValue(summary['totalCollected']),
      totalCommission: _doubleValue(summary['totalCommission']),
      overallPercentage: _doubleValue(summary['overallPercentage']),
      thresholdMet: _boolValue(summary['thresholdMet']),
      clientCount: _intValue(summary['clientCount']),
      clients: _jsonMapList(json['clients'])
          .map(ClientCollectionSnapshot.fromJson)
          .toList(),
    );
  }

  factory RepartidorCollectionSummary.empty({
    required String repartidorId,
    required int year,
    required int month,
  }) {
    return RepartidorCollectionSummary(
      repartidorId: repartidorId,
      period: RepartidorFinancialPeriod(year: year, month: month),
      totalCollectable: 0,
      totalCollected: 0,
      totalCommission: 0,
      overallPercentage: 0,
      thresholdMet: false,
      clientCount: 0,
    );
  }

  final String repartidorId;
  final RepartidorFinancialPeriod period;
  final double totalCollectable;
  final double totalCollected;
  final double totalCommission;
  final double overallPercentage;
  final bool thresholdMet;
  final int clientCount;
  final List<ClientCollectionSnapshot> clients;

  JsonMap toJson() => {
        'repartidorId': repartidorId,
        'period': period.toJson(),
        'summary': {
          'totalCollectable': totalCollectable,
          'totalCollected': totalCollected,
          'totalCommission': totalCommission,
          'overallPercentage': overallPercentage,
          'thresholdMet': thresholdMet,
          'clientCount': clientCount,
        },
        'clients': clients.map((client) => client.toJson()).toList(),
      };
}

class DailyCollectionSnapshot {
  const DailyCollectionSnapshot({
    required this.day,
    required this.date,
    required this.collectable,
    required this.collected,
  });

  factory DailyCollectionSnapshot.fromJson(JsonMap json) {
    return DailyCollectionSnapshot(
      day: _intValue(json['day']),
      date: _stringValue(json, const ['date', 'fecha']),
      collectable: _doubleValue(json['collectable']),
      collected: _doubleValue(json['collected']),
    );
  }

  final int day;
  final String date;
  final double collectable;
  final double collected;

  JsonMap toJson() => {
        'day': day,
        'date': date,
        'collectable': collectable,
        'collected': collected,
      };
}

class RepartidorHistoryClient {
  const RepartidorHistoryClient({
    required this.id,
    required this.name,
    required this.address,
    required this.totalDocuments,
    required this.totalAmount,
    this.lastVisit,
    this.repCode,
    this.repName,
  });

  factory RepartidorHistoryClient.fromJson(JsonMap json) {
    final id = _stringValue(json, const ['id', 'clientId', 'codigoCliente']);
    return RepartidorHistoryClient(
      id: id,
      name: _stringValue(json, const ['name', 'clientName'], fallback: id),
      address: _stringValue(json, const ['address', 'direccion']),
      totalDocuments: _intValue(json['totalDocuments']),
      totalAmount: _doubleValue(json['totalAmount']),
      lastVisit: json['lastVisit']?.toString(),
      repCode: json['repCode']?.toString(),
      repName: json['repName']?.toString(),
    );
  }

  final String id;
  final String name;
  final String address;
  final int totalDocuments;
  final double totalAmount;
  final String? lastVisit;
  final String? repCode;
  final String? repName;

  JsonMap toJson() => {
        'id': id,
        'name': name,
        'address': address,
        'totalDocuments': totalDocuments,
        'totalAmount': totalAmount,
        'lastVisit': lastVisit,
        'repCode': repCode,
        'repName': repName,
      };
}

class RepartidorHistoryDocument {
  const RepartidorHistoryDocument({
    required this.id,
    required this.type,
    required this.number,
    required this.date,
    required this.amount,
    required this.pending,
    required this.status,
    required this.hasSignature,
    this.albaranNumber,
    this.facturaNumber,
    this.serieFactura,
    this.ejercicioFactura,
    this.serie = 'A',
    this.ejercicio = 0,
    this.terminal = 0,
    this.signaturePath,
    this.deliveryDate,
    this.deliveryRepartidor,
    this.deliveryObs,
    this.time,
    this.legacySignatureName,
    this.hasLegacySignature = false,
    this.legacyDate,
  });

  factory RepartidorHistoryDocument.fromJson(JsonMap json) {
    return RepartidorHistoryDocument(
      id: _stringValue(json, const ['id']),
      type: _stringValue(json, const ['type'], fallback: 'albaran'),
      number: _intValue(json['number']),
      albaranNumber: json['albaranNumber'] == null
          ? null
          : _intValue(json['albaranNumber']),
      facturaNumber: json['facturaNumber'] == null
          ? null
          : _intValue(json['facturaNumber']),
      serieFactura: json['serieFactura']?.toString(),
      ejercicioFactura: json['ejercicioFactura'] == null
          ? null
          : _intValue(json['ejercicioFactura']),
      serie: _stringValue(json, const ['serie'], fallback: 'A'),
      ejercicio: _intValue(json['ejercicio']),
      terminal: _intValue(json['terminal']),
      date: _stringValue(json, const ['date', 'fecha']),
      amount: _doubleValue(json['amount']),
      pending: _doubleValue(json['pending']),
      status: _stringValue(json, const ['status'], fallback: 'notDelivered'),
      hasSignature: _boolValue(json['hasSignature']),
      signaturePath: json['signaturePath']?.toString(),
      deliveryDate: json['deliveryDate']?.toString(),
      deliveryRepartidor: json['deliveryRepartidor']?.toString(),
      deliveryObs: json['deliveryObs']?.toString(),
      time: json['time']?.toString(),
      legacySignatureName: json['legacySignatureName']?.toString(),
      hasLegacySignature: _boolValue(json['hasLegacySignature']),
      legacyDate: json['legacyDate']?.toString(),
    );
  }

  final String id;
  final String type;
  final int number;
  final int? albaranNumber;
  final int? facturaNumber;
  final String? serieFactura;
  final int? ejercicioFactura;
  final String serie;
  final int ejercicio;
  final int terminal;
  final String date;
  final double amount;
  final double pending;
  final String status;
  final bool hasSignature;
  final String? signaturePath;
  final String? deliveryDate;
  final String? deliveryRepartidor;
  final String? deliveryObs;
  final String? time;
  final String? legacySignatureName;
  final bool hasLegacySignature;
  final String? legacyDate;

  JsonMap toJson() => {
        'id': id,
        'type': type,
        'number': number,
        'albaranNumber': albaranNumber,
        'facturaNumber': facturaNumber,
        'serieFactura': serieFactura,
        'ejercicioFactura': ejercicioFactura,
        'serie': serie,
        'ejercicio': ejercicio,
        'terminal': terminal,
        'date': date,
        'amount': amount,
        'pending': pending,
        'status': status,
        'hasSignature': hasSignature,
        'signaturePath': signaturePath,
        'deliveryDate': deliveryDate,
        'deliveryRepartidor': deliveryRepartidor,
        'deliveryObs': deliveryObs,
        'time': time,
        'legacySignatureName': legacySignatureName,
        'hasLegacySignature': hasLegacySignature,
        'legacyDate': legacyDate,
      };
}

class RepartidorMonthlyObjective {
  const RepartidorMonthlyObjective({
    required this.month,
    required this.year,
    required this.monthNum,
    required this.collectable,
    required this.collected,
    required this.percentage,
    required this.thresholdMet,
  });

  factory RepartidorMonthlyObjective.fromJson(JsonMap json) {
    return RepartidorMonthlyObjective(
      month: _stringValue(json, const ['month']),
      year: _intValue(json['year'], fallback: DateTime.now().year),
      monthNum: _intValue(json['monthNum'], fallback: 1),
      collectable: _doubleValue(json['collectable']),
      collected: _doubleValue(json['collected']),
      percentage: _doubleValue(json['percentage']),
      thresholdMet: _boolValue(json['thresholdMet']),
    );
  }

  final String month;
  final int year;
  final int monthNum;
  final double collectable;
  final double collected;
  final double percentage;
  final bool thresholdMet;

  JsonMap toJson() => {
        'month': month,
        'year': year,
        'monthNum': monthNum,
        'collectable': collectable,
        'collected': collected,
        'percentage': percentage,
        'thresholdMet': thresholdMet,
      };
}

class RepartidorObjectiveBreakdownNode {
  RepartidorObjectiveBreakdownNode({
    required this.id,
    required this.name,
    required this.level,
    required this.sales,
    required this.objective,
    required this.percentage,
    List<RepartidorObjectiveBreakdownNode> children = const [],
  }) : children = List.unmodifiable(children);

  factory RepartidorObjectiveBreakdownNode.fromJson(JsonMap json) {
    return RepartidorObjectiveBreakdownNode(
      id: _stringValue(json, const ['id', 'codigo', 'code']),
      name: _stringValue(json, const ['name', 'nombre', 'descripcion']),
      level: _stringValue(json, const ['level', 'nivel']),
      sales: _doubleValue(json['sales'] ?? json['ventas']),
      objective: _doubleValue(json['objective'] ?? json['objetivo']),
      percentage: _doubleValue(json['percentage'] ?? json['porcentaje']),
      children: _jsonMapList(json['children'] ?? json['items'])
          .map(RepartidorObjectiveBreakdownNode.fromJson)
          .toList(),
    );
  }

  final String id;
  final String name;
  final String level;
  final double sales;
  final double objective;
  final double percentage;
  final List<RepartidorObjectiveBreakdownNode> children;

  JsonMap toJson() => {
        'id': id,
        'name': name,
        'level': level,
        'sales': sales,
        'objective': objective,
        'percentage': percentage,
        'children': children.map((child) => child.toJson()).toList(),
      };
}

class RepartidorObjectiveTotals {
  const RepartidorObjectiveTotals({
    required this.sales,
    required this.cost,
    required this.units,
    required this.margin,
  });

  factory RepartidorObjectiveTotals.fromJson(JsonMap json) =>
      RepartidorObjectiveTotals(
        sales: _requiredFiniteNumber(json, 'sales').toDouble(),
        cost: _requiredFiniteNumber(json, 'cost').toDouble(),
        units: _requiredFiniteNumber(json, 'units').toDouble(),
        margin: _requiredFiniteNumber(json, 'margin').toDouble(),
      );

  factory RepartidorObjectiveTotals.fromClients(
    Iterable<RepartidorObjectiveClient> clients,
  ) {
    var sales = 0.0;
    var cost = 0.0;
    var units = 0.0;
    for (final client in clients) {
      sales += client.totalSales;
      cost += client.totalCost;
      units += client.totalUnits;
    }
    return RepartidorObjectiveTotals(
      sales: sales,
      cost: cost,
      units: units,
      margin: sales == 0 ? 0 : (sales - cost) / sales * 100,
    );
  }

  final double sales;
  final double cost;
  final double units;
  final double margin;

  JsonMap toJson() => {
        'sales': sales,
        'cost': cost,
        'units': units,
        'margin': margin,
      };
}

class RepartidorObjectiveProduct {
  RepartidorObjectiveProduct({
    required this.code,
    required this.name,
    required this.unitType,
    required this.totalSales,
    required this.totalCost,
    required this.totalUnits,
    Map<int, double> monthlyData = const {},
  }) : monthlyData = Map.unmodifiable(monthlyData);

  factory RepartidorObjectiveProduct.fromJson(JsonMap json) {
    final rawMonthlyData = json['monthlyData'];
    if (rawMonthlyData is! Map) {
      throw const FormatException('Datos mensuales de producto invalidos');
    }
    final monthlyData = <int, double>{};
    for (final entry in rawMonthlyData.entries) {
      final month = int.tryParse(entry.key.toString());
      final rawValue = entry.value;
      final value = rawValue is num
          ? rawValue.toDouble()
          : double.tryParse(rawValue?.toString() ?? '');
      if (month == null ||
          month < 1 ||
          month > 12 ||
          value == null ||
          !value.isFinite) {
        throw const FormatException('Datos mensuales de producto invalidos');
      }
      monthlyData[month] = value;
    }
    return RepartidorObjectiveProduct(
      code: _stringValue(json, const ['code']),
      name: _stringValue(json, const ['name']),
      unitType: _stringValue(json, const ['unitType']),
      totalSales: _requiredFiniteNumber(json, 'totalSales').toDouble(),
      totalCost: _requiredFiniteNumber(json, 'totalCost').toDouble(),
      totalUnits: _requiredFiniteNumber(json, 'totalUnits').toDouble(),
      monthlyData: monthlyData,
    );
  }

  final String code;
  final String name;
  final String unitType;
  final double totalSales;
  final double totalCost;
  final double totalUnits;
  final Map<int, double> monthlyData;

  JsonMap toJson() => {
        'code': code,
        'name': name,
        'unitType': unitType,
        'totalSales': totalSales,
        'totalCost': totalCost,
        'totalUnits': totalUnits,
        'monthlyData': {
          for (final entry in monthlyData.entries)
            entry.key.toString(): entry.value,
        },
      };
}

class RepartidorObjectiveFamily {
  RepartidorObjectiveFamily({
    required this.code,
    required this.name,
    required this.totalSales,
    required this.totalCost,
    required this.totalUnits,
    List<RepartidorObjectiveFamily> children = const [],
    List<RepartidorObjectiveProduct> products = const [],
  })  : children = List.unmodifiable(children),
        products = List.unmodifiable(products);

  factory RepartidorObjectiveFamily.fromJson(JsonMap json) =>
      RepartidorObjectiveFamily(
        code: _stringValue(json, const ['code']),
        name: _stringValue(json, const ['name']),
        totalSales: _requiredFiniteNumber(json, 'totalSales').toDouble(),
        totalCost: _requiredFiniteNumber(json, 'totalCost').toDouble(),
        totalUnits: _requiredFiniteNumber(json, 'totalUnits').toDouble(),
        children: _jsonMapList(json['children'])
            .map(RepartidorObjectiveFamily.fromJson)
            .toList(),
        products: _jsonMapList(json['products'])
            .map(RepartidorObjectiveProduct.fromJson)
            .toList(),
      );

  final String code;
  final String name;
  final double totalSales;
  final double totalCost;
  final double totalUnits;
  final List<RepartidorObjectiveFamily> children;
  final List<RepartidorObjectiveProduct> products;

  JsonMap toJson() => {
        'code': code,
        'name': name,
        'totalSales': totalSales,
        'totalCost': totalCost,
        'totalUnits': totalUnits,
        'children': children.map((child) => child.toJson()).toList(),
        'products': products.map((product) => product.toJson()).toList(),
      };
}

class RepartidorObjectiveClient {
  RepartidorObjectiveClient({
    required this.code,
    required this.name,
    required this.totalSales,
    required this.totalCost,
    required this.totalUnits,
    required this.productCount,
    required this.margin,
    List<RepartidorObjectiveFamily> families = const [],
  }) : families = List.unmodifiable(families);

  factory RepartidorObjectiveClient.fromJson(JsonMap json) =>
      RepartidorObjectiveClient(
        code: _stringValue(json, const ['code']),
        name: _stringValue(json, const ['name']),
        totalSales: _requiredFiniteNumber(json, 'totalSales').toDouble(),
        totalCost: _requiredFiniteNumber(json, 'totalCost').toDouble(),
        totalUnits: _requiredFiniteNumber(json, 'totalUnits').toDouble(),
        productCount: _intValue(json['productCount']),
        margin: _requiredFiniteNumber(json, 'margin').toDouble(),
        families: _jsonMapList(json['families'])
            .map(RepartidorObjectiveFamily.fromJson)
            .toList(),
      );

  final String code;
  final String name;
  final double totalSales;
  final double totalCost;
  final double totalUnits;
  final int productCount;
  final double margin;
  final List<RepartidorObjectiveFamily> families;

  JsonMap toJson() => {
        'code': code,
        'name': name,
        'totalSales': totalSales,
        'totalCost': totalCost,
        'totalUnits': totalUnits,
        'productCount': productCount,
        'margin': margin,
        'families': families.map((family) => family.toJson()).toList(),
      };
}

class RepartidorObjectivesPagination {
  const RepartidorObjectivesPagination({
    required this.limit,
    required this.offset,
    required this.total,
    required this.hasMore,
    required this.nextOffset,
  });

  factory RepartidorObjectivesPagination.fromJson(JsonMap json) {
    final limit = _intValue(json['limit']);
    final offset = _intValue(json['offset']);
    final total = _intValue(json['total']);
    final hasMore = _boolValue(json['hasMore']);
    final nextOffset = json['nextOffset'] == null
        ? null
        : _intValue(json['nextOffset'], fallback: -1);
    if (limit < 1 ||
        limit > 100 ||
        offset < 0 ||
        total < 0 ||
        (hasMore && (nextOffset == null || nextOffset <= offset)) ||
        (!hasMore && nextOffset != null)) {
      throw const FormatException('Paginacion de objetivos invalida');
    }
    return RepartidorObjectivesPagination(
      limit: limit,
      offset: offset,
      total: total,
      hasMore: hasMore,
      nextOffset: nextOffset,
    );
  }

  final int limit;
  final int offset;
  final int total;
  final bool hasMore;
  final int? nextOffset;

  JsonMap toJson() => {
        'limit': limit,
        'offset': offset,
        'total': total,
        'hasMore': hasMore,
        'nextOffset': nextOffset,
      };
}

enum RepartidorObjectivesScopeTotalAvailability {
  complete('COMPLETE'),
  paged('PAGED');

  const RepartidorObjectivesScopeTotalAvailability(this.wireValue);

  factory RepartidorObjectivesScopeTotalAvailability.fromJson(Object? value) {
    return switch (value?.toString().toUpperCase()) {
      'COMPLETE' => complete,
      'PAGED' => paged,
      _ => throw const FormatException('Disponibilidad total invalida'),
    };
  }

  final String wireValue;
}

class RepartidorObjectivesDetail {
  RepartidorObjectivesDetail({
    required this.year,
    required this.pageTotal,
    required this.grandTotal,
    required this.scopeTotalAvailability,
    required this.pagination,
    List<RepartidorObjectiveClient> clients = const [],
  }) : clients = List.unmodifiable(clients);

  factory RepartidorObjectivesDetail.fromJson(JsonMap json) {
    final grandTotalJson = json['grandTotal'];
    if (json['success'] != true ||
        json['pageTotal'] is! Map ||
        (grandTotalJson != null && grandTotalJson is! Map) ||
        json['pagination'] is! Map ||
        json['clients'] is! List) {
      throw const FormatException('Respuesta de detalle de objetivos invalida');
    }
    final availability = RepartidorObjectivesScopeTotalAvailability.fromJson(
      json['scopeTotalAvailability'],
    );
    final grandTotal = grandTotalJson == null
        ? null
        : RepartidorObjectiveTotals.fromJson(
            Map<String, dynamic>.from(grandTotalJson as Map),
          );
    if ((availability == RepartidorObjectivesScopeTotalAvailability.complete) !=
        (grandTotal != null)) {
      throw const FormatException('Total global de objetivos incoherente');
    }
    return RepartidorObjectivesDetail(
      year: _intValue(json['year'], fallback: DateTime.now().year),
      pageTotal: RepartidorObjectiveTotals.fromJson(
        Map<String, dynamic>.from(json['pageTotal'] as Map),
      ),
      grandTotal: grandTotal,
      scopeTotalAvailability: availability,
      pagination: RepartidorObjectivesPagination.fromJson(
        Map<String, dynamic>.from(json['pagination'] as Map),
      ),
      clients: _jsonMapList(json['clients'])
          .map(RepartidorObjectiveClient.fromJson)
          .toList(),
    );
  }

  final int year;
  final List<RepartidorObjectiveClient> clients;
  final RepartidorObjectiveTotals pageTotal;
  final RepartidorObjectiveTotals? grandTotal;
  final RepartidorObjectivesScopeTotalAvailability scopeTotalAvailability;
  final RepartidorObjectivesPagination pagination;

  bool get hasMore => pagination.hasMore;
  int? get nextOffset => pagination.nextOffset;
  bool get hasCompleteScopeTotal =>
      scopeTotalAvailability ==
          RepartidorObjectivesScopeTotalAvailability.complete &&
      grandTotal != null;

  RepartidorObjectivesDetail mergePage(RepartidorObjectivesDetail nextPage) {
    if (year != nextPage.year ||
        pagination.total != nextPage.pagination.total ||
        pagination.nextOffset != nextPage.pagination.offset) {
      throw const FormatException('Pagina de objetivos fuera de secuencia');
    }
    final clientsByCode = <String, RepartidorObjectiveClient>{
      for (final client in clients) client.code: client,
    };
    for (final client in nextPage.clients) {
      clientsByCode.putIfAbsent(client.code, () => client);
    }
    final mergedClients = clientsByCode.values.toList(growable: false);
    final loadedTotal = RepartidorObjectiveTotals.fromClients(mergedClients);
    final complete = !nextPage.pagination.hasMore;
    return RepartidorObjectivesDetail(
      year: year,
      clients: mergedClients,
      pageTotal: loadedTotal,
      grandTotal: complete ? loadedTotal : null,
      scopeTotalAvailability: complete
          ? RepartidorObjectivesScopeTotalAvailability.complete
          : RepartidorObjectivesScopeTotalAvailability.paged,
      pagination: RepartidorObjectivesPagination(
        limit: pagination.limit,
        offset: pagination.offset,
        total: pagination.total,
        hasMore: nextPage.pagination.hasMore,
        nextOffset: nextPage.pagination.nextOffset,
      ),
    );
  }

  JsonMap toJson() => {
        'success': true,
        'year': year,
        'pageTotal': pageTotal.toJson(),
        'grandTotal': grandTotal?.toJson(),
        'scopeTotalAvailability': scopeTotalAvailability.wireValue,
        'clients': clients.map((client) => client.toJson()).toList(),
        'pagination': pagination.toJson(),
      };
}

class DeliverySummaryDay {
  const DeliverySummaryDay({
    required this.date,
    required this.total,
    required this.completed,
    required this.pending,
    required this.amount,
  });

  factory DeliverySummaryDay.fromJson(JsonMap json) {
    return DeliverySummaryDay(
      date: _stringValue(json, const ['date', 'fecha']),
      total: _intValue(json['total']),
      completed: _intValue(json['completed']),
      pending: _intValue(json['pending']),
      amount: _doubleValue(json['amount'] ?? json['importe']),
    );
  }

  final String date;
  final int total;
  final int completed;
  final int pending;
  final double amount;

  JsonMap toJson() => {
        'date': date,
        'total': total,
        'completed': completed,
        'pending': pending,
        'amount': amount,
      };
}

class RepartidorDeliverySummary {
  RepartidorDeliverySummary({
    required this.total,
    required this.completed,
    required this.pending,
    required this.amount,
    List<DeliverySummaryDay> daily = const [],
  }) : daily = List.unmodifiable(daily);

  factory RepartidorDeliverySummary.fromJson(JsonMap json) {
    final summary = _jsonMap(json['summary']);
    return RepartidorDeliverySummary(
      total: _intValue(summary['total']),
      completed: _intValue(summary['completed']),
      pending: _intValue(summary['pending']),
      amount: _doubleValue(summary['amount'] ?? summary['importe']),
      daily:
          _jsonMapList(json['daily']).map(DeliverySummaryDay.fromJson).toList(),
    );
  }

  final int total;
  final int completed;
  final int pending;
  final double amount;
  final List<DeliverySummaryDay> daily;

  JsonMap toJson() => {
        'summary': {
          'total': total,
          'completed': completed,
          'pending': pending,
          'amount': amount,
        },
        'daily': daily.map((item) => item.toJson()).toList(),
      };
}

class RepartidorDocumentSignature {
  const RepartidorDocumentSignature({
    required this.hasSignature,
    this.path,
    this.signedAt,
    this.signedBy,
    this.raw = const {},
  });

  factory RepartidorDocumentSignature.fromJson(JsonMap json) {
    final signatureSource =
        json.containsKey('signature') ? json['signature'] : json;
    final signature = _jsonMap(signatureSource);
    return RepartidorDocumentSignature(
      hasSignature: _boolValue(json['hasSignature']) || signature.isNotEmpty,
      path: signature['path']?.toString() ??
          signature['signaturePath']?.toString(),
      signedAt:
          signature['signedAt']?.toString() ?? signature['date']?.toString(),
      signedBy:
          signature['signedBy']?.toString() ?? signature['nombre']?.toString(),
      raw: Map.unmodifiable(signature),
    );
  }

  final bool hasSignature;
  final String? path;
  final String? signedAt;
  final String? signedBy;
  final JsonMap raw;

  JsonMap toJson() => {
        'hasSignature': hasSignature,
        'signature': {
          ...raw,
          'path': path,
          'signedAt': signedAt,
          'signedBy': signedBy,
        },
      };
}

class RepartidorDocumentEmailResult {
  const RepartidorDocumentEmailResult({
    required this.success,
    this.message,
    this.raw = const {},
  });

  factory RepartidorDocumentEmailResult.fromJson(JsonMap json) {
    return RepartidorDocumentEmailResult(
      success: _boolValue(json['success']),
      message: json['message']?.toString() ?? json['error']?.toString(),
      raw: Map.unmodifiable(json),
    );
  }

  final bool success;
  final String? message;
  final JsonMap raw;

  JsonMap toJson() => raw;
}

class RepartidorCobroDia {
  const RepartidorCobroDia({
    required this.fecha,
    required this.codigoCliente,
    required this.nombreCliente,
    required this.tipoCobro,
    required this.tipoDocumento,
    required this.documento,
    required this.importe,
    required this.cobrado,
    required this.pendiente,
    this.id,
    this.idempotencyToken,
  });

  factory RepartidorCobroDia.fromJson(JsonMap json) {
    final tokenRaw = json['idempotencyToken'];
    return RepartidorCobroDia(
      id: json['id']?.toString(),
      idempotencyToken: tokenRaw?.toString().trim(),
      fecha: _stringValue(json, const ['fecha']),
      codigoCliente: _stringValue(json, const ['codigoCliente']),
      nombreCliente: _stringValue(json, const ['nombreCliente']),
      tipoCobro: _stringValue(json, const ['tipoCobro']),
      tipoDocumento: _stringValue(json, const ['tipoDocumento']),
      documento: _stringValue(json, const ['documento']),
      importe: _doubleValue(json['importe']),
      cobrado: _doubleValue(json['cobrado']),
      pendiente: _doubleValue(json['pendiente']),
    );
  }

  final String? id;

  /// Req #16: token de idempotencia del cobro. Necesario para anularlo.
  final String? idempotencyToken;
  final String fecha;
  final String codigoCliente;
  final String nombreCliente;
  final String tipoCobro;
  final String tipoDocumento;
  final String documento;
  final double importe;
  final double cobrado;
  final double pendiente;

  /// True si este cobro puede anularse desde la UI (tiene token).
  bool get canBeReversed =>
      idempotencyToken != null && idempotencyToken!.isNotEmpty;
}

class RepartidorDailySummary {
  RepartidorDailySummary({
    required this.repartidorId,
    required this.date,
    required this.totalEfectivo,
    required this.totalCheques,
    required this.totalTarjeta,
    required this.totalPostdatados,
    required this.saldoActual,
    required this.totalCobrosDia,
    required this.gastos,
    required this.totalAIngresar,
    required this.cobrosCount,
    this.ingresoBanco = 0,
    this.entregado = 0,
    this.deudaPendiente = 0,
    this.ajustes = 0,
    this.canReverseCobros = false,
    List<RepartidorCobroDia> cobros = const [],
  }) : cobros = List.unmodifiable(cobros);

  factory RepartidorDailySummary.fromJson(JsonMap json) {
    // Canonical API field is `summary`; keep `totals` as compatibility fallback.
    final summaryBlock = _jsonMap(json['summary']);
    final totalsBlock = _jsonMap(json['totals']);
    final resolved = summaryBlock.isNotEmpty ? summaryBlock : totalsBlock;
    double money(List<String> keys) {
      for (final key in keys) {
        if (!resolved.containsKey(key) || resolved[key] == null) continue;
        return _doubleValue(resolved[key]);
      }
      return 0;
    }

    int count(List<String> keys) {
      for (final key in keys) {
        if (!resolved.containsKey(key) || resolved[key] == null) continue;
        return _intValue(resolved[key]);
      }
      return 0;
    }

    return RepartidorDailySummary(
      repartidorId: _stringValue(json, const ['repartidorId']),
      date: _stringValue(json, const ['date']),
      totalEfectivo: money(const ['totalEfectivo', 'TOTAL_EFECTIVO']),
      totalCheques: money(const ['totalCheques', 'TOTAL_CHEQUES']),
      totalTarjeta: money(const ['totalTarjeta', 'TOTAL_TARJETA']),
      totalPostdatados: money(const ['totalPostdatados', 'TOTAL_POSTDATADOS']),
      saldoActual: money(const ['saldoActual', 'SALDO_PENDIENTE']),
      totalCobrosDia: money(const ['totalCobrosDia', 'TOTAL_COBROS_DIA']),
      gastos: money(const ['gastos', 'TOTAL_GASTOS']),
      totalAIngresar: money(const ['totalAIngresar', 'TOTAL_A_INGRESAR']),
      ingresoBanco: money(const [
        'ingresoBanco',
        'TOTAL_INGRESO_BANCO',
        'IMPORTEINGRESOENBANCO',
      ]),
      cobrosCount: count(const ['cobrosCount', 'COBROS_COUNT']),
      entregado: money(const ['entregado', 'TOTAL_REPARTIDO']),
      deudaPendiente: money(const ['deudaPendiente', 'DEUDA_PENDIENTE']),
      ajustes: money(const ['ajustes', 'TOTAL_AJUSTES']),
      canReverseCobros: json['canReverseCobros'] == true,
      cobros: _jsonMapList(json['cobros'])
          .map(RepartidorCobroDia.fromJson)
          .toList(),
    );
  }

  final String repartidorId;
  final String date;
  final double totalEfectivo;
  final double totalCheques;
  final double totalTarjeta;
  final double totalPostdatados;
  final double saldoActual;
  final double totalCobrosDia;
  final double gastos;
  final double totalAIngresar;
  final double ingresoBanco;
  final double entregado;
  final double deudaPendiente;
  final double ajustes;
  final int cobrosCount;

  /// Capability autorizada explícitamente por el backend. Fail-closed.
  final bool canReverseCobros;
  final List<RepartidorCobroDia> cobros;
}

class RepartidorVencimiento {
  const RepartidorVencimiento({
    required this.tipoDocumento,
    required this.codigoCliente,
    required this.nombreCliente,
    required this.fechaVencimiento,
    required this.documento,
    required this.importe,
    required this.importePendiente,
    this.nombreAlternativo = '',
    this.poblacion = '',
    this.keys = const {},
  });

  factory RepartidorVencimiento.fromJson(JsonMap json) {
    return RepartidorVencimiento(
      tipoDocumento: _stringValue(json, const ['tipoDocumento']),
      codigoCliente: _stringValue(json, const ['codigoCliente']),
      nombreCliente: _stringValue(json, const ['nombreCliente']),
      nombreAlternativo: _stringValue(json, const ['nombreAlternativo']),
      poblacion: _stringValue(json, const ['poblacion']),
      fechaVencimiento: _stringValue(json, const ['fechaVencimiento']),
      documento: _stringValue(json, const ['documento']),
      importe: _doubleValue(json['importe']),
      importePendiente: _doubleValue(json['importePendiente']),
      keys: Map.unmodifiable(_jsonMap(json['keys'])),
    );
  }

  final String tipoDocumento;
  final String codigoCliente;
  final String nombreCliente;
  final String nombreAlternativo;
  final String poblacion;
  final String fechaVencimiento;
  final String documento;
  final double importe;
  final double importePendiente;
  final JsonMap keys;

  DateTime? get dueDate {
    final parsed = DateTime.tryParse(fechaVencimiento);
    if (parsed == null) return null;
    final normalized = '${parsed.year.toString().padLeft(4, '0')}-'
        '${parsed.month.toString().padLeft(2, '0')}-'
        '${parsed.day.toString().padLeft(2, '0')}';
    return normalized == fechaVencimiento ? parsed : null;
  }

  bool get hasValidDueDate => dueDate != null;
}

class RepartidorVencimientosBatch {
  RepartidorVencimientosBatch({
    required List<RepartidorVencimiento> items,
    required this.total,
    required this.hasMore,
    required this.nextCursor,
  }) : items = List.unmodifiable(items);

  factory RepartidorVencimientosBatch.fromJson(JsonMap json) {
    final pagination = _jsonMap(json['pagination']);
    final items = _jsonMapList(json['vencimientos'])
        .map(RepartidorVencimiento.fromJson)
        .toList();
    return RepartidorVencimientosBatch(
      items: items,
      total: _intValue(pagination['total'], fallback: items.length),
      hasMore: _boolValue(pagination['hasMore']),
      nextCursor: pagination['nextCursor']?.toString().trim(),
    );
  }

  final List<RepartidorVencimiento> items;
  final int total;
  final bool hasMore;
  final String? nextCursor;
}

class RepartidorLiquidacionSnapshot {
  const RepartidorLiquidacionSnapshot({
    required this.deliveries,
    required this.payments,
    required this.expenses,
    required this.adjustments,
    required this.bankDeposits,
    required this.pending,
    required this.openingBalance,
    required this.balance,
  });

  factory RepartidorLiquidacionSnapshot.fromJson(JsonMap json) {
    double amount(String key) {
      final value = json[key];
      if (value is! num || !value.toDouble().isFinite) {
        throw FormatException('Snapshot de liquidacion invalido: $key');
      }
      return value.toDouble();
    }

    return RepartidorLiquidacionSnapshot(
      deliveries: amount('deliveries'),
      payments: amount('payments'),
      expenses: amount('expenses'),
      adjustments: amount('adjustments'),
      bankDeposits: amount('bankDeposits'),
      pending: amount('pending'),
      openingBalance: amount('openingBalance'),
      balance: amount('balance'),
    );
  }
  final double deliveries;
  final double payments;
  final double expenses;
  final double adjustments;
  final double bankDeposits;
  final double pending;
  final double openingBalance;
  final double balance;
}

class RepartidorLiquidacionResult {
  const RepartidorLiquidacionResult({
    required this.created,
    required this.id,
    required this.marker,
    required this.repartidorId,
    required this.date,
    required this.status,
    required this.snapshot,
    this.outboxPending = false,
  });
  factory RepartidorLiquidacionResult.fromJson(JsonMap json) {
    final created = json['created'];
    final liquidacion = _jsonMap(json['liquidacion']);
    final id = liquidacion['id']?.toString().trim() ?? '';
    final marker = liquidacion['marker']?.toString().trim() ?? '';
    final repartidorId = liquidacion['repartidorId']?.toString().trim() ?? '';
    final date = liquidacion['date']?.toString().trim() ?? '';
    final status = liquidacion['status']?.toString().trim().toUpperCase() ?? '';
    final snapshot = _jsonMap(liquidacion['snapshot']);
    if (created is! bool ||
        id.isEmpty ||
        marker.isEmpty ||
        repartidorId.isEmpty ||
        !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date) ||
        status != 'CLOSED' ||
        snapshot.isEmpty) {
      throw const FormatException(
        'Respuesta de liquidacion incompleta o invalida',
      );
    }
    final outbox = json['outboxIntent'];
    if (outbox != null && outbox is! Map) {
      throw const FormatException('Estado de outbox de liquidacion invalido');
    }
    return RepartidorLiquidacionResult(
      created: created,
      id: id,
      marker: marker,
      repartidorId: repartidorId,
      date: date,
      status: status,
      snapshot: RepartidorLiquidacionSnapshot.fromJson(snapshot),
      outboxPending: outbox is Map,
    );
  }
  final bool created;
  final String id;
  final String marker;
  final String repartidorId;
  final String date;
  final String status;
  final RepartidorLiquidacionSnapshot snapshot;
  final bool outboxPending;
  bool get isReplay => !created;
}

class RepartidorLiquidacionEntry {
  const RepartidorLiquidacionEntry({
    required this.id,
    required this.type,
    required this.repartidorId,
    required this.date,
    required this.amount,
    required this.status,
    required this.detail,
    required this.createdAt,
    this.observation,
  });

  factory RepartidorLiquidacionEntry.fromJson(
    JsonMap json, {
    required String expectedType,
    required String expectedRepartidorId,
    required String expectedDate,
  }) {
    const detailKeys = <String, String>{
      'EXPENSE': 'category',
      'ADJUSTMENT': 'reason',
      'BANK_DEPOSIT': 'reference',
    };
    const detailLimits = <String, int>{
      'EXPENSE': 40,
      'ADJUSTMENT': 120,
      'BANK_DEPOSIT': 80,
    };
    final detailKey = detailKeys[expectedType];
    if (detailKey == null) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_ENTRY_TYPE_INVALID',
        'Tipo de entrada de liquidacion no permitido',
      );
    }
    final allowedKeys = <String>{
      'id',
      'type',
      'repartidorId',
      'date',
      'amount',
      detailKey,
      'observation',
      'status',
      'createdAt',
    };
    final normalized = Map<String, dynamic>.from(json);
    if (normalized['id'] is num) {
      normalized['id'] = (normalized['id'] as num).toString();
    }
    if (normalized.keys.any((key) => !allowedKeys.contains(key)) ||
        allowedKeys
            .difference(normalized.keys.toSet())
            .difference({'observation'}).isNotEmpty) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_ENTRY_SHAPE_INVALID',
        'Estructura de entrada de liquidacion invalida',
      );
    }
    if (normalized['id'] is! String ||
        normalized['type'] is! String ||
        normalized['repartidorId'] is! String ||
        normalized['date'] is! String ||
        normalized[detailKey] is! String ||
        normalized['status'] is! String ||
        normalized['createdAt'] is! String ||
        (normalized['observation'] != null &&
            normalized['observation'] is! String)) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_ENTRY_TYPES_INVALID',
        'Tipos de entrada de liquidacion invalidos',
      );
    }
    final id = normalized['id'] as String;
    final type = normalized['type'] as String;
    final repartidorId = normalized['repartidorId'] as String;
    final date = normalized['date'] as String;
    final status = normalized['status'] as String;
    final amount = normalized['amount'];
    final detail = normalized[detailKey] as String;
    final observation = normalized['observation'] as String?;
    final createdAt = normalized['createdAt'] as String;
    final numericAmount = amount is num ? amount.toDouble() : double.nan;
    final amountHasValidSign =
        expectedType == 'ADJUSTMENT' ? numericAmount != 0 : numericAmount > 0;
    if (id != id.trim() ||
        id.isEmpty ||
        id.length > 128 ||
        type != type.trim() ||
        type != expectedType ||
        repartidorId != repartidorId.trim() ||
        repartidorId != expectedRepartidorId ||
        date != date.trim() ||
        date != expectedDate ||
        !_isRealIsoDate(date) ||
        !numericAmount.isFinite ||
        !amountHasValidSign ||
        numericAmount.abs() > 99999999 ||
        ((numericAmount * 100).round() - numericAmount * 100).abs() >
            0.000001 ||
        detail != detail.trim() ||
        detail.isEmpty ||
        detail.length > detailLimits[expectedType]! ||
        (observation != null &&
            (observation != observation.trim() ||
                observation.isEmpty ||
                observation.length > 250)) ||
        status != status.trim() ||
        (status != 'PENDING' && status != 'LIQUIDATED') ||
        createdAt != createdAt.trim() ||
        createdAt.isEmpty ||
        !_isExactIsoUtcTimestamp(createdAt)) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_ENTRY_CONTRACT_INVALID',
        'Entrada de liquidacion invalida',
      );
    }
    return RepartidorLiquidacionEntry(
      id: id,
      type: expectedType,
      repartidorId: repartidorId,
      date: date,
      amount: numericAmount,
      status: status,
      detail: detail,
      createdAt: createdAt,
      observation: observation,
    );
  }

  final String id;
  final String type;
  final String repartidorId;
  final String date;
  final double amount;
  final String status;
  final String detail;
  final String createdAt;
  final String? observation;
}

class RepartidorLiquidacionEntryResult {
  const RepartidorLiquidacionEntryResult({
    required this.created,
    required this.entry,
  });

  factory RepartidorLiquidacionEntryResult.fromJson(
    JsonMap json, {
    required String expectedType,
    required String expectedRepartidorId,
    required String expectedDate,
  }) {
    const responseKeys = {'success', 'created', 'entry'};
    if (json.keys.toSet().difference(responseKeys).isNotEmpty ||
        responseKeys.difference(json.keys.toSet()).isNotEmpty ||
        json['success'] != true ||
        json['created'] is! bool ||
        json['entry'] is! Map) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_ENTRY_RESPONSE_INVALID',
        'Respuesta de entrada de liquidacion invalida',
      );
    }
    return RepartidorLiquidacionEntryResult(
      created: json['created'] as bool,
      entry: RepartidorLiquidacionEntry.fromJson(
        Map<String, dynamic>.from(json['entry'] as Map),
        expectedType: expectedType,
        expectedRepartidorId: expectedRepartidorId,
        expectedDate: expectedDate,
      ),
    );
  }

  final bool created;
  final RepartidorLiquidacionEntry entry;
  bool get isReplay => !created;
}

class RepartidorLiquidacionContractException extends FormatException {
  const RepartidorLiquidacionContractException(this.code, super.message);
  final String code;
}

bool _isRealIsoDate(String value) {
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)) return false;
  final parsed = DateTime.tryParse('${value}T00:00:00.000Z');
  return parsed != null && parsed.toIso8601String().substring(0, 10) == value;
}

bool _isExactIsoUtcTimestamp(String value) {
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$')
      .hasMatch(value)) {
    return false;
  }
  final parsed = DateTime.tryParse(value);
  return parsed != null && parsed.isUtc;
}

class RepartidorLiquidacionLedger {
  const RepartidorLiquidacionLedger({
    required this.status,
    required this.expenses,
    required this.adjustments,
    required this.bankDeposits,
    required this.expensesTotal,
    required this.adjustmentsTotal,
    required this.bankDepositsTotal,
  });

  factory RepartidorLiquidacionLedger.fromJson(
    JsonMap json, {
    String? expectedRepartidorId,
    String? expectedDate,
  }) {
    const expectedKeys = <String>{
      'repartidorId',
      'date',
      'status',
      'expenses',
      'adjustments',
      'bankDeposits',
      'totals',
    };
    if (expectedKeys.difference(json.keys.toSet()).isNotEmpty) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_LEDGER_SHAPE_INVALID',
        'Desglose de liquidacion invalido',
      );
    }
    if (json['repartidorId'] is! String ||
        json['date'] is! String ||
        json['status'] is! String) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_LEDGER_TYPES_INVALID',
        'Tipos del desglose de liquidacion invalidos',
      );
    }
    final repartidorId = json['repartidorId'] as String;
    final date = json['date'] as String;
    if (repartidorId != repartidorId.trim() ||
        date != date.trim() ||
        !RegExp(r'^\d{1,20}$').hasMatch(repartidorId) ||
        !_isRealIsoDate(date) ||
        (expectedRepartidorId != null &&
            repartidorId != expectedRepartidorId) ||
        (expectedDate != null && date != expectedDate)) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_LEDGER_IDENTITY_INVALID',
        'Identidad del desglose de liquidacion invalida',
      );
    }
    List<RepartidorLiquidacionEntry> read(String field, String type) {
      final value = json[field];
      if (value is! List) {
        throw const RepartidorLiquidacionContractException(
          'LIQUIDACION_LEDGER_LIST_INVALID',
          'Desglose de liquidacion invalido',
        );
      }
      final entries = <RepartidorLiquidacionEntry>[];
      for (final item in value) {
        if (item is! Map) continue;
        try {
          entries.add(
            RepartidorLiquidacionEntry.fromJson(
              Map<String, dynamic>.from(item),
              expectedType: type,
              expectedRepartidorId: repartidorId,
              expectedDate: date,
            ),
          );
        } catch (_) {
          continue;
        }
      }
      return List.unmodifiable(entries);
    }

    final status = json['status'] as String;
    final totals = _jsonMap(json['totals']);
    if (totals.keys.toSet().difference(
          {'expenses', 'adjustments', 'bankDeposits'},
        ).isNotEmpty ||
        totals.length != 3) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_LEDGER_TOTALS_INVALID',
        'Totales de liquidacion invalidos',
      );
    }
    double total(String key) {
      final value = totals[key];
      final amount = value is num ? value.toDouble() : double.nan;
      if (!amount.isFinite ||
          amount.abs() > 99999999 ||
          ((amount * 100).round() - amount * 100).abs() > 0.000001) {
        throw const RepartidorLiquidacionContractException(
          'LIQUIDACION_LEDGER_TOTAL_INVALID',
          'Total de liquidacion invalido',
        );
      }
      return amount;
    }

    if (status != status.trim() || (status != 'OPEN' && status != 'CLOSED')) {
      throw const RepartidorLiquidacionContractException(
        'LIQUIDACION_LEDGER_STATUS_INVALID',
        'Estado de desglose invalido',
      );
    }
    final expenses = read('expenses', 'EXPENSE');
    final adjustments = read('adjustments', 'ADJUSTMENT');
    final bankDeposits = read('bankDeposits', 'BANK_DEPOSIT');
    final expensesTotal = total('expenses');
    final adjustmentsTotal = total('adjustments');
    final bankDepositsTotal = total('bankDeposits');
    double sum(List<RepartidorLiquidacionEntry> entries) => entries.fold(
          0,
          (value, entry) => value + entry.amount,
        );
    bool matches(double left, double right) => (left - right).abs() < 0.000001;
    final computedExpenses = sum(expenses);
    final computedAdjustments = sum(adjustments);
    final computedDeposits = sum(bankDeposits);
    return RepartidorLiquidacionLedger(
      status: status,
      expenses: expenses,
      adjustments: adjustments,
      bankDeposits: bankDeposits,
      expensesTotal: matches(computedExpenses, expensesTotal)
          ? expensesTotal
          : computedExpenses,
      adjustmentsTotal: matches(computedAdjustments, adjustmentsTotal)
          ? adjustmentsTotal
          : computedAdjustments,
      bankDepositsTotal: matches(computedDeposits, bankDepositsTotal)
          ? bankDepositsTotal
          : computedDeposits,
    );
  }

  final String status;
  final List<RepartidorLiquidacionEntry> expenses;
  final List<RepartidorLiquidacionEntry> adjustments;
  final List<RepartidorLiquidacionEntry> bankDeposits;
  final double expensesTotal;
  final double adjustmentsTotal;
  final double bankDepositsTotal;
}

class RepartidorCommissionTier {
  const RepartidorCommissionTier({
    required this.thresholdPct,
    required this.commissionPct,
    required this.sortOrder,
    this.id,
  });

  factory RepartidorCommissionTier.fromJson(JsonMap json) {
    return RepartidorCommissionTier(
      id: json['id']?.toString(),
      thresholdPct: _doubleValue(json['thresholdPct']),
      commissionPct: _doubleValue(json['commissionPct']),
      sortOrder: _intValue(json['sortOrder']),
    );
  }

  final String? id;
  final double thresholdPct;
  final double commissionPct;
  final int sortOrder;

  JsonMap toJson() => {
        'thresholdPct': thresholdPct,
        'commissionPct': commissionPct,
      };
}

class RepartidorCommissionReachedTier {
  const RepartidorCommissionReachedTier({
    required this.thresholdPct,
    required this.commissionPct,
    required this.thresholdAmount,
    required this.excess,
    required this.commission,
  });

  factory RepartidorCommissionReachedTier.fromJson(JsonMap json) {
    return RepartidorCommissionReachedTier(
      thresholdPct: _doubleValue(json['thresholdPct']),
      commissionPct: _doubleValue(json['commissionPct']),
      thresholdAmount: _doubleValue(json['thresholdAmount']),
      excess: _doubleValue(json['excess']),
      commission: _doubleValue(json['commission']),
    );
  }

  final double thresholdPct;
  final double commissionPct;
  final double thresholdAmount;
  final double excess;
  final double commission;
}

class RepartidorCommissionSummary {
  RepartidorCommissionSummary({
    required this.repartidorId,
    required this.deliveredAmount,
    required this.collectedAmount,
    required this.collectedPct,
    required this.commission,
    List<RepartidorCommissionTier> tiers = const [],
    List<RepartidorCommissionReachedTier> reached = const [],
  })  : tiers = List.unmodifiable(tiers),
        reached = List.unmodifiable(reached);

  factory RepartidorCommissionSummary.fromJson(JsonMap json) {
    return RepartidorCommissionSummary(
      repartidorId: _stringValue(json, const ['repartidorId']),
      deliveredAmount: _doubleValue(json['deliveredAmount']),
      collectedAmount: _doubleValue(json['collectedAmount']),
      collectedPct: _doubleValue(json['collectedPct']),
      commission: _doubleValue(json['commission']),
      tiers: _jsonMapList(json['tiers'])
          .map(RepartidorCommissionTier.fromJson)
          .toList(),
      reached: _jsonMapList(json['reached'])
          .map(RepartidorCommissionReachedTier.fromJson)
          .toList(),
    );
  }

  final String repartidorId;
  final double deliveredAmount;
  final double collectedAmount;
  final double collectedPct;
  final double commission;
  final List<RepartidorCommissionTier> tiers;
  final List<RepartidorCommissionReachedTier> reached;
}

num _requiredFiniteNumber(JsonMap json, String key) {
  final value = json[key];
  final parsed = value is num ? value : num.tryParse(value?.toString() ?? '');
  if (parsed == null || !parsed.toDouble().isFinite) {
    throw FormatException('Campo numerico invalido: $key');
  }
  return parsed;
}

class RepartidorEvolutionPoint {
  const RepartidorEvolutionPoint({
    required this.period,
    required this.totalSales,
    required this.numCobros,
  });

  factory RepartidorEvolutionPoint.fromJson(JsonMap json) {
    final period = json['period']?.toString() ?? '';
    if (!RegExp(r'^\d{4}-(0[1-9]|1[0-2])$').hasMatch(period)) {
      throw const FormatException('Periodo de evolucion invalido');
    }
    final totalSales = _requiredFiniteNumber(json, 'totalSales').toDouble();
    final rawCount = _requiredFiniteNumber(json, 'numCobros');
    if (totalSales < 0 ||
        rawCount < 0 ||
        rawCount != rawCount.roundToDouble()) {
      throw const FormatException('Valores de evolucion fuera de rango');
    }
    return RepartidorEvolutionPoint(
      period: period,
      totalSales: totalSales,
      numCobros: rawCount.toInt(),
    );
  }

  final String period;
  final double totalSales;
  final int numCobros;

  String get monthLabel => period.split('-').last;
}

class RepartidorTopProduct {
  const RepartidorTopProduct({
    required this.code,
    required this.name,
    required this.totalUnits,
    required this.totalSales,
  });

  factory RepartidorTopProduct.fromJson(JsonMap json) {
    final code = json['code']?.toString().trim() ?? '';
    final name = json['name']?.toString().trim() ?? '';
    final totalUnits = _requiredFiniteNumber(json, 'totalUnits').toDouble();
    final totalSales = _requiredFiniteNumber(json, 'totalSales').toDouble();
    if (code.isEmpty || totalUnits < 0 || totalSales < 0) {
      throw const FormatException('Producto destacado invalido');
    }
    return RepartidorTopProduct(
      code: code,
      name: name.isEmpty ? code : name,
      totalUnits: totalUnits,
      totalSales: totalSales,
    );
  }

  final String code;
  final String name;
  final double totalUnits;
  final double totalSales;
}

class RepartidorEvolutionData {
  RepartidorEvolutionData({
    required List<RepartidorEvolutionPoint> evolution,
    required List<RepartidorTopProduct> topProducts,
  })  : evolution = List.unmodifiable(evolution),
        topProducts = List.unmodifiable(topProducts);

  factory RepartidorEvolutionData.fromJson(JsonMap json) {
    final rawEvolution = json['evolution'];
    final rawProducts = json['topProducts'];
    if (rawEvolution is! List || rawProducts is! List) {
      throw const FormatException('Respuesta de evolucion incompleta');
    }
    return RepartidorEvolutionData(
      evolution: rawEvolution.map((item) {
        if (item is! Map) {
          throw const FormatException('Punto de evolucion invalido');
        }
        return RepartidorEvolutionPoint.fromJson(
          Map<String, dynamic>.from(item),
        );
      }).toList(),
      topProducts: rawProducts.map((item) {
        if (item is! Map) {
          throw const FormatException('Producto destacado invalido');
        }
        return RepartidorTopProduct.fromJson(Map<String, dynamic>.from(item));
      }).toList(),
    );
  }

  final List<RepartidorEvolutionPoint> evolution;
  final List<RepartidorTopProduct> topProducts;

  bool get isEmpty => evolution.isEmpty && topProducts.isEmpty;
}
