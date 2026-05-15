/// Pedidos Provider
/// =================
/// ChangeNotifier for order state management
/// Manages cart (current order), product catalog, and order history
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
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
  PedidosProvider({PedidosOrderApi? orderApi})
      : _orderApi = orderApi ?? const PedidosServiceOrderApi();

  final PedidosOrderApi _orderApi;

  // â”€â”€ Cart State (current order being built) â”€â”€
  final List<OrderLine> _lines = [];
  String? _clientCode;
  String? _clientName;
  String _saleType = 'CC'; // CC=Venta, VC=Sin Nombre, NV=No Venta

  // â”€â”€ Product Catalog State â”€â”€
  List<Product> _products = [];
  bool _isLoadingProducts = false;
  String? _productSearch;
  String? _selectedFamily;
  String? _selectedBrand;
  List<String> _families = [];
  List<String> _brands = [];
  int _productOffset = 0;
  bool _hasMoreProducts = true;

  // â”€â”€ Orders List State â”€â”€
  List<OrderSummary> _orders = [];
  bool _isLoadingOrders = false;
  String? _orderStatusFilter;
  String _vendedorCodes = 'ALL';

  // â”€â”€ Order Stats â”€â”€
  OrderStats? _orderStats;
  bool _isLoadingStats = false;

  // â”€â”€ Recommendations â”€â”€
  List<Recommendation> _clientHistory = [];
  List<Recommendation> _similarClients = [];

  // â”€â”€ General â”€â”€
  bool _isSaving = false;
  String? _error;

  // Req #2: Visibilidad de márgenes / costes según rol.
  // JEFE_VENTAS y ADMIN ven márgenes; COMERCIAL/REPARTIDOR no.
  bool _isJefeVentas = false;
  String _userRole = 'COMERCIAL';

  // Req #8: Estado del aviso de borradores acumulados.
  String? _draftWarningMessage;
  int _accumulatedDraftCount = 0;

  // â”€â”€ Client Balance â”€â”€
  Map<String, dynamic> _clientBalance = {};

  // â”€â”€ Favorites (Hive-based, local) â”€â”€
  final Set<String> _favoriteProductCodes = {};

  // â”€â”€ Auto-save â”€â”€
  DateTime? _lastAutoSaved;
  bool _isDirty = false;

  // â”€â”€ Stock Filter â”€â”€
  bool _onlyWithStock = false;

  // â”€â”€ Last Qty per Product (B3) â”€â”€
  final Map<String, double> _lastQtyByProduct = {};
  final Map<String, String> _lastUnitByProduct = {};
  // â”€â”€ Last selected tariff price per product (override from TarifaSelectorModal) â”€â”€
  final Map<String, double> _lastPriceByProduct = {};

  // â”€â”€ Global Discount (C5) â”€â”€
  double _globalDiscountPct = 0;

  // â”€â”€ Complementary Products & Promotions â”€â”€
  List<Map<String, dynamic>> _complementaryProducts = [];
  final List<PromotionItem> _activePromotionsList = [];
  final Map<String, PromotionItem> _activePromotions = {};

  // â”€â”€ Analytics â”€â”€
  Map<String, dynamic> _analytics = {};
  bool _isLoadingAnalytics = false;

  String _qtyKey(String productCode, [String? clientCode]) {
    final product = productCode.trim();
    final client = (clientCode ?? _clientCode ?? '').trim();
    return '${client.isEmpty ? '_noclient_' : client}|$product';
  }

  double get _discountFactor => 1 - (_globalDiscountPct / 100);

  // â”€â”€ Getters â”€â”€
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
  bool get isMarginVisible => _isJefeVentas; // Solo JEFE_VENTAS/ADMIN ven margen.
  String get userRole => _userRole;

  /// Actualiza el rol del usuario logueado (e.g. al iniciar sesión o
  /// cuando authProvider cambia). Notifica para que las vistas se
  /// repinten ocultando/mostrando márgenes según corresponda.
  void setUserRole(String? role) {
    final normalized = (role ?? '').trim().toUpperCase();
    final next = normalized == 'JEFE_VENTAS' || normalized == 'ADMIN';
    if (next == _isJefeVentas && normalized == _userRole) return;
    _isJefeVentas = next;
    _userRole = normalized.isEmpty ? 'COMERCIAL' : normalized;
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
      final raw = await ApiClient.get('/pedidos/draft-status/$code');
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
  double get totalDescuento => totalImporte * _globalDiscountPct / 100;
  double get totalConDescuento => totalImporte - totalDescuento;
  double get totalBase => _lines.fold(0, (s, l) {
        final saleAfterDiscount = l.importeVenta * _discountFactor;
        return s + saleAfterDiscount / (1 + l.ivaRate);
      });
  double get totalIva => totalConDescuento - totalBase;
  Map<double, double> get ivaBreakdown {
    final map = <double, double>{};
    for (final l in _lines) {
      if (l.ivaRate > 0) {
        final saleAfterDiscount = l.importeVenta * _discountFactor;
        final iva = saleAfterDiscount - (saleAfterDiscount / (1 + l.ivaRate));
        map[l.ivaRate] = (map[l.ivaRate] ?? 0) + iva;
      }
    }
    return map;
  }

  bool get hasClient => _clientCode != null && _clientCode!.isNotEmpty;
  bool get hasLines => _lines.isNotEmpty;
  int get lineCount => _lines.length;

  double get totalEnvases =>
      _lines.fold(0, (sum, l) => sum + l.cantidadEnvases);
  double get totalUnidades =>
      _lines.fold(0, (sum, l) => sum + l.cantidadUnidades);
  double get totalImporte => _lines.fold(0, (sum, l) => sum + l.importeVenta);
  double get totalCosto => _lines.fold(0, (sum, l) => sum + l.importeCosto);
  double get totalMargen => totalConDescuento - totalCosto;
  double get porcentajeMargen =>
      totalConDescuento > 0 ? (totalMargen / totalConDescuento) * 100 : 0;

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

  // â”€â”€ Client â”€â”€

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
    notifyListeners();
  }

  void reorderLines(int oldIndex, int newIndex) {
    if (newIndex > oldIndex) newIndex--;
    final item = _lines.removeAt(oldIndex);
    _lines.insert(newIndex, item);
    notifyListeners();
  }

  // â”€â”€ Product Catalog â”€â”€

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
    notifyListeners();

    try {
      final results = await PedidosService.getProducts(
        vendedorCodes: vendedorCodes,
        search: search,
        clientCode: _clientCode,
        family: _selectedFamily,
        marca: _selectedBrand,
        prefamily: _selectedPrefamily,
        offset: _productOffset,
        forceRefresh: forceRefresh,
      );

      final filtered =
          _onlyWithStock ? results.where((p) => p.hasStock).toList() : results;
      if (reset) {
        _products = filtered;
      } else {
        _products = [..._products, ...filtered];
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

  // â”€â”€ Stock Refresh â”€â”€

  Future<void> refreshStock(String productCode) async {
    try {
      final stock = await PedidosService.getStock(productCode);
      final idx = _products.indexWhere((p) => p.code == productCode);
      if (idx >= 0) {
        final p = _products[idx];
        _products[idx] = Product(
          code: p.code,
          name: p.name,
          brand: p.brand,
          family: p.family,
          unitsPerBox: p.unitsPerBox,
          unitsFraction: p.unitsFraction,
          unitsRetractil: p.unitsRetractil,
          unitMeasure: p.unitMeasure,
          weight: p.weight,
          stockEnvases: stock['envases'] ?? p.stockEnvases,
          stockUnidades: stock['unidades'] ?? p.stockUnidades,
          precioTarifa1: p.precioTarifa1,
          precioMinimo: p.precioMinimo,
          precioCliente: p.precioCliente,
        );
        notifyListeners();
      }
    } catch (e) {
      debugPrint('[PedidosProvider] refreshStock error: $e');
    }
  }

  // â”€â”€ Cart Operations â”€â”€

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
      notifyListeners();
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
      line.precioVenta = precioVenta;
      line.recalculate();
      _lastQtyByProduct[_qtyKey(product.code)] =
          lineUnit == 'CAJAS' ? line.cantidadEnvases : line.cantidadUnidades;
      _lastUnitByProduct[_qtyKey(product.code)] = line.unidadMedida;
    } else {
      final ivaCode = product.codigoIva;
      final ivaRate = ivaCode == '1'
          ? 0.10
          : ivaCode == '2'
              ? 0.04
              : ivaCode == '3'
                  ? 0.0
                  : 0.21;
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
        precioCosto: product.precioMinimo > 0
            ? product.precioMinimo * 0.7
            : product.precioTarifa1 * 0.7,
        precioTarifa: product.precioTarifa1,
        precioTarifaCliente: product.precioCliente,
        precioMinimo: product.precioMinimo,
        ivaRate: ivaRate,
      );
      line.recalculate();
      _lines.add(line);
      _lastQtyByProduct[_qtyKey(product.code)] = requestQty;
      _lastUnitByProduct[_qtyKey(product.code)] = unit;
    }

    _error = null;
    _isDirty = true;
    notifyListeners();
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

    if (precioVenta != null) line.precioVenta = precioVenta;
    if (pIdx >= 0) {
      line.unidadesCaja = _products[pIdx].quantityPerBoxForUnit(nextUnit);
    }
    line.recalculate();
    _lastQtyByProduct[_qtyKey(line.codigoArticulo)] = nextQty;
    _lastUnitByProduct[_qtyKey(line.codigoArticulo, _clientCode)] =
        line.unidadMedida;
    _isDirty = true;
    notifyListeners();
    return null;
  }

  void removeLine(int index) {
    if (index < 0 || index >= _lines.length) return;
    _lines.removeAt(index);
    if (_lines.isEmpty) {
      _globalDiscountPct = 0;
      _complementaryProducts = [];
    }
    _isDirty = true;
    notifyListeners();
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
      line.porcentajeMargen = 0;
    } else {
      // Restore price from tariff cache if available
      final cached = lastPriceForProduct(line.codigoArticulo);
      if (cached != null && cached > 0) {
        line.precioVenta = cached;
      }
      line.recalculate();
    }
    _isDirty = true;
    notifyListeners();
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
    notifyListeners();
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
      );
      copy.recalculate();
      return copy;
    }).toList();
  }

  // â”€â”€ Active Promotions â”€â”€

  void markAsSaved() {
    _isDirty = false;
    _lastAutoSaved = DateTime.now();
    notifyListeners();
  }

  // â”€â”€ Order Persistence â”€â”€

  Future<Map<String, dynamic>?> confirmOrder(
    String vendedorCode, {
    String observaciones = '',
    String? deliveryDate,
    String? vehicleCode,
    String? driverCode,
    String? routeCode,
  }) async {
    if (!hasClient || !hasLines) {
      _error = 'Seleccione un cliente y añada al menos un producto';
      notifyListeners();
      return null;
    }

    _isSaving = true;
    _error = null;
    notifyListeners();

    try {
      final linesForSubmit = _buildLinesForSubmit();
      final obs = observaciones.trim();
      final discountTag = _globalDiscountPct > 0
          ? '[DTO ${_globalDiscountPct.toStringAsFixed(1)}%]'
          : '';
      final fullObservaciones =
          [discountTag, obs].where((s) => s.isNotEmpty).join(' ').trim();

      // Step 1: Create the order
      final createResult = await _orderApi.createOrder(
        clientCode: _clientCode!,
        clientName: _clientName ?? '',
        vendedorCode: vendedorCode,
        tipoVenta: _saleType,
        lines: linesForSubmit,
        observaciones: fullObservaciones,
      );

      if (createResult['id'] == null) {
        _error = 'Error al crear el pedido';
        return null;
      }

      // Step 2: Immediately confirm the order (set to CONFIRMADO)
      final orderId = createResult['id'] as int;
      final confirmedResult = await _orderApi.confirmOrder(
        orderId,
        _saleType,
        deliveryDate: deliveryDate,
        vehicleCode: vehicleCode,
        driverCode: driverCode,
        routeCode: routeCode,
      );

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

        // Refresh orders list + stats in background
        refreshOrdersAndStats();
      }

      return result;
    } catch (e) {
      _error = e.toString();
      return null;
    } finally {
      _isSaving = false;
      notifyListeners();
    }
  }

  // â”€â”€ Orders List â”€â”€

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
    notifyListeners();

    try {
      _orders = await PedidosService.getOrders(
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
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoadingOrders = false;
      notifyListeners();
    }
  }

  /// Refresh stats + orders list after any order state change
  Future<void> refreshOrdersAndStats() async {
    await loadOrders(
      vendedorCodes: _vendedorCodes,
      status: _orderStatusFilter,
      forceRefresh: true,
    );
    await loadOrderStats(
      vendedorCodes: _vendedorCodes,
      forceRefresh: true,
    );
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
    // Refresh stats + full list in background
    refreshOrdersAndStats();
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
    // Refresh stats + full list in background
    refreshOrdersAndStats();
    return result;
  }

  Future<void> setOrderPendingApproval(int orderId) async {
    await PedidosService.updateOrderStatus(orderId, 'PENDIENTE');

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
        estado: 'PENDIENTE',
        tipoVenta: o.tipoVenta,
        total: o.total,
        margen: o.margen,
        lineCount: o.lineCount,
      );
      notifyListeners();
    }
    refreshOrdersAndStats();
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
    refreshOrdersAndStats();
  }

  // â”€â”€ Recommendations â”€â”€

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

  // â”€â”€ Offline Support â”€â”€

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
    notifyListeners();
  }

  Future<void> deleteDraft(String key) async {
    try {
      await PedidosOfflineService.deleteDraft(key);
      notifyListeners();
    } catch (e) {
      debugPrint('[PedidosProvider] deleteDraft error: $e');
    }
  }

  // â”€â”€ Client Balance â”€â”€
  Future<void> loadClientBalance(String clientCode) async {
    try {
      _clientBalance = await PedidosService.getClientBalance(clientCode);
      notifyListeners();
    } catch (e) {
      debugPrint('[PedidosProvider] loadClientBalance error: $e');
    }
  }

  // â”€â”€ Favorites (Hive-based) â”€â”€
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

  bool isFavorite(String productCode) =>
      _favoriteProductCodes.contains(productCode);

  // â”€â”€ Complementary Products & Promotions â”€â”€
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
        if (item.code.isNotEmpty && seen.add(key)) {
          _activePromotionsList.add(item);
          // Store ALL promotions per product (not just the first one)
          _activePromotions.putIfAbsent(item.code, () => item);
        }
      }
      debugPrint(
          '[PedidosProvider] Loaded ${_activePromotionsList.length} promotions for $_clientCode');
      notifyListeners();
    } catch (e, stack) {
      debugPrint('[PedidosProvider] loadPromotions error: $e');
      debugPrint('[PedidosProvider] loadPromotions stack: $stack');
    }
  }

  // â”€â”€ Analytics â”€â”€
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

  // â”€â”€ Clone Order into Cart â”€â”€
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
      notifyListeners();
    }
  }

  // â”€â”€ Batch Add from Recommendations â”€â”€
  void addMultipleProducts(List<Product> products, double defaultQty) {
    for (final product in products) {
      final existingIdx =
          _lines.indexWhere((l) => l.codigoArticulo == product.code);
      if (existingIdx < 0) {
        final ivaCode = product.codigoIva;
        final ivaRate = ivaCode == '1'
            ? 0.10
            : ivaCode == '2'
                ? 0.04
                : ivaCode == '3'
                    ? 0.0
                    : 0.21;
        final line = OrderLine(
          codigoArticulo: product.code,
          descripcion: product.name,
          cantidadEnvases: defaultQty,
          unidadesCaja: product.unitsPerBox,
          precioVenta: product.bestPrice,
          precioCosto: product.precioMinimo > 0
              ? product.precioMinimo * 0.7
              : product.precioTarifa1 * 0.7,
          precioTarifa: product.precioTarifa1,
          precioTarifaCliente: product.precioCliente,
          precioMinimo: product.precioMinimo,
          ivaRate: ivaRate,
        );
        line.recalculate();
        _lines.add(line);
        _lastQtyByProduct[_qtyKey(product.code)] = defaultQty;
        _lastUnitByProduct[_qtyKey(product.code)] = line.unidadMedida;
      }
    }
    _error = null;
    notifyListeners();
  }

  // â”€â”€ Stock Auto-Refresh for Cart Lines (Parallel) â”€â”€
  Future<void> refreshCartStock() async {
    if (_lines.isEmpty) return;

    final futures = <Future<void>>[];
    for (var i = 0; i < _lines.length; i++) {
      futures.add(_refreshSingleLineStock(i));
    }
    await Future.wait(futures);
    notifyListeners();
  }

  Future<void> _refreshSingleLineStock(int index) async {
    try {
      final stock = await PedidosService.getStock(_lines[index].codigoArticulo);
      final pIdx =
          _products.indexWhere((p) => p.code == _lines[index].codigoArticulo);
      if (pIdx >= 0) {
        final p = _products[pIdx];
        _products[pIdx] = Product(
          code: p.code,
          name: p.name,
          brand: p.brand,
          family: p.family,
          unitsPerBox: p.unitsPerBox,
          unitsFraction: p.unitsFraction,
          unitsRetractil: p.unitsRetractil,
          unitMeasure: p.unitMeasure,
          weight: p.weight,
          stockEnvases: stock['envases'] ?? p.stockEnvases,
          stockUnidades: stock['unidades'] ?? p.stockUnidades,
          precioTarifa1: p.precioTarifa1,
          precioMinimo: p.precioMinimo,
          precioCliente: p.precioCliente,
        );
      }
    } catch (e) {
      debugPrint(
        '[PedidosProvider] refreshCartStock error for ${_lines[index].codigoArticulo}: $e',
      );
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

  @override
  void dispose() {
    super.dispose();
  }
}
