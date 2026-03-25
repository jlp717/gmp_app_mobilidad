/// Pedidos Provider
/// =================
/// ChangeNotifier for order state management
/// Manages cart (current order), product catalog, and order history

import 'package:flutter/foundation.dart';
import '../data/pedidos_service.dart';
import '../data/pedidos_offline_service.dart';

class PedidosProvider with ChangeNotifier {
  // ── Cart State (current order being built) ──
  final List<OrderLine> _lines = [];
  String? _clientCode;
  String? _clientName;
  String _saleType = 'CC'; // CC=Venta, VC=Sin Nombre, NV=No Venta

  // ── Product Catalog State ──
  List<Product> _products = [];
  bool _isLoadingProducts = false;
  String? _productSearch;
  String? _selectedFamily;
  String? _selectedBrand;
  List<String> _families = [];
  List<String> _brands = [];
  int _productOffset = 0;
  bool _hasMoreProducts = true;

  // ── Orders List State ──
  List<OrderSummary> _orders = [];
  bool _isLoadingOrders = false;
  String? _orderStatusFilter;

  // ── Recommendations ──
  List<Recommendation> _clientHistory = [];
  List<Recommendation> _similarClients = [];

  // ── General ──
  bool _isSaving = false;
  String? _error;

  // ── Client Balance ──
  Map<String, dynamic> _clientBalance = {};

  // ── Favorites (Hive-based, local) ──
  final Set<String> _favoriteProductCodes = {};

  // ── Complementary Products ──
  List<Map<String, dynamic>> _complementaryProducts = [];

  // ── Analytics ──
  Map<String, dynamic> _analytics = {};
  bool _isLoadingAnalytics = false;

  // ── Getters ──
  List<OrderLine> get lines => List.unmodifiable(_lines);
  String? get clientCode => _clientCode;
  String? get clientName => _clientName;
  String get saleType => _saleType;
  List<Product> get products => _products;
  bool get isLoadingProducts => _isLoadingProducts;
  String? get productSearch => _productSearch;
  String? get selectedFamily => _selectedFamily;
  String? get selectedBrand => _selectedBrand;
  List<String> get families => _families;
  List<String> get brands => _brands;
  bool get hasMoreProducts => _hasMoreProducts;
  List<OrderSummary> get orders => _orders;
  bool get isLoadingOrders => _isLoadingOrders;
  String? get orderStatusFilter => _orderStatusFilter;
  List<Recommendation> get clientHistory => _clientHistory;
  List<Recommendation> get similarClients => _similarClients;
  bool get isSaving => _isSaving;
  String? get error => _error;
  Map<String, dynamic> get clientBalance => _clientBalance;
  double get clientSaldoPendiente => (_clientBalance['saldoPendiente'] as num?)?.toDouble() ?? 0;
  Set<String> get favoriteProductCodes => _favoriteProductCodes;
  List<Map<String, dynamic>> get complementaryProducts => _complementaryProducts;
  Map<String, dynamic> get analytics => _analytics;
  bool get isLoadingAnalytics => _isLoadingAnalytics;

  bool get hasClient => _clientCode != null && _clientCode!.isNotEmpty;
  bool get hasLines => _lines.isNotEmpty;
  int get lineCount => _lines.length;

  double get totalEnvases => _lines.fold(0, (sum, l) => sum + l.cantidadEnvases);
  double get totalUnidades => _lines.fold(0, (sum, l) => sum + l.cantidadUnidades);
  double get totalImporte => _lines.fold(0, (sum, l) => sum + l.importeVenta);
  double get totalCosto => _lines.fold(0, (sum, l) => sum + l.importeCosto);
  double get totalMargen => _lines.fold(0, (sum, l) => sum + l.importeMargen);
  double get porcentajeMargen => totalImporte > 0 ? (totalMargen / totalImporte) * 100 : 0;

  String get saleTypeLabel {
    switch (_saleType) {
      case 'CC': return 'Venta';
      case 'VC': return 'Venta Sin Nombre';
      case 'NV': return 'No Venta';
      default: return 'Venta';
    }
  }

  // ── Client ──

  void setClient(String code, String name) {
    _clientCode = code;
    _clientName = name;
    notifyListeners();
  }

  void clearClient() {
    _clientCode = null;
    _clientName = null;
    notifyListeners();
  }

  void setSaleType(String type) {
    _saleType = type;
    notifyListeners();
  }

  // ── Product Catalog ──

