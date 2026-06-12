/// Pedidos Provider
/// =================
/// ChangeNotifier for order state management
/// Manages cart (current order), product catalog, and order history
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_favorites_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_order_api.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

/// Chooses the provider-facing result from create + confirm API responses.
Map<String, dynamic> normalizeConfirmOrderResultForProvider({
  required Map<String, dynamic> createResult,
  required Map<String, dynamic> confirmedResult,
}) {
  if (confirmedResult['blocked'] == true) {
    return Map<String, dynamic>.from(confirmedResult);
  }

  final header = confirmedResult['header'];
  if (header is Map) {
    return Map<String, dynamic>.from(header);
  }

  return Map<String, dynamic>.from(createResult);
}

/// Returns true when the cart may be cleared after confirmation.
bool shouldClearCartAfterConfirmation(Map<String, dynamic>? result) {
  return isConfirmedOrderResultForProvider(result);
}

/// Extracts backend order status from a normalized header or wrapper.
String orderConfirmationStatusForProvider(Map<String, dynamic>? result) {
  if (result == null) return '';

  final header = result['header'];
  final rawStatus = result['estado'] ??
      result['estadoPedido'] ??
      (header is Map ? header['estado'] ?? header['estadoPedido'] : null);

  return rawStatus?.toString().trim().toUpperCase() ?? '';
}

/// Returns true only after the backend leaves the order confirmed or shipped.
bool isConfirmedOrderResultForProvider(Map<String, dynamic>? result) {
  if (result == null || result['blocked'] == true) return false;

  final status = orderConfirmationStatusForProvider(result);
  return status == 'CONFIRMADO' || status == 'ENVIADO';
}

final pedidosProvider =
    ChangeNotifierProvider<PedidosProvider>((ref) => PedidosProvider());

class PedidosProvider with ChangeNotifier {
  // Req #9: PedidosOrderApi inyectable para testabilidad. Por defecto usa la
  // implementación basada en PedidosService (estática) para mantener
  // backwards-compat con el resto del provider.
  PedidosProvider({
    PedidosOrderApi? orderApi,
    bool refreshAfterConfirm = true,
  })  : _orderApi = orderApi ?? const PedidosServiceOrderApi(),
        _refreshAfterConfirm = refreshAfterConfirm;

  final PedidosOrderApi _orderApi;
  final bool _refreshAfterConfirm;

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
  int _productsLoadGeneration = 0;

  // ── Orders List State ──
  List<OrderSummary> _orders = [];
  bool _isLoadingOrders = false;
  String? _orderStatusFilter;
  String _vendedorCodes = 'ALL';
  int _ordersLoadGeneration = 0;

  // ── Order Stats ──
  OrderStats? _orderStats;
  bool _isLoadingStats = false;

  // ── Recommendations ──
  List<Recommendation> _clientHistory = [];
  List<Recommendation> _similarClients = [];

  // ── General ──
  bool _isSaving = false;
  String? _error;

  // Req #2: Visibilidad de márgenes / costes según rol.
  // JEFE_VENTAS, ADMIN y Comercial 80 ven márgenes; COMERCIAL/REPARTIDOR no.
  bool _isJefeVentas = false;
  String _userRole = 'COMERCIAL';
  String _userCode = '';

  // Req #8: Estado del aviso de borradores acumulados.
  String? _draftWarningMessage;
  int _accumulatedDraftCount = 0;

  // ── Client Balance ──
  Map<String, dynamic> _clientBalance = {};

  // ── Favorites (Hive-based, local) ──
  final Set<String> _favoriteProductCodes = {};

  // ── Auto-save ──
  DateTime? _lastAutoSaved;
  bool _isDirty = false;

  // ── Stock Filter ──
  bool _onlyWithStock = false;

  // ── Last Qty per Product (B3) ──
  final Map<String, double> _lastQtyByProduct = {};
  final Map<String, String> _lastUnitByProduct = {};
  // ── Last selected tariff price per product (override from TarifaSelectorModal) ──
  final Map<String, double> _lastPriceByProduct = {};

  // ── Global Discount (C5) ──
  double _globalDiscountPct = 0;

  // ── Complementary Products & Promotions ──
  List<Map<String, dynamic>> _complementaryProducts = [];
  final List<PromotionItem> _activePromotionsList = [];
  final Map<String, PromotionItem> _activePromotions = {};

  // ── Analytics ──
  Map<String, dynamic> _analytics = {};
  bool _isLoadingAnalytics = false;

  // ── Cached Calculations (P1: avoid recalculation on every getter access) ──
  double? _cachedTotalImporte;
  double? _cachedTotalCosto;
  double? _cachedTotalConDescuento;
  double? _cachedTotalMargen;
  double? _cachedPorcentajeMargen;
  bool _cacheValid = false;

  void _invalidateCache() {
    _cacheValid = false;
    _cachedTotalImporte = null;
    _cachedTotalCosto = null;
    _cachedTotalConDescuento = null;
    _cachedTotalMargen = null;
    _cachedPorcentajeMargen = null;
  }

  // ── Debounced notifyListeners (P1: batch rapid state changes) ──
  bool _notifyScheduled = false;
  bool _disposed = false;

  /// Schedules a single notifyListeners call via microtask to batch
  /// multiple rapid state changes into one rebuild cycle.
  void _notify({bool immediate = false}) {
    if (_disposed) return;
    if (immediate) {
      _notifyScheduled = false;
      notifyListeners();
      return;
    }
    if (_notifyScheduled) return;
    _notifyScheduled = true;
    Future.microtask(() {
      _notifyScheduled = false;
      if (!_disposed) notifyListeners();
    });
  }

  String _qtyKey(String productCode, [String? clientCode]) {
    final product = productCode.trim();
    final client = (clientCode ?? _clientCode ?? '').trim();
    return '${client.isEmpty ? '_noclient_' : client}|$product';
  }

  double get _discountFactor => 1 - (_globalDiscountPct / 100);

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
  String get vendedorCodes => _vendedorCodes;
  OrderStats? get orderStats => _orderStats;
  bool get isLoadingStats => _isLoadingStats;
  List<Recommendation> get clientHistory => _clientHistory;
  List<Recommendation> get similarClients => _similarClients;
  bool get isSaving => _isSaving;
  String? get error => _error;
  Map<String, dynamic> get clientBalance => _clientBalance;
  double get clientSaldoPendiente {
    final saldo = _clientBalance['saldoPendiente'];
    if (saldo is num) return saldo.toDouble();
    if (saldo is String) return double.tryParse(saldo) ?? 0;
    return 0; // Defensive: Map or unexpected type -> 0
  }

