import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/zebra_print_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_products.dart';
import 'package:signature/signature.dart';

Future<void> showRuteroPrintPreviewDialog({
  required BuildContext context,
  required AlbaranEntrega albaran,
  required List<EntregaItem> items,
  required String observaciones,
  required String receptorNombre,
  required String receptorDni,
  SignatureController? signatureController,
  String? printerName,
  String? printerProtocol,
  Map<String, double>? deliveredQuantities,
  Future<bool> Function()? onEnsurePrinter,
  VoidCallback? onPrinted,
}) {
  return showDialog<void>(
    context: context,
    barrierDismissible: true,
    builder: (ctx) => RuteroPrintPreviewDialog(
      albaran: albaran,
      items: items,
      observaciones: observaciones,
      receptorNombre: receptorNombre,
      receptorDni: receptorDni,
      signatureController: signatureController,
      printerName: printerName,
      printerProtocol: printerProtocol,
      deliveredQuantities: deliveredQuantities,
      onEnsurePrinter: onEnsurePrinter,
      onPrinted: onPrinted,
    ),
  );
}

class RuteroPrintPreviewDialog extends StatefulWidget {
  const RuteroPrintPreviewDialog({
    required this.albaran,
    required this.items,
    required this.observaciones,
    required this.receptorNombre,
    required this.receptorDni,
    this.signatureController,
    this.printerName,
    this.printerProtocol,
    this.deliveredQuantities,
    this.onEnsurePrinter,
    this.onPrinted,
    super.key,
  });

  final AlbaranEntrega albaran;
  final List<EntregaItem> items;
  final String observaciones;
  final String receptorNombre;
  final String receptorDni;
  final SignatureController? signatureController;
  final String? printerName;
  final String? printerProtocol;
  final Map<String, double>? deliveredQuantities;
  final Future<bool> Function()? onEnsurePrinter;
  final VoidCallback? onPrinted;

  @override
  State<RuteroPrintPreviewDialog> createState() =>
      _RuteroPrintPreviewDialogState();
}

class _RuteroPrintPreviewDialogState extends State<RuteroPrintPreviewDialog> {
  late final TextEditingController _obsController;
  bool _isPrinting = false;
  String? _error;
  String? _signatureGrf;

