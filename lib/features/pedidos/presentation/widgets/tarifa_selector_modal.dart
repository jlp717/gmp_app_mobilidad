/// Tarifa Selector Modal
/// ======================
/// Orange popup to select pricing tariff per order line.
/// Shows PT (client tariff), PU (per-unit breakdown), and all other tariffs.
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

class TarifaSelectorModal extends StatefulWidget {
  const TarifaSelectorModal({
    required this.product,
    required this.tariffs,
    required this.codigoTarifaCliente,
    super.key,
    this.initialPrice,
    this.onTariffSelected,
  });
  final Product product;
  final List<TariffEntry> tariffs;
  final int codigoTarifaCliente;
  final double? initialPrice;
  final ValueChanged<int?>? onTariffSelected;

  /// Show the modal and return the selected price per unit, or null if cancelled.
  static Future<double?> show(
    BuildContext context, {
    required Product product,
    required List<TariffEntry> tariffs,
    required int codigoTarifaCliente,
    double? initialPrice,
    ValueChanged<int?>? onTariffSelected,
  }) {
    return showDialog<double>(
      context: context,
      barrierColor: AppColors.systemBlack54,
      builder: (_) => TarifaSelectorModal(
        product: product,
        tariffs: tariffs,
        codigoTarifaCliente: codigoTarifaCliente,
        initialPrice: initialPrice,
        onTariffSelected: onTariffSelected,
      ),
    );
  }

  @override
  State<TarifaSelectorModal> createState() => _TarifaSelectorModalState();
}

// Internal selection marker – PT, PU, or numeric tariff code as string
const _kPT = '__PT__';
const _kPU = '__PU__';

class _TarifaSelectorModalState extends State<TarifaSelectorModal> {
  late String _selected;

  TariffEntry? get _clientTariff =>
      widget.tariffs.cast<TariffEntry?>().firstWhere(
            (t) => t!.code == widget.codigoTarifaCliente,
            orElse: () => null,
          );

  bool get _showPU => widget.product.unitsPerBox > 1 && _clientTariff != null;

  @override
  void initState() {
    super.initState();
    // Default selection: PT if available, else first tariff
    _selected = _initialSelection();
  }

