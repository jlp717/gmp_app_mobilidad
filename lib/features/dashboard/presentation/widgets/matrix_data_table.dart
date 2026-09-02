import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';

/// Node for Hierarchical Data
class MatrixNode {
  MatrixNode({
    required this.id,
    required this.name,
    required this.type,
    required this.sales,
    required this.margin,
    required this.growth,
    this.orders = 0,
    this.children = const [],
    this.isExpanded = false,
  });

  factory MatrixNode.fromJson(Map<String, dynamic> json) {
    return MatrixNode(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      type: json['type']?.toString() ?? '',
      sales: (json['sales'] as num?)?.toDouble() ?? 0.0,
      margin: (json['margin'] as num?)?.toDouble() ?? 0.0,
      growth: (json['growth'] as num?)?.toDouble() ?? 0.0,
      orders: (json['orders'] as num?)?.toInt() ?? 0,
      children: (json['children'] as List<dynamic>?)
              ?.map((e) => MatrixNode.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      isExpanded: json['isExpanded'] == true,
    );
  }

  static List<MatrixNode> fromJsonList(dynamic data) {
    if (data == null) return [];
    if (data is List) {
      return data
          .map((e) => MatrixNode.fromJson(e as Map<String, dynamic>))
          .toList();
    }
    return [];
  }

  final String id;
  final String name;
  final String
      type; // 'vendor', 'client', 'product', 'family', 'productCode', 'productDesc', 'family1'-'family5'
  final double sales;
  final double margin;
  final double growth;
  final int orders;
  final List<MatrixNode> children;
  bool isExpanded;

  // Calculate accumulated margin (self + all children recursively)
  double get accumulatedMargin {
    var acc = margin;
    for (final child in children) {
      acc += child.accumulatedMargin;
    }
    return acc;
  }

  double get accumulatedSales {
    var acc = sales;
    for (final child in children) {
      acc += child.accumulatedSales;
    }
    return acc;
  }

  int get accumulatedOrders {
    var acc = orders;
    for (final child in children) {
      acc += child.accumulatedOrders;
    }
    return acc;
  }
}

/// Tree-style expandable data table
/// Children expand WITHIN the same table, indented
class MatrixDataTable extends StatefulWidget {
  const MatrixDataTable({
    required this.data,
    required this.periods,
    required this.onRowTap,
    super.key,
    this.onNodeTap,
    this.selectedId,
  });
  final List<MatrixNode> data;
  final List<String> periods;
  final Function(String, String) onRowTap;
  final Function(MatrixNode)? onNodeTap;
  final String? selectedId;

  @override
  State<MatrixDataTable> createState() => _MatrixDataTableState();
}

class _MatrixDataTableState extends State<MatrixDataTable> {
  // Flattened visible rows (node, level) cached per data instance: expanding
  // a vendor with hundreds of clients used to recursively materialize every
  // row of the expanded subtree in one Column inside a SingleChildScrollView —
  // no builder, no laziness. The flat list at least bounds the work to the
  // actually-visible tree and keeps one widget per row instead of nested
  // Columns per level.
  List<MapEntry<MatrixNode, int>>? _flatCache;
  List<MatrixNode>? _flatCacheSource;

