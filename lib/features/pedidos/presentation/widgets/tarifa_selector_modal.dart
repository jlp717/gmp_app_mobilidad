/// Tarifa Selector Modal
/// ======================
/// Orange popup to select pricing tariff per order line.
/// Shows PT (client tariff), PU (per-unit breakdown), and all other tariffs.

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';

class TarifaSelectorModal extends StatefulWidget {
  final Product product;
  final List<TariffEntry> tariffs;
  final int codigoTarifaCliente;
  final double? initialPrice;

  const TarifaSelectorModal({
    Key? key,
    required this.product,
    required this.tariffs,
    required this.codigoTarifaCliente,
    this.initialPrice,
  }) : super(key: key);

  /// Show the modal and return the selected price per unit, or null if cancelled.
  static Future<double?> show(
    BuildContext context, {
    required Product product,
    required List<TariffEntry> tariffs,
    required int codigoTarifaCliente,
    double? initialPrice,
  }) {
    return showDialog<double>(
      context: context,
      barrierColor: Colors.black54,
      builder: (_) => TarifaSelectorModal(
        product: product,
        tariffs: tariffs,
        codigoTarifaCliente: codigoTarifaCliente,
        initialPrice: initialPrice,
      ),
    );
  }

  @override
  State<TarifaSelectorModal> createState() => _TarifaSelectorModalState();
}

// Internal selection marker — PT, PU, or numeric tariff code as string
const _kPT = '__PT__';
const _kPU = '__PU__';

class _TarifaSelectorModalState extends State<TarifaSelectorModal> {
  late String _selected;

  TariffEntry? get _clientTariff =>
      widget.tariffs.cast<TariffEntry?>().firstWhere(
            (t) => t!.code == widget.codigoTarifaCliente,
            orElse: () => null,
          );

  bool get _showPU =>
      widget.product.unitsPerBox > 1 && _clientTariff != null;

  @override
  void initState() {
    super.initState();
    // Default selection: PT if available, else first tariff
    _selected = _clientTariff != null ? _kPT : _firstSelection();
  }

  String _firstSelection() {
    if (widget.tariffs.isNotEmpty) {
      return widget.tariffs.first.code.toString();
    }
    return _kPT;
  }

  double _priceForSelection(String sel) {
    final ct = _clientTariff;
    if (sel == _kPT || sel == _kPU) {
      return ct?.precioUnitario ?? 0;
    }
    final code = int.tryParse(sel);
    final t = widget.tariffs.cast<TariffEntry?>().firstWhere(
          (t) => t!.code == code,
          orElse: () => null,
        );
    return t?.precioUnitario ?? 0;
  }

  String _unitAbbr(String unit) {
    switch (unit.toUpperCase()) {
      case 'CAJAS': return 'cj';
      case 'KILOGRAMOS': return 'kg';
      case 'LITROS': return 'L';
      case 'BANDEJAS': return 'band';
      case 'ESTUCHES': case 'ESTUCHE': return 'est';
      case 'BOLSAS': case 'BOLSA': return 'bol';
      case 'UNIDADES': return 'uds';
      case 'PIEZAS': return 'pzs';
      default: return unit.toLowerCase();
    }
  }

  String _fmt(double v, {int dec = 3}) => v.toStringAsFixed(dec);

  Widget _buildRow({
    required String selKey,
    required Widget leading,
    required Widget content,
    bool isClientTariff = false,
  }) {
    final selected = _selected == selKey;
    final orange = AppTheme.warning;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: isClientTariff && selected
            ? orange.withOpacity(0.18)
            : selected
                ? orange.withOpacity(0.1)
                : AppTheme.darkCard,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: () => setState(() => _selected = selKey),
          borderRadius: BorderRadius.circular(10),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: selected ? orange : AppTheme.borderColor,
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Row(
              children: [
                leading,
                const SizedBox(width: 10),
                Expanded(child: content),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.product;
    final ct = _clientTariff;
    final orange = AppTheme.warning;
    final unitAbbr = _unitAbbr(p.displayUnit);
    final hasTariffs = widget.tariffs.isNotEmpty;

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
                Icon(Icons.euro_rounded, color: orange, size: 22),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Precio',
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
            const SizedBox(height: 4),
            Text(
              p.name,
              style: const TextStyle(color: Colors.white70, fontSize: 13),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 14),

            if (!hasTariffs) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppTheme.borderColor),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline, color: Colors.white38, size: 18),
                    SizedBox(width: 8),
                    Text('Sin tarifa disponible', style: TextStyle(color: Colors.white54, fontSize: 13)),
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ],

            // PT row — client's assigned tariff
            if (ct != null)
              _buildRow(
                selKey: _kPT,
                isClientTariff: true,
                leading: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      _selected == _kPT
                          ? Icons.play_arrow
                          : Icons.play_arrow_outlined,
                      color: orange,
                      size: 18,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'PT',
                      style: TextStyle(
                        color: orange,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
                content: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _abbreviate(ct.description),
                            style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            '${_fmt(ct.price)} €/cj',
                            style: TextStyle(color: orange, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    if (p.unitsPerBox > 1)
                      Text(
                        '(${_fmt(ct.precioUnitario)} €/$unitAbbr)',
                        style: TextStyle(color: orange.withOpacity(0.75), fontSize: 11),
                      ),
                  ],
                ),
              ),

            // PU row — per-unit breakdown of PT
            if (_showPU && ct != null)
              _buildRow(
                selKey: _kPU,
                leading: Text(
                  'PU',
                  style: TextStyle(
                    color: _selected == _kPU ? orange : Colors.white54,
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
                content: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'por unidad',
                        style: const TextStyle(color: Colors.white60, fontSize: 12),
                      ),
                    ),
                    Text(
                      '${_fmt(ct.precioUnitario)} €/$unitAbbr',
                      style: TextStyle(
                        color: _selected == _kPU ? orange : Colors.white54,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),

            // Other tariffs
            ...widget.tariffs
                .where((t) => t.code != widget.codigoTarifaCliente)
                .map((t) {
              final key = t.code.toString();
              return _buildRow(
                selKey: key,
                leading: Text(
                  '${t.code}',
                  style: TextStyle(
                    color: _selected == key ? orange : Colors.white54,
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
                content: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _abbreviate(t.description),
                            style: const TextStyle(color: Colors.white70, fontSize: 12),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            '${_fmt(t.price)} €/cj',
                            style: const TextStyle(color: Colors.white54, fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    if (p.unitsPerBox > 1)
                      Text(
                        '(${_fmt(t.precioUnitario)} €/$unitAbbr)',
                        style: const TextStyle(color: Colors.white38, fontSize: 11),
                      ),
                  ],
                ),
              );
            }),

            const SizedBox(height: 8),

            // Cancel button
            SizedBox(
              width: double.infinity,
              height: 44,
              child: OutlinedButton(
                onPressed: () => Navigator.pop(context),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white54,
                  side: const BorderSide(color: AppTheme.borderColor),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                child: const Text('CANCELAR', style: TextStyle(fontSize: 13)),
              ),
            ),

            if (hasTariffs) ...[
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                height: 46,
                child: ElevatedButton.icon(
                  onPressed: () => Navigator.pop(context, _priceForSelection(_selected)),
                  icon: const Icon(Icons.check, size: 18),
                  label: Text(
                    'ACEPTAR  ${_fmt(_priceForSelection(_selected))} €/${_unitAbbr(p.displayUnit)}',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.warning,
                    foregroundColor: AppTheme.darkBase,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  static String _abbreviate(String s) {
    if (s.length <= 20) return s;
    return '${s.substring(0, 18)}…';
  }
}
