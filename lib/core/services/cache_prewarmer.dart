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
import 'package:gmp_app_mobilidad/features/commissions/data/commissions_service.dart';
import 'package:gmp_app_mobilidad/features/objectives/data/objectives_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

/// Which endpoints a role may pre-warm. Jefe first-paint owns the radio;
/// catalogs wait until the dashboard matrix has had a chance to finish.
enum CachePrewarmTarget {
  facturas,
  clients,
  pedidosHeavy,
  pedidosCatalog,
  vendedores,
  ruteroWeek,
  commissions,
  objectivesEvolution,
  objectivesByClient,
  repartoWeek,
  repartoPendientes,
}

/// Dashboard completes this when `/dashboard/metrics` has painted (or 4 s).
/// CachePreWarmer and notification sync wait so they do not steal the radio.
class DashboardFirstPaintGate {
  DashboardFirstPaintGate._();

  static Completer<void>? _ready;
  static const Duration timeout = Duration(seconds: 4);

  static void open() {
    final current = _ready;
    if (current == null || current.isCompleted) {
      _ready = Completer<void>();
    }
  }

  static void markReady() {
    final current = _ready;
    if (current != null && !current.isCompleted) {
      current.complete();
    }
  }

  static Future<void> wait({Duration? timeout}) {
    final current = _ready;
    if (current == null || current.isCompleted) {
      return Future.value();
    }
    return current.future.timeout(
      timeout ?? DashboardFirstPaintGate.timeout,
      onTimeout: () {},
    );
  }

  @visibleForTesting
  static void reset() {
    final current = _ready;
    if (current != null && !current.isCompleted) {
      current.complete();
    }
    _ready = null;
  }
}

/// Service to pre-warm cache with critical data
class CachePreWarmer {
  static bool _hasPreWarmed = false;
  static int _warmGeneration = 0;
  static const int prewarmConcurrency = 2;

  @visibleForTesting
  static int debugMaxInFlight = 0;

  @visibleForTesting
  static List<CachePrewarmTarget> immediateTargets({
    required bool isJefeVentas,
    bool isRepartidor = false,
  }) {
    if (isJefeVentas && isRepartidor) {
      return const [
        CachePrewarmTarget.repartoWeek,
        CachePrewarmTarget.repartoPendientes,
      ];
    }
    if (isRepartidor || isJefeVentas) return const <CachePrewarmTarget>[];
    return const [
      CachePrewarmTarget.facturas,
      CachePrewarmTarget.clients,
      CachePrewarmTarget.pedidosHeavy,
      CachePrewarmTarget.pedidosCatalog,
      CachePrewarmTarget.ruteroWeek,
    ];
  }

  @visibleForTesting
  static List<CachePrewarmTarget> deferredJefeTargets() {
    return const [
      CachePrewarmTarget.objectivesEvolution,
      CachePrewarmTarget.objectivesByClient,
      CachePrewarmTarget.commissions,
      CachePrewarmTarget.vendedores,
      CachePrewarmTarget.pedidosCatalog,
    ];
  }

