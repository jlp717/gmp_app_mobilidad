/// Stock Alternatives Sheet
/// ========================
/// Shows when a product has no stock. Displays alternatives from the same
/// family/subfamily that have available stock using intelligent 3-level matching.
/// Includes a fallback search for manual product lookup.

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../data/pedidos_service.dart';
import '../../providers/pedidos_provider.dart';
import '../utils/pedidos_formatters.dart';

/// Shows the stock alternatives as a centered overlay modal.
Future<void> showStockAlternativesSheet({
  required BuildContext context,
  required Product outOfStockProduct,
  required PedidosProvider provider,
  double? remainingQty,
}) {
  return showDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierColor: Colors.black54,
    builder: (ctx) => Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(16),
      child: _StockAlternativesSheet(
        product: outOfStockProduct,
        provider: provider,
        remainingQty: remainingQty,
      ),
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
  State<_StockAlternativesSheet> createState() =>
      _StockAlternativesSheetState();
}

class _StockAlternativesSheetState extends State<_StockAlternativesSheet> {
  List<Map<String, dynamic>> _alternatives = [];
  List<Map<String, dynamic>> _searchResults = [];
  bool _isLoading = true;
  bool _isSearching = false;
  String? _error;
  final TextEditingController _searchController = TextEditingController();
  Timer? _searchDebounce;
  bool _showSearch = false;

  // Quantity selection per product code
  final Map<String, double> _selectedQty = {};

