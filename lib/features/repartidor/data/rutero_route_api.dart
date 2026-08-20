/// Models + thin API client for rutero optimize / stops-geo.
library;

import 'package:gmp_app_mobilidad/core/api/api_client.dart';

enum RuteroRouteStrategy {
  windowsFirst('windows_first', 'Priorizar horarios'),
  balanced('balanced', 'Equilibrada'),
  distanceFirst('distance_first', 'Menos km');

  const RuteroRouteStrategy(this.wireValue, this.label);

  final String wireValue;
  final String label;
}

class RuteroRouteOrigin {
  const RuteroRouteOrigin({required this.lat, required this.lng});

  final double lat;
  final double lng;

  Map<String, double> toJson() => {'lat': lat, 'lng': lng};
}

class RuteroEtaStopRef {
  const RuteroEtaStopRef({
    required this.id,
    required this.codigoCliente,
    this.nombreCliente = '',
  });

  final String id;
  final String codigoCliente;
  final String nombreCliente;
}

class RuteroRouteExplanation {
  const RuteroRouteExplanation({
    required this.summary,
    this.factors = const [],
    this.departureMinute,
    this.departureLabel,
    this.prepReadyLabel,
    this.estimatedKm,
    this.estimatedEndLabel,
    this.stopsWithWindow,
    this.stopsWithGps,
    this.closedCount,
  });

  factory RuteroRouteExplanation.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const RuteroRouteExplanation(summary: '');
    }
    return RuteroRouteExplanation(
      summary: json['summary']?.toString() ?? '',
      factors: (json['factors'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList(growable: false) ??
          const [],
      departureMinute: _asInt(json['departureMinute']),
      departureLabel: json['departureLabel']?.toString(),
      prepReadyLabel: json['prepReadyLabel']?.toString(),
      estimatedKm: _asDouble(json['estimatedKm']),
      estimatedEndLabel: json['estimatedEndLabel']?.toString(),
      stopsWithWindow: _asInt(json['stopsWithWindow']),
      stopsWithGps: _asInt(json['stopsWithGps']),
      closedCount: _asInt(json['closedCount']),
    );
  }

  final String summary;
  final List<String> factors;
  final int? departureMinute;
  final String? departureLabel;
  final String? prepReadyLabel;
  final double? estimatedKm;
  final String? estimatedEndLabel;
  final int? stopsWithWindow;
  final int? stopsWithGps;
  final int? closedCount;

  bool get isEmpty => summary.trim().isEmpty && factors.isEmpty;
}

class RuteroOptimizeResult {
  const RuteroOptimizeResult({
    required this.orden,
    this.explanation,
    this.algorithm,
    this.departureLabel,
  });

  final List<RuteroStopWindow> orden;
  final RuteroRouteExplanation? explanation;
  final String? algorithm;
  final String? departureLabel;
}

class RuteroStopWindow {
  const RuteroStopWindow({
    required this.documentId,
    required this.cliente,
    this.posicion,
    this.preferredMinute,
    this.windowLabel,
    this.observaciones,
    this.closedDay = false,
    this.lat,
    this.lng,
    this.hasGps = false,
    this.nombreCliente,
    this.etaMinute,
    this.etaLabel,
    this.departureMinute,
    this.departureLabel,
    this.prepReadyLabel,
    this.pickupLabel,
    this.distanceKmFromPrev,
    this.travelMinutesFromPrev,
    this.reason,
  });

  factory RuteroStopWindow.fromJson(Map<String, dynamic> json) {
    return RuteroStopWindow(
      documentId: (json['documentId'] ?? '').toString(),
      cliente: (json['cliente'] ?? json['codigoCliente'] ?? '').toString(),
      posicion: _asInt(json['posicion']),
      preferredMinute: _asInt(json['preferredMinute']),
      windowLabel: json['windowLabel']?.toString(),
      observaciones: json['observaciones']?.toString(),
      closedDay: json['closedDay'] == true,
      lat: _asDouble(json['lat']),
      lng: _asDouble(json['lng']),
      hasGps: json['hasGps'] == true ||
          (_asDouble(json['lat']) != null && _asDouble(json['lng']) != null),
      nombreCliente: json['nombreCliente']?.toString(),
      etaMinute: _asInt(json['etaMinute']),
      etaLabel: json['etaLabel']?.toString(),
      departureMinute: _asInt(json['departureMinute']),
      departureLabel: json['departureLabel']?.toString(),
      prepReadyLabel: json['prepReadyLabel']?.toString(),
      pickupLabel: json['pickupLabel']?.toString(),
      distanceKmFromPrev: _asDouble(json['distanceKmFromPrev']),
      travelMinutesFromPrev: _asInt(json['travelMinutesFromPrev']),
      reason: json['reason']?.toString(),
    );
  }

