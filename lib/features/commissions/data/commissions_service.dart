import 'dart:developer' as developer;
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
        'commissions_v17_paid_month_lock',
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
      if (result.data.containsKey('vendedores')) {
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
    int? month,
    int? quarter,
    double? generatedAmount,
    String? concept,
    String? observaciones,
    double? objetivoMes,
    double? ventaActual,
    double? ventasSobreObjetivo,
    bool setTotal = false,
  }) async {
    try {
      final payload = <String, dynamic>{
        'vendedorCode': vendedorCode,
        'year': year,
        'amount': amount,
        if (month != null) 'month': month,
        if (quarter != null) 'quarter': quarter,
        if (generatedAmount != null) 'generatedAmount': generatedAmount,
        if (concept != null) 'concept': concept,
        if (observaciones != null) 'observaciones': observaciones,
        if (objetivoMes != null) 'objetivoMes': objetivoMes,
        if (ventaActual != null) 'ventaActual': ventaActual,
        if (ventasSobreObjetivo != null)
          'ventasSobreObjetivo': ventasSobreObjetivo,
        'setTotal': setTotal,
      };
      final response = await OfflineAwareApi.post(
        '/commissions/pay',
        payload,
        syncType: 'pay_commission',
      );

      // Force cache clear for this vendor AND the ALL view after payment.
      // Each invalidateByPrefix is an O(n) scan of the cache box, so the old
      // per-version list (v7..v17 exact + prefix + legacy keys ≈ 51 scans per
      // payment) collapsed to the prefixes that can actually hold live entries:
      // v17 is the only summary key still written, v14 is pre-warmed, and
      // commissions_team_/comm:summary cover team pages. Exact-key invalidates
      // are redundant under their own prefix and were dropped.
      await Future.wait([
        CacheService.invalidateByPrefix('commissions_v17_paid_month_lock_'),
        CacheService.invalidateByPrefix('commissions_v16_client_scope_sales_'),
        CacheService.invalidateByPrefix(
          'commissions_v15_db2_commission_source_',
        ),
        CacheService.invalidateByPrefix('commissions_v14_final_sources_'),
        CacheService.invalidateByPrefix('commissions_team_'),
        CacheService.invalidateByPrefix('comm:summary:ALL'),
      ]);

      return response;
    } catch (e) {
      throw Exception('Error registrando pago: $e');
    }
  }
}
