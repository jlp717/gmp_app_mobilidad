import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';

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
        backgroundColor: AppTheme.inkSurface,
        body: Center(child: ModernLoading(message: 'Analizando evolución...')),
      );
    }

    if (_error != null) {
      return Scaffold(
        backgroundColor: AppTheme.inkSurface,
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
      backgroundColor: AppTheme.inkSurface,
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
                    fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
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
            color: AppTheme.info,
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

    return RepartidorExecutivePanel(
      accentColor: AppTheme.info,
      padding: const EdgeInsets.all(16),
      child: SizedBox(
        height: 250,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Evolución Mensual',
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                )),
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
                      color: AppTheme.info,
                      barWidth: 4,
                      isStrokeCapRound: true,
                      dotData: const FlDotData(show: false),
                      belowBarData: BarAreaData(
                        show: true,
                        color: AppTheme.info.withValues(alpha: 0.12),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTopProducts(List topProducts) {
    if (topProducts.isEmpty) {
      return const RepartidorExecutivePanel(
        accentColor: AppTheme.info,
        padding: const EdgeInsets.all(20),
        child: Center(
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
    return RepartidorExecutivePanel(
      padding: const EdgeInsets.all(16),
      accentColor: color,
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
    return RepartidorExecutivePanel(
      margin: const EdgeInsets.only(bottom: 12),
      accentColor: AppTheme.accentIndigo,
      padding: EdgeInsets.zero,
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppTheme.accentIndigo.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Icon(Icons.inventory_2,
              color: AppTheme.accentIndigo, size: 20),
        ),
        title: Text(product['name'] ?? 'Producto',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontWeight: FontWeight.bold,
              fontSize: 14,
            )),
        subtitle: Text('Cód: ${product['code']} • ${product['totalUnits']} uds',
            style:
                const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
        trailing: Text(
            CurrencyFormatter.formatWhole(
                (product['totalSales'] as num).toDouble()),
            style: const TextStyle(
                fontWeight: FontWeight.bold, color: AppTheme.success)),
      ),
    );
  }
}