  Future<void> loadProducts({
    required String vendedorCodes,
    String? search,
    bool reset = false,
    bool forceRefresh = false,
  }) async {
    if (reset) {
      _productOffset = 0;
      _hasMoreProducts = true;
      _products = [];
    }
    if (!_hasMoreProducts && !reset) return;

    _isLoadingProducts = true;
    _productSearch = search;
    _error = null;
    notifyListeners();

    try {
      final results = await PedidosService.getProducts(
        vendedorCodes: vendedorCodes,
        search: search,
        clientCode: _clientCode,
        family: _selectedFamily,
        marca: _selectedBrand,
        limit: 50,
        offset: _productOffset,
        forceRefresh: forceRefresh,
      );

      if (reset) {
        _products = results;
      } else {
        _products = [..._products, ...results];
      }
      _hasMoreProducts = results.length >= 50;
      _productOffset += results.length;
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoadingProducts = false;
      notifyListeners();
    }
  }

  Future<void> loadMoreProducts(String vendedorCodes) async {
    if (_isLoadingProducts || !_hasMoreProducts) return;
    await loadProducts(vendedorCodes: vendedorCodes, search: _productSearch);
  }

  void setFamilyFilter(String? family) {
    _selectedFamily = family;
    notifyListeners();
  }

  void setBrandFilter(String? brand) {
    _selectedBrand = brand;
    notifyListeners();
  }

  Future<void> loadFilters() async {
    try {
      final results = await Future.wait([
        PedidosService.getFamilies(),
        PedidosService.getBrands(),
      ]);
      _families = results[0];
      _brands = results[1];
      notifyListeners();
    } catch (e) {
      debugPrint('[PedidosProvider] Error loading filters: $e');
    }
  }

  // ── Stock Refresh ──

  Future<void> refreshStock(String productCode) async {
    try {
      final stock = await PedidosService.getStock(productCode);
      final idx = _products.indexWhere((p) => p.code == productCode);
      if (idx >= 0) {
        final p = _products[idx];
        _products[idx] = Product(
          code: p.code, name: p.name, brand: p.brand, family: p.family,
          unitsPerBox: p.unitsPerBox, unitsFraction: p.unitsFraction,
          unitsRetractil: p.unitsRetractil, unitMeasure: p.unitMeasure,
          weight: p.weight,
          stockEnvases: stock['envases'] ?? p.stockEnvases,
          stockUnidades: stock['unidades'] ?? p.stockUnidades,
          precioTarifa1: p.precioTarifa1, precioMinimo: p.precioMinimo,
          precioCliente: p.precioCliente,
        );
        notifyListeners();
      }
    } catch (e) {
      debugPrint('[PedidosProvider] refreshStock error: $e');
    }
  }

  // ── Cart Operations ──

  void addLine(Product product, double cantidadEnvases, double cantidadUnidades, String unidadMedida, double precioVenta) {
    // Check if product already in cart
    final existingIdx = _lines.indexWhere((l) => l.codigoArticulo == product.code);
    if (existingIdx >= 0) {
      // Update existing line
      final line = _lines[existingIdx];
      line.cantidadEnvases += cantidadEnvases;
      line.cantidadUnidades += cantidadUnidades;
      line.precioVenta = precioVenta;
      line.recalculate();
    } else {
      // Add new line
      final line = OrderLine(
        codigoArticulo: product.code,
        descripcion: product.name,
        cantidadEnvases: cantidadEnvases,
        cantidadUnidades: cantidadUnidades,
        unidadMedida: unidadMedida,
        unidadesCaja: product.unitsPerBox,
        precioVenta: precioVenta,
        precioCosto: product.precioMinimo > 0 ? product.precioMinimo * 0.7 : product.precioTarifa1 * 0.7, // Approximate cost
        precioTarifa: product.precioTarifa1,
        precioTarifaCliente: product.precioCliente,
        precioMinimo: product.precioMinimo,
      );
      line.recalculate();
      _lines.add(line);
    }
    _error = null;
    notifyListeners();
  }

  void updateLine(int index, {double? cantidadEnvases, double? cantidadUnidades, double? precioVenta, String? unidadMedida}) {
    if (index < 0 || index >= _lines.length) return;
    final line = _lines[index];
    if (cantidadEnvases != null) line.cantidadEnvases = cantidadEnvases;
    if (cantidadUnidades != null) line.cantidadUnidades = cantidadUnidades;
    if (precioVenta != null) line.precioVenta = precioVenta;
    if (unidadMedida != null) line.unidadMedida = unidadMedida;
    line.recalculate();
    notifyListeners();
  }

