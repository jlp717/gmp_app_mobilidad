/// Cache Pre-Warming Service
/// ==========================
/// Pre-loads critical data in background on app start
/// Ensures instant display on first navigation to any screen
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';

/// Service to pre-warm cache with critical data
class CachePreWarmer {
  static bool _hasPreWarmed = false;

  /// Pre-warm cache with essential data for the current user
  /// Call this after successful login with auth state data
  static Future<void> preWarmCache({
    required List<String> vendedorCodes,
    required bool isJefeVentas,
  }) async {
    if (_hasPreWarmed) return;
    if (vendedorCodes.isEmpty) return;

    debugPrint('[CachePreWarmer] Starting cache pre-warming...');
    try {
      final codes = vendedorCodes.join(',');
      final currentYear = DateTime.now().year;
      final currentMonth = DateTime.now().month;
      final commissionsTarget = isJefeVentas ? 'ALL' : codes;

      await Future.wait([
        _preWarmFacturas(codes, currentYear, currentMonth),
        if (isJefeVentas) _preWarmVendedores(),
        _preWarmRuteroWeek(codes, currentYear, currentMonth),
      ]);

      // Warm commissions slightly later for manager sessions. This avoids
      // competing with the first render and uses the backend's aggregate path.
      unawaited(
        Future<void>.delayed(const Duration(seconds: 2), () async {
          try {
            await _preWarmCommissions(commissionsTarget, currentYear);
          } catch (e) {
            debugPrint(
              '[CachePreWarmer] Delayed commissions pre-warm failed: $e',
            );
          }
        }),
      );

      _hasPreWarmed = true;
      debugPrint('[CachePreWarmer] Pre-warming completed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Pre-warming failed (non-critical): $e');
    }
  }

  static Future<void> _preWarmFacturas(
    String vendorCodes,
    int year,
    int month,
  ) async {
    try {
      // Match the exact cache key pattern used by facturas service.
      await ApiClient.get(
        '/facturas?vendedorCodes=$vendorCodes&year=$year&month=$month',
        cacheKey: 'facturas_${vendorCodes}_${year}_${month}_all___',
        cacheTTL: CacheService.shortTTL,
      );

      await ApiClient.get(
        '/facturas/years?vendedorCodes=$vendorCodes',
        cacheKey: 'facturas_years_$vendorCodes',
        cacheTTL: CacheService.longTTL,
      );

      debugPrint('[CachePreWarmer] Facturas pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Facturas pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmCommissions(String vendorCodes, int year) async {
    try {
      await ApiClient.get(
        '/commissions/summary',
        queryParameters: {
          'vendedorCode': vendorCodes,
          'year': year.toString(),
        },
        cacheKey: 'commissions_v2_${vendorCodes}_$year',
        cacheTTL: const Duration(minutes: 15),
      );
      debugPrint('[CachePreWarmer] Commissions pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Commissions pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmVendedores() async {
    try {
      await ApiClient.get(
        '/vendedores',
        cacheKey: 'vendedores_list',
        cacheTTL: CacheService.longTTL,
      );
      debugPrint('[CachePreWarmer] Vendedores pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Vendedores pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmRuteroWeek(
    String vendorCodes,
    int year,
    int month,
  ) async {
    try {
      await ApiClient.get(
        '/rutero/week',
        queryParameters: {
          'vendedorCodes': vendorCodes,
          'role': 'comercial',
          'year': year.toString(),
          'month': month.toString(),
        },
        cacheKey: 'rutero:week:$vendorCodes:$year:$month',
        cacheTTL: CacheService.shortTTL,
      );
      debugPrint('[CachePreWarmer] Rutero week pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Rutero week pre-warm failed: $e');
    }
  }

  /// Reset pre-warm state (call on logout)
  static void reset() {
    _hasPreWarmed = false;
    CacheService.clearMemoryCache();
    debugPrint('[CachePreWarmer] Reset');
  }

  /// Backward-compatible wrapper for older call sites.
  static Future<void> preWarmCacheForCodes(List<String> vendedorCodes) async {
    await preWarmCache(vendedorCodes: vendedorCodes, isJefeVentas: false);
  }
}
