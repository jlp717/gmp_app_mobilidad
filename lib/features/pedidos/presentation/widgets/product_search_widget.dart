/// Product Search Widget
/// =====================
/// Search field with debounce + family filter chips for product catalog

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../providers/pedidos_provider.dart';

class ProductSearchWidget extends StatefulWidget {
  final String vendedorCodes;

  const ProductSearchWidget({
    Key? key,
    required this.vendedorCodes,
  }) : super(key: key);

  @override
  State<ProductSearchWidget> createState() => _ProductSearchWidgetState();
}

class _ProductSearchWidgetState extends State<ProductSearchWidget> {
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _searchController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      final provider = context.read<PedidosProvider>();
      provider.loadProducts(
        vendedorCodes: widget.vendedorCodes,
        search: value.isEmpty ? null : value,
        reset: true,
      );
    });
  }

  void _onFamilySelected(PedidosProvider provider, String? family) {
    provider.setFamilyFilter(
        provider.selectedFamily == family ? null : family);
    provider.loadProducts(
      vendedorCodes: widget.vendedorCodes,
      search: _searchController.text.isEmpty ? null : _searchController.text,
      reset: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<PedidosProvider>();
    final pad = Responsive.contentPadding(context);

    return Container(
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
                prefixIcon:
                    const Icon(Icons.search, color: AppTheme.neonBlue, size: 20),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear,
                            color: Colors.white38, size: 18),
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
          // Family chips
          if (provider.families.isNotEmpty)
            SizedBox(
              height: 40,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: EdgeInsets.symmetric(horizontal: pad.left),
                itemCount: provider.families.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (ctx, i) {
                  final family = provider.families[i];
                  final selected = provider.selectedFamily == family;
                  return FilterChip(
                    label: Text(family),
                    selected: selected,
                    selectedColor: AppTheme.neonBlue.withOpacity(0.2),
                    backgroundColor: AppTheme.darkCard,
                    labelStyle: TextStyle(
                      color:
                          selected ? AppTheme.neonBlue : Colors.white70,
                      fontSize: Responsive.fontSize(context,
                          small: 11, large: 13),
                    ),
                    side: BorderSide(
                      color: selected
                          ? AppTheme.neonBlue
                          : AppTheme.borderColor,
                    ),
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    visualDensity: VisualDensity.compact,
                    onSelected: (_) =>
                        _onFamilySelected(provider, family),
                  );
                },
              ),
            ),
          const SizedBox(height: 4),
        ],
      ),
    );
  }
}
