/// Unit Selector Modal (Premium Dialog)
/// ======================================
/// Centered dialog for selecting unit of measure and quantity.
/// Shows equivalences, stock per unit, and price per unit.

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';

class UnitSelectorModal extends StatefulWidget {
  final String? initialUnit;
  final double? initialQuantity;
  final List<String> availableUnits;
  final Product? product;
  // Override price per displayUnit (from TarifaSelectorModal). null = use product.bestPrice
  final double? initialPrice;

  const UnitSelectorModal({
    Key? key,
    this.initialUnit,
    this.initialQuantity,
    this.availableUnits = const ['CAJAS'],
    this.product,
    this.initialPrice,
  }) : super(key: key);

  /// Show the modal as a centered dialog and return { 'unit': String, 'quantity': double } or null
  static Future<Map<String, dynamic>?> show(
    BuildContext context, {
    String? initialUnit,
    double? initialQuantity,
    List<String>? availableUnits,
    Product? product,
    double? initialPrice,
  }) {
    final units = availableUnits ??
        product?.availableUnits ??
        const ['CAJAS', 'PIEZAS', 'BANDEJAS', 'ESTUCHE', 'KILOGRAMOS'];

    return showDialog<Map<String, dynamic>>(
      context: context,
      barrierColor: Colors.black54,
      builder: (_) => UnitSelectorModal(
        initialUnit: initialUnit,
        initialQuantity: initialQuantity,
        availableUnits: units,
        product: product,
        initialPrice: initialPrice,
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

  @override
  void initState() {
    super.initState();
    _units = widget.availableUnits;
    _selectedUnit = widget.initialUnit ?? (_units.isNotEmpty ? _units.first : 'CAJAS');
    _qtyController.text = widget.initialQuantity?.toStringAsFixed(
      _selectedUnit == 'KILOGRAMOS' || _selectedUnit == 'LITROS' ? 2 : 0,
    ) ?? '1';
  }

  @override
  void dispose() {
    _qtyController.dispose();
    super.dispose();
  }

  String _unitLabel(String unit) {
    switch (unit.toUpperCase()) {
      case 'CAJAS': return 'Cajas';
      case 'UNIDADES': return 'Unidades';
      case 'PIEZAS': return 'Piezas';
      case 'BANDEJAS': return 'Bandejas';
      case 'ESTUCHES': case 'ESTUCHE': return 'Estuches';
      case 'KILOGRAMOS': return 'Kg';
      case 'LITROS': return 'Litros';
      default: return unit;
    }
  }

  String _unitAbbr(String unit) {
    switch (unit.toUpperCase()) {
      case 'CAJAS': return 'cj';
      case 'UNIDADES': return 'uds';
      case 'PIEZAS': return 'pzs';
      case 'BANDEJAS': return 'band';
      case 'ESTUCHES': case 'ESTUCHE': return 'est';
      case 'KILOGRAMOS': return 'kg';
      case 'LITROS': return 'L';
      default: return unit;
    }
  }

  /// Build equivalence description: "1 cj = 8 uds" or "U/R: 20"
  String? _buildEquivalence() {
    final p = widget.product;
    if (p == null) return null;

    final parts = <String>[];
    if (p.unitsPerBox > 1) {
      parts.add('1 cj = ${p.unitsPerBox.toStringAsFixed(p.unitsPerBox == p.unitsPerBox.roundToDouble() ? 0 : 1)} uds');
    }
    if (p.unitsRetractil > 0) {
      parts.add('U/R: ${p.unitsRetractil.toStringAsFixed(p.unitsRetractil == p.unitsRetractil.roundToDouble() ? 0 : 1)}');
    }
    return parts.isEmpty ? null : parts.join('  ·  ');
  }

  /// Get stock for the selected unit
  String _stockForUnit(String unit) {
    final p = widget.product;
    if (p == null) return '';

    final envases = p.stockEnvases;
    final unidades = p.stockUnidades;

    switch (unit.toUpperCase()) {
      case 'CAJAS':
        return '${_fmtNum(envases)} cj';
      case 'KILOGRAMOS':
      case 'LITROS':
        return '${_fmtNum(unidades, decimals: 2)} ${_unitAbbr(unit)}';
      default:
        return '${_fmtNum(unidades)} ${_unitAbbr(unit)}';
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
  /// CAJAS: "1 cj = 10 band" — non-CAJAS: "1 band = 0.1 cj"
  String? _subtitleForUnit(String unit) {
    final p = widget.product;
    if (p == null || p.unitsPerBox <= 1) return null;
    final abbr = _unitAbbr(p.displayUnit);
    if (unit == 'CAJAS') {
      final n = p.unitsPerBox;
      final nStr = n == n.roundToDouble()
          ? n.toInt().toString()
          : n.toStringAsFixed(2);
      return '1 cj = $nStr $abbr';
    }
    // Inverse: how many boxes per 1 unit
    final frac = 1.0 / p.unitsPerBox;
    final fracStr = frac.toStringAsFixed(3).replaceAll(RegExp(r'0+$'), '').replaceAll(RegExp(r'\.$'), '');
    return '1 $abbr = $fracStr cj';
  }

  /// Get Neto U/R price if applicable
  String? _netoUR() {
    final p = widget.product;
    if (p == null || p.unitsRetractil <= 0) return null;
    final bestPrice = p.precioTarifa1 > 0 ? p.precioTarifa1 : p.precioMinimo;
    if (bestPrice <= 0) return null;
    final netoUr = bestPrice / p.unitsRetractil;
    return 'Neto U/R: ${netoUr.toStringAsFixed(3)} €';
  }

  String _fmtNum(double v, {int decimals = 0}) {
    if (v == v.roundToDouble() && decimals == 0) return v.toInt().toString();
    return v.toStringAsFixed(decimals > 0 ? decimals : 2);
  }

  @override
  Widget build(BuildContext context) {
    final equiv = _buildEquivalence();
    final netoUr = _netoUR();

    return Dialog(
      backgroundColor: AppTheme.darkSurface,
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
                const Icon(Icons.straighten, color: AppTheme.neonBlue, size: 22),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Seleccionar unidad y cantidad',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: Responsive.fontSize(context, small: 15, large: 17),
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close, color: Colors.white54, size: 20),
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
                style: const TextStyle(color: Colors.white70, fontSize: 13),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],

            // Equivalences row
            if (equiv != null || netoUr != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.neonBlue.withOpacity(0.2)),
                ),
                child: Row(
                  children: [
                    if (equiv != null)
                      Expanded(
                        child: Text(equiv, style: const TextStyle(color: AppTheme.neonBlue, fontSize: 12, fontWeight: FontWeight.w500)),
                      ),
                    if (netoUr != null)
                      Text(netoUr, style: const TextStyle(color: AppTheme.neonGreen, fontSize: 12, fontWeight: FontWeight.w600)),
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
                      ? AppTheme.neonBlue.withValues(alpha: 0.15)
                      : AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(10),
                  child: InkWell(
                    onTap: () => setState(() => _selectedUnit = unit),
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: selected
                              ? AppTheme.neonBlue
                              : AppTheme.borderColor,
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
                                ? AppTheme.neonBlue
                                : Colors.white38,
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
                                        ? Colors.white
                                        : Colors.white70,
                                    fontWeight: selected
                                        ? FontWeight.bold
                                        : FontWeight.normal,
                                    fontSize: 14,
                                  ),
                                ),
                                if (subtitle != null)
                                  Text(
                                    subtitle,
                                    style: const TextStyle(
                                      color: Colors.white38,
                                      fontSize: 11,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          if (stockStr.isNotEmpty)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppTheme.neonGreen
                                    .withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                stockStr,
                                style: const TextStyle(
                                    color: AppTheme.neonGreen,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600),
                              ),
                            ),
                          if (priceStr.isNotEmpty) ...[
                            const SizedBox(width: 8),
                            Text(
                              priceStr,
                              style: const TextStyle(
                                  color: Colors.white54, fontSize: 11),
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
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
              autofocus: true,
              decoration: InputDecoration(
                labelText: 'Cantidad (${_unitLabel(_selectedUnit)})',
                labelStyle: const TextStyle(color: Colors.white54, fontSize: 13),
                filled: true,
                fillColor: AppTheme.darkCard,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppTheme.borderColor),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppTheme.borderColor),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppTheme.neonBlue, width: 1.5),
                ),
                contentPadding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
              ),
            ),
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
                      label: const Text('LIMPIAR', style: TextStyle(fontSize: 13)),
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
                      onPressed: () {
                        final qty = double.tryParse(_qtyController.text.replaceAll(',', '.')) ?? 0;
                        Navigator.pop(context, {
                          'unit': _selectedUnit,
                          'quantity': qty,
                        });
                      },
                      icon: const Icon(Icons.check, size: 18),
                      label: const Text('ACEPTAR', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.neonBlue,
                        foregroundColor: AppTheme.darkBase,
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