  /// Pre-warm cache with essential data for the current user
  /// Call this after successful login with auth state data
  static Future<void> preWarmCache({
    required List<String> vendedorCodes,
    required bool isJefeVentas,
    bool isRepartidor = false,
  }) async {
    if (_hasPreWarmed) return;
    final generation = _warmGeneration;

    if (isRepartidor && isJefeVentas) {
      debugPrint('[CachePreWarmer] JEFE REPARTO fleet pre-warm');
      try {
        await runWithConcurrency([
          _preWarmRepartoFleet,
        ], concurrency: 1);
        if (generation != _warmGeneration) return;
        _hasPreWarmed = true;
        debugPrint('[CachePreWarmer] JEFE REPARTO pre-warm completed');
      } catch (e) {
        debugPrint('[CachePreWarmer] JEFE REPARTO pre-warm failed: $e');
      }
      return;
    }

    if (isRepartidor) {
      debugPrint(
        '[CachePreWarmer] Skip commercial pre-warm in delivery session',
      );
      return;
    }

    await DashboardFirstPaintGate.wait();
    if (generation != _warmGeneration || _hasPreWarmed) return;

    if (isJefeVentas) {
      debugPrint('[CachePreWarmer] Deferred jefe hot-route pre-warm');
      try {
        final year = DateTime.now().year;
        await runWithConcurrency([
          () => _preWarmObjectivesEvolution(),
          () => _preWarmObjectivesByClient(),
          () => _preWarmCommissionsAll(),
          _preWarmVendedores,
          _preWarmPedidosFamilies,
          _preWarmPedidosBrands,
        ]);
        if (generation != _warmGeneration) return;
        _hasPreWarmed = true;
        debugPrint('[CachePreWarmer] Jefe hot-route pre-warm completed $year');
      } catch (e) {
        debugPrint('[CachePreWarmer] Jefe hot-route pre-warm failed: $e');
      }
      return;
    }

    if (vendedorCodes.isEmpty) return;

    debugPrint('[CachePreWarmer] Starting cache pre-warming...');
    try {
      final codes = vendedorCodes.join(',');
      final currentYear = DateTime.now().year;
      final currentMonth = DateTime.now().month;
      await runWithConcurrency([
        () => _preWarmFacturasList(codes, currentYear, currentMonth),
        () => _preWarmFacturasYears(codes),
        () => _preWarmClients(codes),
        _preWarmPedidosFamilies,
        _preWarmPedidosBrands,
        () => _preWarmPedidosOrders(codes),
        () => _preWarmPedidosStats(codes),
        () => _preWarmPedidosProducts(codes),
        () => _preWarmRuteroWeek(codes, currentYear, currentMonth),
      ]);

      if (generation != _warmGeneration) return;
      _hasPreWarmed = true;
      debugPrint('[CachePreWarmer] Pre-warming completed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Pre-warming failed (non-critical): $e');
    }
  }

  @visibleForTesting
  static Future<void> runWithConcurrency(
    List<Future<void> Function()> tasks, {
    int concurrency = prewarmConcurrency,
  }) async {
    if (tasks.isEmpty) return;
    final limit = concurrency < 1
        ? 1
        : (concurrency > tasks.length ? tasks.length : concurrency);
    var next = 0;
    var inFlight = 0;
    debugMaxInFlight = 0;

    Future<void> worker() async {
      while (true) {
        final index = next;
        next += 1;
        if (index >= tasks.length) return;
        inFlight += 1;
        if (inFlight > debugMaxInFlight) debugMaxInFlight = inFlight;
        try {
          await tasks[index]();
        } finally {
          inFlight -= 1;
        }
      }
    }

    await Future.wait(
      List<Future<void>>.generate(limit, (_) => worker()),
    );
  }

