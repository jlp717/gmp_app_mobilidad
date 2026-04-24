import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/clients/data/clients_service.dart';

class FamilyProductsPage extends StatefulWidget {
  const FamilyProductsPage({
    required this.clientCode,
    required this.vendedorCodes,
    required this.family1,
    this.family2,
    this.family3,
    required this.groupLevel,
    super.key,
  });

  final String clientCode;
  final String vendedorCodes;
  final String family1;
  final String? family2;
  final String? family3;
  final int groupLevel;

  @override
  State<FamilyProductsPage> createState() => _FamilyProductsPageState();
}

class _FamilyProductsPageState extends State<FamilyProductsPage> {
  List<Map<String, dynamic>> _products = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  Future<void> _loadProducts() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final products = await ClientsService.getProductsByFamily(
        clientCode: widget.clientCode,
        vendedorCodes: widget.vendedorCodes,
        family1: widget.family1,
        family2: widget.family2,
        family3: widget.family3,
        groupLevel: widget.groupLevel,
      );
      setState(() {
        _products = products;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  String get _title {
    final levels = <String>[];
    levels.add(widget.family1);
    if (widget.family2 != null && widget.family2!.isNotEmpty) {
      levels.add(widget.family2!);
    }
    if (widget.family3 != null && widget.family3!.isNotEmpty) {
      levels.add(widget.family3!);
    }
    return levels.join(' > ');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_title, style: const TextStyle(fontSize: 14)),
        backgroundColor: AppTheme.surfaceColor,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadProducts,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: ModernLoading(message: 'Cargando productos...'));
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 64, color: AppTheme.error),
            const SizedBox(height: 16),
            Text('Error: $_error', textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadProducts,
              child: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    if (_products.isEmpty) {
      return const Center(child: Text('No hay productos en esta familia'));
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _products.length,
      itemBuilder: (context, index) {
        final product = _products[index];
        final date = (product['date'] as String?) ?? '';
        final productName = (product['productName'] as String?) ?? 'Producto';
        final productCode = (product['productCode'] as String?) ?? '';
        final boxes = product['boxes'] ?? 0;
        final units = product['units'] ?? 0;
        final amount = (product['amount'] as num?)?.toDouble() ?? 0;

        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          color: AppTheme.surfaceColor,
          child: ListTile(
            dense: true,
            contentPadding: const EdgeInsets.symmetric(horizontal: 12),
            leading: Text(
              date.length >= 10 ? date.substring(5) : date,
              style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            ),
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  productName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
                if (productCode.isNotEmpty)
                  Text(
                    productCode,
                    style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10),
                  ),
              ],
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('$boxes cj', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                    if (units > 0) Text('$units u', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10)),
                  ],
                ),
                const SizedBox(width: 8),
                Text(
                  CurrencyFormatter.formatWhole(amount),
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}