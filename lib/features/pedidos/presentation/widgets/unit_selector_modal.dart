/// Unit Selector Modal (Premium Dialog)
/// ======================================
/// Centered dialog for selecting unit of measure and quantity.
/// Shows equivalences, stock per unit, and price per unit.
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

class UnitSelectorModal extends StatefulWidget {
  const UnitSelectorModal({
    super.key,
    this.initialUnit,
    this.initialQuantity,
    this.availableUnits = const ['CAJAS'],
    this.product,
    this.initialPrice,
    this.qtyAlreadyInCart = 0,
  });
  final String? initialUnit;
  final double? initialQuantity;
  final List<String> availableUnits;
  final Product? product;
  // Override price per displayUnit (from TarifaSelectorModal). null = use product.bestPrice
  final double? initialPrice;

  /// Units of this product already in the cart (same unit family) for stock checks.
  final double qtyAlreadyInCart;

  /// Show the modal as a centered dialog and return { 'unit': String, 'quantity': double } or null
  static Future<Map<String, dynamic>?> show(
    BuildContext context, {
    String? initialUnit,
    double? initialQuantity,
    List<String>? availableUnits,
    Product? product,
    double? initialPrice,
    double qtyAlreadyInCart = 0,
  }) {
    final units = availableUnits ??
        product?.availableUnits ??
        const ['CAJAS', 'PIEZAS', 'BANDEJAS', 'ESTUCHE', 'KILOGRAMOS'];

    return showDialog<Map<String, dynamic>>(
      context: context,
      barrierColor: AppColors.systemBlack54,
      builder: (_) => UnitSelectorModal(
        initialUnit: initialUnit,
        initialQuantity: initialQuantity,
        availableUnits: units,
        product: product,
        initialPrice: initialPrice,
        qtyAlreadyInCart: qtyAlreadyInCart,
      ),
    );
  }

  @override
  State<UnitSelectorModal> createState() => _UnitSelectorModalState();
}

class _UnitSelectorModalState extends State<UnitSelectorModal> {
  late String _selectedUnit;
  final TextEditingController _qtyController = TextEditingController();
  late List<String> _units;
  String? _validationMessage;
  bool _showStockActions = false;
  double _lastRequestedQty = 0;
  double _lastAvailableQty = 0;

  @override
  void initState() {
    super.initState();
    _units = widget.availableUnits;
    _selectedUnit =
        widget.initialUnit ?? (_units.isNotEmpty ? _units.first : 'CAJAS');
    final isWeight = _selectedUnit == 'KILOGRAMOS' || _selectedUnit == 'LITROS';
    _qtyController.text = widget.initialQuantity?.toStringAsFixed(
          isWeight ? 2 : 0,
        ) ??
        '1';
  }

  @override
  void dispose() {
    _qtyController.dispose();
    super.dispose();
  }

  String _unitLabel(String unit) {
    switch (unit.toUpperCase()) {
      case 'CAJAS':
        return 'Cajas';
      case 'UNIDADES':
        return 'Unidades';
      case 'PIEZAS':
        return 'Piezas';
      case 'BANDEJAS':
        return 'Bandejas';
      case 'ESTUCHES':
      case 'ESTUCHE':
        return 'Estuches';
      case 'KILOGRAMOS':
        return 'Kg';
      case 'LITROS':
        return 'Litros';
      default:
        return unit;
    }
  }

  String _unitAbbr(String unit) {
    switch (unit.toUpperCase()) {
      case 'CAJAS':
        return 'cj';
      case 'UNIDADES':
        return 'uds';
      case 'PIEZAS':
        return 'pzs';
      case 'BANDEJAS':
        return 'band';
      case 'ESTUCHES':
      case 'ESTUCHE':
        return 'est';
      case 'KILOGRAMOS':
        return 'kg';
      case 'LITROS':
        return 'L';
      default:
        return unit;
    }
  }

