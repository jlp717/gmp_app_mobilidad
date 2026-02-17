import 'package:flutter/material.dart';
import '../data/sales_history_service.dart';
import '../domain/product_history_item.dart';

class SalesHistoryProvider with ChangeNotifier {
  final SalesHistoryService _service = SalesHistoryService();
  
  List<ProductHistoryItem> _items = [];
  Map<String, dynamic>? _summary;
  bool _isLoading = false;
  String? _error;
  int _totalCount = 0;
  
  // Filters
  String? _clientCode;
  String? _productSearch;
  String? _startDate;
  String? _endDate;
  String? _vendedorCodes;

  // Getters
  List<ProductHistoryItem> get items => _items;
  Map<String, dynamic>? get summary => _summary;
  bool get isLoading => _isLoading;
  String? get error => _error;
  int get totalCount => _totalCount;
  
  String? get clientCode => _clientCode;
  String? get productSearch => _productSearch;
  String? get startDate => _startDate;
  String? get endDate => _endDate;

  void setVendedorCodes(String codes) {
    _vendedorCodes = codes;
  }

  void setClientCode(String? code) {
    _clientCode = code;
    loadHistory(reset: true);
  }

  void setProductSearch(String query) {
    _productSearch = query;
    // Debounce is handled in UI usually, or here with a timer
    notifyListeners();
  }

  void setDateRange(String? start, String? end) {
    _startDate = start;
    _endDate = end;
    loadHistory(reset: true);
  }

  // Allow triggering load explicitly (e.g. after debounce)
  Future<void> loadHistory({bool reset = false}) async {
    if (reset) {
      _items = [];
    }
    
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final results = await Future.wait([
        _service.getSalesHistory(
          vendedorCodes: _vendedorCodes,
          clientCode: _clientCode,
          productSearch: _productSearch,
          startDate: _startDate,
          endDate: _endDate,
          limit: 100,
          offset: 0,
        ),
        _service.getSalesHistorySummary(
          vendedorCodes: _vendedorCodes,
          clientCode: _clientCode,
          productSearch: _productSearch,
          startDate: _startDate,
          endDate: _endDate,
        ),
      ]);

      final historyResult = results[0] as Map<String, dynamic>;
      _summary = results[1] as Map<String, dynamic>;

      _items = historyResult['items'] as List<ProductHistoryItem>;
      _totalCount = historyResult['count'] as int;
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _isLoading = false;
      _error = e.toString();
      notifyListeners();
    }
  }
}
