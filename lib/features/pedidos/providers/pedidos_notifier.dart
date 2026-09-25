/// Pedidos Notifier (Riverpod Notifier — fase 2).
///
/// Nuevo estado inmutable + [PedidosNotifier] en paralelo al viejo
/// `pedidos_provider.dart` (ChangeNotifier).
///
/// Fase1 portó: estado 117-224, getters/totalizadores 283-613,
/// _invalidateCache (no-op), _notify debounce, _disposed→ref.mounted,
/// setters sync núcleo (setClient, clearClient, saleType, stock filter,
/// catalog sort, global discount, reorder, user role, draft warning,
/// family/brand/prefamily filters, favorites memoria, last price).
///
/// Fase2 porta (este archivo): resto de tramos del viejo provider —
/// loadProducts/CancelToken (689-870), carro + gift sync (875-1375),
/// confirmOrder offline queue + normalize + onOrderMutation→bolsa refresh
/// (1379-1565), orders/stats (1567-1862), drafts (1863-1932),
/// balance (1965-2006), favoritos Hive (2009-2030),
/// complementarios/promos (2035-2144), analytics/clone/addMultiple/
/// refreshCartStock/syncPending (2145-2271).
///
/// Shell denegado en fase2 → NO se migraron los ~99 callers ni se borró el
/// viejo. Ambos providers coexisten.
/// TODO(fase3): migrar callers (pedidos_page addListener→listen/select,
/// resto ref.read→.notifier para métodos), migrar tests a ProviderContainer
/// mismos asserts, verificar `flutter analyze` + `flutter test` en verde y
/// entonces convertir `pedidos_provider.dart` en re-export deprecated o
/// borrarlo.
/// TODO(fase3): verificar compilación — este archivo no se pudo analizar
/// (shell denegado), queda pendiente `flutter analyze` y `flutter test`.
library;

import 'dart:async';
import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/offline/connectivity_provider.dart';
import 'package:gmp_app_mobilidad/features/bolsa/providers/bolsa_provider.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_favorites_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_order_api.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/catalog_product_sort.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/product_family_filter.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_helpers.dart'
    as helpers;

void _debugLog(String message) {
  if (kDebugMode) debugPrint(message);
}

/// Estado inmutable de pedidos. Todos los campos corresponden a los privados
/// del viejo `PedidosProvider` (tramos 117-224), sin la caché manual P1
/// (totales ahora derivados) y sin `CancelToken`/generaciones (quedan como
/// mutables privados del notifier en fase2 para no romper inmutabilidad).
class PedidosState {
  const PedidosState({
    this.lines = const [],
    this.clientCode,
    this.clientName,
    this.saleType = 'CC',
    this.products = const [],
    this.productMetadataByCode = const {},
    this.isLoadingProducts = false,
    this.productSearch,
    this.selectedFamily,
    this.selectedBrand,
    this.selectedPrefamily,
    this.families = const [],
    this.brands = const [],
    this.productOffset = 0,
    this.hasMoreProducts = true,
    this.orders = const [],
    this.isLoadingOrders = false,
    this.orderStatusFilter,
    this.vendedorCodes = 'ALL',
    this.orderStats,
    this.isLoadingStats = false,
    this.clientHistory = const [],
    this.similarClients = const [],
    this.isSaving = false,
    this.error,
    this.isJefeVentas = false,
    this.userRole = 'COMERCIAL',
    this.userCode = '',
    this.draftWarningMessage,
    this.accumulatedDraftCount = 0,
    this.draftAutoSendThreshold = 0,
    this.clientBalance = const {},
    this.favoriteProductCodes = const {},
    this.lastAutoSaved,
    this.isDirty = false,
    this.activeCheckoutClientRequestId,
    this.onlyWithStock = false,
    this.catalogSort = CatalogProductSort.purchasesDesc,
    this.lastQtyByProduct = const {},
    this.lastUnitByProduct = const {},
    this.lastPriceByProduct = const {},
    this.globalDiscountPct = 0,
    this.complementaryProducts = const [],
    this.activePromotionsList = const [],
    this.promotionsByProduct = const {},
    this.promotionsError = false,
    this.analytics = const {},
    this.isLoadingAnalytics = false,
  });

  // ── Cart State ──
  final List<OrderLine> lines;
  final String? clientCode;
  final String? clientName;
  final String saleType;

  // ── Product Catalog State ──
  final List<Product> products;
  final Map<String, Product> productMetadataByCode;
  final bool isLoadingProducts;
  final String? productSearch;
  final String? selectedFamily;
  final String? selectedBrand;
  final String? selectedPrefamily;
  final List<ProductFamilyFilter> families;
  final List<String> brands;
  final int productOffset;
  final bool hasMoreProducts;

  // ── Orders List State ──
  final List<OrderSummary> orders;
  final bool isLoadingOrders;
  final String? orderStatusFilter;
  final String vendedorCodes;

  // ── Order Stats ──
  final OrderStats? orderStats;
  final bool isLoadingStats;

  // ── Recommendations ──
  final List<Recommendation> clientHistory;
  final List<Recommendation> similarClients;

  // ── General ──
  final bool isSaving;
  final String? error;

  // ── Rol / márgenes ──
  final bool isJefeVentas;
  final String userRole;
  final String userCode;

  // ── Borradores ──
  final String? draftWarningMessage;
  final int accumulatedDraftCount;
  final int draftAutoSendThreshold;

  // ── Client Balance ──
  final Map<String, dynamic> clientBalance;

  // ── Favorites ──
  final Set<String> favoriteProductCodes;

  // ── Auto-save ──
  final DateTime? lastAutoSaved;
  final bool isDirty;
  final String? activeCheckoutClientRequestId;

  // ── Stock Filter ──
  final bool onlyWithStock;

  // ── Catalog sort ──
  final CatalogProductSort catalogSort;

  // ── Last Qty / Price ──
  final Map<String, double> lastQtyByProduct;
  final Map<String, String> lastUnitByProduct;
  final Map<String, double> lastPriceByProduct;

  // ── Global Discount (C5) ──
  final double globalDiscountPct;

  // ── Complementary & Promotions ──
  final List<Map<String, dynamic>> complementaryProducts;
  final List<PromotionItem> activePromotionsList;
  final Map<String, List<PromotionItem>> promotionsByProduct;
  final bool promotionsError;

  // ── Analytics ──
  final Map<String, dynamic> analytics;
  final bool isLoadingAnalytics;

  double get discountFactor => 1 - (globalDiscountPct / 100);

  // ── Selectores totales (tramos 476-532, sin caché manual) ──
  double get totalImporte => lines.fold(0.0, (sum, l) => sum + l.importeVenta);

  double get totalDescuento => totalImporte * globalDiscountPct / 100;

  double get totalConDescuento => totalImporte - totalDescuento;

  double get totalBase => totalConDescuento;

  double get totalIva {
    var sum = 0.0;
    for (final l in lines) {
      final saleAfterDiscount = l.importeVenta * discountFactor;
      sum += saleAfterDiscount * normalizeIvaRate(l.ivaRate, fallback: 0);
    }
    return sum;
  }

  double get totalConIva => totalBase + totalIva;

  double get totalCosto => lines.fold(0.0, (sum, l) => sum + l.importeCosto);

  double get totalMargen => totalConDescuento - totalCosto;

  double get porcentajeMargen =>
      totalConDescuento > 0 ? (totalMargen / totalConDescuento) * 100 : 0.0;

