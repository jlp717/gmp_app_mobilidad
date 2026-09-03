import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/widgets/dashboard_chart_factory.dart'; // Use factory instead of direct chart
import 'package:gmp_app_mobilidad/features/dashboard/presentation/widgets/matrix_data_table.dart';

/// One section of the Cascading Dashboard.
/// Represents a single level in the hierarchy (e.g., "Clientes de Javier").
/// Displays a Chart and a Table side-by-side (or vertical on small screens).
class HierarchySection extends StatelessWidget {
  const HierarchySection({
    required this.title,
    required this.levelName,
    required this.data,
    required this.hierarchy,
    required this.periods,
    required this.onNodeTap,
    super.key,
    this.selectedNode,
    this.color = AppTheme.info,
    this.chartType = ChartType.bar,
  });
  final String title;
  final String levelName;
  final List<MatrixNode> data;
  final List<String> hierarchy;
  final List<String> periods;
  final Function(MatrixNode) onNodeTap;
  final MatrixNode? selectedNode;
  final Color color;
  final ChartType chartType;

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty) return const SizedBox();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [
                color.withValues(alpha: 0.16),
                AppTheme.softPanel.withValues(alpha: 0.72),
              ],
            ),
            borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            border: Border.all(color: color.withValues(alpha: 0.24)),
          ),
          child: Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  border: Border.all(color: color.withValues(alpha: 0.34)),
                ),
                child: Icon(Icons.stacked_bar_chart, color: color, size: 16),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title.toUpperCase(),
                  style: TextStyle(
                    color: color,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                    letterSpacing: 0,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Text(
                '${data.length} registros',
                style: TextStyle(
                  color: AppColors.themedWhite.withValues(alpha: 0.42),
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
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
                      final node = data.firstWhere(
                        (n) => n.id == id,
                        orElse: () => data[0],
                      );
                      onNodeTap(node);
                    },
                  ),
                ),

                // Table (Detailed List)
                MatrixDataTable(
                  data: data,
                  periods: periods,
                  onRowTap: (id, type) {
                    final node = data.firstWhere(
                      (n) => n.id == id,
                      orElse: () => data[0],
                    );
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
