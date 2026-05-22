import 'package:flutter/material.dart';
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
    if (data is List) return data.map((e) => MatrixNode.fromJson(e as Map<String, dynamic>)).toList();
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
  @override
  Widget build(BuildContext context) {
    if (widget.data.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text('No hay datos para esta selección',
              style: TextStyle(color: Colors.white30)),
        ),
      );
    }

    return Card(
      elevation: 8,
      shadowColor: Colors.black45,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.white.withValues(alpha: 0.05)),
      ),
      color: AppTheme.surfaceColor,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppTheme.surfaceColor,
              AppTheme.darkBase.withValues(alpha: 0.95),
            ],
          ),
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
                        color: AppTheme.neonBlue.withValues(alpha: 0.2))),
                color: Colors.white.withValues(alpha: 0.02),
              ),
              child: const Row(
                children: [
                  Expanded(
                      flex: 5,
                      child: Text('ITEM',
                          style: TextStyle(
                              color: AppTheme.neonBlue,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1))),
                  Expanded(
                      flex: 3,
                      child: Text('VENTA',
                          textAlign: TextAlign.right,
                          style: TextStyle(
                              color: AppTheme.neonBlue,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1))),
                  Expanded(
                      flex: 2,
                      child: Text('MARG %',
                          textAlign: TextAlign.right,
                          style: TextStyle(
                              color: AppTheme.neonBlue,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1))),
                  Expanded(
                      flex: 2,
                      child: Text('PEDIDOS',
                          textAlign: TextAlign.right,
                          style: TextStyle(
                              color: AppTheme.neonBlue,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1))),
                ],
              ),
            ),

            // Tree List - builds all nodes recursively
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: widget.data.length,
              itemBuilder: (context, index) {
                return _buildNodeWithChildren(widget.data[index], 0);
              },
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
    int totalOrders = 0;
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
        color: Colors.orange.withValues(alpha: 0.15),
        border: Border(
            top: BorderSide(
                color: Colors.orange.withValues(alpha: 0.5), width: 2)),
      ),
      child: Row(
        children: [
          const Expanded(
            flex: 5,
            child: Row(
              children: [
                Icon(Icons.summarize, color: Colors.orange, size: 16),
                SizedBox(width: 6),
                Text('TOTAL',
                    style: TextStyle(
                        color: Colors.orange,
                        fontSize: 13,
                        fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          Expanded(
            flex: 3,
            child: Text(
              CurrencyFormatter.format(totalSales),
              textAlign: TextAlign.right,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.bold),
            ),
          ),
          // MARG column - show % not €
          Expanded(
            flex: 2,
            child: Text(
              '${marginPct.toStringAsFixed(1)}%',
              textAlign: TextAlign.right,
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
          ),
          // PEDIDOS column - total order count
          Expanded(
            flex: 2,
            child: Text(
              totalOrders.toString(),
              textAlign: TextAlign.right,
              style: const TextStyle(
                  color: Colors.orange,
                  fontSize: 12,
                  fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  /// Build a node AND its children if expanded (recursive tree)
  Widget _buildNodeWithChildren(MatrixNode node, int level) {
    final widgets = <Widget>[_buildNodeRow(node, level)];

    // If expanded, add children recursively
    if (node.isExpanded && node.children.isNotEmpty) {
      for (final child in node.children) {
        widgets.add(_buildNodeWithChildren(child, level + 1));
      }
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: widgets,
    );
  }

  Widget _buildNodeRow(MatrixNode node, int level) {
    final marginPercent =
        node.sales > 0 ? (node.margin / node.sales) * 100 : 0.0;
    final marginColor = marginPercent > 20
        ? AppTheme.neonGreen
        : (marginPercent > 10 ? Colors.amber : AppTheme.error);

    // Level colors for visual hierarchy
    final levelColors = [
      AppTheme.neonBlue,
      AppTheme.neonPurple,
      AppTheme.neonGreen,
      Colors.teal,
      Colors.pink
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
          setState(() {
            node.isExpanded = !node.isExpanded;
          });
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
              ? levelColor.withValues(alpha: 0.15)
              : (level > 0
                  ? Colors.white.withValues(alpha: 0.02 * level)
                  : Colors.transparent),
          border: Border(
            bottom: BorderSide(color: Colors.white.withValues(alpha: 0.05)),
            left: level > 0
                ? BorderSide(color: levelColor.withValues(alpha: 0.3), width: 2)
                : BorderSide.none,
          ),
        ),
        child: Row(
          children: [
            // Expand icon or dot
            if (hasChildren)
              GestureDetector(
                onTap: () {
                  setState(() {
                    node.isExpanded = !node.isExpanded;
                  });
                },
                child: Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Icon(
                    node.isExpanded
                        ? Icons.keyboard_arrow_down
                        : Icons.keyboard_arrow_right,
                    size: 18,
                    color: node.isExpanded ? levelColor : Colors.white38,
                  ),
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Icon(Icons.circle,
                    size: 6, color: levelColor.withValues(alpha: 0.5)),
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
                      color: level == 0 ? Colors.white : Colors.white70,
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
                          fontSize: 10),
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
                  color: Colors.white,
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
                      color: hasChildren ? levelColor : Colors.white70,
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