  /// Build equivalence description: "1 cj = 8 uds" or "U/R: 20"
  String? _buildEquivalence() {
    final p = widget.product;
    if (p == null) return null;

    final parts = <String>[];
    if (p.unitsPerBox > 1) {
      parts.add(
        '1 cj = ${p.unitsPerBox.toStringAsFixed(p.unitsPerBox == p.unitsPerBox.roundToDouble() ? 0 : 1)} uds',
      );
    }
    if (p.unitsRetractil > 0) {
      parts.add(
        'U/R: ${p.unitsRetractil.toStringAsFixed(p.unitsRetractil == p.unitsRetractil.roundToDouble() ? 0 : 1)}',
      );
    }
    return parts.isEmpty ? null : parts.join('  ·  ');
  }

  /// Get stock for the selected unit
  String _stockForUnit(String unit) {
    final p = widget.product;
    if (p == null) return '';

    final envases = p.stockEnvases;

    switch (unit.toUpperCase()) {
      case 'CAJAS':
        return '${_fmtNum(envases)} cj';
      case 'KILOGRAMOS':
      case 'LITROS':
        return '${_fmtNum(p.stockForUnit(unit), decimals: 1)} ${_unitAbbr(unit)}';
      default:
        return '${_fmtNum(p.stockForUnit(unit))} ${_unitAbbr(unit)}';
    }
  }

  /// Get price for the given unit, using override if available.
  /// [widget.initialPrice] is per product.displayUnit.
  String _priceForUnit(String unit) {
    final p = widget.product;
    if (p == null) return '';
    double price;
    final override = widget.initialPrice;
    if (override != null && override > 0) {
      // override is per displayUnit; adapt per requested unit
      if (unit == 'CAJAS') {
        price = override * (p.unitsPerBox > 0 ? p.unitsPerBox : 1);
      } else {
        price = override;
      }
    } else {
      price = p.priceForUnit(unit);
    }
    if (price <= 0) return '';
    return '${price.toStringAsFixed(3)} €/${_unitAbbr(unit)}';
  }

  /// Content description per unit button.
  /// CAJAS: "1 cj = 10 band" – non-CAJAS: "1 band = 0.1 cj"
  String? _subtitleForUnit(String unit) {
    final p = widget.product;
    if (p == null || p.unitsPerBox <= 1) return null;
    final abbr = _unitAbbr(p.displayUnit);
    if (unit == 'CAJAS') {
      final n = p.unitsPerBox;
      final nStr =
          n == n.roundToDouble() ? n.toInt().toString() : n.toStringAsFixed(2);
      return '1 cj = $nStr $abbr';
    }
    // Inverse: how many boxes per 1 unit
    final frac = 1.0 / p.unitsPerBox;
    final fracStr = frac
        .toStringAsFixed(3)
        .replaceAll(RegExp(r'0+$'), '')
        .replaceAll(RegExp(r'\.$'), '');
    return '1 $abbr = $fracStr cj';
  }

  /// Get Neto U/R price if applicable
  String? _netoUR() {
    final p = widget.product;
    if (p == null || p.unitsRetractil <= 0) return null;
    final bestPrice = p.bestPrice;
    if (bestPrice <= 0) return null;
    final netoUr = bestPrice / p.unitsRetractil;
    return 'Neto U/R: ${netoUr.toStringAsFixed(3)} €';
  }

  String _fmtNum(double v, {int decimals = 0}) {
    if (v == v.roundToDouble() && decimals == 0) return v.toInt().toString();
    return v.toStringAsFixed(decimals > 0 ? decimals : 2);
  }

  bool _isWeightUnit(String unit) =>
      unit.toUpperCase() == 'KILOGRAMOS' || unit.toUpperCase() == 'LITROS';

  double _parseQuantity() =>
      double.tryParse(_qtyController.text.replaceAll(',', '.')) ?? 0;

  double _stockValueForUnit(String unit) {
    final p = widget.product;
    if (p == null) return double.infinity;
    final normalized = unit.toUpperCase();
    final raw =
        normalized == 'CAJAS' ? p.stockEnvases : p.stockForUnit(normalized);
    final reserved = widget.qtyAlreadyInCart > 0 ? widget.qtyAlreadyInCart : 0;
    return (raw - reserved).clamp(0, double.infinity);
  }