  Set<String> get favoriteProductCodes => _favoriteProductCodes;
  List<Map<String, dynamic>> get complementaryProducts =>
      _complementaryProducts;
  PromotionItem? getPromo(String productCode) => _activePromotions[productCode];
  List<PromotionItem> get activePromotionsList =>
      List.unmodifiable(_activePromotionsList);
  Map<String, dynamic> get analytics => _analytics;
  bool get isLoadingAnalytics => _isLoadingAnalytics;
  DateTime? get lastAutoSaved => _lastAutoSaved;
  bool get isDirty => _isDirty;

  // Req #2: getters de visibilidad por rol.
  bool get isJefeVentas => _isJefeVentas;
  bool get isMarginVisible {
    final normalizedCode = _userCode.replaceFirst(RegExp(r'^0+'), '');
    return _isJefeVentas || normalizedCode == '80';
  }

  String get userRole => _userRole;

  /// Actualiza el rol del usuario logueado (e.g. al iniciar sesión o
  /// cuando authProvider cambia). Notifica para que las vistas se
  /// repinten ocultando/mostrando márgenes según corresponda.
  void setUserRole(String? role, {String? code}) {
    final normalized = (role ?? '').trim().toUpperCase();
    final next = normalized == 'JEFE_VENTAS' || normalized == 'ADMIN';
    final normalizedCode = (code ?? '').replaceFirst(RegExp(r'^0+'), '');
    if (next == _isJefeVentas &&
        normalized == _userRole &&
        normalizedCode == _userCode) return;
    _isJefeVentas = next;
    _userRole = normalized.isEmpty ? 'COMERCIAL' : normalized;
    _userCode = normalizedCode;
    notifyListeners();
  }

  // Req #8: getters de aviso de borradores acumulados.
  String? get draftWarningMessage => _draftWarningMessage;
  int get accumulatedDraftCount => _accumulatedDraftCount;
  bool get hasDraftAccumulationWarning =>
      _draftWarningMessage != null && _accumulatedDraftCount >= 3;

  /// Llamado por la UI para limpiar el warning una vez mostrado.
  void clearDraftWarning() {
    if (_draftWarningMessage == null && _accumulatedDraftCount == 0) return;
    _draftWarningMessage = null;
    _accumulatedDraftCount = 0;
    notifyListeners();
  }

  /// Consulta al backend si el comercial acumula 3+ borradores.
  /// Resultado disponible vía [draftWarningMessage] / [accumulatedDraftCount].
  Future<void> refreshDraftStatus(String vendedorCode) async {
    final code = vendedorCode.trim();
    if (code.isEmpty) return;
    try {
      final raw = await ApiClient.get(
        '/pedidos/draft-status/$code',
        cacheKey: 'pedidos:draft-status:$code',
        cacheTTL: CacheService.realtimeTTL,
      );
      final data = raw is Map<String, dynamic> ? raw : <String, dynamic>{};
      final warning = data['warning'] == true;
      final count = (data['count'] ?? 0) is num
          ? (data['count'] as num).toInt()
          : int.tryParse((data['count'] ?? '0').toString()) ?? 0;
      _accumulatedDraftCount = count;
      _draftWarningMessage = warning ? (data['message']?.toString()) : null;
      notifyListeners();
    } catch (_) {
      // Silencioso: no crítico
    }
  }

  bool get onlyWithStock => _onlyWithStock;
  double lastQtyForProduct(String code, {String? clientCode}) {
    final key = _qtyKey(code, clientCode);
    if (_lastQtyByProduct.containsKey(key)) {
      return _lastQtyByProduct[key]!;
    }
    return _lastQtyByProduct[code.trim()] ?? 1.0;
  }

  String? lastUnitForProduct(String code, {String? clientCode}) {
    final key = _qtyKey(code, clientCode);
    if (_lastUnitByProduct.containsKey(key)) {
      return _lastUnitByProduct[key];
    }
    return _lastUnitByProduct[code.trim()];
  }

  double? lastPriceForProduct(String code) => _lastPriceByProduct[code.trim()];

  void setLastPriceForProduct(String code, double price) {
    _lastPriceByProduct[code.trim()] = price;
  }

  double get globalDiscountPct => _globalDiscountPct;

  /// Total importe bruto del carrito (suma de importeVenta de todas las líneas).
  double get totalImporte {
    if (_cacheValid && _cachedTotalImporte != null) return _cachedTotalImporte!;
    final value = _lines.fold(0.0, (sum, l) => sum + l.importeVenta);
    _cachedTotalImporte = value;
    return value;
  }

  double get totalDescuento => totalImporte * _globalDiscountPct / 100;

  double get totalConDescuento {
    if (_cacheValid && _cachedTotalConDescuento != null) {
      return _cachedTotalConDescuento!;
    }
    final value = totalImporte - totalDescuento;
    _cachedTotalConDescuento = value;
    return value;
  }

  double get totalBase {
    var sum = 0.0;
    for (final l in _lines) {
      final saleAfterDiscount = l.importeVenta * _discountFactor;
      sum += saleAfterDiscount / (1 + l.ivaRate);
    }
    return sum;
  }

  double get totalIva => totalConDescuento - totalBase;

  double get totalCosto {
    if (_cacheValid && _cachedTotalCosto != null) return _cachedTotalCosto!;
    final value = _lines.fold(0.0, (sum, l) => sum + l.importeCosto);
    _cachedTotalCosto = value;
    return value;
  }

  double get totalMargen {
    if (_cacheValid && _cachedTotalMargen != null) return _cachedTotalMargen!;
    final value = totalConDescuento - totalCosto;
    _cachedTotalMargen = value;
    return value;
  }

  double get porcentajeMargen {
    if (_cacheValid && _cachedPorcentajeMargen != null) {
      return _cachedPorcentajeMargen!;
    }
    final value =
        totalConDescuento > 0 ? (totalMargen / totalConDescuento) * 100 : 0.0;
    _cachedPorcentajeMargen = value;
    return value;
  }

  String get saleTypeLabel {
    switch (_saleType) {
      case 'CC':
        return 'Venta';
      case 'VC':
        return 'Venta Sin Nombre';
      case 'NV':
        return 'No Venta';
      default:
        return 'Venta';
    }
  }

  // ── Derived cart getters (required by UI) ──
  bool get hasClient => _clientCode != null && _clientCode!.isNotEmpty;
  bool get hasLines => _lines.isNotEmpty;
  int get lineCount => _lines.length;
  double get totalEnvases =>
      _lines.fold(0.0, (sum, l) => sum + l.cantidadEnvases);
  double get totalUnidades =>
      _lines.fold(0.0, (sum, l) => sum + l.cantidadUnidades);