  @override
  void initState() {
    super.initState();
    _obsController = TextEditingController(text: widget.observaciones);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _prepareSignature();
    });
  }

  @override
  void dispose() {
    _obsController.dispose();
    super.dispose();
  }

  Future<void> _prepareSignature() async {
    final controller = widget.signatureController;
    if (controller == null || controller.isEmpty) return;
    try {
      final png = await controller.toPngBytes().timeout(
            const Duration(seconds: 3),
          );
      if (png == null || !mounted) return;
      final grf = await ZebraPrintService.convertSignatureToGrf(
        png,
        maxWidth: 280,
      );
      if (!mounted) return;
      setState(() => _signatureGrf = grf);
    } catch (_) {
      // Ticket still prints without the signature graphic.
    }
  }

  String get _protocolLabel {
    final protocol = (widget.printerProtocol ?? 'zpl').toLowerCase();
    return protocol == 'escpos' ? 'ESC/POS' : 'ZPL';
  }

  String _formatQuantity(num value) {
    final fixed = value.toDouble().toStringAsFixed(3);
    return fixed.replaceFirst(RegExp(r'\.?0+$'), '');
  }

  double _deliveredQty(EntregaItem item) {
    return widget.deliveredQuantities?[ruteroLineKey(item)] ??
        item.cantidadPedida.toDouble();
  }

  double _lineAmount(EntregaItem item) {
    return ruteroLineDeliveredAmount(
      item: item,
      deliveredQty: _deliveredQty(item),
    );
  }

  double get _liveTotal {
    final live = widget.items.fold<double>(
      0,
      (sum, item) => sum + _lineAmount(item),
    );
    return live > 0.004 ? live : widget.albaran.importeTotal;
  }

  Future<void> _print() async {
    if (_isPrinting) return;
    setState(() {
      _isPrinting = true;
      _error = null;
    });

    try {
      if (widget.onEnsurePrinter != null) {
        final ready = await widget.onEnsurePrinter!();
        if (!ready) {
          if (!mounted) return;
          setState(() {
            _isPrinting = false;
            _error =
                'Selecciona una impresora Bluetooth antes de imprimir el ticket.';
          });
          return;
        }
      }

      final albaranLabel = widget.albaran.erpDocumentLabel;

      final layout = await ZebraPrintService.resolveLayout(
        printerName: widget.printerName,
      );
      final logo = await ZebraPrintService.loadCompanyLogoGrf(
        maxWidth: layout.logoMaxWidth,
        maxHeight: layout.logoMaxHeight,
      );

      for (final item in widget.items) {
        item.cantidadEntregada = _deliveredQty(item);
      }
      final zpl = ZebraPrintService.generateDeliveryZpl(
        albaran: widget.albaran,
        items: widget.items,
        observaciones: _obsController.text.trim(),
        receptorNombre: widget.receptorNombre,
        receptorDni: widget.receptorDni,
        signatureGrf: _signatureGrf,
        fechaFirma: DateTime.now(),
        layout: layout,
        logoGrf: logo,
      );
      final escPos = ZebraPrintService.generateEscPosTicket(
        clientName: widget.albaran.nombreCliente,
        albaranLabel: albaranLabel,
        lines: widget.items
            .map(
              (item) => <String, dynamic>{
                'desc': item.descripcion,
                'qty': _deliveredQty(item),
                'importe': _lineAmount(item),
              },
            )
            .toList(),
        total: _liveTotal,
      );

      final result = await ZebraPrintService.printTicket(
        zpl: zpl,
        escPosBytes: escPos,
      );
      if (!mounted) return;
      if (result.ok) {
        final onPrinted = widget.onPrinted;
        Navigator.pop(context);
        onPrinted?.call();
        return;
      }
      setState(() {
        _isPrinting = false;
        _error = result.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isPrinting = false;
        _error =
            'No se pudo imprimir. Comprueba Bluetooth y que la impresora esté encendida.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final printerLabel = widget.printerName?.trim();
    return AlertDialog(
      backgroundColor: AppTheme.raisedSurface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        side: BorderSide(color: AppTheme.info.withValues(alpha: 0.28)),
      ),
      title: Row(
        children: [
          RepartidorExecutiveIcon(
            icon: Icons.print,
            color: AppTheme.info,
          ),
          SizedBox(width: 12),
          Expanded(
            child: Text(
              'Imprimir ticket',
              style: TextStyle(color: AppTheme.textPrimary),
            ),
          ),
        ],
      ),
      content: SizedBox(
        width: double.maxFinite,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (printerLabel != null && printerLabel.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    '$printerLabel · $_protocolLabel',
                    style: TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 12,
                    ),
                  ),
                ),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.softPanel,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Granja Mari Pepa S.L.',
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      widget.albaran.erpDocumentLabel,
                      style: const TextStyle(
                        color: AppTheme.info,
                        fontSize: 14,
                      ),
                    ),
                    Text(
                      'Fecha: ${widget.albaran.fecha}',
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 13,
                      ),
                    ),
                    Divider(color: AppTheme.textTertiary),
                    Text(
                      'Cliente: ${widget.albaran.nombreCliente}',
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...widget.items.take(5).map(
                          (item) => Padding(
                            padding: const EdgeInsets.only(bottom: 2),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    item.descripcion,
                                    style: TextStyle(
                                      color: AppTheme.textSecondary,
                                      fontSize: 12,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Text(
                                  'x${_formatQuantity(_deliveredQty(item))}'
                                  '${(item.unit ?? '').trim().isEmpty ? '' : ' ${item.unit}'}  '
                                  '${_lineAmount(item).toStringAsFixed(2)}€',
                                  style: TextStyle(
                                    color: AppTheme.textSecondary,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                    if (widget.items.length > 5)
                      Text(
                        '... +${widget.items.length - 5} más',
                        style: TextStyle(
                          color: AppTheme.textTertiary,
                          fontSize: 11,
                        ),
                      ),
                    Divider(color: AppTheme.textTertiary),
                    Text(
                      'TOTAL: ${_liveTotal.toStringAsFixed(2)} €',
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Observaciones (editable):',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _obsController,
                enabled: !_isPrinting,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: 'Añadir observaciones para el ticket...',
                  hintStyle: TextStyle(color: AppTheme.textTertiary),
                  filled: true,
                  fillColor: AppTheme.softPanel,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: AppTheme.info),
                  ),
                ),
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 14,
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppTheme.error.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: AppTheme.error.withValues(alpha: 0.7),
                    ),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(
                      color: AppTheme.error,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      height: 1.3,
                    ),
                  ),
                ),
              ],
              if (_isPrinting) ...[
                const SizedBox(height: 12),
                Text(
                  'Enviando a la impresora. Puede tardar unos 30 segundos '
                  'si está despertando. Si no responde, cancela y vuelve '
                  'a intentar.',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(
            _isPrinting ? 'Cancelar' : 'Omitir',
            style: TextStyle(color: AppTheme.textTertiary),
          ),
        ),
        ElevatedButton.icon(
          onPressed: _isPrinting ? null : _print,
          icon: _isPrinting
              ? SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.themedWhite,
                  ),
                )
              : const Icon(Icons.print),
          label: Text(_isPrinting ? 'Imprimiendo...' : 'Imprimir ticket'),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppTheme.info,
            foregroundColor: AppColors.themedWhite,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
          ),
        ),
      ],
    );
  }
}
