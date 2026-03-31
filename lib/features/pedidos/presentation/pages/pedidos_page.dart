/// Pedidos Page
/// ============
/// Main order entry page with two tabs: Nuevo Pedido (catalog+cart) and Mis Pedidos (history)

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../../../core/providers/auth_provider.dart';
import '../../providers/pedidos_provider.dart';
import '../../data/pedidos_service.dart';
import '../widgets/product_search_widget.dart';
import '../widgets/product_card.dart';
import '../widgets/order_summary_widget.dart';
import '../widgets/sale_type_selector.dart';
import '../widgets/recommendations_section.dart';
import '../widgets/product_history_sheet.dart';
import '../widgets/order_detail_sheet.dart';
import '../widgets/promotions_banner.dart';
import '../widgets/analytics_dashboard.dart';
import '../widgets/client_balance_badge.dart';
import '../widgets/complementary_products.dart';
import '../widgets/order_pdf_generator.dart';
import '../widgets/product_detail_sheet.dart';
import '../widgets/stock_alternatives_sheet.dart';
import '../widgets/tarifa_selector_modal.dart';
import '../widgets/unit_selector_modal.dart';
import '../utils/pedidos_formatters.dart';
import '../dialogs/client_search_dialog.dart';
import '../../data/pedidos_offline_service.dart';
import '../../data/pedidos_favorites_service.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../../../core/widgets/smart_product_image.dart';
import 'promotions_list_page.dart';

class PedidosPage extends StatefulWidget {
  final String employeeCode;
  final bool isJefeVentas;

  const PedidosPage({
    Key? key,
    required this.employeeCode,
    required this.isJefeVentas,
  }) : super(key: key);

  @override
  State<PedidosPage> createState() => _PedidosPageState();
}

