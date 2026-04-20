/// Pedidos Page
/// ============
/// Main order entry page with two tabs: Nuevo Pedido (catalog+cart) and Mis Pedidos (history)
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
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
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_kpi_dashboard.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_summary_widget.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/product_card.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/product_search_widget.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/recommendations_section.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/sale_type_selector.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/stock_alternatives_sheet.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/unit_selector_modal.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

class PedidosPage extends ConsumerStatefulWidget {
  const PedidosPage({
    required this.employeeCode,
    required this.isJefeVentas,
    super.key,
  });
  final String employeeCode;
  final bool isJefeVentas;

  @override
  ConsumerState<PedidosPage> createState() => _PedidosPageState();
}

class _PedidosPageState extends ConsumerState<PedidosPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final ScrollController _catalogScrollController = ScrollController();
  Timer? _stockRefreshTimer;
  Timer? _autoSaveTimer;

  // Mejora 10 â€” Mis Pedidos search & date filter
  String _orderSearch = '';
  DateTime? _orderDateFrom;
  DateTime? _orderDateTo;
  double? _orderMinAmount;
  double? _orderMaxAmount;
  String _orderSortBy = 'fecha';
  String _orderSortOrder = 'DESC';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(_onTabChange);

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadInitialData();
      _initOffline();
      _initFavorites();
      // Listen to "Ver como" vendor filter changes
      if (widget.isJefeVentas) {
        ref.listen<String?>(selectedVendorProvider, (previous, next) {
          _onVendorFilterChanged();
        });
      }
      ref.read(pedidosProvider).addListener(_onProviderChange);
    });

    _catalogScrollController.addListener(_onCatalogScroll);

    // Auto-refresh stock every 60 seconds for items in cart
    _stockRefreshTimer = Timer.periodic(
      const Duration(seconds: 60),
      (_) {
        if (mounted) {
          ref.read(pedidosProvider).refreshCartStock();
        }
      },
    );
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
    _stockRefreshTimer?.cancel();
    _autoSaveTimer?.cancel();
    _tabController.dispose();
    _catalogScrollController.dispose();
    try {
      ref.read(pedidosProvider).removeListener(_onProviderChange);
    } catch (_) {}
    super.dispose();
  }

  void _onTabChange() {
    if (_tabController.index == 1 && mounted) {
      ref.read(pedidosProvider).loadOrderStats(vendedorCodes: _vendedorCodes);
      _loadOrdersWithFilters(ref.read(pedidosProvider));
    }
    if (_tabController.index == 0 && mounted) {
      ref.read(pedidosProvider).loadComplementaryProducts();
    }
  }

  Future<void> _initFavorites() async {
    try {
      await PedidosFavoritesService.init();
      if (mounted) {
        final favs = PedidosFavoritesService.getFavorites();
        ref.read(pedidosProvider).initFavorites(favs);
      }
    } catch (e) {
      debugPrint('[PedidosPage] Favorites init error: $e');
    }
  }

  String get _vendedorCodes {
    final vendedorCodes = ProviderScope.containerOf(context)
            .read(authProvider)
            .value
            ?.vendedorCodes ??
        [];
    var codes = vendedorCodes.join(',');
    // JEFE_VENTAS: respect global "Ver como" filter
    if (widget.isJefeVentas) {
      final selected = ref.read(selectedVendorProvider);
      if (selected != null && selected.isNotEmpty) {
        codes = selected;
      }
    }
    return codes;
  }

  void _onVendorFilterChanged() {
    if (!mounted) return;
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
        provider.loadOrders(vendedorCodes: _vendedorCodes, forceRefresh: true);
      }
    } catch (e) {
      debugPrint('[PedidosPage] Offline init error: $e');
    }
  }

  void _loadInitialData() {
    final provider = ref.read(pedidosProvider);
    final codes = _vendedorCodes;
    if (provider.hasClient) {
      provider.loadProducts(
        vendedorCodes: codes,
        reset: true,
        forceRefresh: true,
      );
    }
    provider.loadFilters();
    provider.loadOrders(vendedorCodes: codes);
    provider.loadPromotions();
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

    // Always fetch fresh product detail to ensure correct price for current client
    Product? product;
    try {
      final detail = await PedidosService.getProductDetail(
        productCode,
        clientCode: provider.clientCode,
      );
      product = detail.product;
    } catch (_) {
      // Fallback: try to find in cached catalog
      for (final p in provider.products) {
        if (p.code == productCode) {
          product = p;
          break;
        }
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
      _onProductTap(product);
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

  void _showAddToOrderDialog(Product product) {
    AddToOrderSheet.show(context, ref, product: product);
  }

  void _showDraftsDialog(PedidosProvider provider) {
    DraftsBottomSheet.show(context, ref, provider: provider);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: AppTheme.darkSurface,
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
          indicatorColor: AppTheme.neonBlue,
          labelColor: AppTheme.neonBlue,
          unselectedLabelColor: Colors.white54,
          tabs: const [
            Tab(
              height: 40,
              text: 'Nuevo Pedido',
              icon: Icon(Icons.add_circle_outline),
            ),
            Tab(height: 40, text: 'Mis Pedidos', icon: Icon(Icons.list_alt)),
          ],
        ),
      ),
      body: Column(
        children: [
          // "Ver como" vendor selector for JEFE_VENTAS â€” visible on BOTH tabs
          if (widget.isJefeVentas)
            GlobalVendorSelector(
              isJefeVentas: true,
              onChanged: _onVendorFilterChanged,
            ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildNuevoPedidoTab(),
                _buildMisPedidosTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // â”€â”€ TAB 1: Nuevo Pedido â”€â”€

  Widget _buildNuevoPedidoTab() {
    final provider = ref.watch(pedidosProvider);
    final isPhone = Responsive.isSmall(context);

    if (isPhone) {
      return _buildPhoneLayout(provider);
    }
    return _buildTabletLayout(provider);
  }

  Widget _buildTabletLayout(PedidosProvider provider) {
    return Row(
      children: [
        // Left: catalog
        Expanded(
          flex: 3,
          child: _buildCatalogPanel(provider),
        ),
        // Divider
        Container(
          width: 1,
          color: AppTheme.borderColor.withOpacity(0.3),
        ),
        // Right: order summary
        Expanded(
          flex: 2,
          child: OrderSummaryWidget(
            vendedorCode: widget.employeeCode,
          ),
        ),
      ],
    );
  }

  Widget _buildPhoneLayout(PedidosProvider provider) {
    return Stack(
      children: [
        _buildCatalogPanel(provider),
        // Floating cart button
        if (provider.hasLines)
          Positioned(
            bottom: 16,
            right: 16,
            child: FloatingActionButton.extended(
              heroTag: 'cart_fab',
              onPressed: () => _showCartSheet(provider),
              backgroundColor: AppTheme.neonBlue,
              foregroundColor: AppTheme.darkBase,
              icon: const Icon(Icons.shopping_cart),
              label: Text(
                '${provider.lineCount} | ${PedidosFormatters.money(provider.globalDiscountPct > 0 ? provider.totalConDescuento : provider.totalImporte)}',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ),
      ],
    );
  }

  void _showCartSheet(PedidosProvider provider) {
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
          vendedorCode: widget.employeeCode,
          scrollController: scrollCtrl,
        ),
      ),
    );
  }

  Widget _buildCatalogPanel(PedidosProvider provider) {
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
            onProductTap: (code, name) {
              _openProductByCode(code, fallbackName: name);
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
                  prov.loadProducts(
                    vendedorCodes: _vendedorCodes,
                    search: prov.productSearch,
                    reset: true,
                    forceRefresh: true,
                  );
                  // Load recommendations + balance for the selected client
                  prov.loadRecommendations(
                    clientCode: result['code']!,
                    vendedorCode: widget.employeeCode,
                  );
                  prov.loadClientBalance(result['code']!);
                  prov.loadPromotions();
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

    // Mejora 9 â€” Favoritos primero
    final sortedProducts = [...provider.products]..sort((a, b) {
        final aSales = a.salesThisYear + a.salesPrevYear;
        final bSales = b.salesThisYear + b.salesPrevYear;
        final salesCmp = aSales.compareTo(bSales);
        if (salesCmp != 0) return salesCmp;
        final purchasedCmp =
            (a.hasPurchased ? 1 : 0).compareTo(b.hasPurchased ? 1 : 0);
        if (purchasedCmp != 0) return purchasedCmp;
        final favoriteCmp = (provider.isFavorite(b.code) ? 1 : 0)
            .compareTo(provider.isFavorite(a.code) ? 1 : 0);
        if (favoriteCmp != 0) return favoriteCmp;
        return a.name.compareTo(b.name);
      });

    return ListView.builder(
      controller: _catalogScrollController,
      padding: Responsive.contentPadding(context),
      itemCount: sortedProducts.length + (provider.hasMoreProducts ? 1 : 0),
      itemBuilder: (ctx, i) {
        if (i >= sortedProducts.length) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(
              child: CircularProgressIndicator(color: AppTheme.neonBlue),
            ),
          );
        }
        final product = sortedProducts[i];
        // Mejora 1 â€” cartQty
        OrderLine? lineInCart;
        for (final line in provider.lines) {
          if (line.codigoArticulo == product.code) {
            lineInCart = line;
            break;
          }
        }
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
          cartQty: cartQty,
          cartQtySuffix: cartQtySuffix,
          onQuickAdd: () async {
            HapticFeedback.lightImpact();
            final messenger = ScaffoldMessenger.of(context);
            messenger.hideCurrentSnackBar();

            // Simple product (only CAJAS, not dual) — quick add 1 caja
            // Multi-unit or dual product — open UnitSelectorModal
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
            );
            if (result == null || result['cleared'] == true) return;
            final unit = result['unit'] as String;
            final qty = (result['quantity'] as double?) ?? 0;
            if (qty <= 0) return;

            double envases = 0;
            double unidades = 0;
            if (unit == 'CAJAS') {
              envases = qty;
              unidades =
                  product.isDualFieldProduct ? qty * product.unitsPerBox : 0;
            } else if (unit == 'KILOGRAMOS' || unit == 'LITROS') {
              unidades = qty;
            } else {
              unidades = qty;
            }
            final price = product.priceForUnit(unit);
            final err =
                provider.addLine(product, envases, unidades, unit, price);
            if (err != null) {
              if (err.contains('Stock insuficiente')) {
                showStockAlternativesSheet(
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
              provider.loadComplementaryProducts();
              final unitLabel = Product.unitLabel(unit);
              final fmtQty = qty == qty.truncateToDouble()
                  ? qty.toStringAsFixed(0)
                  : qty.toStringAsFixed(2);
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
            color: AppTheme.darkCard.withOpacity(0.5),
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }

  // ── TAB 2: Mis Pedidos ──

  Widget _buildMisPedidosTab() {
    final provider = ref.watch(pedidosProvider);
    return Column(
      children: [
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
            _loadOrdersWithFilters(provider);
          },
          onDateFromChanged: (d) => setState(() => _orderDateFrom = d),
          onDateToChanged: (d) => setState(() => _orderDateTo = d),
          onMinAmountChanged: (v) => setState(() => _orderMinAmount = v),
          onMaxAmountChanged: (v) => setState(() => _orderMaxAmount = v),
          onSortByChanged: (v) => setState(() => _orderSortBy = v),
          onSortOrderChanged: (v) => setState(() => _orderSortOrder = v),
          onApplyAdvanced: () => _loadOrdersWithFilters(provider),
          onClearAll: () {
            setState(() {
              _orderSearch = '';
              _orderDateFrom = null;
              _orderDateTo = null;
              _orderMinAmount = null;
              _orderMaxAmount = null;
              _orderSortBy = 'fecha';
              _orderSortOrder = 'DESC';
            });
            provider.setOrderStatusFilter(null);
            _loadOrdersWithFilters(provider);
          },
        ),
        const Divider(color: AppTheme.borderColor, height: 1),
        Expanded(
          child: RefreshIndicator(
            color: AppTheme.neonBlue,
            backgroundColor: AppTheme.darkSurface,
            onRefresh: () async {
              await provider.loadOrderStats(
                vendedorCodes: _vendedorCodes,
                forceRefresh: true,
              );
              _loadOrdersWithFilters(provider);
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
      _loadOrdersWithFilters(provider);
    });
  }

  void _loadOrdersWithFilters(PedidosProvider provider) {
    provider.loadOrders(
      vendedorCodes: _vendedorCodes,
      status: provider.orderStatusFilter,
      dateFrom: _orderDateFrom != null
          ? '${_orderDateFrom!.year}${_orderDateFrom!.month.toString().padLeft(2, '0')}${_orderDateFrom!.day.toString().padLeft(2, '0')}'
          : null,
      dateTo: _orderDateTo != null
          ? '${_orderDateTo!.year}${_orderDateTo!.month.toString().padLeft(2, '0')}${_orderDateTo!.day.toString().padLeft(2, '0')}'
          : null,
      search: _orderSearch.isNotEmpty ? _orderSearch : null,
      minAmount: _orderMinAmount,
      maxAmount: _orderMaxAmount,
      sortBy: _orderSortBy,
      sortOrder: _orderSortOrder,
      forceRefresh: true,
    );
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
          });
          provider.setOrderStatusFilter(null);
          _loadOrdersWithFilters(provider);
        },
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 16),
      itemCount: provider.orders.length,
      itemBuilder: (context, index) {
        final order = provider.orders[index];
        return OrderCard(
          order: order,
          onTap: () => _showOrderDetail(order),
          onDuplicate: () => _duplicateOrder(order),
          onCancel: order.estado != 'ANULADO' && order.estado != 'BORRADOR'
              ? () => _cancelOrder(order)
              : null,
          onViewAlbaran:
              (order.estado == 'ENVIADO' || order.estado == 'FACTURADO')
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
    if (result == 'cancelled' && mounted) {
      _loadOrdersWithFilters(ref.read(pedidosProvider));
    } else if (result != null && result.startsWith('clone:') && mounted) {
      final cloneId = int.tryParse(result.substring(6));
      if (cloneId != null) {
        final prov = ref.read(pedidosProvider);
        await prov.cloneOrderIntoCart(cloneId);
        _tabController.animateTo(0);
        if (mounted) {
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
  }

  Future<void> _duplicateOrder(OrderSummary order) async {
    final prov = ref.read(pedidosProvider);
    await prov.cloneOrderIntoCart(order.id);
    _tabController.animateTo(0);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Pedido #${order.numeroPedidoFormatted} duplicado al carrito',
          ),
          backgroundColor: AppTheme.neonBlue,
        ),
      );
    }
  }

  Future<void> _cancelOrder(OrderSummary order) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: AppTheme.error, size: 22),
            SizedBox(width: 8),
            Text('Anular pedido', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Text(
          '¿Seguro que quieres anular el pedido #${order.numeroPedidoFormatted}?',
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
                const Text('Anular', style: TextStyle(color: AppTheme.error)),
          ),
        ],
      ),
    );
    if (confirm ?? false && mounted) {
      await ref.read(pedidosProvider).cancelExistingOrder(order.id);
      _loadOrdersWithFilters(ref.read(pedidosProvider));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Pedido anulado'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
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
    if (confirm ?? false && mounted) {
      try {
        await prov.cloneOrderIntoCart(order.id);
        _tabController.animateTo(0);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Borrador #${order.numeroPedidoFormatted} cargado en el carrito. Confirma desde el carrito.',
              ),
              backgroundColor: AppTheme.neonBlue,
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
    if (confirm ?? false && mounted) {
      try {
        await ref.read(pedidosProvider).cancelExistingOrder(order.id);
        _loadOrdersWithFilters(ref.read(pedidosProvider));
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
    AlbaranInfoDialog.show(context, orderId: order.id);
  }

  String _formatTime(DateTime dt) {
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }
}