  OrderBolsaImpact get estimatedBolsaImpact {
    final lines = _buildLinesForSubmit();
    var acumulacion = 0.0;
    var consumo = 0.0;
    var count = 0;
    for (final line in lines) {
      final impact = line.estimatedBolsaImpact;
      if (!impact.hasImpact) continue;
      acumulacion += impact.acumulacion;
      consumo += impact.consumo;
      count++;
    }
    acumulacion = double.parse(acumulacion.toStringAsFixed(2));
    consumo = double.parse(consumo.toStringAsFixed(2));
    return OrderBolsaImpact(
      acumulacion: acumulacion,
      consumo: consumo,
      neto: double.parse((acumulacion - consumo).toStringAsFixed(2)),
      movementCount: count,
      hasImpact: count > 0,
    );
  }

  Map<int, double> get ivaBreakdown {
    final breakdown = <int, double>{};
    for (final line in _lines) {
      final ivaPct = (line.ivaRate * 100).round();
      final saleAfterDiscount = line.importeVenta * _discountFactor;
      breakdown[ivaPct] = (breakdown[ivaPct] ?? 0) + saleAfterDiscount;
    }
    return breakdown;
  }

  // ── Client ──

  void setClient(String code, String name, {bool clearCart = false}) {
    if (clearCart) {
      _lines.clear();
      _activePromotionsList.clear();
      _activePromotions.clear();
      _complementaryProducts.clear();
      _clientHistory.clear();
      _similarClients.clear();
      _productOffset = 0;
      _hasMoreProducts = true;
      _products = [];
      _productSearch = null;
      _selectedFamily = null;
      _selectedBrand = null;
    }
    _clientCode = code;
    _clientName = name;
    notifyListeners();
  }

  void clearClient() {
    _clientCode = null;
    _clientName = null;
    _lines.clear();
    _activePromotionsList.clear();
    _activePromotions.clear();
    _complementaryProducts.clear();
    _clientHistory.clear();
    _similarClients.clear();
    _products = [];
    _productOffset = 0;
    _hasMoreProducts = false;
    _productSearch = null;
    _selectedFamily = null;
    _selectedBrand = null;
    notifyListeners();
  }

  void setSaleType(String type) {
    _saleType = type;
    notifyListeners();
  }

  void setStockFilter(bool value) {
    _onlyWithStock = value;
    notifyListeners();
  }

  void setGlobalDiscount(double pct) {
    _globalDiscountPct = pct.clamp(0, 100);
    _invalidateCache();
    _notify();
  }

  void reorderLines(int oldIndex, int newIndex) {
    if (newIndex > oldIndex) newIndex--;
    final item = _lines.removeAt(oldIndex);
    _lines.insert(newIndex, item);
    _invalidateCache();
    _notify();
  }

  // ── Product Catalog ──

