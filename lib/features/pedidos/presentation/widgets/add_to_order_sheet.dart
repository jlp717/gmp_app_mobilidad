/// Add to Order Sheet
/// ==================
/// Bottom sheet for adding products to the current order with quantity,
/// unit, and tariff selection.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/product_detail_sheet.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/product_history_sheet.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/stock_alternatives_sheet.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/tarifa_selector_modal.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

class AddToOrderSheet {
  static Future<void> show(
    BuildContext context,
    WidgetRef ref, {
    required Product product,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _AddToOrderBody(
        product: product,
      ),
    );
  }
}

class _AddToOrderBody extends ConsumerStatefulWidget {
  const _AddToOrderBody({required this.product});

  final Product product;

  @override
  ConsumerState<_AddToOrderBody> createState() => _AddToOrderBodyState();
}

class _AddToOrderBodyState extends ConsumerState<_AddToOrderBody> {
  late TextEditingController _qtyController;
  late TextEditingController _cajasController;
  late TextEditingController _unidadesController;
  late TextEditingController _priceController;

  late String _selectedUnit;
  double? _selectedTariffUnitPrice;
  bool _showWarehouseStock = false;
  List<TariffEntry> _tariffs = [];
  List<StockEntry> _stockByWarehouse = [];
  int _clientTarifaCode = 1;
  bool _loadingTariffs = true;

  Product get product => widget.product;
  bool get isDual => product.isDualFieldProduct;

  @override
  void initState() {
    super.initState();
    final prov = ref.read(pedidosProvider);
    OrderLine? existingLine;
    for (final line in prov.lines) {
      if (line.codigoArticulo == product.code) {
        existingLine = line;
        break;
      }
    }
    final rememberedUnit = prov.lastUnitForProduct(product.code);
    var selectedUnit = existingLine?.unidadMedida ??
        rememberedUnit ??
        (product.availableUnits.contains('CAJAS')
            ? 'CAJAS'
            : product.availableUnits.first);
    if (!product.availableUnits.contains(selectedUnit)) {
      selectedUnit = product.availableUnits.contains('CAJAS')
          ? 'CAJAS'
          : product.availableUnits.first;
    }
    if (isDual) {
      selectedUnit = 'CAJAS';
    }

    final initQty = existingLine != null
        ? (existingLine.cantidadEnvases > 0
            ? existingLine.cantidadEnvases
            : existingLine.cantidadUnidades)
        : prov.lastQtyForProduct(product.code);

    final initCajas = existingLine?.cantidadEnvases ?? (isDual ? initQty : 0.0);
    final initUds = existingLine?.cantidadUnidades ??
        (isDual ? initQty * product.unitsPerBox : 0.0);

    double? selectedTariffUnitPrice = prov.lastPriceForProduct(product.code);
    if (selectedTariffUnitPrice == null && existingLine != null) {
      selectedTariffUnitPrice =
          selectedUnit == 'CAJAS' && product.unitsPerBox > 0
              ? existingLine.precioVenta / product.unitsPerBox
              : existingLine.precioVenta;
    }

    _selectedUnit = selectedUnit;
    _selectedTariffUnitPrice = selectedTariffUnitPrice;
    _qtyController = TextEditingController(
      text: _formatQtyForInput(initQty, selectedUnit),
    );
    _cajasController = TextEditingController(
      text: initCajas > 0 ? _formatQtyForInput(initCajas, 'CAJAS') : '',
    );
    _unidadesController = TextEditingController(
      text: initUds > 0 ? _formatQtyForInput(initUds, 'UNIDADES') : '',
    );
    _priceController = TextEditingController(
      text: _formatPriceForInput(
        existingLine?.precioVenta ?? _unitPriceForSelection(selectedUnit),
      ),
    );
  }

