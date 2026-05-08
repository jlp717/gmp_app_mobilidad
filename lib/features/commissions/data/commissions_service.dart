import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';

/// CommissionsService - OPTIMIZED with multi-layer caching
class CommissionsService {
  /// Get Commissions Summary - cached for 15 minutes
  static Future<Map<String, dynamic>> getSummary({
    required String vendedorCode,
    dynamic year = 2026,
    bool forceRefresh = false,
  }) async {
    try {
      // v5 busts cache after making assignment-based R1 the backend default.
      final cacheKey = 'commissions_v5_r1_${vendedorCode}_$year';

      final response = await ApiClient.get(
        '/commissions/summary',
        queryParameters: {
          'vendedorCode': vendedorCode,
          'year': year.toString(),
          if (forceRefresh) 'forceRefresh': 'true',
        },
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 15),
        forceRefresh: forceRefresh,
        // ALL-vendor query can take up to 60s on first call (no cache)
        receiveTimeout: const Duration(seconds: 120),
      );
      return response;
    } catch (e) {
      throw Exception('Error cargando comisiones: $e');
    }
  }

  /// Get Vendedores list - cached for 1 hour (rarely changes)
  static Future<List<dynamic>> getVendedores() async {
    try {
      const cacheKey = 'vendedores_list';

      final response = await ApiClient.get(
        '/rutero/vendedores',
        cacheKey: cacheKey,
        cacheTTL: CacheService.longTTL, // 24 hours - vendor list rarely changes
      );

      // Response is { period: {...}, vendedores: [...] }
      if (response is Map && response.containsKey('vendedores')) {
        return response['vendedores'] as List<dynamic>;
      }
      return [];
    } catch (e) {
      print('Error loading vendors: $e');
      return [];
    }
  }

  /// Register a commission payment (Restricted to ADMIN users via TIPOVENDEDOR)
  /// NEW: Now includes observaciones parameter (required if amount < generatedAmount)
  static Future<Map<String, dynamic>> payCommission({
    required String vendedorCode,
    required int year,
    required double amount,
    required String adminCode,
    int? month,
    int? quarter,
    double? generatedAmount,
    String? concept,
    String? observaciones,
    double? objetivoMes,
    double? ventaActual,
    double? ventasSobreObjetivo,
  }) async {
    try {
      final response = await ApiClient.post(
        '/commissions/pay',
        {
          'vendedorCode': vendedorCode,
          'year': year,
          'month': month ?? 0,
          'quarter': quarter ?? 0,
          'amount': amount,
          'generatedAmount': generatedAmount ?? 0,
          'concept': concept,
          'adminCode': adminCode,
          'observaciones': observaciones,
          'objetivoMes': objetivoMes ?? 0,
          'ventaActual': ventaActual ?? 0,
          'ventasSobreObjetivo': ventasSobreObjetivo ?? 0,
        },
      );

      // Force cache clear for this vendor AND the ALL view after payment
      CacheService.invalidate('commissions_v5_r1_${vendedorCode}_$year');
      CacheService.invalidate('commissions_v4_r1_${vendedorCode}_$year');
      CacheService.invalidate('commissions_v3_${vendedorCode}_$year');
      CacheService.invalidate('commissions_v2_${vendedorCode}_$year');
      CacheService.invalidateByPrefix('comm:summary:ALL');

      return response;
    } catch (e) {
      throw Exception('Error registrando pago: $e');
    }
  }
}
