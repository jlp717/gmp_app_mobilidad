import 'package:flutter/foundation.dart';
import '../api/api_client.dart';
import '../api/api_config.dart';
import '../models/dashboard_models.dart';

/// Dashboard data provider with date filtering
class DashboardProvider with ChangeNotifier {
  final List<String> vendedorCodes;
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
  String? _error;

  DashboardProvider(
    this.vendedorCodes, {
    this.isJefeVentas = false,
    int? year,
    int? month,
  })  : _selectedYear = year ?? DateTime.now().year,
        _selectedMonth = month ?? DateTime.now().month;

  // Getters
  DashboardMetrics? get metrics => _metrics;
  List<RecentSale> get recentSales => _recentSales;
  List<SalesEvolutionPoint> get salesEvolution => _salesEvolution;
  YoYComparison? get yoyComparison => _yoyComparison;
  List<TopProduct> get topProducts => _topProducts;
  List<TopClient> get topClients => _topClients;
  bool get isLoading => _isLoading;
  String? get error => _error;
  int get selectedYear => _selectedYear;
  int get selectedMonth => _selectedMonth;

  bool get hasData => _metrics != null || _recentSales.isNotEmpty || _salesEvolution.isNotEmpty;

  /// Update date filter and refresh
  void updateDateFilter(int year, int month) {
    _selectedYear = year;
    _selectedMonth = month;
    fetchDashboardData();
  }

  /// Fetch all dashboard data
  Future<void> fetchDashboardData() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final codes = vendedorCodes.join(',');
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
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
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
      _recentSales = salesList.map((json) => RecentSale.fromJson(json as Map<String, dynamic>)).toList();
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
      
      // The response is always Map<String, dynamic> from ApiClient
      // Extract the list from various possible keys
      List<dynamic> dataList = [];
      if (response['evolution'] is List) {
        dataList = response['evolution'] as List<dynamic>;
      } else if (response['data'] is List) {
        dataList = response['data'] as List<dynamic>;
      } else if (response['months'] is List) {
        dataList = response['months'] as List<dynamic>;
      }
      
      _salesEvolution = dataList.map((json) {
        if (json is Map<String, dynamic>) {
          return SalesEvolutionPoint.fromJson(json);
        }
        return SalesEvolutionPoint.fromJson(Map<String, dynamic>.from(json as Map));
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
      _topProducts = productsList.map((json) => TopProduct.fromJson(json as Map<String, dynamic>)).toList();
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
      _topClients = clientsList.map((json) => TopClient.fromJson(json as Map<String, dynamic>)).toList();
    } catch (e) {
      debugPrint('Error fetching top clients: $e');
    }
  }

  /// Refresh data
  Future<void> refresh() => fetchDashboardData();
}
