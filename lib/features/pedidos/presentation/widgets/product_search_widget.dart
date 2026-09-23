/// Product Search Widget
/// =====================
/// Search field with debounce + family filter chips for product catalog
library;

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/product_family_filter.dart';
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

  void _reloadProducts(PedidosProvider provider) {
    provider.loadProducts(
      vendedorCodes: widget.vendedorCodes,
      search: _searchController.text.isEmpty ? null : _searchController.text,
      reset: true,
    );
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

  void _onFamilySelected(PedidosProvider provider, String? familyCode) {
    provider.setFamilyFilter(
      provider.selectedFamily == familyCode ? null : familyCode,
    );
    _reloadProducts(provider);
  }

  FilterChip _buildChip({
    required BuildContext context,
    required String label,
    required bool selected,
    required Color selectedColor,
    required VoidCallback onSelected,
    Widget? avatar,
  }) {
    return FilterChip(
      avatar: avatar,
      label: Text(label),
      selected: selected,
      selectedColor: selectedColor.withValues(alpha: 0.24),
      backgroundColor: AppTheme.surfaceCommand.withValues(alpha: 0.94),
      labelStyle: TextStyle(
        color: selected ? selectedColor : AppTheme.textSecondary,
        fontSize: Responsive.fontSize(context, small: 11, large: 13),
        fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
      ),
      side: BorderSide(
        color: selected
            ? selectedColor
            : AppTheme.activeRing.withValues(alpha: 0.14),
      ),
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
      onSelected: (_) => onSelected(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final onlyWithStock =
        ref.watch(pedidosProvider.select((p) => p.onlyWithStock));
    final selectedFamily =
        ref.watch(pedidosProvider.select((p) => p.selectedFamily));
    final selectedPrefamily =
        ref.watch(pedidosProvider.select((p) => p.selectedPrefamily));
    final families = ref.watch(pedidosProvider.select((p) => p.families));
    final provider = ref.read(pedidosProvider);
    final pad = Responsive.contentPadding(context);
    final allSelected = selectedFamily == null && selectedPrefamily == null;

    // Layout: Todas | stock | Nestlé | familias DB (Impulso pinned primero).
    final chips = <Widget>[
      Padding(
        padding: const EdgeInsets.only(right: 8),
        child: Semantics(
          button: true,
          label: 'Todas las familias',
          child: _buildChip(
            context: context,
            label: 'Todas',
            selected: allSelected,
            selectedColor: AppTheme.info,
            onSelected: () {
              provider.clearCatalogFamilyFilters();
              _reloadProducts(provider);
            },
          ),
        ),
      ),
      Padding(
        padding: const EdgeInsets.only(right: 8),
        child: Semantics(
          button: true,
          label: 'Solo con stock',
          child: _buildChip(
            context: context,
            label: 'Solo con stock',
            selected: onlyWithStock,
            selectedColor: AppTheme.success,
            avatar: Icon(
              Icons.inventory_2_outlined,
              size: 14,
              color: onlyWithStock ? AppTheme.success : AppTheme.textTertiary,
            ),
            onSelected: () {
              provider.setStockFilter(!onlyWithStock);
              _reloadProducts(provider);
            },
          ),
        ),
      ),
      // Req #14: chip Nestlé (filtra por marca/descripcion vía prefamily=NESTLE)
      Padding(
        padding: const EdgeInsets.only(right: 8),
        child: Semantics(
          button: true,
          label: 'Filtro Nestlé',
          child: _buildChip(
            context: context,
            label: 'Nestlé',
            selected: selectedPrefamily == 'NESTLE',
            selectedColor: AppTheme.accentAmber,
            avatar: Icon(
              Icons.star,
              size: 14,
              color: selectedPrefamily == 'NESTLE'
                  ? AppTheme.accentAmber
                  : AppTheme.textTertiary,
            ),
            onSelected: () {
              final next = selectedPrefamily == 'NESTLE' ? null : 'NESTLE';
              provider.setPrefamilyFilter(next);
              _reloadProducts(provider);
            },
          ),
        ),
      ),
      ...families.map((ProductFamilyFilter family) {
        final selected = selectedFamily == family.code;
        return Padding(
          padding: const EdgeInsets.only(right: 8),
          child: Semantics(
            button: true,
            label: 'Familia ${family.name}',
            child: _buildChip(
              context: context,
              label: family.chipLabel,
              selected: selected,
              selectedColor:
                  family.isImpulso ? AppTheme.accentAmber : AppTheme.info,
              onSelected: () => _onFamilySelected(provider, family.code),
            ),
          ),
        );
      }),
    ];

    return Container(
      decoration: BoxDecoration(
        gradient: AppTheme.commandGradient,
        border: Border(
          bottom:
              BorderSide(color: AppTheme.activeRing.withValues(alpha: 0.18)),
        ),
        boxShadow: [
          ...AppTheme.elevation2,
          BoxShadow(
            color: AppTheme.activeRing.withValues(alpha: 0.06),
            blurRadius: 24,
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: EdgeInsets.symmetric(
              horizontal: pad.left,
              vertical: 8,
            ),
            child: TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontSize: Responsive.fontSize(context, small: 14, large: 15),
              ),
              decoration: InputDecoration(
                hintText: 'Buscar producto...',
                hintStyle: TextStyle(color: AppTheme.textTertiary),
                prefixIcon: const Icon(
                  Icons.manage_search_rounded,
                  color: AppTheme.activeRing,
                  size: 20,
                ),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: Icon(
                          Icons.clear,
                          color: AppTheme.textTertiary,
                          size: 18,
                        ),
                        onPressed: () {
                          _searchController.clear();
                          _onSearchChanged('');
                        },
                      )
                    : null,
                filled: true,
                fillColor: AppTheme.inkSurface.withValues(alpha: 0.56),
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  borderSide: BorderSide(
                    color: AppTheme.activeRing.withValues(alpha: 0.14),
                  ),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  borderSide: BorderSide(
                    color: AppTheme.activeRing.withValues(alpha: 0.14),
                  ),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  borderSide:
                      const BorderSide(color: AppTheme.activeRing, width: 1.6),
                ),
              ),
            ),
          ),
          SizedBox(
            height: 40,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: EdgeInsets.symmetric(horizontal: pad.left),
              itemCount: chips.length,
              itemBuilder: (_, index) => chips[index],
            ),
          ),
          const SizedBox(height: 4),
        ],
      ),
    );
  }
}
