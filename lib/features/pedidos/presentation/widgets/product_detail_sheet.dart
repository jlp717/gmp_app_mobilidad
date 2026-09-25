/// Product Detail Sheet
/// ====================
/// Bottom sheet showing full product information: data, image, tariffs,
/// client price, stock by warehouse, and a link to purchase history.
library;

import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_pdfview/flutter_pdfview.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/fullscreen_image_viewer.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/product_history_sheet.dart';
import 'package:path_provider/path_provider.dart';

class ProductDetailSheet extends StatefulWidget {
  const ProductDetailSheet({
    required this.productCode,
    required this.productName,
    super.key,
    this.clientCode,
    this.clientName,
    this.isMarginVisible = false,
  });
  final String productCode;
  final String productName;
  final String? clientCode;
  final String? clientName;
  final bool isMarginVisible;

  static Future<void> show(
    BuildContext context, {
    required String productCode,
    required String productName,
    String? clientCode,
    String? clientName,
    bool isMarginVisible = false,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.raisedSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: Responsive.isLandscape(context) ? 0.95 : 0.88,
        minChildSize: Responsive.isLandscape(context) ? 0.6 : 0.5,
        maxChildSize: 0.98,
        expand: false,
        builder: (_, scrollCtrl) => ProductDetailSheet(
          productCode: productCode,
          productName: productName,
          clientCode: clientCode,
          clientName: clientName,
          isMarginVisible: isMarginVisible,
        ),
      ),
    );
  }

  @override
  State<ProductDetailSheet> createState() => _ProductDetailSheetState();
}

class _ProductDetailSheetState extends State<ProductDetailSheet> {
  bool _loading = true;
  String? _error;
  ProductDetail? _detail;
  Map<String, dynamic>? _priceHistory;
  CancelToken? _detailCancelToken;
  CancelToken? _downloadCancelToken;
  int _loadGeneration = 0;
  // REQ-06: 404 on ficha disables share actions instead of crashing.
  bool _fichaMissing = false;
  bool _sharingFicha = false;

  @override
  void initState() {
    super.initState();
    _loadDetail();
  }

  @override
  void dispose() {
    _detailCancelToken?.cancel('product detail closed');
    _downloadCancelToken?.cancel('product ficha closed');
    super.dispose();
  }