  final String documentId;
  final String cliente;
  final int? posicion;
  final int? preferredMinute;
  final String? windowLabel;
  final String? observaciones;
  final bool closedDay;
  final double? lat;
  final double? lng;
  final bool hasGps;
  final String? nombreCliente;
  final int? etaMinute;
  final String? etaLabel;
  final int? departureMinute;
  final String? departureLabel;
  final String? prepReadyLabel;
  final String? pickupLabel;
  final double? distanceKmFromPrev;
  final int? travelMinutesFromPrev;
  final String? reason;

  String get observacionesSnippet {
    final text = (observaciones ?? '').trim();
    if (text.isEmpty) return '';
    return text.length <= 48 ? text : '${text.substring(0, 48)}…';
  }

  RuteroStopWindow copyWith({
    String? documentId,
    String? cliente,
    int? posicion,
    int? preferredMinute,
    String? windowLabel,
    String? observaciones,
    bool? closedDay,
    double? lat,
    double? lng,
    bool? hasGps,
    String? nombreCliente,
    int? etaMinute,
    String? etaLabel,
    int? departureMinute,
    String? departureLabel,
    String? prepReadyLabel,
    String? pickupLabel,
    double? distanceKmFromPrev,
    int? travelMinutesFromPrev,
    String? reason,
  }) {
    return RuteroStopWindow(
      documentId: documentId ?? this.documentId,
      cliente: cliente ?? this.cliente,
      posicion: posicion ?? this.posicion,
      preferredMinute: preferredMinute ?? this.preferredMinute,
      windowLabel: windowLabel ?? this.windowLabel,
      observaciones: observaciones ?? this.observaciones,
      closedDay: closedDay ?? this.closedDay,
      lat: lat ?? this.lat,
      lng: lng ?? this.lng,
      hasGps: hasGps ?? this.hasGps,
      nombreCliente: nombreCliente ?? this.nombreCliente,
      etaMinute: etaMinute ?? this.etaMinute,
      etaLabel: etaLabel ?? this.etaLabel,
      departureMinute: departureMinute ?? this.departureMinute,
      departureLabel: departureLabel ?? this.departureLabel,
      prepReadyLabel: prepReadyLabel ?? this.prepReadyLabel,
      pickupLabel: pickupLabel ?? this.pickupLabel,
      distanceKmFromPrev: distanceKmFromPrev ?? this.distanceKmFromPrev,
      travelMinutesFromPrev:
          travelMinutesFromPrev ?? this.travelMinutesFromPrev,
      reason: reason ?? this.reason,
    );
  }
}

double? _asDouble(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}

int? _asInt(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toInt();
  return int.tryParse(value.toString());
}

class RuteroOrderState {
  const RuteroOrderState({required this.revision, required this.orden});
  final String revision;
  final List<String> orden;

  factory RuteroOrderState.fromJson(Map<String, dynamic> json) =>
      RuteroOrderState(
        revision: (json['revision'] ?? json['routeRevision'] ?? json['version'])
                ?.toString() ??
            '',
        orden: _documentIds(json['orden'] ?? json['items']),
      );
}

List<String> _documentIds(dynamic raw) {
  if (raw is! List) return const [];
  return raw
      .map((row) => row is Map ? row['documentId'] : row)
      .map((id) => id?.toString().trim() ?? '')
      .where((id) => id.isNotEmpty)
      .toList(growable: false);
}

/// True only when a server proposal names every current document exactly once.
/// This prevents a partial/empty response from silently reordering the route.
bool isCompleteDocumentPermutation({
  required Iterable<String> currentIds,
  required Iterable<String> proposedIds,
}) {
  final current = currentIds.map((id) => id.trim()).toList(growable: false);
  final proposed = proposedIds.map((id) => id.trim()).toList(growable: false);
  if (current.any((id) => id.isEmpty) || proposed.any((id) => id.isEmpty)) {
    return false;
  }
  if (current.length != proposed.length) return false;
  return current.toSet().length == current.length &&
      proposed.toSet().length == proposed.length &&
      current.toSet().containsAll(proposed);
}