  List<MapEntry<MatrixNode, int>> _flatRows() {
    if (_flatCache != null && identical(_flatCacheSource, widget.data)) {
      return _flatCache!;
    }
    final rows = <MapEntry<MatrixNode, int>>[];
    void walk(MatrixNode node, int level) {
      rows.add(MapEntry(node, level));
      if (node.isExpanded && node.children.isNotEmpty) {
        for (final child in node.children) {
          walk(child, level + 1);
        }
      }
    }

    for (final node in widget.data) {
      walk(node, 0);
    }
    _flatCache = rows;
    _flatCacheSource = widget.data;
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    if (widget.data.isEmpty) {
      return Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'No hay datos para esta selección',
            style: TextStyle(color: AppTheme.textTertiary),
          ),
        ),
      );
    }

    return Card(
      elevation: 0,
      shadowColor: AppColors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusXl),
        side: BorderSide(color: AppTheme.info.withValues(alpha: 0.16)),
      ),
      color: AppColors.transparent,
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppTheme.raisedSurface,
              AppTheme.softPanel.withValues(alpha: 0.90),
            ],
          ),
          borderRadius: BorderRadius.circular(AppTheme.radiusXl),
          boxShadow: AppTheme.elevation2,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header with new columns: ITEM, VENTA, MARG%, PEDIDOS
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: AppTheme.info.withValues(alpha: 0.2),
                  ),
                ),
                color: AppTheme.info.withValues(alpha: 0.06),
              ),
              child: const Row(
                children: [
                  Expanded(
                    flex: 5,
                    child: Text(
                      'ITEM',
                      style: TextStyle(
                        color: AppTheme.info,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0,
                      ),
                    ),
                  ),
                  Expanded(
                    flex: 3,
                    child: Text(
                      'VENTA',
                      textAlign: TextAlign.right,
                      style: TextStyle(
                        color: AppTheme.info,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0,
                      ),
                    ),
                  ),
                  Expanded(
                    flex: 2,
                    child: Text(
                      'MARG %',
                      textAlign: TextAlign.right,
                      style: TextStyle(
                        color: AppTheme.info,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0,
                      ),
                    ),
                  ),
                  Expanded(
                    flex: 2,
                    child: Text(
                      'PEDIDOS',
                      textAlign: TextAlign.right,
                      style: TextStyle(
                        color: AppTheme.info,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Tree List — one flat Column of rows (see _flatRows note).
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final row in _flatRows())
                  RepaintBoundary(child: _buildNodeRow(row.key, row.value)),
              ],
            ),

            // TOTAL ROW (ORANGE)
            _buildTotalRow(),
          ],
        ),
      ),
    );
  }

  Widget _buildTotalRow() {
    double totalSales = 0;
    double totalMargin = 0;
    var totalOrders = 0;
    for (final node in widget.data) {
      totalSales += node.sales;
      totalMargin += node.margin;
      totalOrders += node.accumulatedOrders;
    }
    final marginPct = totalSales > 0 ? (totalMargin / totalSales) * 100 : 0.0;

    // TOTAL ROW - Orange background for distinction
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.warning.withValues(alpha: 0.12),
        border: Border(
          top: BorderSide(
            color: AppTheme.warning.withValues(alpha: 0.5),
            width: 2,
          ),
        ),
      ),
      child: Row(
        children: [
          const Expanded(
            flex: 5,
            child: Row(
              children: [
                Icon(Icons.summarize, color: AppTheme.warning, size: 16),
                SizedBox(width: 6),
                Text(
                  'TOTAL',
                  style: TextStyle(
                    color: AppTheme.warning,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            flex: 3,
            child: Text(
              CurrencyFormatter.format(totalSales),
              textAlign: TextAlign.right,
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          // MARG column - show % not €
          Expanded(
            flex: 2,
            child: Text(
              '${marginPct.toStringAsFixed(1)}%',
              textAlign: TextAlign.right,
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            ),
          ),
          // PEDIDOS column - total order count
          Expanded(
            flex: 2,
            child: Text(
              totalOrders.toString(),
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: AppTheme.warning,
                fontSize: 12,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _toggleExpand(MatrixNode node) {
    setState(() {
      node.isExpanded = !node.isExpanded;
      // Expansion mutates nodes in place, so the flat-row cache must be
      // dropped manually — the widget.data list identity stays the same.
      _flatCache = null;
      _flatCacheSource = null;
    });
  }

  Widget _buildNodeRow(MatrixNode node, int level) {
    final marginPercent =
        node.sales > 0 ? (node.margin / node.sales) * 100 : 0.0;
    final marginColor = marginPercent > 20
        ? AppTheme.success
        : (marginPercent > 10 ? AppTheme.accentAmber : AppTheme.error);

    // Level colors for visual hierarchy
    final levelColors = [
      AppTheme.info,
      AppTheme.accentIndigo,
      AppTheme.success,
      AppColors.teal,
      AppColors.neonPink,
    ];
    final levelColor = levelColors[level % levelColors.length];

    // Calculate accumulated margin for THIS node (self + children)
    final accMargin = node.accumulatedMargin;
    final accSales = node.accumulatedSales;
    final accMarginPct = accSales > 0 ? (accMargin / accSales) * 100 : 0.0;

    final hasChildren = node.children.isNotEmpty;
    final isSelected = widget.selectedId == node.id;

    return InkWell(
      onTap: () {
        if (hasChildren) {
          // Toggle expansion within this table
          _toggleExpand(node);
        }
        // Also notify parent if needed
        if (widget.onNodeTap != null) {
          widget.onNodeTap!(node);
        }
      },
      child: Container(
        padding: EdgeInsets.only(
          left: 12 + (level * 20.0), // Indentation per level
          right: 12,
          top: 10,
          bottom: 10,
        ),
        decoration: BoxDecoration(
          color: isSelected
              ? levelColor.withValues(alpha: 0.16)
              : (level > 0
                  ? AppTheme.textPrimary.withValues(alpha: 0.025 * level)
                  : AppTheme.textPrimary.withValues(alpha: 0.01)),
          border: Border(
            bottom: BorderSide(color: AppTheme.textPrimary.withValues(alpha: 0.05)),
            left: BorderSide(
              color: levelColor.withValues(alpha: level == 0 ? 0.26 : 0.38),
              width: level == 0 ? 3 : 2,
            ),
          ),
        ),
        child: Row(
          children: [
            // Expand icon or dot
            if (hasChildren)
              GestureDetector(
                onTap: () => _toggleExpand(node),
                child: Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Icon(
                    node.isExpanded
                        ? Icons.keyboard_arrow_down
                        : Icons.keyboard_arrow_right,
                    size: 18,
                    color: node.isExpanded ? levelColor : AppTheme.textTertiary,
                  ),
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Icon(
                  Icons.circle,
                  size: 6,
                  color: levelColor.withValues(alpha: 0.5),
                ),
              ),

            // Name
            Expanded(
              flex: 5,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    node.name,
                    style: TextStyle(
                      color: level == 0 ? AppTheme.textPrimary : AppTheme.textSecondary,
                      fontWeight:
                          level == 0 ? FontWeight.bold : FontWeight.normal,
                      fontSize: level == 0 ? 14 : 13,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (hasChildren && level == 0)
                    Text(
                      '${node.children.length} items',
                      style: TextStyle(
                        color: levelColor.withValues(alpha: 0.6),
                        fontSize: 10,
                      ),
                    ),
                ],
              ),
            ),

            // Sales
            Expanded(
              flex: 3,
              child: Text(
                CurrencyFormatter.format(node.sales),
                textAlign: TextAlign.right,
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: level == 0 ? 13 : 12,
                  fontWeight: level == 0 ? FontWeight.bold : FontWeight.normal,
                ),
              ),
            ),

            // Margin
            Expanded(
              flex: 2,
              child: Text(
                '${marginPercent.toStringAsFixed(1)}%',
                textAlign: TextAlign.right,
                style: TextStyle(color: marginColor, fontSize: 11),
              ),
            ),

            // PEDIDOS – order count for this node
            Expanded(
              flex: 2,
              child: Builder(
                builder: (context) {
                  // Show accumulated orders for parent nodes, direct orders for leaf nodes
                  final displayOrders =
                      hasChildren ? node.accumulatedOrders : node.orders;
                  return Text(
                    displayOrders.toString(),
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      color: hasChildren ? levelColor : AppTheme.textSecondary,
                      fontSize: 12,
                      fontWeight:
                          hasChildren ? FontWeight.bold : FontWeight.normal,
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