  Future<void> _loadDetail() async {
    final generation = ++_loadGeneration;
    _detailCancelToken?.cancel('superseded product detail');
    final cancelToken = CancelToken();
    _detailCancelToken = cancelToken;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final detail = await PedidosService.getProductDetail(
        widget.productCode,
        clientCode: widget.clientCode,
        cancelToken: cancelToken,
      );
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _detail = detail;
        _loading = false;
      });
      final client = widget.clientCode?.trim() ?? '';
      if (client.isNotEmpty) {
        final history = await PedidosService.getProductPriceHistory(
          widget.productCode,
          client,
        );
        if (!mounted || generation != _loadGeneration) return;
        setState(() => _priceHistory = history);
      }
    } catch (e) {
      if (e is ApiException && e.code == 'CANCELLED') return;
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  String _imageUrl(String code) {
    final trimmed = code.trim();
    if (trimmed.isEmpty) return '';
    return '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(trimmed)}/image';
  }

  Future<void> _openFichaTecnica(BuildContext ctx) async {
    final navigator = Navigator.of(ctx);
    // Capturar el messenger ANTES de los await: usar ctx tras un await con
    // el sheet cerrado provocaba un lookup sobre un contexto desmontado.
    final messenger = ScaffoldMessenger.of(ctx);
    final code = widget.productCode.trim();
    final url =
        '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(code)}/ficha';
    final filePath =
        '${(await getTemporaryDirectory()).path}/${code}_ficha.pdf';

    showDialog<void>(
      context: ctx,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.softPanel,
        content: Row(
          children: [
            const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppTheme.info,
              ),
            ),
            const SizedBox(width: 16),
            Text(
              'Descargando ficha técnica...',
              style: TextStyle(color: AppColors.systemGrey300),
            ),
          ],
        ),
      ),
    );

    try {
      _downloadCancelToken?.cancel('superseded ficha download');
      final cancelToken = CancelToken();
      _downloadCancelToken = cancelToken;
      await ApiClient.download(url, filePath, cancelToken: cancelToken);

      if (navigator.canPop()) navigator.pop();

      if (!File(filePath).existsSync()) {
        messenger.showSnackBar(
          const SnackBar(content: Text('No se encontró la ficha técnica')),
        );
        return;
      }

      navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => _PdfViewerPage(
            filePath: filePath,
            title: 'Ficha Técnica - $code',
          ),
        ),
      );
    } catch (e) {
      if (navigator.canPop()) navigator.pop();
      if (e is ApiException && e.code == 'CANCELLED') return;
      final is404 = e.toString().contains('404');
      if (is404 && mounted) setState(() => _fichaMissing = true);
      final msg = is404
          ? 'No hay ficha técnica para este producto'
          : 'Error al descargar: $e';
      messenger.showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  /// REQ-06: downloads ficha PDF bytes via GET /products/:code/ficha and
  /// returns the temp file, or null on 404 (disables share). No new backend
  /// endpoint — solo-cliente con share_plus + url_launcher (spec opción a).
  Future<File?> _downloadFichaFile() async {
    final code = widget.productCode.trim();
    final url =
        '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(code)}/ficha';
    final filePath =
        '${(await getTemporaryDirectory()).path}/${code}_ficha.pdf';
    try {
      _downloadCancelToken?.cancel('superseded ficha download');
      final cancelToken = CancelToken();
      _downloadCancelToken = cancelToken;
      await ApiClient.download(url, filePath, cancelToken: cancelToken);
      final file = File(filePath);
      if (!file.existsSync() || file.lengthSync() < 100) return null;
      return file;
    } catch (e) {
      if (e is ApiException && e.code == 'CANCELLED') return null;
      if (e.toString().contains('404') && mounted) {
        setState(() => _fichaMissing = true);
      }
      return null;
    }
  }

  /// REQ-06: share options sheet replicating facturas _showShareOptions
  /// (WhatsApp + Email), backed by the downloaded ficha PDF.
  void _showFichaShareOptions(BuildContext context) {
    if (_fichaMissing) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No hay ficha técnica para compartir')),
      );
      return;
    }
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.transparent,
      builder: (sheetContext) {
        final scheme = Theme.of(sheetContext).colorScheme;
        return Container(
          decoration: BoxDecoration(
            color: scheme.surface,
            borderRadius:
                const BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  margin: const EdgeInsets.symmetric(vertical: 12),
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: scheme.outline,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Compartir ficha ${widget.productCode.trim()}',
                    style: Theme.of(sheetContext)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                Semantics(
                  button: true,
                  label: 'Compartir ficha por WhatsApp',
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: AppColors.whatsappGreen,
                      child: Icon(
                        Icons.chat,
                        color: AppColors.onAccent,
                        size: 20,
                      ),
                    ),
                    title: const Text('WhatsApp'),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      _shareFichaViaWhatsApp(context);
                    },
                  ),
                ),
                Semantics(
                  button: true,
                  label: 'Compartir ficha por correo',
                  child: ListTile(
                    leading: const CircleAvatar(
                      backgroundColor: AppTheme.info,
                      child: Icon(
                        Icons.email_outlined,
                        color: AppColors.onAccent,
                        size: 20,
                      ),
                    ),
                    title: const Text('Email'),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      _shareFichaViaEmail(context);
                    },
                  ),
                ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _shareFichaViaWhatsApp(BuildContext context) async {
    final phone = await _askPhoneNumber(context);
    if (phone == null || !context.mounted) return;
    if (!mounted) return;
    setState(() => _sharingFicha = true);
    try {
      final file = await _downloadFichaFile();
      if (!mounted) return;
      if (file == null) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Sin ficha para compartir'),
          ),
        );
        return;
      }
      // REQ-22/23 tanda4: directo wa.me primero, sin doble picker.
      // Descarga previa ya hecha para adjuntar manual.
      final digits = phone.replaceAll(RegExp(r'\D'), '');
      final message =
          'Hola, le adjunto la ficha técnica ${widget.productName} '
          '(${widget.productCode.trim()}).';
      if (digits.isNotEmpty) {
        final uri = Uri.parse(
          'https://wa.me/$digits?text=${Uri.encodeComponent(message)}',
        );
        if (await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
          if (mounted && context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  'Ficha descargada: adjúntala en el chat de WhatsApp.',
                ),
              ),
            );
          }
          return;
        }
      }
      // Fallback: WA ausente → share sheet con PDF.
      final renderBox = context.findRenderObject() as RenderBox?;
      final origin = renderBox != null
          ? Rect.fromCenter(
              center: Offset(
                renderBox.size.width / 2,
                renderBox.size.height / 2,
              ),
              width: 1,
              height: 1,
            )
          : null;
      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        text: 'Ficha técnica ${widget.productName} '
            '(${widget.productCode.trim()})',
        subject: 'Ficha técnica ${widget.productCode.trim()}',
        sharePositionOrigin: origin,
      );
    } finally {
      if (mounted) setState(() => _sharingFicha = false);
    }
  }

  Future<void> _shareFichaViaEmail(BuildContext context) async {
    if (!mounted) return;
    setState(() => _sharingFicha = true);
    try {
      final file = await _downloadFichaFile();
      if (!context.mounted) return;
      if (file == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No hay ficha técnica para este producto'),
          ),
        );
        return;
      }
      final renderBox = context.findRenderObject() as RenderBox?;
      final origin = renderBox != null
          ? Rect.fromCenter(
              center: Offset(
                renderBox.size.width / 2,
                renderBox.size.height / 2,
              ),
              width: 1,
              height: 1,
            )
          : null;
      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        subject: 'Ficha técnica ${widget.productCode.trim()} - '
            '${widget.productName}',
        sharePositionOrigin: origin,
      );
    } finally {
      if (mounted) setState(() => _sharingFicha = false);
    }
  }

  Future<String?> _askPhoneNumber(BuildContext context) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.softPanel,
        title: const Text('WhatsApp'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(
            hintText: 'Nº teléfono (ej. 34600112233)',
            prefixIcon: Icon(Icons.phone),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          Semantics(
            button: true,
            label: 'Enviar ficha por WhatsApp',
            child: TextButton(
              onPressed: () => Navigator.pop(ctx, controller.text.trim()),
              child: const Text('Continuar'),
            ),
          ),
        ],
      ),
    );
    return (result == null || result.isEmpty) ? null : result;
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: AppTheme.info),
            SizedBox(height: 12),
            Text(
              'Cargando detalle...',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.error_outline,
                color: AppTheme.error,
                size: 48,
              ),
              const SizedBox(height: 12),
              Text(
                'Error: $_error',
                style: TextStyle(color: AppTheme.textSecondary),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: _loadDetail,
                icon: const Icon(
                  Icons.refresh,
                  color: AppTheme.info,
                ),
                label: const Text(
                  'Reintentar',
                  style: TextStyle(color: AppTheme.info),
                ),
              ),
            ],
          ),
        ),
      );
    }

    final d = _detail!;
    final p = d.product;

    return ListView(
      padding: const EdgeInsets.symmetric(
        horizontal: 16,
        vertical: 12,
      ),
      children: [
        _buildDragHandle(),
        _buildHeader(p),
        const SizedBox(height: 16),
        _buildPriceHistoryStrip(p),
        const SizedBox(height: 16),
        _buildProductData(p),
        const SizedBox(height: 16),
        _buildImageSection(p.code),
        const SizedBox(height: 16),
        _buildTariffsSection(d.tariffs),
        if (d.clientPrice > 0) ...[
          const SizedBox(height: 16),
          _buildClientPrice(d.clientPrice),
        ],
        if (d.stockByWarehouse.isNotEmpty) ...[
          const SizedBox(height: 16),
          _buildStockSection(d.stockByWarehouse),
        ],
        const SizedBox(height: 20),
        _buildHistoryButton(),
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _buildPriceHistoryStrip(Product p) {
    final history = _priceHistory;
    final competitivo = history != null &&
            (history['competitivo'] is num)
        ? (history['competitivo'] as num).toDouble()
        : p.precioCompetitivo > 0
            ? p.precioCompetitivo
            : p.precioTarifa1;
    final ultimo = history != null && history['ultimoPrecio'] is num
        ? (history['ultimoPrecio'] as num).toDouble()
        : 0.0;
    final pct = history != null && history['pctSubida'] is num
        ? (history['pctSubida'] as num).toDouble()
        : 0.0;
    return Semantics(
      label:
          'Histórico precios: último ${ultimo.toStringAsFixed(2)}, subida ${pct.toStringAsFixed(1)} por ciento, competitivo ${competitivo.toStringAsFixed(2)}',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: AppTheme.inkSurface.withValues(alpha: 0.36),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: AppColors.themedWhite.withValues(alpha: 0.06),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _historyStat(
              Icons.history,
              ultimo > 0
                  ? PedidosFormatters.money(ultimo, decimals: 2)
                  : '—',
              'Último',
            ),
            _historyStat(
              Icons.trending_up,
              pct != 0 ? '${pct.toStringAsFixed(1)}%' : '—',
              '% subida',
            ),
            _historyStat(
              Icons.tag_outlined,
              competitivo > 0
                  ? PedidosFormatters.money(competitivo, decimals: 2)
                  : '—',
              'Competitivo',
            ),
          ],
        ),
      ),
    );
  }

  Widget _historyStat(IconData icon, String value, String label) {
    return Column(
      children: [
        Icon(icon, color: AppTheme.info, size: 14),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            color: AppTheme.info,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 10,
          ),
        ),
      ],
    );
  }

  // ── Drag handle ──
  Widget _buildDragHandle() {
    return Center(
      child: Container(
        width: 40,
        height: 4,
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: AppTheme.textTertiary,
          borderRadius: BorderRadius.circular(2),
        ),
      ),
    );
  }

  // ── Header ──
  Widget _buildHeader(Product p) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          p.name,
          style: TextStyle(
            color: AppTheme.textPrimary,
            fontSize: Responsive.fontSize(
              context,
              small: 16,
              large: 18,
            ),
            fontWeight: FontWeight.bold,
          ),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 4),
        Text(
          p.code,
          style: TextStyle(
            color: AppTheme.info,
            fontSize: Responsive.fontSize(
              context,
              small: 12,
              large: 14,
            ),
          ),
        ),
      ],
    );
  }

  // ── Section 1: Product Data ──
  Widget _buildProductData(Product p) {
    // Build family display: "code - description" if name available
    final familyDisplay =
        p.familyName.isNotEmpty ? '${p.family} - ${p.familyName}' : p.family;

    final rows = <_DataRow>[
      // Identification
      _DataRow('Referencia', p.code),
      if (p.ean.isNotEmpty) _DataRow('Cod. EAN', p.ean),
      if (p.nameExt.isNotEmpty) _DataRow('Descripcion ext.', p.nameExt),
      // Classification groups
      _DataRow('Familia (Grupo 1)', familyDisplay),
      if (p.subFamily.isNotEmpty) _DataRow('Subfamilia (Grupo 2)', p.subFamily),
      _DataRow('Marca', p.brand),
      if (p.grupoGeneral.isNotEmpty) _DataRow('Grupo General', p.grupoGeneral),
      if (p.tipoProducto.isNotEmpty) _DataRow('Tipo (Grupo 4)', p.tipoProducto),
      if (p.categoria.isNotEmpty) _DataRow('Categoria', p.categoria),
      if (p.gama.isNotEmpty) _DataRow('Gama', p.gama),
      if (p.claseArticulo.isNotEmpty)
        _DataRow('Clasificacion', p.claseArticulo),
      if (p.prefamilia.isNotEmpty) _DataRow('Prefamilia', p.prefamilia),
      // Packaging & units
      _DataRow('Unidad de Medida', p.unitMeasure),
      _DataRow('Uds. por Caja', p.unitsPerBox.toStringAsFixed(0)),
      if (p.unitsFraction > 0)
        _DataRow('Uds. Fraccion (Bandeja)', p.unitsFraction.toStringAsFixed(0)),
      if (p.unitsRetractil > 0)
        _DataRow(
          'Uds. Retractil (Estuche)',
          p.unitsRetractil.toStringAsFixed(0),
        ),
      _DataRow('Stock envases', p.stockEnvases.toStringAsFixed(0)),
      _DataRow('Stock unidades', p.stockUnidades.toStringAsFixed(0)),
      if (p.stockEnvases > 0 || p.stockUnidades > 0)
        _DataRow('Stock total', p.stockDisplay),
      if (p.presentacion.isNotEmpty) _DataRow('Presentacion', p.presentacion),
      if (p.formato.isNotEmpty) _DataRow('Formato', p.formato),
      if (p.calibre.isNotEmpty) _DataRow('Calibre', p.calibre),
      if (p.unidadPale > 0)
        _DataRow('Uds. por Pale', p.unidadPale.toStringAsFixed(0)),
      if (p.unidadFilaPale > 0)
        _DataRow('Uds. por Fila Pale', p.unidadFilaPale.toStringAsFixed(0)),
      // Physical
      if (p.weight > 0) _DataRow('Peso', '${p.pesoNeto.toStringAsFixed(3)} kg'),
      if (p.volumen > 0) _DataRow('Volumen', p.volumen.toStringAsFixed(3)),
      if (p.grados.isNotEmpty) _DataRow('Grados', p.grados),
      // Flags
      _DataRow('IVA', ivaLabelFromCode(p.codigoIva)),
      if (p.productoPesado) const _DataRow('Producto Pesado', 'Si'),
      if (p.trazable) const _DataRow('Trazable', 'Si'),
      if (p.precioTarifa1 > 0)
        _DataRow(
          'Tarifa base',
          PedidosFormatters.money(p.precioTarifa1, decimals: 3),
        ),
      if (p.precioCliente > 0)
        _DataRow(
          'Precio cliente',
          PedidosFormatters.money(p.precioCliente, decimals: 3),
        ),
      if (widget.isMarginVisible && p.precioMinimo > 0)
        _DataRow(
          'Precio minimo caja',
          PedidosFormatters.money(p.precioMinimo, decimals: 3),
        ),
      if (widget.isMarginVisible && p.precioCosto > 0)
        _DataRow(
          'Coste caja',
          PedidosFormatters.money(p.precioCosto, decimals: 3),
        ),
      // Dates
      if (p.fechaAlta != null && p.fechaAlta!.isNotEmpty)
        _DataRow('Fecha Alta', p.fechaAlta!),
      if (p.isDiscontinued)
        _DataRow(
          'Fecha Baja',
          '${p.mesBaja.toString().padLeft(2, '0')}/${p.anoBaja}',
        ),
      // Observations
      if (p.observacion1.isNotEmpty) _DataRow('Obs. 1', p.observacion1),
      if (p.observacion2.isNotEmpty) _DataRow('Obs. 2', p.observacion2),
    ];

    return _buildSection(
      title: 'Datos del Producto',
      icon: Icons.info_outline,
      child: Column(
        children: rows.map(_dataRowWidget).toList(),
      ),
    );
  }

  Widget _dataRowWidget(_DataRow r) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 160,
            child: Text(
              r.label,
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 13,
              ),
            ),
          ),
          Expanded(
            child: Text(
              r.value,
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Section 2: Product Image ──
  Widget _buildImageSection(String code) {
    final imageUrl = _imageUrl(code);

    return _buildSection(
      title: 'Imagen del Producto',
      icon: Icons.image_outlined,
      child: Column(
        children: [
          GestureDetector(
            onTap: () => FullscreenImageViewer.show(
              context,
              imageUrl: imageUrl,
              productName: widget.productName,
              productCode: code,
              headers: ApiClient.authHeaders,
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Container(
                width: double.infinity,
                height: 200,
                color: AppTheme.softPanel,
                child: SmartProductImage(
                  imageUrl: imageUrl,
                  productCode: code,
                  headers: ApiClient.authHeaders,
                  fit: BoxFit.contain,
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _openFichaTecnica(context),
              icon: const Icon(
                Icons.description_outlined,
                size: 18,
              ),
              label: const Text('Ver Ficha Tecnica'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.info,
                side: const BorderSide(
                  color: AppTheme.info,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
            ),
          ),
          // REQ-06: share ficha via WhatsApp / Email (replicates facturas
          // _showShareOptions pattern, client-side via share_plus + wa.me).
          // 404 disables share instead of crashing.
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: Semantics(
              button: true,
              label: _fichaMissing
                  ? 'Sin ficha técnica para compartir'
                  : 'Compartir ficha técnica por WhatsApp o correo',
              child: OutlinedButton.icon(
                onPressed: (_fichaMissing || _sharingFicha)
                    ? null
                    : () => _showFichaShareOptions(context),
                icon: _sharingFicha
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.share_outlined, size: 18),
                label: Text(
                  _fichaMissing
                      ? 'Sin ficha para compartir'
                      : 'Compartir ficha',
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
        ],
      ),
    );
  }

  // ── Section 3: Tariffs ──
  Widget _buildTariffsSection(List<TariffEntry> tariffs) {
    if (tariffs.isEmpty) {
      return _buildSection(
        title: 'Tarifas',
        icon: Icons.euro_outlined,
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Text(
            'Sin tarifas disponibles',
            style: TextStyle(color: AppTheme.textTertiary, fontSize: 13),
          ),
        ),
      );
    }

    return _buildSection(
      title: 'Tarifas',
      icon: Icons.euro_outlined,
      child: Column(
        children: tariffs.map((t) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.info.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: AppTheme.info.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Text(
                    'T${t.code}',
                    style: const TextStyle(
                      color: AppTheme.info,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    t.description,
                    style: TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 13,
                    ),
                  ),
                ),
                Text(
                  PedidosFormatters.money(t.price, decimals: 3),
                  style: const TextStyle(
                    color: AppTheme.success,
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }

  // ── Section 4: Client Price ──
  Widget _buildClientPrice(double price) {
    return _buildSection(
      title: 'Precio Cliente',
      icon: Icons.person_outline,
      child: Row(
        children: [
          const Icon(
            Icons.sell_outlined,
            color: AppTheme.success,
            size: 20,
          ),
          const SizedBox(width: 8),
          Text(
            PedidosFormatters.money(price, decimals: 3),
            style: const TextStyle(
              color: AppTheme.success,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '(ultimo precio de venta)',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: Responsive.fontSize(
                context,
                small: 11,
                large: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Section 5: Stock by Warehouse ──
  Widget _buildStockSection(List<StockEntry> stocks) {
    return _buildSection(
      title: 'Stocks',
      icon: Icons.inventory_2_outlined,
      child: Column(
        children: [
          // Header row
          const Padding(
            padding: EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: Text(
                    'Almacen',
                    style: TextStyle(
                      color: AppTheme.info,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                Expanded(
                  child: Text(
                    'Envases',
                    style: TextStyle(
                      color: AppTheme.info,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.right,
                  ),
                ),
                Expanded(
                  child: Text(
                    'Unidades',
                    style: TextStyle(
                      color: AppTheme.info,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.right,
                  ),
                ),
              ],
            ),
          ),
          Divider(color: AppTheme.borderColor, height: 1),
          ...stocks.map((s) {
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: Text(
                      s.almacenName.isNotEmpty
                          ? s.almacenName
                          : 'Almacen ${s.almacenCode}',
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 13,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      s.envases.toStringAsFixed(0),
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                      ),
                      textAlign: TextAlign.right,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      s.unidades.toStringAsFixed(0),
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                      ),
                      textAlign: TextAlign.right,
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  // ── Section 6: History Button ──
  Widget _buildHistoryButton() {
    if (widget.clientCode == null || widget.clientCode!.isEmpty) {
      return const SizedBox.shrink();
    }
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: ElevatedButton.icon(
        onPressed: () {
          ProductHistorySheet.show(
            context,
            productCode: widget.productCode,
            productName: widget.productName,
            clientCode: widget.clientCode!,
            clientName: widget.clientName ?? '',
            isMarginVisible: widget.isMarginVisible,
          );
        },
        icon: const Icon(Icons.bar_chart_rounded),
        label: const Text('Historico de Ventas'),
        style: ElevatedButton.styleFrom(
          backgroundColor: AppTheme.accentIndigo.withValues(alpha: 0.2),
          foregroundColor: AppTheme.accentIndigo,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(
              color: AppTheme.accentIndigo.withValues(alpha: 0.4),
            ),
          ),
          elevation: 0,
        ),
      ),
    );
  }

  // ── Section wrapper ──
  Widget _buildSection({
    required String title,
    required IconData icon,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.softPanel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: AppTheme.borderColor.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppTheme.info, size: 18),
              const SizedBox(width: 8),
              Text(
                title,
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }
}

class _DataRow {
  const _DataRow(this.label, this.value);
  final String label;
  final String value;
}

class _PdfViewerPage extends StatelessWidget {
  const _PdfViewerPage({required this.filePath, required this.title});
  final String filePath;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.textPrimary,
      appBar: AppBar(
        title: Text(title, style: const TextStyle(fontSize: 14)),
        backgroundColor: AppTheme.raisedSurface,
        elevation: 0,
      ),
      body: PDFView(
        filePath: filePath,
        onError: (error) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error al abrir PDF: $error')),
          );
        },
      ),
    );
  }
}