  void removeLine(int index) {
    if (index < 0 || index >= _lines.length) return;
    _lines.removeAt(index);
    notifyListeners();
  }

  void clearOrder() {
    _lines.clear();
    _clientCode = null;
    _clientName = null;
    _saleType = 'CC';
    _error = null;
    notifyListeners();
  }

  // ── Order Persistence ──

  Future<Map<String, dynamic>?> confirmOrder(String vendedorCode) async {
    if (!hasClient || !hasLines) {
      _error = 'Seleccione un cliente y añada al menos un producto';
      notifyListeners();
      return null;
    }

    _isSaving = true;
    _error = null;
    notifyListeners();

    try {
      final result = await PedidosService.createOrder(
        clientCode: _clientCode!,
        clientName: _clientName ?? '',
        vendedorCode: vendedorCode,
        tipoVenta: _saleType,
        lines: _lines,
      );
      // Clear cart after successful creation
      _lines.clear();
      _clientCode = null;
      _clientName = null;
      _saleType = 'CC';
      return result;
    } catch (e) {
      _error = e.toString();
      return null;
    } finally {
      _isSaving = false;
      notifyListeners();
    }
  }

  // ── Orders List ──

  Future<void> loadOrders({
    required String vendedorCodes,
    String? status,
    bool forceRefresh = false,
  }) async {
    _isLoadingOrders = true;
    _orderStatusFilter = status;
    _error = null;
    notifyListeners();

    try {
      _orders = await PedidosService.getOrders(
        vendedorCodes: vendedorCodes,
        status: status,
        forceRefresh: forceRefresh,
      );
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoadingOrders = false;
      notifyListeners();
    }
  }

  // ── Recommendations ──

  Future<void> loadRecommendations({required String clientCode, required String vendedorCode}) async {
    try {
      final reco = await PedidosService.getRecommendations(
        clientCode: clientCode,
        vendedorCode: vendedorCode,
      );
      _clientHistory = reco['clientHistory'] ?? [];
      _similarClients = reco['similarClients'] ?? [];
      notifyListeners();
    } catch (e) {
      debugPrint('[PedidosProvider] Error loading recommendations: $e');
    }
  }

  // ── Offline Support ──

  Future<void> saveDraft(String vendedorCode) async {
    if (!hasClient || !hasLines) return;
    try {
      await PedidosOfflineService.saveDraft(
        clientCode: _clientCode!,
        clientName: _clientName ?? '',
        saleType: _saleType,
        vendedorCode: vendedorCode,
        lines: _lines,
      );
    } catch (e) {
      debugPrint('[PedidosProvider] saveDraft error: $e');
    }
  }

  void loadDraft(Map<String, dynamic> draft) {
    _clientCode = draft['clientCode'] as String?;
    _clientName = draft['clientName'] as String?;
    _saleType = (draft['saleType'] as String?) ?? 'CC';
    _lines.clear();
    final linesData = draft['lines'] as List? ?? [];
    for (final l in linesData) {
      final line = OrderLine.fromJson(l as Map<String, dynamic>);
      line.recalculate();
      _lines.add(line);
    }
    _error = null;
    notifyListeners();
  }

  Future<void> deleteDraft(String key) async {
    try {
      await PedidosOfflineService.deleteDraft(key);
    } catch (e) {
      debugPrint('[PedidosProvider] deleteDraft error: $e');
    }
  }

  // ── Client Balance ──
  Future<void> loadClientBalance(String clientCode) async {
    try {
      _clientBalance = await PedidosService.getClientBalance(clientCode);
      notifyListeners();
    } catch (e) {
      debugPrint('[PedidosProvider] loadClientBalance error: $e');
    }
  }

  // ── Favorites (Hive-based) ──
  void initFavorites(List<String> savedCodes) {
    _favoriteProductCodes.clear();
    _favoriteProductCodes.addAll(savedCodes);
  }

  void toggleFavorite(String productCode) {
    if (_favoriteProductCodes.contains(productCode)) {
      _favoriteProductCodes.remove(productCode);
    } else {
      _favoriteProductCodes.add(productCode);
    }
    notifyListeners();
  }

  bool isFavorite(String productCode) => _favoriteProductCodes.contains(productCode);

