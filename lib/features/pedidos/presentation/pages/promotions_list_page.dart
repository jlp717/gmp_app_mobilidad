import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/pages/promotion_detail_page.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/utils/pedidos_formatters.dart';

class PromotionsListPage extends StatefulWidget {
  const PromotionsListPage({
    required this.promotions,
    required this.onProductTap,
    super.key,
    this.onAddGift,
    this.hasStockResolver,
    this.qtyInOrderResolver,
  });
  final List<PromotionItem> promotions;
  final Future<void> Function(String code, String name) onProductTap;
  final Future<String?> Function(String code, String name, double qty)?
      onAddGift;
  final bool? Function(String code)? hasStockResolver;
  final double Function(String code)? qtyInOrderResolver;

  @override
  State<PromotionsListPage> createState() => _PromotionsListPageState();
}

class _PromotionsListPageState extends State<PromotionsListPage> {
  String _search = '';
  String _typeFilter = 'TODAS';
  bool _onlyWithStock = false;
  bool _showFilters = true;

  @override
  Widget build(BuildContext context) {
    final groups = _buildGroups(widget.promotions);
    final filtered = groups.where(_groupMatchesFilters).toList()
      ..sort((a, b) {
        // GIFT promos first (more valuable), then by item count
        if (a.promoType != b.promoType) {
          return a.promoType == 'GIFT' ? -1 : 1;
        }
        final byCount = b.items.length.compareTo(a.items.length);
        if (byCount != 0) return byCount;
        return a.promoDesc.compareTo(b.promoDesc);
      });

    final totalPromos = groups.length;
    final visiblePromos = filtered.length;

    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Promociones'),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppTheme.success.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                '$visiblePromos${visiblePromos < totalPromos ? '/$totalPromos' : ''}',
                style: const TextStyle(
                  color: AppTheme.success,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        backgroundColor: AppTheme.raisedSurface,
        elevation: 0,
        actions: [
          IconButton(
            icon: Icon(
              _showFilters ? Icons.filter_alt_off : Icons.filter_alt,
              color: AppTheme.textSecondary,
            ),
            tooltip: _showFilters ? 'Ocultar filtros' : 'Mostrar filtros',
            onPressed: () => setState(() => _showFilters = !_showFilters),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_showFilters) _buildFilters(),
          Expanded(
            child: filtered.isEmpty
                ? _buildEmptyState()
                : ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: filtered.length,
                    itemBuilder: (context, index) {
                      return _buildPromoCard(filtered[index]);
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    final hasAnyPromos = widget.promotions.isNotEmpty;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              hasAnyPromos ? Icons.search_off : Icons.local_offer_outlined,
              size: 64,
              color: AppTheme.textTertiary,
            ),
            const SizedBox(height: 16),
            Text(
              hasAnyPromos
                  ? 'No hay promociones con esos filtros'
                  : 'No hay promociones activas',
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              hasAnyPromos
                  ? 'Prueba a cambiar los filtros o la busqueda'
                  : 'Las promociones apareceran aqui cuando esten disponibles',
              style: const TextStyle(
                color: AppTheme.textTertiary,
                fontSize: 13,
              ),
              textAlign: TextAlign.center,
            ),
            if (hasAnyPromos) ...[
              const SizedBox(height: 16),
              FilledButton.tonalIcon(
                onPressed: () {
                  setState(() {
                    _search = '';
                    _typeFilter = 'TODAS';
                    _onlyWithStock = false;
                  });
                },
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Limpiar filtros'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildFilters() {
    return Container(
      color: AppTheme.raisedSurface,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        children: [
          // Search bar
          TextField(
            onChanged: (value) => setState(() => _search = value.trim()),
            style: const TextStyle(color: AppTheme.textPrimary),
            decoration: InputDecoration(
              hintText: 'Buscar por nombre, codigo o articulo...',
              hintStyle:
                  const TextStyle(color: AppTheme.textTertiary, fontSize: 13),
              prefixIcon:
                  const Icon(Icons.search, color: AppTheme.info, size: 20),
              suffixIcon: _search.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, size: 18),
                      onPressed: () => setState(() => _search = ''),
                    )
                  : null,
              filled: true,
              fillColor: AppTheme.softPanel,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
              isDense: true,
            ),
          ),
          const SizedBox(height: 8),
          // Filter chips row
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildTypeChip('TODAS', 'Todas', Icons.filter_list),
                const SizedBox(width: 6),
                _buildTypeChip('GIFT', 'Regalo', Icons.card_giftcard),
                const SizedBox(width: 6),
                _buildTypeChip('PRICE', 'Precio', Icons.attach_money),
                const SizedBox(width: 8),
                const SizedBox(
                  height: 20,
                  child: VerticalDivider(width: 1, color: AppTheme.borderColor),
                ),
                const SizedBox(width: 8),
                FilterChip(
                  label: const Text('Con stock'),
                  selected: _onlyWithStock,
                  selectedColor: AppTheme.success.withValues(alpha: 0.2),
                  backgroundColor: AppTheme.softPanel,
                  labelStyle: TextStyle(
                    color: _onlyWithStock
                        ? AppTheme.success
                        : AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                  side: BorderSide(
                    color: _onlyWithStock
                        ? AppTheme.success
                        : AppTheme.borderColor,
                  ),
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  visualDensity: VisualDensity.compact,
                  onSelected: (_) {
                    setState(() => _onlyWithStock = !_onlyWithStock);
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTypeChip(String value, String label, IconData icon) {
    final selected = _typeFilter == value;
    return FilterChip(
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 14,
            color: selected ? AppTheme.info : AppTheme.textSecondary,
          ),
          const SizedBox(width: 4),
          Text(label),
        ],
      ),
      selected: selected,
      selectedColor: AppTheme.info.withValues(alpha: 0.2),
      backgroundColor: AppTheme.softPanel,
      labelStyle: TextStyle(
        color: selected ? AppTheme.info : AppTheme.textSecondary,
        fontSize: 12,
      ),
      side: BorderSide(
        color: selected ? AppTheme.info : AppTheme.borderColor,
      ),
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
      onSelected: (_) => setState(() => _typeFilter = value),
    );
  }

  Widget _buildPromoCard(_PromotionGroup group) {
    final isGift = group.promoType == 'GIFT';
    final accentColor = isGift ? AppTheme.accentIndigo : AppTheme.success;
    final first = group.items.first;
    final hasProducts = group.items.any((i) => i.code.isNotEmpty);

    return Card(
      color: AppTheme.softPanel,
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: accentColor.withValues(alpha: 0.35)),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: hasProducts
            ? () {
                Navigator.push(
                  context,
                  MaterialPageRoute<void>(
                    builder: (_) => PromotionDetailPage(
                      promoType: group.promoType,
                      promoCode: group.promoCode,
                      promoDesc: group.promoDesc,
                      dateFrom: group.dateFrom,
                      dateTo: group.dateTo,
                      minQty: group.minQty,
                      giftQty: group.giftQty,
                      cumulative: group.cumulative,
                      items: group.items,
                      onProductTap: widget.onProductTap,
                      onAddGift: widget.onAddGift,
                      hasStockResolver: widget.hasStockResolver,
                      qtyInOrderResolver: widget.qtyInOrderResolver,
                      giftSelectionLocked: group.hasFixedGift,
                    ),
                  ),
                );
              }
            : null,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: accentColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(
                      isGift ? Icons.card_giftcard : Icons.local_offer,
                      color: accentColor,
                      size: 18,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          group.promoDesc.isNotEmpty
                              ? group.promoDesc
                              : (isGift
                                  ? 'Promocion regalo'
                                  : 'Promocion precio'),
                          style: TextStyle(
                            color: accentColor,
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (group.promoCode.isNotEmpty)
                          Text(
                            group.promoCode,
                            style: const TextStyle(
                              color: AppTheme.textTertiary,
                              fontSize: 11,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: accentColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      isGift ? 'REGALO' : 'PRECIO',
                      style: TextStyle(
                        color: accentColor,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              // Promo details
              if (isGift && first.minQty > 0)
                _buildDetailRow(
                  icon: Icons.shopping_basket,
                  label:
                      'Compra ${first.minQty.toInt()}, lleva ${(first.minQty + first.giftQty).toInt()}',
                  color: AppTheme.accentIndigo,
                  suffix: first.cumulative ? '(acumulable)' : null,
                ),
              if (!isGift)
                Wrap(
                  spacing: 12,
                  runSpacing: 6,
                  children: [
                    _buildDetailRow(
                      icon: Icons.attach_money,
                      label:
                          'Oferta: ${PedidosFormatters.money(group.promoPrice, decimals: 3)}',
                      color: AppTheme.success,
                    ),
                    if (group.regularPrice > 0)
                      _buildDetailRow(
                        icon: Icons.price_change,
                        label:
                            'Tarifa: ${PedidosFormatters.money(group.regularPrice, decimals: 3)}',
                        color: AppTheme.textSecondary,
                      ),
                    if (group.discountPct > 0)
                      _buildDetailRow(
                        icon: Icons.trending_down,
                        label:
                            '-${PedidosFormatters.number(group.discountPct, decimals: 1)}%',
                        color: AppTheme.success,
                      ),
                  ],
                ),
              const SizedBox(height: 8),
              // Footer info
              Row(
                children: [
                  const Icon(
                    Icons.inventory_2_outlined,
                    size: 14,
                    color: AppTheme.textTertiary,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${group.items.length} producto(s)',
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 12,
                    ),
                  ),
                  const Spacer(),
                  if (group.dateTo.isNotEmpty && group.dateTo != '0/0/0') ...[
                    const Icon(
                      Icons.calendar_today,
                      size: 12,
                      color: AppTheme.textTertiary,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'Hasta ${group.dateTo}',
                      style: const TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ],
              ),
              // Product chips (if has products)
              if (hasProducts) ...[
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    ...group.items.take(8).map((item) {
                      final hasStock =
                          widget.hasStockResolver?.call(item.code) ??
                              item.hasStock;
                      final stockColor = hasStock == true
                          ? AppTheme.success
                          : hasStock == false
                              ? AppTheme.error
                              : AppTheme.textTertiary;

                      return ActionChip(
                        onPressed: () =>
                            widget.onProductTap(item.code, item.name),
                        backgroundColor: AppTheme.raisedSurface,
                        side: BorderSide(
                          color: stockColor.withValues(alpha: 0.45),
                        ),
                        avatar: Icon(
                          hasStock == true
                              ? Icons.inventory_2_outlined
                              : Icons.inventory_2,
                          size: 14,
                          color: stockColor,
                        ),
                        label: Text(
                          '${item.code} · ${item.name}',
                          style: const TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 11,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      );
                    }),
                    if (group.items.length > 8)
                      Chip(
                        backgroundColor: AppTheme.raisedSurface,
                        side: const BorderSide(color: AppTheme.borderColor),
                        label: Text(
                          '+${group.items.length - 8} mas',
                          style: const TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 11,
                          ),
                        ),
                      ),
                  ],
                ),
              ],
              // CTA button
              if (hasProducts) ...[
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerRight,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: accentColor.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: accentColor.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Ver detalle',
                          style: TextStyle(
                            color: accentColor,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(
                          Icons.arrow_forward_ios,
                          size: 10,
                          color: accentColor,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDetailRow({
    required IconData icon,
    required String label,
    required Color color,
    String? suffix,
  }) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        if (suffix != null) ...[
          const SizedBox(width: 4),
          Text(
            suffix,
            style: TextStyle(
              color: color.withValues(alpha: 0.7),
              fontSize: 11,
              fontStyle: FontStyle.italic,
            ),
          ),
        ],
      ],
    );
  }

  List<_PromotionGroup> _buildGroups(List<PromotionItem> promos) {
    final grouped = <String, List<PromotionItem>>{};

    for (final p in promos) {
      String norm(String s) =>
          s.trim().toUpperCase().replaceAll(RegExp(r'\s+'), ' ');
      // Group GIFT promos by promoCode (one promo = one group)
      // Group PRICE promos by desc+price combo
      final key = p.promoCode.isNotEmpty
          ? '${norm(p.promoType)}|${norm(p.promoCode)}|${norm(p.dateFrom)}|${norm(p.dateTo)}|${p.minQty}|${p.giftQty}'
          : '${norm(p.promoType)}|${norm(p.promoDesc)}|${p.promoPrice}|${p.regularPrice}|${norm(p.dateFrom)}|${norm(p.dateTo)}';
      grouped.putIfAbsent(key, () => []).add(p);
    }

    return grouped.entries
        .map((e) => _PromotionGroup(key: e.key, items: e.value))
        .toList();
  }

  bool _groupMatchesFilters(_PromotionGroup group) {
    if (_typeFilter != 'TODAS' && group.promoType != _typeFilter) {
      return false;
    }

    if (_onlyWithStock) {
      final hasAnyStock = group.items.any((item) {
        final resolved = widget.hasStockResolver?.call(item.code);
        return resolved ?? item.hasStock;
      });
      if (!hasAnyStock) return false;
    }

    if (_search.isEmpty) return true;
    final q = _search.toLowerCase();
    if (group.promoDesc.toLowerCase().contains(q)) return true;
    if (group.promoCode.toLowerCase().contains(q)) return true;
    if (group.items.any(
      (i) =>
          i.code.toLowerCase().contains(q) || i.name.toLowerCase().contains(q),
    )) {
      return true;
    }
    return false;
  }
}

class _PromotionGroup {
  _PromotionGroup({
    required this.key,
    required this.items,
  });
  final String key;
  final List<PromotionItem> items;

  String get promoType => items.first.promoType;
  String get promoCode => items.first.promoCode;
  String get promoDesc => items.first.promoDesc;
  double get promoPrice => items.first.promoPrice;
  double get regularPrice => items.first.regularPrice;
  String get dateFrom => items.first.dateFrom;
  String get dateTo => items.first.dateTo;
  double get minQty => items.first.minQty;
  double get giftQty => items.first.giftQty;
  bool get cumulative => items.first.cumulative;

  /// Regalo fijado por promoción (mismo producto o SKU explícito).
  bool get hasFixedGift =>
      promoType == 'GIFT' && items.every((item) => item.hasFixedGiftProduct);

  double get discountPct {
    if (regularPrice <= 0 || promoPrice <= 0 || promoPrice >= regularPrice) {
      return 0;
    }
    return ((regularPrice - promoPrice) / regularPrice) * 100;
  }
}
