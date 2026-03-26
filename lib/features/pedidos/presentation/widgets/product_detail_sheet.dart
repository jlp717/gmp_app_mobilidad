/// Product Detail Sheet
/// ====================
/// Bottom sheet showing full product information: data, image, tariffs,
/// client price, stock by warehouse, and a link to purchase history.

import 'package:flutter/material.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../data/pedidos_service.dart';
import 'product_history_sheet.dart';
import 'package:url_launcher/url_launcher.dart';

class ProductDetailSheet extends StatefulWidget {
  final String productCode;
  final String productName;
  final String? clientCode;
  final String? clientName;

  const ProductDetailSheet({
    Key? key,
    required this.productCode,
    required this.productName,
    this.clientCode,
    this.clientName,
  }) : super(key: key);

  static Future<void> show(
    BuildContext context, {
    required String productCode,
    required String productName,
    String? clientCode,
    String? clientName,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: 0.88,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, scrollCtrl) => ProductDetailSheet(
          productCode: productCode,
          productName: productName,
          clientCode: clientCode,
          clientName: clientName,
        ),
      ),
    );
  }

  @override
  State<ProductDetailSheet> createState() =>
      _ProductDetailSheetState();
}

class _ProductDetailSheetState extends State<ProductDetailSheet> {
  bool _loading = true;
  String? _error;
  ProductDetail? _detail;

