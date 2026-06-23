/// Pedidos Page
/// ============
/// Main order entry page for commercial orders.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/vendor_scope.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/features/objectives/presentation/pages/enhanced_client_matrix_page.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_favorites_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/dialogs/client_search_dialog.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/pages/promotions_list_page.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/client_balance_badge.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/complementary_products.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/add_to_order_sheet.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/albaran_info_dialog.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/drafts_bottom_sheet.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_card.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_detail_sheet.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_empty_state.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_filters_bar.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/mis_pedidos_yoy_bar.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_kpi_dashboard.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_status_badge.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_summary_widget.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/product_card.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/product_search_widget.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/recommendations_section.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/sale_type_selector.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/stock_alternatives_sheet.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/unit_selector_modal.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

void _debugLog(String message) {
  if (kDebugMode) debugPrint(message);
}

class PedidosPage extends ConsumerStatefulWidget {
  const PedidosPage({
    required this.employeeCode,
    required this.isJefeVentas,
    super.key,
    this.forceShowVendorSelector = false,
    this.initialClientCode,
    this.initialClientName,
  });
  final String employeeCode;
  final bool isJefeVentas;
  final bool forceShowVendorSelector;
  final String? initialClientCode;
  final String? initialClientName;

  @override
  ConsumerState<PedidosPage> createState() => _PedidosPageState();
}

