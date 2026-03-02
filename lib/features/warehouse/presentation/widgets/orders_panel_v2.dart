import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../application/load_planner_provider.dart';
import '../../domain/models/load_planner_models.dart';

/// Side panel with 3 tabs: Clients summary, Products, Overflow.
/// Supports search, exclude/include toggles, and drag-to-restore.
class OrdersPanelV2 extends StatefulWidget {
  const OrdersPanelV2({super.key});

  @override
  State<OrdersPanelV2> createState() => _OrdersPanelV2State();
}

class _OrdersPanelV2State extends State<OrdersPanelV2>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _searchQuery = '';

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

  @override
  Widget build(BuildContext context) {
    return Consumer<LoadPlannerProvider>(
      builder: (context, provider, _) {
        return Container(
          decoration: BoxDecoration(
            color: AppTheme.darkSurface,
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

              // Tabs
              TabBar(
                controller: _tabController,
                labelColor: AppTheme.neonBlue,
                unselectedLabelColor: AppTheme.textTertiary,
                indicatorColor: AppTheme.neonBlue,
                indicatorWeight: 2,
                labelStyle: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
                tabs: [
                  Tab(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.people, size: 14),
                        const SizedBox(width: 4),
                        Text(
                          'Clientes (${provider.clientSummaries.length})',
                        ),
                      ],
                    ),
                  ),
                  Tab(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.inventory_2, size: 14),
                        const SizedBox(width: 4),
                        Text('Cajas (${provider.placedBoxes.length})'),
                      ],
                    ),
                  ),
                  Tab(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.warning_rounded,
                          size: 14,
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
      padding: const EdgeInsets.all(8),
      child: TextField(
        onChanged: (v) => setState(() => _searchQuery = v.toLowerCase()),
        style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary),
        decoration: InputDecoration(
          hintText: 'Buscar articulo, cliente...',
          hintStyle: TextStyle(
            color: AppTheme.textTertiary.withOpacity(0.5),
            fontSize: 12,
          ),
          prefixIcon: const Icon(Icons.search, size: 18),
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          filled: true,
          fillColor: AppTheme.darkCard.withOpacity(0.5),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENTS TAB
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildClientsTab(LoadPlannerProvider provider) {
    final summaries = provider.clientSummaries.where((s) {
      if (_searchQuery.isEmpty) return true;
      return s.clientCode.toLowerCase().contains(_searchQuery);
    }).toList();

    if (summaries.isEmpty) return _emptyState('Sin clientes');

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: summaries.length,
      itemBuilder: (_, i) {
        final s = summaries[i];
        return _ClientRow(summary: s, truck: provider.truck);
      },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOXES TAB — individual boxes with order exclusion
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildBoxesTab(LoadPlannerProvider provider) {
    // Group by order number
    final orderMap = <int, List<LoadBox>>{};
    for (final box in provider.placedBoxes) {
      orderMap.putIfAbsent(box.orderNumber, () => []).add(box);
    }
    // Also include excluded orders (from overflow)
    for (final box in provider.overflowBoxes) {
      if (provider.isOrderExcluded(box.orderNumber)) {
        orderMap.putIfAbsent(box.orderNumber, () => []).add(box);
      }
    }

    final orders = orderMap.entries.where((e) {
      if (_searchQuery.isEmpty) return true;
      return e.value.any((b) =>
          b.label.toLowerCase().contains(_searchQuery) ||
          b.clientCode.toLowerCase().contains(_searchQuery) ||
          b.articleCode.toLowerCase().contains(_searchQuery));
    }).toList();

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
      if (_searchQuery.isEmpty) return true;
      return b.label.toLowerCase().contains(_searchQuery) ||
          b.clientCode.toLowerCase().contains(_searchQuery);
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
          Icon(
            Icons.inbox_outlined,
            size: 32,
            color: AppTheme.textTertiary.withOpacity(0.3),
          ),
          const SizedBox(height: 8),
          Text(
            message,
            style: TextStyle(
              color: AppTheme.textTertiary.withOpacity(0.5),
              fontSize: 13,
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

class _ClientRow extends StatelessWidget {
  final ClientSummary summary;
  final TruckDimensions? truck;

  const _ClientRow({required this.summary, this.truck});

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
          color: AppTheme.darkCard.withOpacity(0.4),
          borderRadius: BorderRadius.circular(8),
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
      child: Opacity(
        opacity: isExcluded ? 0.4 : 1.0,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: AppTheme.darkCard.withOpacity(0.3),
            borderRadius: BorderRadius.circular(8),
            border: isExcluded
                ? Border.all(color: AppTheme.error.withOpacity(0.3), width: 1)
                : null,
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