  @override
  void dispose() {
    _qtyController.dispose();
    _cajasController.dispose();
    _unidadesController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  double _unitPriceForSelection(String unit) {
    if (_selectedTariffUnitPrice != null && _selectedTariffUnitPrice! > 0) {
      if (unit == 'CAJAS') {
        return _selectedTariffUnitPrice! *
            (product.unitsPerBox > 0 ? product.unitsPerBox : 1);
      }
      return _selectedTariffUnitPrice!;
    }
    return product.priceForUnit(unit);
  }

  InputDecoration _qtyFieldDeco(Color color) {
    return InputDecoration(
      filled: true,
      fillColor: color.withValues(alpha: 0.1),
      contentPadding: const EdgeInsets.symmetric(vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: color),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: color),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: color, width: 2),
      ),
    );
  }

  String _buildStockText() {
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

  String _buildWarehouseStockText(StockEntry stock) {
    final parts = <String>[];
    for (final unit in product.availableUnits) {
      if (unit == 'CAJAS') {
        parts.add(
          '${PedidosFormatters.number(stock.envases)} ${Product.unitLabel(unit)}',
        );
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
    return PedidosFormatters.number(value);
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

  String _formatUc(double value) {
    if (value == value.roundToDouble()) {
      return value.toInt().toString();
    }
    return value.toStringAsFixed(1);
  }

  Widget _buildQtyButton(IconData icon, Color color, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Icon(icon, color: color, size: 24),
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
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 14),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<bool?> _showPriceWarning(
    BuildContext context,
    double price,
    double minPrice,
  ) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(
              Icons.warning_amber_rounded,
              color: AppTheme.warning,
              size: 24,
            ),
            SizedBox(width: 8),
            Text('Precio bajo', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Text(
          'El precio (${PedidosFormatters.money(price, decimals: 3)}) es inferior al minimo (${PedidosFormatters.money(minPrice, decimals: 3)})',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child:
                const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(
              'Aceptar',
              style: TextStyle(color: AppTheme.warning),
            ),
          ),
        ],
      ),
    );
  }

  void _showFullscreenImage(BuildContext context) {
    final imageUrl = '${ApiConfig.baseUrl}/products/'
        '${Uri.encodeComponent(product.code.trim())}/image';
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
                product.name,
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
                maxScale: 5,
                child: SmartProductImage(
                  imageUrl: imageUrl,
                  productCode: product.code,
                  productName: product.name,
                  fit: BoxFit.contain,
                  headers: ApiClient.authHeaders,
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

  @override
  Widget build(BuildContext context) {
    return StatefulBuilder(
      builder: (ctx, setModalState) {
        if (_loadingTariffs) {
          _loadingTariffs = false;
          final prov = ref.read(pedidosProvider);
          PedidosService.getProductDetail(
            product.code,
            clientCode: prov.hasClient ? prov.clientCode : null,
          ).then((detail) {
            if (ctx.mounted) {
              setModalState(() {
                _tariffs = detail.tariffs;
                _stockByWarehouse = detail.stockByWarehouse;
                _clientTarifaCode = detail.codigoTarifaCliente;
                if (detail.clientPrice > 0) {
                  _priceController.text =
                      _formatPriceForInput(detail.clientPrice);
                }
              });
            }
          }).catchError((_) {});
        }

        final qty = isDual
            ? _parseInputNumber(_cajasController.text)
            : _parseInputNumber(_qtyController.text);
        final uds = isDual ? _parseInputNumber(_unidadesController.text) : 0.0;
        final price = _parseInputNumber(_priceController.text);
        var billingQty = qty;
        if (isDual) {
          if (qty > 0 && uds > 0) {
            final expectedUnits = qty * product.unitsPerBox;
            final unitsAreEquivalent =
                (uds - expectedUnits).abs() < 0.0001 || uds >= expectedUnits;
            billingQty =
                unitsAreEquivalent ? qty : qty + (uds / product.unitsPerBox);
          } else if (uds > 0) {
            billingQty = uds / product.unitsPerBox;
          }
        }
        final total = billingQty * price;

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
                Center(
                  child: GestureDetector(
                    onTap: () => _showFullscreenImage(ctx),
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
                        fontSize: Responsive.fontSize(
                          context,
                          small: 11,
                          large: 13,
                        ),
                      ),
                    ),
                    const Spacer(),
                    Icon(
                      Icons.inventory_outlined,
                      color: product.hasStock
                          ? AppTheme.neonGreen
                          : AppTheme.error,
                      size: 14,
                    ),
                    const SizedBox(width: 4),
                    Flexible(
                      child: GestureDetector(
                        onTap: () => setModalState(
                          () => _showWarehouseStock = !_showWarehouseStock,
                        ),
                        child: Row(
                          children: [
                            Text(
                              _buildStockText(),
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
                            if (_stockByWarehouse.isNotEmpty)
                              Icon(
                                _showWarehouseStock
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
                if (_showWarehouseStock && _stockByWarehouse.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(
                      top: 4,
                      left: 2,
                      right: 2,
                      bottom: 4,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: _stockByWarehouse
                          .map(
                            (s) => Row(
                              children: [
                                const Icon(
                                  Icons.warehouse,
                                  color: AppTheme.neonBlue,
                                  size: 13,
                                ),
                                const SizedBox(width: 4),
                                Expanded(
                                  child: Text(
                                    s.almacenName.isNotEmpty
                                        ? s.almacenName
                                        : 'Almacen ${s.almacenCode}',
                                    style: const TextStyle(
                                      color: Colors.white70,
                                      fontSize: 11,
                                    ),
                                  ),
                                ),
                                Text(
                                  _buildWarehouseStockText(s),
                                  style: const TextStyle(
                                    color: Colors.white54,
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ),
                          )
                          .toList(),
                    ),
                  ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    _buildQuickLink(
                      icon: Icons.info_outline,
                      label: 'Datos producto',
                      color: AppTheme.neonBlue,
                      onTap: () {
                        final prov = ref.read(pedidosProvider);
                        ProductDetailSheet.show(
                          ctx,
                          productCode: product.code,
                          productName: product.name,
                          clientCode: prov.hasClient ? prov.clientCode : null,
                          clientName: prov.hasClient ? prov.clientName : null,
                        );
                      },
                    ),
                    const SizedBox(width: 8),
                    if (ref.read(pedidosProvider).hasClient)
                      _buildQuickLink(
                        icon: Icons.bar_chart_rounded,
                        label: 'Historial compras',
                        color: AppTheme.neonPurple,
                        onTap: () {
                          final prov = ref.read(pedidosProvider);
                          ProductHistorySheet.show(
                            ctx,
                            productCode: product.code,
                            productName: product.name,
                            clientCode: prov.clientCode!,
                            clientName: prov.clientName ?? '',
                          );
                        },
                      ),
                  ],
                ),
                if (_tariffs.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    height: 40,
                    child: ElevatedButton.icon(
                      onPressed: () async {
                        final prov = ref.read(pedidosProvider);
                        final selected = await TarifaSelectorModal.show(
                          ctx,
                          product: product,
                          tariffs: _tariffs,
                          codigoTarifaCliente: _clientTarifaCode,
                          initialPrice: _selectedTariffUnitPrice,
                        );
                        if (selected != null) {
                          setModalState(() {
                            _selectedTariffUnitPrice = selected;
                            _priceController.text = _formatPriceForInput(
                              _unitPriceForSelection(_selectedUnit),
                            );
                            _selectedUnit =
                                product.availableUnits.contains(_selectedUnit)
                                    ? _selectedUnit
                                    : product.availableUnits.first;
                          });
                          prov.setLastPriceForProduct(
                            product.code,
                            _unitPriceForSelection(_selectedUnit),
                          );
                        }
                      },
                      icon: const Icon(Icons.euro_rounded, size: 16),
                      label: const Text(
                        'Precio',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.warning,
                        foregroundColor: AppTheme.darkBase,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        elevation: 0,
                      ),
                    ),
                  ),
                ],
                if (_tariffs.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    'Tarifas',
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: Responsive.fontSize(
                        context,
                        small: 11,
                        large: 13,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  SizedBox(
                    height: 36,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: _tariffs.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 6),
                      itemBuilder: (_, i) {
                        final t = _tariffs[i];
                        final tariffUnitPrice = t.precioUnitario > 0
                            ? t.precioUnitario
                            : (product.unitsPerBox > 0
                                ? t.price / product.unitsPerBox
                                : t.price);
                        final isSelected =
                            (_parseInputNumber(_priceController.text) -
                                        (_selectedUnit == 'CAJAS'
                                            ? tariffUnitPrice *
                                                (product.unitsPerBox > 0
                                                    ? product.unitsPerBox
                                                    : 1)
                                            : tariffUnitPrice))
                                    .abs() <
                                0.0005;
                        return GestureDetector(
                          onTap: () {
                            setModalState(() {
                              _selectedTariffUnitPrice = tariffUnitPrice;
                              _priceController.text = _formatPriceForInput(
                                _unitPriceForSelection(_selectedUnit),
                              );
                            });
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: isSelected
                                  ? AppTheme.neonGreen.withValues(alpha: 0.2)
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
                                  PedidosFormatters.money(
                                    t.price,
                                    decimals: 3,
                                  ),
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
                if (isDual) ...[
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Cajas',
                              style: TextStyle(
                                color: Colors.white70,
                                fontSize: Responsive.fontSize(
                                  context,
                                  small: 11,
                                  large: 13,
                                ),
                              ),
                            ),
                            const SizedBox(height: 6),
                            Row(
                              children: [
                                _buildQtyButton(Icons.remove, AppTheme.error,
                                    () {
                                  final cur = _parseInputNumber(
                                    _cajasController.text,
                                  );
                                  if (cur >= 1) {
                                    final newC = cur - 1;
                                    setModalState(() {
                                      _cajasController.text =
                                          _formatQtyForInput(newC, 'CAJAS');
                                      _unidadesController.text =
                                          _formatQtyForInput(
                                        newC * product.unitsPerBox,
                                        'UNIDADES',
                                      );
                                    });
                                  }
                                }),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: TextField(
                                    controller: _cajasController,
                                    keyboardType:
                                        const TextInputType.numberWithOptions(
                                            decimal: true),
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 18,
                                      fontWeight: FontWeight.bold,
                                    ),
                                    onChanged: (val) {
                                      final cur = _parseInputNumber(val);
                                      _unidadesController.text =
                                          _formatQtyForInput(
                                        cur * product.unitsPerBox,
                                        'UNIDADES',
                                      );
                                      setModalState(() {});
                                    },
                                    decoration:
                                        _qtyFieldDeco(AppTheme.neonGreen),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                _buildQtyButton(Icons.add, AppTheme.neonBlue,
                                    () {
                                  final cur = _parseInputNumber(
                                    _cajasController.text,
                                  );
                                  final newC = cur + 1;
                                  setModalState(() {
                                    _cajasController.text =
                                        _formatQtyForInput(newC, 'CAJAS');
                                    _unidadesController.text =
                                        _formatQtyForInput(
                                      newC * product.unitsPerBox,
                                      'UNIDADES',
                                    );
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
                              'Unidades (${_formatUc(product.unitsPerBox)} U/C)',
                              style: TextStyle(
                                color: Colors.white70,
                                fontSize: Responsive.fontSize(
                                  context,
                                  small: 11,
                                  large: 13,
                                ),
                              ),
                            ),
                            const SizedBox(height: 6),
                            TextField(
                              controller: _unidadesController,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                decimal: true,
                              ),
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                              onChanged: (val) {
                                final cur = _parseInputNumber(val);
                                _cajasController.text = _formatQtyForInput(
                                  cur / product.unitsPerBox,
                                  'CAJAS',
                                );
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
                  if (product.availableUnits.length > 1) ...[
                    const SizedBox(height: 14),
                    Text(
                      'Unidad de medida',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: Responsive.fontSize(
                          context,
                          small: 11,
                          large: 13,
                        ),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: product.availableUnits.map((unit) {
                        final selected = _selectedUnit == unit;
                        final unitPrice = _unitPriceForSelection(unit);
                        final unitStock = product.stockForUnit(unit);
                        final stockLabel = Product.unitLabel(unit);
                        return SizedBox(
                          width: (MediaQuery.of(ctx).size.width - 56) / 3,
                          height: 56,
                          child: ElevatedButton(
                            onPressed: () {
                              setModalState(() {
                                _selectedUnit = unit;
                                _priceController.text = _formatPriceForInput(
                                  _unitPriceForSelection(unit),
                                );
                                final currentQty =
                                    _parseInputNumber(_qtyController.text);
                                _qtyController.text = _formatQtyForInput(
                                  currentQty,
                                  _selectedUnit,
                                );
                              });
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: selected
                                  ? AppTheme.neonBlue.withValues(alpha: 0.2)
                                  : AppTheme.darkCard,
                              foregroundColor:
                                  selected ? AppTheme.neonBlue : Colors.white70,
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
                              padding: const EdgeInsets.symmetric(vertical: 2),
                            ),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  unit,
                                  style: TextStyle(
                                    fontSize: Responsive.fontSize(
                                      context,
                                      small: 10,
                                      large: 11,
                                    ),
                                    fontWeight: selected
                                        ? FontWeight.bold
                                        : FontWeight.normal,
                                  ),
                                ),
                                Text(
                                  PedidosFormatters.money(
                                    unitPrice,
                                    decimals: 3,
                                  ),
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
                                        : AppTheme.error.withValues(alpha: 0.6),
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
                          _unitPriceForSelection(_selectedUnit);
                      final selectedStock = product.stockForUnit(_selectedUnit);
                      final selectedLabel = Product.unitLabel(_selectedUnit);
                      final qtyPerBox =
                          product.quantityPerBoxForUnit(_selectedUnit);
                      final boxPrice = _unitPriceForSelection('CAJAS');

                      return Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          color: AppTheme.darkCard,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: AppTheme.borderColor.withValues(alpha: 0.6),
                          ),
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
                              _selectedUnit == 'CAJAS'
                                  ? 'Precio por caja: ${PedidosFormatters.money(boxPrice, decimals: 3)}'
                                  : '1 caja = ${_formatUnitQty(qtyPerBox, _selectedUnit)} $selectedLabel Â· Precio caja: ${PedidosFormatters.money(boxPrice, decimals: 3)}',
                              style: const TextStyle(
                                color: Colors.white54,
                                fontSize: 10,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Stock disponible: ${_formatUnitQty(selectedStock, _selectedUnit)} $selectedLabel',
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
                    'Cantidad (${Product.unitLabel(_selectedUnit)})',
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: Responsive.fontSize(
                        context,
                        small: 11,
                        large: 13,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      _buildQtyButton(Icons.remove, AppTheme.error, () {
                        final cur = _parseInputNumber(_qtyController.text);
                        if (cur > 1) {
                          setModalState(
                            () => _qtyController.text =
                                _formatQtyForInput(cur - 1, _selectedUnit),
                          );
                        }
                      }),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextField(
                          controller: _qtyController,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                          onChanged: (_) => setModalState(() {}),
                          decoration: _qtyFieldDeco(AppTheme.neonGreen),
                        ),
                      ),
                      const SizedBox(width: 10),
                      _buildQtyButton(Icons.add, AppTheme.neonBlue, () {
                        final cur = _parseInputNumber(_qtyController.text);
                        setModalState(
                          () => _qtyController.text =
                              _formatQtyForInput(cur + 1, _selectedUnit),
                        );
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
                            final cur = _parseInputNumber(_qtyController.text);
                            setModalState(
                              () => _qtyController.text =
                                  _formatQtyForInput(cur + v, _selectedUnit),
                            );
                          },
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppTheme.neonBlue,
                            side: BorderSide(
                              color: AppTheme.neonBlue.withValues(alpha: 0.4),
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 6,
                            ),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          child: Text(
                            '+$v',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: _priceController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white, fontSize: 16),
                  onChanged: (_) => setModalState(() {}),
                  decoration: InputDecoration(
                    labelText: 'Precio',
                    suffixText: ' \u20AC',
                    suffixStyle: const TextStyle(
                      color: AppTheme.neonGreen,
                      fontSize: 16,
                    ),
                    labelStyle: const TextStyle(color: Colors.white70),
                    filled: true,
                    fillColor: AppTheme.darkCard,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
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
                const SizedBox(height: 6),
                Row(
                  children: [
                    if (product.precioMinimo > 0)
                      Text(
                        'Min: ${PedidosFormatters.money(product.minimumPriceForUnit(_selectedUnit), decimals: 3)}',
                        style: TextStyle(
                          color: price > 0 &&
                                  price <
                                      product.minimumPriceForUnit(_selectedUnit)
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
                Builder(
                  builder: (_) {
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
                          Icon(
                            Icons.trending_up,
                            color: margenColor,
                            size: 14,
                          ),
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
                  },
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: 46,
                        child: OutlinedButton(
                          onPressed: () {
                            setModalState(() {
                              _qtyController.text = '0';
                              _cajasController.text = '0';
                              _unidadesController.text = '0';
                            });
                          },
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppTheme.error,
                            side: const BorderSide(color: AppTheme.error),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: const Text(
                            'LIMPIAR',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 2,
                      child: SizedBox(
                        height: 46,
                        child: ElevatedButton.icon(
                          onPressed: () => _handleAddToOrder(ctx),
                          icon: const Icon(Icons.add_shopping_cart),
                          label: const Text('Anadir al pedido'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.neonBlue,
                            foregroundColor: AppTheme.darkBase,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                            textStyle: const TextStyle(
                              fontWeight: FontWeight.bold,
                            ),
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
  }

  Future<void> _handleAddToOrder(BuildContext ctx) async {
    final inputQty = isDual
        ? _parseInputNumber(_cajasController.text)
        : _parseInputNumber(_qtyController.text);
    final inputUds = isDual ? _parseInputNumber(_unidadesController.text) : 0.0;
    final price = _parseInputNumber(_priceController.text);

    if (inputQty <= 0 && inputUds <= 0) return;

    final provider = ref.read(pedidosProvider);

    var envases = 0.0;
    var unidades = 0.0;

    if (isDual) {
      envases = inputQty;
      unidades = inputUds;
    } else {
      if (_selectedUnit == 'CAJAS') {
        envases = inputQty;
        unidades = inputQty * product.unitsPerBox;
      } else if (_selectedUnit == 'KILOGRAMOS' || _selectedUnit == 'LITROS') {
        unidades = inputQty;
      } else {
        unidades = inputQty;
        envases =
            product.unitsPerBox > 0 ? inputQty / product.unitsPerBox : 0.0;
      }
    }

    final minPriceForUnit = product.minimumPriceForUnit(_selectedUnit);
    if (minPriceForUnit > 0 && price < minPriceForUnit) {
      final proceed = await _showPriceWarning(ctx, price, minPriceForUnit);
      if (proceed ?? false) {
        _performAddLine(provider);
      }
      return;
    }

    HapticFeedback.mediumImpact();
    _performAddLine(provider);
  }

  void _performAddLine(PedidosProvider provider) {
    var envases = 0.0;
    var unidades = 0.0;

    if (isDual) {
      envases = _parseInputNumber(_cajasController.text);
      unidades = _parseInputNumber(_unidadesController.text);
    } else {
      if (_selectedUnit == 'CAJAS') {
        envases = _parseInputNumber(_qtyController.text);
        unidades = envases * product.unitsPerBox;
      } else if (_selectedUnit == 'KILOGRAMOS' || _selectedUnit == 'LITROS') {
        unidades = _parseInputNumber(_qtyController.text);
      } else {
        unidades = _parseInputNumber(_qtyController.text);
        envases =
            product.unitsPerBox > 0 ? unidades / product.unitsPerBox : 0.0;
      }
    }

    final price = _parseInputNumber(_priceController.text);

    final errorFromAdd = provider.addLine(
      product,
      envases,
      unidades,
      _selectedUnit,
      price,
    );

    if (errorFromAdd != null) {
      if (errorFromAdd.startsWith('PARCIAL:')) {
        final parts = errorFromAdd.substring(8).split('|');
        final missingQty = double.tryParse(parts[0]) ?? 0.0;
        final pName = parts.length > 1 ? parts[1] : '';
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Se ha aÃ±adido el stock disponible. Faltan ${missingQty.toStringAsFixed(missingQty.truncateToDouble() == missingQty ? 0 : 2)} de $pName',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
            backgroundColor: AppTheme.warning,
          ),
        );
        showStockAlternativesSheet(
          context: context,
          outOfStockProduct: product,
          provider: provider,
          remainingQty: missingQty,
        );
      } else if (errorFromAdd.contains('Stock insuficiente')) {
        Navigator.pop(context);
        showStockAlternativesSheet(
          context: context,
          outOfStockProduct: product,
          provider: provider,
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              errorFromAdd,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
            backgroundColor: AppTheme.error,
            duration: const Duration(seconds: 3),
          ),
        );
      }
      return;
    }

    Navigator.pop(context);
    Future.delayed(const Duration(milliseconds: 300), () {
      if (mounted) {
        ref.read(pedidosProvider).loadComplementaryProducts();
      }
    });
  }
}
