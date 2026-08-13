/// Models + thin API client for rutero optimize / stops-geo.
library;

import 'package:gmp_app_mobilidad/core/api/api_client.dart';

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
  });

  factory RuteroStopWindow.fromJson(Map<String, dynamic> json) {
    double? asDouble(dynamic value) {
      if (value == null) return null;
      if (value is num) return value.toDouble();
      return double.tryParse(value.toString());
    }

    int? asInt(dynamic value) {
      if (value == null) return null;
      if (value is num) return value.toInt();
      return int.tryParse(value.toString());
    }

    return RuteroStopWindow(
      documentId: (json['documentId'] ?? '').toString(),
      cliente: (json['cliente'] ?? json['codigoCliente'] ?? '').toString(),
      posicion: asInt(json['posicion']),
      preferredMinute: asInt(json['preferredMinute']),
      windowLabel: json['windowLabel']?.toString(),
      observaciones: json['observaciones']?.toString(),
      closedDay: json['closedDay'] == true,
      lat: asDouble(json['lat']),
      lng: asDouble(json['lng']),
      hasGps: json['hasGps'] == true ||
          (asDouble(json['lat']) != null && asDouble(json['lng']) != null),
      nombreCliente: json['nombreCliente']?.toString(),
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

  String get observacionesSnippet {
    final text = (observaciones ?? '').trim();
    if (text.isEmpty) return '';
    return text.length <= 48 ? text : '${text.substring(0, 48)}…';
  }
}

class RuteroRouteApi {
  const RuteroRouteApi._();

  static Future<List<RuteroStopWindow>> optimizeOrder({
    required String repartidorId,
    required String dateYmd,
    required List<Map<String, dynamic>> stops,
  }) async {
    final response = await ApiClient.post(
      '/repartidor/rutero/order/$repartidorId/optimize',
      {
        'date': dateYmd,
        'stops': stops,
      },
    );
    final raw = response['orden'] as List<dynamic>? ?? const [];
    return raw
        .whereType<Map>()
        .map((row) => RuteroStopWindow.fromJson(Map<String, dynamic>.from(row)))
        .toList(growable: false);
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
