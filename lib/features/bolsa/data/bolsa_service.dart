/// Bolsa Comercial Service (Req #3)
/// =================================
/// Cliente API para `/api/bolsa/*`. Stateless, devuelve modelos tipados.
library;

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';

class BolsaService {
  static const _base = '/bolsa';

  /// GET /api/bolsa/:vendedorCode/status
  static Future<BolsaStatus> getStatus(
    String vendedorCode, {
    int? year,
    int? month,
    bool forceRefresh = false,
  }) async {
    final code = vendedorCode.trim();
    if (code.isEmpty) {
      throw ArgumentError('vendedorCode is required');
    }
    final params = <String, dynamic>{};
    if (year != null) params['year'] = year.toString();
    if (month != null) params['month'] = month.toString();
    if (forceRefresh) {
      params['_ts'] = DateTime.now().millisecondsSinceEpoch.toString();
    }
    final response = await ApiClient.get(
      '$_base/$code/status',
      queryParameters: params,
      cacheKey: 'bolsa:status:$code:${year ?? 'current'}:${month ?? 'current'}',
      cacheTTL: CacheService.realtimeTTL,
      forceRefresh: forceRefresh,
    );
    final raw = response['bolsa'];
    if (raw is Map<String, dynamic>) {
      return BolsaStatus.fromJson(raw);
    }
    return BolsaStatus(
      vendedor: code,
      ejercicio: DateTime.now().year,
      mes: DateTime.now().month,
    );
  }

  /// GET /api/bolsa/:vendedorCode/movements
  static Future<List<BolsaMovimiento>> getMovements(
    String vendedorCode, {
    int? year,
    int? month,
    int limit = 50,
    DateTime? dateFrom,
    DateTime? dateTo,
    String? documentQuery,
    String? clientQuery,
    BolsaMovimientoTipo? tipo,
    bool forceRefresh = false,
  }) async {
    final code = vendedorCode.trim();
    if (code.isEmpty) return [];
    final params = <String, dynamic>{'limit': limit.toString()};
    if (year != null) params['year'] = year.toString();
    if (month != null) params['month'] = month.toString();
    if (dateFrom != null) params['dateFrom'] = _dateKey(dateFrom);
    if (dateTo != null) params['dateTo'] = _dateKey(dateTo);
    final document = documentQuery?.trim();
    if (document != null && document.isNotEmpty) params['document'] = document;
    final client = clientQuery?.trim();
    if (client != null && client.isNotEmpty) params['client'] = client;
    if (tipo != null) params['tipo'] = _tipoKey(tipo);
    if (forceRefresh) {
      params['_ts'] = DateTime.now().millisecondsSinceEpoch.toString();
    }
    final filterKey = [
      year ?? 'all',
      month ?? 'all',
      limit,
      if (dateFrom == null) '' else _dateKey(dateFrom),
      if (dateTo == null) '' else _dateKey(dateTo),
      document ?? '',
      client ?? '',
      if (tipo == null) '' else _tipoKey(tipo),
    ].join(':');
    try {
      final response = await ApiClient.get(
        '$_base/$code/movements',
        queryParameters: params,
        cacheKey: 'bolsa:movements:$code:$filterKey',
        cacheTTL: CacheService.realtimeTTL,
        forceRefresh: forceRefresh,
      );
      final list = response['movements'] as List? ?? [];
      return list
          .map(
            (m) => BolsaMovimiento.fromJson(
              Map<String, dynamic>.from(m as Map),
            ),
          )
          .toList();
    } catch (e) {
      debugPrint('[BolsaService] getMovements error: $e');
      rethrow;
    }
  }