  @override
  void initState() {
    super.initState();
    _loadAlternatives();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _searchDebounce?.cancel();
    super.dispose();
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

  void _onSearchChanged(String query) {
    _searchDebounce?.cancel();
    if (query.trim().length < 2) {
      setState(() {
        _searchResults = [];
        _isSearching = false;
      });
      return;
    }
    _searchDebounce = Timer(const Duration(milliseconds: 400), () {
      _searchProducts(query.trim());
    });
  }

  Future<void> _searchProducts(String query) async {
    setState(() => _isSearching = true);
    try {
      final response = await ApiClient.get(
        '/pedidos/search-products?q=$query&limit=20',
      );
      if (response['success'] == true) {
        final list = response['products'] as List<dynamic>? ?? [];
        setState(() {
          _searchResults = list.cast<Map<String, dynamic>>();
          _isSearching = false;
        });
      } else {
        setState(() => _isSearching = false);
      }
    } catch (e) {
      setState(() => _isSearching = false);
    }
  }

  void _toggleSearch() {
    setState(() {
      _showSearch = !_showSearch;
      if (!_showSearch) {
        _searchController.clear();
        _searchResults = [];
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.85,
      ),
      decoration: BoxDecoration(
        color: AppTheme.darkBase,
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x66FF3B5C),
            blurRadius: 30,
            offset: Offset(0, -8),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
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

          const SizedBox(height: 12),

          // Search bar toggle
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: _buildSearchToggle(),
          ),

          // Search bar (conditionally shown)
          if (_showSearch)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: _buildSearchBar(),
            ),

          const SizedBox(height: 8),

          // Alternatives section
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(
              children: [
                Container(
                  width: 3,
                  height: 14,
                  decoration: BoxDecoration(
                    color: _showSearch ? AppTheme.neonBlue : AppTheme.neonGreen,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _showSearch
                      ? 'RESULTADOS DE BÚSQUEDA'
                      : 'ALTERNATIVAS INTELIGENTES',
                  style: TextStyle(
                    color: _showSearch ? AppTheme.neonBlue : AppTheme.neonGreen,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1.2,
                  ),
                ),
                const Spacer(),
                if (!_showSearch && _alternatives.isNotEmpty)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.neonGreen.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '${_alternatives.length}',
                      style: const TextStyle(
                        color: AppTheme.neonGreen,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
              ],
            ),
          ),

          const SizedBox(height: 8),

          // Alternatives list with fixed height
          SizedBox(
            height: 300,
            child: _buildContent(null),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchToggle() {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _toggleSearch,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: _showSearch
                ? AppTheme.neonBlue.withOpacity(0.1)
                : AppTheme.darkSurface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: _showSearch
                  ? AppTheme.neonBlue.withOpacity(0.3)
                  : AppTheme.borderColor,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                _showSearch ? Icons.auto_awesome : Icons.search,
                color: _showSearch ? AppTheme.neonBlue : AppTheme.textSecondary,
                size: 16,
              ),
              const SizedBox(width: 8),
              Text(
                _showSearch
                    ? 'Ver recomendaciones'
                    : 'Buscar en todo el catálogo',
                style: TextStyle(
                  color:
                      _showSearch ? AppTheme.neonBlue : AppTheme.textSecondary,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSearchBar() {
    return TextField(
      controller: _searchController,
      onChanged: _onSearchChanged,
      style: const TextStyle(color: Colors.white, fontSize: 14),
      decoration: InputDecoration(
        hintText: 'Buscar productos con stock...',
        hintStyle: const TextStyle(color: AppTheme.textTertiary),
        prefixIcon: const Icon(Icons.search, color: AppTheme.neonBlue),
        suffixIcon: _isSearching
            ? const Padding(
                padding: EdgeInsets.all(12),
                child: SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppTheme.neonBlue,
                  ),
                ),
              )
            : _searchController.text.isNotEmpty
                ? IconButton(
                    icon:
                        const Icon(Icons.clear, color: AppTheme.textSecondary),
                    onPressed: () {
                      _searchController.clear();
                      setState(() => _searchResults = []);
                    },
                  )
                : null,
        filled: true,
        fillColor: AppTheme.darkSurface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: AppTheme.neonBlue.withOpacity(0.3)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: AppTheme.borderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide:
              BorderSide(color: AppTheme.neonBlue.withOpacity(0.5), width: 2),
        ),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
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
            child: const Icon(Icons.inventory_2_outlined,
                color: AppTheme.error, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.product.hasStock
                      ? 'Stock Insuficiente'
                      : 'Sin Stock Disponible',
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.w700),
                ),
                Text(
                  widget.remainingQty != null
                      ? 'Por favor, añade ${widget.remainingQty!.toStringAsFixed(widget.remainingQty!.truncateToDouble() == widget.remainingQty! ? 0 : 2)} más de estas alternativas:'
                      : 'Te sugerimos productos similares:',
                  style: const TextStyle(
                      color: AppTheme.textSecondary, fontSize: 12),
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

  Widget _buildContent(ScrollController? scrollController) {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: AppTheme.neonBlue),
            SizedBox(height: 12),
            Text('Buscando alternativas...',
                style: TextStyle(color: AppTheme.textSecondary)),
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
            Text(_error!,
                style: const TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    // When search is active, show search results
    if (_showSearch) {
      if (_searchResults.isEmpty) {
        if (_searchController.text.isEmpty) {
          return const Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.search, color: AppTheme.textTertiary, size: 48),
                SizedBox(height: 12),
                Text('Escribe para buscar',
                    style:
                        TextStyle(color: AppTheme.textSecondary, fontSize: 14)),
                SizedBox(height: 4),
                Text('Encuentra productos con stock en todo el catálogo',
                    style:
                        TextStyle(color: AppTheme.textTertiary, fontSize: 12)),
              ],
            ),
          );
        }
        if (_isSearching) {
          return const Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(color: AppTheme.neonBlue),
                SizedBox(height: 12),
                Text('Buscando...',
                    style: TextStyle(color: AppTheme.textSecondary)),
              ],
            ),
          );
        }
        return const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.search_off, color: AppTheme.textTertiary, size: 48),
              SizedBox(height: 12),
              Text('Sin resultados',
                  style:
                      TextStyle(color: AppTheme.textSecondary, fontSize: 14)),
              SizedBox(height: 4),
              Text('No se encontraron productos con ese nombre',
                  style: TextStyle(color: AppTheme.textTertiary, fontSize: 12)),
            ],
          ),
        );
      }

      return ListView.builder(
        controller: scrollController,
        padding: const EdgeInsets.symmetric(horizontal: 20),
        itemCount: _searchResults.length,
        itemBuilder: (context, index) {
          final result = _searchResults[index];
          return _buildSearchResultCard(result);
        },
      );
    }

    // Show alternatives when not searching
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

  Widget _buildSearchResultCard(Map<String, dynamic> result) {
    final name = (result['name'] ?? '').toString().trim();
    final code = (result['code'] ?? '').toString().trim();
    final brand = (result['brand'] ?? '').toString().trim();
    final stockEnv = (result['stockEnvases'] as num?)?.toDouble() ?? 0;
    final precio = (result['precio'] as num?)?.toDouble() ?? 0;
    final family = (result['family'] ?? '').toString().trim();

    final bool hasStock = stockEnv > 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface.withOpacity(0.6),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: hasStock
              ? AppTheme.neonBlue.withOpacity(0.3)
              : AppTheme.warning.withOpacity(0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 50,
                height: 50,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: hasStock
                      ? AppTheme.neonBlue.withOpacity(0.1)
                      : AppTheme.warning.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${stockEnv.toInt()}',
                      style: TextStyle(
                          color:
                              hasStock ? AppTheme.neonBlue : AppTheme.warning,
                          fontSize: 16,
                          fontWeight: FontWeight.w800),
                    ),
                    const Text('cajas',
                        style: TextStyle(
                            color: AppTheme.textTertiary, fontSize: 9)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w600),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$code${brand.isNotEmpty ? ' · $brand' : ''}',
                      style: const TextStyle(
                          color: AppTheme.textTertiary, fontSize: 11),
                    ),
                    if (family.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          family,
                          style: const TextStyle(
                              color: AppTheme.neonGreen, fontSize: 10),
                        ),
                      ),
                    if (precio > 0)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          PedidosFormatters.money(precio, decimals: 3),
                          style: const TextStyle(
                              color: AppTheme.neonBlue,
                              fontSize: 12,
                              fontWeight: FontWeight.w600),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (hasStock) ...[
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Container(
                  decoration: BoxDecoration(
                    color: AppTheme.darkBase,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppTheme.borderColor),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _buildQtyButton(Icons.remove,
                          _getQty(code, stockEnv) <= 1,
                          () => _changeQty(code, -1, stockEnv)),
                      Container(
                        width: 40,
                        alignment: Alignment.center,
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Text(
                          _getQty(code, stockEnv) == _getQty(code, stockEnv).truncateToDouble()
                              ? _getQty(code, stockEnv).toInt().toString()
                              : _getQty(code, stockEnv).toStringAsFixed(1),
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.w700),
                        ),
                      ),
                      _buildQtyButton(Icons.add,
                          _getQty(code, stockEnv) >= stockEnv,
                          () => _changeQty(code, 1, stockEnv)),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Material(
                  color: Colors.transparent,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => _addToCart(result, _getQty(code, stockEnv)),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            AppTheme.neonBlue.withOpacity(0.2),
                            AppTheme.neonBlue.withOpacity(0.05),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                            color: AppTheme.neonBlue.withOpacity(0.4)),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.add_shopping_cart,
                              color: AppTheme.neonBlue, size: 16),
                          SizedBox(width: 4),
                          Text('Añadir',
                              style: TextStyle(
                                  color: AppTheme.neonBlue,
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ] else ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.warning.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.block, color: AppTheme.warning, size: 14),
                    SizedBox(width: 4),
                    Text('Sin stock',
                        style: TextStyle(
                            color: AppTheme.warning,
                            fontSize: 11,
                            fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  double _getQty(String code, double stock) {
    return _selectedQty[code] ?? (widget.remainingQty ?? 1.0).clamp(1.0, stock);
  }

  void _changeQty(String code, double delta, double stock) {
    final current = _getQty(code, stock);
    final next = (current + delta).clamp(1.0, stock);
    setState(() => _selectedQty[code] = next);
  }

  Widget _buildAlternativeCard(Map<String, dynamic> alt) {
    final name = (alt['name'] ?? '').toString().trim();
    final code = (alt['code'] ?? '').toString().trim();
    final brand = (alt['brand'] ?? '').toString().trim();
    final stockEnv = (alt['stockEnvases'] as num?)?.toDouble() ?? 0;
    final precio = (alt['precio'] as num?)?.toDouble() ?? 0;
    final score = (alt['similarityScore'] as num?)?.toInt() ?? 0;
    final reasons = (alt['matchReasons'] as List<dynamic>?)
            ?.map((e) => e.toString())
            .toList() ??
        [];

    final qty = _getQty(code, stockEnv);

    Color scoreColor = AppTheme.textTertiary;
    String scoreLabel = '';
    if (score >= 65) {
      scoreColor = AppTheme.neonBlue;
      scoreLabel = 'Excelente match';
    } else if (score >= 40) {
      scoreColor = AppTheme.neonGreen;
      scoreLabel = 'Buen match';
    } else if (score > 0) {
      scoreColor = Colors.orange;
      scoreLabel = 'Match aceptable';
    }

    // Stock semaphore color
    Color stockColor;
    if (stockEnv >= 10) {
      stockColor = AppTheme.neonGreen;
    } else if (stockEnv >= 3) {
      stockColor = Colors.orange;
    } else {
      stockColor = AppTheme.error;
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
              // Stock badge with semaphore color
              Container(
                width: 50,
                height: 50,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: stockColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${stockEnv.toInt()}',
                      style: TextStyle(
                          color: stockColor,
                          fontSize: 16,
                          fontWeight: FontWeight.w800),
                    ),
                    Text('cajas',
                        style: TextStyle(color: stockColor, fontSize: 9)),
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
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w600),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$code${brand.isNotEmpty ? ' · $brand' : ''}',
                      style: const TextStyle(
                          color: AppTheme.textTertiary, fontSize: 11),
                    ),
                    if (precio > 0)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Row(
                          children: [
                            Text(
                              PedidosFormatters.money(precio, decimals: 3),
                              style: const TextStyle(
                                  color: AppTheme.neonBlue,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600),
                            ),
                            if (precio > 0 && qty > 0) ...[
                              const SizedBox(width: 6),
                              Text(
                                '= ${PedidosFormatters.money(precio * qty, decimals: 2)}',
                                style: TextStyle(
                                    color: AppTheme.neonBlue.withOpacity(0.6),
                                    fontSize: 11),
                              ),
                            ],
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          // Quantity selector row + add button
          Row(
            children: [
              // Match score badge
              if (score > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: scoreColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    scoreLabel,
                    style: TextStyle(
                        color: scoreColor,
                        fontSize: 10,
                        fontWeight: FontWeight.w600),
                  ),
                ),
              const Spacer(),
              // Quantity selector
              Container(
                decoration: BoxDecoration(
                  color: AppTheme.darkBase,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppTheme.borderColor),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _buildQtyButton(Icons.remove, qty <= 1, () => _changeQty(code, -1, stockEnv)),
                    Container(
                      width: 40,
                      alignment: Alignment.center,
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Text(
                        qty == qty.truncateToDouble()
                            ? qty.toInt().toString()
                            : qty.toStringAsFixed(1),
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w700),
                      ),
                    ),
                    _buildQtyButton(Icons.add, qty >= stockEnv, () => _changeQty(code, 1, stockEnv)),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              // Add to cart
              Material(
                color: Colors.transparent,
                child: InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: () => _addToCart(alt, qty),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          AppTheme.neonGreen.withOpacity(0.2),
                          AppTheme.neonGreen.withOpacity(0.05),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppTheme.neonGreen.withOpacity(0.4)),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.add_shopping_cart, color: AppTheme.neonGreen, size: 16),
                        SizedBox(width: 4),
                        Text('Añadir',
                            style: TextStyle(
                                color: AppTheme.neonGreen,
                                fontSize: 12,
                                fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          // Match reasons chips
          if (reasons.isNotEmpty && score > 0) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 4,
              runSpacing: 4,
              children: reasons
                  .take(3)
                  .map((r) => Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTheme.darkBase,
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: AppTheme.borderColor),
                        ),
                        child: Text(r,
                            style: const TextStyle(
                                color: AppTheme.textSecondary, fontSize: 9)),
                      ))
                  .toList(),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildQtyButton(IconData icon, bool disabled, VoidCallback onTap) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: disabled ? null : () {
          HapticFeedback.selectionClick();
          onTap();
        },
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Icon(icon, size: 18,
              color: disabled ? AppTheme.textTertiary : AppTheme.neonGreen),
        ),
      ),
    );
  }

  void _addToCart(Map<String, dynamic> alt, [double? qty]) {
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

    final qtyToAdd = qty ?? widget.remainingQty ?? 1.0;

    final error = widget.provider.addLine(
      altProduct,
      qtyToAdd,
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
