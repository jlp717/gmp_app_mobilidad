/// Pedidos Page
/// ============
/// Main order entry page with two tabs: Nuevo Pedido (catalog+cart) and Mis Pedidos (history)

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
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
import '../dialogs/client_search_dialog.dart';
import '../../data/pedidos_offline_service.dart';
import '../../data/pedidos_favorites_service.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
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

  void _showAddToOrderDialog(Product product) {
    final qtyController = TextEditingController(text: '1');
    final priceController =
        TextEditingController(text: product.bestPrice.toStringAsFixed(3));
    String selectedUnit = 'CAJAS';
    List<TariffEntry> tariffs = [];
    bool loadingTariffs = true;

    showModalBottomSheet(
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
                    if (detail.clientPrice > 0) {
                      priceController.text = detail.clientPrice.toStringAsFixed(3);
                    }
                  });
                }
              }).catchError((_) {});
            }

            final qty = double.tryParse(qtyController.text) ?? 0;
            final price = double.tryParse(priceController.text) ?? 0;
            final total = qty * price;

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
                    // ── Handle ──
                    Center(
                      child: Container(
                        width: 40, height: 4,
                        margin: const EdgeInsets.only(bottom: 12),
                        decoration: BoxDecoration(
                          color: Colors.white24,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                    // ── Header: name + code + stock ──
                    Text(
                      product.name,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: Responsive.fontSize(context, small: 15, large: 17),
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
                            fontSize: Responsive.fontSize(context, small: 11, large: 13),
                          ),
                        ),
                        const Spacer(),
                        Icon(Icons.inventory_outlined,
                            color: product.hasStock ? AppTheme.neonGreen : AppTheme.error, size: 14),
                        const SizedBox(width: 4),
                        Text(
                          '${product.stockEnvases.toStringAsFixed(0)} c / ${product.stockUnidades.toStringAsFixed(0)} u',
                          style: TextStyle(
                            color: product.hasStock ? AppTheme.neonGreen : AppTheme.error,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                    // ── Quick links row ──
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
                              clientCode: prov.hasClient ? prov.clientCode : null,
                              clientName: prov.hasClient ? prov.clientName : null,
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
                    // ── Tariff chips ──
                    if (tariffs.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text('Tarifas', style: TextStyle(
                        color: Colors.white70,
                        fontSize: Responsive.fontSize(context, small: 11, large: 13),
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
                            final isSelected = priceController.text == t.price.toStringAsFixed(3);
                            return GestureDetector(
                              onTap: () {
                                setModalState(() {
                                  priceController.text = t.price.toStringAsFixed(3);
                                });
                              },
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(
                                  color: isSelected
                                      ? AppTheme.neonGreen.withOpacity(0.2)
                                      : AppTheme.darkCard,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                    color: isSelected ? AppTheme.neonGreen : AppTheme.borderColor,
                                  ),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      t.description.isNotEmpty ? t.description : 'T${t.code}',
                                      style: TextStyle(
                                        color: isSelected ? AppTheme.neonGreen : Colors.white54,
                                        fontSize: 11,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      '\u20AC${t.price.toStringAsFixed(3)}',
                                      style: TextStyle(
                                        color: isSelected ? AppTheme.neonGreen : Colors.white,
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
                    // ── Unit selector (5 options like screenshot) ──
                    const SizedBox(height: 14),
                    Text('Unidad de medida', style: TextStyle(
                      color: Colors.white70,
                      fontSize: Responsive.fontSize(context, small: 11, large: 13),
                    )),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: ['PIEZAS', 'BANDEJAS', 'ESTUCHE', 'KILOGRAMOS', 'CAJAS'].map((unit) {
                        final selected = selectedUnit == unit;
                        return SizedBox(
                          width: (MediaQuery.of(ctx).size.width - 56) / 3,
                          height: 40,
                          child: ElevatedButton(
                            onPressed: () => setModalState(() => selectedUnit = unit),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: selected
                                  ? AppTheme.neonBlue.withOpacity(0.2)
                                  : AppTheme.darkCard,
                              foregroundColor: selected ? AppTheme.neonBlue : Colors.white70,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                                side: BorderSide(
                                  color: selected ? AppTheme.neonBlue : AppTheme.borderColor,
                                  width: selected ? 1.5 : 1,
                                ),
                              ),
                              elevation: 0,
                              padding: EdgeInsets.zero,
                            ),
                            child: Text(unit, style: TextStyle(
                              fontSize: Responsive.fontSize(context, small: 11, large: 12),
                              fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                            )),
                          ),
                        );
                      }).toList(),
                    ),
                    // ── Quantity with +/- ──
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        // Minus button
                        _buildQtyButton(Icons.remove, AppTheme.error, () {
                          final cur = double.tryParse(qtyController.text) ?? 0;
                          if (cur > 1) setModalState(() => qtyController.text = (cur - 1).toStringAsFixed(0));
                        }),
                        const SizedBox(width: 10),
                        // Qty field
                        Expanded(
                          child: TextField(
                            controller: qtyController,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                            onChanged: (_) => setModalState(() {}),
                            decoration: InputDecoration(
                              filled: true,
                              fillColor: AppTheme.neonGreen.withOpacity(0.1),
                              contentPadding: const EdgeInsets.symmetric(vertical: 12),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(color: AppTheme.neonGreen),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(color: AppTheme.neonGreen),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(color: AppTheme.neonGreen, width: 2),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        // Plus button
                        _buildQtyButton(Icons.add, AppTheme.neonBlue, () {
                          final cur = double.tryParse(qtyController.text) ?? 0;
                          setModalState(() => qtyController.text = (cur + 1).toStringAsFixed(0));
                        }),
                      ],
                    ),
                    // ── Price field ──
                    const SizedBox(height: 12),
                    TextField(
                      controller: priceController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(color: Colors.white, fontSize: 16),
                      onChanged: (_) => setModalState(() {}),
                      decoration: InputDecoration(
                        labelText: 'Precio',
                        prefixText: '\u20AC ',
                        prefixStyle: const TextStyle(color: AppTheme.neonGreen, fontSize: 16),
                        labelStyle: const TextStyle(color: Colors.white70),
                        filled: true,
                        fillColor: AppTheme.darkCard,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: AppTheme.borderColor),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: AppTheme.neonBlue),
                        ),
                      ),
                    ),
                    // Price warning + total
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        if (product.precioMinimo > 0)
                          Text(
                            'Min: \u20AC${product.precioMinimo.toStringAsFixed(3)}',
                            style: TextStyle(
                              color: price > 0 && price < product.precioMinimo
                                  ? AppTheme.error : Colors.white38,
                              fontSize: 11,
                            ),
                          ),
                        const Spacer(),
                        Text(
                          'Total: \u20AC${total.toStringAsFixed(2)}',
                          style: const TextStyle(
                            color: AppTheme.neonGreen,
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    // ── Action buttons ──
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        // LIMPIAR CANTIDAD
                        Expanded(
                          child: SizedBox(
                            height: 46,
                            child: OutlinedButton(
                              onPressed: () {
                                setModalState(() => qtyController.text = '0');
                              },
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppTheme.error,
                                side: const BorderSide(color: AppTheme.error),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                              child: const Text('LIMPIAR', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
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
                        final qty =
                            double.tryParse(qtyController.text) ?? 0;
                        final price =
                            double.tryParse(priceController.text) ?? 0;
                        if (qty <= 0) return;

                        final provider = context.read<PedidosProvider>();
                        final envases =
                            selectedUnit == 'CAJAS' ? qty : 0.0;
                        final unidades =
                            selectedUnit != 'CAJAS' ? qty : 0.0;

                        // Check price warning
                        if (product.precioMinimo > 0 &&
                            price < product.precioMinimo) {
                          _showPriceWarning(
                            context,
                            price,
                            product.precioMinimo,
                          ).then((proceed) {
                            if (proceed == true) {
                              provider.addLine(product, envases, unidades,
                                  selectedUnit, price);
                              Navigator.pop(ctx);
                            }
                          });
                          return;
                        }

                        HapticFeedback.mediumImpact();
                        final errorFromAdd = provider.addLine(
                            product, envases, unidades, selectedUnit, price);

                        if (errorFromAdd != null) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(errorFromAdd, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                              backgroundColor: AppTheme.error,
                              duration: const Duration(seconds: 3),
                            ),
                          );
                          return;
                        }

                        Navigator.pop(ctx);
                        Future.delayed(const Duration(milliseconds: 300), () {
                          if (mounted) {
                            context.read<PedidosProvider>().loadComplementaryProducts();
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
                          textStyle: const TextStyle(fontWeight: FontWeight.bold),
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
              style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
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
            const Text('Precio bajo',
                style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Text(
          'El precio (\u20AC${price.toStringAsFixed(3)}) es inferior al minimo (\u20AC${minPrice.toStringAsFixed(3)})',
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
          content: Text('No hay borradores guardados', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          backgroundColor: AppTheme.darkCard,
        ),
      );
      return;
    }

    showModalBottomSheet(
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
              final savedAt = draft['savedAt'] ?? '';
              final key = draft['draftKey'] as String;
              return Card(
                color: AppTheme.darkCard,
                margin: const EdgeInsets.only(bottom: 6),
                child: ListTile(
                  leading: const Icon(Icons.description_outlined, color: AppTheme.neonBlue),
                  title: Text(client.toString(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                  subtitle: Text('$lines lineas · ${savedAt.substring(0, 10)}', style: const TextStyle(color: Colors.white54, fontSize: 12)),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.restore, color: AppTheme.neonGreen, size: 20),
                        onPressed: () {
                          provider.loadDraft(draft);
                          Navigator.pop(ctx);
                          _tabController.animateTo(0);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Borrador cargado'), backgroundColor: AppTheme.neonGreen),
                          );
                        },
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline, color: AppTheme.error, size: 20),
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
                     icon: const Icon(Icons.local_offer_outlined, color: AppTheme.neonPurple),
                     tooltip: 'Ver Promociones',
                     onPressed: () {
                       Navigator.push(
                         context,
                         MaterialPageRoute(
                           builder: (_) => PromotionsListPage(
                             promotions: promos,
                             onProductTap: (code, name) => _onProductTap(Product(code: code, name: name)),
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
                         style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
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
                    icon: const Icon(Icons.drafts_outlined, color: Colors.white70),
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
                          style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
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
            Tab(text: 'Nuevo Pedido', icon: Icon(Icons.add_circle_outline)),
            Tab(text: 'Mis Pedidos', icon: Icon(Icons.list_alt)),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildNuevoPedidoTab(),
          _buildMisPedidosTab(),
        ],
      ),
    );
  }

  // ── TAB 1: Nuevo Pedido ──

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
                '${provider.lineCount} | \u20AC${provider.totalImporte.toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ),
      ],
    );
  }

  void _showCartSheet() {
    showModalBottomSheet(
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
        // "Ver como" vendor selector for JEFE_VENTAS
        if (widget.isJefeVentas)
          GlobalVendorSelector(
            isJefeVentas: true,
            onChanged: _onVendorFilterChanged,
          ),
        // Client & sale type header
        _buildOrderHeader(provider),
        // Search + filters
        ProductSearchWidget(
          vendedorCodes: _vendedorCodes,
        ),
        // Promotions banner
        PromotionsBanner(
          onProductTap: (code, name) {
            final match = provider.products
                .where((p) => p.code == code)
                .toList();
            if (match.isNotEmpty) {
              _onProductTap(match.first);
            }
          },
        ),
        // Recommendations
        if (provider.hasClient &&
            (provider.clientHistory.isNotEmpty ||
                provider.similarClients.isNotEmpty))
          RecommendationsSection(
            onProductTap: (code, name) {
              // Find product in catalog or just show code
              final match = provider.products
                  .where((p) => p.code == code)
                  .toList();
              if (match.isNotEmpty) {
                _onProductTap(match.first);
              }
            },
          ),
        // Complementary products (based on cart contents)
        if (provider.hasLines && provider.complementaryProducts.isNotEmpty)
          ComplementaryProducts(
            products: provider.complementaryProducts,
            onAdd: (code, name) {
              final match = provider.products.where((p) => p.code == code).toList();
              if (match.isNotEmpty) {
                _onProductTap(match.first);
              }
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
                        child: ClientBalanceBadge(balance: provider.clientBalance),
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
            Icon(Icons.error_outline,
                color: AppTheme.error, size: 48),
            const SizedBox(height: 12),
            Text(
              'Error al cargar productos',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: Responsive.fontSize(context,
                      small: 14, large: 16)),
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
            Icon(Icons.inventory_2_outlined,
                color: Colors.white38, size: 48),
            const SizedBox(height: 12),
            Text(
              'No se encontraron productos',
              style: TextStyle(
                  color: Colors.white54,
                  fontSize: Responsive.fontSize(context,
                      small: 14, large: 16)),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      controller: _catalogScrollController,
      padding: Responsive.contentPadding(context),
      itemCount:
          provider.products.length + (provider.hasMoreProducts ? 1 : 0),
      itemBuilder: (ctx, i) {
        if (i >= provider.products.length) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(
              child: CircularProgressIndicator(color: AppTheme.neonBlue),
            ),
          );
        }
        final product = provider.products[i];
        return ProductCard(
          product: product,
          onTap: () => _onProductTap(product),
          isFavorite: provider.isFavorite(product.code),
          promo: provider.getPromo(product.code),
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
    final provider = context.watch<PedidosProvider>();
    return Column(
      children: [
        _buildOrderStatusFilters(provider),
        Expanded(
          child: _buildOrdersListWithAnalytics(provider),
        ),
      ],
    );
  }

  Widget _buildOrdersListWithAnalytics(PedidosProvider provider) {
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
              child: Center(child: CircularProgressIndicator(color: AppTheme.neonBlue)),
            )
          else if (provider.orders.isEmpty)
            SliverFillRemaining(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.receipt_long_outlined, color: Colors.white38, size: 48),
                    const SizedBox(height: 12),
                    Text('No hay pedidos',
                        style: TextStyle(color: Colors.white54,
                            fontSize: Responsive.fontSize(context, small: 14, large: 16))),
                  ],
                ),
              ),
            )
          else
            SliverPadding(
              padding: Responsive.contentPadding(context),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate(
                  (ctx, i) => _buildOrderCard(provider.orders[i]),
                  childCount: provider.orders.length,
                ),
              ),
            ),
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
                  fontSize:
                      Responsive.fontSize(context, small: 12, large: 14),
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


  Widget _buildOrderCard(OrderSummary order) {
    final statusColors = {
      'BORRADOR': Colors.orange,
      'CONFIRMADO': AppTheme.neonBlue,
      'ENVIADO': AppTheme.neonGreen,
      'ANULADO': AppTheme.error,
    };
    final color = statusColors[order.estado] ?? Colors.white54;

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
          final result = await OrderDetailSheet.show(context, orderId: order.id);
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
                    content: Text('Pedido #${order.numeroPedido} clonado al carrito'),
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
                      fontSize: Responsive.fontSize(context,
                          small: 15, large: 17),
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
                        fontSize: Responsive.fontSize(context,
                            small: 10, large: 12),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const Spacer(),
                  Text(
                    order.fecha,
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize: Responsive.fontSize(context,
                          small: 11, large: 13),
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
                  fontSize:
                      Responsive.fontSize(context, small: 13, large: 15),
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
                      fontSize: Responsive.fontSize(context,
                          small: 11, large: 13),
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
                            content: Text('Pedido #${order.numeroPedido} clonado al carrito'),
                            backgroundColor: AppTheme.neonBlue,
                          ),
                        );
                      }
                    },
                    borderRadius: BorderRadius.circular(6),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppTheme.neonPurple.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.copy, color: AppTheme.neonPurple, size: 12),
                          const SizedBox(width: 3),
                          Text('Clonar', style: TextStyle(color: AppTheme.neonPurple, fontSize: 10, fontWeight: FontWeight.w600)),
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
                        final detail = await PedidosService.getOrderDetail(order.id);
                        if (mounted) {
                          await OrderPdfGenerator.generateAndShare(context, detail);
                        }
                      } catch (e) {
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Error generando PDF: $e'), backgroundColor: AppTheme.error),
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
                      child: Icon(Icons.picture_as_pdf, color: AppTheme.neonGreen, size: 16),
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '\u20AC${order.total.toStringAsFixed(2)}',
                    style: TextStyle(
                      color: AppTheme.neonGreen,
                      fontWeight: FontWeight.bold,
                      fontSize: Responsive.fontSize(context,
                          small: 15, large: 17),
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