  String _initialSelection() {
    final initialPrice = widget.initialPrice;
    if (initialPrice != null) {
      final matching = widget.tariffs
          .where(
            (tariff) => (tariff.precioUnitario - initialPrice).abs() < 0.0005,
          )
          .toList(growable: false);
      for (final tariff in matching) {
        if (tariff.code == widget.codigoTarifaCliente) return _kPT;
      }
      if (matching.length == 1) return matching.single.code.toString();
    }
    return _clientTariff != null ? _kPT : _firstSelection();
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

  int? _tariffCodeForSelection(String sel) {
    if (sel == _kPT || sel == _kPU) return _clientTariff?.code;
    return int.tryParse(sel);
  }

  void _acceptSelection() {
    widget.onTariffSelected?.call(_tariffCodeForSelection(_selected));
    Navigator.pop(context, _priceForSelection(_selected));
  }

  String _unitAbbr(String unit) {
    switch (unit.toUpperCase()) {
      case 'CAJAS':
        return 'cj';
      case 'KILOGRAMOS':
        return 'kg';
      case 'LITROS':
        return 'L';
      case 'BANDEJAS':
        return 'band';
      case 'ESTUCHES':
      case 'ESTUCHE':
        return 'est';
      case 'BOLSAS':
      case 'BOLSA':
        return 'bol';
      case 'UNIDADES':
        return 'uds';
      case 'PIEZAS':
        return 'pzs';
      default:
        return unit.toLowerCase();
    }
  }

  String _fmt(double v, {int dec = 3}) => v.toStringAsFixed(dec);

  Widget _buildRow({
    required String selKey,
    required String label,
    required String priceLabel,
    String? supportingLabel,
    bool isClientTariff = false,
  }) {
    final selected = _selected == selKey;
    const orange = AppTheme.warning;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(
        button: true,
        selected: selected,
        label: '$label. $priceLabel${selected ? '. Seleccionada' : ''}',
        child: Material(
          color: isClientTariff && selected
              ? orange.withValues(alpha: 0.18)
              : selected
                  ? orange.withValues(alpha: 0.1)
                  : AppTheme.softPanel,
          borderRadius: BorderRadius.circular(10),
          child: InkWell(
            onTap: () => setState(() => _selected = selKey),
            borderRadius: BorderRadius.circular(10),
            child: Container(
              constraints: const BoxConstraints(minHeight: 56),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: selected ? orange : AppTheme.borderColor,
                  width: selected ? 2 : 1,
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    selected ? Icons.check_circle : Icons.circle_outlined,
                    color: selected ? orange : AppColors.themedWhite54,
                    size: 26,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          label,
                          style: TextStyle(
                            color: selected
                                ? AppColors.themedWhite
                                : AppColors.themedWhite70,
                            fontSize: 18,
                            fontWeight:
                                selected ? FontWeight.bold : FontWeight.w600,
                          ),
                        ),
                        if (supportingLabel != null &&
                            supportingLabel.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            supportingLabel,
                            style: TextStyle(
                              color: AppColors.themedWhite60,
                              fontSize: 16,
                            ),
                          ),
                        ],
                        const SizedBox(height: 4),
                        Text(
                          priceLabel,
                          style: TextStyle(
                            color: selected ? orange : AppColors.themedWhite70,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        if (selected)
                          const Padding(
                            padding: EdgeInsets.only(top: 2),
                            child: Text(
                              'Seleccionada',
                              style: TextStyle(
                                color: orange,
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
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
    const orange = AppTheme.warning;
    final unitAbbr = _unitAbbr(p.displayUnit);
    final hasTariffs = widget.tariffs.isNotEmpty;

    return Dialog(
      backgroundColor: AppTheme.raisedSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      insetPadding: EdgeInsets.symmetric(
        horizontal: Responsive.useCompactTiles(context) ? 16 : 24,
        vertical: Responsive.useCompactTiles(context) ? 16 : 40,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height - 32,
        ),
        child: SingleChildScrollView(
          padding:
              EdgeInsets.all(Responsive.useCompactTiles(context) ? 12 : 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                children: [
                  const Icon(Icons.euro_rounded, color: orange, size: 22),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Precio',
                      style: TextStyle(
                        color: AppColors.themedWhite,
                        fontWeight: FontWeight.bold,
                        fontSize: 20,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: Icon(Icons.close,
                        color: AppColors.themedWhite70, size: 26),
                    tooltip: 'Cerrar selector de tarifa',
                    constraints:
                        const BoxConstraints(minWidth: 56, minHeight: 56),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                p.name,
                style: TextStyle(color: AppColors.themedWhite70, fontSize: 18),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              SizedBox(height: Responsive.useCompactTiles(context) ? 8 : 14),

              if (!hasTariffs) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppTheme.softPanel,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppTheme.borderColor),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.info_outline,
                          color: AppColors.themedWhite54, size: 24),
                      const SizedBox(width: 8),
                      Text(
                        'Sin tarifa disponible',
                        style: TextStyle(
                            color: AppColors.themedWhite70, fontSize: 18),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
              ],

              // PT row – client's assigned tariff
              if (ct != null)
                _buildRow(
                  selKey: _kPT,
                  isClientTariff: true,
                  label: 'Tarifa del cliente',
                  supportingLabel: ct.description,
                  priceLabel: p.unitsPerBox > 1
                      ? '${_fmt(ct.price)} €/caja · ${_fmt(ct.precioUnitario)} €/$unitAbbr'
                      : '${_fmt(ct.price)} €/$unitAbbr',
                ),

              // PU row – per-unit breakdown of PT
              if (_showPU && ct != null)
                _buildRow(
                  selKey: _kPU,
                  label: 'Precio por unidad',
                  supportingLabel: 'Desglose de la tarifa del cliente',
                  priceLabel: '${_fmt(ct.precioUnitario)} €/$unitAbbr',
                ),

              // Other tariffs
              ...widget.tariffs
                  .where((t) => t.code != widget.codigoTarifaCliente)
                  .map((t) {
                final key = t.code.toString();
                return _buildRow(
                  selKey: key,
                  label: 'Tarifa ${t.code}',
                  supportingLabel: t.description,
                  priceLabel: p.unitsPerBox > 1
                      ? '${_fmt(t.price)} €/caja · ${_fmt(t.precioUnitario)} €/$unitAbbr'
                      : '${_fmt(t.price)} €/$unitAbbr',
                );
              }),

              const SizedBox(height: 8),

              // Cancel button
              SizedBox(
                width: double.infinity,
                height: 56,
                child: OutlinedButton(
                  key: const Key('tarifa_cancel_button'),
                  onPressed: () => Navigator.pop(context),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.themedWhite54,
                    side: BorderSide(color: AppTheme.borderColor),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  child: const Text('CANCELAR', style: TextStyle(fontSize: 18)),
                ),
              ),

              if (hasTariffs) ...[
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  height: 56,
                  child: ElevatedButton.icon(
                    key: const Key('tarifa_accept_button'),
                    onPressed: _acceptSelection,
                    icon: const Icon(Icons.check, size: 24),
                    label: Text(
                      'ACEPTAR  ${_fmt(_priceForSelection(_selected))} €/${_unitAbbr(p.displayUnit)}',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.warning,
                      foregroundColor: AppColors.themedWhite,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
