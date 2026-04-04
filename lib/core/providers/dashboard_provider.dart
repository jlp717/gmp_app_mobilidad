import 'package:flutter/foundation.dart';
import '../api/api_client.dart';
import '../api/api_config.dart';
import '../models/dashboard_models.dart';
import '../cache/cache_service.dart';

/// Dashboard Riverpod-style provider (async state management)
/// Migration target: Replace with Riverpod AsyncNotifier in v5
class DashboardProvider with ChangeNotifier {
  final List<String> _vendedorCodes;
  final bool isJefeVentas;

  int _selectedYear;
  int _selectedMonth;

  DashboardMetrics? _metrics;
  List<RecentSale> _recentSales = [];
  List<SalesEvolutionPoint> _salesEvolution = [];
  YoYComparison? _yoyComparison;
  List<TopProduct> _topProducts = [];
  List<TopClient> _topClients = [];
  bool _isLoading = false;
  bool _isRefreshing = false;
  String? _error;

  // Cache layer for JEFE DE VENTAS optimization
  static final Map<String, DashboardCacheEntry> _cache = {};
  static const Duration _cacheTtlJefe = Duration(seconds: 30);
  static const Duration _cacheTtlComercial = Duration(minutes: 2);
  static const Duration _cacheTtlRepartidor = Duration(minutes: 1);

  DashboardProvider(
    this._vendedorCodes, {
    this.isJefeVentas = false,
    int? year,
    int? month,
  }) : _selectedYear = year ?? DateTime.now().year,
       _selectedMonth = month ?? DateTime.now().month;

  List<String> get vendedorCodes => List.unmodifiable(_vendedorCodes);
  DashboardMetrics? get metrics => _metrics;
  List<RecentSale> get recentSales => _recentSales;
  List<SalesEvolutionPoint> get salesEvolution => _salesEvolution;
  YoYComparison? get yoyComparison => _yoyComparison;
  List<TopProduct> get topProducts => _topProducts;
  List<TopClient> get topClients => _topClients;
  bool get isLoading => _isLoading;
  bool get isRefreshing => _isRefreshing;
  String? get error => _error;
  int get selectedYear => _selectedYear;
  int get selectedMonth => _selectedMonth;

  bool get hasData =>
      _metrics != null || _recentSales.isNotEmpty || _salesEvolution.isNotEmpty;
  bool get hasCache => _isCacheValid();

  Duration get _cacheTtl {
    if (isJefeVentas && _vendedorCodes.contains('ALL')) return _cacheTtlJefe;
    if (isJefeVentas) return Duration(minutes: 1);
    return _cacheTtlComercial;
  }

  String get _cacheKey =>
      '${_vendedorCodes.join(',')}_${_selectedYear}_${_selectedMonth}';

  bool _isCacheValid() {
    final entry = _cache[_cacheKey];
    if (entry == null) return false;
    return DateTime.now().difference(entry.timestamp) < _cacheTtl;
  }

  void updateVendedorCodes(List<String> newCodes) {
    if (newCodes.join(',') != _vendedorCodes.join(',')) {
      _vendedorCodes.clear();
      _vendedorCodes.addAll(newCodes);
      fetchDashboardData();
    }
  }

  void updateDateFilter(int year, int month) {
    _selectedYear = year;
    _selectedMonth = month;
    fetchDashboardData();
  }