  // ── Complementary Products ──
  Future<void> loadComplementaryProducts() async {
    if (_lines.isEmpty) {
      _complementaryProducts = [];
      notifyListeners();
      return;
    }
    try {
      final codes = _lines.map((l) => l.codigoArticulo).toList();
      _complementaryProducts = await PedidosService.getComplementaryProducts(codes, clientCode: _clientCode);
      notifyListeners();
    } catch (e) {
      debugPrint('[PedidosProvider] loadComplementaryProducts error: $e');
    }
  }

  // ── Analytics ──
  Future<void> loadAnalytics(String vendedorCodes) async {
    _isLoadingAnalytics = true;
    notifyListeners();
    try {
      _analytics = await PedidosService.getAnalytics(vendedorCodes);
    } catch (e) {
      debugPrint('[PedidosProvider] loadAnalytics error: $e');
    } finally {
      _isLoadingAnalytics = false;
      notifyListeners();
    }
  }

  // ── Clone Order into Cart ──
  Future<void> cloneOrderIntoCart(int orderId) async {
    try {
      final data = await PedidosService.cloneOrder(orderId);
      _clientCode = data['clientCode'] as String?;
      _clientName = data['clientName'] as String?;
      _saleType = (data['tipoventa'] as String?) ?? 'CC';
      _lines.clear();
      final linesData = data['lines'] as List? ?? [];
      for (final l in linesData) {
        final line = OrderLine.fromJson(l as Map<String, dynamic>);
        line.recalculate();
        _lines.add(line);
      }
      _error = null;
      notifyListeners();
    } catch (e) {
      _error = 'Error al clonar pedido: $e';
      notifyListeners();
    }
  }

  // ── Batch Add from Recommendations ──
  void addMultipleProducts(List<Product> products, double defaultQty) {
    for (final product in products) {
      final existingIdx = _lines.indexWhere((l) => l.codigoArticulo == product.code);
      if (existingIdx < 0) {
        final line = OrderLine(
          codigoArticulo: product.code,
          descripcion: product.name,
          cantidadEnvases: defaultQty,
          cantidadUnidades: 0,
          unidadMedida: 'CAJAS',
          unidadesCaja: product.unitsPerBox,
          precioVenta: product.bestPrice,
          precioCosto: product.precioMinimo > 0 ? product.precioMinimo * 0.7 : product.precioTarifa1 * 0.7,
          precioTarifa: product.precioTarifa1,
          precioTarifaCliente: product.precioCliente,
          precioMinimo: product.precioMinimo,
        );
        line.recalculate();
        _lines.add(line);
      }
    }
    _error = null;
    notifyListeners();
  }

  // ── Stock Auto-Refresh for Cart Lines ──
  Future<void> refreshCartStock() async {
    for (int i = 0; i < _lines.length; i++) {
      try {
        final stock = await PedidosService.getStock(_lines[i].codigoArticulo);
        // Update the product in catalog if exists
        final pIdx = _products.indexWhere((p) => p.code == _lines[i].codigoArticulo);
        if (pIdx >= 0) {
          final p = _products[pIdx];
          _products[pIdx] = Product(
            code: p.code, name: p.name, brand: p.brand, family: p.family,
            unitsPerBox: p.unitsPerBox, unitsFraction: p.unitsFraction,
            unitsRetractil: p.unitsRetractil, unitMeasure: p.unitMeasure,
            weight: p.weight,
            stockEnvases: stock['envases'] ?? p.stockEnvases,
            stockUnidades: stock['unidades'] ?? p.stockUnidades,
            precioTarifa1: p.precioTarifa1, precioMinimo: p.precioMinimo,
            precioCliente: p.precioCliente,
          );
        }
      } catch (e) {
        debugPrint('[PedidosProvider] refreshCartStock error for ${_lines[i].codigoArticulo}: $e');
      }
    }
    notifyListeners();
  }

  List<Map<String, dynamic>> get savedDrafts => PedidosOfflineService.getDrafts();
  int get draftCount => PedidosOfflineService.draftCount;
  int get pendingSyncCount => PedidosOfflineService.pendingSyncCount;

  Future<int> syncPendingOrders() async {
    try {
      final synced = await PedidosOfflineService.syncPendingOrders();
      if (synced > 0) notifyListeners();
      return synced;
    } catch (e) {
      debugPrint('[PedidosProvider] syncPendingOrders error: $e');
      return 0;
    }
  }
}
