/// Product Search Widget
/// =====================
/// Search field with debounce + family filter chips for product catalog
library;

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

class ProductSearchWidget extends ConsumerStatefulWidget {
  const ProductSearchWidget({
    required this.vendedorCodes,
    super.key,
  });
  final String vendedorCodes;

  @override
  ConsumerState<ProductSearchWidget> createState() =>
      _ProductSearchWidgetState();
}

class _ProductSearchWidgetState extends ConsumerState<ProductSearchWidget> {
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _searchController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    if (mounted) setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      final provider = ref.read(pedidosProvider.notifier);
      provider.loadProducts(
        vendedorCodes: widget.vendedorCodes,
        search: value.isEmpty ? null : value,
        reset: true,
      );
    });
  }

  void _onFamilySelected(PedidosProvider provider, String? family) {
    provider.setFamilyFilter(
      provider.selectedFamily == family ? null : family,
    );
    provider.loadProducts(
      vendedorCodes: widget.vendedorCodes,
      search: _searchController.text.isEmpty ? null : _searchController.text,
      reset: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = ref.watch(pedidosProvider);
    final pad = Responsive.contentPadding(context);

    return ColoredBox(
      color: AppTheme.darkBase,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Search field
          Padding(
            padding: EdgeInsets.symmetric(
              horizontal: pad.left,
              vertical: 8,
            ),
            child: TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              style: TextStyle(
                color: Colors.white,
                fontSize: Responsive.fontSize(context, small: 14, large: 15),
              ),
              decoration: InputDecoration(
                hintText: 'Buscar producto...',
                hintStyle: const TextStyle(color: Colors.white38),
                prefixIcon: const Icon(Icons.search,
                    color: AppTheme.neonBlue, size: 20),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(
                          Icons.clear,
                          color: Colors.white38,
                          size: 18,
                        ),
                        onPressed: () {
                          _searchController.clear();
                          _onSearchChanged('');
                        },
                      )
                    : null,
                filled: true,
                fillColor: AppTheme.darkCard,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppTheme.borderColor),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppTheme.borderColor),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppTheme.neonBlue),
                ),
              ),
            ),
          ),
          // Stock filter chip + Family chips
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: EdgeInsets.symmetric(horizontal: pad.left),
              children: [
                // "Solo con stock" chip (Mejora 3)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    avatar: Icon(
                      Icons.inventory_2_outlined,
                      size: 14,
                      color: provider.onlyWithStock
                          ? AppTheme.neonGreen
                          : Colors.white54,
                    ),
                    label: const Text('Solo con stock'),
                    selected: provider.onlyWithStock,
                    selectedColor: AppTheme.neonGreen.withValues(alpha: 0.2),
                    backgroundColor: AppTheme.darkCard,
                    labelStyle: TextStyle(
                      color: provider.onlyWithStock
                          ? AppTheme.neonGreen
                          : Colors.white70,
                      fontSize:
                          Responsive.fontSize(context, small: 11, large: 13),
                    ),
                    side: BorderSide(
                      color: provider.onlyWithStock
                          ? AppTheme.neonGreen
                          : AppTheme.borderColor,
                    ),
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    visualDensity: VisualDensity.compact,
                    onSelected: (_) {
                      provider.setStockFilter(!provider.onlyWithStock);
                      provider.loadProducts(
                        vendedorCodes: widget.vendedorCodes,
                        search: _searchController.text.isEmpty
                            ? null
                            : _searchController.text,
                        reset: true,
                      );
                    },
                  ),
                ),
                // Req #14: chip Nestlé (filtra por prefamilia)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    avatar: Icon(
                      Icons.star,
                      size: 14,
                      color: provider.selectedPrefamily == 'NESTLE'
                          ? Colors.amber
                          : Colors.white54,
                    ),
                    label: const Text('Nestlé'),
                    selected: provider.selectedPrefamily == 'NESTLE',
                    selectedColor: Colors.amber.withValues(alpha: 0.22),
                    backgroundColor: AppTheme.darkCard,
                    labelStyle: TextStyle(
                      color: provider.selectedPrefamily == 'NESTLE'
                          ? Colors.amber
                          : Colors.white70,
                      fontSize: Responsive.fontSize(
                        context,
                        small: 11,
                        large: 13,
                      ),
                      fontWeight: FontWeight.w600,
                    ),
                    side: BorderSide(
                      color: provider.selectedPrefamily == 'NESTLE'
                          ? Colors.amber
                          : AppTheme.borderColor,
                    ),
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    visualDensity: VisualDensity.compact,
                    onSelected: (_) {
                      final next = provider.selectedPrefamily == 'NESTLE'
                          ? null
                          : 'NESTLE';
                      provider.setPrefamilyFilter(next);
                      provider.loadProducts(
                        vendedorCodes: widget.vendedorCodes,
                        search: _searchController.text.isEmpty
                            ? null
                            : _searchController.text,
                        reset: true,
                      );
                    },
                  ),
                ),
                // Family chips
                ...provider.families.map((family) {
                  final selected = provider.selectedFamily == family;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: Text(family),
                      selected: selected,
                      selectedColor: AppTheme.neonBlue.withValues(alpha: 0.2),
                      backgroundColor: AppTheme.darkCard,
                      labelStyle: TextStyle(
                        color: selected ? AppTheme.neonBlue : Colors.white70,
                        fontSize:
                            Responsive.fontSize(context, small: 11, large: 13),
                      ),
                      side: BorderSide(
                        color:
                            selected ? AppTheme.neonBlue : AppTheme.borderColor,
                      ),
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      visualDensity: VisualDensity.compact,
                      onSelected: (_) => _onFamilySelected(provider, family),
                    ),
                  );
                }),
              ],
            ),
          ),
          const SizedBox(height: 4),
        ],
      ),
    );
  }
}
