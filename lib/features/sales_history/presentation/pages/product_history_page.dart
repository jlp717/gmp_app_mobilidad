import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:flutter_pdfview/flutter_pdfview.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/api/api_config.dart';
import '../../../../core/api/api_client.dart';
import '../../providers/sales_history_provider.dart';
import '../../../../core/providers/auth_provider.dart';
import 'package:intl/intl.dart';
import '../widgets/sales_summary_header.dart';
import '../../../../core/widgets/shimmer_skeleton.dart';
import '../../../../core/widgets/error_state_widget.dart';
import '../../domain/product_history_item.dart';

class ProductHistoryPage extends StatefulWidget {
  final String? initialClientCode;

  const ProductHistoryPage({super.key, this.initialClientCode});

  @override
  State<ProductHistoryPage> createState() => _ProductHistoryPageState();
}

class _ProductHistoryPageState extends State<ProductHistoryPage> {
  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _clientController = TextEditingController();
  DateTimeRange? _selectedDateRange;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final history = Provider.of<SalesHistoryProvider>(context, listen: false);
      
      history.setVendedorCodes(auth.vendedorCodes.join(','));
      
      if (widget.initialClientCode != null) {
        _clientController.text = widget.initialClientCode!;
        history.setClientCode(widget.initialClientCode);
      } else {
        history.loadHistory(reset: true);
      }
    });

    _clientController.addListener(_onClientChanged);
  }
  
  @override
  void dispose() {
    _searchController.dispose();
    _clientController.removeListener(_onClientChanged);
    _clientController.dispose();
    super.dispose();
  }

  void _onClientChanged() {
     // Optional: handle manual client code entry debounce
     // For now relying on Search button or separate action
  }
  
  void _onSearchSubmit(String val) {
    Provider.of<SalesHistoryProvider>(context, listen: false)
      ..setProductSearch(val)
      ..loadHistory(reset: true);
  }

  Future<void> _pickDateRange() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2023),
      lastDate: DateTime.now(),
      initialDateRange: _selectedDateRange,
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: ColorScheme.dark(
              primary: AppColors.primary,
              onPrimary: Colors.white,
              surface: AppColors.cardColor,
              onSurface: Colors.white,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      setState(() => _selectedDateRange = picked);
      final start = DateFormat('yyyy-MM-dd').format(picked.start);
      final end = DateFormat('yyyy-MM-dd').format(picked.end);
      
      Provider.of<SalesHistoryProvider>(context, listen: false).setDateRange(start, end);
    }
  }
  
  void _clearFilters() {
    _searchController.clear();
    _clientController.clear();
    setState(() => _selectedDateRange = null);
    
    final p = Provider.of<SalesHistoryProvider>(context, listen: false);
    p.setClientCode(null);
    p.setProductSearch('');
    p.setDateRange(null, null); // Will trigger load
  }

  @override
  Widget build(BuildContext context) {
    final history = Provider.of<SalesHistoryProvider>(context);

    return Scaffold(
      backgroundColor: AppColors.backgroundColor,
      appBar: AppBar(
        title: const Text('Histórico de Ventas'),
        backgroundColor: AppColors.cardColor,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.sync, color: AppColors.primary),
            tooltip: 'Sincronizar',
            onPressed: () => history.loadHistory(reset: true),
          ),
        ],
      ),
      body: Column(
        children: [
          // Filters
          Container(
            padding: const EdgeInsets.all(16),
            color: AppColors.cardColor,
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: _clientController,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: 'Cód. Cliente (Opcional)',
                          hintStyle: TextStyle(color: Colors.white54),
                          filled: true,
                          fillColor: AppColors.backgroundColor,
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                          prefixIcon: const Icon(Icons.person, color: Colors.white54),
                        ),
                        onSubmitted: (val) => history.setClientCode(val.isEmpty ? null : val),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      flex: 3,
                      child: TextField(
                        controller: _searchController,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: 'Buscar Producto / Ref / Lote',
                          hintStyle: TextStyle(color: Colors.white54),
                          filled: true,
                          fillColor: AppColors.backgroundColor,
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                          prefixIcon: const Icon(Icons.search, color: Colors.white54),
                        ),
                        onSubmitted: _onSearchSubmit,
                      ),
                    ),
                    const SizedBox(width: 16),
                    IconButton(
                      icon: const Icon(Icons.calendar_month, color: AppColors.primary),
                      onPressed: _pickDateRange,
                      tooltip: 'Filtrar Fechas',
                    ),
                     if (_selectedDateRange != null || _clientController.text.isNotEmpty || _searchController.text.isNotEmpty)
                      TextButton.icon(
                        icon: const Icon(Icons.clear, color: Colors.redAccent),
                        label: const Text('Limpiar', style: TextStyle(color: Colors.redAccent)),
                        onPressed: _clearFilters,
                      ),
                  ],
                ),
              ],
            ),
          ),
          
          // Summary Header (Comparison)
          if (!history.isLoading && history.summary != null)
             _buildSummaryHeader(context, history.summary!),

          // Results — adaptive layout
          Expanded(
            child: history.isLoading
                ? const SkeletonList(itemCount: 6, itemHeight: 60)
                : history.error != null
                    ? ErrorStateWidget(message: 'Error: ${history.error}')
                    : history.items.isEmpty
                        ? const Center(child: Text('No hay datos', style: TextStyle(color: Colors.white54)))
                        : OrientationBuilder(
                            builder: (context, orientation) {
                              if (orientation == Orientation.portrait) {
                                return _buildPortraitCards(history.items);
                              } else {
                                return _buildLandscapeTable(history.items);
                              }
                            },
                          ),
          ),
        ],
      ),
    );
  }


  Widget _buildSummaryHeader(BuildContext context, Map<String, dynamic> summary) {
      return SalesSummaryHeader(summary: summary);
  }

  // ===========================================================================
  // PORTRAIT: Card-based layout with product thumbnails
  // ===========================================================================
  Widget _buildPortraitCards(List<ProductHistoryItem> items) {
    final baseUrl = ApiConfig.baseUrl;
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        return _ProductCard(item: item, baseUrl: baseUrl);
      },
    );
  }

  // ===========================================================================
  // LANDSCAPE: DataTable with photo + ficha columns
  // ===========================================================================
  Widget _buildLandscapeTable(List<ProductHistoryItem> items) {
    final baseUrl = ApiConfig.baseUrl;
    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingRowColor: WidgetStateProperty.all(AppColors.cardColor),
          dataRowColor: WidgetStateProperty.all(AppColors.backgroundColor),
          columnSpacing: 16,
          columns: const [
            DataColumn(label: Text('Foto', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            DataColumn(label: Text('Ficha', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            DataColumn(label: Text('Fecha', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            DataColumn(label: Text('Cliente', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            DataColumn(label: Text('Factura', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            DataColumn(label: Text('Producto', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            DataColumn(label: Text('Lote', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            DataColumn(label: Text('Cant', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            DataColumn(label: Text('Precio', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            DataColumn(label: Text('Total', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
          ],
          rows: items.map((item) {
            return DataRow(cells: [
              // Product thumbnail
              DataCell(_ProductThumbnail(
                imageUrl: item.imageUrl(baseUrl),
                productName: item.productName,
                size: 40,
              )),
              // Ficha técnica button
              DataCell(
                IconButton(
                  icon: const Icon(Icons.description_outlined, color: AppColors.primary, size: 20),
                  tooltip: 'Ficha Técnica',
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: () => _openFichaTecnica(context, item, baseUrl),
                ),
              ),
              DataCell(Text(item.date, style: const TextStyle(color: Colors.white70))),
              DataCell(Text(item.clientCode, style: const TextStyle(color: Colors.white70))),
              DataCell(Text(item.invoice, style: const TextStyle(color: AppColors.neonBlue))),
              DataCell(Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(item.productName, style: const TextStyle(color: Colors.white), overflow: TextOverflow.ellipsis),
                  Text(item.productCode, style: const TextStyle(color: Colors.white30, fontSize: 10)),
                ],
              )),
              DataCell(Text(
                item.lote + (item.ref.isNotEmpty ? ' / ${item.ref}' : ''),
                style: const TextStyle(color: Colors.white70),
              )),
              DataCell(Text(item.quantity.toStringAsFixed(0), style: const TextStyle(color: AppColors.primary))),
              DataCell(Text(item.price, style: const TextStyle(color: Colors.white70))),
              DataCell(Text(item.total, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            ]);
          }).toList(),
        ),
      ),
    );
  }

  // ===========================================================================
  // FICHA TÉCNICA — Download PDF and open viewer
  // ===========================================================================
  Future<void> _openFichaTecnica(BuildContext ctx, ProductHistoryItem item, String baseUrl) async {
    final scaffoldMessenger = ScaffoldMessenger.of(ctx);
    final navigator = Navigator.of(ctx);

    // Show loading indicator
    scaffoldMessenger.showSnackBar(
      const SnackBar(
        content: Row(
          children: [
            SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
            SizedBox(width: 12),
            Text('Descargando ficha técnica...'),
          ],
        ),
        duration: Duration(seconds: 10),
      ),
    );

    try {
      final url = item.fichaUrl(baseUrl);
      final dir = await getTemporaryDirectory();
      final filePath = '${dir.path}/${item.productCode.trim()}_ficha.pdf';

      await ApiClient.dio.download(url, filePath);
      scaffoldMessenger.hideCurrentSnackBar();

      if (!File(filePath).existsSync()) {
        scaffoldMessenger.showSnackBar(
          const SnackBar(content: Text('No se encontró la ficha técnica para este producto')),
        );
        return;
      }

      navigator.push(MaterialPageRoute(
        builder: (_) => _PdfViewerPage(
          filePath: filePath,
          title: 'Ficha Técnica - ${item.productCode.trim()}',
        ),
      ));
    } catch (e) {
      scaffoldMessenger.hideCurrentSnackBar();
      final msg = e.toString().contains('404')
          ? 'No hay ficha técnica para este producto'
          : 'Error al descargar: $e';
      scaffoldMessenger.showSnackBar(SnackBar(content: Text(msg)));
    }
  }
}

// =============================================================================
// PRODUCT CARD — Portrait layout item
// =============================================================================
class _ProductCard extends StatelessWidget {
  final ProductHistoryItem item;
  final String baseUrl;

  const _ProductCard({required this.item, required this.baseUrl});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: AppColors.cardColor,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Product image thumbnail
            _ProductThumbnail(
              imageUrl: item.imageUrl(baseUrl),
              productName: item.productName,
              size: 64,
            ),
            const SizedBox(width: 12),
            // Product details
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Product name + code
                  Text(
                    item.productName,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Cód: ${item.productCode}',
                    style: const TextStyle(color: Colors.white38, fontSize: 11),
                  ),
                  const SizedBox(height: 6),
                  // Info row: client, invoice, date
                  Wrap(
                    spacing: 12,
                    runSpacing: 4,
                    children: [
                      _InfoChip(icon: Icons.person_outline, label: item.clientCode),
                      _InfoChip(icon: Icons.receipt_long, label: item.invoice, color: AppColors.neonBlue),
                      _InfoChip(icon: Icons.calendar_today, label: item.date),
                    ],
                  ),
                  const SizedBox(height: 6),
                  // Lote if available
                  if (item.lote.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        'Lote: ${item.lote}${item.ref.isNotEmpty ? ' / ${item.ref}' : ''}',
                        style: const TextStyle(color: Colors.white38, fontSize: 11),
                      ),
                    ),
                  // Bottom row: quantity, price, total, ficha button
                  Row(
                    children: [
                      _ValueTag(label: 'Cant', value: item.quantity.toStringAsFixed(0), color: AppColors.primary),
                      const SizedBox(width: 8),
                      _ValueTag(label: 'Precio', value: item.price, color: Colors.white70),
                      const SizedBox(width: 8),
                      _ValueTag(label: 'Total', value: item.total, color: Colors.white, bold: true),
                      const Spacer(),
                      // Ficha Técnica button
                      Material(
                        color: Colors.transparent,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(8),
                          onTap: () {
                            final state = context.findAncestorStateOfType<_ProductHistoryPageState>();
                            state?._openFichaTecnica(context, item, baseUrl);
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              border: Border.all(color: AppColors.primary.withOpacity(0.5)),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.description_outlined, color: AppColors.primary, size: 16),
                                SizedBox(width: 4),
                                Text('Ficha', style: TextStyle(color: AppColors.primary, fontSize: 11)),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// PRODUCT THUMBNAIL — Reusable image widget with tap-to-fullscreen
// =============================================================================
class _ProductThumbnail extends StatelessWidget {
  final String imageUrl;
  final String productName;
  final double size;

  const _ProductThumbnail({
    required this.imageUrl,
    required this.productName,
    required this.size,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _showFullscreenImage(context),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Container(
          width: size,
          height: size,
          color: AppColors.surfaceColor,
          child: Image.network(
            imageUrl,
            width: size,
            height: size,
            fit: BoxFit.cover,
            headers: {'Accept': 'image/*', if (ApiClient.dio.options.headers['Authorization'] != null) 'Authorization': ApiClient.dio.options.headers['Authorization'] as String},
            loadingBuilder: (ctx, child, progress) {
              if (progress == null) return child;
              return Center(
                child: SizedBox(
                  width: size * 0.4,
                  height: size * 0.4,
                  child: const CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                ),
              );
            },
            errorBuilder: (ctx, err, stack) => Icon(
              Icons.image_not_supported_outlined,
              color: Colors.white24,
              size: size * 0.5,
            ),
          ),
        ),
      ),
    );
  }

  void _showFullscreenImage(BuildContext context) {
    Navigator.of(context).push(
      PageRouteBuilder(
        opaque: false,
        barrierColor: Colors.black87,
        barrierDismissible: true,
        pageBuilder: (ctx, anim, secondAnim) {
          return _FullscreenImageViewer(
            imageUrl: imageUrl,
            productName: productName,
          );
        },
        transitionsBuilder: (ctx, anim, secondAnim, child) {
          return FadeTransition(opacity: anim, child: child);
        },
      ),
    );
  }
}

// =============================================================================
// FULLSCREEN IMAGE VIEWER — InteractiveViewer with pinch-to-zoom
// =============================================================================
class _FullscreenImageViewer extends StatelessWidget {
  final String imageUrl;
  final String productName;

  const _FullscreenImageViewer({required this.imageUrl, required this.productName});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        elevation: 0,
        title: Text(
          productName,
          style: const TextStyle(color: Colors.white70, fontSize: 14),
          overflow: TextOverflow.ellipsis,
        ),
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.white),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Center(
        child: InteractiveViewer(
          minScale: 0.5,
          maxScale: 5.0,
          child: Image.network(
            imageUrl,
            fit: BoxFit.contain,
            headers: {'Accept': 'image/*', if (ApiClient.dio.options.headers['Authorization'] != null) 'Authorization': ApiClient.dio.options.headers['Authorization'] as String},
            loadingBuilder: (ctx, child, progress) {
              if (progress == null) return child;
              final percent = progress.expectedTotalBytes != null
                  ? progress.cumulativeBytesLoaded / progress.expectedTotalBytes!
                  : null;
              return Center(
                child: CircularProgressIndicator(value: percent, color: AppColors.primary),
              );
            },
            errorBuilder: (ctx, err, stack) => const Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.broken_image_outlined, color: Colors.white38, size: 64),
                SizedBox(height: 12),
                Text('No se pudo cargar la imagen', style: TextStyle(color: Colors.white54)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// PDF VIEWER PAGE — In-app PDF viewer for fichas técnicas
// =============================================================================
class _PdfViewerPage extends StatelessWidget {
  final String filePath;
  final String title;

  const _PdfViewerPage({required this.filePath, required this.title});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: Text(title, style: const TextStyle(fontSize: 14)),
        backgroundColor: AppColors.cardColor,
        elevation: 0,
      ),
      body: PDFView(
        filePath: filePath,
        enableSwipe: true,
        swipeHorizontal: false,
        autoSpacing: true,
        pageFling: true,
        onError: (error) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error al abrir PDF: $error')),
          );
        },
      ),
    );
  }
}

// =============================================================================
// HELPER WIDGETS
// =============================================================================
class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;

  const _InfoChip({required this.icon, required this.label, this.color = Colors.white54});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: color),
        const SizedBox(width: 3),
        Text(label, style: TextStyle(color: color, fontSize: 11)),
      ],
    );
  }
}


class _ValueTag extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final bool bold;

  const _ValueTag({required this.label, required this.value, required this.color, this.bold = false});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: const TextStyle(color: Colors.white30, fontSize: 9)),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: bold ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ],
    );
  }
}