  /// GET /api/bolsa/:vendedorCode/history?months=12
  static Future<List<BolsaMonthlyPoint>> getHistory(
    String vendedorCode, {
    int months = 12,
    int? year,
    int? month,
    bool forceRefresh = false,
  }) async {
    final code = vendedorCode.trim();
    if (code.isEmpty) return [];
    final params = <String, dynamic>{'months': months.toString()};
    if (year != null) params['year'] = year.toString();
    if (month != null) params['month'] = month.toString();
    if (forceRefresh) {
      params['_ts'] = DateTime.now().millisecondsSinceEpoch.toString();
    }
    try {
      final response = await ApiClient.get(
        '$_base/$code/history',
        queryParameters: params,
        cacheKey:
            'bolsa:history:$code:$months:${year ?? 'current'}:${month ?? 'current'}',
        cacheTTL: CacheService.shortTTL,
        forceRefresh: forceRefresh,
      );
      final list = response['points'] as List? ?? [];
      return list
          .map((p) => BolsaMonthlyPoint.fromJson(p as Map<String, dynamic>))
          .toList();
    } catch (e) {
      debugPrint('[BolsaService] getHistory error: $e');
      rethrow;
    }
  }

  /// GET /api/bolsa/grouped (JEFE_VENTAS)
  static Future<BolsaGroupedSummary> getGroupedStatus({
    int? year,
    int? month,
    List<String>? vendedorCodes,
    bool forceRefresh = false,
  }) async {
    final params = <String, dynamic>{};
    if (year != null) params['year'] = year.toString();
    if (month != null) params['month'] = month.toString();
    final codes = (vendedorCodes ?? const <String>[])
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty && code.toUpperCase() != 'ALL')
        .toList(growable: false);
    if (codes.isNotEmpty) params['vendedorCodes'] = codes.join(',');
    if (forceRefresh) {
      params['_ts'] = DateTime.now().millisecondsSinceEpoch.toString();
    }

    final response = await ApiClient.get(
      '$_base/grouped',
      queryParameters: params,
      cacheKey:
          'bolsa:grouped:${year ?? 'current'}:${month ?? 'current'}:${codes.join(',')}',
      cacheTTL: CacheService.realtimeTTL,
      forceRefresh: forceRefresh,
    );
    return BolsaGroupedSummary.fromJson(response);
  }

  /// PUT /api/bolsa/:vendedorCode/config (JEFE_VENTAS)
  static Future<BolsaStatus> updateConfig(
    String vendedorCode, {
    double? limitePct,
    double? limiteImporte,
    int? year,
    int? month,
  }) async {
    final code = vendedorCode.trim();
    if (code.isEmpty) {
      throw ArgumentError('vendedorCode is required');
    }
    final body = <String, dynamic>{};
    if (limitePct != null) body['limitePct'] = limitePct;
    if (limiteImporte != null) body['limiteImporte'] = limiteImporte;
    if (year != null) body['year'] = year;
    if (month != null) body['month'] = month;

    final response = await ApiClient.put('$_base/$code/config', data: body);
    await CacheService.invalidateByPrefix('bolsa:status:$code');
    await CacheService.invalidateByPrefix('bolsa:movements:$code:');
    await CacheService.invalidateByPrefix('bolsa:history:$code:');
    await CacheService.invalidateByPrefix('bolsa:grouped:');
    if (response['success'] == true && response['bolsa'] is Map) {
      return BolsaStatus.fromJson(
        Map<String, dynamic>.from(response['bolsa'] as Map),
      );
    }
    throw Exception(
      response['error']?.toString() ?? 'Failed to update bolsa config',
    );
  }

  static String _dateKey(DateTime date) {
    final y = date.year.toString().padLeft(4, '0');
    final m = date.month.toString().padLeft(2, '0');
    final d = date.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  static String _tipoKey(BolsaMovimientoTipo tipo) {
    switch (tipo) {
      case BolsaMovimientoTipo.acumulacion:
        return 'ACUMULACION';
      case BolsaMovimientoTipo.consumo:
        return 'CONSUMO';
      case BolsaMovimientoTipo.ajuste:
        return 'AJUSTE';
      case BolsaMovimientoTipo.desconocido:
        return '';
    }
  }
}
