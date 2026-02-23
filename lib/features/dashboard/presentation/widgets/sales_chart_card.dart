import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/features/dashboard/domain/entities/dashboard_metrics.dart';
import 'package:gmp_app_mobilidad/core/utils/formatters.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

/// [SalesChartCard] - Tarjeta con gráfica de ventas y unidades
///
/// CARACTERÍSTICAS:
/// - Muestra datos de últimos 7 días
/// - Comparación con período anterior
/// - Indicador de crecimiento
/// - Gráfica de barras con fl_chart
class SalesChartCard extends StatelessWidget {
  const SalesChartCard({
    super.key,
    required this.salesSummary,
  });

  final SalesSummary salesSummary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasData = salesSummary.dailyData.isNotEmpty;

    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header con título y crecimiento
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Ventas y Unidades',
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Últimos 7 días',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
                if (hasData && salesSummary.previousPeriodSales > 0)
                  _buildGrowthIndicator(context),
              ],
            ),

            const SizedBox(height: 24),

            // Totales
            Row(
              children: [
                Expanded(
                  child: _buildTotalCard(
                    context,
                    label: 'Ventas Totales',
                    value: Formatters.currency(salesSummary.totalSales),
                    icon: Icons.euro,
                    color: Colors.green,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildTotalCard(
                    context,
                    label: 'Unidades',
                    value: salesSummary.totalUnits.toString(),
                    icon: Icons.inventory_2,
                    color: Colors.blue,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 24),

            // Gráfica
            if (hasData) ...[
              SizedBox(
                height: Responsive.scale(context, 200),
                child: _buildChart(context),
              ),
            ] else ...[
              SizedBox(
                height: Responsive.scale(context, 200),
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.bar_chart_outlined,
                        size: 48,
                        color: theme.colorScheme.onSurfaceVariant.withOpacity(0.5),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'No hay datos de ventas disponibles',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildGrowthIndicator(BuildContext context) {
    final growth = salesSummary.salesGrowth;
    final isPositive = growth >= 0;
    final color = isPositive ? Colors.green : Colors.red;
    final icon = isPositive ? Icons.trending_up : Icons.trending_down;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 4),
          Text(
            '${growth.abs().toStringAsFixed(1)}%',
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.bold,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTotalCard(
    BuildContext context, {
    required String label,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 16),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  label,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChart(BuildContext context) {
    final theme = Theme.of(context);
    final data = salesSummary.dailyData;

    // Calcular valor máximo para escala
    final maxSales = data.map((d) => d.sales).reduce((a, b) => a > b ? a : b);
    final maxY = (maxSales * 1.2).ceilToDouble();

    return BarChart(
      BarChartData(
        alignment: BarChartAlignment.spaceAround,
        maxY: maxY,
        barTouchData: BarTouchData(
          enabled: true,
          touchTooltipData: BarTouchTooltipData(
            getTooltipItem: (group, groupIndex, rod, rodIndex) {
              final day = data[group.x.toInt()];
              return BarTooltipItem(
                '${day.dayLabel}\n',
                theme.textTheme.bodySmall!.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
                children: [
                  TextSpan(
                    text: Formatters.currency(day.sales),
                    style: theme.textTheme.bodySmall!.copyWith(
                      color: Colors.white70,
                    ),
                  ),
                  TextSpan(
                    text: '\n${day.units} unidades',
                    style: theme.textTheme.bodySmall!.copyWith(
                      color: Colors.white70,
                    ),
                  ),
                ],
              );
            },
          ),
        ),
        titlesData: FlTitlesData(
          show: true,
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              getTitlesWidget: (value, meta) {
                if (value.toInt() >= 0 && value.toInt() < data.length) {
                  return Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      data[value.toInt()].dayLabel,
                      style: theme.textTheme.bodySmall,
                    ),
                  );
                }
                return const SizedBox();
              },
            ),
          ),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 50,
              getTitlesWidget: (value, meta) {
                return Text(
                  Formatters.compactCurrency(value),
                  style: theme.textTheme.bodySmall,
                );
              },
            ),
          ),
          topTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
          rightTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
        ),
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          horizontalInterval: maxY / 5,
          getDrawingHorizontalLine: (value) {
            return FlLine(
              color: theme.colorScheme.outlineVariant.withOpacity(0.5),
              strokeWidth: 1,
            );
          },
        ),
        borderData: FlBorderData(show: false),
        barGroups: data.asMap().entries.map((entry) {
          final index = entry.key;
          final day = entry.value;

          return BarChartGroupData(
            x: index,
            barRods: [
              BarChartRodData(
                toY: day.sales,
                color: theme.colorScheme.primary,
                width: 16,
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(4),
                ),
              ),
            ],
          );
        }).toList(),
      ),
    );
  }
}
