/// Cache Pre-Warming Service
/// ==========================
/// Pre-loads critical data in background on app start
/// Ensures instant display on first navigation to any screen
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/features/clients/data/clients_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

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
      await Future.wait([
        _preWarmFacturas(codes, currentYear, currentMonth),
        _preWarmClients(codes),
        _preWarmPedidos(codes),
        if (isJefeVentas) _preWarmVendedores(),
        _preWarmRuteroWeek(codes, currentYear, currentMonth),
      ]);

      // Manager ALL commissions are intentionally not pre-warmed: the cold query
      // competes with objectives/rutero and can exhaust the DB pool.
      if (!isJefeVentas) {
        unawaited(
          Future<void>.delayed(const Duration(seconds: 2), () async {
            try {
              await _preWarmCommissions(codes, currentYear);
            } catch (e) {
              debugPrint(
                '[CachePreWarmer] Delayed commissions pre-warm failed: $e',
              );
            }
          }),
        );
      }

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
        cacheKey: 'commissions_v14_final_sources_${vendorCodes}_$year',
        cacheTTL: const Duration(minutes: 15),
      );
      debugPrint('[CachePreWarmer] Commissions pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Commissions pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmClients(String vendorCodes) async {
    try {
      await ClientsService.getClientsList(
        vendedorCodes: vendorCodes,
        limit: 100,
      );
      debugPrint('[CachePreWarmer] Clients pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Clients pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmPedidos(String vendorCodes) async {
    try {
      await Future.wait([
        PedidosService.getFamilies(),
        PedidosService.getBrands(),
        PedidosService.getOrders(vendedorCodes: vendorCodes, limit: 20),
        PedidosService.getOrderStats(vendedorCodes: vendorCodes),
        PedidosService.getProducts(vendedorCodes: vendorCodes, limit: 50),
      ]);
      debugPrint('[CachePreWarmer] Pedidos pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Pedidos pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmVendedores() async {
    try {
      await ApiClient.get(
        '/rutero/vendedores',
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