  void _acceptSelection() {
    final qty = _parseQuantity();
    final stock = _stockValueForUnit(_selectedUnit);

    if (qty <= 0) {
      setState(() {
        _validationMessage = 'Indica una cantidad valida.';
        _showStockActions = false;
      });
      return;
    }

    if (qty > stock) {
      final decimals = _isWeightUnit(_selectedUnit) ? 1 : 0;
      final requestedLabel = _fmtNum(qty, decimals: decimals);
      final stockLabel = _fmtNum(stock, decimals: decimals);
      final unitLabel = _unitAbbr(_selectedUnit);
      setState(() {
        _lastRequestedQty = qty;
        _lastAvailableQty = stock;
        _showStockActions = true;
        _validationMessage =
            'Stock insuficiente: has pedido $requestedLabel $unitLabel y hay $stockLabel $unitLabel.';
      });
      return;
    }

    Navigator.pop(context, {
      'unit': _selectedUnit,
      'quantity': qty,
    });
  }

  void _acceptMaxAvailable() {
    final stock = _stockValueForUnit(_selectedUnit);
    if (stock <= 0) {
      _showAlternatives();
      return;
    }
    Navigator.pop(context, {
      'unit': _selectedUnit,
      'quantity': stock,
      'adjustedToStock': true,
      'requestedQuantity': _lastRequestedQty > 0 ? _lastRequestedQty : stock,
      'availableQuantity': stock,
      'remainingQuantity':
          (_lastRequestedQty - stock) > 0 ? _lastRequestedQty - stock : 0.0,
    });
  }

  void _showAlternatives() {
    final requested =
        _lastRequestedQty > 0 ? _lastRequestedQty : _parseQuantity();
    final available = _lastAvailableQty > 0
        ? _lastAvailableQty
        : _stockValueForUnit(_selectedUnit);
    Navigator.pop(context, {
      'unit': _selectedUnit,
      'quantity': 0.0,
      'outOfStock': true,
      'requestedQuantity': requested,
      'availableQuantity': available,
      'remainingQuantity':
          (requested - available) > 0 ? requested - available : requested,
    });
  }

