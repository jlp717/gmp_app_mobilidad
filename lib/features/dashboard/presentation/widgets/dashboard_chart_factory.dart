import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/responsive.dart';
import 'advanced_sales_chart.dart'; // Reuse existing bar chart
import 'matrix_data_table.dart'; // Required for MatrixNode

enum ChartType {
  bar,
  pie,
  line,
}

class DashboardChartFactory extends StatelessWidget {
  final ChartType type;
  final List<MatrixNode> data;
  final String title;
  final Color color;
  final Function(String, String) onTap;

  const DashboardChartFactory({
    super.key,
    required this.type,
    required this.data,
    required this.title,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty) return const SizedBox();

    switch (type) {
      case ChartType.pie:
        return _buildPieChart(context);
      case ChartType.line:
         // For now fallback to bar as Line requires time-series data which MatrixNode isn't perfectly suited for without "periods"
         return _buildHorizontalBarChart();
      case ChartType.bar:
      default:
        return AdvancedSalesChart(
          matrixData: data,
          hierarchy: const [], // Not used in refined simplified version
          color: color,
          onBarTap: onTap,
        );
    }
  }

  Widget _buildPieChart(BuildContext context) {
    final topItems = data.take(8).toList();
    final double total = topItems.fold(0, (sum, item) => sum + item.sales);

    return Container(
      height: Responsive.scale(context, 300),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Column(
        children: [
          Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 20),
          Expanded(
            child: PieChart(
              PieChartData(
                sectionsSpace: 2,
                centerSpaceRadius: 40,
                sections: topItems.asMap().entries.map((entry) {
                  final index = entry.key;
                  final node = entry.value;
                  final isLarge = node.sales / total > 0.1;
                  final value = node.sales;
                  
                  // Vary opacity based on index
                  final sectionColor = color.withOpacity(1.0 - (index * 0.1).clamp(0.0, 0.8));

                  return PieChartSectionData(
                    color: sectionColor,
                    value: value,
                    title: '${(value / total * 100).toStringAsFixed(0)}%',
                    radius: isLarge ? 60 : 50,
                    titleStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                  );
                }).toList(),
                pieTouchData: PieTouchData(
                  touchCallback: (FlTouchEvent event, pieTouchResponse) {
                    if (event is FlTapUpEvent && pieTouchResponse != null && pieTouchResponse.touchedSection != null) {
                      final index = pieTouchResponse.touchedSection!.touchedSectionIndex;
                      if (index >= 0 && index < topItems.length) {
                        onTap(topItems[index].id, topItems[index].type);
                      }
                    }
                  },
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          // Legend
          Wrap(
            spacing: 8,
            children: topItems.take(4).map((node) => Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(width: 8, height: 8, color: color),
                const SizedBox(width: 4),
                Text(node.name, style: const TextStyle(color: Colors.white70, fontSize: 10)),
              ],
            )).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildHorizontalBarChart() {
     return AdvancedSalesChart(
          matrixData: data,
          hierarchy: const [],
          color: color,
          onBarTap: onTap,
     ); 
  }
}
