import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:fl_chart/fl_chart.dart';

class RepartidorEvolutionPage extends StatefulWidget {
  final String repartidorId;
  final Future<Map<String, dynamic>> Function(String repartidorId)?
      loadEvolution;

  const RepartidorEvolutionPage({
    super.key,
    required this.repartidorId,
    this.loadEvolution,
  });

  @override
  State<RepartidorEvolutionPage> createState() =>
      _RepartidorEvolutionPageState();
}

class _RepartidorEvolutionPageState extends State<RepartidorEvolutionPage> {
  bool _isLoading = true;
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final data = await (widget.loadEvolution ??
          RepartidorDataService.getEvolution)(widget.repartidorId);
      if (mounted) {
        setState(() {
          _data = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        backgroundColor: Colors.transparent,
        body: Center(child: ModernLoading(message: 'Analizando evolución...')),
      );
    }

    if (_error != null) {
      return Scaffold(
        backgroundColor: Colors.transparent,
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
              const SizedBox(height: 16),
              Text('Error: $_error',
                  style: const TextStyle(color: AppTheme.textSecondary)),
              const SizedBox(height: 16),
              ElevatedButton(
                  onPressed: _loadData, child: const Text('Reintentar')),
            ],
          ),
        ),
      );
    }

    final evolution = (_data?['evolution'] as List? ?? []);
    final topProducts = (_data?['topProducts'] as List? ?? []);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SingleChildScrollView(
        padding:
            EdgeInsets.all(Responsive.padding(context, small: 12, large: 20)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHeaderSummary(evolution),
            const SizedBox(height: 24),
            _buildEvolutionChart(evolution),
            const SizedBox(height: 24),
            Text('Productos Top (Ventas)',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold, color: Colors.white)),
            const SizedBox(height: 12),
            _buildTopProducts(topProducts),
          ],
        ),
      ),
    );
  }

  Widget _buildHeaderSummary(List evolution) {
    double totalYear = 0;

    if (evolution.isNotEmpty) {
      totalYear =
          evolution.fold(0.0, (sum, item) => sum + (item['totalSales'] ?? 0));
    }

    return Row(
      children: [
        Expanded(
          child: _SummaryCard(
            title: 'Ventas Anuales',
            value: CurrencyFormatter.formatWhole(totalYear),
            icon: Icons.analytics,
            color: AppTheme.neonBlue,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _SummaryCard(
            title: 'Tendencia',
            value: evolution.length > 1
                ? '${_calculateGrowth(evolution).toStringAsFixed(1)}%'
                : '--',
            subtitle: 'vs mes anterior',
            icon: Icons.trending_up,
            color: AppTheme.success,
          ),
        ),
      ],
    );
  }

  double _calculateGrowth(List evolution) {
    if (evolution.length < 2) return 0;
    final current = (evolution.last['totalSales'] as num).toDouble();
    final prev =
        (evolution[evolution.length - 2]['totalSales'] as num).toDouble();
    if (prev == 0) return 0;
    return ((current - prev) / prev) * 100;
  }

  Widget _buildEvolutionChart(List evolution) {
    if (evolution.isEmpty) return const SizedBox.shrink();

    final spots = evolution.asMap().entries.map((entry) {
      return FlSpot(
          entry.key.toDouble(), (entry.value['totalSales'] as num).toDouble());
    }).toList();

    return Container(
      height: 250,
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.glassMorphism(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Evolución Mensual',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 20),
          Expanded(
            child: LineChart(
              LineChartData(
                gridData: const FlGridData(show: false),
                titlesData: FlTitlesData(
                  leftTitles: const AxisTitles(),
                  rightTitles: const AxisTitles(),
                  topTitles: const AxisTitles(),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      getTitlesWidget: (value, meta) {
                        int idx = value.toInt();
                        if (idx < 0 || idx >= evolution.length)
                          return const SizedBox.shrink();
                        final period = evolution[idx]['period'].toString();
                        return Text(period.substring(5),
                            style: const TextStyle(
                                fontSize: 10, color: AppTheme.textSecondary));
                      },
                    ),
                  ),
                ),
                borderData: FlBorderData(show: false),
                lineBarsData: [
                  LineChartBarData(
                    spots: spots,
                    isCurved: true,
                    color: AppTheme.neonBlue,
                    barWidth: 4,
                    isStrokeCapRound: true,
                    dotData: const FlDotData(show: false),
                    belowBarData: BarAreaData(
                      show: true,
                      gradient: LinearGradient(
                        colors: [
                          AppTheme.neonBlue.withValues(alpha: 0.3),
                          AppTheme.neonBlue.withValues(alpha: 0)
                        ],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTopProducts(List topProducts) {
    if (topProducts.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: AppTheme.glassMorphism(),
        child: const Center(
            child: Text('No hay datos de productos',
                style: TextStyle(color: AppTheme.textSecondary))),
      );
    }

    return Column(
      children: topProducts.map((p) => _ProductTile(product: p)).toList(),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final String title;
  final String value;
  final String? subtitle;
  final IconData icon;
  final Color color;

  const _SummaryCard({
    required this.title,
    required this.value,
    this.subtitle,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.glassMorphism(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title,
                  style: const TextStyle(
                      color: AppTheme.textSecondary, fontSize: 12)),
              Icon(icon, color: color, size: 20),
            ],
          ),
          const SizedBox(height: 8),
          Text(value,
              style: TextStyle(
                  color: color, fontWeight: FontWeight.bold, fontSize: 18)),
          if (subtitle != null)
            Text(subtitle!,
                style: const TextStyle(
                    color: AppTheme.textSecondary, fontSize: 10)),
        ],
      ),
    );
  }
}

class _ProductTile extends StatelessWidget {
  final dynamic product;

  const _ProductTile({required this.product});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: AppTheme.glassMorphism(),
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppTheme.neonPurple.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Icon(Icons.inventory_2,
              color: AppTheme.neonPurple, size: 20),
        ),
        title: Text(product['name'] ?? 'Producto',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
        subtitle: Text('Cód: ${product['code']} • ${product['totalUnits']} uds',
            style:
                const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
        trailing: Text(
            CurrencyFormatter.formatWhole(
                (product['totalSales'] as num).toDouble()),
            style: const TextStyle(
                fontWeight: FontWeight.bold, color: AppTheme.neonGreen)),
      ),
    );
  }
}
