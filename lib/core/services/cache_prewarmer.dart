/// Cache Pre-Warming Service
/// ==========================
/// Pre-loads critical data in background on app start
/// Ensures instant display on first navigation to any screen

import 'package:flutter/foundation.dart';
import '../cache/cache_service.dart';
import '../api/api_client.dart';
import '../providers/auth_provider.dart';

/// Service to pre-warm cache with critical data
class CachePreWarmer {
  static bool _hasPreWarmed = false;

  /// Pre-warm cache with essential data for the current user
  /// Call this after successful login
  static Future<void> preWarmCache(AuthProvider auth) async {
    if (_hasPreWarmed) return;
    
    final user = auth.currentUser;
    if (user == null) return;

    debugPrint('[CachePreWarmer] 🔥 Starting cache pre-warming...');
    final stopwatch = Stopwatch()..start();

    try {
      final vendorCodes = auth.vendedorCodes.join(',');
      final currentYear = DateTime.now().year;
      final currentMonth = DateTime.now().month;

      // Parallel pre-fetch of critical data
      await Future.wait([
        // Facturas data
        _preWarmFacturas(vendorCodes, currentYear, currentMonth),
        
        // Commissions data
        _preWarmCommissions(vendorCodes, currentYear),
        
        // Vendedores list (for directors)
        if (user.role == 'director') _preWarmVendedores(),
      ], eagerError: false);

      _hasPreWarmed = true;
      stopwatch.stop();
      debugPrint('[CachePreWarmer] ✅ Pre-warming completed in ${stopwatch.elapsedMilliseconds}ms');
    } catch (e) {
      debugPrint('[CachePreWarmer] ⚠️ Pre-warming failed (non-critical): $e');
    }
  }

  static Future<void> _preWarmFacturas(String vendorCodes, int year, int month) async {
    try {
      // Pre-fetch facturas list for current month
      await ApiClient.get(
        '/facturas?vendedorCodes=$vendorCodes&year=$year&month=$month',
        cacheKey: 'facturas_${vendorCodes}_${year}_${month}__',
        cacheTTL: CacheService.shortTTL,
      );
      
      // Pre-fetch available years
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
        queryParameters: {'vendedorCode': vendorCodes, 'year': year.toString()},
        cacheKey: 'commissions_${vendorCodes}_$year',
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

  /// Reset pre-warm state (call on logout)
  static void reset() {
    _hasPreWarmed = false;
    CacheService.clearMemoryCache();
    debugPrint('[CachePreWarmer] Reset');
  }
}