  String get saleTypeLabel {
    switch (saleType) {
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

  // ── Derived cart getters (tramos 547-612) ──
  bool get hasClient => clientCode != null && clientCode!.isNotEmpty;
  bool get hasLines => lines.isNotEmpty;
  int get lineCount => lines.length;

  double get cartDisplayQty {
    var total = 0.0;
    for (final line in lines) {
      if (line.cantidadEnvases > 0) {
        total += line.cantidadEnvases;
      } else {
        total += line.cantidadUnidades;
      }
    }
    return total;
  }

  String get cartDisplayQtyLabel {
    final qty = cartDisplayQty;
    if (qty == qty.truncateToDouble()) return qty.toInt().toString();
    return qty.toStringAsFixed(2);
  }

  double get totalEnvases =>
      lines.fold(0.0, (sum, l) => sum + l.cantidadEnvases);
  double get totalUnidades =>
      lines.fold(0.0, (sum, l) => sum + l.cantidadUnidades);

  Map<int, double> get ivaBreakdown {
    final breakdown = <int, double>{};
    for (final line in lines) {
      final rate = normalizeIvaRate(line.ivaRate, fallback: 0);
      final ivaPct = (rate * 100).round();
      final saleAfterDiscount = line.importeVenta * discountFactor;
      breakdown[ivaPct] =
          (breakdown[ivaPct] ?? 0) + saleAfterDiscount * rate;
    }
    return breakdown;
  }

  OrderBolsaImpact get estimatedBolsaImpact {
    final factor = discountFactor;
    var acumulacion = 0.0;
    var consumo = 0.0;
    var count = 0;
    for (final line in lines) {
      final impact = line.estimatedBolsaImpactForFactor(factor);
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

  double get clientSaldoPendiente {
    final saldo = clientBalance['saldoPendiente'] ??
        clientBalance['pendiente'] ??
        clientBalance['totalPendiente'] ??
        clientBalance['deuda'];
    if (saldo is num) return saldo.toDouble();
    if (saldo is String) return double.tryParse(saldo) ?? 0;
    return 0;
  }

  bool get isMarginVisible => isJefeVentas;

  bool get hasDraftAccumulationWarning =>
      draftWarningMessage != null &&
      draftAutoSendThreshold > 0 &&
      accumulatedDraftCount >= draftAutoSendThreshold;

  PromotionItem? getPromo(String productCode) {
    final list = promotionsByProduct[productCode];
    if (list == null || list.isEmpty) return null;
    for (final promo in list) {
      if (promo.isGift) return promo;
    }
    return list.first;
  }

  List<PromotionItem> getPromosForProduct(String productCode) =>
      List.unmodifiable(promotionsByProduct[productCode] ?? const []);

  int getPromoCount(String productCode) =>
      promotionsByProduct[productCode]?.length ?? 0;

  double lastQtyForProduct(String code, {String? clientCode}) {
    final client = (clientCode ?? this.clientCode ?? '').trim();
    final key =
        '${client.isEmpty ? '_noclient_' : client}|${code.trim()}';
    if (lastQtyByProduct.containsKey(key)) return lastQtyByProduct[key]!;
    return lastQtyByProduct[code.trim()] ?? 1.0;
  }

  String? lastUnitForProduct(String code, {String? clientCode}) {
    final client = (clientCode ?? this.clientCode ?? '').trim();
    final key =
        '${client.isEmpty ? '_noclient_' : client}|${code.trim()}';
    if (lastUnitByProduct.containsKey(key)) return lastUnitByProduct[key];
    return lastUnitByProduct[code.trim()];
  }

  double? lastPriceForProduct(String code) => lastPriceByProduct[code.trim()];

  PedidosState copyWith({
    List<OrderLine>? lines,
    String? clientCode,
    bool clearClientCode = false,
    String? clientName,
    bool clearClientName = false,
    String? saleType,
    List<Product>? products,
    Map<String, Product>? productMetadataByCode,
    bool? isLoadingProducts,
    String? productSearch,
    bool clearProductSearch = false,
    String? selectedFamily,
    bool clearSelectedFamily = false,
    String? selectedBrand,
    bool clearSelectedBrand = false,
    String? selectedPrefamily,
    bool clearSelectedPrefamily = false,
    List<ProductFamilyFilter>? families,
    List<String>? brands,
    int? productOffset,
    bool? hasMoreProducts,
    List<OrderSummary>? orders,
    bool? isLoadingOrders,
    String? orderStatusFilter,
    bool clearOrderStatusFilter = false,
    String? vendedorCodes,
    OrderStats? orderStats,
    bool clearOrderStats = false,
    bool? isLoadingStats,
    List<Recommendation>? clientHistory,
    List<Recommendation>? similarClients,
    bool? isSaving,
    String? error,
    bool clearError = false,
    bool? isJefeVentas,
    String? userRole,
    String? userCode,
    String? draftWarningMessage,
    bool clearDraftWarningMessage = false,
    int? accumulatedDraftCount,
    int? draftAutoSendThreshold,
    Map<String, dynamic>? clientBalance,
    Set<String>? favoriteProductCodes,
    DateTime? lastAutoSaved,
    bool clearLastAutoSaved = false,
    bool? isDirty,
    String? activeCheckoutClientRequestId,
    bool clearActiveCheckoutClientRequestId = false,
    bool? onlyWithStock,
    CatalogProductSort? catalogSort,
    Map<String, double>? lastQtyByProduct,
    Map<String, String>? lastUnitByProduct,
    Map<String, double>? lastPriceByProduct,
    double? globalDiscountPct,
    List<Map<String, dynamic>>? complementaryProducts,
    List<PromotionItem>? activePromotionsList,
    Map<String, List<PromotionItem>>? promotionsByProduct,
    bool? promotionsError,
    Map<String, dynamic>? analytics,
    bool? isLoadingAnalytics,
  }) {
    return PedidosState(
      lines: lines ?? this.lines,
      clientCode: clearClientCode ? null : (clientCode ?? this.clientCode),
      clientName: clearClientName ? null : (clientName ?? this.clientName),
      saleType: saleType ?? this.saleType,
      products: products ?? this.products,
      productMetadataByCode:
          productMetadataByCode ?? this.productMetadataByCode,
      isLoadingProducts: isLoadingProducts ?? this.isLoadingProducts,
      productSearch:
          clearProductSearch ? null : (productSearch ?? this.productSearch),
      selectedFamily:
          clearSelectedFamily ? null : (selectedFamily ?? this.selectedFamily),
      selectedBrand:
          clearSelectedBrand ? null : (selectedBrand ?? this.selectedBrand),
      selectedPrefamily: clearSelectedPrefamily
          ? null
          : (selectedPrefamily ?? this.selectedPrefamily),
      families: families ?? this.families,
      brands: brands ?? this.brands,
      productOffset: productOffset ?? this.productOffset,
      hasMoreProducts: hasMoreProducts ?? this.hasMoreProducts,
      orders: orders ?? this.orders,
      isLoadingOrders: isLoadingOrders ?? this.isLoadingOrders,
      orderStatusFilter: clearOrderStatusFilter
          ? null
          : (orderStatusFilter ?? this.orderStatusFilter),
      vendedorCodes: vendedorCodes ?? this.vendedorCodes,
      orderStats: clearOrderStats ? null : (orderStats ?? this.orderStats),
      isLoadingStats: isLoadingStats ?? this.isLoadingStats,
      clientHistory: clientHistory ?? this.clientHistory,
      similarClients: similarClients ?? this.similarClients,
      isSaving: isSaving ?? this.isSaving,
      error: clearError ? null : (error ?? this.error),
      isJefeVentas: isJefeVentas ?? this.isJefeVentas,
      userRole: userRole ?? this.userRole,
      userCode: userCode ?? this.userCode,
      draftWarningMessage: clearDraftWarningMessage
          ? null
          : (draftWarningMessage ?? this.draftWarningMessage),
      accumulatedDraftCount:
          accumulatedDraftCount ?? this.accumulatedDraftCount,
      draftAutoSendThreshold:
          draftAutoSendThreshold ?? this.draftAutoSendThreshold,
      clientBalance: clientBalance ?? this.clientBalance,
      favoriteProductCodes:
          favoriteProductCodes ?? this.favoriteProductCodes,
      lastAutoSaved:
          clearLastAutoSaved ? null : (lastAutoSaved ?? this.lastAutoSaved),
      isDirty: isDirty ?? this.isDirty,
      activeCheckoutClientRequestId: clearActiveCheckoutClientRequestId
          ? null
          : (activeCheckoutClientRequestId ??
              this.activeCheckoutClientRequestId),
      onlyWithStock: onlyWithStock ?? this.onlyWithStock,
      catalogSort: catalogSort ?? this.catalogSort,
      lastQtyByProduct: lastQtyByProduct ?? this.lastQtyByProduct,
      lastUnitByProduct: lastUnitByProduct ?? this.lastUnitByProduct,
      lastPriceByProduct: lastPriceByProduct ?? this.lastPriceByProduct,
      globalDiscountPct: globalDiscountPct ?? this.globalDiscountPct,
      complementaryProducts:
          complementaryProducts ?? this.complementaryProducts,
      activePromotionsList:
          activePromotionsList ?? this.activePromotionsList,
      promotionsByProduct: promotionsByProduct ?? this.promotionsByProduct,
      promotionsError: promotionsError ?? this.promotionsError,
      analytics: analytics ?? this.analytics,
      isLoadingAnalytics: isLoadingAnalytics ?? this.isLoadingAnalytics,
    );
  }
}

/// Notifier fase2: porta los tramos async restantes del viejo
/// `PedidosProvider` sobre [PedidosState] inmutable.
///
/// Generaciones de carga y `CancelToken` son mutables privados del notifier
/// (no forman parte del estado). `OrderLine` sigue siendo mutable: cada
/// mutación trabaja sobre una copia de la lista y re-emite estado.
class PedidosNotifier extends Notifier<PedidosState> {
  int _productsLoadGeneration = 0;
  int _ordersLoadGeneration = 0;
  int _clientBalanceLoadGeneration = 0;
  CancelToken? _productsCancelToken;

  // Req #9 (port tramo 105-111): OrderApi inyectable para testabilidad.
  PedidosOrderApi _orderApi = const PedidosServiceOrderApi();
  bool _refreshAfterConfirm = true;

  PedidosState? _pendingState;
  bool _notifyScheduled = false;

  static final Random _checkoutRequestRandom = Random.secure();
  static const String _checkoutRequestAlphabet =
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  @override
  PedidosState build() {
    ref.onDispose(() {
      _productsCancelToken?.cancel('pedidos notifier disposed');
    });
    return const PedidosState();
  }

  /// Test-only: inyecta un [PedidosOrderApi] falso (mismo contrato que el
  /// viejo `PedidosProvider(orderApi: ...)`).
  @visibleForTesting
  void debugSetOrderApi(PedidosOrderApi api) {
    _orderApi = api;
  }

  /// Test-only: desactiva el refresh post-confirm para asserts aislados.
  @visibleForTesting
  void debugSetRefreshAfterConfirm(bool value) {
    _refreshAfterConfirm = value;
  }

  /// Equivalente al viejo `_notify`: agrupa cambios rápidos en un microtask.
  /// En Notifier, asignar `state` ya notifica; el debounce evita rebuilds.
  void _setState(PedidosState next, {bool immediate = false}) {
    if (!ref.mounted) return;
    if (immediate) {
      _pendingState = null;
      _notifyScheduled = false;
      state = next;
      return;
    }
    _pendingState = next;
    if (_notifyScheduled) return;
    _notifyScheduled = true;
    Future.microtask(() {
      _notifyScheduled = false;
      if (!ref.mounted) return;
      final pending = _pendingState;
      _pendingState = null;
      if (pending != null) state = pending;
    });
  }

  /// No-op intencional: los totales son getters derivados del estado.
  /// Se conserva por compatibilidad con el viejo `_invalidateCache`.
  // ignore: unused_element
  void _invalidateCache() {}

  String _qtyKey(String productCode, [String? clientCode]) {
    final product = productCode.trim();
    final client = (clientCode ?? state.clientCode ?? '').trim();
    return '${client.isEmpty ? '_noclient_' : client}|$product';
  }

  String _productCacheKey(String productCode) => productCode.trim();

  Map<String, Product> _rememberProductMetadataInto(
    Map<String, Product> target,
    Product product,
  ) {
    final key = _productCacheKey(product.code);
    if (key.isEmpty) return target;
    target[key] = product;
    return target;
  }

  Product? _productMetadataForCode(String productCode) {
    final key = _productCacheKey(productCode);
    if (key.isEmpty) return null;
    return state.productMetadataByCode[key];
  }

  Product? _productByCodeIn(List<Product> products, String productCode) {
    for (final product in products) {
      if (product.code == productCode) return product;
    }
    return _productMetadataForCode(productCode);
  }

  String _newCheckoutClientRequestId(String _) {
    return List.generate(
      24,
      (_) => _checkoutRequestAlphabet[
          _checkoutRequestRandom.nextInt(_checkoutRequestAlphabet.length)],
    ).join();
  }

  List<OrderLine> _buildLinesForSubmit(List<OrderLine> lines) {
    return List<OrderLine>.unmodifiable(List<OrderLine>.from(lines));
  }

  // ── Client (tramos 614-667 portados) ──

  void setClient(String code, String name, {bool clearCart = false}) {
    var next = state;
    if (clearCart) {
      next = next.copyWith(
        lines: const [],
        clearActiveCheckoutClientRequestId: true,
        clearProductSearch: true,
        clearSelectedFamily: true,
        clearSelectedBrand: true,
        clearSelectedPrefamily: true,
        products: const [],
        productMetadataByCode: const {},
        productOffset: 0,
        hasMoreProducts: true,
        clientHistory: const [],
        similarClients: const [],
        complementaryProducts: const [],
      );
    }
    final normalized = helpers.normalizePedidoClientCode(code);
    _setState(
      next.copyWith(
        clientCode: normalized,
        clientName: name,
        clientBalance: {
          'balanceStatus': 'loading',
          'clientCode': normalized,
        },
      ),
      immediate: true,
    );
  }

  void clearClient() {
    _clientBalanceLoadGeneration++;
    _setState(
      state.copyWith(
        clearClientCode: true,
        clearClientName: true,
        lines: const [],
        activePromotionsList: const [],
        promotionsByProduct: const {},
        complementaryProducts: const [],
        clientHistory: const [],
        similarClients: const [],
        products: const [],
        productMetadataByCode: const {},
        clearActiveCheckoutClientRequestId: true,
        productOffset: 0,
        hasMoreProducts: false,
        clearProductSearch: true,
        clearSelectedFamily: true,
        clearSelectedBrand: true,
        clearSelectedPrefamily: true,
        clientBalance: const {},
      ),
      immediate: true,
    );
  }

  void setSaleType(String type) {
    _setState(state.copyWith(saleType: type), immediate: true);
  }

  void setStockFilter(bool value) {
    _setState(state.copyWith(onlyWithStock: value), immediate: true);
  }

  void setCatalogSort(CatalogProductSort sort, {bool notify = true}) {
    if (state.catalogSort == sort) return;
    _setState(state.copyWith(catalogSort: sort), immediate: notify);
  }

  void setGlobalDiscount(double pct) {
    _setState(
      state.copyWith(globalDiscountPct: pct.clamp(0, 100)),
      immediate: true,
    );
  }

  void reorderLines(int oldIndex, int newIndex) {
    final lines = List<OrderLine>.from(state.lines);
    if (oldIndex < 0 || oldIndex >= lines.length) return;
    if (newIndex < 0 || newIndex > lines.length) return;
    var target = newIndex;
    if (target > oldIndex) target--;
    final item = lines.removeAt(oldIndex);
    lines.insert(target, item);
    _setState(state.copyWith(lines: List.unmodifiable(lines)));
  }

  void setUserRole(String? role, {String? code}) {
    final normalized = (role ?? '').trim().toUpperCase();
    final next = normalized == 'JEFE_VENTAS' || normalized == 'ADMIN';
    final normalizedCode = (code ?? '').replaceFirst(RegExp('^0+'), '');
    if (next == state.isJefeVentas &&
        normalized == state.userRole &&
        normalizedCode == state.userCode) {
      return;
    }
    _setState(
      state.copyWith(
        isJefeVentas: next,
        userRole: normalized.isEmpty ? 'COMERCIAL' : normalized,
        userCode: normalizedCode,
      ),
      immediate: true,
    );
  }

  void clearDraftWarning() {
    if (state.draftWarningMessage == null && state.accumulatedDraftCount == 0) {
      return;
    }
    _setState(
      state.copyWith(
        clearDraftWarningMessage: true,
        accumulatedDraftCount: 0,
      ),
      immediate: true,
    );
  }

  /// Consulta umbral VDDX; si count ≥ N (>0) auto-confirma el borrador más
  /// antiguo. Resultado vía state.draftWarningMessage / accumulatedDraftCount.
  Future<void> refreshDraftStatus(
    String vendedorCode, {
    bool autoConfirmIfOverThreshold = true,
  }) async {
    final code = vendedorCode.trim();
    if (code.isEmpty) return;
    try {
      final raw = await ApiClient.get(
        '/pedidos/draft-status/$code',
        cacheKey: 'pedidos:draft-status:$code',
        cacheTTL: CacheService.realtimeTTL,
      );
      final data = raw;
      var warning = data['warning'] == true;
      var count = (data['count'] ?? 0) is num
          ? (data['count'] as num).toInt()
          : int.tryParse((data['count'] ?? '0').toString()) ?? 0;
      final threshold = (data['threshold'] ?? 0) is num
          ? (data['threshold'] as num).toInt()
          : int.tryParse((data['threshold'] ?? '0').toString()) ?? 0;
      var next = state.copyWith(
        accumulatedDraftCount: count,
        draftAutoSendThreshold: threshold,
        draftWarningMessage: warning ? data['message']?.toString() : null,
        clearDraftWarningMessage: !warning,
      );

      if (autoConfirmIfOverThreshold &&
          warning &&
          threshold > 0 &&
          count >= threshold) {
        try {
          final confirmed = await ApiClient.post(
            '/pedidos/draft-status/$code/auto-confirm',
            {},
          );
          warning = confirmed['warning'] == true;
          count = (confirmed['count'] ?? count) is num
              ? (confirmed['count'] as num).toInt()
              : int.tryParse((confirmed['count'] ?? '$count').toString()) ??
                  count;
          next = next.copyWith(
            accumulatedDraftCount: count,
            draftWarningMessage:
                confirmed['message']?.toString() ?? next.draftWarningMessage,
          );
          if (confirmed['autoConfirmed'] == true) {
            unawaited(
              loadOrders(vendedorCodes: code, forceRefresh: true),
            );
          }
        } catch (_) {
          // Mantener warning GET si el auto-confirm falla.
        }
      }
      _setState(next, immediate: true);
    } catch (_) {
      // Silencioso: no crítico
    }
  }

  void setFamilyFilter(String? family) {
    final next = (family ?? '').trim();
    _setState(
      state.copyWith(
        selectedFamily: next.isEmpty ? null : next,
        clearSelectedFamily: next.isEmpty,
        clearSelectedPrefamily: next.isNotEmpty,
      ),
      immediate: true,
    );
  }

  void setBrandFilter(String? brand) {
    _setState(state.copyWith(selectedBrand: brand), immediate: true);
  }

  void setPrefamilyFilter(String? prefamily) {
    final next = (prefamily ?? '').trim();
    final normalized = next.isEmpty ? null : next.toUpperCase();
    if (state.selectedPrefamily == normalized) return;
    _setState(
      state.copyWith(
        selectedPrefamily: normalized,
        clearSelectedPrefamily: normalized == null,
        clearSelectedFamily: normalized != null,
      ),
      immediate: true,
    );
  }

  void clearCatalogFamilyFilters() {
    if (state.selectedFamily == null &&
        state.selectedPrefamily == null &&
        state.selectedBrand == null) {
      return;
    }
    _setState(
      state.copyWith(
        clearSelectedFamily: true,
        clearSelectedPrefamily: true,
        selectedBrand: null,
        clearSelectedBrand: true,
      ),
      immediate: true,
    );
  }

  // ── Product Catalog (tramos 689-870) ──

  Future<void> loadProducts({
    required String vendedorCodes,
    String? search,
    bool reset = false,
    bool forceRefresh = false,
    bool? onlyStock,
  }) async {
    if (state.clientCode == null || state.clientCode!.trim().isEmpty) {
      _setState(
        state.copyWith(
          products: const [],
          hasMoreProducts: false,
          productOffset: 0,
        ),
        immediate: true,
      );
      return;
    }

    var next = state;
    if (reset) {
      next = next.copyWith(
        productOffset: 0,
        hasMoreProducts: true,
        products: const [],
      );
    }
    if (!next.hasMoreProducts && !reset) return;

    final requestOffset = next.productOffset;
    final requestClientCode = next.clientCode;
    final requestFamily = next.selectedFamily;
    final requestBrand = next.selectedBrand;
    final requestPrefamily = next.selectedPrefamily;
    final requestOnlyStock = onlyStock ?? next.onlyWithStock;
    final generation = ++_productsLoadGeneration;
    _productsCancelToken?.cancel('superseded product catalog request');
    final cancelToken = CancelToken();
    _productsCancelToken = cancelToken;
    _setState(
      next.copyWith(
        isLoadingProducts: true,
        productSearch: search,
        clearError: true,
      ),
      immediate: true,
    );

    try {
      final results = await PedidosService.getProducts(
        vendedorCodes: vendedorCodes,
        search: search,
        clientCode: requestClientCode,
        family: requestFamily,
        marca: requestBrand,
        prefamily: requestPrefamily,
        onlyStock: requestOnlyStock,
        offset: requestOffset,
        sortBy: state.catalogSort.apiSortBy,
        sortOrder: state.catalogSort.apiSortOrder,
        forceRefresh: forceRefresh,
        cancelToken: cancelToken,
      );

      if (generation != _productsLoadGeneration ||
          requestClientCode != state.clientCode ||
          requestFamily != state.selectedFamily ||
          requestBrand != state.selectedBrand ||
          requestPrefamily != state.selectedPrefamily) {
        return;
      }

      final metadata =
          Map<String, Product>.from(state.productMetadataByCode);
      for (final product in results) {
        _rememberProductMetadataInto(metadata, product);
      }
      final filtered = requestOnlyStock
          ? results.where((p) => p.hasStock).toList()
          : results;
      final merged =
          reset ? filtered : [...state.products, ...filtered];
      _setState(
        state.copyWith(
          productMetadataByCode: Map.unmodifiable(metadata),
          products: List.unmodifiable(merged),
          hasMoreProducts: results.length >= 50,
          productOffset: requestOffset + results.length,
        ),
      );
    } catch (e) {
      if (e is ApiException && e.code == 'CANCELLED') {
        return;
      }
      if (generation == _productsLoadGeneration) {
        _setState(state.copyWith(error: e.toString()), immediate: true);
      }
    } finally {
      if (generation == _productsLoadGeneration) {
        _setState(
          state.copyWith(isLoadingProducts: false),
          immediate: true,
        );
      }
    }
  }

  Future<void> loadMoreProducts(String vendedorCodes) async {
    if (state.isLoadingProducts || !state.hasMoreProducts) return;
    await loadProducts(
      vendedorCodes: vendedorCodes,
      search: state.productSearch,
    );
  }

  Future<void> loadFilters() async {
    try {
      final results = await Future.wait([
        PedidosService.getFamiliesDetailed(),
        PedidosService.getBrands(),
      ]);
      _setState(
        state.copyWith(
          families: orderFamiliesForChips(
            results[0] as List<ProductFamilyFilter>,
          ),
          brands: List.unmodifiable(results[1] as List<String>),
        ),
        immediate: true,
      );
    } catch (e) {
      _debugLog('[PedidosNotifier] Error loading filters: $e');
    }
  }

  void _applyStockToLists(
    List<Product> products,
    Map<String, Product> metadata,
    String productCode,
    Map<String, double> stock,
  ) {
    final idx = products.indexWhere((p) => p.code == productCode);
    final cached = metadata[productCode];
    final product = idx >= 0 ? products[idx] : cached;
    if (product == null) return;
    final updated = product.copyWithStock(
      stockEnvases: stock['envases'] ?? product.stockEnvases,
      stockUnidades: stock['unidades'] ?? product.stockUnidades,
    );
    if (idx >= 0) products[idx] = updated;
    metadata[productCode] = updated;
  }

  Future<void> refreshStock(String productCode) async {
    try {
      final stock = await PedidosService.getStock(productCode);
      final products = List<Product>.from(state.products);
      final metadata =
          Map<String, Product>.from(state.productMetadataByCode);
      _applyStockToLists(products, metadata, productCode, stock);
      _setState(
        state.copyWith(
          products: List.unmodifiable(products),
          productMetadataByCode: Map.unmodifiable(metadata),
        ),
        immediate: true,
      );
    } catch (e) {
      _debugLog('[PedidosNotifier] refreshStock error: $e');
    }
  }

  // ── Cart Operations (tramos 875-1210) ──

  String? addLine(
    Product product,
    double cantidadEnvases,
    double cantidadUnidades,
    String unidadMedida,
    double precioVenta, {
    bool allowPartial = false,
  }) {
    if (!state.hasClient) {
      const msg = 'Debes seleccionar un cliente antes de añadir productos.';
      _setState(state.copyWith(error: msg), immediate: true);
      return msg;
    }

    final metadata =
        Map<String, Product>.from(state.productMetadataByCode);
    _rememberProductMetadataInto(metadata, product);

    final unit = unidadMedida.trim().isEmpty
        ? 'CAJAS'
        : unidadMedida.trim().toUpperCase();

    var requestQty = unit == 'CAJAS' ? cantidadEnvases : cantidadUnidades;

    final lines = List<OrderLine>.from(state.lines);
    final existingIdx =
        lines.indexWhere((l) => l.codigoArticulo == product.code);
    final currentQtyInCart = existingIdx >= 0
        ? (unit == 'CAJAS'
            ? lines[existingIdx].cantidadEnvases
            : lines[existingIdx].cantidadUnidades)
        : 0.0;

    final maxQty =
        unit == 'CAJAS' ? product.stockEnvases : product.stockForUnit(unit);
    final remainingAvailable = maxQty - currentQtyInCart;

    if (remainingAvailable <= 0 && requestQty > 0) {
      final msg = unit == 'CAJAS'
          ? 'Stock insuficiente: Disponible ${product.stockEnvases.toInt()} cajas.'
          : 'Stock insuficiente: Disponible ${maxQty.toStringAsFixed(2)} ${Product.unitLabel(unit)}.';
      _setState(
        state.copyWith(
          error: msg,
          productMetadataByCode: Map.unmodifiable(metadata),
        ),
        immediate: true,
      );
      return msg;
    }

    var isPartial = false;
    double missingQty = 0;

    if (requestQty > remainingAvailable) {
      if (!allowPartial) {
        final msg = unit == 'CAJAS'
            ? 'Stock insuficiente: Solo quedan ${remainingAvailable.toInt()} cajas.'
            : 'Stock insuficiente: Solo quedan ${remainingAvailable.toStringAsFixed(2)} ${Product.unitLabel(unit)}.';
        _setState(
          state.copyWith(
            error: msg,
            productMetadataByCode: Map.unmodifiable(metadata),
          ),
          immediate: true,
        );
        return msg;
      }

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

    final lastQty =
        Map<String, double>.from(state.lastQtyByProduct);
    final lastUnit =
        Map<String, String>.from(state.lastUnitByProduct);

    if (existingIdx >= 0) {
      final line = lines[existingIdx];
      final lineUnit = line.unidadMedida.trim().toUpperCase();

      if (lineUnit != unit && requestQty > 0) {
        final unitLabel = line.unidadMedida.isNotEmpty
            ? line.unidadMedida.toLowerCase()
            : 'unidad actual';
        final msg =
            'Este producto ya esta en el carrito en $unitLabel. Edita esa linea para cambiar unidad.';
        _setState(
          state.copyWith(
            error: msg,
            productMetadataByCode: Map.unmodifiable(metadata),
          ),
          immediate: true,
        );
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
          line.cantidadEnvases = 0;
          line.cantidadUnidades = newQty;
        }
      }
      line.unidadesCaja = product.quantityPerBoxForUnit(unit);
      line.unidadesFraccion = product.unitsFraction;
      line.precioVenta = precioVenta;
      line.precioCosto = product.costForUnit(unit);
      line.precioTarifa = product.catalogTariffForUnit(unit);
      line.precioTarifaCliente = product.clientTariffForUnit(unit);
      line.precioMinimo = product.minimumPriceForUnit(unit);
      line.precioClienteSource = product.precioClienteSource;
      line.precioMinimoSource = product.precioMinimoSource;
      line.precioEspecialCliente = product.precioEspecialCliente;
      line.permiteBajoMinimo = product.permiteBajoMinimo;
      line.codigoIva = product.codigoIva;
      line.ivaRate = ivaRateFromCode(product.codigoIva);
      line.recalculate();
      lastQty[_qtyKey(product.code)] =
          lineUnit == 'CAJAS' ? line.cantidadEnvases : line.cantidadUnidades;
      lastUnit[_qtyKey(product.code)] = line.unidadMedida;
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
        precioTarifa: product.catalogTariffForUnit(unit),
        precioTarifaCliente: product.clientTariffForUnit(unit),
        precioMinimo: product.minimumPriceForUnit(unit),
        precioClienteSource: product.precioClienteSource,
        precioMinimoSource: product.precioMinimoSource,
        precioEspecialCliente: product.precioEspecialCliente,
        permiteBajoMinimo: product.permiteBajoMinimo,
        codigoIva: product.codigoIva,
        ivaRate: ivaRate,
      );
      line.recalculate();
      lines.add(line);
      lastQty[_qtyKey(product.code)] = requestQty;
      lastUnit[_qtyKey(product.code)] = unit;
    }

    _syncGiftPromotionLinesInto(
      lines,
      state.promotionsByProduct,
      product.code,
      product: product,
    );
    _setState(
      state.copyWith(
        lines: List.unmodifiable(lines),
        productMetadataByCode: Map.unmodifiable(metadata),
        lastQtyByProduct: Map.unmodifiable(lastQty),
        lastUnitByProduct: Map.unmodifiable(lastUnit),
        clearActiveCheckoutClientRequestId: true,
        clearError: true,
        isDirty: true,
      ),
    );
    return isPartial ? 'PARCIAL:$missingQty|${product.name}' : null;
  }

  String? updateLine(
    int index, {
    double? cantidadEnvases,
    double? cantidadUnidades,
    double? precioVenta,
    String? unidadMedida,
    double? lineDiscountPct,
  }) {
    final lines = List<OrderLine>.from(state.lines);
    if (index < 0 || index >= lines.length) return 'Line not found';
    final line = lines[index];
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

    final metadata =
        Map<String, Product>.from(state.productMetadataByCode);
    final listed = _productByCodeIn(state.products, line.codigoArticulo);
    if (listed != null) _rememberProductMetadataInto(metadata, listed);
    final product = listed;

    if (product != null && product.isDualFieldProduct) {
      final nextEnvases = cantidadEnvases ?? line.cantidadEnvases;
      final nextUnidades = cantidadUnidades ?? line.cantidadUnidades;
      final unitsPerBox = product.unitsPerBox > 0 ? product.unitsPerBox : 1;
      final requestedUnits = nextEnvases * unitsPerBox + nextUnidades;
      final availableUnits = product.stockForUnit('UNIDADES');

      if (nextEnvases > product.stockEnvases ||
          requestedUnits > availableUnits) {
        final msg =
            'Stock insuficiente: Solo hay ${product.stockEnvases.toInt()} cajas / ${availableUnits.toStringAsFixed(2)} uds.';
        _setState(
          state.copyWith(
            error: msg,
            productMetadataByCode: Map.unmodifiable(metadata),
          ),
          immediate: true,
        );
        return msg;
      }

      if (cantidadEnvases != null) line.cantidadEnvases = cantidadEnvases;
      if (cantidadUnidades != null) line.cantidadUnidades = cantidadUnidades;
    } else {
      if (product != null) {
        final maxQty = nextUnit == 'CAJAS'
            ? product.stockEnvases
            : product.stockForUnit(nextUnit);
        if (nextQty > maxQty) {
          final msg = nextUnit == 'CAJAS'
              ? 'Stock insuficiente: Solo hay ${product.stockEnvases.toInt()} cajas.'
              : 'Stock insuficiente: Solo hay ${maxQty.toStringAsFixed(2)} ${Product.unitLabel(nextUnit)}.';
          _setState(
            state.copyWith(
              error: msg,
              productMetadataByCode: Map.unmodifiable(metadata),
            ),
            immediate: true,
          );
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
    if (lineDiscountPct != null) {
      line.lineDiscountPct = lineDiscountPct.clamp(0, 100);
    }
    if (product != null) {
      line.unidadesCaja = product.quantityPerBoxForUnit(nextUnit);
      line.precioCosto = product.costForUnit(nextUnit);
      line.precioMinimo = product.minimumPriceForUnit(nextUnit);
    }
    line.recalculate();
    if (shouldSyncGifts) {
      _syncGiftPromotionLinesInto(
        lines,
        state.promotionsByProduct,
        line.codigoArticulo,
        product: product,
      );
    }
    final lastQty =
        Map<String, double>.from(state.lastQtyByProduct);
    final lastUnit =
        Map<String, String>.from(state.lastUnitByProduct);
    lastQty[_qtyKey(line.codigoArticulo)] = nextQty;
    lastUnit[_qtyKey(line.codigoArticulo, state.clientCode)] =
        line.unidadMedida;
    _setState(
      state.copyWith(
        lines: List.unmodifiable(lines),
        productMetadataByCode: Map.unmodifiable(metadata),
        lastQtyByProduct: Map.unmodifiable(lastQty),
        lastUnitByProduct: Map.unmodifiable(lastUnit),
        clearActiveCheckoutClientRequestId: true,
        isDirty: true,
      ),
    );
    return null;
  }

  void removeLine(int index) {
    final lines = List<OrderLine>.from(state.lines);
    if (index < 0 || index >= lines.length) return;
    final removed = lines.removeAt(index);
    if (!removed.isAutoGift && removed.tipoLinea.trim().toUpperCase() != 'G') {
      _syncGiftPromotionLinesInto(
        lines,
        state.promotionsByProduct,
        removed.codigoArticulo,
        product: _productByCodeIn(state.products, removed.codigoArticulo),
      );
    }
    var next = state.copyWith(
      lines: List.unmodifiable(lines),
      isDirty: true,
    );
    if (lines.isEmpty) {
      next = next.copyWith(
        globalDiscountPct: 0,
        complementaryProducts: const [],
      );
    }
    _setState(next);
  }

  void updateLineClaseLinea(int index, String clase) {
    final lines = List<OrderLine>.from(state.lines);
    if (index < 0 || index >= lines.length) return;
    if (!['VT', 'SC'].contains(clase)) return;
    final line = lines[index];
    line.claseLinea = clase;
    if (clase == 'SC') {
      line.precioVenta = 0;
      line.importeVenta = 0;
      line.importeMargen = -line.importeCosto;
      line.porcentajeMargen = 0.0;
    } else {
      final cached = state.lastPriceByProduct[line.codigoArticulo];
      if (cached != null && cached > 0) {
        line.precioVenta = cached;
      }
      line.recalculate();
    }
    _setState(
      state.copyWith(
        lines: List.unmodifiable(lines),
        isDirty: true,
      ),
    );
  }

  void clearOrder() {
    _clientBalanceLoadGeneration++;
    _setState(
      state.copyWith(
        lines: const [],
        clearClientCode: true,
        clearClientName: true,
        saleType: 'CC',
        globalDiscountPct: 0,
        products: const [],
        productOffset: 0,
        hasMoreProducts: false,
        isDirty: false,
        clearLastAutoSaved: true,
        complementaryProducts: const [],
        clientBalance: const {},
        clearError: true,
      ),
    );
  }

  // ── Gift promotions sync (tramos 1216-1354) ──

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

  OrderLine? _firstManualSaleLineIn(
    List<OrderLine> lines,
    String productCode,
  ) {
    for (final line in lines) {
      if (_isManualSaleLine(line, productCode)) return line;
    }
    return null;
  }

  double _manualSaleQuantityIn(List<OrderLine> lines, String productCode) {
    var total = 0.0;
    for (final line in lines) {
      if (_isManualSaleLine(line, productCode)) {
        total += line.billingQuantity;
      }
    }
    return total;
  }

  void _removeAutoGiftLinesIn(
    List<OrderLine> lines,
    String productCode, {
    String? promotionCode,
  }) {
    lines.removeWhere((line) {
      if (!line.isAutoGift || line.codigoArticulo != productCode) return false;
      if (promotionCode == null || promotionCode.isEmpty) return true;
      return line.promotionCode == promotionCode;
    });
  }

  void _syncGiftPromotionLinesInto(
    List<OrderLine> lines,
    Map<String, List<PromotionItem>> promosByProduct,
    String productCode, {
    Product? product,
  }) {
    final giftPromos =
        (promosByProduct[productCode] ?? const <PromotionItem>[])
            .where((p) => p.isGift && p.minQty > 0 && p.giftQty > 0)
            .toList();
    if (giftPromos.isEmpty) {
      _removeAutoGiftLinesIn(lines, productCode);
      return;
    }

    _removeAutoGiftLinesIn(lines, productCode);
    for (final promo in giftPromos) {
      _applyGiftPromotionLineInto(lines, productCode, promo, product: product);
    }
  }

  void _applyGiftPromotionLineInto(
    List<OrderLine> lines,
    String productCode,
    PromotionItem promo, {
    Product? product,
  }) {
    final promotionCode = _promotionKey(promo);
    final saleLine = _firstManualSaleLineIn(lines, productCode);
    final saleQty = _manualSaleQuantityIn(lines, productCode);
    _removeAutoGiftLinesIn(lines, productCode, promotionCode: promotionCode);

    if (saleLine == null || saleQty < promo.minQty) return;

    final multiplier = promo.cumulative ? (saleQty / promo.minQty).floor() : 1;
    final giftLineCount = (multiplier * promo.giftQty).floor();
    if (giftLineCount <= 0) return;

    final sourceProduct =
        product ?? _productByCodeIn(state.products, productCode);
    final unit = saleLine.unidadMedida.trim().isEmpty
        ? (sourceProduct?.displayUnit ?? 'CAJAS')
        : saleLine.unidadMedida.trim().toUpperCase();
    final unitsPerBox = sourceProduct?.quantityPerBoxForUnit(unit) ??
        (saleLine.unidadesCaja > 0 ? saleLine.unidadesCaja : 1);
    final cost = sourceProduct?.costForUnit(unit) ?? saleLine.precioCosto;
    final tariff =
        sourceProduct?.catalogTariffForUnit(unit) ?? saleLine.precioTarifa;
    final clientTariff = sourceProduct?.clientTariffForUnit(unit) ??
        saleLine.precioTarifaCliente;
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
        precioClienteSource:
            sourceProduct?.precioClienteSource ?? saleLine.precioClienteSource,
        precioMinimoSource:
            sourceProduct?.precioMinimoSource ?? saleLine.precioMinimoSource,
        precioEspecialCliente: sourceProduct?.precioEspecialCliente ??
            saleLine.precioEspecialCliente,
        permiteBajoMinimo:
            sourceProduct?.permiteBajoMinimo ?? saleLine.permiteBajoMinimo,
        codigoIva: sourceProduct?.codigoIva ?? saleLine.codigoIva,
        ivaRate: saleLine.ivaRate,
        claseLinea: 'SC',
        tipoLinea: 'G',
        promotionCode: promotionCode,
        isAutoGift: true,
      );
      giftLine.recalculate();
      lines.add(giftLine);
    }
  }

  void _syncAllGiftPromotionLinesInto(
    List<OrderLine> lines,
    Map<String, List<PromotionItem>> promosByProduct,
  ) {
    final productCodes = <String>{
      for (final line in lines) line.codigoArticulo,
      ...promosByProduct.keys,
    };
    for (final code in productCodes) {
      _syncGiftPromotionLinesInto(lines, promosByProduct, code);
    }
  }

  void markAsSaved() {
    _setState(
      state.copyWith(isDirty: false, lastAutoSaved: DateTime.now()),
      immediate: true,
    );
  }

  void _clearSubmittedCartInto(PedidosState Function(PedidosState) emit) {
    emit(
      state.copyWith(
        lines: const [],
        clearClientCode: true,
        clearClientName: true,
        saleType: 'CC',
        globalDiscountPct: 0,
        complementaryProducts: const [],
        clientBalance: const {},
        productMetadataByCode: const {},
        isDirty: false,
      ),
    );
    _clientBalanceLoadGeneration++;
  }

  // ── Order Persistence (tramos 1379-1565) ──

  Future<Map<String, dynamic>?> confirmOrder(
    String vendedorCode, {
    String observaciones = '',
    String? deliveryDate,
    String? vehicleCode,
    String? driverCode,
    String? routeCode,
    bool cobroPropio = false,
  }) async {
    if (state.isSaving) {
      return null;
    }

    if (!state.hasClient || !state.hasLines) {
      _setState(
        state.copyWith(
          error: 'Seleccione un cliente y añada al menos un producto',
        ),
        immediate: true,
      );
      return null;
    }

    _setState(
      state.copyWith(isSaving: true, clearError: true),
      immediate: true,
    );
    String? queuedSyncKey;

    try {
      _debugLog('[confirmOrder] Step 1/3: Building lines for submit');
      final linesForSubmit = _buildLinesForSubmit(state.lines);
      final obs = observaciones.trim();
      final clientRequestId = state.activeCheckoutClientRequestId ??
          _newCheckoutClientRequestId(vendedorCode);
      if (state.activeCheckoutClientRequestId == null) {
        _setState(
          state.copyWith(activeCheckoutClientRequestId: clientRequestId),
          immediate: true,
        );
      }
      queuedSyncKey = await PedidosOfflineService.queueOrderForSync(
        clientCode: state.clientCode!,
        clientName: state.clientName ?? '',
        vendedorCode: vendedorCode,
        saleType: state.saleType,
        lines: linesForSubmit,
        globalDiscountPct: state.globalDiscountPct,
        observaciones: obs,
        deliveryDate: deliveryDate,
        vehicleCode: vehicleCode,
        driverCode: driverCode,
        routeCode: routeCode,
        clientRequestId: clientRequestId,
        cobroPropio: cobroPropio,
        notifyQueued: false,
      );

      final connectivityStatus = ConnectivityService.instance.currentStatus;
      if (connectivityStatus != ConnectivityStatus.online) {
        _debugLog(
          '[confirmOrder] offline/limited connectivity; order kept local',
        );
        PedidosOfflineService.notifyQueuedOrder(queuedSyncKey);
        _clearSubmittedCartInto((next) {
          _setState(next, immediate: true);
          return next;
        });
        _setState(
          state.copyWith(clearActiveCheckoutClientRequestId: true),
          immediate: true,
        );
        return {
          'queued': true,
          'pendingConfirmation': true,
          'localDraft': true,
          'estado': 'BORRADOR_LOCAL',
          'message': connectivityStatus == ConnectivityStatus.limited
              ? 'Pedido guardado como borrador local. Se enviara al recuperar conexion con el servidor.'
              : 'Pedido guardado como borrador local. Se enviara cuando vuelva internet.',
        };
      }

      _debugLog(
        '[confirmOrder] Step 2/3: Calling createOrder API (client=${state.clientCode}, lines=${linesForSubmit.length})',
      );
      final createResult = await _orderApi.createOrder(
        clientCode: state.clientCode!,
        clientName: state.clientName ?? '',
        vendedorCode: vendedorCode,
        tipoVenta: state.saleType,
        lines: linesForSubmit,
        observaciones: obs,
        clientRequestId: clientRequestId,
        descuentoGlobal: state.globalDiscountPct,
      );
      _debugLog('[confirmOrder] createOrder result id=${createResult['id']}');

      if (createResult['queued'] == true) {
        final pending = Map<String, dynamic>.from(createResult);
        pending['pendingConfirmation'] = true;
        pending['localDraft'] = true;
        pending['estado'] ??= 'BORRADOR_LOCAL';
        pending['message'] ??=
            'Pedido guardado para sincronizar. No esta confirmado todavia.';
        PedidosOfflineService.notifyQueuedOrder(queuedSyncKey);
        _clearSubmittedCartInto((next) {
          _setState(next, immediate: true);
          return next;
        });
        _setState(
          state.copyWith(clearActiveCheckoutClientRequestId: true),
          immediate: true,
        );
        return pending;
      }

      if (createResult['id'] == null) {
        _setState(
          state.copyWith(error: 'Error al crear el pedido'),
          immediate: true,
        );
        _debugLog('[confirmOrder] FAILED: createOrder returned null id');
        return null;
      }

      final orderId = createResult['id'] as int;
      _debugLog(
        '[confirmOrder] Step 3/3: Calling confirmOrder API (orderId=$orderId, saleType=${state.saleType}, deliveryDate=$deliveryDate)',
      );
      final confirmedResult = await _orderApi.confirmOrder(
        orderId,
        state.saleType,
        deliveryDate: deliveryDate,
        vehicleCode: vehicleCode,
        driverCode: driverCode,
        routeCode: routeCode,
        cobroPropio: cobroPropio,
      );
      _debugLog(
        '[confirmOrder] confirmOrder result keys=${confirmedResult.keys.toList()}',
      );

      final result = helpers.normalizeConfirmOrderResultForProvider(
        createResult: Map<String, dynamic>.from(createResult),
        confirmedResult: Map<String, dynamic>.from(confirmedResult),
      );

      if (helpers.shouldClearCartAfterConfirmation(result)) {
        _clearSubmittedCartInto((next) {
          _setState(next, immediate: true);
          return next;
        });
      }

      if (_refreshAfterConfirm) {
        await refreshOrdersAndStats();
      }
      if (helpers.isConfirmedOrderResultForProvider(result)) {
        try {
          unawaited(ref.read(bolsaProvider.notifier).refresh());
        } catch (_) {
          // Bolsa no disponible en tests puros: no crítico.
        }
      }

      _debugLog(
        '[confirmOrder] SUCCESS: order confirmed, result keys=${result.keys.toList()}',
      );
      await PedidosOfflineService.deleteQueuedOrder(queuedSyncKey);
      _setState(
        state.copyWith(clearActiveCheckoutClientRequestId: true),
        immediate: true,
      );
      return result;
    } catch (e, st) {
      if (e is ApiException &&
          (e.code == 'MIN_COBRO_ORDER_BLOCKED' ||
              (e.statusCode == 403 &&
                  (e.message.contains('minimo') ||
                      e.message.contains('mínimo') ||
                      e.message.contains('cartera'))))) {
        _setState(state.copyWith(error: e.message), immediate: true);
        _debugLog('[confirmOrder] blocked by min cobro: $e');
        return {
          'blocked': true,
          'reason': 'MIN_COBRO_ORDER_BLOCKED',
          'message': e.message,
        };
      }
      if (queuedSyncKey != null && e is ApiException && e.statusCode == 0) {
        _debugLog('[confirmOrder] network error; order kept in offline queue');
        PedidosOfflineService.notifyQueuedOrder(queuedSyncKey);
        _clearSubmittedCartInto((next) {
          _setState(next, immediate: true);
          return next;
        });
        _setState(
          state.copyWith(clearActiveCheckoutClientRequestId: true),
          immediate: true,
        );
        return {
          'queued': true,
          'pendingConfirmation': true,
          'localDraft': true,
          'estado': 'BORRADOR_LOCAL',
          'message':
              'Pedido guardado localmente. Se enviara al recuperar conexion.',
        };
      }
      if (queuedSyncKey != null) {
        await PedidosOfflineService.markQueuedOrderFailed(queuedSyncKey, e);
      }
      _debugLog('[confirmOrder] ERROR: $e');
      _debugLog('[confirmOrder] STACK: $st');
      _setState(state.copyWith(error: e.toString()), immediate: true);
      return null;
    } finally {
      _setState(state.copyWith(isSaving: false), immediate: true);
    }
  }

  // ── Orders List (tramos 1567-1862) ──

  static bool _isGroupedOrderStatusFilter(String? status) {
    if (status == null || status.isEmpty) return false;
    return status == 'CONFIRMADO';
  }

  static List<OrderSummary> _filterOrdersByGroupedStatus(
    List<OrderSummary> orders,
    String status,
  ) {
    switch (status.toUpperCase()) {
      case 'CONFIRMADO':
        return orders.where((o) {
          final e = o.estado.toUpperCase();
          return e == 'CONFIRMADO';
        }).toList(growable: false);
      default:
        return orders
            .where((o) => o.estado.toUpperCase() == status.toUpperCase())
            .toList(growable: false);
    }
  }

  static double _asLocalDouble(Object? value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '') ?? 0;
  }

  static int _localOrderId(String syncKey, int index) {
    var hash = 0;
    for (final unit in syncKey.codeUnits) {
      hash = ((hash * 31) + unit) & 0x3fffffff;
    }
    return -1000000000 - hash - index;
  }

  static List<OrderSummary> _localQueuedOrders({String? status}) {
    final desiredStatus = status?.trim().toUpperCase();
    if (desiredStatus != null &&
        desiredStatus.isNotEmpty &&
        desiredStatus != 'BORRADOR' &&
        desiredStatus != 'BORRADOR_LOCAL' &&
        desiredStatus != 'PENDIENTE' &&
        desiredStatus != 'ERROR_SYNC') {
      return const <OrderSummary>[];
    }

    final items = [
      ...PedidosOfflineService.getPendingSyncs(),
      ...PedidosOfflineService.getFailedSyncs(),
    ];
    final summaries = <OrderSummary>[];
    for (var i = 0; i < items.length; i++) {
      final item = Map<String, dynamic>.from(items[i] as Map);
      final syncKey = item['syncKey']?.toString() ?? 'local_$i';
      final lines = item['lines'] as List? ?? const [];
      var total = 0.0;
      for (final rawLine in lines) {
        if (rawLine is! Map) continue;
        final line = Map<String, dynamic>.from(rawLine);
        final lineTotal = _asLocalDouble(line['importeVenta']);
        if (lineTotal > 0) {
          total += lineTotal;
        } else {
          final qty = _asLocalDouble(line['cantidadEnvases']) > 0
              ? _asLocalDouble(line['cantidadEnvases'])
              : _asLocalDouble(line['cantidadUnidades']);
          total += qty * _asLocalDouble(line['precioVenta']);
        }
      }
      final queuedAt = item['queuedAt']?.toString() ?? '';
      final isFailed = item['status']?.toString() == 'failed';
      final localStatus = isFailed ? 'ERROR_SYNC' : 'BORRADOR_LOCAL';
      if (desiredStatus != null &&
          desiredStatus.isNotEmpty &&
          desiredStatus != localStatus &&
          !(desiredStatus == 'BORRADOR' && localStatus == 'BORRADOR_LOCAL') &&
          !(desiredStatus == 'PENDIENTE' && localStatus == 'BORRADOR_LOCAL')) {
        continue;
      }
      summaries.add(
        OrderSummary(
          id: _localOrderId(syncKey, i),
          numeroPedido: 0,
          clienteCode: item['clientCode']?.toString() ?? '',
          clienteName: item['clientName']?.toString() ?? 'Pedido local',
          vendedorCode: item['vendedorCode']?.toString() ?? '',
          fecha: queuedAt,
          estado: localStatus,
          tipoVenta: item['saleType']?.toString() ?? 'CC',
          total: total,
          lineCount: lines.length,
          numeroPedidoFormatted: 'Local',
          fechaFormatted:
              queuedAt.length >= 10 ? queuedAt.substring(0, 10) : queuedAt,
          observaciones: item['observaciones']?.toString() ?? '',
          origen: 'LOCAL',
        ),
      );
    }
    return summaries;
  }

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
    final generation = ++_ordersLoadGeneration;
    _setState(
      state.copyWith(
        vendedorCodes: vendedorCodes,
        isLoadingOrders: true,
        orderStatusFilter: status,
        clearOrderStatusFilter: status == null,
        clearError: true,
      ),
      immediate: true,
    );
    final canRefreshFromNetwork =
        ConnectivityService.instance.currentStatus == ConnectivityStatus.online;
    final effectiveForceRefresh = forceRefresh && canRefreshFromNetwork;
    if (effectiveForceRefresh) {
      await PedidosService.invalidateOrderCaches();
      if (generation == _ordersLoadGeneration && ref.mounted) {
        _setState(state.copyWith(orders: const []), immediate: true);
      }
    }

    try {
      final apiStatus = _isGroupedOrderStatusFilter(status) ? null : status;
      var orders = await PedidosService.getOrders(
        vendedorCodes: vendedorCodes,
        status: apiStatus,
        limit: 20,
        page: 1,
        forceRefresh: effectiveForceRefresh,
        dateFrom: dateFrom,
        dateTo: dateTo,
        search: search,
        minAmount: minAmount,
        maxAmount: maxAmount,
        sortBy: sortBy,
        sortOrder: sortOrder,
      );
      if (status != null &&
          status.isNotEmpty &&
          _isGroupedOrderStatusFilter(status)) {
        orders = _filterOrdersByGroupedStatus(orders, status);
      }
      final localOrders = _localQueuedOrders(status: status);
      if (localOrders.isNotEmpty) {
        orders = [...localOrders, ...orders];
      }
      if (generation != _ordersLoadGeneration) return;
      _setState(
        state.copyWith(orders: List.unmodifiable(orders)),
        immediate: true,
      );
    } catch (e) {
      if (generation == _ordersLoadGeneration) {
        _setState(state.copyWith(error: e.toString()), immediate: true);
      }
    } finally {
      if (generation == _ordersLoadGeneration) {
        _setState(
          state.copyWith(isLoadingOrders: false),
          immediate: true,
        );
      }
    }
  }

  /// Refresh stats + orders list after any order state change
  Future<void> refreshOrdersAndStats() async {
    await Future.wait([
      loadOrders(
        vendedorCodes: state.vendedorCodes,
        status: state.orderStatusFilter,
        forceRefresh: true,
      ),
      loadOrderStats(
        vendedorCodes: state.vendedorCodes,
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
    _setState(state.copyWith(isLoadingStats: true), immediate: true);
    final canRefreshFromNetwork =
        ConnectivityService.instance.currentStatus == ConnectivityStatus.online;
    final effectiveForceRefresh = forceRefresh && canRefreshFromNetwork;
    if (effectiveForceRefresh) {
      await CacheService.invalidateByPrefix('pedidos:stats:');
      if (ref.mounted) {
        _setState(
          state.copyWith(
            orderStats: OrderStats(
              totalOrders: 0,
              totalAmount: 0,
              totalBase: 0,
              totalIva: 0,
              avgMargin: 0,
              avgTicket: 0,
              byStatus: const <String, int>{},
              dailyTrend: const <Map<String, dynamic>>[],
              topClients: const <Map<String, dynamic>>[],
            ),
          ),
          immediate: true,
        );
      }
    }
    try {
      final stats = await PedidosService.getOrderStats(
        vendedorCodes: vendedorCodes,
        dateFrom: dateFrom,
        dateTo: dateTo,
        forceRefresh: effectiveForceRefresh,
      );
      _setState(state.copyWith(orderStats: stats), immediate: true);
    } catch (e) {
      _debugLog('[PedidosNotifier] loadOrderStats error: $e');
      if (state.orderStats == null) {
        _setState(
          state.copyWith(
            orderStats: OrderStats(
              totalOrders: 0,
              totalAmount: 0,
              totalBase: 0,
              totalIva: 0,
              avgMargin: 0,
              avgTicket: 0,
              byStatus: const <String, int>{},
              dailyTrend: const <Map<String, dynamic>>[],
              topClients: const <Map<String, dynamic>>[],
            ),
          ),
          immediate: true,
        );
      }
    } finally {
      _setState(state.copyWith(isLoadingStats: false), immediate: true);
    }
  }

  void setOrderStatusFilter(String? status) {
    _setState(
      state.copyWith(
        orderStatusFilter: status,
        clearOrderStatusFilter: status == null,
      ),
      immediate: true,
    );
  }

  Future<void> deleteDraftOrder(int orderId) async {
    await PedidosService.deleteDraftOrder(orderId);
    final orders =
        state.orders.where((o) => o.id != orderId).toList(growable: false);
    _setState(state.copyWith(orders: List.unmodifiable(orders)),
        immediate: true);
    await refreshOrdersAndStats();
  }

  Future<Map<String, dynamic>> confirmExistingOrder(
    int orderId,
    String saleType,
  ) async {
    final confirmedResult =
        await PedidosService.confirmOrder(orderId, saleType);
    final result = helpers.normalizeConfirmOrderResultForProvider(
      createResult: {'id': orderId},
      confirmedResult: Map<String, dynamic>.from(confirmedResult),
    );

    if (!helpers.isConfirmedOrderResultForProvider(result)) {
      final message = result['message']?.toString().trim();
      final status = helpers.orderConfirmationStatusForProvider(result);
      throw Exception(
        message != null && message.isNotEmpty
            ? message
            : 'Pedido no confirmado. Estado actual: '
                '${status.isEmpty ? 'DESCONOCIDO' : status}',
      );
    }

    final orders = List<OrderSummary>.from(state.orders);
    final idx = orders.indexWhere((o) => o.id == orderId);
    if (idx != -1) {
      final o = orders[idx];
      orders[idx] = OrderSummary(
        id: o.id,
        numeroPedido: o.numeroPedido,
        clienteCode: o.clienteCode,
        clienteName: o.clienteName,
        vendedorCode: o.vendedorCode,
        fecha: o.fecha,
        estado: helpers.orderConfirmationStatusForProvider(result),
        tipoVenta: saleType,
        total: o.total,
        margen: o.margen,
        lineCount: o.lineCount,
      );
      _setState(
        state.copyWith(orders: List.unmodifiable(orders)),
        immediate: true,
      );
    }
    await refreshOrdersAndStats();
    try {
      unawaited(ref.read(bolsaProvider.notifier).refresh());
    } catch (_) {
      // Bolsa no disponible en tests puros: no crítico.
    }
    return result;
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
      _setState(
        state.copyWith(
          clientHistory:
              List.unmodifiable(reco['clientHistory'] ?? const []),
          similarClients:
              List.unmodifiable(reco['similarClients'] ?? const []),
        ),
        immediate: true,
      );
    } catch (e) {
      _debugLog('[PedidosNotifier] Error loading recommendations: $e');
    }
  }

  // ── Offline Support / Drafts (tramos 1863-1932) ──

  Future<void> saveDraft(String vendedorCode,
      {bool isAutoSave = false}) async {
    if (!state.hasClient) {
      if (!isAutoSave) {
        _setState(
          state.copyWith(
            error: 'Selecciona un cliente antes de guardar el borrador.',
          ),
          immediate: true,
        );
      }
      return;
    }
    if (!state.hasLines) {
      if (!isAutoSave) {
        _setState(
          state.copyWith(
            error: 'Añade líneas antes de guardar el borrador.',
          ),
          immediate: true,
        );
      }
      return;
    }
    try {
      if (isAutoSave && state.hasLines) {
        await PedidosOfflineService.saveAutoDraft(
          clientCode: state.clientCode!,
          clientName: state.clientName ?? '',
          saleType: state.saleType,
          vendedorCode: vendedorCode,
          lines: state.lines,
          globalDiscountPct: state.globalDiscountPct,
        );
        _setState(
          state.copyWith(lastAutoSaved: DateTime.now(), isDirty: false),
          immediate: true,
        );
      } else if (!isAutoSave) {
        await PedidosOfflineService.saveDraft(
          draftKey:
              'draft_manual_${state.clientCode}_${DateTime.now().millisecondsSinceEpoch}',
          clientCode: state.clientCode!,
          clientName: state.clientName ?? '',
          saleType: state.saleType,
          vendedorCode: vendedorCode,
          lines: state.lines,
          globalDiscountPct: state.globalDiscountPct,
        );
        _setState(
          state.copyWith(isDirty: false, lastAutoSaved: DateTime.now()),
          immediate: true,
        );
      }
    } catch (e) {
      _debugLog('[PedidosNotifier] saveDraft error: $e');
    }
  }

  void loadDraft(Map<String, dynamic> draft) {
    final lines = <OrderLine>[];
    final lastQty =
        Map<String, double>.from(state.lastQtyByProduct);
    final lastUnit =
        Map<String, String>.from(state.lastUnitByProduct);
    final linesData = draft['lines'] as List? ?? [];
    for (final l in linesData) {
      final line = OrderLine.fromJson(l as Map<String, dynamic>);
      line.recalculate();
      lines.add(line);
      lastQty[_qtyKey(line.codigoArticulo)] = line.cantidadEnvases > 0
          ? line.cantidadEnvases
          : line.cantidadUnidades;
      lastUnit[_qtyKey(line.codigoArticulo)] = line.unidadMedida;
    }
    _setState(
      state.copyWith(
        clientCode: draft['clientCode'] as String?,
        clientName: draft['clientName'] as String?,
        saleType: (draft['saleType'] as String?) ?? 'CC',
        globalDiscountPct:
            (draft['globalDiscountPct'] as num?)?.toDouble() ?? 0,
        complementaryProducts: const [],
        lines: List.unmodifiable(lines),
        lastQtyByProduct: Map.unmodifiable(lastQty),
        lastUnitByProduct: Map.unmodifiable(lastUnit),
        clearError: true,
      ),
    );
  }

  Future<void> deleteDraft(String key) async {
    try {
      await PedidosOfflineService.deleteDraft(key);
      _setState(state, immediate: true);
    } catch (e) {
      _debugLog('[PedidosNotifier] deleteDraft error: $e');
    }
  }

  // ── Client Balance (tramos 1965-2006) ──
  Future<void> loadClientBalance(String clientCode) async {
    final code = clientCode.trim();
    if (code.isEmpty) {
      _setState(state.copyWith(clientBalance: const {}), immediate: true);
      return;
    }

    final generation = ++_clientBalanceLoadGeneration;
    _setState(
      state.copyWith(
        clientBalance: {
          'balanceStatus': 'loading',
          'clientCode': code,
        },
      ),
      immediate: true,
    );

    try {
      final balance = await PedidosService.getClientBalance(code);
      if (!ref.mounted || generation != _clientBalanceLoadGeneration) return;
      if ((state.clientCode ?? '').trim() != code) return;
      _setState(
        state.copyWith(
          clientBalance: Map.unmodifiable(balance.isEmpty
              ? {
                  'balanceStatus': 'unknown',
                  'clientCode': code,
                  'message': 'Sin datos de deuda devueltos',
                }
              : {
                  ...balance,
                  'balanceStatus': balance['balanceStatus'] ?? 'data',
                  'clientCode': code,
                }),
        ),
        immediate: true,
      );
    } catch (e) {
      if (!ref.mounted || generation != _clientBalanceLoadGeneration) return;
      _setState(
        state.copyWith(
          clientBalance: const {},
        ),
        immediate: true,
      );
      _setState(
        state.copyWith(
          clientBalance: Map.unmodifiable({
            'balanceStatus': 'error',
            'loadError': true,
            'clientCode': code,
            'message': 'No se pudo cargar la deuda',
          }),
        ),
        immediate: true,
      );
    }
  }

  // ── Favorites (tramos 2009-2030 + fase1 memoria) ──
  /// Favoritos en memoria (fase1). Persistencia Hive en fase2.
  void initFavorites(List<String> savedCodes) {
    _setState(
      state.copyWith(favoriteProductCodes: Set.unmodifiable(savedCodes)),
      immediate: true,
    );
  }

  void toggleFavoriteInMemory(String productCode) {
    final next = Set<String>.from(state.favoriteProductCodes);
    if (!next.remove(productCode)) next.add(productCode);
    _setState(
      state.copyWith(favoriteProductCodes: Set.unmodifiable(next)),
      immediate: true,
    );
  }

  /// Toggle con persistencia Hive (paridad tramo 2014-2029 del viejo).
  void toggleFavorite(String productCode) {
    toggleFavoriteInMemory(productCode);
    unawaited(
      PedidosFavoritesService.toggleFavorite(productCode).catchError(
        (Object e) {
          _debugLog('[PedidosNotifier] toggleFavorite persist error: $e');
        },
      ),
    );
  }

  bool isFavorite(String productCode) =>
      state.favoriteProductCodes.contains(productCode);

  void setLastPriceForProduct(String code, double price) {
    final next = Map<String, double>.from(state.lastPriceByProduct);
    next[code.trim()] = price;
    _setState(
      state.copyWith(lastPriceByProduct: Map.unmodifiable(next)),
      immediate: true,
    );
  }

  // ── Complementary Products & Promotions (tramos 2035-2144) ──
  Future<void> loadComplementaryProducts() async {
    if (state.lines.isEmpty) {
      _setState(
        state.copyWith(complementaryProducts: const []),
        immediate: true,
      );
      return;
    }
    try {
      final codes = state.lines.map((l) => l.codigoArticulo).toList();
      final complementary =
          await PedidosService.getComplementaryProducts(
        codes,
        clientCode: state.clientCode,
      );
      _setState(
        state.copyWith(
          complementaryProducts: List.unmodifiable(complementary),
        ),
        immediate: true,
      );
    } catch (e) {
      _debugLog('[PedidosNotifier] loadComplementaryProducts error: $e');
    }
  }

  Future<void> loadPromotions({String? vendedorCodes}) async {
    final vendor = (vendedorCodes ?? state.vendedorCodes).trim();
    var next = state;
    if (vendor.isNotEmpty) {
      next = next.copyWith(vendedorCodes: vendor);
    }
    final clientCode = helpers.normalizePedidoClientCode(next.clientCode);
    if (clientCode.isEmpty) {
      _setState(
        next.copyWith(
          activePromotionsList: const [],
          promotionsByProduct: const {},
          promotionsError: false,
        ),
        immediate: true,
      );
      return;
    }
    next = next.copyWith(clientCode: clientCode, promotionsError: false);
    _setState(next, immediate: true);

    try {
      final cacheKey =
          helpers.promotionsCacheKey(clientCode, next.vendedorCodes);
      final cached = CacheService.get<Object?>(cacheKey);
      final reuseCache = helpers.shouldReusePromotionsCache(cached);
      final Map<String, dynamic> response;
      if (reuseCache && cached is Map) {
        response = Map<String, dynamic>.from(cached);
      } else {
        response = await ApiClient.get(
          '/pedidos/promotions',
          queryParameters: {
            'clientCode': clientCode,
            if (next.vendedorCodes.isNotEmpty)
              'vendedorCodes': next.vendedorCodes,
          },
          cacheKey: cacheKey,
          cacheTTL: CacheService.defaultTTL,
          cacheResponse: false,
          forceRefresh: true,
        );
        if (helpers.shouldReusePromotionsCache(response)) {
          await CacheService.set(
            cacheKey,
            response,
            ttl: CacheService.defaultTTL,
          );
        } else {
          await CacheService.invalidate(cacheKey);
        }
      }
      final list = response['promotions'] as List? ?? [];
      final activePromos = <PromotionItem>[];
      final promosByProduct = <String, List<PromotionItem>>{};
      final seen = <String>{};
      for (final p in list) {
        if (p is! Map) continue;
        final item = PromotionItem.fromJson(Map<String, dynamic>.from(p));
        final minQtyStr = item.minQty.toStringAsFixed(2);
        final giftQtyStr = item.giftQty.toStringAsFixed(2);
        final promoPriceStr = item.promoPrice.toStringAsFixed(2);
        final key =
            '${item.promoType}|${item.promoCode}|${item.code}|${item.dateFrom}|${item.dateTo}|$minQtyStr|$giftQtyStr|$promoPriceStr';
        if (!seen.add(key)) continue;
        activePromos.add(item);
        final productCode = _promotionProductCode(item);
        if (productCode.isNotEmpty) {
          (promosByProduct[productCode] ??= []).add(item);
        }
      }
      final lines = List<OrderLine>.from(state.lines);
      _syncAllGiftPromotionLinesInto(lines, promosByProduct);
      _debugLog(
        '[PedidosNotifier] Loaded ${activePromos.length} promotions for $clientCode',
      );
      _setState(
        state.copyWith(
          clientCode: clientCode,
          vendedorCodes: next.vendedorCodes,
          activePromotionsList: List.unmodifiable(activePromos),
          promotionsByProduct: Map.unmodifiable(promosByProduct),
          lines: List.unmodifiable(lines),
          promotionsError: false,
        ),
        immediate: true,
      );
    } catch (e, stack) {
      _debugLog('[PedidosNotifier] loadPromotions error: $e');
      _debugLog('[PedidosNotifier] loadPromotions stack: $stack');
      // REQ-03: never fake "0 promos" on error — flag it, keep old list.
      _setState(state.copyWith(promotionsError: true), immediate: true);
    }
  }

  // ── Analytics (tramo 2132-2144) ──
  Future<void> loadAnalytics(String vendedorCodes) async {
    _setState(state.copyWith(isLoadingAnalytics: true), immediate: true);
    try {
      final analytics = await PedidosService.getAnalytics(vendedorCodes);
      _setState(
        state.copyWith(analytics: Map.unmodifiable(analytics)),
        immediate: true,
      );
    } catch (e) {
      _debugLog('[PedidosNotifier] loadAnalytics error: $e');
    } finally {
      _setState(
        state.copyWith(isLoadingAnalytics: false),
        immediate: true,
      );
    }
  }

  // ── Clone Order into Cart (tramo 2146-2173) ──
  Future<void> cloneOrderIntoCart(int orderId) async {
    try {
      final data = await PedidosService.cloneOrder(orderId);
      final lines = <OrderLine>[];
      final lastQty =
          Map<String, double>.from(state.lastQtyByProduct);
      final lastUnit =
          Map<String, String>.from(state.lastUnitByProduct);
      final linesData = data['lines'] as List? ?? [];
      for (final l in linesData) {
        final line = OrderLine.fromJson(l as Map<String, dynamic>);
        line.recalculate();
        lines.add(line);
        lastQty[_qtyKey(line.codigoArticulo)] = line.cantidadEnvases > 0
            ? line.cantidadEnvases
            : line.cantidadUnidades;
        lastUnit[_qtyKey(line.codigoArticulo)] = line.unidadMedida;
      }
      _setState(
        state.copyWith(
          clientCode: data['clientCode'] as String?,
          clientName: data['clientName'] as String?,
          saleType: (data['tipoventa'] as String?) ?? 'CC',
          globalDiscountPct: 0,
          complementaryProducts: const [],
          lines: List.unmodifiable(lines),
          lastQtyByProduct: Map.unmodifiable(lastQty),
          lastUnitByProduct: Map.unmodifiable(lastUnit),
          clearError: true,
        ),
        immediate: true,
      );
    } catch (e) {
      _setState(
        state.copyWith(error: 'Error al clonar pedido: $e'),
        immediate: true,
      );
    }
  }

  // ── Batch Add from Recommendations (tramo 2175-2213) ──
  void addMultipleProducts(List<Product> products, double defaultQty) {
    final lines = List<OrderLine>.from(state.lines);
    final lastQty =
        Map<String, double>.from(state.lastQtyByProduct);
    final lastUnit =
        Map<String, String>.from(state.lastUnitByProduct);
    for (final product in products) {
      final existingIdx =
          lines.indexWhere((l) => l.codigoArticulo == product.code);
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
          precioTarifa: product.catalogTariffForUnit('CAJAS'),
          precioTarifaCliente: product.clientTariffForUnit('CAJAS'),
          precioMinimo: product.precioMinimo,
          precioClienteSource: product.precioClienteSource,
          precioMinimoSource: product.precioMinimoSource,
          precioEspecialCliente: product.precioEspecialCliente,
          permiteBajoMinimo: product.permiteBajoMinimo,
          codigoIva: product.codigoIva,
          ivaRate: ivaRate,
        );
        line.recalculate();
        lines.add(line);
        lastQty[_qtyKey(product.code)] = defaultQty;
        lastUnit[_qtyKey(product.code)] = line.unidadMedida;
        _syncGiftPromotionLinesInto(
          lines,
          state.promotionsByProduct,
          product.code,
          product: product,
        );
      }
    }
    _setState(
      state.copyWith(
        lines: List.unmodifiable(lines),
        lastQtyByProduct: Map.unmodifiable(lastQty),
        lastUnitByProduct: Map.unmodifiable(lastUnit),
        clearError: true,
      ),
    );
  }

  // ── Stock Auto-Refresh for Cart Lines (tramo 2215-2230) ──
  Future<void> refreshCartStock() async {
    if (state.lines.isEmpty) return;

    try {
      final stockByCode = await PedidosService.getStockBatch(
        state.lines.map((line) => line.codigoArticulo),
      );
      final products = List<Product>.from(state.products);
      final metadata =
          Map<String, Product>.from(state.productMetadataByCode);
      for (final entry in stockByCode.entries) {
        _applyStockToLists(products, metadata, entry.key, entry.value);
      }
      _setState(
        state.copyWith(
          products: List.unmodifiable(products),
          productMetadataByCode: Map.unmodifiable(metadata),
        ),
        immediate: true,
      );
    } catch (e) {
      _debugLog('[PedidosNotifier] refreshCartStock batch error: $e');
    }
  }

  // ── Offline queue passthrough (tramo 2232-2246) ──
  List<Map<String, dynamic>> get savedDrafts =>
      PedidosOfflineService.getDrafts();
  int get draftCount => PedidosOfflineService.draftCount;
  int get pendingSyncCount => PedidosOfflineService.pendingSyncCount;

  Future<int> syncPendingOrders() async {
    try {
      final synced = await PedidosOfflineService.syncPendingOrders();
      if (synced > 0) _setState(state, immediate: true);
      return synced;
    } catch (e) {
      _debugLog('[PedidosNotifier] syncPendingOrders error: $e');
      return 0;
    }
  }

  @visibleForTesting
  void debugSetPromotions(List<PromotionItem> promotions) {
    final promosByProduct = <String, List<PromotionItem>>{};
    for (final promo in promotions) {
      final productCode =
          promo.productCode.isNotEmpty ? promo.productCode : promo.code;
      if (productCode.isNotEmpty) {
        (promosByProduct[productCode] ??= []).add(promo);
      }
    }
    final lines = List<OrderLine>.from(state.lines);
    _syncAllGiftPromotionLinesInto(lines, promosByProduct);
    _setState(
      state.copyWith(
        activePromotionsList: List.unmodifiable(promotions),
        promotionsByProduct: Map.unmodifiable(promosByProduct),
        lines: List.unmodifiable(lines),
      ),
      immediate: true,
    );
  }

  // ── Fase3 compat: reenvíos de lectura (paridad con el viejo
  // `PedidosProvider`). Permiten migrar callers con solo renombrar
  // `pedidosProvider`→`pedidosNotifierProvider.notifier` y
  // `PedidosProvider`→`PedidosNotifier`, sin reescribir cuerpos.
  List<OrderLine> get lines => state.lines;
  String? get clientCode => state.clientCode;
  String? get clientName => state.clientName;
  String get saleType => state.saleType;
  String get saleTypeLabel => state.saleTypeLabel;
  List<Product> get products => state.products;
  bool get isLoadingProducts => state.isLoadingProducts;
  String? get productSearch => state.productSearch;
  String? get selectedFamily => state.selectedFamily;
  String? get selectedBrand => state.selectedBrand;
  String? get selectedPrefamily => state.selectedPrefamily;
  List<ProductFamilyFilter> get families => state.families;
  List<String> get brands => state.brands;
  int get productOffset => state.productOffset;
  bool get hasMoreProducts => state.hasMoreProducts;
  List<OrderSummary> get orders => state.orders;
  bool get isLoadingOrders => state.isLoadingOrders;
  String? get orderStatusFilter => state.orderStatusFilter;
  String get vendedorCodes => state.vendedorCodes;
  OrderStats? get orderStats => state.orderStats;
  bool get isLoadingStats => state.isLoadingStats;
  List<Recommendation> get clientHistory => state.clientHistory;
  List<Recommendation> get similarClients => state.similarClients;
  bool get isSaving => state.isSaving;
  String? get error => state.error;
  Map<String, dynamic> get clientBalance => state.clientBalance;
  double get clientSaldoPendiente => state.clientSaldoPendiente;
  Set<String> get favoriteProductCodes => state.favoriteProductCodes;
  List<Map<String, dynamic>> get complementaryProducts =>
      state.complementaryProducts;
  List<PromotionItem> get activePromotionsList => state.activePromotionsList;
  Map<String, List<PromotionItem>> get promotionsByProduct =>
      state.promotionsByProduct;
  bool get promotionsError => state.promotionsError;
  Map<String, dynamic> get analytics => state.analytics;
  bool get isLoadingAnalytics => state.isLoadingAnalytics;
  DateTime? get lastAutoSaved => state.lastAutoSaved;
  bool get isDirty => state.isDirty;
  bool get isJefeVentas => state.isJefeVentas;
  bool get isMarginVisible => state.isMarginVisible;
  String get userRole => state.userRole;
  String get userCode => state.userCode;
  String? get draftWarningMessage => state.draftWarningMessage;
  int get accumulatedDraftCount => state.accumulatedDraftCount;
  int get draftAutoSendThreshold => state.draftAutoSendThreshold;
  bool get hasDraftAccumulationWarning => state.hasDraftAccumulationWarning;
  bool get onlyWithStock => state.onlyWithStock;
  CatalogProductSort get catalogSort => state.catalogSort;
  double get globalDiscountPct => state.globalDiscountPct;
  double get totalImporte => state.totalImporte;
  double get totalDescuento => state.totalDescuento;
  double get totalConDescuento => state.totalConDescuento;
  double get totalBase => state.totalBase;
  double get totalIva => state.totalIva;
  double get totalConIva => state.totalConIva;
  double get totalCosto => state.totalCosto;
  double get totalMargen => state.totalMargen;
  double get porcentajeMargen => state.porcentajeMargen;
  bool get hasClient => state.hasClient;
  bool get hasLines => state.hasLines;
  int get lineCount => state.lineCount;
  double get cartDisplayQty => state.cartDisplayQty;
  String get cartDisplayQtyLabel => state.cartDisplayQtyLabel;
  double get totalEnvases => state.totalEnvases;
  double get totalUnidades => state.totalUnidades;
  OrderBolsaImpact get estimatedBolsaImpact => state.estimatedBolsaImpact;
  Map<int, double> get ivaBreakdown => state.ivaBreakdown;
  PromotionItem? getPromo(String productCode) => state.getPromo(productCode);
  List<PromotionItem> getPromosForProduct(String productCode) =>
      state.getPromosForProduct(productCode);
  int getPromoCount(String productCode) => state.getPromoCount(productCode);
  double lastQtyForProduct(String code, {String? clientCode}) =>
      state.lastQtyForProduct(code, clientCode: clientCode);
  String? lastUnitForProduct(String code, {String? clientCode}) =>
      state.lastUnitForProduct(code, clientCode: clientCode);
  double? lastPriceForProduct(String code) => state.lastPriceForProduct(code);
}

final pedidosNotifierProvider =
    NotifierProvider<PedidosNotifier, PedidosState>(PedidosNotifier.new);
