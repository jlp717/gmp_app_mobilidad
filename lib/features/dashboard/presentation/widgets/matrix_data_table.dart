import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/currency_formatter.dart';

/// Node for Hierarchical Data
class MatrixNode {
  final String id;
  final String name;
  final String type; // 'vendor', 'client', 'product', 'family'
  final double sales;
  final double margin;
  final double growth;
  final List<MatrixNode> children;
  bool isExpanded;

  MatrixNode({
    required this.id,
    required this.name,
    required this.type,
    required this.sales,
    required this.margin,
    required this.growth,
    this.children = const [],
    this.isExpanded = false,
  });
  
  // Calculate accumulated margin (self + all children recursively)
  double get accumulatedMargin {
    double acc = margin;
    for (var child in children) {
      acc += child.accumulatedMargin;
    }
    return acc;
  }
  
  double get accumulatedSales {
    double acc = sales;
    for (var child in children) {
      acc += child.accumulatedSales;
    }
    return acc;
  }
}

/// Tree-style expandable data table
/// Children expand WITHIN the same table, indented
class MatrixDataTable extends StatefulWidget {
  final List<MatrixNode> data;
  final List<String> periods;
  final Function(String, String) onRowTap;
  final Function(MatrixNode)? onNodeTap;
  final String? selectedId;

  const MatrixDataTable({
    super.key,
    required this.data,
    required this.periods,
    required this.onRowTap,
    this.onNodeTap,
    this.selectedId,
  });

  @override
  State<MatrixDataTable> createState() => _MatrixDataTableState();
}

class _MatrixDataTableState extends State<MatrixDataTable> {
  @override
  Widget build(BuildContext context) {
    if (widget.data.isEmpty) {
      return const Center(child: Padding(
        padding: EdgeInsets.all(32.0),
        child: Text('No hay datos para esta selección', style: TextStyle(color: Colors.white30)),
      ));
    }

    return Card(
      elevation: 8,
      shadowColor: Colors.black45,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.white.withOpacity(0.05)),
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
              AppTheme.darkBase.withOpacity(0.95),
            ],
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header with new "M.ACUM" column
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
              decoration: BoxDecoration(
                border: Border(bottom: BorderSide(color: AppTheme.neonBlue.withOpacity(0.2))),
                color: Colors.white.withOpacity(0.02),
              ),
              child: Row(
                children: const [
                  Expanded(flex: 5, child: Text('ITEM', style: TextStyle(color: AppTheme.neonBlue, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1))),
                  Expanded(flex: 3, child: Text('VENTA', textAlign: TextAlign.right, style: TextStyle(color: AppTheme.neonBlue, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1))),
                  Expanded(flex: 2, child: Text('MARG %', textAlign: TextAlign.right, style: TextStyle(color: AppTheme.neonBlue, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1))),
                  // M.ACUM column header in ORANGE
                  Expanded(flex: 2, child: Text('M.ACUM', textAlign: TextAlign.right, style: TextStyle(color: Colors.orange, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1))),
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
    for (var node in widget.data) {
      totalSales += node.sales;
      totalMargin += node.margin;
    }
    final marginPct = totalSales > 0 ? (totalMargin / totalSales) * 100 : 0.0;
    
    // TOTAL ROW - Orange background for distinction
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.orange.withOpacity(0.15),
        border: Border(top: BorderSide(color: Colors.orange.withOpacity(0.5), width: 2)),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: Row(
              children: const [
                Icon(Icons.summarize, color: Colors.orange, size: 16),
                SizedBox(width: 6),
                Text('TOTAL', style: TextStyle(color: Colors.orange, fontSize: 13, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          Expanded(
            flex: 3,
            child: Text(
              CurrencyFormatter.format(totalSales),
              textAlign: TextAlign.right,
              style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
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
          // M.ACUM column - total margin in €
          Expanded(
            flex: 2,
            child: Text(
              CurrencyFormatter.format(totalMargin),
              textAlign: TextAlign.right,
              style: const TextStyle(color: Colors.orange, fontSize: 12, fontWeight: FontWeight.bold),
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
      for (var child in node.children) {
        widgets.add(_buildNodeWithChildren(child, level + 1));
      }
    }
    
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: widgets,
    );
  }

  Widget _buildNodeRow(MatrixNode node, int level) {
    final double marginPercent = node.sales > 0 ? (node.margin / node.sales) * 100 : 0.0;
    final Color marginColor = marginPercent > 20 ? AppTheme.neonGreen : (marginPercent > 10 ? Colors.amber : AppTheme.error);
    
    // Level colors for visual hierarchy
    final levelColors = [AppTheme.neonBlue, AppTheme.neonPurple, AppTheme.neonGreen, Colors.teal, Colors.pink];
    final levelColor = levelColors[level % levelColors.length];
    
    // Calculate accumulated margin for THIS node (self + children)
    final accMargin = node.accumulatedMargin;
    final accSales = node.accumulatedSales;
    final accMarginPct = accSales > 0 ? (accMargin / accSales) * 100 : 0.0;
    
    final bool hasChildren = node.children.isNotEmpty;
    final bool isSelected = widget.selectedId == node.id;

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
             ? levelColor.withOpacity(0.15) 
             : (level > 0 ? Colors.white.withOpacity(0.02 * level) : Colors.transparent),
          border: Border(
            bottom: BorderSide(color: Colors.white.withOpacity(0.05)),
            left: level > 0 ? BorderSide(color: levelColor.withOpacity(0.3), width: 2) : BorderSide.none,
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
                    node.isExpanded ? Icons.keyboard_arrow_down : Icons.keyboard_arrow_right,
                    size: 18,
                    color: node.isExpanded ? levelColor : Colors.white38,
                  ),
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Icon(Icons.circle, size: 6, color: levelColor.withOpacity(0.5)),
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
                      fontWeight: level == 0 ? FontWeight.bold : FontWeight.normal,
                      fontSize: level == 0 ? 14 : 13,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (hasChildren && level == 0)
                    Text(
                      '${node.children.length} items',
                      style: TextStyle(color: levelColor.withOpacity(0.6), fontSize: 10),
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
            
            // ACCUMULATED MARGIN - orange text, no background container
            Expanded(
              flex: 2,
              child: Text(
                hasChildren ? '${accMarginPct.toStringAsFixed(1)}%' : '-',
                textAlign: TextAlign.right,
                style: TextStyle(
                  color: hasChildren ? Colors.orange : Colors.white24,
                  fontSize: 12,
                  fontWeight: hasChildren ? FontWeight.bold : FontWeight.normal,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
