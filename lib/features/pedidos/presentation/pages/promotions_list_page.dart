import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/pedidos_service.dart';
import '../utils/pedidos_formatters.dart';

class PromotionsListPage extends StatefulWidget {
  final List<PromotionItem> promotions;
  final Future<void> Function(String code, String name) onProductTap;
  final bool? Function(String code)? hasStockResolver;

  const PromotionsListPage({
    Key? key,
    required this.promotions,
    required this.onProductTap,
    this.hasStockResolver,
  }) : super(key: key);

  @override
  State<PromotionsListPage> createState() => _PromotionsListPageState();
}

class _PromotionsListPageState extends State<PromotionsListPage> {
  String _search = '';
  String _typeFilter = 'TODAS';
  bool _onlyWithStock = false;

  @override
  Widget build(BuildContext context) {
    final groups = _buildGroups(widget.promotions);
    final filtered = groups.where(_groupMatchesFilters).toList()
      ..sort((a, b) {
        final byCount = b.items.length.compareTo(a.items.length);
        if (byCount != 0) return byCount;
        return a.promoDesc.compareTo(b.promoDesc);
      });

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        title: const Text('Promociones'),
        backgroundColor: AppTheme.darkSurface,
        elevation: 0,
      ),
      body: Column(
        children: [
          _buildFilters(),
          Expanded(
            child: filtered.isEmpty
                ? const Center(
                    child: Text(
                      'No hay promociones con esos filtros.',
                      style: TextStyle(color: Colors.white54),
                    ),
                  )
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

  Widget _buildFilters() {
    return Container(
      color: AppTheme.darkSurface,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      child: Column(
        children: [
          TextField(
            onChanged: (value) => setState(() => _search = value.trim()),
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: 'Buscar promoción o artículo...',
              hintStyle: const TextStyle(color: Colors.white38),
              prefixIcon:
                  const Icon(Icons.search, color: AppTheme.neonBlue, size: 18),
              filled: true,
              fillColor: AppTheme.darkCard,
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
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildTypeChip('TODAS', 'Todas'),
                const SizedBox(width: 6),
                _buildTypeChip('PRICE', 'Precio'),
                const SizedBox(width: 6),
                _buildTypeChip('GIFT', 'Regalo'),
                const SizedBox(width: 6),
                FilterChip(
                  label: const Text('Solo con stock'),
                  selected: _onlyWithStock,
                  selectedColor: AppTheme.neonGreen.withOpacity(0.2),
                  backgroundColor: AppTheme.darkCard,
                  labelStyle: TextStyle(
                    color: _onlyWithStock ? AppTheme.neonGreen : Colors.white70,
                    fontSize: 12,
                  ),
                  side: BorderSide(
                    color: _onlyWithStock
                        ? AppTheme.neonGreen
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

  Widget _buildTypeChip(String value, String label) {
    final selected = _typeFilter == value;
    return FilterChip(
      label: Text(label),
      selected: selected,
      selectedColor: AppTheme.neonBlue.withOpacity(0.2),
      backgroundColor: AppTheme.darkCard,
      labelStyle: TextStyle(
        color: selected ? AppTheme.neonBlue : Colors.white70,
        fontSize: 12,
      ),
      side: BorderSide(
        color: selected ? AppTheme.neonBlue : AppTheme.borderColor,
      ),
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
      onSelected: (_) => setState(() => _typeFilter = value),
    );
  }

  Widget _buildPromoCard(_PromotionGroup group) {
    final isGift = group.promoType == 'GIFT';
    final accentColor = isGift ? AppTheme.neonPurple : AppTheme.neonGreen;
    final first = group.items.first;

    return Card(
      color: AppTheme.darkCard,
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: accentColor.withOpacity(0.35)),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: group.items.length == 1
            ? () => widget.onProductTap(first.code, first.name)
            : null,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    isGift ? Icons.card_giftcard : Icons.local_offer,
                    color: accentColor,
                    size: 18,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      group.promoDesc.isNotEmpty
                          ? group.promoDesc
                          : (isGift ? 'Promoción regalo' : 'Promoción precio'),
                      style: TextStyle(
                        color: accentColor,
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: accentColor.withOpacity(0.15),
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
              const SizedBox(height: 6),
              if (!isGift)
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    Text(
                      'Oferta: ${PedidosFormatters.money(group.promoPrice, decimals: 3)}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (group.regularPrice > 0)
                      Text(
                        'Tarifa: ${PedidosFormatters.money(group.regularPrice, decimals: 3)}',
                        style: const TextStyle(
                          color: Colors.white54,
                          fontSize: 12,
                        ),
                      ),
                    if (group.discountPct > 0)
                      Text(
                        '-${PedidosFormatters.number(group.discountPct, decimals: 1)}%',
                        style: const TextStyle(
                          color: AppTheme.neonGreen,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                  ],
                ),
              const SizedBox(height: 4),
              Text(
                'Afecta a ${group.items.length} producto(s)',
                style: const TextStyle(color: Colors.white54, fontSize: 12),
              ),
              if (group.dateTo.isNotEmpty && group.dateTo != '0/0/0') ...[
                const SizedBox(height: 2),
                Text(
                  'Válida hasta ${group.dateTo}',
                  style: const TextStyle(color: Colors.white38, fontSize: 11),
                ),
              ],
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  ...group.items.take(8).map((item) {
                    final hasStock = widget.hasStockResolver?.call(item.code) ??
                        item.hasStock;
                    final stockColor = hasStock == true
                        ? AppTheme.neonGreen
                        : hasStock == false
                            ? AppTheme.error
                            : Colors.white38;

                    return ActionChip(
                      onPressed: () =>
                          widget.onProductTap(item.code, item.name),
                      backgroundColor: AppTheme.darkSurface,
                      side: BorderSide(color: stockColor.withOpacity(0.45)),
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
                          color: Colors.white70,
                          fontSize: 11,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    );
                  }),
                  if (group.items.length > 8)
                    Chip(
                      backgroundColor: AppTheme.darkSurface,
                      side: BorderSide(color: AppTheme.borderColor),
                      label: Text(
                        '+${group.items.length - 8} más',
                        style: const TextStyle(
                            color: Colors.white54, fontSize: 11),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<_PromotionGroup> _buildGroups(List<PromotionItem> promos) {
    final grouped = <String, List<PromotionItem>>{};

    for (final p in promos) {
      final key =
          '${p.promoType}|${p.promoDesc}|${p.promoPrice}|${p.regularPrice}|${p.dateFrom}|${p.dateTo}';
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
    if (group.items.any((i) =>
        i.code.toLowerCase().contains(q) || i.name.toLowerCase().contains(q))) {
      return true;
    }
    return false;
  }
}

class _PromotionGroup {
  final String key;
  final List<PromotionItem> items;

  _PromotionGroup({
    required this.key,
    required this.items,
  });

  String get promoType => items.first.promoType;
  String get promoDesc => items.first.promoDesc;
  double get promoPrice => items.first.promoPrice;
  double get regularPrice => items.first.regularPrice;
  String get dateFrom => items.first.dateFrom;
  String get dateTo => items.first.dateTo;

  double get discountPct {
    if (regularPrice <= 0 || promoPrice <= 0 || promoPrice >= regularPrice) {
      return 0;
    }
    return ((regularPrice - promoPrice) / regularPrice) * 100;
  }
}