class _PedidosPageState extends ConsumerState<PedidosPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final ScrollController _catalogScrollController = ScrollController();
  Timer? _stockRefreshTimer;
  Timer? _autoSaveTimer;
  ProviderSubscription<String?>? _vendorSubscription;

  // Mejora 10 — Mis Pedidos search & date filter
  String _orderSearch = '';
  DateTime? _orderDateFrom;
  DateTime? _orderDateTo;
  double? _orderMinAmount;
  double? _orderMaxAmount;
  String _orderSortBy = 'fecha';
  String _orderSortOrder = 'DESC';

  // Cache guard: solo cargar datos de Mis Pedidos la primera vez
  bool _misPedidosLoaded = false;

  // Rutero-style sort modes for order inspection
  String _orderSortMode =
      'custom'; // 'custom', 'route', 'sales_desc', 'sales_asc'
  List<Map<String, dynamic>> _ruteroClientData = [];
  bool _isLoadingRuteroData = false;
  String? _ruteroClientDataKey;
  String? _devolucionesFutureKey;
  Future<Map<String, dynamic>>? _devolucionesFuture;
  static const Map<String, String> _orderSortModeLabels = {
    'sales_desc': 'Mayor Acumulado',
    'sales_asc': 'Menor Acumulado',
    'route': 'Ruta Original',
    'custom': 'Orden Personalizado',
  };

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _tabController.addListener(_onTabChange);

    if (widget.isJefeVentas || widget.forceShowVendorSelector) {
      _vendorSubscription =
          ref.listenManual<String?>(selectedVendorProvider, (previous, next) {
        if (previous != next) _onVendorFilterChanged();
      });
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.initialClientCode != null &&
          widget.initialClientName != null) {
        final prov = ref.read(pedidosProvider);
        prov.setClient(widget.initialClientCode!, widget.initialClientName!);
        prov.loadRecommendations(
          clientCode: widget.initialClientCode!,
          vendedorCode: widget.employeeCode,
        );
        prov.loadClientBalance(widget.initialClientCode!);
      }
      _loadInitialData();
      _initOffline();
      _initFavorites();
      ref.read(pedidosProvider).addListener(_onProviderChange);
    });

    if (widget.initialClientCode != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _tabController.animateTo(2);
      });
    }

    _catalogScrollController.addListener(_onCatalogScroll);

    // Auto-refresh stock every 120 seconds only when cart has items
    _stockRefreshTimer = Timer.periodic(
      const Duration(seconds: 120),
      (_) {
        if (mounted) {
          final prov = ref.read(pedidosProvider);
          if (prov.hasLines) {
            prov.refreshCartStock();
          }
        }
      },
    );
  }

  @override
  void didUpdateWidget(covariant PedidosPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.employeeCode != widget.employeeCode ||
        oldWidget.isJefeVentas != widget.isJefeVentas ||
        oldWidget.forceShowVendorSelector != widget.forceShowVendorSelector) {
      _onVendorFilterChanged();
    }
  }

  void _onProviderChange() {
    if (!mounted) return;
    final prov = ref.read(pedidosProvider);
    if (prov.isDirty) {
      if (_autoSaveTimer == null || !_autoSaveTimer!.isActive) {
        _autoSaveTimer = Timer(const Duration(seconds: 5), () {
          if (mounted && prov.isDirty) {
            prov.saveDraft(_vendedorCodes, isAutoSave: true);
          }
        });
      }
    }
  }

  @override
  void dispose() {
    _vendorSubscription?.close();
    _stockRefreshTimer?.cancel();
    _autoSaveTimer?.cancel();
    _debounceTimer?.cancel();
    _tabController.dispose();
    _catalogScrollController.dispose();
    try {
      ref.read(pedidosProvider).removeListener(_onProviderChange);
    } catch (_) {}
    super.dispose();
  }

  void _onTabChange() {
    if (_tabController.index == 1 && mounted) {
      if (!_misPedidosLoaded) {
        _misPedidosLoaded = true;
        unawaited(
          ref
              .read(pedidosProvider)
              .loadOrderStats(vendedorCodes: _vendedorCodes),
        );
        unawaited(_loadOrdersWithFilters(ref.read(pedidosProvider)));
        if (_ruteroClientData.isEmpty) {
          unawaited(_loadRuteroClientData());
        }
      }
    }
    if (_tabController.index == 0 && mounted) {
      ref.read(pedidosProvider).loadComplementaryProducts();
    }
    if (mounted) setState(() {});
  }

  Future<void> _initFavorites() async {
    try {
      await PedidosFavoritesService.init();
      if (mounted) {
        final favs = PedidosFavoritesService.getFavorites();
        ref.read(pedidosProvider).initFavorites(favs);
      }
    } catch (e) {
      _debugLog('[PedidosPage] Favorites init error: $e');
    }
  }

  String get _vendedorCodes {
    final authState =
        ProviderScope.containerOf(context).read(authProvider).value;
    final vendedorCodes = authState?.vendedorCodes ?? [];
    var codes = vendedorCodes.join(',');
    if (hasCommercial80VendorScope(
      userCode: authState?.user?.code,
      vendorCodes: vendedorCodes,
    )) {
      return resolveScopedVendorCodes(
        userCode: authState?.user?.code,
        authVendorCodes: vendedorCodes,
        selectedVendor: ref.read(selectedVendorProvider),
        fallbackVendorCodes: widget.employeeCode,
      );
    }
    // JEFE_VENTAS: respect global "Ver como" filter
    if (widget.isJefeVentas) {
      final selected = ref.read(selectedVendorProvider);
      if (selected != null && selected.isNotEmpty) {
        codes = selected;
      }
    }
    return codes;
  }

  String get _activeOrderVendedorCode {
    final selectedCodes = _vendedorCodes
        .split(',')
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty && code.toUpperCase() != 'ALL')
        .toList(growable: false);
    return selectedCodes.length == 1
        ? selectedCodes.first
        : widget.employeeCode;
  }

  void _onVendorFilterChanged() {
    if (!mounted) return;
    _misPedidosLoaded = false;
    _ruteroClientData = [];
    _ruteroClientDataKey = null;
    _devolucionesFuture = null;
    _devolucionesFutureKey = null;
    _loadInitialData();
  }

  Future<void> _initOffline() async {
    try {
      await PedidosOfflineService.init();
      // Auto-sync pending orders
      final provider = ref.read(pedidosProvider);
      final synced = await provider.syncPendingOrders();
      if (synced > 0 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('$synced pedido(s) sincronizado(s)'),
            backgroundColor: AppTheme.neonGreen,
          ),
        );
        await provider.loadOrders(
          vendedorCodes: _vendedorCodes,
          forceRefresh: true,
        );
      }
    } catch (e) {
      _debugLog('[PedidosPage] Offline init error: $e');
    }
  }

  void _loadInitialData({bool forceRefreshProducts = false}) {
    final provider = ref.read(pedidosProvider);
    final codes = _vendedorCodes;
    if (provider.hasClient) {
      provider.loadProducts(
        vendedorCodes: codes,
        reset: true,
        forceRefresh: forceRefreshProducts,
      );
    }
    provider.loadFilters();
    provider.loadPromotions();

    // Req #8: refrescar estado de borradores acumulados y notificar al usuario
    // si supera el umbral. Se hace por vendedor primario (primer código).
    final firstVendor = codes.split(',').first.trim();
    if (firstVendor.isNotEmpty) {
      provider.refreshDraftStatus(firstVendor).then((_) {
        if (!mounted) return;
        if (provider.hasDraftAccumulationWarning) {
          final msg = provider.draftWarningMessage ??
              'Tienes ${provider.accumulatedDraftCount} borradores '
                  'acumulados. Conviene confirmar el más antiguo.';
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(msg),
              backgroundColor: AppTheme.warning,
              duration: const Duration(seconds: 5),
              action: SnackBarAction(
                label: 'Ver',
                textColor: Colors.white,
                onPressed: () {
                  // El usuario ya está en la pantalla de pedidos; mostramos sus
                  // borradores cambiando al tab "Mis Pedidos".
                  if (_tabController.length > 1) {
                    _tabController.animateTo(1);
                  }
                  provider.clearDraftWarning();
                },
              ),
            ),
          );
        }
      });
    }
  }

  void _onCatalogScroll() {
    if (_catalogScrollController.position.pixels >=
        _catalogScrollController.position.maxScrollExtent - 200) {
      final provider = ref.read(pedidosProvider);
      if (!provider.hasClient) return;
      provider.loadMoreProducts(_vendedorCodes);
    }
  }

  void _onProductTap(Product product) {
    final provider = ref.read(pedidosProvider);
    if (!provider.hasClient) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Selecciona un cliente antes de anadir productos'),
          backgroundColor: AppTheme.warning,
        ),
      );
      return;
    }
    _showAddToOrderDialog(product);
  }

  Future<void> _openProductByCode(
    String code, {
    String fallbackName = '',
    double suggestedEnvases = 0,
    double? fallbackStockEnvases,
    double? fallbackStockUnidades,
    double? fallbackUnitsPerBox,
    double? fallbackUnitsFraction,
    double? fallbackPrecioTarifa1,
    double? fallbackPrecioMinimo,
    double? fallbackPrecioCliente,
    String? fallbackUnitMeasure,
  }) async {
    final productCode = code.trim();
    if (productCode.isEmpty) return;

    final provider = ref.read(pedidosProvider);
    if (!provider.hasClient) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Selecciona un cliente antes de anadir productos'),
            backgroundColor: AppTheme.warning,
          ),
        );
      }
      return;
    }

    Product? product;
    try {
      final detail = await PedidosService.getProductDetail(
        productCode,
        clientCode: provider.clientCode,
      );
      product = detail.product;
      _debugLog(
        '[pedidos] _openProductByCode: code=$productCode '
        'stockEnvases=${product.stockEnvases} stockUnidades=${product.stockUnidades}',
      );
      // If API returned 0 stock but we have enriched data from recommendation, use it
      if (product.stockEnvases == 0 &&
          product.stockUnidades == 0 &&
          fallbackStockEnvases != null &&
          fallbackStockEnvases > 0) {
        _debugLog(
          '[pedidos] _openProductByCode: API returned 0 stock, '
          'using fallback from recommendation: '
          'envases=$fallbackStockEnvases uds=$fallbackStockUnidades',
        );
        product = Product(
          code: product.code,
          name: product.name,
          brand: product.brand,
          family: product.family,
          ean: product.ean,
          unitsPerBox: product.unitsPerBox > 1
              ? product.unitsPerBox
              : (fallbackUnitsPerBox ?? 1),
          unitsFraction: product.unitsFraction > 0
              ? product.unitsFraction
              : (fallbackUnitsFraction ?? 0),
          unitMeasure: product.unitMeasure.isNotEmpty
              ? product.unitMeasure
              : (fallbackUnitMeasure ?? ''),
          stockEnvases: fallbackStockEnvases,
          stockUnidades: fallbackStockUnidades ?? 0,
          precioTarifa1: product.precioTarifa1 > 0
              ? product.precioTarifa1
              : (fallbackPrecioTarifa1 ?? 0),
          precioMinimo: product.precioMinimo > 0
              ? product.precioMinimo
              : (fallbackPrecioMinimo ?? 0),
          precioCliente: product.precioCliente > 0
              ? product.precioCliente
              : (fallbackPrecioCliente ?? 0),
          precioTarifaCliente: product.precioTarifaCliente,
          codigoTarifaCliente: product.codigoTarifaCliente,
          nameExt: product.nameExt,
          familyName: product.familyName,
          prefamilia: product.prefamilia,
          subFamily: product.subFamily,
          grupoGeneral: product.grupoGeneral,
          tipoProducto: product.tipoProducto,
          claseArticulo: product.claseArticulo,
          categoria: product.categoria,
          gama: product.gama,
          codigoIva: product.codigoIva,
          pesoNeto: product.pesoNeto,
          volumen: product.volumen,
          grados: product.grados,
          calibre: product.calibre,
          observacion1: product.observacion1,
          observacion2: product.observacion2,
          presentacion: product.presentacion,
          formato: product.formato,
          productoPesado: product.productoPesado,
          trazable: product.trazable,
          unidadPale: product.unidadPale,
          unidadFilaPale: product.unidadFilaPale,
          fechaAlta: product.fechaAlta,
          anoBaja: product.anoBaja,
          mesBaja: product.mesBaja,
          hasPurchased: product.hasPurchased,
          salesThisYear: product.salesThisYear,
          salesPrevYear: product.salesPrevYear,
          yoyChange: product.yoyChange,
          unitsRetractil: product.unitsRetractil,
          weight: product.weight,
        );
      }
    } catch (e) {
      _debugLog(
        '[pedidos] _openProductByCode: getProductDetail failed for '
        '$productCode, falling back to catalog. Error: $e',
      );
      for (final p in provider.products) {
        if (p.code == productCode) {
          product = p;
          _debugLog(
            '[pedidos] _openProductByCode: found in catalog, '
            'stockEnvases=${p.stockEnvases} stockUnidades=${p.stockUnidades}',
          );
          break;
        }
      }
      // If catalog also has 0 stock, use recommendation fallback
      if (product != null &&
          product.stockEnvases == 0 &&
          product.stockUnidades == 0 &&
          fallbackStockEnvases != null &&
          fallbackStockEnvases > 0) {
        product = Product(
          code: product.code,
          name: product.name,
          brand: product.brand,
          family: product.family,
          ean: product.ean,
          unitsPerBox: product.unitsPerBox > 1
              ? product.unitsPerBox
              : (fallbackUnitsPerBox ?? 1),
          unitsFraction: product.unitsFraction > 0
              ? product.unitsFraction
              : (fallbackUnitsFraction ?? 0),
          unitMeasure: product.unitMeasure.isNotEmpty
              ? product.unitMeasure
              : (fallbackUnitMeasure ?? ''),
          stockEnvases: fallbackStockEnvases,
          stockUnidades: fallbackStockUnidades ?? 0,
          precioTarifa1: product.precioTarifa1 > 0
              ? product.precioTarifa1
              : (fallbackPrecioTarifa1 ?? 0),
          precioMinimo: product.precioMinimo > 0
              ? product.precioMinimo
              : (fallbackPrecioMinimo ?? 0),
          precioCliente: product.precioCliente > 0
              ? product.precioCliente
              : (fallbackPrecioCliente ?? 0),
          precioTarifaCliente: product.precioTarifaCliente,
          codigoTarifaCliente: product.codigoTarifaCliente,
          nameExt: product.nameExt,
          familyName: product.familyName,
          prefamilia: product.prefamilia,
          subFamily: product.subFamily,
          grupoGeneral: product.grupoGeneral,
          tipoProducto: product.tipoProducto,
          claseArticulo: product.claseArticulo,
          categoria: product.categoria,
          gama: product.gama,
          codigoIva: product.codigoIva,
          pesoNeto: product.pesoNeto,
          volumen: product.volumen,
          grados: product.grados,
          calibre: product.calibre,
          observacion1: product.observacion1,
          observacion2: product.observacion2,
          presentacion: product.presentacion,
          formato: product.formato,
          productoPesado: product.productoPesado,
          trazable: product.trazable,
          unidadPale: product.unidadPale,
          unidadFilaPale: product.unidadFilaPale,
          fechaAlta: product.fechaAlta,
          anoBaja: product.anoBaja,
          mesBaja: product.mesBaja,
          hasPurchased: product.hasPurchased,
          salesThisYear: product.salesThisYear,
          salesPrevYear: product.salesPrevYear,
          yoyChange: product.yoyChange,
          unitsRetractil: product.unitsRetractil,
          weight: product.weight,
        );
      }
    }

    if (product == null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'No se pudo cargar el artículo ${fallbackName.isNotEmpty ? fallbackName : productCode}',
          ),
          backgroundColor: AppTheme.error,
        ),
      );
      return;
    }

    if (mounted && product != null) {
      _showAddToOrderDialog(product, suggestedEnvases: suggestedEnvases);
    }
  }

  Future<String?> _addGiftPromotionLine(
    String code,
    String fallbackName,
    double qty,
  ) async {
    if (qty <= 0) return null;
    final provider = ref.read(pedidosProvider);
    if (!provider.hasClient) {
      return 'Selecciona un cliente primero';
    }

    final productCode = code.trim();
    if (productCode.isEmpty) {
      return 'Codigo de articulo invalido';
    }

    final fixedGiftPromos = provider
        .getPromosForProduct(productCode)
        .where((p) => p.hasFixedGiftProduct)
        .toList();
    if (fixedGiftPromos.isNotEmpty) {
      return 'El regalo de esta promoción se aplica automáticamente al pedido';
    }

    for (final line in provider.lines) {
      if (line.codigoArticulo == productCode &&
          line.claseLinea.toUpperCase() == 'VT') {
        return 'El articulo ya esta en el pedido como venta (VT)';
      }
    }

    Product? product;
    for (final p in provider.products) {
      if (p.code == productCode) {
        product = p;
        break;
      }
    }

    if (product == null) {
      try {
        final detail = await PedidosService.getProductDetail(
          productCode,
          clientCode: provider.clientCode,
        );
        product = detail.product;
      } catch (_) {
        return 'No se pudo cargar el articulo ${fallbackName.isNotEmpty ? fallbackName : productCode}';
      }
    }

    if (product == null) {
      return 'No se pudo cargar el articulo ${fallbackName.isNotEmpty ? fallbackName : productCode}';
    }

    final unit = product.availableUnits.contains('CAJAS')
        ? 'CAJAS'
        : product.availableUnits.first;
    final envases = unit == 'CAJAS' ? qty : 0.0;
    final unidades = unit == 'CAJAS'
        ? qty * (product.unitsPerBox > 0 ? product.unitsPerBox : 1)
        : qty;

    final err = provider.addLine(product, envases, unidades, unit, 0);
    if (err != null) return err;

    final idx = provider.lines
        .lastIndexWhere((line) => line.codigoArticulo == productCode);
    if (idx >= 0) {
      provider.updateLineClaseLinea(idx, 'SC');
    }
    return null;
  }

  void _showAddToOrderDialog(Product product, {double suggestedEnvases = 0}) {
    AddToOrderSheet.show(
      context,
      ref,
      product: product,
      suggestedEnvases: suggestedEnvases,
    );
  }

  void _showDraftsDialog(PedidosProvider provider) {
    DraftsBottomSheet.show(context, ref, provider: provider);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        backgroundColor: AppTheme.inkSurface,
        toolbarHeight: 52,
        title: Text(
          'Pedidos',
          style: TextStyle(
            color: Colors.white,
            fontSize: Responsive.fontSize(context, small: 18, large: 22),
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          if (_tabController.index == 1)
            Consumer(
              builder: (ctx, ref, _) {
                final isLoading =
                    ref.watch(pedidosProvider.select((p) => p.isLoadingOrders));
                return IconButton(
                  icon: isLoading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AppTheme.neonBlue,
                          ),
                        )
                      : const Icon(Icons.refresh, color: AppTheme.neonBlue),
                  tooltip: 'Recargar pedidos',
                  onPressed: isLoading ? null : _refreshMisPedidos,
                );
              },
            ),
          // View Promotions button
          Consumer(
            builder: (ctx, ref, _) {
              final prov = ref.watch(pedidosProvider);
              if (!prov.hasClient) return const SizedBox.shrink();
              final promos = prov.activePromotionsList;
              // Count unique promotions by promoCode, not individual items
              final uniquePromoCodes =
                  promos.map((p) => p.promoCode).toSet().length;
              return Stack(
                children: [
                  IconButton(
                    icon: const Icon(
                      Icons.local_offer_outlined,
                      color: AppTheme.neonPurple,
                    ),
                    tooltip: 'Ver Promociones',
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => PromotionsListPage(
                            promotions: promos,
                            onProductTap: (code, name) =>
                                _openProductByCode(code, fallbackName: name),
                            onAddGift: _addGiftPromotionLine,
                            hasStockResolver: (code) {
                              for (final p in prov.products) {
                                if (p.code == code) return p.hasStock;
                              }
                              for (final promo in promos) {
                                if (promo.code == code) {
                                  return promo.hasStock;
                                }
                              }
                              return null;
                            },
                            qtyInOrderResolver: (code) {
                              for (final line in prov.lines) {
                                if (line.codigoArticulo == code) {
                                  return line.cantidadEnvases > 0
                                      ? line.cantidadEnvases
                                      : line.cantidadUnidades;
                                }
                              }
                              return 0;
                            },
                          ),
                        ),
                      );
                    },
                  ),
                  Positioned(
                    right: 6,
                    top: 6,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(
                        color: AppTheme.neonPurple,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        '$uniquePromoCodes',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
          // Save draft button & Auto-save status
          Consumer(
            builder: (ctx, ref, _) {
              final prov = ref.watch(pedidosProvider);
              if (!prov.hasLines) return const SizedBox.shrink();
              return Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (prov.lastAutoSaved != null)
                    Padding(
                      padding: const EdgeInsets.only(right: 4),
                      child: Text(
                        prov.isDirty
                            ? 'Borrador modificado...'
                            : '\u{1F4BE} ${prov.lastAutoSaved!.hour.toString().padLeft(2, '0')}:${prov.lastAutoSaved!.minute.toString().padLeft(2, '0')}',
                        style: TextStyle(
                          color:
                              prov.isDirty ? Colors.orange : AppTheme.neonGreen,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  IconButton(
                    icon:
                        const Icon(Icons.save_outlined, color: Colors.white70),
                    tooltip: 'Guardar como borrador manual',
                    onPressed: () async {
                      await prov.saveDraft(
                        widget.employeeCode,
                      );
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Borrador manual guardado'),
                            backgroundColor: AppTheme.neonBlue,
                            duration: Duration(seconds: 2),
                          ),
                        );
                      }
                    },
                  ),
                ],
              );
            },
          ),
          // Drafts list button
          Consumer(
            builder: (ctx, ref, _) {
              final prov = ref.watch(pedidosProvider);
              final count = prov.draftCount;
              return Stack(
                children: [
                  IconButton(
                    icon: const Icon(Icons.drafts_outlined,
                        color: Colors.white70),
                    tooltip: 'Borradores guardados',
                    onPressed: () => _showDraftsDialog(prov),
                  ),
                  if (count > 0)
                    Positioned(
                      right: 6,
                      top: 6,
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(
                          color: AppTheme.neonPurple,
                          shape: BoxShape.circle,
                        ),
                        child: Text(
                          '$count',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorSize: TabBarIndicatorSize.tab,
          indicator: BoxDecoration(
            color: AppTheme.neonBlue.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            border: Border.all(
              color: AppTheme.neonBlue.withValues(alpha: 0.30),
            ),
          ),
          labelColor: Colors.white,
          unselectedLabelColor: AppTheme.textSecondary,
          labelStyle: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
          unselectedLabelStyle: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
          dividerColor: Colors.transparent,
          tabs: const [
            Tab(
              height: 40,
              text: 'Nuevo Pedido',
              icon: Icon(Icons.add_circle_outline),
            ),
            Tab(height: 40, text: 'Mis Pedidos', icon: Icon(Icons.list_alt)),
            Tab(height: 40, text: 'Evolución', icon: Icon(Icons.show_chart)),
            Tab(
                height: 40,
                text: 'Devoluciones',
                icon: Icon(Icons.assignment_return_outlined)),
          ],
        ),
      ),
      body: DecoratedBox(
        decoration: AppTheme.appBackground(),
        child: Column(
          children: [
            // "Ver como" vendor selector for JEFE_VENTAS — visible on BOTH tabs
            if (widget.isJefeVentas || widget.forceShowVendorSelector)
              GlobalVendorSelector(
                isJefeVentas: true,
                forceShow: widget.forceShowVendorSelector,
              ),
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  _buildNuevoPedidoTab(),
                  _buildMisPedidosTab(),
                  _buildEvolucionTab(),
                  _buildDevolucionesTab(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── TAB 1: Nuevo Pedido ──

  Widget _buildNuevoPedidoTab() {
    final hasClient = ref.watch(pedidosProvider.select((p) => p.hasClient));
    final isPhone = Responsive.isSmall(context);

    if (isPhone) {
      return _buildPhoneLayout(hasClient);
    }
    return _buildTabletLayout();
  }

  Widget _buildTabletLayout() {
    final provider = ref.watch(pedidosProvider);
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          // Left: catalog
          Expanded(
            flex: 3,
            child: Container(
              clipBehavior: Clip.antiAlias,
              decoration: AppTheme.premiumPanel(
                accentColor: provider.hasClient
                    ? AppTheme.neonBlue
                    : AppTheme.mutedPanel,
              ),
              child: _buildCatalogPanel(),
            ),
          ),
          const SizedBox(width: 14),
          // Right: order summary
          Expanded(
            flex: 2,
            child: Container(
              clipBehavior: Clip.antiAlias,
              decoration: AppTheme.premiumPanel(
                accentColor: provider.hasLines
                    ? AppTheme.neonGreen
                    : AppTheme.accentAmber,
              ),
              child: OrderSummaryWidget(
                vendedorCode: _activeOrderVendedorCode,
                onOrderConfirmed: _handleOrderConfirmed,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPhoneLayout(bool hasClient) {
    final lineCount = ref.watch(pedidosProvider.select((p) => p.lines.length));
    final cartTotal = ref.watch(
      pedidosProvider.select(
        (p) => p.globalDiscountPct > 0 ? p.totalConDescuento : p.totalImporte,
      ),
    );
    final cartLabel = ref.watch(
      pedidosProvider.select((p) => p.cartDisplayQtyLabel),
    );

    return Stack(
      children: [
        _buildCatalogPanel(),
        if (hasClient)
          Positioned(
            bottom: 16,
            right: 16,
            left: lineCount > 0 ? null : 16,
            child: _buildCartActionButton(
              expanded: lineCount == 0,
              lineCount: lineCount,
              cartLabel: cartLabel,
              cartTotal: cartTotal,
            ),
          ),
      ],
    );
  }

  Widget _buildCartActionButton({
    required bool expanded,
    required int lineCount,
    required String cartLabel,
    required double cartTotal,
  }) {
    final priceText = Text(
      PedidosFormatters.money(cartTotal),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(
        color: AppTheme.darkBase,
        fontWeight: FontWeight.bold,
      ),
    );

    return Material(
      color: AppTheme.neonBlue,
      elevation: 6,
      shadowColor: AppTheme.neonBlue.withValues(alpha: 0.28),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: _showCartSheet,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 56, minWidth: 88),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              mainAxisSize: expanded ? MainAxisSize.max : MainAxisSize.min,
              mainAxisAlignment:
                  expanded ? MainAxisAlignment.center : MainAxisAlignment.start,
              children: [
                _buildCartActionIcon(lineCount, cartLabel),
                const SizedBox(width: 10),
                if (expanded) Flexible(child: priceText) else priceText,
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCartActionIcon(int lineCount, String cartLabel) {
    final hasLines = lineCount > 0;
    return SizedBox(
      width: hasLines ? 42 : 30,
      height: 34,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Align(
            alignment: hasLines ? Alignment.centerLeft : Alignment.center,
            child: Icon(
              hasLines ? Icons.shopping_cart_outlined : Icons.receipt_outlined,
              color: AppTheme.darkBase,
              size: 24,
            ),
          ),
          if (hasLines)
            Positioned(
              top: 0,
              right: 0,
              child: Container(
                constraints: const BoxConstraints(
                  minWidth: 18,
                  minHeight: 18,
                  maxWidth: 52,
                ),
                padding: const EdgeInsets.symmetric(horizontal: 4),
                decoration: BoxDecoration(
                  color: AppTheme.darkBase,
                  border: Border.all(
                    color: AppTheme.neonBlue,
                    width: 1.5,
                  ),
                  borderRadius: BorderRadius.circular(9),
                ),
                alignment: Alignment.center,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    cartLabel,
                    maxLines: 1,
                    style: const TextStyle(
                      color: AppTheme.neonBlue,
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                      height: 1,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  void _showCartSheet() {
    final provider = ref.read(pedidosProvider);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, scrollCtrl) => OrderSummaryWidget(
          vendedorCode: _activeOrderVendedorCode,
          scrollController: scrollCtrl,
          onOrderConfirmed: _handleOrderConfirmed,
        ),
      ),
    );
  }

  Widget _buildCatalogPanel() {
    final provider = ref.watch(pedidosProvider);
    if (!provider.hasClient) {
      return Column(
        children: [
          _buildOrderHeader(provider),
          const Expanded(
            child: Center(
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.lock_person_outlined,
                      color: Colors.white38,
                      size: 56,
                    ),
                    SizedBox(height: 12),
                    Text(
                      'Selecciona un cliente para cargar catalogo, tarifas y promociones.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    SizedBox(height: 6),
                    Text(
                      'Sin cliente no se permite anadir articulos.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white38, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      );
    }

    return Column(
      children: [
        // Client & sale type header
        _buildOrderHeader(provider),
        // Search + filters
        ProductSearchWidget(
          vendedorCodes: _vendedorCodes,
        ),
        // Promotions banner - commented per user request
        // PromotionsBanner(
        //   promotions: provider.activePromotionsList,
        //   onProductTap: (code, name) =>
        //       _openProductByCode(code, fallbackName: name),
        // ),
        // Recommendations
        if (provider.hasClient &&
            (provider.clientHistory.isNotEmpty ||
                provider.similarClients.isNotEmpty))
          RecommendationsSection(
            onProductTap: (Recommendation reco) {
              _openProductByCode(
                reco.code,
                fallbackName: reco.name,
                suggestedEnvases: reco.suggestedUnits,
                fallbackStockEnvases: reco.stockEnvases,
                fallbackStockUnidades: reco.stockUnidades,
                fallbackUnitsPerBox: reco.unitsPerBox,
                fallbackUnitsFraction: reco.unitsFraction,
                fallbackPrecioTarifa1: reco.precioTarifa1,
                fallbackPrecioMinimo: reco.precioMinimo,
                fallbackPrecioCliente: reco.precioCliente,
                fallbackUnitMeasure: reco.unitMeasure,
              );
            },
          ),
        // Complementary products (based on cart contents)
        if (provider.hasLines && provider.complementaryProducts.isNotEmpty)
          ComplementaryProducts(
            products: provider.complementaryProducts,
            onAdd: (code, name) {
              _openProductByCode(code, fallbackName: name);
            },
          ),
        // Product list
        Expanded(
          child: _buildProductList(provider),
        ),
      ],
    );
  }

  Widget _buildOrderHeader(PedidosProvider provider) {
    final padding = Responsive.contentPadding(context);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: padding.left,
        vertical: 8,
      ),
      color: AppTheme.darkSurface,
      child: Row(
        children: [
          // Client selector
          Expanded(
            child: InkWell(
              onTap: () async {
                final prov = ref.read(pedidosProvider);
                if (prov.lines.isNotEmpty) {
                  final confirm = await showDialog<bool>(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: const Text('Cambiar cliente'),
                      content: const Text(
                        'El carrito tiene productos. ¿Desea cambiar de cliente y vaciar el carrito?',
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(ctx, false),
                          child: const Text('Cancelar'),
                        ),
                        TextButton(
                          onPressed: () => Navigator.pop(ctx, true),
                          child: const Text('Cambiar'),
                        ),
                      ],
                    ),
                  );
                  if (confirm != true) return;
                }
                if (!mounted) return;
                final result = await ClientSearchDialog.show(
                  context,
                  vendedorCodes: _vendedorCodes,
                );
                if (result != null && mounted) {
                  prov.setClient(
                    result['code']!,
                    result['name']!,
                    clearCart: prov.lines.isNotEmpty,
                  );
                  _devolucionesFuture = null;
                  _devolucionesFutureKey = null;
                  unawaited(
                    prov.loadProducts(
                      vendedorCodes: _vendedorCodes,
                      search: prov.productSearch,
                      reset: true,
                      forceRefresh: true,
                    ),
                  );
                  // Load recommendations + balance for the selected client
                  unawaited(
                    prov.loadRecommendations(
                      clientCode: result['code']!,
                      vendedorCode: widget.employeeCode,
                    ),
                  );
                  unawaited(prov.loadClientBalance(result['code']!));
                  unawaited(prov.loadPromotions());
                }
              },
              borderRadius: BorderRadius.circular(12),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: provider.hasClient
                        ? AppTheme.neonBlue
                        : AppTheme.borderColor,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.person_outline,
                          color: provider.hasClient
                              ? AppTheme.neonBlue
                              : Colors.white54,
                          size: 18,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            provider.hasClient
                                ? '${provider.clientName} (${provider.clientCode})'
                                : 'Seleccionar cliente...',
                            style: TextStyle(
                              color: provider.hasClient
                                  ? Colors.white
                                  : Colors.white54,
                              fontSize: Responsive.fontSize(
                                context,
                                small: 13,
                                large: 14,
                              ),
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const Icon(
                          Icons.chevron_right,
                          color: Colors.white38,
                          size: 18,
                        ),
                      ],
                    ),
                    // Client balance badge
                    if (provider.hasClient && provider.clientBalance.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child:
                            ClientBalanceBadge(balance: provider.clientBalance),
                      ),
                    if (provider.hasClient) ...[
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          _orderInfoChip(
                            Icons.format_list_numbered,
                            '${provider.lines.length} líneas',
                            AppTheme.neonBlue,
                          ),
                          _orderInfoChip(
                            Icons.euro,
                            PedidosFormatters.money(
                              provider.globalDiscountPct > 0
                                  ? provider.totalConDescuento
                                  : provider.totalImporte,
                            ),
                            AppTheme.neonGreen,
                          ),
                          if (provider.globalDiscountPct > 0)
                            _orderInfoChip(
                              Icons.percent,
                              'Dto. ${provider.globalDiscountPct.toStringAsFixed(1)}%',
                              AppTheme.warning,
                            ),
                          _orderInfoChip(
                            Icons.edit_note,
                            provider.hasLines
                                ? 'Borrador activo'
                                : 'Sin líneas',
                            provider.hasLines
                                ? const Color(0xFFF97316)
                                : Colors.white38,
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          // Sale type selector
          SaleTypeSelector(
            value: provider.saleType,
            onChanged: (type) => provider.setSaleType(type),
          ),
        ],
      ),
    );
  }

  Widget _orderInfoChip(IconData icon, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 12),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProductList(PedidosProvider provider) {
    if (provider.isLoadingProducts && provider.products.isEmpty) {
      return _buildLoadingSkeleton();
    }

    if (provider.error != null && provider.products.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
            const SizedBox(height: 12),
            Text(
              'Error al cargar productos',
              style: TextStyle(
                color: Colors.white,
                fontSize: Responsive.fontSize(context, small: 14, large: 16),
              ),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: () => provider.loadProducts(
                vendedorCodes: _vendedorCodes,
                reset: true,
              ),
              icon: const Icon(Icons.refresh, color: AppTheme.neonBlue),
              label: const Text(
                'Reintentar',
                style: TextStyle(color: AppTheme.neonBlue),
              ),
            ),
          ],
        ),
      );
    }

    if (provider.products.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.inventory_2_outlined,
                color: Colors.white38, size: 48),
            const SizedBox(height: 12),
            Text(
              'No se encontraron productos',
              style: TextStyle(
                color: Colors.white54,
                fontSize: Responsive.fontSize(context, small: 14, large: 16),
              ),
            ),
          ],
        ),
      );
    }

    // Sort: purchased grouped first, new products at end
    // Default mode: purchased ASC (least bought first) → new alphabetical
    // Search mode: purchased DESC (most spent first) → new alphabetical
    final isSearching =
        provider.productSearch != null && provider.productSearch!.isNotEmpty;

    final purchased = <Product>[];
    final nuevos = <Product>[];
    for (final p in provider.products) {
      if (p.hasPurchased) {
        purchased.add(p);
      } else {
        nuevos.add(p);
      }
    }

    if (isSearching) {
      purchased.sort((a, b) {
        final aSales = a.salesThisYear + a.salesPrevYear;
        final bSales = b.salesThisYear + b.salesPrevYear;
        final salesCmp = bSales.compareTo(aSales); // DESC: más gastado primero
        if (salesCmp != 0) return salesCmp;
        final aFav = provider.isFavorite(a.code) ? 1 : 0;
        final bFav = provider.isFavorite(b.code) ? 1 : 0;
        if (aFav != bFav) return bFav.compareTo(aFav);
        return a.name.compareTo(b.name);
      });
    } else {
      purchased.sort((a, b) {
        final aSales = a.salesThisYear + a.salesPrevYear;
        final bSales = b.salesThisYear + b.salesPrevYear;
        final salesCmp =
            aSales.compareTo(bSales); // ASC: menos comprado primero
        if (salesCmp != 0) return salesCmp;
        final aFav = provider.isFavorite(a.code) ? 1 : 0;
        final bFav = provider.isFavorite(b.code) ? 1 : 0;
        if (aFav != bFav) return bFav.compareTo(aFav);
        return a.name.compareTo(b.name);
      });
    }
    nuevos.sort((a, b) {
      final aFav = provider.isFavorite(a.code) ? 1 : 0;
      final bFav = provider.isFavorite(b.code) ? 1 : 0;
      if (aFav != bFav) return bFav.compareTo(aFav);
      return a.name.compareTo(b.name);
    });

    final showSeparator = purchased.isNotEmpty && nuevos.isNotEmpty;
    final displayList = <Object>[];
    displayList.addAll(purchased);
    if (showSeparator) displayList.add('__SEPARATOR__');
    displayList.addAll(nuevos);

    final lineByProductCode = <String, OrderLine>{};
    for (final line in provider.lines) {
      lineByProductCode.putIfAbsent(line.codigoArticulo, () => line);
    }

    return ListView.builder(
      controller: _catalogScrollController,
      padding: Responsive.contentPadding(context),
      itemCount: displayList.length + (provider.hasMoreProducts ? 1 : 0),
      itemBuilder: (ctx, i) {
        if (i >= displayList.length) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(
              child: CircularProgressIndicator(color: AppTheme.neonBlue),
            ),
          );
        }
        final item = displayList[i];
        if (item is String) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppTheme.success,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  'Ya comprados',
                  style: TextStyle(
                    color: Colors.white54,
                    fontSize:
                        Responsive.fontSize(context, small: 11, large: 12),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                Text(
                  'Nuevos',
                  style: TextStyle(
                    color: AppTheme.error,
                    fontSize:
                        Responsive.fontSize(context, small: 11, large: 12),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 6),
                Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppTheme.error,
                  ),
                ),
              ],
            ),
          );
        }
        final product = item as Product;
        final lineInCart = lineByProductCode[product.code];
        final cartQty = lineInCart == null
            ? 0.0
            : (lineInCart.cantidadEnvases > 0
                ? lineInCart.cantidadEnvases
                : lineInCart.cantidadUnidades);
        final cartQtySuffix = lineInCart == null
            ? 'c'
            : Product.unitLabel(lineInCart.unidadMedida);
        return ProductCard(
          product: product,
          onTap: () => _onProductTap(product),
          isFavorite: provider.isFavorite(product.code),
          promo: provider.getPromo(product.code),
          extraPromoCount: provider.getPromoCount(product.code) > 1
              ? provider.getPromoCount(product.code) - 1
              : 0,
          cartQty: cartQty,
          cartQtySuffix: cartQtySuffix,
          isMarginVisible: provider.isMarginVisible,
          onQuickAdd: () async {
            unawaited(HapticFeedback.lightImpact());
            final messenger = ScaffoldMessenger.of(context);
            messenger.hideCurrentSnackBar();

            if (!product.hasStock) {
              await showStockAlternativesSheet(
                context: context,
                outOfStockProduct: product,
                provider: provider,
              );
              return;
            }

            // Simple product (only CAJAS, not dual) – quick add 1 caja
            // Multi-unit or dual product – open UnitSelectorModal
            final initialUnit = lineInCart?.unidadMedida ??
                provider.lastUnitForProduct(product.code) ??
                product.availableUnits.first;
            final result = await UnitSelectorModal.show(
              context,
              product: product,
              initialUnit: product.availableUnits.contains(initialUnit)
                  ? initialUnit
                  : product.availableUnits.first,
              initialQuantity: 1,
              qtyAlreadyInCart: cartQty,
            );
            if (!mounted) return;
            if (result == null || result['cleared'] == true) return;
            final unit = result['unit'] as String;
            final qty = (result['quantity'] as double?) ?? 0;
            if (qty <= 0) return;

            double envases = 0;
            double unidades = 0;
            if (unit == 'CAJAS') {
              envases = qty;
              unidades =
                  qty * (product.unitsPerBox > 0 ? product.unitsPerBox : 1);
            } else if (unit == 'KILOGRAMOS' || unit == 'LITROS') {
              unidades = qty;
            } else {
              unidades = qty;
            }
            final price = product.priceForUnit(unit);
            final err = provider.addLine(
              product,
              envases,
              unidades,
              unit,
              price,
              allowPartial: true,
            );
            if (err != null) {
              if (err.startsWith('PARCIAL:')) {
                final parts = err.substring(8).split('|');
                final missingQty = double.tryParse(parts[0]) ?? 0;
                final productName = parts.length > 1 ? parts[1] : product.name;
                unawaited(provider.loadComplementaryProducts());
                messenger.showSnackBar(
                  SnackBar(
                    content: Text(
                      'Se ha anadido el stock disponible. Faltan ${_formatQtyForMessage(missingQty)} de $productName',
                    ),
                    backgroundColor: AppTheme.warning,
                    duration: const Duration(seconds: 3),
                  ),
                );
                await showStockAlternativesSheet(
                  context: context,
                  outOfStockProduct: product,
                  provider: provider,
                  remainingQty: missingQty,
                );
              } else if (err.contains('Stock insuficiente')) {
                await showStockAlternativesSheet(
                  context: context,
                  outOfStockProduct: product,
                  provider: provider,
                );
              } else {
                messenger.showSnackBar(
                  SnackBar(
                    content: Text(
                      err,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    backgroundColor: AppTheme.error,
                    duration: const Duration(seconds: 2),
                  ),
                );
              }
            } else {
              unawaited(provider.loadComplementaryProducts());
              final unitLabel = Product.unitLabel(unit);
              final isWeight = unit == 'KILOGRAMOS' || unit == 'LITROS';
              final fmtQty = isWeight
                  ? (qty == qty.truncateToDouble()
                      ? qty.toStringAsFixed(0)
                      : qty
                          .toStringAsFixed(2)
                          .replaceAll(RegExp(r'0+$'), '')
                          .replaceAll(RegExp(r'\.$'), ''))
                  : qty.toStringAsFixed(0);
              messenger.showSnackBar(
                SnackBar(
                  content: Text('+$fmtQty $unitLabel de ${product.name}'),
                  backgroundColor: AppTheme.neonGreen,
                  duration: const Duration(seconds: 1),
                ),
              );
            }
          },
          onToggleFavorite: () {
            HapticFeedback.selectionClick();
            provider.toggleFavorite(product.code);
          },
        );
      },
    );
  }

  Widget _buildLoadingSkeleton() {
    return ListView.builder(
      padding: Responsive.contentPadding(context),
      itemCount: 8,
      itemBuilder: (_, __) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Container(
          height: 80,
          decoration: BoxDecoration(
            color: AppTheme.darkCard.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }

  Widget _buildOrderSortModeSelector() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Row(
        children: [
          const Icon(Icons.sort, size: 16, color: AppTheme.textSecondary),
          const SizedBox(width: 8),
          const Text(
            'Ordenar:',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              height: 32,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                color: AppTheme.surfaceColor,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _orderSortMode,
                  isExpanded: true,
                  icon: const Icon(
                    Icons.arrow_drop_down,
                    size: 16,
                    color: AppTheme.textSecondary,
                  ),
                  dropdownColor: AppTheme.surfaceColor,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textPrimary,
                  ),
                  items: _orderSortModeLabels.entries
                      .map(
                        (e) => DropdownMenuItem(
                          value: e.key,
                          child: Text(
                            e.value,
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) {
                      _onOrderSortModeChanged(value);
                    }
                  },
                ),
              ),
            ),
          ),
          if (_isLoadingRuteroData) ...[
            const SizedBox(width: 8),
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppTheme.neonBlue,
              ),
            ),
          ],
        ],
      ),
    );
  }

  // == TAB 3: Evolución (historial de compras del cliente) ==

  Widget _buildEvolucionTab() {
    final provider = ref.watch(pedidosProvider);
    final clientCode =
        (provider.hasClient ? provider.clientCode : widget.initialClientCode)
            ?.trim();
    final clientName = provider.hasClient
        ? (provider.clientName ?? 'Cliente')
        : (widget.initialClientName ?? 'Cliente');

    if (clientCode == null || clientCode.isEmpty) {
      return _buildEvolutionNoClientState();
    }

    return EnhancedClientMatrixPage(
      key: ValueKey('client_purchase_history_$clientCode'),
      clientCode: clientCode,
      clientName: clientName,
      isJefeVentas: widget.isJefeVentas,
    );
  }

  Widget _buildEvolutionNoClientState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.person_search_outlined,
              size: 64,
              color: Colors.white.withValues(alpha: 0.28),
            ),
            const SizedBox(height: 16),
            Text(
              'Selecciona un cliente',
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.86),
                fontSize: 20,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'La evolución muestra el historial de compras general del cliente.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.56),
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // == TAB 4: Devoluciones ==

  Widget _buildDevolucionesTab() {
    final provider = ref.watch(pedidosProvider);
    if (!provider.hasClient) {
      return _buildClientRequiredState(
        title: 'Selecciona un cliente',
        message: 'Las devoluciones se consultan por cliente comercial.',
        icon: Icons.assignment_return_outlined,
      );
    }

    final clientCode = provider.clientCode!.trim();
    final vendorCodes = _vendedorCodes;

    return FutureBuilder<Map<String, dynamic>>(
      future: _getDevolucionesData(clientCode, vendorCodes),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(
            child: CircularProgressIndicator(color: AppTheme.neonBlue),
          );
        }

        if (snapshot.hasError) {
          return _buildDevolucionesError(
            snapshot.error.toString(),
            clientCode,
            vendorCodes,
          );
        }

        final data = snapshot.data ?? const <String, dynamic>{};
        final returns = ((data['returns'] as List?) ?? const <dynamic>[])
            .whereType<Map>()
            .map(Map<String, dynamic>.from)
            .toList();

        return RefreshIndicator(
          color: AppTheme.neonBlue,
          backgroundColor: AppTheme.darkSurface,
          onRefresh: () => _refreshDevolucionesData(clientCode, vendorCodes),
          child: returns.isEmpty
              ? ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(24),
                  children: [
                    const SizedBox(height: 80),
                    Icon(
                      Icons.assignment_return_outlined,
                      size: 72,
                      color: Colors.white.withValues(alpha: 0.25),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Sin devoluciones recientes',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'No constan devoluciones para este cliente en los '
                      'ultimos tres anos.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.56),
                        fontSize: 13,
                      ),
                    ),
                  ],
                )
              : ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
                  children: [
                    _buildDevolucionesSummary(returns),
                    const SizedBox(height: 12),
                    ...returns.map(_buildDevolucionCard),
                  ],
                ),
        );
      },
    );
  }

  Widget _buildClientRequiredState({
    required String title,
    required String message,
    required IconData icon,
  }) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 64, color: Colors.white.withValues(alpha: 0.28)),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.86),
                fontSize: 20,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.56),
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<Map<String, dynamic>> _getDevolucionesData(
    String clientCode,
    String vendorCodes, {
    bool forceRefresh = false,
  }) {
    final key = '$clientCode|$vendorCodes';
    if (!forceRefresh &&
        _devolucionesFutureKey == key &&
        _devolucionesFuture != null) {
      return _devolucionesFuture!;
    }

    _devolucionesFutureKey = key;
    _devolucionesFuture = ApiClient.get(
      '/pedidos/client-evolution/$clientCode',
      queryParameters: {'vendedorCodes': vendorCodes},
      cacheKey: [
        'pedidos',
        'client-evolution',
        clientCode,
        vendorCodes,
      ].join(':'),
      cacheTTL: const Duration(minutes: 10),
      forceRefresh: forceRefresh,
    );
    return _devolucionesFuture!;
  }

  Future<void> _refreshDevolucionesData(
    String clientCode,
    String vendorCodes,
  ) async {
    setState(() {
      _devolucionesFuture = null;
      _devolucionesFutureKey = null;
    });
    await _getDevolucionesData(
      clientCode,
      vendorCodes,
      forceRefresh: true,
    );
    if (mounted) setState(() {});
  }

  Widget _buildDevolucionesError(
    String error,
    String clientCode,
    String vendorCodes,
  ) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 80),
        const Icon(Icons.error_outline, size: 56, color: AppTheme.error),
        const SizedBox(height: 16),
        const Text(
          'No se pudieron cargar las devoluciones',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          error,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.58),
            fontSize: 12,
          ),
        ),
        const SizedBox(height: 18),
        Center(
          child: ElevatedButton.icon(
            onPressed: () => _refreshDevolucionesData(clientCode, vendorCodes),
            icon: const Icon(Icons.refresh),
            label: const Text('Reintentar'),
          ),
        ),
      ],
    );
  }

  Widget _buildDevolucionesSummary(List<Map<String, dynamic>> returns) {
    final totalAmount = returns.fold<double>(
      0,
      (sum, item) => sum + ((item['amount'] as num?)?.toDouble() ?? 0),
    );
    final totalUnits = returns.fold<double>(
      0,
      (sum, item) => sum + ((item['units'] as num?)?.toDouble() ?? 0),
    );

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.error.withValues(alpha: 0.28)),
      ),
      child: Row(
        children: [
          Expanded(
            child: _buildDevolucionesMetric(
              'Importe',
              PedidosFormatters.money(totalAmount),
              AppTheme.error,
            ),
          ),
          Expanded(
            child: _buildDevolucionesMetric(
              'Unidades',
              PedidosFormatters.number(totalUnits, decimals: 1),
              AppTheme.warning,
            ),
          ),
          Expanded(
            child: _buildDevolucionesMetric(
              'Lineas',
              returns.length.toString(),
              AppTheme.neonBlue,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDevolucionesMetric(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11),
        ),
        const SizedBox(height: 4),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDevolucionCard(Map<String, dynamic> item) {
    final productName =
        (item['productName'] ?? 'Producto sin descripcion').toString().trim();
    final productCode = (item['productCode'] ?? '').toString().trim();
    final units = (item['units'] as num?)?.toDouble() ?? 0;
    final amount = (item['amount'] as num?)?.toDouble() ?? 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.error.withValues(alpha: 0.24)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppTheme.error.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(
              Icons.assignment_return,
              color: AppTheme.error,
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  productName.isEmpty
                      ? 'Producto sin descripcion'
                      : productName,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  [
                    if (productCode.isNotEmpty) 'Cod. $productCode',
                    _formatReturnPeriod(item['year'], item['month']),
                    '${PedidosFormatters.number(units, decimals: 1)} uds',
                  ].join(' · '),
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Text(
            PedidosFormatters.money(amount),
            style: const TextStyle(
              color: AppTheme.error,
              fontWeight: FontWeight.w800,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  String _formatReturnPeriod(dynamic year, dynamic month) {
    final y = year?.toString().trim() ?? '';
    final parsedMonth = int.tryParse(month?.toString() ?? '');
    if (y.isEmpty ||
        parsedMonth == null ||
        parsedMonth < 1 ||
        parsedMonth > 12) {
      return 'Fecha sin confirmar';
    }
    return '${_monthLabel(parsedMonth)} $y';
  }

  String _monthLabel(int month) => const [
        'ene',
        'feb',
        'mar',
        'abr',
        'may',
        'jun',
        'jul',
        'ago',
        'sep',
        'oct',
        'nov',
        'dic',
      ][month - 1];

  // == TAB 2: Mis Pedidos ==

  Widget _buildMisPedidosTab() {
    final provider = ref.watch(pedidosProvider);
    return Column(
      children: [
        MisPedidosYoYBar(vendedorCodes: _vendedorCodes),
        OrderKpiDashboard(vendedorCodes: _vendedorCodes),
        const Divider(color: AppTheme.borderColor, height: 1),
        OrderFiltersBar(
          searchQuery: _orderSearch,
          statusFilter: provider.orderStatusFilter,
          dateFrom: _orderDateFrom,
          dateTo: _orderDateTo,
          minAmount: _orderMinAmount,
          maxAmount: _orderMaxAmount,
          sortBy: _orderSortBy,
          sortOrder: _orderSortOrder,
          onSearchChanged: (v) {
            setState(() => _orderSearch = v);
            _debouncedLoadOrders(provider);
          },
          onStatusChanged: (status) {
            provider.setOrderStatusFilter(status);
            unawaited(_loadOrdersWithFilters(provider));
          },
          onDateFromChanged: (d) => setState(() => _orderDateFrom = d),
          onDateToChanged: (d) => setState(() => _orderDateTo = d),
          onMinAmountChanged: (v) => setState(() => _orderMinAmount = v),
          onMaxAmountChanged: (v) => setState(() => _orderMaxAmount = v),
          onSortByChanged: (v) => setState(() => _orderSortBy = v),
          onSortOrderChanged: (v) => setState(() => _orderSortOrder = v),
          onApplyAdvanced: () => unawaited(_loadOrdersWithFilters(provider)),
          onClearAll: () {
            setState(() {
              _orderSearch = '';
              _orderDateFrom = null;
              _orderDateTo = null;
              _orderMinAmount = null;
              _orderMaxAmount = null;
              _orderSortBy = 'fecha';
              _orderSortOrder = 'DESC';
              _orderSortMode = 'custom';
            });
            provider.setOrderStatusFilter(null);
            unawaited(_loadOrdersWithFilters(provider));
          },
        ),
        // Rutero-style sort mode selector
        _buildOrderSortModeSelector(),
        const Divider(color: AppTheme.borderColor, height: 1),
        Expanded(
          child: RefreshIndicator(
            color: AppTheme.neonBlue,
            backgroundColor: AppTheme.darkSurface,
            onRefresh: () async {
              await Future.wait([
                provider.loadOrderStats(
                  vendedorCodes: _vendedorCodes,
                  forceRefresh: true,
                ),
                _loadOrdersWithFilters(provider, forceRefresh: true),
                _loadRuteroClientData(forceRefresh: true),
              ]);
            },
            child: _buildOrdersList(provider),
          ),
        ),
      ],
    );
  }

  Timer? _debounceTimer;
  void _debouncedLoadOrders(PedidosProvider provider) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 300), () {
      unawaited(_loadOrdersWithFilters(provider));
    });
  }

  Future<void> _loadOrdersWithFilters(
    PedidosProvider provider, {
    bool forceRefresh = false,
  }) {
    return provider.loadOrders(
      vendedorCodes: _vendedorCodes,
      status: provider.orderStatusFilter,
      dateFrom: _formatOrderDate(_orderDateFrom),
      dateTo: _formatOrderDate(_orderDateTo),
      search: _orderSearch.isNotEmpty ? _orderSearch : null,
      minAmount: _orderMinAmount,
      maxAmount: _orderMaxAmount,
      sortBy: _orderSortBy,
      sortOrder: _orderSortOrder,
      forceRefresh: forceRefresh,
    );
  }

  Future<void> _refreshMisPedidos() async {
    final provider = ref.read(pedidosProvider);
    await Future.wait([
      provider.loadOrderStats(
        vendedorCodes: _vendedorCodes,
        forceRefresh: true,
      ),
      _loadOrdersWithFilters(provider, forceRefresh: true),
      _loadRuteroClientData(forceRefresh: true),
    ]);
  }

  String? _formatOrderDate(DateTime? date) {
    if (date == null) return null;
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '${date.year}$month$day';
  }

  String _formatQtyForMessage(double qty) {
    if (qty == qty.truncateToDouble()) return qty.toStringAsFixed(0);
    return qty
        .toStringAsFixed(2)
        .replaceAll(RegExp(r'0+$'), '')
        .replaceAll(RegExp(r'\.$'), '');
  }

  Future<void> _loadRuteroClientData({bool forceRefresh = false}) async {
    if (_isLoadingRuteroData) return;

    final now = DateTime.now();
    final weekdays = [
      'lunes',
      'martes',
      'miercoles',
      'jueves',
      'viernes',
      'sabado',
      'domingo',
    ];
    final dayName = weekdays[now.weekday - 1];
    final week = ((now.day + now.weekday - 2) ~/ 7) + 1;
    final cacheKey = [
      'pedidos',
      'rutero-client-data',
      _vendedorCodes,
      now.year,
      now.month,
      week,
      dayName,
    ].join(':');

    if (!forceRefresh &&
        _ruteroClientDataKey == cacheKey &&
        _ruteroClientData.isNotEmpty) {
      return;
    }

    setState(() => _isLoadingRuteroData = true);
    try {
      final response = await ApiClient.get(
        '${ApiConfig.ruteroDay}/$dayName',
        queryParameters: {
          'vendedorCodes': _vendedorCodes,
          'role': 'comercial',
          'year': now.year,
          'month': now.month,
          'week': week,
        },
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 5),
        forceRefresh: forceRefresh,
      );
      if (mounted) {
        final rawList = response['clients'] ?? <dynamic>[];
        setState(() {
          _ruteroClientDataKey = cacheKey;
          _ruteroClientData = (rawList as List)
              .map((item) => Map<String, dynamic>.from(item as Map))
              .toList();
          _isLoadingRuteroData = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoadingRuteroData = false);
      }
    }
  }

  void _onOrderSortModeChanged(String value) {
    setState(() => _orderSortMode = value);
    if (_ruteroClientData.isEmpty &&
        (value == 'custom' || value == 'sales_desc' || value == 'sales_asc')) {
      unawaited(_loadRuteroClientData());
    }
  }

  Widget _buildOrdersList(PedidosProvider provider) {
    if (provider.isLoadingOrders) {
      return const Center(
        child: CircularProgressIndicator(color: AppTheme.neonBlue),
      );
    }
    if (provider.orders.isEmpty) {
      return OrderEmptyState(
        hasActiveFilters: _orderSearch.isNotEmpty ||
            provider.orderStatusFilter != null ||
            _orderDateFrom != null ||
            _orderDateTo != null ||
            _orderMinAmount != null ||
            _orderMaxAmount != null,
        onClearFilters: () {
          setState(() {
            _orderSearch = '';
            _orderDateFrom = null;
            _orderDateTo = null;
            _orderMinAmount = null;
            _orderMaxAmount = null;
            _orderSortBy = 'fecha';
            _orderSortOrder = 'DESC';
            _orderSortMode = 'custom';
          });
          provider.setOrderStatusFilter(null);
          unawaited(_loadOrdersWithFilters(provider));
        },
      );
    }

    // Apply rutero-style sorting to orders
    var sortedOrders = provider.orders;
    if (_orderSortMode != 'route') {
      // Build a map of client code -> rutero data for fast lookup
      final ruteroMap = <String, Map<String, dynamic>>{};
      for (final client in _ruteroClientData) {
        final code = client['code'] as String?;
        if (code != null) ruteroMap[code] = client;
      }

      sortedOrders = [...provider.orders]..sort((a, b) {
          switch (_orderSortMode) {
            case 'custom':
              final orderA = ruteroMap[a.clienteCode]?['order'] as int? ?? 9999;
              final orderB = ruteroMap[b.clienteCode]?['order'] as int? ?? 9999;
              if (orderA != orderB) return orderA.compareTo(orderB);
              return a.clienteName.compareTo(b.clienteName);
            case 'sales_desc':
              final salesA = (ruteroMap[a.clienteCode]?['status']
                      as Map<String, dynamic>?)?['ytdSales'] as num? ??
                  0;
              final salesB = (ruteroMap[b.clienteCode]?['status']
                      as Map<String, dynamic>?)?['ytdSales'] as num? ??
                  0;
              return (salesB as num).compareTo(salesA as num);
            case 'sales_asc':
              final salesA = (ruteroMap[a.clienteCode]?['status']
                      as Map<String, dynamic>?)?['ytdSales'] as num? ??
                  0;
              final salesB = (ruteroMap[b.clienteCode]?['status']
                      as Map<String, dynamic>?)?['ytdSales'] as num? ??
                  0;
              return (salesA as num).compareTo(salesB as num);
            case 'route':
            default:
              return 0; // Keep API order
          }
        });
    }

    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 16),
      itemCount: sortedOrders.length,
      itemBuilder: (context, index) {
        final order = sortedOrders[index];
        return OrderCard(
          order: order,
          isMarginVisible:
              ref.watch(pedidosProvider.select((p) => p.isMarginVisible)),
          onTap: () => _showOrderDetail(order),
          onDuplicate: () => _duplicateOrder(order),
          onViewAlbaran:
              OrderStatusConfig.canonicalDisplayStatus(order.estado) ==
                      'CONFIRMADO'
                  ? () => _viewAlbaran(order)
                  : null,
          onResend:
              order.estado == 'BORRADOR' ? () => _confirmBorrador(order) : null,
          onDelete:
              order.estado == 'BORRADOR' ? () => _deleteBorrador(order) : null,
        );
      },
    );
  }

  Future<void> _showOrderDetail(OrderSummary order) async {
    final result = await OrderDetailSheet.show(context, orderId: order.id);
    if (result == 'deleted' && mounted) {
      await _loadOrdersWithFilters(
        ref.read(pedidosProvider),
        forceRefresh: true,
      );
    } else if (result != null && result.startsWith('clone:') && mounted) {
      final cloneId = int.tryParse(result.substring(6));
      if (cloneId != null) {
        final prov = ref.read(pedidosProvider);
        await prov.cloneOrderIntoCart(cloneId);
        if (!mounted) return;
        if (prov.error != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(prov.error!),
              backgroundColor: AppTheme.error,
            ),
          );
          return;
        }
        _tabController.animateTo(0);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Pedido #${order.numeroPedidoFormatted} clonado al carrito',
            ),
            backgroundColor: AppTheme.neonBlue,
          ),
        );
      }
    }
  }

  Future<void> _showOrderDetailById(int orderId) async {
    final result = await OrderDetailSheet.show(context, orderId: orderId);
    if (result == 'deleted' && mounted) {
      await _loadOrdersWithFilters(
        ref.read(pedidosProvider),
        forceRefresh: true,
      );
    }
  }

  int? _extractConfirmedOrderId(Map<String, dynamic> result) {
    final direct = result['id'] ?? result['orderId'];
    final header = result['header'];
    final nested = header is Map ? header['id'] : null;
    return int.tryParse('${direct ?? nested ?? ''}');
  }

  String _extractConfirmedOrderNumber(Map<String, dynamic> result) {
    final header = result['header'];
    final nested = header is Map
        ? (header['numeroPedidoFormatted'] ??
            header['systemNumeroPedidoFormatted'] ??
            header['numeroPedido'])
        : null;
    return '${result['numeroPedidoFormatted'] ?? result['systemNumeroPedidoFormatted'] ?? nested ?? result['numeroPedido'] ?? ''}';
  }

  Future<void> _handleOrderConfirmed(Map<String, dynamic> result) async {
    final orderId = _extractConfirmedOrderId(result);
    final orderNumber = _extractConfirmedOrderNumber(result);
    _misPedidosLoaded = true;
    _tabController.animateTo(1);
    await _refreshMisPedidos();
    if (!mounted) return;

    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.check_circle_outline,
                color: AppTheme.neonGreen, size: 22),
            SizedBox(width: 8),
            Text('Pedido confirmado', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Text(
          orderNumber.isEmpty
              ? 'El pedido se ha confirmado y Mis Pedidos se ha actualizado.'
              : 'Pedido #$orderNumber confirmado. Mis Pedidos se ha actualizado.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child:
                const Text('Cerrar', style: TextStyle(color: Colors.white54)),
          ),
          if (orderId != null)
            FilledButton.icon(
              onPressed: () {
                Navigator.pop(ctx);
                unawaited(_showOrderDetailById(orderId));
              },
              icon: const Icon(Icons.receipt_long_outlined, size: 18),
              label: const Text('Ver pedido'),
            ),
        ],
      ),
    );
  }

  Future<void> _duplicateOrder(OrderSummary order) async {
    final prov = ref.read(pedidosProvider);
    await prov.cloneOrderIntoCart(order.id);
    if (!mounted) return;
    // cloneOrderIntoCart captura el error internamente: comprobarlo para no
    // mostrar un mensaje de éxito falso cuando la clonación ha fallado.
    if (prov.error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(prov.error!),
          backgroundColor: AppTheme.error,
        ),
      );
      return;
    }
    _tabController.animateTo(0);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Pedido #${order.numeroPedidoFormatted} duplicado al carrito',
        ),
        backgroundColor: AppTheme.neonBlue,
      ),
    );
  }

  Future<void> _confirmBorrador(OrderSummary order) async {
    final prov = ref.read(pedidosProvider);
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(
              Icons.check_circle_outline,
              color: AppTheme.neonGreen,
              size: 22,
            ),
            SizedBox(width: 8),
            Text('Confirmar borrador', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Text(
          '¿Deseas confirmar el borrador #${order.numeroPedidoFormatted}?',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child:
                const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text(
              'Confirmar',
              style: TextStyle(color: AppTheme.neonGreen),
            ),
          ),
        ],
      ),
    );
    if ((confirm ?? false) && mounted) {
      try {
        await prov.cloneOrderIntoCart(order.id);
        if (!mounted) return;
        if (prov.error != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(prov.error!),
              backgroundColor: AppTheme.error,
            ),
          );
          return;
        }
        _tabController.animateTo(0);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Borrador #${order.numeroPedidoFormatted} cargado en el carrito. Confirma desde el carrito.',
            ),
            backgroundColor: AppTheme.neonBlue,
          ),
        );
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Error: $e'),
              backgroundColor: AppTheme.error,
            ),
          );
        }
      }
    }
  }

  Future<void> _deleteBorrador(OrderSummary order) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: AppTheme.error, size: 22),
            SizedBox(width: 8),
            Text('Eliminar borrador', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Text(
          '¿Seguro que quieres eliminar el borrador #${order.numeroPedidoFormatted}? Esta acción no se puede deshacer.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child:
                const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child:
                const Text('Eliminar', style: TextStyle(color: AppTheme.error)),
          ),
        ],
      ),
    );
    if ((confirm ?? false) && mounted) {
      try {
        await ref.read(pedidosProvider).deleteDraftOrder(order.id);
        await _loadOrdersWithFilters(ref.read(pedidosProvider));
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Borrador eliminado'),
              backgroundColor: AppTheme.error,
            ),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Error: $e'),
              backgroundColor: AppTheme.error,
            ),
          );
        }
      }
    }
  }

  Future<void> _viewAlbaran(OrderSummary order) async {
    await AlbaranInfoDialog.show(context, orderId: order.id);
  }

  String _formatTime(DateTime dt) {
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }
}
