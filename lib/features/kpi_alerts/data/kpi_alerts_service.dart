// kpi_alerts_service.dart: Servicio de alertas KPI Glacius para Flutter
// Usa ApiClient (Dio) para consistencia con el resto de la app

import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';

/// Modelo de alerta KPI
class KpiAlert {
  /// Creates a KPI alert instance.
  KpiAlert({
    required this.id,
    required this.clientCode,
    required this.type,
    required this.severity,
    required this.message,
    this.rawData,
    required this.sourceFile,
    required this.createdAt,
    this.typeExplanation = '',
    this.title = '',
    this.summary = '',
    this.detail = '',
    this.actions = const [],
    this.meta,
    this.uiHint,
  });

  factory KpiAlert.fromJson(Map<String, dynamic> json) {
    return KpiAlert(
      id: (json['id'] as int?) ?? 0,
      clientCode: json['clientCode']?.toString() ?? '',
      type: json['type']?.toString() ?? '',
      severity: json['severity']?.toString() ?? 'info',
      message: json['message']?.toString() ?? '',
      rawData: json['rawData'] is Map
          ? Map<String, dynamic>.from(json['rawData'] as Map)
          : null,
      sourceFile: json['sourceFile']?.toString() ?? '',
      createdAt: DateTime.tryParse(
            json['createdAt']?.toString() ?? '',
          ) ??
          DateTime.now(),
      typeExplanation: json['typeExplanation']?.toString() ?? '',
      // Compact fields from alert_transformer
      title: json['title']?.toString() ?? '',
      summary: json['summary']?.toString() ?? '',
      detail: json['detail']?.toString() ?? '',
      actions: (json['actions'] is List)
          ? List<String>.from(
              (json['actions'] as List).map((a) => a.toString()))
          : const [],
      meta: json['meta'] is Map
          ? Map<String, dynamic>.from(json['meta'] as Map)
          : null,
      uiHint: json['ui_hint'] is Map
          ? Map<String, dynamic>.from(json['ui_hint'] as Map)
          : null,
    );
  }

  final int id;
  final String clientCode;
  final String type;
  final String severity; // critical, warning, info
  final String message;
  final Map<String, dynamic>? rawData;
  final String sourceFile;
  final DateTime createdAt;
  final String typeExplanation;

  // Compact fields (from alert_transformer.js)
  final String title;      // Max 6 words, e.g. "Ventas < objetivo"
  final String summary;    // 1-2 lines, action-oriented
  final String detail;     // Collapsible, 1-4 lines
  final List<String> actions; // e.g. ["Revisar surtido", "Ofrecer helados"]
  final Map<String, dynamic>? meta; // { lastPurchase, amount, target, ... }
  final Map<String, dynamic>? uiHint; // { color, icon }

  /// Whether compact fields are available from the API
  bool get hasCompactFields => summary.isNotEmpty;

  /// Prioridad numérica para ordenación (menor = más urgente)
  int get priorityOrder {
    switch (severity) {
      case 'critical':
        return 0;
      case 'warning':
        return 1;
      case 'info':
        return 2;
      default:
        return 3;
    }
  }

  /// Etiqueta legible según tipo de alerta
  String get typeLabel {
    switch (type) {
      case 'DESVIACION_VENTAS':
        return 'Ventas vs Objetivo';
      case 'CUOTA_SIN_COMPRA':
        return 'Sin Compras';
      case 'DESVIACION_REFERENCIACION':
        return 'Productos Pendientes';
      case 'PROMOCION':
        return 'Promociones';
      case 'ALTA_CLIENTE':
        return 'Cliente Nuevo';
      case 'AVISO':
        return 'Avisos';
      case 'MEDIOS_CLIENTE':
        return 'Equipamiento';
      default:
        return type;
    }
  }
}

/// Servicio singleton para obtener alertas KPI desde el backend.
/// Usa ApiClient (Dio) — hereda auth, base URL, retries.
class KpiAlertsService {
  KpiAlertsService._();
  static final KpiAlertsService _instance = KpiAlertsService._();