class _PedidosPageState extends State<PedidosPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final ScrollController _catalogScrollController = ScrollController();
  Timer? _stockRefreshTimer;
  Timer? _autoSaveTimer;

  // Mejora 10 â€” Mis Pedidos search & date filter
  String _orderSearch = '';
  String _orderDateFilter = 'Todo';
  int? _orderFilterYear;
  int? _orderFilterMonth;
  DateTimeRange? _orderCustomRange;

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
        context.read<FilterProvider>().addListener(_onVendorFilterChanged);
      }
      context.read<PedidosProvider>().addListener(_onProviderChange);
    });

    _catalogScrollController.addListener(_onCatalogScroll);

    // Auto-refresh stock every 60 seconds for items in cart
    _stockRefreshTimer = Timer.periodic(
      const Duration(seconds: 60),
      (_) {
        if (mounted) {
          context.read<PedidosProvider>().refreshCartStock();
        }
      },
    );
  }

  void _onProviderChange() {
    if (!mounted) return;
    final prov = context.read<PedidosProvider>();
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
    if (widget.isJefeVentas) {
      try {
        context.read<FilterProvider>().removeListener(_onVendorFilterChanged);
      } catch (_) {}
    }
    try {
      context.read<PedidosProvider>().removeListener(_onProviderChange);
    } catch (_) {}
    super.dispose();
  }

  void _onTabChange() {
    if (_tabController.index == 1 && mounted) {
      // Load analytics when switching to "Mis Pedidos"
      context.read<PedidosProvider>().loadAnalytics(_vendedorCodes);
    }
    if (_tabController.index == 0 && mounted) {
      // Load complementary products when switching back to catalog
      context.read<PedidosProvider>().loadComplementaryProducts();
    }
  }

  Future<void> _initFavorites() async {
    try {
      await PedidosFavoritesService.init();
      if (mounted) {
        final favs = PedidosFavoritesService.getFavorites();
        context.read<PedidosProvider>().initFavorites(favs);
      }
    } catch (e) {
      debugPrint('[PedidosPage] Favorites init error: $e');
    }
  }

  String get _vendedorCodes {
    final auth = context.read<AuthProvider>();
    String codes = auth.vendedorCodes.join(',');
    // JEFE_VENTAS: respect global "Ver como" filter
    if (widget.isJefeVentas) {
      final filter = context.read<FilterProvider>();
      final selected = filter.selectedVendor;
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
      final provider = context.read<PedidosProvider>();
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
    final provider = context.read<PedidosProvider>();
    final codes = _vendedorCodes;
    if (provider.hasClient) {
      provider.loadProducts(vendedorCodes: codes, reset: true, forceRefresh: true);
    }
    provider.loadFilters();
    provider.loadOrders(vendedorCodes: codes);
    provider.loadPromotions();
  }

  void _onCatalogScroll() {
    if (_catalogScrollController.position.pixels >=
        _catalogScrollController.position.maxScrollExtent - 200) {
      final provider = context.read<PedidosProvider>();
      if (!provider.hasClient) return;
      provider.loadMoreProducts(_vendedorCodes);
    }
  }

  void _onProductTap(Product product) {
    final provider = context.read<PedidosProvider>();
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

  Future<void> _openProductByCode(String code,
      {String fallbackName = ''}) async {
    final productCode = code.trim();
    if (productCode.isEmpty) return;

    final provider = context.read<PedidosProvider>();
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
          clientCode: provider.hasClient ? provider.clientCode : null,
        );
        product = detail.product;
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'No se pudo cargar el artículo ${fallbackName.isNotEmpty ? fallbackName : productCode}',
              ),
              backgroundColor: AppTheme.error,
            ),
          );
        }
        return;
      }
    }

    if (mounted && product != null) {
      _onProductTap(product);
    }
  }

  Future<String?> _addGiftPromotionLine(
      String code, String fallbackName, double qty) async {
    if (qty <= 0) return null;
    final provider = context.read<PedidosProvider>();
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

    final idx =
        provider.lines.lastIndexWhere((line) => line.codigoArticulo == productCode);
    if (idx >= 0) {
      provider.updateLineClaseLinea(idx, 'SC');
    }
    return null;
  }

  void _showAddToOrderDialog(Product product) {
    final prov0 = context.read<PedidosProvider>();
    OrderLine? existingLine;
    for (final line in prov0.lines) {
      if (line.codigoArticulo == product.code) {
        existingLine = line;
        break;
      }
    }
    final rememberedUnit = prov0.lastUnitForProduct(product.code);
    String selectedUnit = existingLine?.unidadMedida ??
        rememberedUnit ??
        (product.availableUnits.contains('CAJAS')
            ? 'CAJAS'
            : product.availableUnits.first);
    if (!product.availableUnits.contains(selectedUnit)) {
      selectedUnit = product.availableUnits.contains('CAJAS')
          ? 'CAJAS'
          : product.availableUnits.first;
    }
    final isDual = product.isDualFieldProduct;
    if (isDual)
      selectedUnit = 'CAJAS'; // Dual products always lock to CAJAS price

    final initQty = existingLine != null
        ? (existingLine.cantidadEnvases > 0
            ? existingLine.cantidadEnvases
            : existingLine.cantidadUnidades)
        : prov0.lastQtyForProduct(product.code);

    final initCajas = existingLine?.cantidadEnvases ?? (isDual ? initQty : 0.0);
    final initUds = existingLine?.cantidadUnidades ??
        (isDual ? initQty * product.unitsPerBox : 0.0);

    double? selectedTariffUnitPrice = prov0.lastPriceForProduct(product.code);
    if (selectedTariffUnitPrice == null && existingLine != null) {
      selectedTariffUnitPrice =
          selectedUnit == 'CAJAS' && product.unitsPerBox > 0
              ? existingLine.precioVenta / product.unitsPerBox
              : existingLine.precioVenta;
    }

    double unitPriceForSelection(String unit) {
      if (selectedTariffUnitPrice != null && selectedTariffUnitPrice! > 0) {
        if (unit == 'CAJAS') {
          return selectedTariffUnitPrice! *
              (product.unitsPerBox > 0 ? product.unitsPerBox : 1);
        }
        return selectedTariffUnitPrice!;
      }
      return product.priceForUnit(unit);
    }

    final initialPrice = existingLine?.precioVenta ?? unitPriceForSelection(selectedUnit);

    final qtyController = TextEditingController(
      text: _formatQtyForInput(initQty, selectedUnit),
    );
    final cajasController = TextEditingController(
      text: initCajas > 0 ? _formatQtyForInput(initCajas, 'CAJAS') : '',
    );
    final unidadesController = TextEditingController(
      text: initUds > 0 ? _formatQtyForInput(initUds, 'UNIDADES') : '',
    );
    final priceController =
        TextEditingController(text: _formatPriceForInput(initialPrice));
    List<TariffEntry> tariffs = [];
    List<StockEntry> stockByWarehouse = [];
    int clientTarifaCode = 1;
    bool showWarehouseStock = false;
    bool loadingTariffs = true;

    InputDecoration _qtyFieldDeco(Color color) {
      return InputDecoration(
        filled: true,
        fillColor: color.withOpacity(0.1),
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: color)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: color)),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: color, width: 2)),
      );
    }

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            // Load tariffs on first build
            if (loadingTariffs) {
              loadingTariffs = false;
              final prov = context.read<PedidosProvider>();
              PedidosService.getProductDetail(
                product.code,
                clientCode: prov.hasClient ? prov.clientCode : null,
              ).then((detail) {
                if (ctx.mounted) {
                  setModalState(() {
                    tariffs = detail.tariffs;
                    stockByWarehouse = detail.stockByWarehouse;
                    clientTarifaCode = detail.codigoTarifaCliente;
                    if (detail.clientPrice > 0) {
                      priceController.text =
                          _formatPriceForInput(detail.clientPrice);
                    }
                  });
                }
              }).catchError((_) {});
            }

            final qty = isDual
                ? _parseInputNumber(cajasController.text)
                : _parseInputNumber(qtyController.text);
            final uds =
                isDual ? _parseInputNumber(unidadesController.text) : 0.0;
            final price = _parseInputNumber(priceController.text);
            final total = isDual ? (qty * price) : (qty * price);

            return Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 16,
                bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // â”€â”€ Handle â”€â”€
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        margin: const EdgeInsets.only(bottom: 12),
                        decoration: BoxDecoration(
                          color: Colors.white24,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    // â”€â”€ Mejora 4: Product image â”€â”€
                    Center(
                      child: GestureDetector(
                        onTap: () => _showFullscreenImage(
                            context, product.code, product.name),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: SmartProductImage(
                            imageUrl:
                                '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(product.code.trim())}/image',
                            productCode: product.code,
                            productName: product.name,
                            headers: ApiClient.authHeaders,
                            height: 80,
                            fit: BoxFit.contain,
                            showCodeOnFallback: false,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    // â”€â”€ Header: name + code + stock â”€â”€
                    Text(
                      product.name,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize:
                            Responsive.fontSize(context, small: 15, large: 17),
                        fontWeight: FontWeight.bold,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Text(
                          product.code,
                          style: TextStyle(
                            color: AppTheme.neonBlue,
                            fontSize: Responsive.fontSize(context,
                                small: 11, large: 13),
                          ),
                        ),
                        const Spacer(),
                        Icon(Icons.inventory_outlined,
                            color: product.hasStock
                                ? AppTheme.neonGreen
                                : AppTheme.error,
                            size: 14),
                        const SizedBox(width: 4),
                        Flexible(
                          child: GestureDetector(
                            onTap: () => setModalState(
                                () => showWarehouseStock = !showWarehouseStock),
                            child: Row(
                              children: [
                                Text(
                                  _buildStockText(product),
                                  style: TextStyle(
                                    color: product.hasStock
                                        ? AppTheme.neonGreen
                                        : AppTheme.error,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w500,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                if (stockByWarehouse.isNotEmpty)
                                  Icon(
                                    showWarehouseStock
                                        ? Icons.expand_less
                                        : Icons.expand_more,
                                    color: Colors.white38,
                                    size: 16,
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (showWarehouseStock && stockByWarehouse.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(
                            top: 4, left: 2, right: 2, bottom: 4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: stockByWarehouse
                              .map((s) => Row(
                                    children: [
                                      Icon(Icons.warehouse,
                                          color: AppTheme.neonBlue, size: 13),
                                      const SizedBox(width: 4),
                                      Expanded(
                                        child: Text(
                                          s.almacenName.isNotEmpty
                                              ? s.almacenName
                                              : 'Almacen ${s.almacenCode}',
                                          style: const TextStyle(
                                              color: Colors.white70,
                                              fontSize: 11),
                                        ),
                                      ),
                                      Text(
                                        _buildWarehouseStockText(product, s),
                                        style: const TextStyle(
                                            color: Colors.white54,
                                            fontSize: 11),
                                      ),
                                    ],
                                  ))
                              .toList(),
                        ),
                      ),
                    // â”€â”€ Quick links row â”€â”€
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        // Product detail button
                        _buildQuickLink(
                          icon: Icons.info_outline,
                          label: 'Datos producto',
                          color: AppTheme.neonBlue,
                          onTap: () {
                            final prov = context.read<PedidosProvider>();
                            ProductDetailSheet.show(
                              context,
                              productCode: product.code,
                              productName: product.name,
                              clientCode:
                                  prov.hasClient ? prov.clientCode : null,
                              clientName:
                                  prov.hasClient ? prov.clientName : null,
                            );
                          },
                        ),
                        const SizedBox(width: 8),
                        // History button
                        if (context.read<PedidosProvider>().hasClient)
                          _buildQuickLink(
                            icon: Icons.bar_chart_rounded,
                            label: 'Historial compras',
                            color: AppTheme.neonPurple,
                            onTap: () {
                              final prov = context.read<PedidosProvider>();
                              ProductHistorySheet.show(
                                context,
                                productCode: product.code,
                                productName: product.name,
                                clientCode: prov.clientCode!,
                                clientName: prov.clientName ?? '',
                              );
                            },
                          ),
                      ],
                    ),
                    // ── Precio button (opens TarifaSelectorModal) ──
                    if (tariffs.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        height: 40,
                        child: ElevatedButton.icon(
                          onPressed: () async {
                            final prov = context.read<PedidosProvider>();
                            final selected = await TarifaSelectorModal.show(
                              ctx,
                              product: product,
                              tariffs: tariffs,
                              codigoTarifaCliente: clientTarifaCode,
                              initialPrice: selectedTariffUnitPrice,
                            );
                            if (selected != null) {
                              setModalState(() {
                                selectedTariffUnitPrice = selected;
                                priceController.text =
                                    _formatPriceForInput(unitPriceForSelection(selectedUnit));
                                selectedUnit = product.availableUnits
                                    .contains(selectedUnit)
                                    ? selectedUnit
                                    : product.availableUnits.first;
                              });
                              prov.setLastPriceForProduct(
                                  product.code, unitPriceForSelection(selectedUnit));
                            }
                          },
                          icon: const Icon(Icons.euro_rounded, size: 16),
                          label: const Text('Precio',
                              style: TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 13)),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.warning,
                            foregroundColor: AppTheme.darkBase,
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10)),
                            elevation: 0,
                          ),
                        ),
                      ),
                    ],
                    // â”€â”€ Tariff chips â”€â”€
                    if (tariffs.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text('Tarifas',
                          style: TextStyle(
                            color: Colors.white70,
                            fontSize: Responsive.fontSize(context,
                                small: 11, large: 13),
                          )),
                      const SizedBox(height: 6),
                      SizedBox(
                        height: 36,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: tariffs.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 6),
                          itemBuilder: (_, i) {
                            final t = tariffs[i];
                            final tariffUnitPrice = t.precioUnitario > 0
                                ? t.precioUnitario
                                : (product.unitsPerBox > 0
                                    ? t.price / product.unitsPerBox
                                    : t.price);
                            final isSelected =
                                (_parseInputNumber(priceController.text) -
                                            (selectedUnit == 'CAJAS'
                                                ? tariffUnitPrice * (product.unitsPerBox > 0 ? product.unitsPerBox : 1)
                                                : tariffUnitPrice))
                                        .abs() <
                                    0.0005;
                            return GestureDetector(
                              onTap: () {
                                setModalState(() {
                                  selectedTariffUnitPrice = tariffUnitPrice;
                                  priceController.text =
                                      _formatPriceForInput(unitPriceForSelection(selectedUnit));
                                });
                              },
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(
                                  color: isSelected
                                      ? AppTheme.neonGreen.withOpacity(0.2)
                                      : AppTheme.darkCard,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                    color: isSelected
                                        ? AppTheme.neonGreen
                                        : AppTheme.borderColor,
                                  ),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      t.description.isNotEmpty
                                          ? t.description
                                          : 'T${t.code}',
                                      style: TextStyle(
                                        color: isSelected
                                            ? AppTheme.neonGreen
                                            : Colors.white54,
                                        fontSize: 11,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      PedidosFormatters.money(t.price,
                                          decimals: 3),
                                      style: TextStyle(
                                        color: isSelected
                                            ? AppTheme.neonGreen
                                            : Colors.white,
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                    ],
                    // â”€â”€ Quantity Input area â”€â”€
                    if (isDual) ...[
                      // DUAL FIELD (Cajas + Unidades)
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Cajas',
                                    style: TextStyle(
                                        color: Colors.white70,
                                        fontSize: Responsive.fontSize(context,
                                            small: 11, large: 13))),
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    _buildQtyButton(
                                        Icons.remove, AppTheme.error, () {
                                      final cur = _parseInputNumber(
                                          cajasController.text);
                                      if (cur >= 1) {
                                        final newC = cur - 1;
                                        setModalState(() {
                                          cajasController.text =
                                              _formatQtyForInput(newC, 'CAJAS');
                                          unidadesController.text =
                                              _formatQtyForInput(
                                                  newC * product.unitsPerBox,
                                                  'UNIDADES');
                                        });
                                      }
                                    }),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: TextField(
                                        controller: cajasController,
                                        keyboardType: const TextInputType
                                            .numberWithOptions(decimal: true),
                                        textAlign: TextAlign.center,
                                        style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 18,
                                            fontWeight: FontWeight.bold),
                                        onChanged: (val) {
                                          final cur = _parseInputNumber(val);
                                          unidadesController.text =
                                              _formatQtyForInput(
                                                  cur * product.unitsPerBox,
                                                  'UNIDADES');
                                          setModalState(() {});
                                        },
                                        decoration:
                                            _qtyFieldDeco(AppTheme.neonGreen),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    _buildQtyButton(
                                        Icons.add, AppTheme.neonBlue, () {
                                      final cur = _parseInputNumber(
                                          cajasController.text);
                                      final newC = cur + 1;
                                      setModalState(() {
                                        cajasController.text =
                                            _formatQtyForInput(newC, 'CAJAS');
                                        unidadesController.text =
                                            _formatQtyForInput(
                                                newC * product.unitsPerBox,
                                                'UNIDADES');
                                      });
                                    }),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                    'Unidades (${product.unitsPerBox.toStringAsFixed(0)} U/C)',
                                    style: TextStyle(
                                        color: Colors.white70,
                                        fontSize: Responsive.fontSize(context,
                                            small: 11, large: 13))),
                                const SizedBox(height: 6),
                                TextField(
                                  controller: unidadesController,
                                  keyboardType:
                                      const TextInputType.numberWithOptions(
                                          decimal: true),
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 18,
                                      fontWeight: FontWeight.bold),
                                  onChanged: (val) {
                                    final cur = _parseInputNumber(val);
                                    cajasController.text = _formatQtyForInput(
                                        cur / product.unitsPerBox, 'CAJAS');
                                    setModalState(() {});
                                  },
                                  decoration: _qtyFieldDeco(AppTheme.neonBlue),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                    ] else ...[
                      // SINGLE FIELD WITH UNIT SELECTOR (Weight products & simple boxes)
                      if (product.availableUnits.length > 1) ...[
                        const SizedBox(height: 14),
                        Text('Unidad de medida',
                            style: TextStyle(
                              color: Colors.white70,
                              fontSize: Responsive.fontSize(context,
                                  small: 11, large: 13),
                            )),
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: product.availableUnits.map((unit) {
                            final selected = selectedUnit == unit;
                            final unitPrice = unitPriceForSelection(unit);
                            final unitStock = product.stockForUnit(unit);
                            final stockLabel = Product.unitLabel(unit);
                            return SizedBox(
                              width: (MediaQuery.of(ctx).size.width - 56) / 3,
                              height: 56,
                              child: ElevatedButton(
                                onPressed: () {
                                  setModalState(() {
                                    selectedUnit = unit;
                                    priceController.text =
                                        _formatPriceForInput(unitPriceForSelection(unit));
                                    final currentQty =
                                        _parseInputNumber(qtyController.text);
                                    qtyController.text = _formatQtyForInput(
                                        currentQty, selectedUnit);
                                  });
                                },
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: selected
                                      ? AppTheme.neonBlue.withOpacity(0.2)
                                      : AppTheme.darkCard,
                                  foregroundColor: selected
                                      ? AppTheme.neonBlue
                                      : Colors.white70,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    side: BorderSide(
                                      color: selected
                                          ? AppTheme.neonBlue
                                          : AppTheme.borderColor,
                                      width: selected ? 1.5 : 1,
                                    ),
                                  ),
                                  elevation: 0,
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 2),
                                ),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text(unit,
                                        style: TextStyle(
                                          fontSize: Responsive.fontSize(context,
                                              small: 10, large: 11),
                                          fontWeight: selected
                                              ? FontWeight.bold
                                              : FontWeight.normal,
                                        )),
                                    Text(
                                      PedidosFormatters.money(unitPrice,
                                          decimals: 3),
                                      style: TextStyle(
                                        fontSize: 9,
                                        color: selected
                                            ? AppTheme.neonGreen
                                            : Colors.white38,
                                      ),
                                    ),
                                    Text(
                                      '${_formatUnitQty(unitStock, unit)} $stockLabel',
                                      style: TextStyle(
                                        fontSize: 8,
                                        color: unitStock > 0
                                            ? Colors.white30
                                            : AppTheme.error.withOpacity(0.6),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                        const SizedBox(height: 8),
                      ],
                      Builder(
                        builder: (_) {
                          final selectedUnitPrice =
                              unitPriceForSelection(selectedUnit);
                          final selectedStock =
                              product.stockForUnit(selectedUnit);
                          final selectedLabel = Product.unitLabel(selectedUnit);
                          final qtyPerBox =
                              product.quantityPerBoxForUnit(selectedUnit);
                          final boxPrice = unitPriceForSelection('CAJAS');

                          return Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 8),
                            decoration: BoxDecoration(
                              color: AppTheme.darkCard,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                  color: AppTheme.borderColor.withOpacity(0.6)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Precio unitario: ${PedidosFormatters.money(selectedUnitPrice, decimals: 3)} / $selectedLabel',
                                  style: const TextStyle(
                                    color: Colors.white70,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  selectedUnit == 'CAJAS'
                                      ? 'Precio por caja: ${PedidosFormatters.money(boxPrice, decimals: 3)}'
                                      : '1 caja = ${_formatUnitQty(qtyPerBox, selectedUnit)} $selectedLabel · Precio caja: ${PedidosFormatters.money(boxPrice, decimals: 3)}',
                                  style: const TextStyle(
                                    color: Colors.white54,
                                    fontSize: 10,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'Stock disponible: ${_formatUnitQty(selectedStock, selectedUnit)} $selectedLabel',
                                  style: TextStyle(
                                    color: selectedStock > 0
                                        ? AppTheme.neonGreen
                                        : AppTheme.error,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                      const SizedBox(height: 14),
                      Text(
                        'Cantidad (${Product.unitLabel(selectedUnit)})',
                        style: TextStyle(
                          color: Colors.white70,
                          fontSize: Responsive.fontSize(context,
                              small: 11, large: 13),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          _buildQtyButton(Icons.remove, AppTheme.error, () {
                            final cur = _parseInputNumber(qtyController.text);
                            if (cur > 1) {
                              setModalState(() => qtyController.text =
                                  _formatQtyForInput(cur - 1, selectedUnit));
                            }
                          }),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextField(
                              controller: qtyController,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                      decimal: true),
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold),
                              onChanged: (_) => setModalState(() {}),
                              decoration: _qtyFieldDeco(AppTheme.neonGreen),
                            ),
                          ),
                          const SizedBox(width: 10),
                          _buildQtyButton(Icons.add, AppTheme.neonBlue, () {
                            final cur = _parseInputNumber(qtyController.text);
                            setModalState(() => qtyController.text =
                                _formatQtyForInput(cur + 1, selectedUnit));
                          }),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [5, 10, 25].map((v) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            child: OutlinedButton(
                              onPressed: () {
                                final cur =
                                    _parseInputNumber(qtyController.text);
                                setModalState(() => qtyController.text =
                                    _formatQtyForInput(cur + v, selectedUnit));
                              },
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppTheme.neonBlue,
                                side: BorderSide(
                                    color: AppTheme.neonBlue.withOpacity(0.4)),
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(8)),
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 6),
                                minimumSize: Size.zero,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              child: Text('+$v',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13)),
                            ),
                          );
                        }).toList(),
                      ),
                    ],
                    // â”€â”€ Price field â”€â”€
                    const SizedBox(height: 12),
                    TextField(
                      controller: priceController,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(color: Colors.white, fontSize: 16),
                      onChanged: (_) => setModalState(() {}),
                      decoration: InputDecoration(
                        labelText: 'Precio',
                        suffixText: ' \u20AC',
                        suffixStyle: const TextStyle(
                            color: AppTheme.neonGreen, fontSize: 16),
                        labelStyle: const TextStyle(color: Colors.white70),
                        filled: true,
                        fillColor: AppTheme.darkCard,
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12)),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.borderColor),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: AppTheme.neonBlue),
                        ),
                      ),
                    ),
                    // Price warning + total
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        if (product.precioMinimo > 0)
                          Text(
                            'Min: ${PedidosFormatters.money(product.precioMinimo, decimals: 3)}',
                            style: TextStyle(
                              color: price > 0 && price < product.precioMinimo
                                  ? AppTheme.error
                                  : Colors.white38,
                              fontSize: 11,
                            ),
                          ),
                        const Spacer(),
                        Text(
                          'Total: ${PedidosFormatters.money(total)}',
                          style: const TextStyle(
                            color: AppTheme.neonGreen,
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    // â”€â”€ Mejora 6: Margin indicator â”€â”€
                    Builder(builder: (_) {
                      final costo = product.precioMinimo > 0
                          ? product.precioMinimo * 0.7
                          : product.precioTarifa1 * 0.7;
                      final margen =
                          price > 0 ? ((price - costo) / price * 100) : 0.0;
                      final margenColor = margen >= 15
                          ? AppTheme.neonGreen
                          : margen >= 5
                              ? Colors.orange
                              : AppTheme.error;
                      return Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Row(
                          children: [
                            Icon(Icons.trending_up,
                                color: margenColor, size: 14),
                            const SizedBox(width: 4),
                            Text(
                              'Margen est.: ${margen.toStringAsFixed(1)}%',
                              style: TextStyle(
                                color: margenColor,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                    // â”€â”€ Action buttons â”€â”€
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        // LIMPIAR CANTIDAD
                        Expanded(
                          child: SizedBox(
                            height: 46,
                            child: OutlinedButton(
                              onPressed: () {
                                setModalState(() {
                                  qtyController.text = '0';
                                  cajasController.text = '0';
                                  unidadesController.text = '0';
                                });
                              },
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppTheme.error,
                                side: const BorderSide(color: AppTheme.error),
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12)),
                              ),
                              child: const Text('LIMPIAR',
                                  style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        // ACEPTAR
                        Expanded(
                          flex: 2,
                          child: SizedBox(
                            height: 46,
                            child: ElevatedButton.icon(
                              onPressed: () {
                                final inputQty = isDual
                                    ? _parseInputNumber(cajasController.text)
                                    : _parseInputNumber(qtyController.text);
                                final inputUds = isDual
                                    ? _parseInputNumber(unidadesController.text)
                                    : 0.0;
                                final price =
                                    _parseInputNumber(priceController.text);

                                if (inputQty <= 0 && inputUds <= 0) return;

                                final provider =
                                    context.read<PedidosProvider>();

                                double envases = 0.0;
                                double unidades = 0.0;

                                if (isDual) {
                                  envases = inputQty;
                                  unidades = inputUds;
                                } else {
                                  if (selectedUnit == 'CAJAS') {
                                    envases = inputQty;
                                    unidades = inputQty * product.unitsPerBox;
                                  } else if (product.isWeightProduct &&
                                      selectedUnit == 'KILOGRAMOS') {
                                    envases = inputQty;
                                    unidades = inputQty;
                                  } else {
                                    unidades = inputQty;
                                    envases = product.unitsPerBox > 0
                                        ? inputQty / product.unitsPerBox
                                        : 0.0;
                                  }
                                }

                                // Check price warning
                                if (product.precioMinimo > 0 &&
                                    price < product.precioMinimo) {
                                  _showPriceWarning(
                                    context,
                                    price,
                                    product.precioMinimo,
                                  ).then((proceed) {
                                    if (proceed == true) {
                                      final errorFromAdd = provider.addLine(
                                        product,
                                        envases,
                                        unidades,
                                        selectedUnit,
                                        price,
                                      );
                                      if (errorFromAdd != null) {
                                        if (errorFromAdd
                                            .startsWith('PARCIAL:')) {
                                          final parts = errorFromAdd
                                              .substring(8)
                                              .split('|');
                                          final missingQty =
                                              double.tryParse(parts[0]) ?? 0.0;
                                          final pName =
                                              parts.length > 1 ? parts[1] : '';
                                          Navigator.pop(ctx);
                                          ScaffoldMessenger.of(context)
                                              .showSnackBar(
                                            SnackBar(
                                              content: Text(
                                                  'Se ha añadido el stock disponible. Faltan ${missingQty.toStringAsFixed(missingQty.truncateToDouble() == missingQty ? 0 : 2)} de $pName',
                                                  style: const TextStyle(
                                                      fontWeight:
                                                          FontWeight.bold,
                                                      color: Colors.white)),
                                              backgroundColor: AppTheme.warning,
                                              duration:
                                                  const Duration(seconds: 4),
                                            ),
                                          );
                                          showStockAlternativesSheet(
                                            context: context,
                                            outOfStockProduct: product,
                                            provider: provider,
                                            remainingQty: missingQty,
                                          );
                                        } else if (errorFromAdd
                                            .contains('Stock insuficiente')) {
                                          Navigator.pop(ctx);
                                          showStockAlternativesSheet(
                                            context: context,
                                            outOfStockProduct: product,
                                            provider: provider,
                                          );
                                        } else {
                                          ScaffoldMessenger.of(context)
                                              .showSnackBar(
                                            SnackBar(
                                              content: Text(
                                                errorFromAdd,
                                                style: const TextStyle(
                                                  color: Colors.white,
                                                  fontWeight: FontWeight.bold,
                                                ),
                                              ),
                                              backgroundColor: AppTheme.error,
                                              duration:
                                                  const Duration(seconds: 3),
                                            ),
                                          );
                                        }
                                        return;
                                      }
                                      Navigator.pop(ctx);
                                      Future.delayed(
                                          const Duration(milliseconds: 300),
                                          () {
                                        if (mounted) {
                                          context
                                              .read<PedidosProvider>()
                                              .loadComplementaryProducts();
                                        }
                                      });
                                    }
                                  });
                                  return;
                                }

                                HapticFeedback.mediumImpact();
                                final errorFromAdd = provider.addLine(product,
                                    envases, unidades, selectedUnit, price);

                                if (errorFromAdd != null) {
                                  if (errorFromAdd.startsWith('PARCIAL:')) {
                                    final parts =
                                        errorFromAdd.substring(8).split('|');
                                    final missingQty =
                                        double.tryParse(parts[0]) ?? 0.0;
                                    final pName =
                                        parts.length > 1 ? parts[1] : '';
                                    Navigator.pop(ctx);
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: Text(
                                            'Se ha añadido el stock disponible. Faltan ${missingQty.toStringAsFixed(missingQty.truncateToDouble() == missingQty ? 0 : 2)} de $pName',
                                            style: const TextStyle(
                                                fontWeight: FontWeight.bold,
                                                color: Colors.white)),
                                        backgroundColor: AppTheme.warning,
                                        duration: const Duration(seconds: 4),
                                      ),
                                    );
                                    showStockAlternativesSheet(
                                      context: context,
                                      outOfStockProduct: product,
                                      provider: provider,
                                      remainingQty: missingQty,
                                    );
                                  } else if (errorFromAdd
                                      .contains('Stock insuficiente')) {
                                    Navigator.pop(ctx);
                                    showStockAlternativesSheet(
                                      context: context,
                                      outOfStockProduct: product,
                                      provider: provider,
                                    );
                                  } else {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: Text(errorFromAdd,
                                            style: const TextStyle(
                                                color: Colors.white,
                                                fontWeight: FontWeight.bold)),
                                        backgroundColor: AppTheme.error,
                                        duration: const Duration(seconds: 3),
                                      ),
                                    );
                                  }
                                  return;
                                }

                                Navigator.pop(ctx);
                                Future.delayed(
                                    const Duration(milliseconds: 300), () {
                                  if (mounted) {
                                    context
                                        .read<PedidosProvider>()
                                        .loadComplementaryProducts();
                                  }
                                });
                              },
                              icon: const Icon(Icons.add_shopping_cart),
                              label: const Text('Anadir al pedido'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppTheme.neonBlue,
                                foregroundColor: AppTheme.darkBase,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                textStyle: const TextStyle(
                                    fontWeight: FontWeight.bold),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _showFullscreenImage(BuildContext context, String code, String name) {
    final imageUrl = '${ApiConfig.baseUrl}/products/'
        '${Uri.encodeComponent(code.trim())}/image';
    Navigator.of(context).push<void>(
      PageRouteBuilder<void>(
        opaque: false,
        barrierColor: Colors.black87,
        barrierDismissible: true,
        pageBuilder: (ctx, anim, secondAnim) {
          return Scaffold(
            backgroundColor: Colors.black,
            appBar: AppBar(
              backgroundColor: Colors.black,
              elevation: 0,
              title: Text(
                name,
                style: const TextStyle(color: Colors.white70, fontSize: 14),
                overflow: TextOverflow.ellipsis,
              ),
              leading: IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                onPressed: () => Navigator.of(ctx).pop(),
              ),
            ),
            body: Center(
              child: InteractiveViewer(
                minScale: 0.5,
                maxScale: 5.0,
                child: SmartProductImage(
                  imageUrl: imageUrl,
                  productCode: code,
                  productName: name,
                  fit: BoxFit.contain,
                  headers: ApiClient.authHeaders,
                  showCodeOnFallback: true,
                ),
              ),
            ),
          );
        },
        transitionsBuilder: (ctx, anim, secondAnim, child) {
          return FadeTransition(opacity: anim, child: child);
        },
      ),
    );
  }

  Widget _buildQuickLink({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withOpacity(0.3)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 14),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                  color: color, fontSize: 11, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }

  String _buildStockText(Product product) {
    final parts = <String>[];
    final cjStr = '${PedidosFormatters.number(product.stockEnvases)} cj';
    final content = product.boxContentDesc;
    parts.add(content.isNotEmpty ? '$cjStr ($content/cj)' : cjStr);
    for (final unit in product.availableUnits) {
      if (unit == 'CAJAS') continue;
      final stock = product.stockForUnit(unit);
      final label = Product.unitLabel(unit);
      parts.add('${_formatUnitQty(stock, unit)} $label');
    }
    return parts.join(' / ');
  }

  String _buildWarehouseStockText(Product product, StockEntry stock) {
    final parts = <String>[];
    for (final unit in product.availableUnits) {
      if (unit == 'CAJAS') {
        parts.add(
            '${PedidosFormatters.number(stock.envases)} ${Product.unitLabel(unit)}');
        continue;
      }
      final qty = unit == 'KILOGRAMOS'
          ? stock.envases * product.quantityPerBoxForUnit(unit) + stock.unidades
          : stock.envases * product.unitsPerBox + stock.unidades;
      parts.add('${_formatUnitQty(qty, unit)} ${Product.unitLabel(unit)}');
    }
    return parts.join(' / ');
  }

  String _formatPriceForInput(double value) {
    return value.toStringAsFixed(3).replaceAll('.', ',');
  }

  String _formatUnitQty(double value, String unit) {
    if (unit == 'KILOGRAMOS' || unit == 'LITROS') {
      return PedidosFormatters.number(value, decimals: 1);
    }
    return PedidosFormatters.number(value, decimals: 0);
  }

  double _parseInputNumber(String raw) {
    return double.tryParse(raw.replaceAll(',', '.').trim()) ?? 0;
  }

  String _formatQtyForInput(double value, String unit) {
    final useDecimals = unit == 'KILOGRAMOS' || unit == 'LITROS';
    String text;
    if (!useDecimals) {
      if (value == value.truncateToDouble()) {
        text = value.toStringAsFixed(0);
      } else {
        text = value.toStringAsFixed(2);
      }
      return text.replaceAll('.', ',');
    }
    if (value == value.truncateToDouble()) {
      text = value.toStringAsFixed(0);
    } else {
      text = value.toStringAsFixed(2);
    }
    return text.replaceAll('.', ',');
  }

  Widget _buildQtyButton(IconData icon, Color color, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withOpacity(0.4)),
        ),
        child: Icon(icon, color: color, size: 24),
      ),
    );
  }

  Future<bool?> _showPriceWarning(
      BuildContext context, double price, double minPrice) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Icon(Icons.warning_amber_rounded,
                color: AppTheme.warning, size: 24),
            const SizedBox(width: 8),
            const Text('Precio bajo', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Text(
          'El precio (${PedidosFormatters.money(price, decimals: 3)}) es inferior al minimo (${PedidosFormatters.money(minPrice, decimals: 3)})',
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
            child: const Text('Aceptar',
                style: TextStyle(color: AppTheme.warning)),
          ),
        ],
      ),
    );
  }

  void _showDraftsDialog(PedidosProvider provider) {
    final drafts = provider.savedDrafts;
    if (drafts.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No hay borradores guardados',
              style:
                  TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          backgroundColor: AppTheme.darkCard,
        ),
      );
      return;
    }

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Borradores guardados',
              style: TextStyle(
                color: Colors.white,
                fontSize: Responsive.fontSize(context, small: 16, large: 18),
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            ...drafts.take(10).map((draft) {
              final client = draft['clientName'] ?? draft['clientCode'] ?? '';
              final lines = (draft['lines'] as List?)?.length ?? 0;
              final savedAtRaw = (draft['savedAt'] ?? '').toString();
              final savedAtLabel = savedAtRaw.length >= 10
                  ? savedAtRaw.substring(0, 10)
                  : savedAtRaw;
              final key = draft['draftKey'] as String;
              return Card(
                color: AppTheme.darkCard,
                margin: const EdgeInsets.only(bottom: 6),
                child: ListTile(
                  leading: const Icon(Icons.description_outlined,
                      color: AppTheme.neonBlue),
                  title: Text(client.toString(),
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.w600)),
                  subtitle: Text('$lines lineas - $savedAtLabel',
                      style:
                          const TextStyle(color: Colors.white54, fontSize: 12)),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.restore,
                            color: AppTheme.neonGreen, size: 20),
                        onPressed: () {
                          provider.loadDraft(draft);
                          Navigator.pop(ctx);
                          _tabController.animateTo(0);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('Borrador cargado'),
                                backgroundColor: AppTheme.neonGreen),
                          );
                        },
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline,
                            color: AppTheme.error, size: 20),
                        onPressed: () async {
                          await provider.deleteDraft(key);
                          Navigator.pop(ctx);
                        },
                      ),
                    ],
                  ),
                ),
              );
            }),
          ],
        ),
      ),
    );
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
          Consumer<PedidosProvider>(
            builder: (ctx, prov, _) {
              final promos = prov.activePromotionsList;
              if (!prov.hasClient || promos.isEmpty) return const SizedBox.shrink();
              return Stack(
                children: [
                  IconButton(
                    icon: const Icon(Icons.local_offer_outlined,
                        color: AppTheme.neonPurple),
                    tooltip: 'Ver Promociones',
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => PromotionsListPage(
                            promotions: promos,
                            onProductTap: (code, name) =>
                                _openProductByCode(code, fallbackName: name),
                            onAddGift: (code, name, qty) =>
                                _addGiftPromotionLine(code, name, qty),
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
                        '${promos.length}',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
          // Save draft button & Auto-save status
          Consumer<PedidosProvider>(
            builder: (ctx, prov, _) {
              if (!prov.hasLines) return const SizedBox.shrink();
              return Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (prov.lastAutoSaved != null)
                    Padding(
                      padding: const EdgeInsets.only(right: 4.0),
                      child: Text(
                        prov.isDirty
                            ? 'Borrador modificado...'
                            : '💾 ${prov.lastAutoSaved!.hour.toString().padLeft(2, '0')}:${prov.lastAutoSaved!.minute.toString().padLeft(2, '0')}',
                        style: TextStyle(
                            color: prov.isDirty
                                ? Colors.orange
                                : AppTheme.neonGreen,
                            fontSize: 10,
                            fontWeight: FontWeight.w600),
                      ),
                    ),
                  IconButton(
                    icon:
                        const Icon(Icons.save_outlined, color: Colors.white70),
                    tooltip: 'Guardar como borrador manual',
                    onPressed: () async {
                      await prov.saveDraft(widget.employeeCode,
                          isAutoSave: false);
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
          Consumer<PedidosProvider>(
            builder: (ctx, prov, _) {
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
                              fontWeight: FontWeight.bold),
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
                icon: Icon(Icons.add_circle_outline)),
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
    final provider = context.watch<PedidosProvider>();
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
      builder: (_) => Provider<PedidosProvider>.value(
        value: provider,
        child: DraggableScrollableSheet(
          initialChildSize: 0.85,
          minChildSize: 0.5,
          maxChildSize: 0.95,
          expand: false,
          builder: (_, scrollCtrl) => OrderSummaryWidget(
            vendedorCode: widget.employeeCode,
            scrollController: scrollCtrl,
          ),
        ),
      ),
    );
  }

  Widget _buildCatalogPanel(PedidosProvider provider) {
    if (!provider.hasClient) {
      return Column(
        children: [
          _buildOrderHeader(provider),
          Expanded(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: const [
                    Icon(Icons.lock_person_outlined,
                        color: Colors.white38, size: 56),
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
        // Promotions banner
        PromotionsBanner(
          promotions: provider.activePromotionsList,
          onProductTap: (code, name) =>
              _openProductByCode(code, fallbackName: name),
        ),
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
                final result = await ClientSearchDialog.show(
                  context,
                  vendedorCodes: _vendedorCodes,
                );
                if (result != null && mounted) {
                  final prov = context.read<PedidosProvider>();
                  prov.setClient(result['code']!, result['name']!);
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
                              fontSize: Responsive.fontSize(context,
                                  small: 13, large: 14),
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const Icon(Icons.chevron_right,
                            color: Colors.white38, size: 18),
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
            Icon(Icons.error_outline, color: AppTheme.error, size: 48),
            const SizedBox(height: 12),
            Text(
              'Error al cargar productos',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: Responsive.fontSize(context, small: 14, large: 16)),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: () => provider.loadProducts(
                  vendedorCodes: _vendedorCodes, reset: true),
              icon: const Icon(Icons.refresh, color: AppTheme.neonBlue),
              label: const Text('Reintentar',
                  style: TextStyle(color: AppTheme.neonBlue)),
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
            Icon(Icons.inventory_2_outlined, color: Colors.white38, size: 48),
            const SizedBox(height: 12),
            Text(
              'No se encontraron productos',
              style: TextStyle(
                  color: Colors.white54,
                  fontSize: Responsive.fontSize(context, small: 14, large: 16)),
            ),
          ],
        ),
      );
    }

    // Mejora 9 â€” Favoritos primero
    final sortedProducts = [...provider.products]..sort((a, b) {
        final aF = provider.isFavorite(a.code) ? 0 : 1;
        final bF = provider.isFavorite(b.code) ? 0 : 1;
        return aF.compareTo(bF);
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
          onQuickAdd: (lineInCart != null && lineInCart.cantidadEnvases <= 0)
              ? null
              : () async {
                  HapticFeedback.lightImpact();
                  final messenger = ScaffoldMessenger.of(context);
                  messenger.hideCurrentSnackBar();

                  // Simple product (only CAJAS, not dual) — quick add 1 caja
                  if (product.availableUnits.length <= 1 &&
                      !product.isDualFieldProduct) {
                    final err = provider.addLine(
                        product, 1.0, 0.0, 'CAJAS', product.bestPrice);
                    if (err != null) {
                      messenger.showSnackBar(SnackBar(
                          content: Text(err,
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold)),
                          backgroundColor: AppTheme.error,
                          duration: const Duration(seconds: 2)));
                    } else {
                      provider.loadComplementaryProducts();
                      messenger.showSnackBar(SnackBar(
                          content: Text('+1 caja de ${product.name}'),
                          backgroundColor: AppTheme.neonGreen,
                          duration: const Duration(seconds: 1)));
                    }
                    return;
                  }

                  // Multi-unit or dual product — open UnitSelectorModal
                  final result = await UnitSelectorModal.show(
                    context,
                    product: product,
                    initialUnit: product.availableUnits.first,
                    initialQuantity: 1,
                  );
                  if (result == null || result['cleared'] == true) return;
                  final unit = result['unit'] as String;
                  final qty = (result['quantity'] as double?) ?? 0;
                  if (qty <= 0) return;

                  double envases = 0, unidades = 0;
                  if (unit == 'CAJAS') {
                    envases = qty;
                    unidades = qty * product.unitsPerBox;
                  } else if (unit == 'KILOGRAMOS' || unit == 'LITROS') {
                    envases = qty;
                    unidades = qty;
                  } else {
                    unidades = qty;
                    envases =
                        product.unitsPerBox > 0 ? qty / product.unitsPerBox : 0;
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
                      messenger.showSnackBar(SnackBar(
                          content: Text(err,
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold)),
                          backgroundColor: AppTheme.error,
                          duration: const Duration(seconds: 2)));
                    }
                  } else {
                    provider.loadComplementaryProducts();
                    final unitLabel = Product.unitLabel(unit);
                    final fmtQty = qty == qty.truncateToDouble()
                        ? qty.toStringAsFixed(0)
                        : qty.toStringAsFixed(2);
                    messenger.showSnackBar(SnackBar(
                        content: Text('+$fmtQty $unitLabel de ${product.name}'),
                        backgroundColor: AppTheme.neonGreen,
                        duration: const Duration(seconds: 1)));
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

  // â”€â”€ TAB 2: Mis Pedidos â”€â”€

  Widget _buildMisPedidosTab() {
    final provider = context.watch<PedidosProvider>();
    return Column(
      children: [
        _buildOrderStatusFilters(provider),
        // Mejora 10 \u2014 Search and date filter
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          color: AppTheme.darkSurface,
          child: Column(
            children: [
              TextField(
                onChanged: (v) => setState(() => _orderSearch = v),
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: InputDecoration(
                  hintText: 'Buscar pedido, cliente...',
                  hintStyle: const TextStyle(color: Colors.white38),
                  prefixIcon: const Icon(Icons.search,
                      color: AppTheme.neonBlue, size: 18),
                  filled: true,
                  fillColor: AppTheme.darkCard,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 6),
              // Date filter chips
              SizedBox(
                height: 32,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    ...['Todo', 'Hoy', 'Semana', 'Mes'].map((label) {
                      final selected = _orderDateFilter == label &&
                          _orderCustomRange == null;
                      return Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: FilterChip(
                          label: Text(label),
                          selected: selected,
                          selectedColor: AppTheme.neonBlue.withOpacity(0.2),
                          backgroundColor: AppTheme.darkCard,
                          labelStyle: TextStyle(
                            color:
                                selected ? AppTheme.neonBlue : Colors.white70,
                            fontSize: 11,
                          ),
                          side: BorderSide(
                              color: selected
                                  ? AppTheme.neonBlue
                                  : AppTheme.borderColor),
                          materialTapTargetSize:
                              MaterialTapTargetSize.shrinkWrap,
                          visualDensity: VisualDensity.compact,
                          onSelected: (_) => setState(() {
                            _orderDateFilter = label;
                            _orderCustomRange = null;
                            _orderFilterYear = null;
                            _orderFilterMonth = null;
                          }),
                        ),
                      );
                    }),
                    // Custom range chip
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: FilterChip(
                        avatar: const Icon(Icons.date_range,
                            size: 14, color: AppTheme.neonPurple),
                        label: Text(_orderCustomRange != null
                            ? '${_orderCustomRange!.start.day}/${_orderCustomRange!.start.month} - ${_orderCustomRange!.end.day}/${_orderCustomRange!.end.month}'
                            : 'Rango'),
                        selected: _orderCustomRange != null,
                        selectedColor: AppTheme.neonPurple.withOpacity(0.2),
                        backgroundColor: AppTheme.darkCard,
                        labelStyle: TextStyle(
                          color: _orderCustomRange != null
                              ? AppTheme.neonPurple
                              : Colors.white70,
                          fontSize: 11,
                        ),
                        side: BorderSide(
                            color: _orderCustomRange != null
                                ? AppTheme.neonPurple
                                : AppTheme.borderColor),
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        visualDensity: VisualDensity.compact,
                        onSelected: (_) async {
                          final range = await showDateRangePicker(
                            context: context,
                            firstDate: DateTime(2024),
                            lastDate: DateTime.now(),
                            initialDateRange: _orderCustomRange,
                            builder: (ctx, child) {
                              return Theme(
                                data: ThemeData.dark().copyWith(
                                  colorScheme: const ColorScheme.dark(
                                    primary: AppTheme.neonBlue,
                                    surface: AppTheme.darkSurface,
                                  ),
                                ),
                                child: child!,
                              );
                            },
                          );
                          if (range != null) {
                            setState(() {
                              _orderCustomRange = range;
                              _orderDateFilter = 'Rango';
                              _orderFilterYear = null;
                              _orderFilterMonth = null;
                            });
                          }
                        },
                      ),
                    ),
                    // Year selector
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: PopupMenuButton<int>(
                        onSelected: (year) => setState(() {
                          _orderFilterYear = year;
                          _orderDateFilter = 'Ano';
                          _orderCustomRange = null;
                        }),
                        itemBuilder: (_) {
                          final now = DateTime.now().year;
                          return [now, now - 1, now - 2]
                              .map((y) => PopupMenuItem(
                                    value: y,
                                    child: Text('$y'),
                                  ))
                              .toList();
                        },
                        child: Chip(
                          label: Text(
                            _orderFilterYear != null
                                ? '$_orderFilterYear'
                                : 'Año',
                            style: TextStyle(
                              color: _orderFilterYear != null
                                  ? AppTheme.neonGreen
                                  : Colors.white70,
                              fontSize: 11,
                            ),
                          ),
                          side: BorderSide(
                              color: _orderFilterYear != null
                                  ? AppTheme.neonGreen
                                  : AppTheme.borderColor),
                          backgroundColor: _orderFilterYear != null
                              ? AppTheme.neonGreen.withOpacity(0.1)
                              : AppTheme.darkCard,
                          materialTapTargetSize:
                              MaterialTapTargetSize.shrinkWrap,
                          visualDensity: VisualDensity.compact,
                        ),
                      ),
                    ),
                    // Month selector
                    if (_orderFilterYear != null)
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: PopupMenuButton<int>(
                          onSelected: (m) => setState(() {
                            _orderFilterMonth = m;
                            _orderDateFilter = 'Ano';
                            _orderCustomRange = null;
                          }),
                          itemBuilder: (_) {
                            const names = [
                              'Ene',
                              'Feb',
                              'Mar',
                              'Abr',
                              'May',
                              'Jun',
                              'Jul',
                              'Ago',
                              'Sep',
                              'Oct',
                              'Nov',
                              'Dic'
                            ];
                            return List.generate(
                                12,
                                (i) => PopupMenuItem(
                                      value: i + 1,
                                      child: Text(names[i]),
                                    ));
                          },
                          child: Chip(
                            label: Text(
                              _orderFilterMonth != null
                                  ? _monthName(_orderFilterMonth!)
                                  : 'Mes',
                              style: TextStyle(
                                color: _orderFilterMonth != null
                                    ? AppTheme.neonGreen
                                    : Colors.white70,
                                fontSize: 11,
                              ),
                            ),
                            side: BorderSide(
                                color: _orderFilterMonth != null
                                    ? AppTheme.neonGreen
                                    : AppTheme.borderColor),
                            backgroundColor: _orderFilterMonth != null
                                ? AppTheme.neonGreen.withOpacity(0.1)
                                : AppTheme.darkCard,
                            materialTapTargetSize:
                                MaterialTapTargetSize.shrinkWrap,
                            visualDensity: VisualDensity.compact,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: _buildOrdersListWithAnalytics(provider),
        ),
      ],
    );
  }

  List<OrderSummary> _filteredOrders(List<OrderSummary> all) {
    var filtered = all;

    // Text filter
    if (_orderSearch.isNotEmpty) {
      final q = _orderSearch.toLowerCase();
      filtered = filtered
          .where((o) =>
              o.clienteName.toLowerCase().contains(q) ||
              o.clienteCode.toLowerCase().contains(q) ||
              o.numeroPedido.toString().contains(q))
          .toList();
    }

    // Date filter
    if (_orderDateFilter != 'Todo') {
      final now = DateTime.now();
      filtered = filtered.where((o) {
        try {
          final dateStr =
              o.fecha.length >= 10 ? o.fecha.substring(0, 10) : o.fecha;
          final d = DateTime.parse(dateStr);
          if (_orderDateFilter == 'Rango' && _orderCustomRange != null) {
            return !d.isBefore(_orderCustomRange!.start) &&
                !d.isAfter(_orderCustomRange!.end.add(const Duration(days: 1)));
          }
          if (_orderDateFilter == 'Ano') {
            if (_orderFilterYear != null && d.year != _orderFilterYear) {
              return false;
            }
            if (_orderFilterMonth != null && d.month != _orderFilterMonth)
              return false;
            return true;
          }
          final days = now.difference(d).inDays;
          if (_orderDateFilter == 'Hoy') {
            return d.year == now.year &&
                d.month == now.month &&
                d.day == now.day;
          } else if (_orderDateFilter == 'Semana') {
            return days >= 0 && days <= 7;
          } else if (_orderDateFilter == 'Mes') {
            return days >= 0 && days <= 30;
          }
        } catch (_) {
          return false;
        }
        return true;
      }).toList();
    }

    return filtered;
  }

  List<Map<String, dynamic>> _filteredDrafts(List<Map<String, dynamic>> all) {
    var filtered = all;

    if (_orderSearch.isNotEmpty) {
      final q = _orderSearch.toLowerCase();
      filtered = filtered.where((d) {
        final name = (d['clientName'] ?? '').toString().toLowerCase();
        final code = (d['clientCode'] ?? '').toString().toLowerCase();
        final draftKey = (d['draftKey'] ?? '').toString().toLowerCase();
        return name.contains(q) || code.contains(q) || draftKey.contains(q);
      }).toList();
    }

    if (_orderDateFilter != 'Todo') {
      final now = DateTime.now();
      filtered = filtered.where((d) {
        final raw = (d['savedAt'] ?? '').toString();
        final parsed = DateTime.tryParse(raw);
        if (parsed == null) return false;
        final date = DateTime(parsed.year, parsed.month, parsed.day);
        final today = DateTime(now.year, now.month, now.day);
        final days = today.difference(date).inDays;
        if (_orderDateFilter == 'Hoy') {
          return days == 0;
        }
        if (_orderDateFilter == 'Semana') {
          return days >= 0 && days <= 7;
        }
        if (_orderDateFilter == 'Mes') {
          return days >= 0 && days <= 30;
        }
        return true;
      }).toList();
    }

    return filtered;
  }

  Widget _buildOrdersListWithAnalytics(PedidosProvider provider) {
    final displayOrders = _filteredOrders(provider.orders);
    final showDrafts = provider.orderStatusFilter == null ||
        provider.orderStatusFilter == 'BORRADOR';
    final displayDrafts = showDrafts
        ? _filteredDrafts(provider.savedDrafts)
        : <Map<String, dynamic>>[];

    return RefreshIndicator(
      color: AppTheme.neonBlue,
      backgroundColor: AppTheme.darkSurface,
      onRefresh: () async {
        await provider.loadOrders(
          vendedorCodes: _vendedorCodes,
          status: provider.orderStatusFilter,
          forceRefresh: true,
        );
        provider.loadAnalytics(_vendedorCodes);
      },
      child: CustomScrollView(
        slivers: [
          // Analytics dashboard
          SliverToBoxAdapter(
            child: AnalyticsDashboard(
              analytics: provider.analytics,
              isLoading: provider.isLoadingAnalytics,
            ),
          ),
          // Premium Summary KPIs (Mirroring Facturas)
          SliverToBoxAdapter(
            child: _buildSummaryCards(displayOrders),
          ),
          // Divider
          const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Divider(color: AppTheme.borderColor, height: 1),
            ),
          ),
          // Orders list
          if (provider.isLoadingOrders)
            const SliverFillRemaining(
              child: Center(
                  child: CircularProgressIndicator(color: AppTheme.neonBlue)),
            )
          else if (displayOrders.isEmpty && displayDrafts.isEmpty)
            SliverFillRemaining(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.receipt_long_outlined,
                        color: Colors.white38, size: 48),
                    const SizedBox(height: 12),
                    Text('No hay pedidos',
                        style: TextStyle(
                            color: Colors.white54,
                            fontSize: Responsive.fontSize(context,
                                small: 14, large: 16))),
                  ],
                ),
              ),
            )
          else ...[
            if (displayDrafts.isNotEmpty)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                sliver: SliverToBoxAdapter(
                  child: Text(
                    'Borradores locales',
                    style: TextStyle(
                      color: Colors.white70,
                      fontWeight: FontWeight.w700,
                      fontSize:
                          Responsive.fontSize(context, small: 13, large: 15),
                    ),
                  ),
                ),
              ),
            if (displayDrafts.isNotEmpty)
              SliverPadding(
                padding: Responsive.contentPadding(context),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (ctx, i) => _buildDraftCard(provider, displayDrafts[i]),
                    childCount: displayDrafts.length,
                  ),
                ),
              ),
            if (displayOrders.isNotEmpty)
              SliverPadding(
                padding: displayDrafts.isEmpty
                    ? Responsive.contentPadding(context)
                    : const EdgeInsets.fromLTRB(12, 0, 12, 12),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (ctx, i) => _buildOrderCard(displayOrders[i]),
                    childCount: displayOrders.length,
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _buildOrderStatusFilters(PedidosProvider provider) {
    final statuses = ['BORRADOR', 'CONFIRMADO', 'ENVIADO', 'ANULADO'];
    final statusColors = {
      'BORRADOR': Colors.orange,
      'CONFIRMADO': AppTheme.neonBlue,
      'ENVIADO': AppTheme.neonGreen,
      'ANULADO': AppTheme.error,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      color: AppTheme.darkSurface,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            // "Todos" chip
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilterChip(
                label: const Text('Todos'),
                selected: provider.orderStatusFilter == null,
                selectedColor: AppTheme.neonBlue.withOpacity(0.2),
                backgroundColor: AppTheme.darkCard,
                labelStyle: TextStyle(
                  color: provider.orderStatusFilter == null
                      ? AppTheme.neonBlue
                      : Colors.white70,
                  fontSize: Responsive.fontSize(context, small: 12, large: 14),
                ),
                side: BorderSide(
                  color: provider.orderStatusFilter == null
                      ? AppTheme.neonBlue
                      : AppTheme.borderColor,
                ),
                onSelected: (_) {
                  provider.loadOrders(
                    vendedorCodes: _vendedorCodes,
                    forceRefresh: true,
                  );
                },
              ),
            ),
            ...statuses.map((status) {
              final isSelected = provider.orderStatusFilter == status;
              final color = statusColors[status] ?? Colors.white70;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: FilterChip(
                  label: Text(status),
                  selected: isSelected,
                  selectedColor: color.withOpacity(0.2),
                  backgroundColor: AppTheme.darkCard,
                  labelStyle: TextStyle(
                    color: isSelected ? color : Colors.white70,
                    fontSize:
                        Responsive.fontSize(context, small: 12, large: 14),
                  ),
                  side: BorderSide(
                    color: isSelected ? color : AppTheme.borderColor,
                  ),
                  onSelected: (_) {
                    provider.loadOrders(
                      vendedorCodes: _vendedorCodes,
                      status: status,
                      forceRefresh: true,
                    );
                  },
                ),
              );
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildDraftCard(PedidosProvider provider, Map<String, dynamic> draft) {
    final clientName = (draft['clientName'] ?? '').toString();
    final clientCode = (draft['clientCode'] ?? '').toString();
    final lines = (draft['lines'] as List?) ?? const [];
    final draftKey = (draft['draftKey'] ?? '').toString();
    final savedAt = DateTime.tryParse((draft['savedAt'] ?? '').toString());
    final dateLabel = savedAt == null
        ? ''
        : '${savedAt.day.toString().padLeft(2, '0')}/${savedAt.month.toString().padLeft(2, '0')}/${savedAt.year} ${savedAt.hour.toString().padLeft(2, '0')}:${savedAt.minute.toString().padLeft(2, '0')}';

    double total = 0;
    for (final row in lines) {
      if (row is Map) {
        final data = Map<String, dynamic>.from(row);
        final envases = (data['cantidadEnvases'] as num?)?.toDouble() ?? 0;
        final unidades = (data['cantidadUnidades'] as num?)?.toDouble() ?? 0;
        final price = (data['precioVenta'] as num?)?.toDouble() ?? 0;
        total += (envases > 0 ? envases : unidades) * price;
      }
    }

    Future<void> restoreDraft() async {
      provider.loadDraft(draft);
      _tabController.animateTo(0);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Borrador cargado en el carrito'),
            backgroundColor: AppTheme.neonBlue,
          ),
        );
      }
    }

    Future<void> deleteDraft() async {
      final confirm = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: AppTheme.darkSurface,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('Eliminar borrador',
              style: TextStyle(color: Colors.white)),
          content: const Text(
            'Este borrador local se eliminara definitivamente.',
            style: TextStyle(color: Colors.white70),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar',
                  style: TextStyle(color: Colors.white54)),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Eliminar',
                  style: TextStyle(color: AppTheme.error)),
            ),
          ],
        ),
      );

      if (confirm != true || draftKey.isEmpty) return;
      await provider.deleteDraft(draftKey);
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.2),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
        border: Border.all(
          color: Colors.orange.withOpacity(0.2),
        ),
      ),
      child: Stack(
        children: [
          // Color accent bar on the left
          Positioned(
            left: 0,
            top: 20,
            bottom: 20,
            child: Container(
              width: 4,
              decoration: BoxDecoration(
                color: Colors.orange,
                borderRadius: const BorderRadius.only(
                  topRight: Radius.circular(4),
                  bottomRight: Radius.circular(4),
                ),
                boxShadow: [
                  BoxShadow(
                      color: Colors.orange.withOpacity(0.5), blurRadius: 4),
                ],
              ),
            ),
          ),
          Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: restoreDraft,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Icon Box
                        Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: Colors.orange.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: Colors.orange.withOpacity(0.5),
                            ),
                          ),
                          child: const Icon(
                            Icons.edit_note_rounded,
                            color: Colors.orange,
                            size: 26,
                          ),
                        ),
                        const SizedBox(width: 14),

                        // Info
                        Expanded(
                          flex: 4,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                clientName.isNotEmpty ? clientName : clientCode,
                                style: TextStyle(
                                  fontWeight: FontWeight.w900,
                                  fontSize:
                                      Responsive.isSmall(context) ? 16 : 18,
                                  color: const Color(0xFF90CAF9),
                                  letterSpacing: 0.3,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 6),
                              Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: Colors.orange.withOpacity(0.12),
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(
                                          color:
                                              Colors.orange.withOpacity(0.3)),
                                    ),
                                    child: const Text(
                                      'BORRADOR',
                                      style: TextStyle(
                                        color: Colors.orange,
                                        fontWeight: FontWeight.w800,
                                        fontSize: 10,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  if (dateLabel.isNotEmpty)
                                    Text(
                                      dateLabel,
                                      style: const TextStyle(
                                        color: Colors.white54,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(width: 8),

                        // Amount
                        Expanded(
                          flex: 2,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  PedidosFormatters.money(total),
                                  style: TextStyle(
                                    fontWeight: FontWeight.w900,
                                    fontSize:
                                        Responsive.isSmall(context) ? 18 : 20,
                                    color: AppTheme.neonGreen,
                                  ),
                                  textAlign: TextAlign.right,
                                ),
                              ),
                              Text(
                                '${lines.length} líneas',
                                style: const TextStyle(
                                    color: Colors.white38, fontSize: 10),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 16),
                    Divider(height: 1, color: Colors.white.withOpacity(0.05)),
                    const SizedBox(height: 12),

                    // Actions
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        _buildActionButton(
                          icon: Icons.restore,
                          label: 'Cargar',
                          onTap: restoreDraft,
                          isPrimary: false,
                        ),
                        const SizedBox(width: 8),
                        _buildActionButton(
                          icon: Icons.delete_outline,
                          label: 'Eliminar',
                          onTap: deleteDraft,
                          isPrimary: false,
                          colorOverride: AppTheme.error,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOrderCard(OrderSummary order) {
    final statusColors = {
      'BORRADOR': const Color(0xFFF97316),
      'PENDIENTE': const Color(0xFFEAB308),
      'CONFIRMADO': const Color(0xFF3B82F6),
      'ENVIADO': const Color(0xFF22C55E),
      'ANULADO': const Color(0xFFEF4444),
    };
    final color = statusColors[order.estado] ?? const Color(0xFF9CA3AF);
    final marginColor = order.margen >= 15
        ? const Color(0xFF22C55E)
        : order.margen >= 5
            ? const Color(0xFFF97316)
            : const Color(0xFFEF4444);
    final statusLabels = {
      'BORRADOR': 'Borrador',
      'PENDIENTE': 'Pendiente',
      'CONFIRMADO': 'Confirmado',
      'ENVIADO': 'Enviado',
      'ANULADO': 'Anulado',
    };

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1E293B), Color(0xFF0F172A)],
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: color.withOpacity(0.15),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
        border: Border.all(
          color: color.withOpacity(0.25),
          width: 1,
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () async {
              final result =
                  await OrderDetailSheet.show(context, orderId: order.id);
              if (result == 'cancelled' && mounted) {
                context.read<PedidosProvider>().loadOrders(
                      vendedorCodes: _vendedorCodes,
                      forceRefresh: true,
                    );
              } else if (result != null &&
                  result.startsWith('clone:') &&
                  mounted) {
                final cloneId = int.tryParse(result.substring(6));
                if (cloneId != null) {
                  final prov = context.read<PedidosProvider>();
                  await prov.cloneOrderIntoCart(cloneId);
                  _tabController.animateTo(0);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                            'Pedido #${order.numeroPedido} clonado al carrito'),
                        backgroundColor: const Color(0xFF3B82F6),
                      ),
                    );
                  }
                }
              }
            },
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  color.withOpacity(0.2),
                                  color.withOpacity(0.1)
                                ],
                              ),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: color.withOpacity(0.4)),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Container(
                                  width: 8,
                                  height: 8,
                                  decoration: BoxDecoration(
                                    color: color,
                                    shape: BoxShape.circle,
                                    boxShadow: [
                                      BoxShadow(
                                          color: color.withOpacity(0.6),
                                          blurRadius: 4)
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  statusLabels[order.estado] ?? order.estado,
                                  style: TextStyle(
                                    color: color,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const Spacer(),
                          Icon(Icons.calendar_today_outlined,
                              size: 14, color: Colors.white.withOpacity(0.4)),
                          const SizedBox(width: 6),
                          Text(
                            order.fecha.length > 10
                                ? order.fecha.substring(0, 10)
                                : order.fecha,
                            style: TextStyle(
                              color: Colors.white.withOpacity(0.5),
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 52,
                            height: 52,
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [
                                  color.withOpacity(0.2),
                                  color.withOpacity(0.08)
                                ],
                              ),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: color.withOpacity(0.3)),
                            ),
                            child: Icon(
                              Icons.receipt_long_rounded,
                              color: color,
                              size: 28,
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            flex: 4,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  order.clienteName,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 17,
                                    color: Colors.white,
                                    letterSpacing: 0.3,
                                    height: 1.2,
                                  ),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  '#${order.numeroPedido}',
                                  style: TextStyle(
                                    color: color.withOpacity(0.8),
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                PedidosFormatters.money(order.total),
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                  fontSize: 22,
                                  color: Color(0xFF22C55E),
                                  letterSpacing: -0.5,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: marginColor.withOpacity(0.15),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  '${order.margen.toStringAsFixed(1)}%',
                                  style: TextStyle(
                                    color: marginColor,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Container(
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.03),
                    border: Border(
                      top: BorderSide(color: Colors.white.withOpacity(0.08)),
                    ),
                  ),
                  child: Row(
                    children: [
                      _buildPremiumActionBtn(
                        icon: Icons.visibility_outlined,
                        label: 'Ver',
                        onTap: () =>
                            OrderDetailSheet.show(context, orderId: order.id),
                      ),
                      _buildPremiumDivider(),
                      _buildPremiumActionBtn(
                        icon: Icons.copy,
                        label: 'Clonar',
                        onTap: () async {
                          final prov = context.read<PedidosProvider>();
                          await prov.cloneOrderIntoCart(order.id);
                          _tabController.animateTo(0);
                        },
                      ),
                      _buildPremiumDivider(),
                      _buildPremiumActionBtn(
                        icon: Icons.picture_as_pdf_outlined,
                        label: 'PDF',
                        onTap: () async {
                          final detail =
                              await PedidosService.getOrderDetail(order.id);
                          await OrderPdfGenerator.generateAndShare(
                              context, detail);
                        },
                      ),
                      if (order.estado == 'BORRADOR' ||
                          order.estado == 'PENDIENTE') ...[
                        _buildPremiumDivider(),
                        _buildPremiumActionBtn(
                          icon: Icons.hourglass_empty,
                          label: 'Pendiente',
                          onTap: () =>
                              _showPendingApprovalDialog(context, order),
                          color: const Color(0xFFEAB308),
                        ),
                        _buildPremiumDivider(),
                        _buildPremiumActionBtn(
                          icon: Icons.send,
                          label: 'Enviar',
                          onTap: () => _showSendOrderDialog(context, order),
                          color: const Color(0xFF3B82F6),
                          isPrimary: true,
                        ),
                        _buildPremiumDivider(),
                        _buildPremiumActionBtn(
                          icon: Icons.cancel_outlined,
                          label: 'Anular',
                          onTap: () => _showCancelOrderDialog(context, order),
                          color: const Color(0xFFEF4444),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPremiumDivider() =>
      Container(width: 1, height: 44, color: Colors.white.withOpacity(0.1));

  Widget _buildPremiumActionBtn({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    Color? color,
    bool isPrimary = false,
  }) {
    final btnColor = color ?? Colors.white.withOpacity(0.6);
    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 20, color: btnColor),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  color: btnColor,
                  fontSize: 11,
                  fontWeight: isPrimary ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showPendingApprovalDialog(BuildContext context, OrderSummary order) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.hourglass_empty, color: Color(0xFFEAB308)),
            SizedBox(width: 12),
            Text('Marcar Pendiente',
                style: TextStyle(color: Colors.white, fontSize: 18)),
          ],
        ),
        content: Text(
          '¿Marcar el pedido #${order.numeroPedido} como Pendiente de aprobación?',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child:
                const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFEAB308)),
            onPressed: () async {
              Navigator.pop(ctx);
              final prov = context.read<PedidosProvider>();
              await prov.setOrderPendingApproval(order.id);
              prov.loadOrders(
                  vendedorCodes: _vendedorCodes, forceRefresh: true);
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                        'Pedido #${order.numeroPedido} marcado como pendiente'),
                    backgroundColor: const Color(0xFFEAB308),
                  ),
                );
              }
            },
            child: const Text('Confirmar',
                style: TextStyle(
                    color: Color(0xFF1E293B), fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _showSendOrderDialog(BuildContext context, OrderSummary order) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.send, color: Color(0xFF3B82F6)),
            SizedBox(width: 12),
            Text('Enviar Pedido',
                style: TextStyle(color: Colors.white, fontSize: 18)),
          ],
        ),
        content: Text(
          '¿Enviar el pedido #${order.numeroPedido}? Esta acción no se puede deshacer.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child:
                const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF3B82F6)),
            onPressed: () async {
              Navigator.pop(ctx);
              final prov = context.read<PedidosProvider>();
              await prov.sendOrder(order.id);
              prov.loadOrders(
                  vendedorCodes: _vendedorCodes, forceRefresh: true);
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                        'Pedido #${order.numeroPedido} enviado correctamente'),
                    backgroundColor: const Color(0xFF22C55E),
                  ),
                );
              }
            },
            child: const Text('Enviar',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _showCancelOrderDialog(BuildContext context, OrderSummary order) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.cancel_outlined, color: Color(0xFFEF4444)),
            SizedBox(width: 12),
            Text('Anular Pedido',
                style: TextStyle(color: Colors.white, fontSize: 18)),
          ],
        ),
        content: Text(
          '¿Anular el pedido #${order.numeroPedido}? Esta acción no se puede deshacer.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child:
                const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFEF4444)),
            onPressed: () async {
              Navigator.pop(ctx);
              final prov = context.read<PedidosProvider>();
              await PedidosService.updateOrderStatus(order.id, 'ANULADO');
              prov.loadOrders(
                  vendedorCodes: _vendedorCodes, forceRefresh: true);
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Pedido #${order.numeroPedido} anulado'),
                    backgroundColor: const Color(0xFFEF4444),
                  ),
                );
              }
            },
            child: const Text('Anular',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryCards(List<OrderSummary> orders) {
    final totalOrders = orders.length;
    final totalAmount = orders.fold(0.0, (sum, o) => sum + o.total);
    final avgMargin = orders.isEmpty
        ? 0.0
        : orders.fold(0.0, (sum, o) => sum + o.margen) / orders.length;

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final columns = constraints.maxWidth < 400 ? 2 : 3;
          final itemWidth =
              (constraints.maxWidth - (columns - 1) * 8) / columns;
          return Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _buildSummaryItem(
                icon: Icons.receipt_long,
                label: 'Pedidos',
                value: '$totalOrders',
                color: AppTheme.neonBlue,
                width: itemWidth,
              ),
              _buildSummaryItem(
                icon: Icons.euro,
                label: 'Total Periodo',
                value: PedidosFormatters.money(totalAmount),
                color: AppTheme.neonGreen,
                width: itemWidth,
              ),
              _buildSummaryItem(
                icon: Icons.analytics_outlined,
                label: 'Margen Medio',
                value: '${avgMargin.toStringAsFixed(1)}%',
                color: Colors.orange,
                width: itemWidth,
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildSummaryItem({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
    double? width,
  }) {
    return Container(
      width: width,
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF1E2746),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: const TextStyle(
                color: Colors.white54,
                fontSize: 10,
                fontWeight: FontWeight.w600),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w900,
                fontSize: 16,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    required bool isPrimary,
    Color? colorOverride,
  }) {
    final color =
        colorOverride ?? (isPrimary ? AppTheme.neonBlue : Colors.white70);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isPrimary ? color.withOpacity(0.1) : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isPrimary
                ? color.withOpacity(0.4)
                : Colors.white.withOpacity(0.1),
          ),
        ),
        child: Row(
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _monthName(int month) {
    const months = [
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic'
    ];
    return months[month - 1];
  }
}