class RuteroRouteApi {
  const RuteroRouteApi._();

  static Map<String, RuteroStopWindow> annotateEtasForOrder({
    required List<RuteroEtaStopRef> ordered,
    required Map<String, RuteroStopWindow> metaByKey,
  }) {
    // ETA and distance belong to the server proposal because the device must
    // never invent a depot or a 07:00 departure.  Local drag only updates the
    // visible sequence; a new proposal recalculates authoritative metrics.
    final stableMeta = Map<String, RuteroStopWindow>.from(metaByKey);
    for (var index = 0; index < ordered.length; index++) {
      final item = ordered[index];
      final base = stableMeta[item.id] ??
          stableMeta[item.codigoCliente] ??
          RuteroStopWindow(documentId: item.id, cliente: item.codigoCliente);
      final updated = base.copyWith(
        documentId: item.id,
        cliente: item.codigoCliente,
        posicion: index,
        nombreCliente: item.nombreCliente.isNotEmpty
            ? item.nombreCliente
            : base.nombreCliente,
      );
      stableMeta[item.id] = updated;
      if (item.codigoCliente.isNotEmpty)
        stableMeta[item.codigoCliente] = updated;
    }
    return stableMeta;
  }

  static Future<RuteroOrderState> fetchOrderState({
    required String repartidorId,
    required String dateYmd,
  }) async {
    final response = await ApiClient.get(
      '/repartidor/rutero/order/$repartidorId',
      queryParameters: {'date': dateYmd},
    );
    return RuteroOrderState.fromJson(response);
  }

  static Future<RuteroOrderState> fetchOrder({
    required String repartidorId,
    required String dateYmd,
  }) =>
      fetchOrderState(repartidorId: repartidorId, dateYmd: dateYmd);

  static Future<RuteroOrderState> saveOrder({
    required String repartidorId,
    required String dateYmd,
    required String baseRevision,
    required List<Map<String, dynamic>> orden,
  }) async {
    final response = await ApiClient.put(
      '/repartidor/rutero/order/$repartidorId',
      data: {'date': dateYmd, 'baseRevision': baseRevision, 'orden': orden},
    );
    return RuteroOrderState.fromJson(response);
  }

  static Future<RuteroOptimizeResult> optimizeOrder({
    required String repartidorId,
    required String dateYmd,
    required List<Map<String, dynamic>> stops,
    RuteroRouteStrategy strategy = RuteroRouteStrategy.balanced,
    RuteroRouteOrigin? origin,
    required int departureMinute,
  }) async {
    final response = await ApiClient.post(
      '/repartidor/rutero/order/$repartidorId/optimize',
      {
        'date': dateYmd,
        'stops': stops,
        'strategy': strategy.wireValue,
        'departureMinute': departureMinute,
        if (origin != null) 'origin': origin.toJson(),
      },
    );
    final raw = response['orden'] as List<dynamic>? ?? const [];
    final orden = raw
        .whereType<Map>()
        .map((row) => RuteroStopWindow.fromJson(Map<String, dynamic>.from(row)))
        .toList(growable: false);
    final explanationRaw = response['explanation'];
    return RuteroOptimizeResult(
      orden: orden,
      algorithm: response['algorithm']?.toString(),
      departureLabel: response['departureLabel']?.toString(),
      explanation: explanationRaw is Map
          ? RuteroRouteExplanation.fromJson(
              Map<String, dynamic>.from(explanationRaw),
            )
          : null,
    );
  }

  static Future<List<RuteroStopWindow>> fetchStopsGeo({
    required String repartidorId,
    required String dateYmd,
    List<String> clientes = const [],
  }) async {
    final response = await ApiClient.get(
      '/repartidor/rutero/stops-geo/$repartidorId',
      queryParameters: <String, dynamic>{
        'date': dateYmd,
        if (clientes.isNotEmpty) 'clientes': clientes.join(','),
      },
    );
    final raw = response['stops'] as List<dynamic>? ?? const [];
    return raw
        .whereType<Map>()
        .map((row) => RuteroStopWindow.fromJson(Map<String, dynamic>.from(row)))
        .toList(growable: false);
  }
}
