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

  // Mejora 10 â€” Mis Pedidos search & date filter
  String _orderSearch = '';
  String _orderDateFilter = 'Todo';

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

  @override
  void dispose() {
    _stockRefreshTimer?.cancel();
    _tabController.dispose();
    _catalogScrollController.dispose();
    if (widget.isJefeVentas) {
      try {
        context.read<FilterProvider>().removeListener(_onVendorFilterChanged);
      } catch (_) {}
    }
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
    provider.loadProducts(vendedorCodes: codes, reset: true);
    provider.loadFilters();
    provider.loadOrders(vendedorCodes: codes);
    provider.loadPromotions();
  }

  void _onCatalogScroll() {
    if (_catalogScrollController.position.pixels >=
        _catalogScrollController.position.maxScrollExtent - 200) {
      final provider = context.read<PedidosProvider>();
      provider.loadMoreProducts(_vendedorCodes);
    }
  }

  void _onProductTap(Product product) {
    _showAddToOrderDialog(product);
  }

  Future<void> _openProductByCode(String code,
      {String fallbackName = ''}) async {
    final productCode = code.trim();
    if (productCode.isEmpty) return;

    final provider = context.read<PedidosProvider>();
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
    if (isDual) selectedUnit = 'CAJAS'; // Dual products always lock to CAJAS price

    final initQty = existingLine != null
        ? (existingLine.cantidadEnvases > 0
            ? existingLine.cantidadEnvases
            : existingLine.cantidadUnidades)
        : prov0.lastQtyForProduct(product.code);
        
    final initCajas = existingLine?.cantidadEnvases ?? (isDual ? initQty : 0.0);
    final initUds = existingLine?.cantidadUnidades ?? (isDual ? initQty * product.unitsPerBox : 0.0);

    final initialPrice =
        existingLine?.precioVenta ?? product.priceForUnit(selectedUnit);
        
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
    bool showWarehouseStock = false;
    bool loadingTariffs = true;

    InputDecoration _qtyFieldDeco(Color color) {
      return InputDecoration(
        filled: true,
        fillColor: color.withOpacity(0.1),
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: color)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: color)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: color, width: 2)),
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
            final uds = isDual ? _parseInputNumber(unidadesController.text) : 0.0;
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
                            imageUrl: '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(product.code.trim())}/image',
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
                            final isSelected =
                                (_parseInputNumber(priceController.text) -
                                            t.price)
                                        .abs() <
                                    0.0005;
                            return GestureDetector(
                              onTap: () {
                                setModalState(() {
                                  priceController.text =
                                      _formatPriceForInput(t.price);
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
                                    _buildQtyButton(Icons.remove, AppTheme.error, () {
                                      final cur = _parseInputNumber(cajasController.text);
                                      if (cur >= 1) {
                                        final newC = cur - 1;
                                        setModalState(() {
                                          cajasController.text = _formatQtyForInput(newC, 'CAJAS');
                                          unidadesController.text = _formatQtyForInput(newC * product.unitsPerBox, 'UNIDADES');
                                        });
                                      }
                                    }),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: TextField(
                                        controller: cajasController,
                                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                        textAlign: TextAlign.center,
                                        style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                                        onChanged: (val) {
                                          final cur = _parseInputNumber(val);
                                          unidadesController.text = _formatQtyForInput(cur * product.unitsPerBox, 'UNIDADES');
                                          setModalState(() {});
                                        },
                                        decoration: _qtyFieldDeco(AppTheme.neonGreen),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    _buildQtyButton(Icons.add, AppTheme.neonBlue, () {
                                      final cur = _parseInputNumber(cajasController.text);
                                      final newC = cur + 1;
                                      setModalState(() {
                                        cajasController.text = _formatQtyForInput(newC, 'CAJAS');
                                        unidadesController.text = _formatQtyForInput(newC * product.unitsPerBox, 'UNIDADES');
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
                                Text('Unidades (${product.unitsPerBox.toStringAsFixed(0)} U/C)',
                                    style: TextStyle(
                                        color: Colors.white70,
                                        fontSize: Responsive.fontSize(context,
                                            small: 11, large: 13))),
                                const SizedBox(height: 6),
                                TextField(
                                  controller: unidadesController,
                                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                                  onChanged: (val) {
                                    final cur = _parseInputNumber(val);
                                    cajasController.text = _formatQtyForInput(cur / product.unitsPerBox, 'CAJAS');
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
                              fontSize: Responsive.fontSize(context, small: 11, large: 13),
                            )),
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: product.availableUnits.map((unit) {
                            final selected = selectedUnit == unit;
                            final unitPrice = product.priceForUnit(unit);
                            final unitStock = product.stockForUnit(unit);
                            final stockLabel = Product.unitLabel(unit);
                            return SizedBox(
                              width: (MediaQuery.of(ctx).size.width - 56) / 3,
                              height: 56,
                              child: ElevatedButton(
                                onPressed: () {
                                  setModalState(() {
                                    selectedUnit = unit;
                                    priceController.text = _formatPriceForInput(unitPrice);
                                    final currentQty = _parseInputNumber(qtyController.text);
                                    qtyController.text = _formatQtyForInput(currentQty, selectedUnit);
                                  });
                                },
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: selected ? AppTheme.neonBlue.withOpacity(0.2) : AppTheme.darkCard,
                                  foregroundColor: selected ? AppTheme.neonBlue : Colors.white70,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    side: BorderSide(
                                      color: selected ? AppTheme.neonBlue : AppTheme.borderColor,
                                      width: selected ? 1.5 : 1,
                                    ),
                                  ),
                                  elevation: 0,
                                  padding: const EdgeInsets.symmetric(vertical: 2),
                                ),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text(unit,
                                        style: TextStyle(
                                          fontSize: Responsive.fontSize(context, small: 10, large: 11),
                                          fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                                        )),
                                    Text(
                                      PedidosFormatters.money(unitPrice, decimals: 3),
                                      style: TextStyle(
                                        fontSize: 9,
                                        color: selected ? AppTheme.neonGreen : Colors.white38,
                                      ),
                                    ),
                                    Text(
                                      '${_formatUnitQty(unitStock, unit)} $stockLabel',
                                      style: TextStyle(
                                        fontSize: 8,
                                        color: unitStock > 0 ? Colors.white30 : AppTheme.error.withOpacity(0.6),
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
                          final selectedUnitPrice = product.priceForUnit(selectedUnit);
                          final selectedStock = product.stockForUnit(selectedUnit);
                          final selectedLabel = Product.unitLabel(selectedUnit);
                          final qtyPerBox = product.quantityPerBoxForUnit(selectedUnit);
                          final boxPrice = product.priceForUnit('CAJAS');

                          return Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                            decoration: BoxDecoration(
                              color: AppTheme.darkCard,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: AppTheme.borderColor.withOpacity(0.6)),
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
                                    color: selectedStock > 0 ? AppTheme.neonGreen : AppTheme.error,
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
                          fontSize: Responsive.fontSize(context, small: 11, large: 13),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          _buildQtyButton(Icons.remove, AppTheme.error, () {
                            final cur = _parseInputNumber(qtyController.text);
                            if (cur > 1) {
                              setModalState(() => qtyController.text = _formatQtyForInput(cur - 1, selectedUnit));
                            }
                          }),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextField(
                              controller: qtyController,
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                              onChanged: (_) => setModalState(() {}),
                              decoration: _qtyFieldDeco(AppTheme.neonGreen),
                            ),
                          ),
                          const SizedBox(width: 10),
                          _buildQtyButton(Icons.add, AppTheme.neonBlue, () {
                            final cur = _parseInputNumber(qtyController.text);
                            setModalState(() => qtyController.text = _formatQtyForInput(cur + 1, selectedUnit));
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
                                final cur = _parseInputNumber(qtyController.text);
                                setModalState(() => qtyController.text = _formatQtyForInput(cur + v, selectedUnit));
                              },
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppTheme.neonBlue,
                                side: BorderSide(color: AppTheme.neonBlue.withOpacity(0.4)),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                minimumSize: Size.zero,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              child: Text('+$v', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
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
                                  } else if (product.isWeightProduct && selectedUnit == 'KILOGRAMOS') {
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
                                  // If stock error, offer alternatives
                                  if (errorFromAdd.contains('Stock insuficiente') && !product.hasStock) {
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
              if (promos.isEmpty) return const SizedBox.shrink();
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
          // Save draft button
          Consumer<PedidosProvider>(
            builder: (ctx, prov, _) {
              if (!prov.hasLines) return const SizedBox.shrink();
              return IconButton(
                icon: const Icon(Icons.save_outlined, color: Colors.white70),
                tooltip: 'Guardar borrador',
                onPressed: () async {
                  await prov.saveDraft(widget.employeeCode);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Borrador guardado'),
                        backgroundColor: AppTheme.neonBlue,
                        duration: Duration(seconds: 2),
                      ),
                    );
                  }
                },
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
              onPressed: () => _showCartSheet(),
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

  void _showCartSheet() {
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
              : () {
                  // Mejora 2 â€” Quick add 1 caja
                  HapticFeedback.lightImpact();
                  final messenger = ScaffoldMessenger.of(context);
                  messenger.hideCurrentSnackBar();
                  final err = provider.addLine(
                      product, 1.0, 0.0, 'CAJAS', product.bestPrice);
                  if (err != null) {
                    messenger.showSnackBar(
                      SnackBar(
                          content: Text(err,
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold)),
                          backgroundColor: AppTheme.error,
                          duration: const Duration(seconds: 2)),
                    );
                  } else {
                    provider.loadComplementaryProducts();
                    messenger.showSnackBar(
                      SnackBar(
                          content: Text('+1 caja de ${product.name}'),
                          backgroundColor: AppTheme.neonGreen,
                          duration: const Duration(seconds: 1)),
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
              SizedBox(
                height: 32,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: ['Todo', 'Hoy', 'Semana', 'Mes'].map((label) {
                    final selected = _orderDateFilter == label;
                    return Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: FilterChip(
                        label: Text(label),
                        selected: selected,
                        selectedColor: AppTheme.neonBlue.withOpacity(0.2),
                        backgroundColor: AppTheme.darkCard,
                        labelStyle: TextStyle(
                          color: selected ? AppTheme.neonBlue : Colors.white70,
                          fontSize: 11,
                        ),
                        side: BorderSide(
                            color: selected
                                ? AppTheme.neonBlue
                                : AppTheme.borderColor),
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        visualDensity: VisualDensity.compact,
                        onSelected: (_) =>
                            setState(() => _orderDateFilter = label),
                      ),
                    );
                  }).toList(),
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

    return Card(
      color: AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.orange.withOpacity(0.35)),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: restoreDraft,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.drafts_outlined,
                      color: Colors.orange, size: 18),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      clientName.isNotEmpty ? clientName : clientCode,
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize:
                            Responsive.fontSize(context, small: 14, large: 16),
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.orange.withOpacity(0.18),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text(
                      'BORRADOR',
                      style: TextStyle(
                        color: Colors.orange,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                clientCode,
                style: TextStyle(
                  color: Colors.white54,
                  fontSize: Responsive.fontSize(context, small: 11, large: 13),
                ),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Icon(Icons.shopping_bag_outlined,
                      color: Colors.white38, size: 14),
                  const SizedBox(width: 4),
                  Text(
                    '${lines.length} lineas',
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize:
                          Responsive.fontSize(context, small: 11, large: 13),
                    ),
                  ),
                  if (dateLabel.isNotEmpty) ...[
                    const SizedBox(width: 12),
                    Icon(Icons.schedule_outlined,
                        color: Colors.white38, size: 14),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        dateLabel,
                        style: const TextStyle(
                            color: Colors.white38, fontSize: 11),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                  const SizedBox(width: 8),
                  Text(
                    PedidosFormatters.money(total),
                    style: TextStyle(
                      color: AppTheme.neonGreen,
                      fontWeight: FontWeight.bold,
                      fontSize:
                          Responsive.fontSize(context, small: 14, large: 16),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  OutlinedButton.icon(
                    onPressed: restoreDraft,
                    icon: const Icon(Icons.restore, size: 14),
                    label: const Text('Cargar'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.neonBlue,
                      side:
                          BorderSide(color: AppTheme.neonBlue.withOpacity(0.5)),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 6),
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: deleteDraft,
                    icon: const Icon(Icons.delete_outline, size: 14),
                    label: const Text('Eliminar'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.error,
                      side: BorderSide(color: AppTheme.error.withOpacity(0.5)),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 6),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOrderCard(OrderSummary order) {
    final statusColors = {
      'BORRADOR': Colors.orange,
      'CONFIRMADO': AppTheme.neonBlue,
      'ENVIADO': AppTheme.neonGreen,
      'ANULADO': AppTheme.error,
    };
    final color = statusColors[order.estado] ?? Colors.white54;
    final marginColor = order.margen >= 15
        ? AppTheme.neonGreen
        : order.margen >= 5
            ? Colors.orange
            : AppTheme.error;

    return Card(
      color: AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: color.withOpacity(0.3)),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () async {
          final result =
              await OrderDetailSheet.show(context, orderId: order.id);
          if (result == 'cancelled' && mounted) {
            context.read<PedidosProvider>().loadOrders(
                  vendedorCodes: _vendedorCodes,
                  forceRefresh: true,
                );
          } else if (result != null && result.startsWith('clone:') && mounted) {
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
                    backgroundColor: AppTheme.neonBlue,
                  ),
                );
              }
            }
          }
        },
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  // Order number
                  Text(
                    '#${order.numeroPedido}',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize:
                          Responsive.fontSize(context, small: 15, large: 17),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Status badge
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: color.withOpacity(0.5)),
                    ),
                    child: Text(
                      order.estado,
                      style: TextStyle(
                        color: color,
                        fontSize:
                            Responsive.fontSize(context, small: 10, large: 12),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const Spacer(),
                  Text(
                    order.fecha,
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize:
                          Responsive.fontSize(context, small: 11, large: 13),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              // Client
              Text(
                '${order.clienteName} (${order.clienteCode})',
                style: TextStyle(
                  color: Colors.white70,
                  fontSize: Responsive.fontSize(context, small: 13, large: 15),
                ),
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 8),
              // Bottom row: lines, actions, total
              Row(
                children: [
                  Icon(Icons.shopping_bag_outlined,
                      color: Colors.white38, size: 14),
                  const SizedBox(width: 4),
                  Text(
                    '${order.lineCount} lineas',
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize:
                          Responsive.fontSize(context, small: 11, large: 13),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Clone order button
                  InkWell(
                    onTap: () async {
                      HapticFeedback.mediumImpact();
                      final prov = context.read<PedidosProvider>();
                      await prov.cloneOrderIntoCart(order.id);
                      if (mounted) {
                        _tabController.animateTo(0);
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                                'Pedido #${order.numeroPedido} clonado al carrito'),
                            backgroundColor: AppTheme.neonBlue,
                          ),
                        );
                      }
                    },
                    borderRadius: BorderRadius.circular(6),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppTheme.neonPurple.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(
                            color: AppTheme.neonPurple.withOpacity(0.3)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.copy,
                              color: AppTheme.neonPurple, size: 12),
                          const SizedBox(width: 3),
                          Text('Clonar',
                              style: TextStyle(
                                  color: AppTheme.neonPurple,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600)),
                        ],
                      ),
                    ),
                  ),
                  // PDF button
                  const SizedBox(width: 6),
                  InkWell(
                    onTap: () async {
                      HapticFeedback.lightImpact();
                      try {
                        final detail =
                            await PedidosService.getOrderDetail(order.id);
                        if (mounted) {
                          await OrderPdfGenerator.generateAndShare(
                              context, detail);
                        }
                      } catch (e) {
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                                content: Text('Error generando PDF: $e'),
                                backgroundColor: AppTheme.error),
                          );
                        }
                      }
                    },
                    borderRadius: BorderRadius.circular(6),
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: AppTheme.neonGreen.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Icon(Icons.picture_as_pdf,
                          color: AppTheme.neonGreen, size: 16),
                    ),
                  ),
                  // WhatsApp button
                  const SizedBox(width: 6),
                  InkWell(
                    onTap: () async {
                      final text =
                          'Pedido #${order.numeroPedido} - ${order.clienteName}\n'
                          'Fecha: ${order.fecha.length >= 10 ? order.fecha.substring(0, 10) : order.fecha}\n'
                          'Estado: ${order.estado}\n'
                          'Total: ${PedidosFormatters.money(order.total)}\n'
                          '${order.lineCount} lineas';
                      final uri = Uri.parse(
                          'https://wa.me/?text=${Uri.encodeComponent(text)}');
                      try {
                        final launched = await launchUrl(
                          uri,
                          mode: LaunchMode.externalApplication,
                        );
                        if (!launched && mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('No se pudo abrir WhatsApp'),
                              backgroundColor: AppTheme.error,
                            ),
                          );
                        }
                      } catch (_) {
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('No se pudo abrir WhatsApp'),
                              backgroundColor: AppTheme.error,
                            ),
                          );
                        }
                      }
                    },
                    borderRadius: BorderRadius.circular(6),
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: const Color(0xFF25D366).withOpacity(0.12),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Icon(Icons.chat,
                          color: Color(0xFF25D366), size: 16),
                    ),
                  ),
                  const Spacer(),
                  // Mejora 10 \u2014 Margin display
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                    decoration: BoxDecoration(
                      color: marginColor.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '${order.margen.toStringAsFixed(1)}%',
                      style: TextStyle(
                        color: marginColor,
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    PedidosFormatters.money(order.total),
                    style: TextStyle(
                      color: AppTheme.neonGreen,
                      fontWeight: FontWeight.bold,
                      fontSize:
                          Responsive.fontSize(context, small: 15, large: 17),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
