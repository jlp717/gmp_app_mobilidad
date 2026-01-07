import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import 'matrix_data_table.dart';
import 'dashboard_chart_factory.dart'; // Use factory instead of direct chart

/// One section of the Cascading Dashboard.
/// Represents a single level in the hierarchy (e.g., "Clientes de Javier").
/// Displays a Chart and a Table side-by-side (or vertical on small screens).
class HierarchySection extends StatelessWidget {
  final String title;
  final String levelName; 
  final List<MatrixNode> data; 
  final List<String> hierarchy;
  final List<String> periods;
  final Function(MatrixNode) onNodeTap;
  final MatrixNode? selectedNode;
  final Color color;
  final ChartType chartType;

  const HierarchySection({
    super.key,
    required this.title,
    required this.levelName,
    required this.data,
    required this.hierarchy,
    required this.periods,
    required this.onNodeTap,
    this.selectedNode,
    this.color = AppTheme.neonBlue,
    this.chartType = ChartType.bar,
  });

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty) return const SizedBox();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Section Header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: color.withOpacity(0.1),
            border: Border(left: BorderSide(color: color, width: 4)),
          ),
          child: Text(
            title.toUpperCase(),
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.bold,
              fontSize: 14,
              letterSpacing: 1.2,
            ),
          ),
        ),
        const SizedBox(height: 16),
        
        // Content: Chart + Table
        LayoutBuilder(
          builder: (context, constraints) {
            return Column(
              children: [
                // Chart (Visual Overview) WITHOUT fixed height
                Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  child: DashboardChartFactory(
                    type: chartType,
                    data: data,
                    title: title, 
                    color: color,
                    onTap: (id, type) {
                      final node = data.firstWhere((n) => n.id == id, orElse: () => data[0]);
                      onNodeTap(node);
                    },
                  ),
                ),
                
                // Table (Detailed List)
                MatrixDataTable(
                  data: data,
                  periods: periods,
                  onRowTap: (id, type) {
                     final node = data.firstWhere((n) => n.id == id, orElse: () => data[0]);
                     onNodeTap(node);
                  },
                  onNodeTap: onNodeTap, 
                  selectedId: selectedNode?.id,
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}
