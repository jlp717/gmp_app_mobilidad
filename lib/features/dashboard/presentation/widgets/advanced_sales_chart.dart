import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/responsive.dart';
import '../widgets/matrix_data_table.dart';

/// Advanced Sales Chart that adapts to hierarchy depth
/// 1 Level: Simple Bar Chart
/// 2 Levels: Stacked Bar Chart (Parent composed of Top Children)
class AdvancedSalesChart extends StatefulWidget {
  final List<MatrixNode> matrixData;
  final List<String> hierarchy;
  final Color color;
  final Function(String, String) onBarTap;

  const AdvancedSalesChart({
    super.key,
    required this.matrixData,
    required this.hierarchy,
    this.color = AppTheme.neonBlue,
    required this.onBarTap,
  });

  @override
  State<AdvancedSalesChart> createState() => _AdvancedSalesChartState();
}

class _AdvancedSalesChartState extends State<AdvancedSalesChart> {
  int _touchedIndex = -1;

  @override
  Widget build(BuildContext context) {
    if (widget.matrixData.isEmpty) return const SizedBox();

    final topItems = widget.matrixData.take(12).toList();
    // Simple max calculation
    double maxY = topItems.map((e) => e.sales).fold(0.0, (a, b) => a > b ? a : b);
    maxY = maxY * 1.1; 

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.2),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min, // Important for column inside column
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  children: [
                    Text(
                      'RANKING DE ${() {
                         if (topItems.isEmpty) return 'ITEMS';
                         final type = topItems.first.type.toLowerCase();
                         final map = {'vendor': 'COMERCIALES', 'client': 'CLIENTES', 'product': 'PRODUCTOS', 'family': 'FAMILIAS'};
                         return map[type] ?? type.toUpperCase();
                      }()}',
                      style: const TextStyle(
                        color: Colors.white, 
                        fontSize: 16, 
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Top 12 Resultados', 
                      style: TextStyle(color: widget.color, fontSize: 12),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                   color: widget.color.withOpacity(0.1),
                   borderRadius: BorderRadius.circular(20),
                   border: Border.all(color: widget.color.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    Icon(Icons.bar_chart, size: 14, color: widget.color),
                    const SizedBox(width: 6),
                    Text('Analítica', style: TextStyle(color: widget.color, fontSize: 10, fontWeight: FontWeight.bold)),
                  ],
                ),
              )
            ],
          ),
          const SizedBox(height: 24),
          SizedBox(
            height: Responsive.scale(context, 200),
            child: BarChart(
              BarChartData(
                alignment: BarChartAlignment.spaceAround,
                maxY: maxY,
                barTouchData: BarTouchData(
                  touchTooltipData: BarTouchTooltipData(
                    tooltipBgColor: AppTheme.darkCard,
                    tooltipRoundedRadius: 8,
                    tooltipPadding: const EdgeInsets.all(12),
                    tooltipMargin: 8,
                    getTooltipItem: (group, groupIndex, rod, rodIndex) {
                      final node = topItems[groupIndex];
                      return BarTooltipItem(
                        '${node.name}\n',
                        const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                        children: [
                          TextSpan(
                            text: '${CurrencyFormatter.formatWhole(node.sales)} €',
                            style: TextStyle(color: widget.color, fontSize: 12, fontWeight: FontWeight.w500),
                          ),
                        ],
                      );
                    },
                  ),
                  touchCallback: (FlTouchEvent event, barTouchResponse) {
                    setState(() {
                      if (!event.isInterestedForInteractions ||
                          barTouchResponse == null ||
                          barTouchResponse.spot == null) {
                        _touchedIndex = -1;
                        return;
                      }
                      _touchedIndex = barTouchResponse.spot!.touchedBarGroupIndex;
                      
                      if (event is FlTapUpEvent) {
                         final node = topItems[_touchedIndex];
                         widget.onBarTap(node.id, node.type);
                      }
                    });
                  },
                ),
                titlesData: FlTitlesData(
                  show: true,
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 60, // Increased for labels
                      getTitlesWidget: (value, meta) {
                        final index = value.toInt();
                        if (index >= topItems.length) return const SizedBox();
                        final node = topItems[index];
                        final isTouched = index == _touchedIndex;
                        
                        // Smart label truncation
                        String label = node.name;
                        if (label.length > 12) label = '${label.substring(0, 10)}..';
                        
                        return Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: Transform.rotate(
                            angle: -0.5, // Tilted labels for readability
                            child: Text(
                              label,
                              style: TextStyle(
                                color: isTouched ? Colors.white : Colors.white54,
                                fontWeight: isTouched ? FontWeight.bold : FontWeight.normal,
                                fontSize: 9,
                              ),
                              textAlign: TextAlign.right,
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 70, // Increased to fit "4.000.000"
                      getTitlesWidget: (value, meta) {
                         if (value == 0) return const SizedBox();
                         // User requested full numbers: "4.000.000 €"
                         return Text(CurrencyFormatter.formatWhole(value).replaceAll(' €', ''), style: const TextStyle(color: Colors.white24, fontSize: 10));
                      },
                    ),
                  ),
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                ),
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  getDrawingHorizontalLine: (value) => FlLine(color: Colors.white.withOpacity(0.05), strokeWidth: 1),
                ),
                borderData: FlBorderData(show: false),
                barGroups: topItems.asMap().entries.map((entry) {
                   final index = entry.key;
                   final node = entry.value;
                   final isTouched = index == _touchedIndex;
                   
                   return BarChartGroupData(
                     x: index,
                     barRods: [
                       BarChartRodData(
                         toY: node.sales,
                         gradient: LinearGradient(
                           colors: [widget.color.withOpacity(0.7), widget.color],
                           begin: Alignment.bottomCenter,
                           end: Alignment.topCenter,
                         ),
                         width: 16,
                         borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
                         backDrawRodData: BackgroundBarChartRodData(
                           show: true,
                           toY: maxY,
                           color: Colors.white.withOpacity(0.02),
                         ),
                       ),
                     ],
                     showingTooltipIndicators: isTouched ? [0] : [],
                   );
                }).toList(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