  @override
  void initState() {
    super.initState();
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final detail = await PedidosService.getProductDetail(
        widget.productCode,
        clientCode: widget.clientCode,
      );
      setState(() {
        _detail = detail;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  String _imageUrl(String code) =>
      '${ApiConfig.baseUrl}/products/'
      '${Uri.encodeComponent(code.trim())}/image';

  String _fichaUrl(String code) =>
      '${ApiConfig.baseUrl}/products/'
      '${Uri.encodeComponent(code.trim())}/ficha';

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: AppTheme.neonBlue),
            SizedBox(height: 12),
            Text(
              'Cargando detalle...',
              style: TextStyle(color: Colors.white54),
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
                style: const TextStyle(color: Colors.white70),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: _loadDetail,
                icon: const Icon(
                  Icons.refresh,
                  color: AppTheme.neonBlue,
                ),
                label: const Text(
                  'Reintentar',
                  style: TextStyle(color: AppTheme.neonBlue),
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

  // ── Drag handle ──
  Widget _buildDragHandle() {
    return Center(
      child: Container(
        width: 40,
        height: 4,
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: Colors.white24,
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
            color: Colors.white,
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
            color: AppTheme.neonBlue,
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
    // IVA type label
    String ivaLabel(String code) {
      switch (code) {
        case '0': return 'Exento';
        case '1': return 'General (21%)';
        case '2': return 'Reducido (10%)';
        case '3': return 'Super Reducido (4%)';
        default: return 'Tipo $code';
      }
    }

    // Build family display: "code - description" if name available
    final familyDisplay = p.familyName.isNotEmpty
        ? '${p.family} - ${p.familyName}'
        : p.family;

    final rows = <_DataRow>[
      // Identification
      _DataRow('Referencia', p.code),
      if (p.ean.isNotEmpty) _DataRow('Cod. EAN', p.ean),
      if (p.nameExt.isNotEmpty) _DataRow('Descripcion ext.', p.nameExt),
      // Classification groups
      _DataRow('Familia (Grupo 1)', familyDisplay),
      if (p.subFamily.isNotEmpty)
        _DataRow('Subfamilia (Grupo 2)', p.subFamily),
      _DataRow('Marca', p.brand),
      if (p.grupoGeneral.isNotEmpty)
        _DataRow('Grupo General', p.grupoGeneral),
      if (p.tipoProducto.isNotEmpty)
        _DataRow('Tipo (Grupo 4)', p.tipoProducto),
      if (p.categoria.isNotEmpty)
        _DataRow('Categoria', p.categoria),
      if (p.gama.isNotEmpty)
        _DataRow('Gama', p.gama),
      if (p.claseArticulo.isNotEmpty)
        _DataRow('Clasificacion', p.claseArticulo),
      if (p.prefamilia.isNotEmpty)
        _DataRow('Prefamilia', p.prefamilia),
      // Packaging & units
      _DataRow('Unidad de Medida', p.unitMeasure),
      _DataRow('Uds. por Caja', p.unitsPerBox.toStringAsFixed(0)),
      if (p.unitsFraction > 0)
        _DataRow('Uds. Fraccion (Bandeja)',
            p.unitsFraction.toStringAsFixed(0)),
      if (p.unitsRetractil > 0)
        _DataRow('Uds. Retractil (Estuche)',
            p.unitsRetractil.toStringAsFixed(0)),
      if (p.presentacion.isNotEmpty)
        _DataRow('Presentacion', p.presentacion),
      if (p.formato.isNotEmpty)
        _DataRow('Formato', p.formato),
      if (p.calibre.isNotEmpty)
        _DataRow('Calibre', p.calibre),
      if (p.unidadPale > 0)
        _DataRow('Uds. por Pale',
            p.unidadPale.toStringAsFixed(0)),
      if (p.unidadFilaPale > 0)
        _DataRow('Uds. por Fila Pale',
            p.unidadFilaPale.toStringAsFixed(0)),
      // Physical
      if (p.weight > 0)
        _DataRow('Peso', '${p.pesoNeto.toStringAsFixed(3)} kg'),
      if (p.volumen > 0)
        _DataRow('Volumen', p.volumen.toStringAsFixed(3)),
      if (p.grados.isNotEmpty)
        _DataRow('Grados', p.grados),
      // Flags
      _DataRow('IVA', ivaLabel(p.codigoIva)),
      if (p.productoPesado)
        _DataRow('Producto Pesado', 'Si'),
      if (p.trazable)
        _DataRow('Trazable', 'Si'),
      // Dates
      if (p.fechaAlta != null && p.fechaAlta!.isNotEmpty)
        _DataRow('Fecha Alta', p.fechaAlta!),
      if (p.isDiscontinued)
        _DataRow('Fecha Baja',
            '${p.mesBaja.toString().padLeft(2, '0')}/${p.anoBaja}'),
      // Observations
      if (p.observacion1.isNotEmpty)
        _DataRow('Obs. 1', p.observacion1),
      if (p.observacion2.isNotEmpty)
        _DataRow('Obs. 2', p.observacion2),
    ];

    return _buildSection(
      title: 'Datos del Producto',
      icon: Icons.info_outline,
      child: Column(
        children: rows.map((r) => _dataRowWidget(r)).toList(),
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
              style: const TextStyle(
                color: Colors.white54,
                fontSize: 13,
              ),
            ),
          ),
          Expanded(
            child: Text(
              r.value,
              style: const TextStyle(
                color: Colors.white,
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
    final fichaUrl = _fichaUrl(code);

    return _buildSection(
      title: 'Imagen del Producto',
      icon: Icons.image_outlined,
      child: Column(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Container(
              width: double.infinity,
              height: 200,
              color: AppTheme.darkBase,
              child: Image.network(
                imageUrl,
                headers: ApiClient.authHeaders,
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.image_not_supported_outlined,
                        color: Colors.white24,
                        size: 48,
                      ),
                      SizedBox(height: 8),
                      Text(
                        'Imagen no disponible',
                        style: TextStyle(
                          color: Colors.white38,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                loadingBuilder: (_, child, progress) {
                  if (progress == null) return child;
                  return const Center(
                    child: CircularProgressIndicator(
                      color: AppTheme.neonBlue,
                      strokeWidth: 2,
                    ),
                  );
                },
              ),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () async {
                // Build authenticated URL with token as query param for browser access
                final token = ApiClient.authToken ?? '';
                final uri = Uri.parse('$fichaUrl?token=$token');
                if (await canLaunchUrl(uri)) {
                  await launchUrl(
                    uri,
                    mode: LaunchMode.externalApplication,
                  );
                }
              },
              icon: const Icon(
                Icons.description_outlined,
                size: 18,
              ),
              label: const Text('Ver Ficha Tecnica'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.neonBlue,
                side: const BorderSide(
                  color: AppTheme.neonBlue,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
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
        child: const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Text(
            'Sin tarifas disponibles',
            style: TextStyle(color: Colors.white38, fontSize: 13),
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
                    color: AppTheme.neonBlue.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: AppTheme.neonBlue.withOpacity(0.3),
                    ),
                  ),
                  child: Text(
                    'T${t.code}',
                    style: const TextStyle(
                      color: AppTheme.neonBlue,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    t.description,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 13,
                    ),
                  ),
                ),
                Text(
                  '\u20AC${t.price.toStringAsFixed(3)}',
                  style: const TextStyle(
                    color: AppTheme.neonGreen,
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
            color: AppTheme.neonGreen,
            size: 20,
          ),
          const SizedBox(width: 8),
          Text(
            '\u20AC${price.toStringAsFixed(3)}',
            style: const TextStyle(
              color: AppTheme.neonGreen,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '(ultimo precio de venta)',
            style: TextStyle(
              color: Colors.white54,
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
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: const [
                Expanded(
                  flex: 3,
                  child: Text(
                    'Almacen',
                    style: TextStyle(
                      color: AppTheme.neonBlue,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                Expanded(
                  child: Text(
                    'Envases',
                    style: TextStyle(
                      color: AppTheme.neonBlue,
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
                      color: AppTheme.neonBlue,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.right,
                  ),
                ),
              ],
            ),
          ),
          const Divider(color: AppTheme.borderColor, height: 1),
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
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 13,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      s.envases.toStringAsFixed(0),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                      ),
                      textAlign: TextAlign.right,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      s.unidades.toStringAsFixed(0),
                      style: const TextStyle(
                        color: Colors.white,
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
          );
        },
        icon: const Icon(Icons.bar_chart_rounded),
        label: const Text('Historico de Ventas'),
        style: ElevatedButton.styleFrom(
          backgroundColor: AppTheme.neonPurple.withOpacity(0.2),
          foregroundColor: AppTheme.neonPurple,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(
              color: AppTheme.neonPurple.withOpacity(0.4),
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
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: AppTheme.borderColor.withOpacity(0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppTheme.neonBlue, size: 18),
              const SizedBox(width: 8),
              Text(
                title,
                style: const TextStyle(
                  color: Colors.white,
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
  final String label;
  final String value;
  const _DataRow(this.label, this.value);
}
