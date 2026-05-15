/// Bolsa Comercial Service (Req #3)
/// =================================
/// Cliente API para `/api/bolsa/*`. Stateless, devuelve modelos tipados.
library;

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';

class BolsaService {
  static const _base = '/bolsa';

  /// GET /api/bolsa/:vendedorCode/status
  static Future<BolsaStatus> getStatus(String vendedorCode) async {
    final code = vendedorCode.trim();
    if (code.isEmpty) {
      throw ArgumentError('vendedorCode is required');
    }
    final response = await ApiClient.get('$_base/$code/status');
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
  }) async {
    final code = vendedorCode.trim();
    if (code.isEmpty) return [];
    final params = <String, dynamic>{'limit': limit.toString()};
    if (year != null) params['year'] = year.toString();
    if (month != null) params['month'] = month.toString();
    try {
      final response = await ApiClient.get(
        '$_base/$code/movements',
        queryParameters: params,
      );
      final list = response['movements'] as List? ?? [];
      return list
          .map((m) => BolsaMovimiento.fromJson(m as Map<String, dynamic>))
          .toList();
    } catch (e) {
      debugPrint('[BolsaService] getMovements error: $e');
      return [];
    }
  }

  /// PUT /api/bolsa/:vendedorCode/config (JEFE_VENTAS / ADMIN)
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
    if (response['success'] == true && response['bolsa'] is Map) {
      return BolsaStatus.fromJson(
        Map<String, dynamic>.from(response['bolsa'] as Map),
      );
    }
    throw Exception(
      response['error']?.toString() ?? 'Failed to update bolsa config',
    );
  }
}