  Widget _buildStockActions() {
    if (!_showStockActions) return const SizedBox.shrink();
    final canAdjust = _lastAvailableQty > 0;
    final decimals = _isWeightUnit(_selectedUnit) ? 1 : 0;
    final availableValue = _fmtNum(_lastAvailableQty, decimals: decimals);
    final availableLabel = '$availableValue ${_unitAbbr(_selectedUnit)}';
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        children: [
          if (canAdjust) ...[
            Expanded(
              child: SizedBox(
                height: 40,
                child: OutlinedButton.icon(
                  onPressed: _acceptMaxAvailable,
                  icon: const Icon(Icons.tune, size: 16),
                  label: Text(
                    'Usar $availableLabel',
                    overflow: TextOverflow.ellipsis,
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.success,
                    side: const BorderSide(color: AppTheme.success),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
          Expanded(
            child: SizedBox(
              height: 40,
              child: ElevatedButton.icon(
                onPressed: _showAlternatives,
                icon: const Icon(Icons.auto_awesome, size: 16),
                label: const Text(
                  'Alternativas',
                  overflow: TextOverflow.ellipsis,
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.warning,
                  foregroundColor: AppColors.systemBlack,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final equiv = _buildEquivalence();
    final netoUr = _netoUR();

    return Dialog(
      backgroundColor: AppTheme.raisedSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                const Icon(
                  Icons.straighten,
                  color: AppTheme.info,
                  size: 22,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Seleccionar unidad y cantidad',
                    style: TextStyle(
                      color: AppColors.themedWhite,
                      fontWeight: FontWeight.bold,
                      fontSize:
                          Responsive.fontSize(context, small: 15, large: 17),
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: Icon(Icons.close,
                      color: AppColors.themedWhite54, size: 20),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),

            // Product name if available
            if (widget.product != null) ...[
              const SizedBox(height: 8),
              Text(
                widget.product!.name,
                style: TextStyle(color: AppColors.themedWhite70, fontSize: 13),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],

            // Equivalences row
            if (equiv != null || netoUr != null) ...[
              const SizedBox(height: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.info.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                  border:
                      Border.all(color: AppTheme.info.withValues(alpha: 0.2)),
                ),
                child: Row(
                  children: [
                    if (equiv != null)
                      Expanded(
                        child: Text(
                          equiv,
                          style: const TextStyle(
                            color: AppTheme.info,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    if (netoUr != null)
                      Text(
                        netoUr,
                        style: const TextStyle(
                          color: AppTheme.success,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 14),

            // Unit buttons with stock + price info
            ..._units.map((unit) {
              final selected = _selectedUnit == unit;
              final stockStr = _stockForUnit(unit);
              final priceStr = _priceForUnit(unit);
              final subtitle = _subtitleForUnit(unit);

              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Material(
                  color: selected
                      ? AppTheme.info.withValues(alpha: 0.15)
                      : AppTheme.softPanel,
                  borderRadius: BorderRadius.circular(10),
                  child: InkWell(
                    onTap: () => setState(() {
                      _selectedUnit = unit;
                      _validationMessage = null;
                      _showStockActions = false;
                    }),
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color:
                              selected ? AppTheme.info : AppTheme.borderColor,
                          width: selected ? 1.5 : 1,
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            selected
                                ? Icons.radio_button_checked
                                : Icons.radio_button_off,
                            color: selected
                                ? AppTheme.info
                                : AppColors.themedWhite38,
                            size: 20,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _unitLabel(unit),
                                  style: TextStyle(
                                    color: selected
                                        ? AppColors.themedWhite
                                        : AppColors.themedWhite70,
                                    fontWeight: selected
                                        ? FontWeight.bold
                                        : FontWeight.normal,
                                    fontSize: 14,
                                  ),
                                ),
                                if (subtitle != null)
                                  Text(
                                    subtitle,
                                    style: TextStyle(
                                      color: AppColors.themedWhite38,
                                      fontSize: 11,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          if (stockStr.isNotEmpty)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: AppTheme.success.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                stockStr,
                                style: const TextStyle(
                                  color: AppTheme.success,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          if (priceStr.isNotEmpty) ...[
                            const SizedBox(width: 8),
                            Text(
                              priceStr,
                              style: TextStyle(
                                color: AppColors.themedWhite54,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              );
            }),

            const SizedBox(height: 8),

            // Quantity input
            TextField(
              controller: _qtyController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              style: TextStyle(
                color: AppColors.themedWhite,
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
              textAlign: TextAlign.center,
              autofocus: true,
              onChanged: (_) {
                if (_validationMessage != null || _showStockActions) {
                  setState(() {
                    _validationMessage = null;
                    _showStockActions = false;
                  });
                }
              },
              decoration: InputDecoration(
                labelText: 'Cantidad (${_unitLabel(_selectedUnit)})',
                labelStyle:
                    TextStyle(color: AppColors.themedWhite54, fontSize: 13),
                filled: true,
                fillColor: AppTheme.softPanel,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: AppTheme.borderColor),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: AppTheme.borderColor),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide:
                      const BorderSide(color: AppTheme.info, width: 1.5),
                ),
                contentPadding:
                    const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
              ),
            ),
            if (_validationMessage != null) ...[
              const SizedBox(height: 8),
              Text(
                _validationMessage!,
                style: const TextStyle(
                  color: AppTheme.error,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              _buildStockActions(),
            ],
            const SizedBox(height: 16),

            // Action buttons
            Row(
              children: [
                // Clear button
                Expanded(
                  child: SizedBox(
                    height: 46,
                    child: OutlinedButton.icon(
                      onPressed: () {
                        Navigator.pop(context, {
                          'unit': _selectedUnit,
                          'quantity': 0.0,
                          'cleared': true,
                        });
                      },
                      icon: const Icon(Icons.delete_outline, size: 16),
                      label:
                          const Text('LIMPIAR', style: TextStyle(fontSize: 13)),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.error,
                        side: const BorderSide(color: AppTheme.error),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                // Confirm button
                Expanded(
                  flex: 2,
                  child: SizedBox(
                    height: 46,
                    child: ElevatedButton.icon(
                      onPressed: _acceptSelection,
                      icon: const Icon(Icons.check, size: 18),
                      label: const Text(
                        'ACEPTAR',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.info,
                        foregroundColor: AppColors.themedWhite,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
