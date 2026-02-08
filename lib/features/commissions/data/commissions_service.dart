import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';

/// CommissionsService - OPTIMIZED with multi-layer caching
class CommissionsService {
  /// Get Commissions Summary - cached for 15 minutes
  static Future<Map<String, dynamic>> getSummary({
    required String vendedorCode, 
    dynamic year = 2026,
  }) async {
    try {
      final cacheKey = 'commissions_${vendedorCode}_$year';
      
      final response = await ApiClient.get(
        '/commissions/summary', 
        queryParameters: {
          'vendedorCode': vendedorCode,
          'year': year.toString(),
        },
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 15), // Commission data changes infrequently
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
        '/vendedores',
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
}
