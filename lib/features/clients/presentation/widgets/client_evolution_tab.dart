import 'package:dio/dio.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';

class ClientEvolutionTab extends StatefulWidget {
  const ClientEvolutionTab({
    required this.clientCode,
    required this.vendedorCodes,
    super.key,
  });
  final String clientCode;
  final String vendedorCodes;

  @override
  State<ClientEvolutionTab> createState() => _ClientEvolutionTabState();
}

class _ClientEvolutionTabState extends State<ClientEvolutionTab> {
  bool _isLoading = true;
  String? _error;
  List<Map<String, dynamic>> _monthlySales = [];
  List<Map<String, dynamic>> _topProducts = [];
  List<Map<String, dynamic>> _returns = [];
  int _loadGeneration = 0;
  CancelToken? _cancelToken;

  @override
  void initState() {
    super.initState();
    _loadEvolutionData();
  }

  @override
  void didUpdateWidget(covariant ClientEvolutionTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.clientCode != widget.clientCode ||
        oldWidget.vendedorCodes != widget.vendedorCodes) {
      _loadEvolutionData();
    }
  }

  @override
  void dispose() {
    _cancelToken?.cancel('client evolution disposed');
    super.dispose();
  }

  Future<void> _loadEvolutionData() async {
    final generation = ++_loadGeneration;
    _cancelToken?.cancel('client evolution superseded');
    final cancelToken = CancelToken();
    _cancelToken = cancelToken;

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final data = await ApiClient.get(
        '/pedidos/client-evolution/${Uri.encodeComponent(widget.clientCode)}',
        queryParameters: {'vendedorCodes': widget.vendedorCodes},
        cacheKey:
            'clients:evolution:${widget.clientCode}:${widget.vendedorCodes}',
        cacheTTL: const Duration(minutes: 15),
        cancelToken: cancelToken,
      );

      if (!mounted || generation != _loadGeneration) return;
      if (data['success'] == true) {
        final evolutionData = data['data'] is Map
            ? Map<String, dynamic>.from(data['data'] as Map)
            : data;
        setState(() {
          _monthlySales = _mapList(
            evolutionData['monthly'] ?? evolutionData['monthlySales'],
          );
          _topProducts = _mapList(
            evolutionData['products'] ?? evolutionData['topProducts'],
          );
          _returns = _mapList(evolutionData['returns']);
          _isLoading = false;
        });
        return;
      }
      throw Exception('Failed to load evolution data');
    } catch (e) {
      if (mounted && generation == _loadGeneration) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  List<Map<String, dynamic>> _mapList(Object? value) {
    if (value is! List) return <Map<String, dynamic>>[];
    return value
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(
        child: ModernLoading(message: 'Cargando evolución...'),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: AppTheme.error),
            const SizedBox(height: 16),
            Text('Error: $_error'),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _loadEvolutionData,
              child: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    final compact = Responsive.useCompactTiles(context);
    final pad = compact ? 10.0 : 16.0;

    return SingleChildScrollView(
      padding: EdgeInsets.all(pad),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Evolución Mensual (3 Años)',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          SizedBox(height: compact ? 10 : 16),
          if (_monthlySales.isNotEmpty)
            Container(
              height: compact ? 180 : 250,
              padding: EdgeInsets.all(compact ? 10 : 16),
              decoration: AppTheme.glassMorphism(),
              child: _buildEvolutionChart(),
            )
          else
            const Center(child: Text('No hay datos de evolución mensual')),
          SizedBox(height: compact ? 16 : 24),
          Text(
            'Productos Más Comprados',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          SizedBox(height: compact ? 10 : 16),
          if (_topProducts.isNotEmpty)
            _buildTopProductsList()
          else
            SizedBox(height: compact ? 16 : 24),
          Text(
            'Historial de Devoluciones',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          SizedBox(height: compact ? 10 : 16),
          if (_returns.isNotEmpty)
            _buildReturnsList()
          else
            const Center(
              child: Text('No hay historial de devoluciones reciente'),
            ),
        ],
      ),
    );
  }

  Widget _buildEvolutionChart() {
    if (_monthlySales.isEmpty) return const SizedBox.shrink();

    // Prepare data
    final spots = _monthlySales.asMap().entries.map((entry) {
      final sales = (entry.value['totalSales'] as num?)?.toDouble() ?? 0;
      return FlSpot(entry.key.toDouble(), sales);
    }).toList();

    return LineChart(
      LineChartData(
        gridData: const FlGridData(drawVerticalLine: false),
        titlesData: FlTitlesData(
          leftTitles: const AxisTitles(),
          rightTitles: const AxisTitles(),
          topTitles: const AxisTitles(),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              interval: 3,
              getTitlesWidget: (value, meta) {
                final idx = value.toInt();
                if (idx < 0 || idx >= _monthlySales.length) {
                  return const SizedBox.shrink();
                }
                final row = _monthlySales[idx];
                final year = row['year']?.toString() ?? '';
                final month = row['month']?.toString().padLeft(2, '0') ?? '';
                return Text(
                  '$year-$month',
                  style: TextStyle(
                    fontSize: 10,
                    color: AppTheme.textSecondary,
                  ),
                );
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
            barWidth: 3,
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                colors: [
                  AppTheme.info.withValues(alpha: 0.3),
                  AppTheme.info.withValues(alpha: 0),
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTopProductsList() {
    final count = _topProducts.length > 10 ? 10 : _topProducts.length;
    final cols = Responsive.denseListCrossAxisCount(context);
    final gap = Responsive.denseListSpacing(context);
    final compact = Responsive.useCompactTiles(context);

    Widget tile(int index) {
      final product = _topProducts[index];
      final name = '${product['name'] ?? 'Producto'}';
      final code = product['code'] ?? '';
      final sales = (product['totalSales'] as num?)?.toDouble() ?? 0;
      final units = (product['totalUnits'] as num?)?.toInt() ?? 0;

      return Card(
        margin: EdgeInsets.only(bottom: cols > 1 ? 0 : 8),
        color: AppTheme.raisedSurface,
        child: ListTile(
          dense: compact,
          visualDensity:
              compact ? VisualDensity.compact : VisualDensity.standard,
          leading: CircleAvatar(
            radius: compact ? 14 : 20,
            backgroundColor: AppTheme.info.withValues(alpha: 0.2),
            child: Text(
              '${index + 1}',
              style: TextStyle(
                color: AppTheme.info,
                fontSize: compact ? 10 : 12,
              ),
            ),
          ),
          title: Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: compact ? 12 : 13),
          ),
          subtitle: Text(
            'Cód: $code · $units uds',
            style: TextStyle(fontSize: compact ? 10 : 11),
          ),
          trailing: Text(
            CurrencyFormatter.formatWhole(sales),
            style: TextStyle(
              fontWeight: FontWeight.bold,
              color: AppTheme.success,
              fontSize: compact ? 12 : 13,
            ),
          ),
        ),
      );
    }

    if (cols <= 1) {
      return ListView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: count,
        itemBuilder: (context, index) => tile(index),
      );
    }

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: cols,
        mainAxisExtent: compact ? 64 : 76,
        mainAxisSpacing: gap,
        crossAxisSpacing: gap,
      ),
      itemCount: count,
      itemBuilder: (context, index) => tile(index),
    );
  }

  Widget _buildReturnsList() {
    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _returns.length > 10 ? 10 : _returns.length,
      itemBuilder: (context, index) {
        final ret = _returns[index];
        final name = '${ret['productName'] ?? 'Producto'}';
        final code = ret['productCode'] ?? '';
        final amount = (ret['amount'] as num?)?.toDouble() ?? 0;
        final units = (ret['units'] as num?)?.toInt() ?? 0;
        final year = ret['year'];
        final month = ret['month']?.toString().padLeft(2, '0');

        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          color: AppTheme.error.withValues(alpha: 0.1),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
            side: BorderSide(color: AppTheme.error.withValues(alpha: 0.3)),
          ),
          child: ListTile(
            dense: true,
            leading: const Icon(Icons.assignment_return, color: AppTheme.error),
            title: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13),
            ),
            subtitle: Text(
              'Cód: $code • $units uds • ${CurrencyFormatter.formatWhole(amount)}',
              style: const TextStyle(fontSize: 11),
            ),
            trailing: Text(
              CurrencyFormatter.formatWhole(amount),
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                color: AppTheme.error,
                fontSize: 13,
              ),
            ),
          ),
        );
      },
    );
  }
}