  Future<void> loadProducts({
    required String vendedorCodes,
    String? search,
    bool reset = false,
    bool forceRefresh = false,
  }) async {
    if (_clientCode == null || _clientCode!.trim().isEmpty) {
      _products = [];
      _hasMoreProducts = false;
      _productOffset = 0;
      notifyListeners();
      return;
    }

    if (reset) {
      _productOffset = 0;
      _hasMoreProducts = true;
      _products = [];
    }
    if (!_hasMoreProducts && !reset) return;

    _isLoadingProducts = true;
    _productSearch = search;
    _error = null;
    final generation = ++_productsLoadGeneration;
    final requestClientCode = _clientCode;
    final requestOffset = _productOffset;
    final requestFamily = _selectedFamily;
    final requestBrand = _selectedBrand;
    final requestPrefamily = _selectedPrefamily;
    notifyListeners();

    try {
      final results = await PedidosService.getProducts(
        vendedorCodes: vendedorCodes,
        search: search,
        clientCode: requestClientCode,
        family: requestFamily,
        marca: requestBrand,
        prefamily: requestPrefamily,
        offset: requestOffset,
        forceRefresh: forceRefresh,
      );

      if (generation != _productsLoadGeneration ||
          requestClientCode != _clientCode ||
          requestFamily != _selectedFamily ||
          requestBrand != _selectedBrand ||
          requestPrefamily != _selectedPrefamily) {
        return;
      }

      final filtered =
          _onlyWithStock ? results.where((p) => p.hasStock).toList() : results;
      if (reset) {
        _products = filtered;
      } else {
        _products = [..._products, ...filtered];
      }
      _hasMoreProducts = results.length >= 50;
      _productOffset = requestOffset + results.length;
    } catch (e) {
      if (generation == _productsLoadGeneration) {
        _error = e.toString();
      }
    } finally {
      if (generation == _productsLoadGeneration) {
        _isLoadingProducts = false;
        notifyListeners();
      }
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

  // Req #14: filtro por prefamilia (Nestlé y otras agrupaciones de marca).
  String? _selectedPrefamily;

  /// Prefamilia seleccionada (por ej. "NESTLE"). null = sin filtro.
  String? get selectedPrefamily => _selectedPrefamily;

  /// Configura el filtro de prefamilia.
  void setPrefamilyFilter(String? prefamily) {
    final next = (prefamily ?? '').trim();
    final normalized = next.isEmpty ? null : next.toUpperCase();
    if (_selectedPrefamily == normalized) return;
    _selectedPrefamily = normalized;
    // Filtros de prefamilia y familia son excluyentes a efectos visuales.
    if (normalized != null) _selectedFamily = null;
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

  void _applyStockToProduct(String productCode, Map<String, double> stock) {
    final idx = _products.indexWhere((p) => p.code == productCode);
    if (idx < 0) return;

    final product = _products[idx];
    _products[idx] = product.copyWithStock(
      stockEnvases: stock['envases'] ?? product.stockEnvases,
      stockUnidades: stock['unidades'] ?? product.stockUnidades,
    );
  }

  Future<void> refreshStock(String productCode) async {
    try {
      final stock = await PedidosService.getStock(productCode);
      _applyStockToProduct(productCode, stock);
      notifyListeners();
    } catch (e) {
      debugPrint('[PedidosProvider] refreshStock error: $e');
    }
  }

  // ── Cart Operations ──

  String? addLine(
    Product product,
    double cantidadEnvases,
    double cantidadUnidades,
    String unidadMedida,
    double precioVenta,
  ) {
    if (!hasClient) {
      const msg = 'Debes seleccionar un cliente antes de anadir productos.';
      _error = msg;
      _notify(immediate: true);
      return msg;
    }

    final unit = unidadMedida.trim().isEmpty
        ? 'CAJAS'
        : unidadMedida.trim().toUpperCase();

    var requestQty = unit == 'CAJAS' ? cantidadEnvases : cantidadUnidades;

    final existingIdx =
        _lines.indexWhere((l) => l.codigoArticulo == product.code);
    final currentQtyInCart = existingIdx >= 0
        ? (unit == 'CAJAS'
            ? _lines[existingIdx].cantidadEnvases
            : _lines[existingIdx].cantidadUnidades)
        : 0.0;

    final maxQty =
        unit == 'CAJAS' ? product.stockEnvases : product.stockForUnit(unit);
    final remainingAvailable = maxQty - currentQtyInCart;

    if (remainingAvailable <= 0 && requestQty > 0) {
      final msg = unit == 'CAJAS'
          ? 'Stock insuficiente: Disponible ${product.stockEnvases.toInt()} cajas.'
          : 'Stock insuficiente: Disponible ${maxQty.toStringAsFixed(2)} ${Product.unitLabel(unit)}.';
      _error = msg;
      notifyListeners();
      return msg;
    }

    var isPartial = false;
    double missingQty = 0;

    if (requestQty > remainingAvailable) {
      isPartial = true;
      missingQty = requestQty - remainingAvailable;
      requestQty = remainingAvailable;

      if (unit == 'CAJAS') {
        cantidadEnvases = requestQty;
        if (!product.isDualFieldProduct) cantidadUnidades = 0;
      } else {
        cantidadUnidades = requestQty;
        if (!product.isDualFieldProduct) cantidadEnvases = 0;
      }
    }

    if (existingIdx >= 0) {
      final line = _lines[existingIdx];
      final lineUnit = line.unidadMedida.trim().toUpperCase();

      if (lineUnit != unit && requestQty > 0) {
        final unitLabel = line.unidadMedida.isNotEmpty
            ? line.unidadMedida.toLowerCase()
            : 'unidad actual';
        final msg =
            'Este producto ya esta en el carrito en $unitLabel. Edita esa linea para cambiar unidad.';
        _error = msg;
        notifyListeners();
        return msg;
      }

      final currentQty =
          lineUnit == 'CAJAS' ? line.cantidadEnvases : line.cantidadUnidades;
      final newQty = currentQty + requestQty;

      if (product.isDualFieldProduct) {
        line.cantidadEnvases += cantidadEnvases;
        line.cantidadUnidades += cantidadUnidades;
      } else {
        if (lineUnit == 'CAJAS') {
          line.cantidadEnvases = newQty;
          line.cantidadUnidades = 0;
        } else if (lineUnit == 'KILOGRAMOS' || lineUnit == 'LITROS') {
          line.cantidadEnvases = 0;
          line.cantidadUnidades = newQty;
        } else {
          // Dynamic units (ESTUCHES, BANDEJAS, PIEZAS, UNIDADES, etc)
          line.cantidadEnvases = 0;
          line.cantidadUnidades = newQty;
        }
      }
      line.unidadesCaja = product.quantityPerBoxForUnit(unit);
      line.unidadesFraccion = product.unitsFraction;
      line.precioVenta = precioVenta;
      line.precioCosto = product.costForUnit(unit);
      line.precioTarifa = product.precioTarifa1;
      line.precioTarifaCliente = product.precioCliente;
      line.precioMinimo = product.minimumPriceForUnit(unit);
      line.recalculate();
      _lastQtyByProduct[_qtyKey(product.code)] =
          lineUnit == 'CAJAS' ? line.cantidadEnvases : line.cantidadUnidades;
      _lastUnitByProduct[_qtyKey(product.code)] = line.unidadMedida;
    } else {
      final ivaRate = ivaRateFromCode(product.codigoIva);
      final line = OrderLine(
        codigoArticulo: product.code,
        descripcion: product.name,
        cantidadEnvases: product.isDualFieldProduct
            ? cantidadEnvases
            : (unit == 'CAJAS' ? requestQty : 0),
        cantidadUnidades: product.isDualFieldProduct
            ? cantidadUnidades
            : (unit == 'CAJAS' ? 0 : requestQty),
        unidadMedida: unit,
        unidadesCaja: product.quantityPerBoxForUnit(unit),
        unidadesFraccion: product.unitsFraction,
        precioVenta: precioVenta,
        precioCosto: product.costForUnit(unit),
        precioTarifa: product.precioTarifa1,
        precioTarifaCliente: product.precioCliente,
        precioMinimo: product.minimumPriceForUnit(unit),
        ivaRate: ivaRate,
      );
      line.recalculate();
      _lines.add(line);
      _lastQtyByProduct[_qtyKey(product.code)] = requestQty;
      _lastUnitByProduct[_qtyKey(product.code)] = unit;
    }

    _syncGiftPromotionLines(product.code, product: product);
    _error = null;
    _isDirty = true;
    _invalidateCache();
    _notify();
    return isPartial ? 'PARCIAL:$missingQty|${product.name}' : null;
  }

  String? updateLine(
    int index, {
    double? cantidadEnvases,
    double? cantidadUnidades,
    double? precioVenta,
    String? unidadMedida,
  }) {
    if (index < 0 || index >= _lines.length) return 'Line not found';
    final line = _lines[index];
    final nextUnit = (unidadMedida ?? line.unidadMedida).trim().isEmpty
        ? 'CAJAS'
        : (unidadMedida ?? line.unidadMedida).trim().toUpperCase();

    final wasBoxes = line.unidadMedida.trim().toUpperCase() == 'CAJAS';
    double nextQty;
    if (nextUnit == 'CAJAS') {
      if (cantidadEnvases != null) {
        nextQty = cantidadEnvases;
      } else if (unidadMedida != null && !wasBoxes) {
        nextQty = cantidadUnidades ?? line.cantidadUnidades;
      } else {
        nextQty = line.cantidadEnvases;
      }
    } else {
      if (cantidadUnidades != null) {
        nextQty = cantidadUnidades;
      } else if (unidadMedida != null && wasBoxes) {
        nextQty = cantidadEnvases ?? line.cantidadEnvases;
      } else {
        nextQty = line.cantidadUnidades;
      }
    }

    final pIdx = _products.indexWhere((p) => p.code == line.codigoArticulo);
    final product = pIdx >= 0 ? _products[pIdx] : null;

    if (product != null && product.isDualFieldProduct) {
      if (cantidadEnvases != null) line.cantidadEnvases = cantidadEnvases;
      if (cantidadUnidades != null) line.cantidadUnidades = cantidadUnidades;
    } else {
      if (pIdx >= 0) {
        final maxQty = nextUnit == 'CAJAS'
            ? product!.stockEnvases
            : product!.stockForUnit(nextUnit);
        if (nextQty > maxQty) {
          final msg = nextUnit == 'CAJAS'
              ? 'Stock insuficiente: Solo hay ${product.stockEnvases.toInt()} cajas.'
              : 'Stock insuficiente: Solo hay ${maxQty.toStringAsFixed(2)} ${Product.unitLabel(nextUnit)}.';
          _error = msg;
          notifyListeners();
          return msg;
        }
      }

      line.unidadMedida = nextUnit;
      if (nextUnit == 'CAJAS') {
        line.cantidadEnvases = nextQty;
        line.cantidadUnidades = 0;
      } else {
        line.cantidadEnvases = 0;
        line.cantidadUnidades = nextQty;
      }
    }

    final shouldSyncGifts =
        !line.isAutoGift && line.tipoLinea.trim().toUpperCase() != 'G';
    if (precioVenta != null) line.precioVenta = precioVenta;
    if (pIdx >= 0) {
      final productForUnit = _products[pIdx];
      line.unidadesCaja = productForUnit.quantityPerBoxForUnit(nextUnit);
      line.precioCosto = productForUnit.costForUnit(nextUnit);
      line.precioMinimo = productForUnit.minimumPriceForUnit(nextUnit);
    }
    line.recalculate();
    if (shouldSyncGifts) {
      _syncGiftPromotionLines(
        line.codigoArticulo,
        product: pIdx >= 0 ? _products[pIdx] : null,
      );
    }
    _lastQtyByProduct[_qtyKey(line.codigoArticulo)] = nextQty;
    _lastUnitByProduct[_qtyKey(line.codigoArticulo, _clientCode)] =
        line.unidadMedida;
    _isDirty = true;
    _invalidateCache();
    _notify();
    return null;
  }

  void removeLine(int index) {
    if (index < 0 || index >= _lines.length) return;
    final removed = _lines.removeAt(index);
    if (!removed.isAutoGift && removed.tipoLinea.trim().toUpperCase() != 'G') {
      _syncGiftPromotionLines(
        removed.codigoArticulo,
        product: _productByCode(removed.codigoArticulo),
      );
    }
    if (_lines.isEmpty) {
      _globalDiscountPct = 0;
      _complementaryProducts = [];
    }
    _isDirty = true;
    _invalidateCache();
    _notify();
  }

  void updateLineClaseLinea(int index, String clase) {
    if (index < 0 || index >= _lines.length) return;
    if (!['VT', 'SC'].contains(clase)) return;
    final line = _lines[index];
    line.claseLinea = clase;
    if (clase == 'SC') {
      // SC lines don't contribute to total
      line.precioVenta = 0;
      line.importeVenta = 0;
      line.importeMargen = -line.importeCosto;
      line.porcentajeMargen = 0.0;
    } else {
      // Restore price from tariff cache if available
      final cached = lastPriceForProduct(line.codigoArticulo);
      if (cached != null && cached > 0) {
        line.precioVenta = cached;
      }
      line.recalculate();
    }
    _isDirty = true;
    _invalidateCache();
    _notify();
  }

  void clearOrder() {
    _lines.clear();
    _clientCode = null;
    _clientName = null;
    _saleType = 'CC';
    _globalDiscountPct = 0;
    _products = [];
    _productOffset = 0;
    _hasMoreProducts = false;
    _isDirty = false;
    _lastAutoSaved = null;
    _complementaryProducts = [];
    _clientBalance = {};
    _error = null;
    _invalidateCache();
    _notify();
  }

  List<OrderLine> _buildLinesForSubmit() {
    if (_globalDiscountPct <= 0) return _lines;

    final factor = _discountFactor;
    return _lines.map((line) {
      final discountedPrice =
          double.parse((line.precioVenta * factor).toStringAsFixed(4));
      final copy = OrderLine(
        id: line.id,
        codigoArticulo: line.codigoArticulo,
        descripcion: line.descripcion,
        cantidadEnvases: line.cantidadEnvases,
        cantidadUnidades: line.cantidadUnidades,
        unidadMedida: line.unidadMedida,
        unidadesCaja: line.unidadesCaja,
        unidadesFraccion: line.unidadesFraccion,
        precioVenta: discountedPrice,
        precioCosto: line.precioCosto,
        precioTarifa: line.precioTarifa,
        precioTarifaCliente: line.precioTarifaCliente,
        precioMinimo: line.precioMinimo,
        ivaRate: line.ivaRate,
        claseLinea: line.claseLinea,
        tipoLinea: line.tipoLinea,
        promotionCode: line.promotionCode,
        isAutoGift: line.isAutoGift,
      );
      copy.recalculate();
      return copy;
    }).toList();
  }

  String _promotionProductCode(PromotionItem promo) {
    final productCode = promo.productCode.trim();
    return productCode.isNotEmpty ? productCode : promo.code.trim();
  }

  String _promotionKey(PromotionItem promo) {
    final promoCode = promo.promoCode.trim();
    return promoCode.isNotEmpty ? promoCode : promo.code.trim();
  }

  bool _isManualSaleLine(OrderLine line, String productCode) {
    return line.codigoArticulo == productCode &&
        !line.isAutoGift &&
        line.tipoLinea.trim().toUpperCase() != 'G';
  }

  Product? _productByCode(String productCode) {
    for (final product in _products) {
      if (product.code == productCode) return product;
    }
    return null;
  }

  OrderLine? _firstManualSaleLine(String productCode) {
    for (final line in _lines) {
      if (_isManualSaleLine(line, productCode)) return line;
    }
    return null;
  }

  double _manualSaleQuantity(String productCode) {
    var total = 0.0;
    for (final line in _lines) {
      if (_isManualSaleLine(line, productCode)) {
        total += line.billingQuantity;
      }
    }
    return total;
  }

  void _removeAutoGiftLines(String productCode, {String? promotionCode}) {
    _lines.removeWhere((line) {
      if (!line.isAutoGift || line.codigoArticulo != productCode) return false;
      if (promotionCode == null || promotionCode.isEmpty) return true;
      return line.promotionCode == promotionCode;
    });
  }

  void _syncGiftPromotionLines(String productCode, {Product? product}) {
    final promo = _activePromotions[productCode];
    if (promo == null ||
        !promo.isGift ||
        promo.minQty <= 0 ||
        promo.giftQty <= 0) {
      _removeAutoGiftLines(productCode);
      return;
    }

    final promotionCode = _promotionKey(promo);
    final saleLine = _firstManualSaleLine(productCode);
    final saleQty = _manualSaleQuantity(productCode);
    _removeAutoGiftLines(productCode, promotionCode: promotionCode);

    if (saleLine == null || saleQty < promo.minQty) return;

    final multiplier = promo.cumulative ? (saleQty / promo.minQty).floor() : 1;
    final giftLineCount = (multiplier * promo.giftQty).floor();
    if (giftLineCount <= 0) return;

    final sourceProduct = product ?? _productByCode(productCode);
    final unit = saleLine.unidadMedida.trim().isEmpty
        ? (sourceProduct?.displayUnit ?? 'CAJAS')
        : saleLine.unidadMedida.trim().toUpperCase();
    final unitsPerBox = sourceProduct?.quantityPerBoxForUnit(unit) ??
        (saleLine.unidadesCaja > 0 ? saleLine.unidadesCaja : 1);
    final cost = sourceProduct?.costForUnit(unit) ?? saleLine.precioCosto;
    final tariff = sourceProduct?.precioTarifa1 ?? saleLine.precioTarifa;
    final clientTariff =
        sourceProduct?.precioCliente ?? saleLine.precioTarifaCliente;
    final minPrice =
        sourceProduct?.minimumPriceForUnit(unit) ?? saleLine.precioMinimo;
    final description = sourceProduct?.name ?? saleLine.descripcion;

    for (var i = 0; i < giftLineCount; i++) {
      final giftLine = OrderLine(
        codigoArticulo: productCode,
        descripcion: '$description (Regalo)',
        cantidadEnvases: unit == 'CAJAS' ? 1 : 0,
        cantidadUnidades: unit == 'CAJAS' ? 0 : 1,
        unidadMedida: unit,
        unidadesCaja: unitsPerBox,
        unidadesFraccion:
            sourceProduct?.unitsFraction ?? saleLine.unidadesFraccion,
        precioVenta: 0,
        precioCosto: cost,
        precioTarifa: tariff,
        precioTarifaCliente: clientTariff,
        precioMinimo: minPrice,
        ivaRate: saleLine.ivaRate,
        claseLinea: 'SC',
        tipoLinea: 'G',
        promotionCode: promotionCode,
        isAutoGift: true,
      );
      giftLine.recalculate();
      _lines.add(giftLine);
    }
  }

  void _syncAllGiftPromotionLines() {
    final productCodes = <String>{
      for (final line in _lines) line.codigoArticulo,
      ..._activePromotions.keys,
    };
    for (final code in productCodes) {
      _syncGiftPromotionLines(code);
    }
  }

  // ── Active Promotions ──

  void markAsSaved() {
    _isDirty = false;
    _lastAutoSaved = DateTime.now();
    notifyListeners();
  }

  // ── Order Persistence ──

  Future<Map<String, dynamic>?> confirmOrder(
    String vendedorCode, {
    String observaciones = '',
    String? deliveryDate,
    String? vehicleCode,
    String? driverCode,
    String? routeCode,
  }) async {
    if (_isSaving) {
      return null;
    }

    if (!hasClient || !hasLines) {
      _error = 'Seleccione un cliente y añada al menos un producto';
      notifyListeners();
      return null;
    }

    _isSaving = true;
    _error = null;
    notifyListeners();

    try {
      debugPrint('[confirmOrder] Step 1/3: Building lines for submit');
      final linesForSubmit = _buildLinesForSubmit();
      final obs = observaciones.trim();
      final discountTag = _globalDiscountPct > 0
          ? '[DTO ${_globalDiscountPct.toStringAsFixed(1)}%]'
          : '';
      final fullObservaciones =
          [discountTag, obs].where((s) => s.isNotEmpty).join(' ').trim();

      // Step 1: Create the order
      debugPrint(
          '[confirmOrder] Step 2/3: Calling createOrder API (client=$_clientCode, lines=${linesForSubmit.length})');
      final createResult = await _orderApi.createOrder(
        clientCode: _clientCode!,
        clientName: _clientName ?? '',
        vendedorCode: vendedorCode,
        tipoVenta: _saleType,
        lines: linesForSubmit,
        observaciones: fullObservaciones,
      );
      debugPrint('[confirmOrder] createOrder result id=${createResult['id']}');

      if (createResult['id'] == null) {
        _error = 'Error al crear el pedido';
        debugPrint('[confirmOrder] FAILED: createOrder returned null id');
        return null;
      }

      // Step 2: Immediately confirm the order (set to CONFIRMADO)
      final orderId = createResult['id'] as int;
      debugPrint(
          '[confirmOrder] Step 3/3: Calling confirmOrder API (orderId=$orderId, saleType=$_saleType, deliveryDate=$deliveryDate)');
      final confirmedResult = await _orderApi.confirmOrder(
        orderId,
        _saleType,
        deliveryDate: deliveryDate,
        vehicleCode: vehicleCode,
        driverCode: driverCode,
        routeCode: routeCode,
      );
      debugPrint(
          '[confirmOrder] confirmOrder result keys=${confirmedResult.keys.toList()}');

      final result = normalizeConfirmOrderResultForProvider(
        createResult: Map<String, dynamic>.from(createResult),
        confirmedResult: Map<String, dynamic>.from(confirmedResult),
      );

      if (shouldClearCartAfterConfirmation(result)) {
        // Clear cart only after a real confirmation. Stock-blocked confirmations
        // keep the cart intact so the user can fix quantities instead of seeing
        // an intermediate BORRADOR reported as confirmed.
        _lines.clear();
        _clientCode = null;
        _clientName = null;
        _saleType = 'CC';
        _globalDiscountPct = 0;
        _complementaryProducts = [];
        _clientBalance = {};
      }

      // Always refresh orders list + stats after any confirmation attempt
      // so "Mis Pedidos" shows the new order immediately.
      if (_refreshAfterConfirm) {
        await refreshOrdersAndStats();
      }

      debugPrint(
          '[confirmOrder] SUCCESS: order confirmed, result keys=${result.keys.toList()}');
      return result;
    } catch (e, st) {
      debugPrint('[confirmOrder] ERROR: $e');
      debugPrint('[confirmOrder] STACK: $st');
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
    String? dateFrom,
    String? dateTo,
    String? search,
    double? minAmount,
    double? maxAmount,
    String sortBy = 'fecha',
    String sortOrder = 'DESC',
  }) async {
    _vendedorCodes = vendedorCodes;
    _isLoadingOrders = true;
    _orderStatusFilter = status;
    _error = null;
    final generation = ++_ordersLoadGeneration;
    notifyListeners();

    try {
      final orders = await PedidosService.getOrders(
        vendedorCodes: vendedorCodes,
        status: status,
        forceRefresh: forceRefresh,
        dateFrom: dateFrom,
        dateTo: dateTo,
        search: search,
        minAmount: minAmount,
        maxAmount: maxAmount,
        sortBy: sortBy,
        sortOrder: sortOrder,
      );
      if (generation != _ordersLoadGeneration) return;
      _orders = orders;
    } catch (e) {
      if (generation == _ordersLoadGeneration) {
        _error = e.toString();
      }
    } finally {
      if (generation == _ordersLoadGeneration) {
        _isLoadingOrders = false;
        notifyListeners();
      }
    }
  }

  /// Refresh stats + orders list after any order state change
  Future<void> refreshOrdersAndStats() async {
    await Future.wait([
      loadOrders(
        vendedorCodes: _vendedorCodes,
        status: _orderStatusFilter,
        forceRefresh: true,
      ),
      loadOrderStats(
        vendedorCodes: _vendedorCodes,
        forceRefresh: true,
      ),
    ]);
  }

  Future<void> loadOrderStats({
    required String vendedorCodes,
    String? dateFrom,
    String? dateTo,
    bool forceRefresh = false,
  }) async {
    _isLoadingStats = true;
    notifyListeners();
    try {
      _orderStats = await PedidosService.getOrderStats(
        vendedorCodes: vendedorCodes,
        dateFrom: dateFrom,
        dateTo: dateTo,
        forceRefresh: forceRefresh,
      );
    } catch (e) {
      debugPrint('[PedidosProvider] loadOrderStats error: $e');
      // FIX 2026-05-15: no dejar _orderStats=null si hay error.
      // Inicializar con stats vacios para que la UI no muestre spinner eterno.
      _orderStats ??= OrderStats(
        totalOrders: 0,
        totalAmount: 0,
        totalBase: 0,
        totalIva: 0,
        avgMargin: 0,
        avgTicket: 0,
        byStatus: const <String, int>{},
        dailyTrend: const <Map<String, dynamic>>[],
        topClients: const <Map<String, dynamic>>[],
      );
    } finally {
      _isLoadingStats = false;
      notifyListeners();
    }
  }

  void setOrderStatusFilter(String? status) {
    _orderStatusFilter = status;
    notifyListeners();
  }

  Future<void> cancelExistingOrder(int orderId) async {
    await PedidosService.cancelOrder(orderId);

    // Update local state instantly
    final idx = _orders.indexWhere((o) => o.id == orderId);
    if (idx != -1) {
      final o = _orders[idx];
      _orders[idx] = OrderSummary(
        id: o.id,
        numeroPedido: o.numeroPedido,
        clienteCode: o.clienteCode,
        clienteName: o.clienteName,
        vendedorCode: o.vendedorCode,
        fecha: o.fecha,
        estado: 'ANULADO',
        tipoVenta: o.tipoVenta,
        total: o.total,
        margen: o.margen,
        lineCount: o.lineCount,
      );
      notifyListeners();
    }
    await refreshOrdersAndStats();
  }

  Future<Map<String, dynamic>> confirmExistingOrder(
    int orderId,
    String saleType,
  ) async {
    final confirmedResult =
        await PedidosService.confirmOrder(orderId, saleType);
    final result = normalizeConfirmOrderResultForProvider(
      createResult: {'id': orderId},
      confirmedResult: Map<String, dynamic>.from(confirmedResult),
    );

    if (!isConfirmedOrderResultForProvider(result)) {
      final message = result['message']?.toString().trim();
      final status = orderConfirmationStatusForProvider(result);
      throw Exception(
        message != null && message.isNotEmpty
            ? message
            : 'Pedido no confirmado. Estado actual: '
                '${status.isEmpty ? 'DESCONOCIDO' : status}',
      );
    }

    // Update local state instantly
    final idx = _orders.indexWhere((o) => o.id == orderId);
    if (idx != -1) {
      final o = _orders[idx];
      _orders[idx] = OrderSummary(
        id: o.id,
        numeroPedido: o.numeroPedido,
        clienteCode: o.clienteCode,
        clienteName: o.clienteName,
        vendedorCode: o.vendedorCode,
        fecha: o.fecha,
        estado: orderConfirmationStatusForProvider(result),
        tipoVenta: saleType,
        total: o.total,
        margen: o.margen,
        lineCount: o.lineCount,
      );
      notifyListeners();
    }
    await refreshOrdersAndStats();
    return result;
  }

  Future<void> setOrderPendingApproval(int orderId) async {
    await PedidosService.updateOrderStatus(orderId, 'PENDIENTE_APROBACION');

    final idx = _orders.indexWhere((o) => o.id == orderId);
    if (idx != -1) {
      final o = _orders[idx];
      _orders[idx] = OrderSummary(
        id: o.id,
        numeroPedido: o.numeroPedido,
        clienteCode: o.clienteCode,
        clienteName: o.clienteName,
        vendedorCode: o.vendedorCode,
        fecha: o.fecha,
        estado: 'PENDIENTE_APROBACION',
        tipoVenta: o.tipoVenta,
        total: o.total,
        margen: o.margen,
        lineCount: o.lineCount,
      );
      notifyListeners();
    }
    await refreshOrdersAndStats();
  }

  Future<void> sendOrder(int orderId) async {
    await PedidosService.updateOrderStatus(orderId, 'ENVIADO');

    final idx = _orders.indexWhere((o) => o.id == orderId);
    if (idx != -1) {
      final o = _orders[idx];
      _orders[idx] = OrderSummary(
        id: o.id,
        numeroPedido: o.numeroPedido,
        clienteCode: o.clienteCode,
        clienteName: o.clienteName,
        vendedorCode: o.vendedorCode,
        fecha: o.fecha,
        estado: 'ENVIADO',
        tipoVenta: o.tipoVenta,
        total: o.total,
        margen: o.margen,
        lineCount: o.lineCount,
      );
      notifyListeners();
    }
    await refreshOrdersAndStats();
  }

  // ── Recommendations ──

  Future<void> loadRecommendations({
    required String clientCode,
    required String vendedorCode,
  }) async {
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

  Future<void> saveDraft(String vendedorCode, {bool isAutoSave = false}) async {
    if (!hasClient || (!hasLines && !isAutoSave)) return;
    try {
      if (isAutoSave && hasLines) {
        await PedidosOfflineService.saveAutoDraft(
          clientCode: _clientCode!,
          clientName: _clientName ?? '',
          saleType: _saleType,
          vendedorCode: vendedorCode,
          lines: _lines,
        );
        _lastAutoSaved = DateTime.now();
        _isDirty = false;
      } else if (!isAutoSave) {
        await PedidosOfflineService.saveDraft(
          draftKey:
              'draft_manual_${_clientCode}_${DateTime.now().millisecondsSinceEpoch}',
          clientCode: _clientCode!,
          clientName: _clientName ?? '',
          saleType: _saleType,
          vendedorCode: vendedorCode,
          lines: _lines,
        );
        _isDirty = false;
        _lastAutoSaved = DateTime.now();
      }
      notifyListeners();
    } catch (e) {
      debugPrint('[PedidosProvider] saveDraft error: $e');
    }
  }

  void loadDraft(Map<String, dynamic> draft) {
    _clientCode = draft['clientCode'] as String?;
    _clientName = draft['clientName'] as String?;
    _saleType = (draft['saleType'] as String?) ?? 'CC';
    _globalDiscountPct = 0;
    _complementaryProducts = [];
    _lines.clear();
    final linesData = draft['lines'] as List? ?? [];
    for (final l in linesData) {
      final line = OrderLine.fromJson(l as Map<String, dynamic>);
      line.recalculate();
      _lines.add(line);
      _lastQtyByProduct[_qtyKey(line.codigoArticulo)] = line.cantidadEnvases > 0
          ? line.cantidadEnvases
          : line.cantidadUnidades;
      _lastUnitByProduct[_qtyKey(line.codigoArticulo)] = line.unidadMedida;
    }
    _error = null;
    _invalidateCache();
    _notify();
  }

  Future<void> deleteDraft(String key) async {
    try {
      await PedidosOfflineService.deleteDraft(key);
      notifyListeners();
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
    // Persistir en Hive: sin esto los favoritos se perdían al reiniciar
    // la app (solo vivían en memoria).
    unawaited(
      PedidosFavoritesService.toggleFavorite(productCode)
          .catchError((Object e) {
        debugPrint('[PedidosProvider] toggleFavorite persist error: $e');
      }),
    );
    notifyListeners();
  }

  bool isFavorite(String productCode) =>
      _favoriteProductCodes.contains(productCode);

  // ── Complementary Products & Promotions ──
  Future<void> loadComplementaryProducts() async {
    if (_lines.isEmpty) {
      _complementaryProducts = [];
      notifyListeners();
      return;
    }
    try {
      final codes = _lines.map((l) => l.codigoArticulo).toList();
      _complementaryProducts = await PedidosService.getComplementaryProducts(
        codes,
        clientCode: _clientCode,
      );
      notifyListeners();
    } catch (e) {
      debugPrint('[PedidosProvider] loadComplementaryProducts error: $e');
    }
  }

  Future<void> loadPromotions() async {
    if (!hasClient) {
      _activePromotionsList.clear();
      _activePromotions.clear();
      notifyListeners();
      return;
    }

    try {
      final response = await ApiClient.get(
        '/pedidos/promotions',
        queryParameters: {'clientCode': _clientCode},
        cacheKey: 'pedidos:promotions:$_clientCode',
        cacheTTL: CacheService.defaultTTL,
      );
      final list = response['promotions'] as List? ?? [];
      _activePromotionsList.clear();
      _activePromotions.clear();
      final seen = <String>{};
      for (final p in list) {
        final item = PromotionItem.fromJson(p as Map<String, dynamic>);
        // Normalize numeric values to avoid float string inconsistencies
        final minQtyStr = item.minQty.toStringAsFixed(2);
        final giftQtyStr = item.giftQty.toStringAsFixed(2);
        final promoPriceStr = item.promoPrice.toStringAsFixed(2);
        final key =
            '${item.promoType}|${item.promoCode}|${item.code}|${item.dateFrom}|${item.dateTo}|$minQtyStr|$giftQtyStr|$promoPriceStr';
        final productCode = _promotionProductCode(item);
        if (productCode.isNotEmpty && seen.add(key)) {
          _activePromotionsList.add(item);
          // Store ALL promotions per product (not just the first one)
          _activePromotions.putIfAbsent(productCode, () => item);
        }
      }
      _syncAllGiftPromotionLines();
      debugPrint(
          '[PedidosProvider] Loaded ${_activePromotionsList.length} promotions for $_clientCode');
      _invalidateCache();
      notifyListeners();
    } catch (e, stack) {
      debugPrint('[PedidosProvider] loadPromotions error: $e');
      debugPrint('[PedidosProvider] loadPromotions stack: $stack');
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
      _globalDiscountPct = 0;
      _complementaryProducts = [];
      _lines.clear();
      final linesData = data['lines'] as List? ?? [];
      for (final l in linesData) {
        final line = OrderLine.fromJson(l as Map<String, dynamic>);
        line.recalculate();
        _lines.add(line);
        _lastQtyByProduct[_qtyKey(line.codigoArticulo)] =
            line.cantidadEnvases > 0
                ? line.cantidadEnvases
                : line.cantidadUnidades;
        _lastUnitByProduct[_qtyKey(line.codigoArticulo)] = line.unidadMedida;
      }
      _error = null;
      notifyListeners();
    } catch (e) {
      _error = 'Error al clonar pedido: $e';
      _notify(immediate: true);
    }
  }

  // ── Batch Add from Recommendations ──
  void addMultipleProducts(List<Product> products, double defaultQty) {
    for (final product in products) {
      final existingIdx =
          _lines.indexWhere((l) => l.codigoArticulo == product.code);
      if (existingIdx < 0) {
        final ivaRate = ivaRateFromCode(product.codigoIva);
        final line = OrderLine(
          codigoArticulo: product.code,
          descripcion: product.name,
          cantidadEnvases: defaultQty,
          unidadesCaja: product.unitsPerBox,
          precioVenta: product.bestPrice,
          precioCosto: product.precioCosto > 0
              ? product.precioCosto
              : (product.precioMinimo > 0
                  ? product.precioMinimo * 0.7
                  : product.precioTarifa1 * 0.7),
          precioTarifa: product.precioTarifa1,
          precioTarifaCliente: product.precioCliente,
          precioMinimo: product.precioMinimo,
          ivaRate: ivaRate,
        );
        line.recalculate();
        _lines.add(line);
        _lastQtyByProduct[_qtyKey(product.code)] = defaultQty;
        _lastUnitByProduct[_qtyKey(product.code)] = line.unidadMedida;
        _syncGiftPromotionLines(product.code, product: product);
      }
    }
    _error = null;
    _invalidateCache();
    _notify();
  }

  // ── Stock Auto-Refresh for Cart Lines (Parallel) ──
  Future<void> refreshCartStock() async {
    if (_lines.isEmpty) return;

    try {
      final stockByCode = await PedidosService.getStockBatch(
        _lines.map((line) => line.codigoArticulo),
      );
      for (final entry in stockByCode.entries) {
        _applyStockToProduct(entry.key, entry.value);
      }
      notifyListeners();
    } catch (e) {
      debugPrint('[PedidosProvider] refreshCartStock batch error: $e');
    }
  }

  List<Map<String, dynamic>> get savedDrafts =>
      PedidosOfflineService.getDrafts();
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

  @visibleForTesting
  void debugSetPromotions(List<PromotionItem> promotions) {
    _activePromotionsList
      ..clear()
      ..addAll(promotions);
    _activePromotions.clear();
    final seen = <String>{};
    for (final promo in promotions) {
      final productCode =
          promo.productCode.isNotEmpty ? promo.productCode : promo.code;
      if (productCode.isNotEmpty && seen.add(productCode)) {
        _activePromotions[productCode] = promo;
      }
    }
    _syncAllGiftPromotionLines();
    _invalidateCache();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
