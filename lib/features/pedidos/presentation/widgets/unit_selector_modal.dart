/// Unit Selector Modal
/// ====================
/// Bottom sheet for selecting unit of measure and quantity

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

class UnitSelectorModal extends StatefulWidget {
  final String? initialUnit;
  final double? initialQuantity;
  final List<String> availableUnits; // Add this parameter

  const UnitSelectorModal({
    Key? key,
    this.initialUnit,
    this.initialQuantity,
    this.availableUnits = const ['CAJAS', 'PIEZAS', 'BANDEJAS', 'ESTUCHE', 'KILOGRAMOS'],
  }) : super(key: key);

  /// Show the modal and return { 'unit': String, 'quantity': double } or null
  static Future<Map<String, dynamic>?> show(
    BuildContext context, {
    String? initialUnit,
    double? initialQuantity,
    List<String> availableUnits = const ['CAJAS', 'PIEZAS', 'BANDEJAS', 'ESTUCHE', 'KILOGRAMOS'],
  }) {
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => UnitSelectorModal(
        initialUnit: initialUnit,
        initialQuantity: initialQuantity,
        availableUnits: availableUnits,
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
    _qtyController.text =
        widget.initialQuantity?.toStringAsFixed(0) ?? '1';
  }

  @override
  void dispose() {
    _qtyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Handle
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.white24,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Seleccionar unidad',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: Responsive.fontSize(context, small: 16, large: 18),
            ),
          ),
          const SizedBox(height: 16),
          // Unit buttons grid
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: _units.map((unit) {
              final selected = _selectedUnit == unit;
              return SizedBox(
                width: (MediaQuery.of(context).size.width - 70) / 2,
                height: 48,
                child: ElevatedButton(
                  onPressed: () => setState(() => _selectedUnit = unit),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: selected
                        ? AppTheme.neonBlue.withOpacity(0.2)
                        : AppTheme.darkCard,
                    foregroundColor:
                        selected ? AppTheme.neonBlue : Colors.white70,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: BorderSide(
                        color: selected
                            ? AppTheme.neonBlue
                            : AppTheme.borderColor,
                        width: selected ? 1.5 : 1,
                      ),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    unit,
                    style: TextStyle(
                      fontWeight:
                          selected ? FontWeight.bold : FontWeight.normal,
                      fontSize: Responsive.fontSize(context,
                          small: 13, large: 14),
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 16),
          // Quantity input
          TextField(
            controller: _qtyController,
            keyboardType:
                const TextInputType.numberWithOptions(decimal: true),
            style: const TextStyle(color: Colors.white, fontSize: 18),
            textAlign: TextAlign.center,
            decoration: InputDecoration(
              labelText: 'Cantidad',
              labelStyle: const TextStyle(color: Colors.white54),
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
                borderSide: const BorderSide(color: AppTheme.neonBlue),
              ),
            ),
          ),
          const SizedBox(height: 16),
          // Action buttons
          Row(
            children: [
              // Clear button
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: OutlinedButton.icon(
                    onPressed: () {
                      Navigator.pop(context, {
                        'unit': _selectedUnit,
                        'quantity': 0.0,
                        'cleared': true,
                      });
                    },
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: const Text('LIMPIAR CANTIDAD'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.error,
                      side: const BorderSide(color: AppTheme.error),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // Confirm button
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: ElevatedButton.icon(
                    onPressed: () {
                      final qty =
                          double.tryParse(_qtyController.text) ?? 0;
                      Navigator.pop(context, {
                        'unit': _selectedUnit,
                        'quantity': qty,
                      });
                    },
                    icon: const Icon(Icons.check, size: 18),
                    label: const Text('ACEPTAR'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.neonBlue,
                      foregroundColor: AppTheme.darkBase,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
