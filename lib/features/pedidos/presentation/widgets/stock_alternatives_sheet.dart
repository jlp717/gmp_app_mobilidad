/// Stock Alternatives Sheet
/// ========================
/// Shows when a product has no stock. Displays alternatives from the same
/// family/subfamily that have available stock. Allows adding alternatives to cart.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../data/pedidos_service.dart';
import '../../providers/pedidos_provider.dart';
import '../utils/pedidos_formatters.dart';

/// Shows the stock alternatives bottom sheet.
Future<void> showStockAlternativesSheet({
  required BuildContext context,
  required Product outOfStockProduct,
  required PedidosProvider provider,
  double? remainingQty,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _StockAlternativesSheet(
      product: outOfStockProduct,
      provider: provider,
      remainingQty: remainingQty,
    ),
  );
}

class _StockAlternativesSheet extends StatefulWidget {
  final Product product;
  final PedidosProvider provider;
  final double? remainingQty;

  const _StockAlternativesSheet({
    required this.product,
    required this.provider,
    this.remainingQty,
  });

  @override
  State<_StockAlternativesSheet> createState() => _StockAlternativesSheetState();
}

class _StockAlternativesSheetState extends State<_StockAlternativesSheet> {
  List<Map<String, dynamic>> _alternatives = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadAlternatives();
  }

  Future<void> _loadAlternatives() async {
    try {
      final response = await ApiClient.get(
        '/pedidos/similar-products/${widget.product.code.trim()}',
      );
      if (response['success'] == true) {
        final list = response['alternatives'] as List<dynamic>? ?? [];
        setState(() {
          _alternatives = list.cast<Map<String, dynamic>>();
          _isLoading = false;
        });
      } else {
        setState(() {
          _error = response['error'] as String? ?? 'Error loading alternatives';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Error de conexión: $e';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.9,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: AppTheme.darkBase,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            boxShadow: [
              BoxShadow(
                color: Color(0x66FF3B5C),
                blurRadius: 30,
                offset: Offset(0, -8),
              ),
            ],
          ),
          child: Column(
            children: [
              // Handle
              Padding(
                padding: const EdgeInsets.only(top: 12, bottom: 4),
                child: Container(
                  width: 48,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTheme.error.withOpacity(0.4),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),

              // Header
              _buildHeader(),

              // Out of stock product card
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _buildOutOfStockCard(),
              ),

              const SizedBox(height: 16),

              // Alternatives section
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Row(
                  children: [
                    Container(
                      width: 3,
                      height: 14,
                      decoration: BoxDecoration(
                        color: AppTheme.neonGreen,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Text(
                      'ALTERNATIVAS CON STOCK',
                      style: TextStyle(
                        color: AppTheme.neonGreen,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 1.2,
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 8),

              // Alternatives list
              Expanded(
                child: _buildContent(scrollController),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.error.withOpacity(0.15),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(Icons.inventory_2_outlined, color: AppTheme.error, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.product.hasStock ? 'Stock Insuficiente' : 'Sin Stock Disponible',
                  style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700),
                ),
                Text(
                  widget.remainingQty != null 
                    ? 'Por favor, añade ${widget.remainingQty!.toStringAsFixed(widget.remainingQty!.truncateToDouble() == widget.remainingQty! ? 0 : 2)} más de estas alternativas:'
                    : 'Te sugerimos productos similares:',
                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.close, color: AppTheme.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildOutOfStockCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.error.withOpacity(0.05),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.error.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          // Product icon (dimmed)
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.05),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(Icons.inventory_2,
                color: AppTheme.error.withOpacity(0.5), size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.product.name,
                  style: TextStyle(
                    color: Colors.white.withOpacity(0.5),
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    decoration: TextDecoration.lineThrough,
                    decorationColor: AppTheme.error.withOpacity(0.5),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  '${widget.product.code.trim()} · ${widget.product.family}',
                  style: TextStyle(
                      color: Colors.white.withOpacity(0.3), fontSize: 11),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppTheme.error.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.block, color: AppTheme.error, size: 12),
                const SizedBox(width: 4),
                Text(widget.product.hasStock ? 'INSUFICIENTE' : 'SIN STOCK',
                    style: const TextStyle(
                        color: AppTheme.error,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.5)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildContent(ScrollController scrollController) {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: AppTheme.neonBlue),
            SizedBox(height: 12),
            Text('Buscando alternativas...', style: TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppTheme.warning, size: 40),
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    if (_alternatives.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off, color: AppTheme.textTertiary, size: 48),
            SizedBox(height: 12),
            Text('No se encontraron alternativas',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 14)),
            SizedBox(height: 4),
            Text('No hay productos similares con stock en esta familia',
                style: TextStyle(color: AppTheme.textTertiary, fontSize: 12)),
          ],
        ),
      );
    }

    return ListView.builder(
      controller: scrollController,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      itemCount: _alternatives.length,
      itemBuilder: (context, index) {
        final alt = _alternatives[index];
        return _buildAlternativeCard(alt);
      },
    );
  }

  Widget _buildAlternativeCard(Map<String, dynamic> alt) {
    final name = (alt['name'] ?? '').toString().trim();
    final code = (alt['code'] ?? '').toString().trim();
    final brand = (alt['brand'] ?? '').toString().trim();
    final stockEnv = (alt['stockEnvases'] as num?)?.toDouble() ?? 0;
    final precio = (alt['precio'] as num?)?.toDouble() ?? 0;
    final score = (alt['similarityScore'] as num?)?.toInt() ?? 0;
    final reasons = (alt['matchReasons'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [];

    Color scoreColor = AppTheme.textTertiary;
    String scoreLabel = '';
    if (score >= 65) {
      scoreColor = AppTheme.neonBlue;
      scoreLabel = '⭐ Excelente match';
    } else if (score >= 40) {
      scoreColor = AppTheme.neonGreen;
      scoreLabel = '🟢 Buen match';
    } else if (score > 0) {
      scoreColor = Colors.orange;
      scoreLabel = '🟡 Match aceptable';
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface.withOpacity(0.6),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.neonGreen.withOpacity(0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Stock badge
              Container(
                width: 50,
                height: 50,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppTheme.neonGreen.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${stockEnv.toInt()}',
                      style: const TextStyle(
                          color: AppTheme.neonGreen,
                          fontSize: 16,
                          fontWeight: FontWeight.w800),
                    ),
                    const Text('cajas',
                        style: TextStyle(
                            color: AppTheme.neonGreen, fontSize: 9)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              // Product info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: const TextStyle(
                          color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$code${brand.isNotEmpty ? ' · $brand' : ''}',
                      style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11),
                    ),
                    if (precio > 0)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          PedidosFormatters.money(precio, decimals: 3),
                          style: const TextStyle(
                              color: AppTheme.neonBlue, fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              // Add to cart button
              Material(
                color: Colors.transparent,
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () => _addToCart(alt),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          AppTheme.neonGreen.withOpacity(0.2),
                          AppTheme.neonGreen.withOpacity(0.05),
                        ],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.neonGreen.withOpacity(0.4)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.add_shopping_cart, color: AppTheme.neonGreen, size: 18),
                        const SizedBox(width: 6),
                        Text(widget.remainingQty != null 
                            ? 'Añadir ${widget.remainingQty!.toStringAsFixed(widget.remainingQty!.truncateToDouble() == widget.remainingQty! ? 0 : 2)}' 
                            : 'Añadir',
                            style: const TextStyle(
                                color: AppTheme.neonGreen,
                                fontSize: 13,
                                fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          
          if (score > 0) ...[
            const SizedBox(height: 12),
            const Divider(color: AppTheme.borderColor, height: 1),
            const SizedBox(height: 8),
            Row(
              children: [
                Text(
                  scoreLabel,
                  style: TextStyle(color: scoreColor, fontSize: 11, fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                if (reasons.isNotEmpty)
                  Expanded(
                    flex: 2,
                    child: Wrap(
                      alignment: WrapAlignment.end,
                      spacing: 4,
                      runSpacing: 4,
                      children: reasons.map((r) => Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTheme.darkBase,
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: AppTheme.borderColor),
                        ),
                        child: Text(r, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 9)),
                      )).toList(),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  void _addToCart(Map<String, dynamic> alt) {
    HapticFeedback.mediumImpact();
    // Create a minimal Product from the alternative data to add to cart
    final altProduct = Product(
      code: (alt['code'] ?? '').toString().trim(),
      name: (alt['name'] ?? '').toString().trim(),
      brand: (alt['brand'] ?? '').toString().trim(),
      family: (alt['family'] ?? '').toString().trim(),
      stockEnvases: (alt['stockEnvases'] as num?)?.toDouble() ?? 0,
      stockUnidades: (alt['stockUnidades'] as num?)?.toDouble() ?? 0,
      precioTarifa1: (alt['precio'] as num?)?.toDouble() ?? 0,
    );

    final qtyToAdd = widget.remainingQty ?? 1.0;

    final error = widget.provider.addLine(
      altProduct,
      qtyToAdd, // Add remaining or 1 caja por defecto
      0,
      'CAJAS',
      altProduct.bestPrice,
    );

    if (error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error), backgroundColor: AppTheme.error),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${altProduct.name} añadido al carrito'),
          backgroundColor: AppTheme.neonGreen,
          duration: const Duration(seconds: 2),
        ),
      );
      Navigator.pop(context);
    }
  }
}
