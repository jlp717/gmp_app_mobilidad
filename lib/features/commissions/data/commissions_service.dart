import 'dart:developer' as developer;
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart';

/// CommissionsService - OPTIMIZED with multi-layer caching
class CommissionsService {
  /// Get Commissions Summary - cached for 15 minutes
  static Future<Map<String, dynamic>> getSummary({
    required String vendedorCode,
    dynamic year,
    bool forceRefresh = false,
  }) async {
    try {
      final resolvedYear = year ?? DateTime.now().year;
      // Bust cache when the commission sales payload changes.
      final cacheKey = [
        'commissions_v15_db2_commission_source',
        vendedorCode,
        resolvedYear,
      ].join('_');

      final result = await OfflineAwareApi.get(
        '/commissions/summary',
        queryParameters: {
          'vendedorCode': vendedorCode,
          'year': resolvedYear.toString(),
          if (forceRefresh) 'forceRefresh': 'true',
        },
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 15),
        forceRefresh: forceRefresh,
      );
      return result.data;
    } catch (e) {
      throw Exception('Error cargando comisiones: $e');
    }
  }

  /// Get Vendedores list - cached for 1 hour (rarely changes)
  static Future<List<dynamic>> getVendedores() async {
    try {
      const cacheKey = 'vendedores_list';

      final result = await OfflineAwareApi.get(
        '/rutero/vendedores',
        cacheKey: cacheKey,
        cacheTTL: CacheService.longTTL, // 24 hours - vendor list rarely changes
      );

      // Response is { period: {...}, vendedores: [...] }
      if (result.data is Map && result.data.containsKey('vendedores')) {
        return result.data['vendedores'] as List<dynamic>;
      }
      return [];
    } catch (e) {
      developer.log('Error loading vendors: $e', name: 'commissions');
      return [];
    }
  }

  /// Team commission breakdown for commercial lead (e.g. 80 — Almería)
  static Future<Map<String, dynamic>> getTeamCommission({
    required String leaderCode,
    int? year,
    bool forceRefresh = false,
  }) async {
    try {
      final y = year ?? DateTime.now().year;
      final cacheKey = 'commissions_team_${leaderCode}_$y';
      final result = await OfflineAwareApi.get(
        '/commissions/team/$leaderCode',
        queryParameters: {
          'year': y.toString(),
          if (forceRefresh) 'forceRefresh': 'true',
        },
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 15),
        forceRefresh: forceRefresh,
      );
      return Map<String, dynamic>.from(result.data as Map);
    } catch (e) {
      throw Exception('Error cargando comision de equipo: $e');
    }
  }

  /// Register a commission payment (Restricted to ADMIN users via TIPOVENDEDOR)
  /// NEW: Now includes observaciones parameter.
  /// Required if amount < generatedAmount.
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
      final response = await OfflineAwareApi.post(
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
        syncType: 'pay_commission',
      );

      // Force cache clear for this vendor AND the ALL view after payment
      await Future.wait([
        CacheService.invalidate(
          'commissions_v15_db2_commission_source_${vendedorCode}_$year',
        ),
        CacheService.invalidate('commissions_v15_db2_commission_source_ALL_$year'),
        CacheService.invalidateByPrefix('commissions_v15_db2_commission_source_'),
        CacheService.invalidate(
          'commissions_v14_final_sources_${vendedorCode}_$year',
        ),
        CacheService.invalidate('commissions_v14_final_sources_ALL_$year'),
        CacheService.invalidateByPrefix('commissions_v14_final_sources_'),
        CacheService.invalidate(
          'commissions_v13_stable_sources_${vendedorCode}_$year',
        ),
        CacheService.invalidate('commissions_v13_stable_sources_ALL_$year'),
        CacheService.invalidateByPrefix('commissions_v13_stable_sources_'),
        CacheService.invalidate(
          'commissions_v12_monthly_paid_lock_${vendedorCode}_$year',
        ),
        CacheService.invalidate('commissions_v12_monthly_paid_lock_ALL_$year'),
        CacheService.invalidateByPrefix('commissions_v12_monthly_paid_lock_'),
        CacheService.invalidate(
          'commissions_v11_paid_target_fix_${vendedorCode}_$year',
        ),
        CacheService.invalidate('commissions_v11_paid_target_fix_ALL_$year'),
        CacheService.invalidateByPrefix('commissions_v11_paid_target_fix_'),
        CacheService.invalidate(
          'commissions_v10_sales_breakdown_${vendedorCode}_$year',
        ),
        CacheService.invalidate('commissions_v10_sales_breakdown_ALL_$year'),
        CacheService.invalidateByPrefix('commissions_v10_sales_breakdown_'),
        CacheService.invalidate('commissions_v9_team80_${vendedorCode}_$year'),
        CacheService.invalidate('commissions_v9_team80_ALL_$year'),
        CacheService.invalidateByPrefix('commissions_v9_team80_'),
        CacheService.invalidate('commissions_v8_team80_${vendedorCode}_$year'),
        CacheService.invalidate('commissions_v8_team80_ALL_$year'),
        CacheService.invalidateByPrefix('commissions_v8_team80_'),
        CacheService.invalidate('commissions_v7_team80_${vendedorCode}_$year'),
        CacheService.invalidate('commissions_v7_team80_ALL_$year'),
        CacheService.invalidateByPrefix('commissions_v7_team80_'),
        CacheService.invalidateByPrefix('commissions_team_'),
        CacheService.invalidate('commissions_v5_r1_${vendedorCode}_$year'),
        CacheService.invalidate('commissions_v4_r1_${vendedorCode}_$year'),
        CacheService.invalidate('commissions_v3_${vendedorCode}_$year'),
        CacheService.invalidate('commissions_v2_${vendedorCode}_$year'),
        CacheService.invalidateByPrefix('comm:summary:ALL'),
      ]);

      return response;
    } catch (e) {
      throw Exception('Error registrando pago: $e');
    }
  }
}
