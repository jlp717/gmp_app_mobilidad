/// Analytics Dashboard Widget
/// ==========================
/// Mini-dashboard showing order KPIs, trends, and top products

import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

class AnalyticsDashboard extends StatelessWidget {
  final Map<String, dynamic> analytics;
  final bool isLoading;

  const AnalyticsDashboard({
    Key? key,
    required this.analytics,
    this.isLoading = false,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator(color: AppTheme.neonBlue)),
      );
    }

    final monthly = (analytics['monthly'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final topProducts = (analytics['topProducts'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final statusDist = analytics['statusDistribution'] as Map<String, dynamic>? ?? {};

    if (monthly.isEmpty && topProducts.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Text(
            'Sin datos de analytics aun',
            style: TextStyle(color: Colors.white38, fontSize: Responsive.fontSize(context, small: 14, large: 16)),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // KPI Cards Row
          if (monthly.isNotEmpty) _buildKpiCards(context, monthly),
          const SizedBox(height: 16),
          // Revenue Chart
          if (monthly.length >= 2) _buildRevenueChart(context, monthly),
          const SizedBox(height: 16),
          // Status Distribution
          if (statusDist.isNotEmpty) _buildStatusCards(context, statusDist),
          const SizedBox(height: 16),
          // Top Products
          if (topProducts.isNotEmpty) _buildTopProducts(context, topProducts),
        ],
      ),
    );
  }

  Widget _buildKpiCards(BuildContext context, List<Map<String, dynamic>> monthly) {
    final current = monthly.first;
    final previous = monthly.length > 1 ? monthly[1] : null;

    final revenue = (current['totalRevenue'] as num?)?.toDouble() ?? 0;
    final prevRevenue = (previous?['totalRevenue'] as num?)?.toDouble() ?? 0;
    final orders = (current['orderCount'] as num?)?.toInt() ?? 0;
    final prevOrders = (previous?['orderCount'] as num?)?.toInt() ?? 0;
    final avgOrder = (current['avgOrderValue'] as num?)?.toDouble() ?? 0;
    final clients = (current['uniqueClients'] as num?)?.toInt() ?? 0;

    return Row(
      children: [
        Expanded(child: _kpiCard(context, 'Ventas', '\u20AC${revenue.toStringAsFixed(0)}',
            _trendPct(revenue, prevRevenue), Icons.euro)),
        const SizedBox(width: 8),
        Expanded(child: _kpiCard(context, 'Pedidos', '$orders',
            _trendPct(orders.toDouble(), prevOrders.toDouble()), Icons.receipt_long)),
        const SizedBox(width: 8),
        Expanded(child: _kpiCard(context, 'Ticket medio', '\u20AC${avgOrder.toStringAsFixed(0)}',
            null, Icons.analytics_outlined)),
        const SizedBox(width: 8),
        Expanded(child: _kpiCard(context, 'Clientes', '$clients',
            null, Icons.people_outline)),
      ],
    );
  }

  double? _trendPct(double current, double previous) {
    if (previous == 0) return null;
    return ((current - previous) / previous) * 100;
  }

  Widget _kpiCard(BuildContext context, String label, String value, double? trend, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppTheme.neonBlue, size: 14),
              const SizedBox(width: 4),
              Expanded(
                child: Text(label, style: TextStyle(color: Colors.white54,
                    fontSize: Responsive.fontSize(context, small: 10, large: 11)),
                    overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(value, style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold,
              fontSize: Responsive.fontSize(context, small: 14, large: 16))),
          if (trend != null) ...[
            const SizedBox(height: 2),
            Row(
              children: [
                Icon(trend >= 0 ? Icons.trending_up : Icons.trending_down,
                    color: trend >= 0 ? AppTheme.neonGreen : AppTheme.error, size: 12),
                const SizedBox(width: 2),
                Text('${trend >= 0 ? '+' : ''}${trend.toStringAsFixed(0)}%',
                    style: TextStyle(color: trend >= 0 ? AppTheme.neonGreen : AppTheme.error,
                        fontSize: 10, fontWeight: FontWeight.w600)),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildRevenueChart(BuildContext context, List<Map<String, dynamic>> monthly) {
    final reversed = monthly.reversed.toList();
    final maxY = reversed.fold<double>(0, (max, m) {
      final v = (m['totalRevenue'] as num?)?.toDouble() ?? 0;
      return v > max ? v : max;
    });

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Evolucion mensual', style: TextStyle(color: Colors.white70,
              fontSize: Responsive.fontSize(context, small: 12, large: 14), fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          SizedBox(
            height: 140,
            child: BarChart(
              BarChartData(
                alignment: BarChartAlignment.spaceAround,
                maxY: maxY * 1.2,
                barTouchData: BarTouchData(enabled: false),
                titlesData: FlTitlesData(
                  leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      getTitlesWidget: (value, meta) {
                        final idx = value.toInt();
                        if (idx < 0 || idx >= reversed.length) return const SizedBox.shrink();
                        final m = reversed[idx];
                        return Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text('${m['month']}', style: const TextStyle(color: Colors.white38, fontSize: 10)),
                        );
                      },
                    ),
                  ),
                ),
                gridData: const FlGridData(show: false),
                borderData: FlBorderData(show: false),
                barGroups: reversed.asMap().entries.map((e) {
                  final val = (e.value['totalRevenue'] as num?)?.toDouble() ?? 0;
                  return BarChartGroupData(x: e.key, barRods: [
                    BarChartRodData(
                      toY: val,
                      color: AppTheme.neonBlue.withOpacity(0.8),
                      width: 16,
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                    ),
                  ]);
                }).toList(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusCards(BuildContext context, Map<String, dynamic> statusDist) {
    final statuses = {
      'BORRADOR': (AppTheme.neonBlue, Icons.edit_note),
      'CONFIRMADO': (AppTheme.neonGreen, Icons.check_circle),
      'ENVIADO': (AppTheme.neonPurple, Icons.local_shipping),
      'ANULADO': (AppTheme.error, Icons.cancel),
    };

    return Row(
      children: statuses.entries.map((entry) {
        final count = (statusDist[entry.key] as num?)?.toInt() ?? 0;
        final (color, icon) = entry.value;
        return Expanded(
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 3),
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: color.withOpacity(0.3), width: 0.5),
            ),
            child: Column(
              children: [
                Icon(icon, color: color, size: 16),
                const SizedBox(height: 4),
                Text('$count', style: TextStyle(color: color, fontWeight: FontWeight.bold,
                    fontSize: Responsive.fontSize(context, small: 14, large: 16))),
                Text(entry.key.substring(0, 4), style: TextStyle(color: color.withOpacity(0.7),
                    fontSize: 9, fontWeight: FontWeight.w500)),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildTopProducts(BuildContext context, List<Map<String, dynamic>> topProducts) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderColor, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Top productos', style: TextStyle(color: Colors.white70,
              fontSize: Responsive.fontSize(context, small: 12, large: 14), fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ...topProducts.take(5).map((p) {
            final sales = (p['totalSales'] as num?)?.toDouble() ?? 0;
            final maxSales = (topProducts.first['totalSales'] as num?)?.toDouble() ?? 1;
            return Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: Text((p['name'] ?? '').toString(), style: TextStyle(color: Colors.white70,
                        fontSize: Responsive.fontSize(context, small: 11, large: 12)),
                        overflow: TextOverflow.ellipsis),
                  ),
                  Expanded(
                    flex: 2,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(2),
                      child: LinearProgressIndicator(
                        value: maxSales > 0 ? sales / maxSales : 0,
                        backgroundColor: AppTheme.borderColor,
                        color: AppTheme.neonGreen,
                        minHeight: 6,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text('\u20AC${sales.toStringAsFixed(0)}', style: TextStyle(color: AppTheme.neonGreen,
                      fontSize: Responsive.fontSize(context, small: 11, large: 12), fontWeight: FontWeight.w600)),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}