  /// Singleton instance
  static KpiAlertsService get instance => _instance;

  // Cache local en memoria por clientId
  final Map<String, _CacheEntry> _cache = {};
  static const Duration _cacheTTL = Duration(minutes: 10);

  // Polling timer
  Timer? _pollTimer;

  /// Obtiene alertas para un cliente (cache-first)
  Future<List<KpiAlert>> getClientAlerts(
    String clientId, {
    bool forceRefresh = false,
  }) async {
    if (!forceRefresh && _cache.containsKey(clientId)) {
      final entry = _cache[clientId]!;
      if (DateTime.now().difference(entry.timestamp) < _cacheTTL) {
        return entry.alerts;
      }
    }

    try {
      final data = await ApiClient.get(
        '${ApiConfig.kpiAlerts}/client/$clientId',
      );

      if (data['success'] == true) {
        final alertsJson = List<Map<String, dynamic>>.from(
          (data['alerts'] as List?)?.map(
                (a) => Map<String, dynamic>.from(a as Map),
              ) ??
              [],
        );
        final alerts = alertsJson
            .map(KpiAlert.fromJson)
            .toList()
          ..sort(
            (a, b) =>
                a.priorityOrder.compareTo(b.priorityOrder),
          );

        _cache[clientId] = _CacheEntry(
          alerts: alerts,
          timestamp: DateTime.now(),
        );
        return alerts;
      }

      return _cache[clientId]?.alerts ?? [];
    } catch (e) {
      debugPrint('[KpiAlerts] Error for $clientId: $e');
      return _cache[clientId]?.alerts ?? [];
    }
  }

  /// Obtiene resumen global de alertas
  Future<Map<String, dynamic>?> getAlertsSummary() async {
    try {
      final data = await ApiClient.get(
        '${ApiConfig.kpiAlerts}/summary',
      );
      if (data['success'] == true) return data;
    } catch (e) {
      debugPrint('[KpiAlerts] Error fetching summary: $e');
    }
    return null;
  }

  /// Obtiene una lista de códigos de clientes que tienen alertas activas,
  /// permitiendo filtrar por tipo de alerta y/o severidad.
  Future<List<String>> getClientsWithAlerts({
    String? vendedorCodes,
    String? type,
    String? severity,
  }) async {
    try {
      final params = <String, dynamic>{};
      if (vendedorCodes != null && vendedorCodes.isNotEmpty) {
        params['vendedorCodes'] = vendedorCodes;
      }
      if (type != null && type.isNotEmpty && type != 'ALL') {
        params['type'] = type;
      }
      if (severity != null && severity.isNotEmpty && severity != 'ALL') {
        params['severity'] = severity;
      }

      final response = await ApiClient.get(
        '${ApiConfig.kpiAlerts}/clients',
        queryParameters: params,
      );

      if (response['success'] == true) {
        final codes = List<String>.from(response['clientCodes'] ?? []);
        return codes;
      }
    } catch (e) {
      debugPrint('[KpiAlerts] Error fetching clients with alerts: $e');
    }
    return [];
  }

  /// Inicia polling periódico para un cliente
  void startPolling(
    String clientId, {
    Duration interval = const Duration(minutes: 2),
    void Function(List<KpiAlert>)? onUpdate,
  }) {
    stopPolling();
    _pollTimer = Timer.periodic(interval, (_) async {
      final alerts = await getClientAlerts(
        clientId,
        forceRefresh: true,
      );
      onUpdate?.call(alerts);
    });
  }

  /// Detiene el polling
  void stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  /// Invalida cache para un cliente
  void invalidateCache(String clientId) {
    _cache.remove(clientId);
  }

  /// Invalida toda la cache local
  void invalidateAllCache() {
    _cache.clear();
  }
}

class _CacheEntry {
  _CacheEntry({required this.alerts, required this.timestamp});

  final List<KpiAlert> alerts;
  final DateTime timestamp;
}