  Future<void> fetchDashboardData() async {
    if (_isCacheValid()) {
      final entry = _cache[_cacheKey]!;
      _metrics = entry.metrics;
      _recentSales = entry.recentSales;
      _salesEvolution = entry.salesEvolution;
      _yoyComparison = entry.yoyComparison;
      _topProducts = entry.topProducts;
      _topClients = entry.topClients;
      notifyListeners();
      return;
    }

    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final codes = _vendedorCodes.join(',');
      final queryParams = {
        'vendedorCodes': codes.isEmpty ? 'ALL' : codes,
        'year': _selectedYear.toString(),
        'month': _selectedMonth.toString(),
      };

      await Future.wait([
        _fetchMetrics(queryParams),
        _fetchRecentSales(queryParams),
        _fetchSalesEvolution(queryParams),
        _fetchYoYComparison(queryParams),
        _fetchTopProducts(queryParams),
        _fetchTopClients(queryParams),
      ]);

      if (_metrics != null) {
        _cache[_cacheKey] = DashboardCacheEntry(
          metrics: _metrics!,
          recentSales: _recentSales,
          salesEvolution: _salesEvolution,
          yoyComparison: _yoyComparison,
          topProducts: _topProducts,
          topClients: _topClients,
          timestamp: DateTime.now(),
        );
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    _cache.remove(_cacheKey);
    _isRefreshing = true;
    notifyListeners();
    await fetchDashboardData();
    _isRefreshing = false;
    notifyListeners();
  }

  Future<void> _fetchMetrics(Map<String, String> params) async {
    try {
      final response = await ApiClient.get(
        ApiConfig.dashboardMetrics,
        queryParameters: params,
      );
      _metrics = DashboardMetrics.fromJson(response);
    } catch (e) {
      debugPrint('Error fetching metrics: $e');
    }
  }

  Future<void> _fetchRecentSales(Map<String, String> params) async {
    try {
      final p = Map<String, String>.from(params);
      p['limit'] = '15';
      final response = await ApiClient.get(
        ApiConfig.recentSales,
        queryParameters: p,
      );
      final salesList = response['sales'] as List? ?? [];
      _recentSales = salesList
          .map((json) => RecentSale.fromJson(json as Map<String, dynamic>))
          .toList();
    } catch (e) {
      debugPrint('Error fetching recent sales: $e');
    }
  }

  Future<void> _fetchSalesEvolution(Map<String, String> params) async {
    try {
      final p = Map<String, String>.from(params);
      p['months'] = '12';
      final response = await ApiClient.get(
        ApiConfig.salesEvolution,
        queryParameters: p,
      );
      List<dynamic> dataList = [];
      if (response['evolution'] is List) {
        dataList = response['evolution'] as List<dynamic>;
      } else if (response['data'] is List) {
        dataList = response['data'] as List<dynamic>;
      }
      _salesEvolution = dataList.map((json) {
        if (json is Map<String, dynamic>)
          return SalesEvolutionPoint.fromJson(json);
        return SalesEvolutionPoint.fromJson(
          Map<String, dynamic>.from(json as Map),
        );
      }).toList();
    } catch (e) {
      debugPrint('Error fetching sales evolution: $e');
    }
  }

  Future<void> _fetchYoYComparison(Map<String, String> params) async {
    try {
      final response = await ApiClient.get(
        ApiConfig.yoyComparison,
        queryParameters: params,
      );
      _yoyComparison = YoYComparison.fromJson(response);
    } catch (e) {
      debugPrint('Error fetching YoY comparison: $e');
    }
  }

  Future<void> _fetchTopProducts(Map<String, String> params) async {
    try {
      final p = Map<String, String>.from(params);
      p['limit'] = '10';
      final response = await ApiClient.get(
        ApiConfig.topProducts,
        queryParameters: p,
      );
      final productsList = response['products'] as List? ?? [];
      _topProducts = productsList
          .map((json) => TopProduct.fromJson(json as Map<String, dynamic>))
          .toList();
    } catch (e) {
      debugPrint('Error fetching top products: $e');
    }
  }

  Future<void> _fetchTopClients(Map<String, String> params) async {
    try {
      final p = Map<String, String>.from(params);
      p['limit'] = '10';
      final response = await ApiClient.get(
        ApiConfig.topClients,
        queryParameters: p,
      );
      final clientsList = response['clients'] as List? ?? [];
      _topClients = clientsList
          .map((json) => TopClient.fromJson(json as Map<String, dynamic>))
          .toList();
    } catch (e) {
      debugPrint('Error fetching top clients: $e');
    }
  }
}

class DashboardCacheEntry {
  final DashboardMetrics metrics;
  final List<RecentSale> recentSales;
  final List<SalesEvolutionPoint> salesEvolution;
  final YoYComparison? yoyComparison;
  final List<TopProduct> topProducts;
  final List<TopClient> topClients;
  final DateTime timestamp;

  DashboardCacheEntry({
    required this.metrics,
    required this.recentSales,
    required this.salesEvolution,
    this.yoyComparison,
    required this.topProducts,
    required this.topClients,
    required this.timestamp,
  });
}
