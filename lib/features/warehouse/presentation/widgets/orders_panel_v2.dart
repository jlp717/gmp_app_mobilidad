import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../application/load_planner_provider.dart';
import '../../domain/models/load_planner_models.dart';

/// Sort options for boxes/orders
enum BoxSortMode { none, weightDesc, weightAsc, volumeDesc, client, order }

/// Side panel with 3 tabs: Clients summary, Products, Overflow.
/// Supports search, exclude/include toggles, bulk operations, sort and filters.
class OrdersPanelV2 extends StatefulWidget {
  const OrdersPanelV2({super.key});

  @override
  State<OrdersPanelV2> createState() => _OrdersPanelV2State();
}

class _OrdersPanelV2State extends State<OrdersPanelV2>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _searchQuery = '';
  BoxSortMode _sortMode = BoxSortMode.none;

  // Filters
  bool _filterHeavy = false; // >15kg
  bool _filterMedium = false; // 5-15kg
  bool _filterLight = false; // <5kg

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  /// Token-based search: splits query into words, ALL must match
  bool _matchesSearch(String text) {
    if (_searchQuery.isEmpty) return true;
    final tokens = _searchQuery.split(RegExp(r'\s+'));
    final lower = text.toLowerCase();
    return tokens.every((t) => lower.contains(t));
  }

  /// Check if a box passes weight filter
  bool _passesWeightFilter(double weight) {
    if (!_filterHeavy && !_filterMedium && !_filterLight) return true;
    if (_filterHeavy && weight > 15) return true;
    if (_filterMedium && weight >= 5 && weight <= 15) return true;
    if (_filterLight && weight < 5) return true;
    return false;
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<LoadPlannerProvider>(
      builder: (context, provider, _) {
        return Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                AppTheme.darkSurface,
                AppTheme.darkBase.withOpacity(0.95),
              ],
            ),
            border: Border(
              left: BorderSide(
                color: AppTheme.neonBlue.withOpacity(0.15),
                width: 1,
              ),
            ),
          ),
          child: Column(
            children: [
              // Search bar
              _buildSearchBar(),

              // Bulk action buttons
              _buildBulkActions(provider),

              // Filter chips
              _buildFilterChips(),

              // Sort dropdown
              _buildSortRow(),

              // Premium pill tabs
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(
                  color: AppTheme.darkCard.withOpacity(0.25),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: AppTheme.borderColor.withOpacity(0.15),
                    width: 1,
                  ),
                ),
                child: TabBar(
                  controller: _tabController,
                  labelColor: AppTheme.neonBlue,
                  unselectedLabelColor: AppTheme.textTertiary,
                  indicator: BoxDecoration(
                    color: AppTheme.neonBlue.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: AppTheme.neonBlue.withOpacity(0.25),
                      width: 1,
                    ),
                  ),
                  indicatorSize: TabBarIndicatorSize.tab,
                  dividerColor: Colors.transparent,
                  splashFactory: NoSplash.splashFactory,
                  labelStyle: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                  unselectedLabelStyle: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w400,
                  ),
                  tabs: [
                    Tab(
                      height: 30,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.people_rounded, size: 13),
                          const SizedBox(width: 4),
                          Text(
                            'Clientes (${provider.clientSummaries.length})',
                          ),
                        ],
                      ),
                    ),
                    Tab(
                      height: 30,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.inventory_2_rounded, size: 13),
                          const SizedBox(width: 4),
                          Text('Cajas (${provider.placedBoxes.length})'),
                        ],
                      ),
                    ),
                    Tab(
                      height: 30,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.warning_rounded,
                            size: 13,
                            color: provider.overflowBoxes.isNotEmpty
                                ? AppTheme.error
                                : null,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'Fuera (${provider.overflowBoxes.length})',
                            style: TextStyle(
                              color: provider.overflowBoxes.isNotEmpty
                                  ? AppTheme.error
                                  : null,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              // Tab content
              Expanded(
                child: TabBarView(
                  controller: _tabController,
                  children: [
                    _buildClientsTab(provider),
                    _buildBoxesTab(provider),
                    _buildOverflowTab(provider),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: AppTheme.neonBlue.withOpacity(0.1),
            width: 1,
          ),
          boxShadow: [
            BoxShadow(
              color: AppTheme.neonBlue.withOpacity(0.03),
              blurRadius: 8,
            ),
          ],
        ),
        child: TextField(
          onChanged: (v) => setState(() => _searchQuery = v.toLowerCase().trim()),
          style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary),
          decoration: InputDecoration(
            hintText: 'Buscar artículo, cliente, pedido...',
            hintStyle: TextStyle(
              color: AppTheme.textTertiary.withOpacity(0.4),
              fontSize: 12,
            ),
            prefixIcon: Icon(
              Icons.search_rounded,
              size: 18,
              color: AppTheme.neonBlue.withOpacity(0.5),
            ),
            suffixIcon: _searchQuery.isNotEmpty
                ? IconButton(
                    icon: const Icon(Icons.clear_rounded, size: 16),
                    onPressed: () => setState(() => _searchQuery = ''),
                  )
                : null,
            isDense: true,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            filled: true,
            fillColor: AppTheme.darkCard.withOpacity(0.3),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide.none,
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(
                color: AppTheme.neonBlue.withOpacity(0.3),
                width: 1,
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BULK ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildBulkActions(LoadPlannerProvider provider) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: _MiniActionButton(
              icon: Icons.remove_circle_outline,
              label: 'Quitar todo',
              color: AppTheme.error,
              onPressed: provider.placedBoxes.isNotEmpty
                  ? () => _confirmBulkAction(
                        context,
                        'Quitar todas las cajas del camion?',
                        provider.excludeAllOrders,
                      )
                  : null,
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: _MiniActionButton(
              icon: Icons.add_circle_outline,
              label: 'Añadir todo',
              color: AppTheme.neonGreen,
              onPressed: provider.overflowBoxes.isNotEmpty
                  ? provider.includeAllOrders
                  : null,
            ),
          ),
        ],
      ),
    );
  }

  void _confirmBulkAction(
    BuildContext context,
    String message,
    VoidCallback action,
  ) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        title: const Text('Confirmar'),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              action();
            },
            child: Text('Confirmar', style: TextStyle(color: AppTheme.error)),
          ),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILTER CHIPS
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildFilterChips() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _FilterChip(
              label: 'Pesado (>15kg)',
              selected: _filterHeavy,
              color: AppTheme.error,
              onSelected: (v) => setState(() => _filterHeavy = v),
            ),
            const SizedBox(width: 4),
            _FilterChip(
              label: 'Medio (5-15kg)',
              selected: _filterMedium,
              color: AppTheme.warning,
              onSelected: (v) => setState(() => _filterMedium = v),
            ),
            const SizedBox(width: 4),
            _FilterChip(
              label: 'Ligero (<5kg)',
              selected: _filterLight,
              color: AppTheme.neonGreen,
              onSelected: (v) => setState(() => _filterLight = v),
            ),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SORT ROW
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildSortRow() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: Row(
        children: [
          const Icon(Icons.sort, size: 14, color: AppTheme.textTertiary),
          const SizedBox(width: 4),
          Expanded(
            child: DropdownButton<BoxSortMode>(
              value: _sortMode,
              isDense: true,
              isExpanded: true,
              dropdownColor: AppTheme.darkCard,
              style: const TextStyle(
                fontSize: 11,
                color: AppTheme.textSecondary,
              ),
              underline: const SizedBox.shrink(),
              items: const [
                DropdownMenuItem(
                  value: BoxSortMode.none,
                  child: Text('Sin ordenar'),
                ),
                DropdownMenuItem(
                  value: BoxSortMode.weightDesc,
                  child: Text('Peso (mayor a menor)'),
                ),
                DropdownMenuItem(
                  value: BoxSortMode.weightAsc,
                  child: Text('Peso (menor a mayor)'),
                ),
                DropdownMenuItem(
                  value: BoxSortMode.volumeDesc,
                  child: Text('Volumen (mayor a menor)'),
                ),
                DropdownMenuItem(
                  value: BoxSortMode.client,
                  child: Text('Cliente'),
                ),
                DropdownMenuItem(
                  value: BoxSortMode.order,
                  child: Text('N° Pedido'),
                ),
              ],
              onChanged: (v) => setState(() => _sortMode = v ?? BoxSortMode.none),
            ),
          ),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SORT HELPER
  // ═══════════════════════════════════════════════════════════════════════════

  List<MapEntry<int, List<LoadBox>>> _sortOrders(
      List<MapEntry<int, List<LoadBox>>> orders) {
    switch (_sortMode) {
      case BoxSortMode.weightDesc:
        orders.sort((a, b) {
          final wa = a.value.fold<double>(0, (s, box) => s + box.weight);
          final wb = b.value.fold<double>(0, (s, box) => s + box.weight);
          return wb.compareTo(wa);
        });
      case BoxSortMode.weightAsc:
        orders.sort((a, b) {
          final wa = a.value.fold<double>(0, (s, box) => s + box.weight);
          final wb = b.value.fold<double>(0, (s, box) => s + box.weight);
          return wa.compareTo(wb);
        });
      case BoxSortMode.volumeDesc:
        orders.sort((a, b) {
          final va = a.value.fold<double>(0, (s, box) => s + box.volume);
          final vb = b.value.fold<double>(0, (s, box) => s + box.volume);
          return vb.compareTo(va);
        });
      case BoxSortMode.client:
        orders.sort(
            (a, b) => a.value.first.clientCode.compareTo(b.value.first.clientCode));
      case BoxSortMode.order:
        orders.sort((a, b) => a.key.compareTo(b.key));
      case BoxSortMode.none:
        break;
    }
    return orders;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENTS TAB
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildClientsTab(LoadPlannerProvider provider) {
    final summaries = provider.clientSummaries.where((s) {
      if (!_matchesSearch(s.clientCode)) return false;
      return true;
    }).toList();

    if (summaries.isEmpty) return _emptyState('Sin clientes');

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: summaries.length,
      itemBuilder: (_, i) {
        final s = summaries[i];
        return _ClientRow(
          summary: s,
          truck: provider.truck,
          onExclude: () => provider.excludeByClient(s.clientCode),
        );
      },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOXES TAB
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildBoxesTab(LoadPlannerProvider provider) {
    // Group by order number
    final orderMap = <int, List<LoadBox>>{};
    for (final box in provider.placedBoxes) {
      orderMap.putIfAbsent(box.orderNumber, () => []).add(box);
    }
    for (final box in provider.overflowBoxes) {
      if (provider.isOrderExcluded(box.orderNumber)) {
        orderMap.putIfAbsent(box.orderNumber, () => []).add(box);
      }
    }

    var orders = orderMap.entries.where((e) {
      // Token-based search across label, client, article, order number
      final searchText =
          '${e.value.first.label} ${e.value.first.clientCode} ${e.value.first.articleCode} ${e.key}';
      if (!_matchesSearch(searchText)) return false;

      // Weight filter
      final totalWeight = e.value.fold<double>(0, (s, b) => s + b.weight);
      final avgWeight = totalWeight / e.value.length;
      if (!_passesWeightFilter(avgWeight)) return false;

      return true;
    }).toList();

    orders = _sortOrders(orders);

    if (orders.isEmpty) return _emptyState('Sin cajas');

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: orders.length,
      itemBuilder: (_, i) {
        final entry = orders[i];
        final isExcluded = provider.isOrderExcluded(entry.key);
        final firstBox = entry.value.first;
        final totalWeight =
            entry.value.fold<double>(0, (s, b) => s + b.weight);

        return _OrderRow(
          orderNumber: entry.key,
          label: firstBox.label,
          clientCode: firstBox.clientCode,
          boxCount: entry.value.length,
          totalWeight: totalWeight,
          isExcluded: isExcluded,
          onToggle: () {
            if (isExcluded) {
              provider.includeOrder(entry.key);
            } else {
              provider.excludeOrder(entry.key);
            }
          },
        );
      },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OVERFLOW TAB
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildOverflowTab(LoadPlannerProvider provider) {
    final overflow = provider.overflowBoxes.where((b) {
      final searchText = '${b.label} ${b.clientCode} ${b.orderNumber}';
      if (!_matchesSearch(searchText)) return false;
      if (!_passesWeightFilter(b.weight)) return false;
      return true;
    }).toList();

    if (overflow.isEmpty) {
      return _emptyState('Todo cabe en el camion');
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: overflow.length,
      itemBuilder: (_, i) {
        final box = overflow[i];
        return ListTile(
          dense: true,
          leading: Icon(
            Icons.warning_rounded,
            size: 16,
            color: AppTheme.error.withOpacity(0.7),
          ),
          title: Text(
            box.label,
            style: const TextStyle(
              fontSize: 12,
              color: AppTheme.textSecondary,
            ),
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(
            '${box.weight.toStringAsFixed(1)} kg  |  ${box.clientCode}',
            style: const TextStyle(
              fontSize: 10,
              color: AppTheme.textTertiary,
            ),
          ),
          trailing: Text(
            '#${box.orderNumber}',
            style: const TextStyle(
              fontSize: 10,
              color: AppTheme.textTertiary,
            ),
          ),
        );
      },
    );
  }

  Widget _emptyState(String message) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppTheme.darkCard.withOpacity(0.2),
              border: Border.all(
                color: AppTheme.borderColor.withOpacity(0.15),
                width: 1,
              ),
            ),
            child: Icon(
              Icons.inbox_outlined,
              size: 28,
              color: AppTheme.textTertiary.withOpacity(0.3),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            message,
            style: TextStyle(
              color: AppTheme.textTertiary.withOpacity(0.5),
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-WIDGETS
// ═══════════════════════════════════════════════════════════════════════════════

class _MiniActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback? onPressed;

  const _MiniActionButton({
    required this.icon,
    required this.label,
    required this.color,
    this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    final isEnabled = onPressed != null;
    return GestureDetector(
      onTap: () {
        if (isEnabled) {
          HapticFeedback.lightImpact();
          onPressed!();
        }
      },
      child: AnimatedContainer(
        duration: AppTheme.animFast,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: isEnabled
              ? color.withOpacity(0.08)
              : AppTheme.darkCard.withOpacity(0.15),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isEnabled
                ? color.withOpacity(0.25)
                : AppTheme.borderColor.withOpacity(0.08),
            width: 1,
          ),
          boxShadow: isEnabled
              ? [
                  BoxShadow(
                    color: color.withOpacity(0.06),
                    blurRadius: 8,
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 13,
              color: isEnabled ? color : AppTheme.textTertiary.withOpacity(0.3),
            ),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color:
                    isEnabled ? color : AppTheme.textTertiary.withOpacity(0.3),
                letterSpacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final Color color;
  final ValueChanged<bool> onSelected;

  const _FilterChip({
    required this.label,
    required this.selected,
    required this.color,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        onSelected(!selected);
      },
      child: AnimatedContainer(
        duration: AppTheme.animFast,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: selected ? color.withOpacity(0.12) : Colors.transparent,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected
                ? color.withOpacity(0.4)
                : AppTheme.borderColor.withOpacity(0.2),
            width: 1,
          ),
          boxShadow: selected
              ? [
                  BoxShadow(
                    color: color.withOpacity(0.08),
                    blurRadius: 6,
                  ),
                ]
              : null,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 10,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            color: selected ? color : AppTheme.textTertiary,
            letterSpacing: 0.1,
          ),
        ),
      ),
    );
  }
}

class _ClientRow extends StatelessWidget {
  final ClientSummary summary;
  final TruckDimensions? truck;
  final VoidCallback? onExclude;

  const _ClientRow({required this.summary, this.truck, this.onExclude});

  @override
  Widget build(BuildContext context) {
    final weightPct = truck != null && truck!.maxPayloadKg > 0
        ? (summary.totalWeight / truck!.maxPayloadKg * 100)
        : 0.0;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppTheme.darkCard.withOpacity(0.25),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: AppTheme.borderColor.withOpacity(0.1),
            width: 1,
          ),
        ),
        child: Row(
          children: [
            // Client icon
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withOpacity(0.15),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Center(
                child: Text(
                  summary.clientCode.length > 2
                      ? summary.clientCode.substring(0, 2)
                      : summary.clientCode,
                  style: const TextStyle(
                    color: AppTheme.neonBlue,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),

            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    summary.clientCode,
                    style: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${summary.boxCount} cajas  |  ${summary.totalWeight.toStringAsFixed(1)} kg',
                    style: const TextStyle(
                      color: AppTheme.textTertiary,
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ),

            // Weight share bar
            SizedBox(
              width: 40,
              child: Column(
                children: [
                  Text(
                    '${weightPct.toStringAsFixed(0)}%',
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: LinearProgressIndicator(
                      value: (weightPct / 100).clamp(0, 1),
                      minHeight: 3,
                      backgroundColor: AppTheme.darkCard,
                      valueColor: AlwaysStoppedAnimation(
                        weightPct > 30
                            ? AppTheme.warning
                            : AppTheme.neonBlue,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Exclude client button
            if (onExclude != null) ...[
              const SizedBox(width: 4),
              InkWell(
                onTap: onExclude,
                borderRadius: BorderRadius.circular(4),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Icon(
                    Icons.remove_circle_outline,
                    size: 16,
                    color: AppTheme.error.withOpacity(0.6),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _OrderRow extends StatelessWidget {
  final int orderNumber;
  final String label;
  final String clientCode;
  final int boxCount;
  final double totalWeight;
  final bool isExcluded;
  final VoidCallback onToggle;

  const _OrderRow({
    required this.orderNumber,
    required this.label,
    required this.clientCode,
    required this.boxCount,
    required this.totalWeight,
    required this.isExcluded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: AnimatedOpacity(
        duration: AppTheme.animFast,
        opacity: isExcluded ? 0.35 : 1.0,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: isExcluded
                ? AppTheme.darkCard.withOpacity(0.15)
                : AppTheme.darkCard.withOpacity(0.25),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isExcluded
                  ? AppTheme.error.withOpacity(0.25)
                  : AppTheme.borderColor.withOpacity(0.1),
              width: 1,
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: isExcluded
                            ? AppTheme.textTertiary
                            : AppTheme.textPrimary,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        decoration:
                            isExcluded ? TextDecoration.lineThrough : null,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$clientCode  |  $boxCount cajas  |  ${totalWeight.toStringAsFixed(1)} kg',
                      style: const TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 10,
                      ),
                    ),
                  ],
                ),
              ),
              // Toggle switch
              SizedBox(
                height: 24,
                child: Switch(
                  value: !isExcluded,
                  onChanged: (_) => onToggle(),
                  activeColor: AppTheme.neonGreen,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
