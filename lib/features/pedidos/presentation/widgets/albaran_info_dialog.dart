/// Albaran Info Dialog
/// ===================
/// Shows linked delivery notes (albaranes) for an order
library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/pdf_preview_screen.dart';
import 'package:gmp_app_mobilidad/features/facturas/data/facturas_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';

class AlbaranInfoDialog {
  static Future<void> show(
    BuildContext context, {
    required int orderId,
  }) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => _AlbaranInfoBody(orderId: orderId),
    );
  }
}

class _AlbaranInfoBody extends StatefulWidget {
  const _AlbaranInfoBody({required this.orderId});

  final int orderId;

  @override
  State<_AlbaranInfoBody> createState() => _AlbaranInfoBodyState();
}

class _AlbaranInfoBodyState extends State<_AlbaranInfoBody> {
  List<Map<String, dynamic>> _albaranes = [];
  bool _isLoading = true;
  String? _error;
  bool _isOpeningFactura = false;
  bool _isOpeningAlbaran = false;

  int _asInt(dynamic value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  @override
  void initState() {
    super.initState();
    _loadAlbaranes();
  }

  Future<void> _openFactura(Map<String, dynamic> albaran) async {
    final serie = (albaran['serieFactura'] ?? '').toString().trim();
    final numero = _asInt(albaran['numeroFactura']);
    final ejercicio = _asInt(albaran['ejercicioFactura']);
    if (serie.isEmpty || numero <= 0 || ejercicio <= 0) return;

    setState(() => _isOpeningFactura = true);
    try {
      final bytes = await FacturasService.downloadFacturaPdfBytes(
        serie,
        numero,
        ejercicio,
      );
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PdfPreviewScreen(
            pdfBytes: Uint8List.fromList(bytes),
            title: 'Factura $serie-$numero',
            fileName: 'Factura_${serie}_${numero}_$ejercicio.pdf',
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('No se pudo abrir la factura: $e'),
          backgroundColor: AppTheme.error,
        ),
      );
    } finally {
      if (mounted) setState(() => _isOpeningFactura = false);
    }
  }

  Future<void> _openAlbaran(Map<String, dynamic> albaran) async {
    final serie = (albaran['serie'] ?? '').toString().trim();
    final numero = _asInt(albaran['numeroAlbaran']);
    final terminal = _asInt(albaran['terminal']);
    final ejercicio = _asInt(albaran['ejercicio']);
    if (serie.isEmpty || numero <= 0 || terminal <= 0 || ejercicio <= 0) {
      return;
    }

    setState(() => _isOpeningAlbaran = true);
    try {
      final bytes = await PedidosService.downloadAlbaranPdfBytes(
        ejercicio: ejercicio,
        serie: serie,
        terminal: terminal,
        numero: numero,
      );
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PdfPreviewScreen(
            pdfBytes: Uint8List.fromList(bytes),
            title: 'Albaran $serie-$terminal-$numero',
            fileName: 'Albaran_${serie}_${terminal}_${numero}_$ejercicio.pdf',
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('No se pudo abrir el albaran: $e'),
          backgroundColor: AppTheme.error,
        ),
      );
    } finally {
      if (mounted) setState(() => _isOpeningAlbaran = false);
    }
  }

  Future<void> _loadAlbaranes() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final albaranes = await PedidosService.getOrderAlbaran(
        widget.orderId,
        forceRefresh: true,
      );
      if (mounted) {
        setState(() {
          _albaranes = albaranes;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.raisedSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: const Text(
        'Albaranes vinculados',
        style: TextStyle(color: Colors.white),
      ),
      content: SizedBox(
        width: double.maxFinite,
        child: _isLoading
            ? const Center(
                child: CircularProgressIndicator(color: AppTheme.info),
              )
            : _error != null
                ? Center(
                    child: Text(
                      'Error: $_error',
                      style: const TextStyle(color: AppTheme.error),
                    ),
                  )
                : _albaranes.isEmpty
                    ? const Center(
                        child: Text(
                          'No se encontraron albaranes vinculados',
                          style: TextStyle(color: Colors.white70),
                        ),
                      )
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        children: _albaranes.map((a) {
                          final facturaNum = _asInt(a['numeroFactura']);
                          final facturaSerie =
                              (a['serieFactura'] ?? '').toString().trim();
                          final facturaYear = _asInt(a['ejercicioFactura']);
                          final albaranRef = (a['albaranRef'] ?? '')
                              .toString()
                              .trim();
                          final facturaRef = (a['facturaRef'] ?? '')
                              .toString()
                              .trim();
                          final hasFactura = facturaNum > 0 &&
                              facturaSerie.isNotEmpty &&
                              facturaYear > 0;
                          final facturaDisplay = facturaRef.isNotEmpty
                              ? facturaRef
                              : '$facturaSerie-$facturaNum';
                          return Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: AppTheme.raisedSurface,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  albaranRef.isNotEmpty
                                      ? 'Albaran $albaranRef'
                                      : "${a['serie'] ?? ''} ${a['numeroAlbaran'] ?? ''}",
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  "Fecha: ${a['fecha'] ?? ''}",
                                  style: const TextStyle(
                                    color: Colors.white70,
                                    fontSize: 12,
                                  ),
                                ),
                                Text(
                                  "Importe: ${PedidosFormatters.money((a['importe'] as num? ?? 0).toDouble())}",
                                  style: const TextStyle(
                                    color: AppTheme.success,
                                    fontSize: 12,
                                  ),
                                ),
                                Text(
                                  hasFactura
                                      ? 'Factura: $facturaDisplay'
                                      : 'Pendiente de factura',
                                  style: const TextStyle(
                                    color: Colors.white54,
                                    fontSize: 11,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  alignment: WrapAlignment.end,
                                  children: [
                                    OutlinedButton.icon(
                                      onPressed: _isOpeningAlbaran
                                          ? null
                                          : () => _openAlbaran(a),
                                      icon: const Icon(
                                        Icons.local_shipping_outlined,
                                        size: 16,
                                      ),
                                      label: const Text('Ver albaran'),
                                    ),
                                    if (hasFactura)
                                      OutlinedButton.icon(
                                        onPressed: _isOpeningFactura
                                            ? null
                                            : () => _openFactura(a),
                                        icon: const Icon(
                                          Icons.picture_as_pdf_outlined,
                                          size: 16,
                                        ),
                                        label: Text(
                                          'Ver factura $facturaDisplay',
                                        ),
                                      ),
                                  ],
                                ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
      ),
      actions: [
        TextButton.icon(
          onPressed: _isLoading ? null : _loadAlbaranes,
          icon: const Icon(Icons.refresh, size: 18),
          label: const Text('Recargar'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cerrar', style: TextStyle(color: Colors.white54)),
        ),
      ],
    );
  }
}
