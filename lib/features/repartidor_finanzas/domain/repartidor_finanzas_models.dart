// ignore_for_file: public_member_api_docs

typedef JsonMap = Map<String, dynamic>;

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

class RepartidorObjectivesDetail {
  RepartidorObjectivesDetail({
    required this.repartidorId,
    required this.year,
    this.clientId,
    List<RepartidorObjectiveBreakdownNode> nodes = const [],
    JsonMap totals = const {},
  })  : nodes = List.unmodifiable(nodes),
        totals = Map.unmodifiable(totals);

  factory RepartidorObjectivesDetail.fromJson(JsonMap json) {
    final nodesSource =
        json['nodes'] ?? json['items'] ?? json['breakdown'] ?? json['data'];
    return RepartidorObjectivesDetail(
      repartidorId: _stringValue(json, const ['repartidorId', 'repartidor']),
      year: _intValue(json['year'], fallback: DateTime.now().year),
      clientId: json['clientId']?.toString(),
      totals: _jsonMap(json['totals'] ?? json['summary']),
      nodes: _jsonMapList(nodesSource)
          .map(RepartidorObjectiveBreakdownNode.fromJson)
          .toList(),
    );
  }

  final String repartidorId;
  final int year;
  final String? clientId;
  final List<RepartidorObjectiveBreakdownNode> nodes;
  final JsonMap totals;

  JsonMap toJson() => {
        'repartidorId': repartidorId,
        'year': year,
        'clientId': clientId,
        'totals': totals,
        'nodes': nodes.map((node) => node.toJson()).toList(),
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
      idempotencyToken: tokenRaw == null ? null : tokenRaw.toString().trim(),
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
    List<RepartidorCobroDia> cobros = const [],
  }) : cobros = List.unmodifiable(cobros);

  factory RepartidorDailySummary.fromJson(JsonMap json) {
    final totals = _jsonMap(json['totals']);
    return RepartidorDailySummary(
      repartidorId: _stringValue(json, const ['repartidorId']),
      date: _stringValue(json, const ['date']),
      totalEfectivo: _doubleValue(totals['totalEfectivo']),
      totalCheques: _doubleValue(totals['totalCheques']),
      totalTarjeta: _doubleValue(totals['totalTarjeta']),
      totalPostdatados: _doubleValue(totals['totalPostdatados']),
      saldoActual: _doubleValue(totals['saldoActual']),
      totalCobrosDia: _doubleValue(totals['totalCobrosDia']),
      gastos: _doubleValue(totals['gastos']),
      totalAIngresar: _doubleValue(totals['totalAIngresar']),
      cobrosCount: _intValue(totals['cobrosCount']),
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
  final int cobrosCount;
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
}

class RepartidorLiquidacionResult {
  const RepartidorLiquidacionResult({
    required this.created,
    required this.raw,
  });

  factory RepartidorLiquidacionResult.fromJson(JsonMap json) {
    return RepartidorLiquidacionResult(
      created: _boolValue(json['created']),
      raw: Map.unmodifiable(json),
    );
  }

  final bool created;
  final JsonMap raw;
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