  static Future<void> _preWarmFacturasList(
    String vendorCodes,
    int year,
    int month,
  ) async {
    try {
      await ApiClient.get(
        '/facturas?vendedorCodes=$vendorCodes&year=$year&month=$month',
        cacheKey: 'facturas_${vendorCodes}_${year}_${month}_all___',
        cacheTTL: CacheService.shortTTL,
      );
      debugPrint('[CachePreWarmer] Facturas list pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Facturas list pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmFacturasYears(String vendorCodes) async {
    try {
      await ApiClient.get(
        '/facturas/years?vendedorCodes=$vendorCodes',
        cacheKey: 'facturas_years_$vendorCodes',
        cacheTTL: CacheService.longTTL,
      );
      debugPrint('[CachePreWarmer] Facturas years pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Facturas years pre-warm failed: $e');
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

  static Future<void> _preWarmPedidosFamilies() async {
    try {
      await PedidosService.getFamilies();
      debugPrint('[CachePreWarmer] Pedidos families pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Pedidos families pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmPedidosBrands() async {
    try {
      await PedidosService.getBrands();
      debugPrint('[CachePreWarmer] Pedidos brands pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Pedidos brands pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmPedidosOrders(String vendorCodes) async {
    try {
      await PedidosService.getOrders(vendedorCodes: vendorCodes, limit: 20);
      debugPrint('[CachePreWarmer] Pedidos orders pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Pedidos orders pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmPedidosStats(String vendorCodes) async {
    try {
      await PedidosService.getOrderStats(vendedorCodes: vendorCodes);
      debugPrint('[CachePreWarmer] Pedidos stats pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Pedidos stats pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmPedidosProducts(String vendorCodes) async {
    try {
      await PedidosService.getProducts(vendedorCodes: vendorCodes, limit: 50);
      debugPrint('[CachePreWarmer] Pedidos products pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Pedidos products pre-warm failed: $e');
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

  static Future<void> _preWarmObjectivesEvolution() async {
    try {
      final year = DateTime.now().year;
      await ObjectivesService.getEvolution(
        vendedorCodes: 'ALL',
        years: [year],
      );
      debugPrint('[CachePreWarmer] Objectives evolution ALL pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Objectives evolution pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmObjectivesByClient() async {
    try {
      final year = DateTime.now().year;
      await ObjectivesService.getByClient(
        vendedorCodes: 'ALL',
        years: [year],
        months: const [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        limit: 100,
      );
      debugPrint('[CachePreWarmer] Objectives by-client ALL pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Objectives by-client pre-warm failed: $e');
    }
  }

  static Future<void> _preWarmCommissionsAll() async {
    try {
      await CommissionsService.getSummary(vendedorCode: 'ALL');
      debugPrint('[CachePreWarmer] Commissions ALL pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] Commissions ALL pre-warm failed: $e');
    }
  }

  static String _isoDate(DateTime date) {
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '${date.year}-$month-$day';
  }

  static String? _fleetSelectorFrom(dynamic payload) {
    final list = payload is List
        ? payload
        : (payload is Map
            ? (payload['repartidores'] ??
                payload['data'] ??
                payload['items'] ??
                payload['codes'])
            : null);
    if (list is! List) return null;
    final codes = <String>{};
    for (final entry in list) {
      if (entry is String || entry is num) {
        final code = entry.toString().trim();
        if (code.isNotEmpty && code.toUpperCase() != 'ALL') codes.add(code);
        continue;
      }
      if (entry is Map) {
        final code = (entry['code'] ?? entry['codigo'] ?? entry['id'] ?? '')
            .toString()
            .trim();
        if (code.isNotEmpty && code.toUpperCase() != 'ALL') codes.add(code);
      }
    }
    if (codes.isEmpty || codes.length > 100) return null;
    return codes.take(80).join(',');
  }

  static Future<void> _preWarmRepartoFleet() async {
    try {
      final fleet = await ApiClient.get(
        '/auth/repartidores',
        cacheKey: 'auth:repartidores:prewarm',
        cacheTTL: CacheService.shortTTL,
      );
      final selector = _fleetSelectorFrom(fleet);
      if (selector == null || selector.isEmpty) {
        debugPrint(
            '[CachePreWarmer] JEFE REPARTO fleet empty; skip pendientes');
        return;
      }
      final today = _isoDate(DateTime.now());
      await ApiClient.get(
        '/repartidor/rutero/week/$selector?date=$today',
        cacheKey: 'reparto:week:$selector:$today',
        cacheTTL: CacheService.shortTTL,
      );
      await ApiClient.get(
        '/entregas/pendientes/$selector?date=$today&limit=80&offset=0',
        cacheKey: 'entregas:pendientes:prewarm:$selector:$today',
        cacheTTL: CacheService.shortTTL,
      );
      debugPrint('[CachePreWarmer] JEFE REPARTO week+pendientes pre-warmed');
    } catch (e) {
      debugPrint('[CachePreWarmer] JEFE REPARTO fleet pre-warm failed: $e');
    }
  }

  /// Reset pre-warm state (call on logout)
  static void reset() {
    _warmGeneration++;
    _hasPreWarmed = false;
    DashboardFirstPaintGate.reset();
    CacheService.clearMemoryCache();
    debugPrint('[CachePreWarmer] Reset');
  }

  /// Backward-compatible wrapper for older call sites.
  static Future<void> preWarmCacheForCodes(List<String> vendedorCodes) async {
    await preWarmCache(
      vendedorCodes: vendedorCodes,
      isJefeVentas: false,
      isRepartidor: false,
    );
  }
}
