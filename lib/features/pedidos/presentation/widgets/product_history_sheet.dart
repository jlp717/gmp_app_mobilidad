/// Product History Sheet
/// ====================
/// Bottom sheet showing a client's purchase history for a specific product
/// with year selector, multiple chart views, trend line, and detailed table.

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../../../core/widgets/smart_product_image.dart';

class ProductHistorySheet extends StatefulWidget {
  final String productCode;
  final String productName;
  final String clientCode;
  final String clientName;

  const ProductHistorySheet({
    Key? key,
    required this.productCode,
    required this.productName,
    required this.clientCode,
    required this.clientName,
  }) : super(key: key);

  static Future<void> show(
    BuildContext context, {
    required String productCode,
    required String productName,
    required String clientCode,
    required String clientName,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: 0.88,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, scrollCtrl) => ProductHistorySheet(
          productCode: productCode,
          productName: productName,
          clientCode: clientCode,
          clientName: clientName,
        ),
      ),
    );
  }

  @override
  State<ProductHistorySheet> createState() => _ProductHistorySheetState();
}

/// Chart metric options
enum _ChartMetric { sales, envases, units, avgPrice }

class _ProductHistorySheetState extends State<ProductHistorySheet> {
  bool _loading = true;
  String? _error;
  Map<String, _YearData> _years = {};
  _GrandTotal _grandTotal = _GrandTotal();
  String _trend = 'stable';

  String? _selectedYear;
  _ChartMetric _chartMetric = _ChartMetric.sales;

  static const _monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  static const _monthShort = [
    'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
    'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC',
  ];

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await ApiClient.get(
        '/pedidos/product-history/'
        '${widget.productCode}/${widget.clientCode}',
      );
      final yearsRaw = resp['years'] as Map<String, dynamic>? ?? {};
      final years = <String, _YearData>{};
      for (final entry in yearsRaw.entries) {
        years[entry.key] =
            _YearData.fromJson(entry.value as Map<String, dynamic>);
      }
      final gt = resp['grandTotal'] as Map<String, dynamic>? ?? {};
      final sortedKeys = years.keys.toList()..sort((a, b) => b.compareTo(a));

      // Auto-select best metric: if no envases data, use sales or units
      var bestMetric = _ChartMetric.sales;
      if (years.isNotEmpty) {
        final latest = years[sortedKeys.first]!;
        final hasEnvases = latest.totals.envases > 0;
        final hasUnits = latest.totals.units > 0;
        if (hasEnvases) {
          bestMetric = _ChartMetric.envases;
        } else if (hasUnits) {
          bestMetric = _ChartMetric.units;
        }
      }

      setState(() {
        _years = years;
        _grandTotal = _GrandTotal.fromJson(gt);
        _trend = (resp['trend'] ?? 'stable').toString();
        _selectedYear = sortedKeys.isNotEmpty ? sortedKeys.first : null;
        _chartMetric = bestMetric;
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  String _fmtEur(double val, {int decimals = 2}) =>
      '${val.toStringAsFixed(decimals)}\u20AC';

  String _fmtNum(double val, {int decimals = 0}) =>
      val.toStringAsFixed(decimals);

  String _fmtPct(double val) => '${val.toStringAsFixed(1)}%';

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: AppTheme.neonBlue),
            SizedBox(height: 12),
            Text('Cargando historial...',
                style: TextStyle(color: Colors.white54)),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline,
                  color: AppTheme.error, size: 48),
              const SizedBox(height: 12),
              Text('Error: $_error',
                  style: const TextStyle(color: Colors.white70),
                  textAlign: TextAlign.center),
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: _loadHistory,
                icon: const Icon(Icons.refresh, color: AppTheme.neonBlue),
                label: const Text('Reintentar',
                    style: TextStyle(color: AppTheme.neonBlue)),
              ),
            ],
          ),
        ),
      );
    }

    if (_years.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.history, color: Colors.white38, size: 48),
            const SizedBox(height: 12),
            Text(
              'Sin historial de compras\npara este producto',
              style: TextStyle(
                color: Colors.white54,
                fontSize: Responsive.fontSize(context, small: 14, large: 16),
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      children: [
        _buildHeader(),
        const SizedBox(height: 12),
        _buildYearSelector(),
        const SizedBox(height: 12),
        _buildKpiCards(),
        const SizedBox(height: 16),
        _buildChartMetricSelector(),
        const SizedBox(height: 8),
        _buildBarChart(),
        const SizedBox(height: 16),
        if (_years.length >= 2) ...[
          _buildTrendLine(),
          const SizedBox(height: 16),
        ],
        _buildMonthlyTable(),
        const SizedBox(height: 12),
        _buildYearComparison(),
        const SizedBox(height: 24),
      ],
    );
  }

  // ── Header ──
  Widget _buildHeader() {
    final trendIcon = _trend == 'up'
        ? Icons.trending_up
        : _trend == 'down'
            ? Icons.trending_down
            : Icons.trending_flat;
    final trendColor = _trend == 'up'
        ? AppTheme.neonGreen
        : _trend == 'down'
            ? AppTheme.error
            : Colors.white54;
    final trendLabel = _trend == 'up'
        ? 'Subiendo'
        : _trend == 'down'
            ? 'Bajando'
            : 'Estable';

    final imageUrl = '${ApiConfig.baseUrl}/products/'
        '${Uri.encodeComponent(widget.productCode.trim())}/image';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Center(
          child: Container(
            width: 40, height: 4,
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: Colors.white24,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Container(
                width: 56, height: 56,
                color: AppTheme.darkCard,
                child: SmartProductImage(
                  imageUrl: imageUrl,
                  productCode: widget.productCode,
                  productName: widget.productName,
                  headers: ApiClient.authHeaders,
                  fit: BoxFit.cover,
                  borderRadius: BorderRadius.circular(10),
                  showCodeOnFallback: true,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.productName,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: Responsive.fontSize(
                          context, small: 15, large: 17),
                      fontWeight: FontWeight.bold,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text('Cod: ${widget.productCode}',
                      style: const TextStyle(
                          color: Colors.white38, fontSize: 11)),
                  const SizedBox(height: 2),
                  Text(
                    'Cliente: ${widget.clientCode}'
                    '${widget.clientName.isNotEmpty ? ' - ${widget.clientName}' : ''}',
                    style: const TextStyle(
                        color: AppTheme.neonBlue, fontSize: 11),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: 8, vertical: 5),
              decoration: BoxDecoration(
                color: trendColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                    color: trendColor.withValues(alpha: 0.4)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(trendIcon, color: trendColor, size: 16),
                  const SizedBox(width: 3),
                  Text(trendLabel,
                      style: TextStyle(
                          color: trendColor,
                          fontSize: 10,
                          fontWeight: FontWeight.bold)),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }

  // ── Year selector ──
  Widget _buildYearSelector() {
    final sortedYears = _years.keys.toList()..sort((a, b) => b.compareTo(a));
    return Row(
      children: [
        const Icon(Icons.calendar_today, color: Colors.white54, size: 14),
        const SizedBox(width: 6),
        const Text('Ejercicio:',
            style: TextStyle(color: Colors.white54, fontSize: 12)),
        const SizedBox(width: 8),
        ...sortedYears.map((yr) {
          final sel = yr == _selectedYear;
          return Padding(
            padding: const EdgeInsets.only(right: 6),
            child: GestureDetector(
              onTap: () => setState(() => _selectedYear = yr),
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: sel
                      ? AppTheme.neonBlue.withValues(alpha: 0.2)
                      : AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: sel ? AppTheme.neonBlue : AppTheme.borderColor,
                    width: sel ? 1.5 : 1,
                  ),
                ),
                child: Text(yr,
                    style: TextStyle(
                      color: sel ? AppTheme.neonBlue : Colors.white54,
                      fontSize: 13,
                      fontWeight: sel ? FontWeight.bold : FontWeight.normal,
                    )),
              ),
            ),
          );
        }),
        const Spacer(),
        GestureDetector(
          onTap: _loadHistory,
          child: const Icon(Icons.refresh, color: Colors.white38, size: 18),
        ),
      ],
    );
  }

  // ── KPI cards: 6 metrics ──
  Widget _buildKpiCards() {
    if (_selectedYear == null || !_years.containsKey(_selectedYear)) {
      return const SizedBox.shrink();
    }
    final t = _years[_selectedYear!]!.totals;
    final margin = t.sales > 0 ? ((t.sales - t.cost) / t.sales * 100) : 0.0;

    final items = [
      _KpiItem('Ventas', _fmtEur(t.sales), AppTheme.neonGreen),
      _KpiItem('Coste', _fmtEur(t.cost), Colors.orange),
      _KpiItem('Margen', _fmtPct(margin),
          margin > 15 ? AppTheme.neonGreen : AppTheme.error),
      _KpiItem('Envases', _fmtNum(t.envases), AppTheme.neonBlue),
      _KpiItem('Unidades', _fmtNum(t.units), Colors.amber),
      _KpiItem('Precio Medio',
          _fmtEur(t.avgPrice, decimals: 3), AppTheme.neonPurple),
    ];

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: items.map((item) {
        return SizedBox(
          width: (MediaQuery.of(context).size.width - 44) / 3,
          child: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                  color: item.color.withValues(alpha: 0.3)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.label,
                    style: const TextStyle(
                        color: Colors.white54, fontSize: 9)),
                const SizedBox(height: 3),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(item.value,
                      style: TextStyle(
                        color: item.color,
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                      )),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  // ── Chart metric selector ──
  Widget _buildChartMetricSelector() {
    final options = [
      (_ChartMetric.sales, 'Ventas \u20AC', Icons.euro_outlined),
      (_ChartMetric.envases, 'Envases', Icons.inventory_2_outlined),
      (_ChartMetric.units, 'Unidades', Icons.straighten_outlined),
      (_ChartMetric.avgPrice, 'Precio Medio', Icons.sell_outlined),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: options.map((opt) {
          final sel = _chartMetric == opt.$1;
          return Padding(
            padding: const EdgeInsets.only(right: 6),
            child: GestureDetector(
              onTap: () => setState(() => _chartMetric = opt.$1),
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: sel
                      ? AppTheme.neonBlue.withValues(alpha: 0.2)
                      : AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: sel ? AppTheme.neonBlue : AppTheme.borderColor,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(opt.$3,
                        size: 12,
                        color: sel ? AppTheme.neonBlue : Colors.white38),
                    const SizedBox(width: 4),
                    Text(opt.$2,
                        style: TextStyle(
                          color: sel ? AppTheme.neonBlue : Colors.white54,
                          fontSize: 11,
                          fontWeight:
                              sel ? FontWeight.bold : FontWeight.normal,
                        )),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  double _getMetricValue(_MonthData? d) {
    if (d == null) return 0;
    switch (_chartMetric) {
      case _ChartMetric.sales: return d.sales;
      case _ChartMetric.envases: return d.envases;
      case _ChartMetric.units: return d.units;
      case _ChartMetric.avgPrice: return d.avgPrice;
    }
  }

  String _metricLabel(double val) {
    switch (_chartMetric) {
      case _ChartMetric.sales:
        return '${val.toStringAsFixed(0)}\u20AC';
      case _ChartMetric.envases:
        return '${val.toStringAsFixed(0)} env';
      case _ChartMetric.units:
        return '${val.toStringAsFixed(0)} uds';
      case _ChartMetric.avgPrice:
        return '${val.toStringAsFixed(3)}\u20AC';
    }
  }

  // ── Bar chart ──
  Widget _buildBarChart() {
    if (_selectedYear == null) return const SizedBox.shrink();

    final sortedYears = _years.keys.toList()..sort((a, b) => b.compareTo(a));
    final currentYr = _selectedYear!;
    final currentIdx = sortedYears.indexOf(currentYr);
    final prevYr = currentIdx + 1 < sortedYears.length
        ? sortedYears[currentIdx + 1]
        : null;

    final currentData = _years[currentYr]!;
    final prevData = prevYr != null ? _years[prevYr] : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _legendDot(AppTheme.neonBlue, currentYr),
            if (prevYr != null) ...[
              const SizedBox(width: 8),
              _legendDot(Colors.white30, prevYr),
            ],
          ],
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 180,
          child: BarChart(
            BarChartData(
              barTouchData: BarTouchData(
                touchTooltipData: BarTouchTooltipData(
                  getTooltipItem: (group, groupIndex, rod, rodIndex) {
                    final month = _monthShort[group.x];
                    final yr = rodIndex == 0 ? currentYr : prevYr ?? '';
                    return BarTooltipItem(
                      '$month $yr\n${_metricLabel(rod.toY)}',
                      const TextStyle(
                          color: Colors.white, fontSize: 11),
                    );
                  },
                ),
              ),
              titlesData: FlTitlesData(
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 22,
                    getTitlesWidget: (value, meta) {
                      final idx = value.toInt();
                      if (idx < 0 || idx >= 12) {
                        return const SizedBox.shrink();
                      }
                      return Text(_monthShort[idx],
                          style: const TextStyle(
                              color: Colors.white38, fontSize: 8));
                    },
                  ),
                ),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 44,
                    getTitlesWidget: (value, meta) {
                      final label = value >= 1000
                          ? '${(value / 1000).toStringAsFixed(1)}k'
                          : value.toStringAsFixed(0);
                      return Text(label,
                          style: const TextStyle(
                              color: Colors.white24, fontSize: 9));
                    },
                  ),
                ),
                topTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false)),
              ),
              gridData: FlGridData(
                show: true,
                drawVerticalLine: false,
                getDrawingHorizontalLine: (value) =>
                    FlLine(color: Colors.white10, strokeWidth: 0.5),
              ),
              borderData: FlBorderData(show: false),
              barGroups: List.generate(12, (i) {
                final mo = '${i + 1}';
                final curVal = _getMetricValue(currentData.months[mo]);
                final prevVal = prevData != null
                    ? _getMetricValue(prevData.months[mo])
                    : 0.0;
                return BarChartGroupData(
                  x: i,
                  barRods: [
                    BarChartRodData(
                      toY: curVal,
                      color: AppTheme.neonBlue,
                      width: prevYr != null ? 6 : 10,
                      borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(3)),
                    ),
                    if (prevYr != null)
                      BarChartRodData(
                        toY: prevVal,
                        color: Colors.white24,
                        width: 6,
                        borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(3)),
                      ),
                  ],
                );
              }),
            ),
          ),
        ),
      ],
    );
  }

  // ── Trend line ──
  Widget _buildTrendLine() {
    final sortedYears = _years.keys.toList()..sort();
    if (sortedYears.length < 2) return const SizedBox.shrink();

    final colors = [Colors.white30, AppTheme.neonPurple, AppTheme.neonBlue];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text('Tendencia interanual',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                )),
            const Spacer(),
            ...sortedYears.asMap().entries.map(
                  (e) => Padding(
                    padding: const EdgeInsets.only(left: 6),
                    child: _legendDot(
                        colors[e.key % colors.length], e.value),
                  ),
                ),
          ],
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 140,
          child: LineChart(
            LineChartData(
              lineTouchData: LineTouchData(
                touchTooltipData: LineTouchTooltipData(
                  getTooltipItems: (spots) {
                    return spots.map((spot) {
                      final yr = sortedYears[spot.barIndex];
                      return LineTooltipItem(
                        '$yr: ${_metricLabel(spot.y)}',
                        TextStyle(
                          color: colors[spot.barIndex % colors.length],
                          fontSize: 11,
                        ),
                      );
                    }).toList();
                  },
                ),
              ),
              gridData: FlGridData(
                show: true,
                drawVerticalLine: false,
                getDrawingHorizontalLine: (value) =>
                    FlLine(color: Colors.white10, strokeWidth: 0.5),
              ),
              titlesData: FlTitlesData(
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 22,
                    interval: 2,
                    getTitlesWidget: (value, meta) {
                      final idx = value.toInt();
                      if (idx < 0 || idx >= 12) {
                        return const SizedBox.shrink();
                      }
                      return Text(_monthShort[idx],
                          style: const TextStyle(
                              color: Colors.white38, fontSize: 9));
                    },
                  ),
                ),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 40,
                    getTitlesWidget: (value, meta) {
                      final label = value >= 1000
                          ? '${(value / 1000).toStringAsFixed(0)}k'
                          : value.toStringAsFixed(0);
                      return Text(label,
                          style: const TextStyle(
                              color: Colors.white24, fontSize: 9));
                    },
                  ),
                ),
                topTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false)),
              ),
              borderData: FlBorderData(show: false),
              lineBarsData: sortedYears.asMap().entries.map((entry) {
                final yr = entry.value;
                final color = colors[entry.key % colors.length];
                final yearData = _years[yr]!;
                final spots = <FlSpot>[];
                for (int m = 1; m <= 12; m++) {
                  final val = _getMetricValue(yearData.months['$m']);
                  if (val > 0 ||
                      m <= DateTime.now().month ||
                      yr != sortedYears.last) {
                    spots.add(FlSpot(m.toDouble() - 1, val));
                  }
                }
                final isLatest = entry.key == sortedYears.length - 1;
                return LineChartBarData(
                  spots: spots,
                  isCurved: true,
                  color: color,
                  barWidth: isLatest ? 2.5 : 1.5,
                  dotData: FlDotData(show: spots.length < 13),
                  belowBarData: isLatest
                      ? BarAreaData(
                          show: true,
                          color: color.withValues(alpha: 0.08),
                        )
                      : BarAreaData(show: false),
                );
              }).toList(),
            ),
          ),
        ),
      ],
    );
  }

  // ── Monthly detail table (expanded) ──
  Widget _buildMonthlyTable() {
    if (_selectedYear == null || !_years.containsKey(_selectedYear)) {
      return const SizedBox.shrink();
    }

    final yearData = _years[_selectedYear!]!;
    final activeMonths = <int>[];
    for (int m = 1; m <= 12; m++) {
      final d = yearData.months['$m'];
      if (d != null && (d.sales > 0 || d.envases > 0 || d.units > 0)) {
        activeMonths.add(m);
      }
    }

    if (activeMonths.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Center(
          child: Text('Sin datos para este ejercicio',
              style: TextStyle(color: Colors.white38, fontSize: 13)),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Detalle mensual $_selectedYear',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.bold,
            )),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: AppTheme.darkCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
                color: AppTheme.borderColor.withValues(alpha: 0.3)),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingRowHeight: 36,
              dataRowMinHeight: 34,
              dataRowMaxHeight: 34,
              columnSpacing: 12,
              horizontalMargin: 10,
              headingTextStyle: const TextStyle(
                color: AppTheme.neonBlue,
                fontSize: 10,
                fontWeight: FontWeight.bold,
              ),
              dataTextStyle: const TextStyle(
                  color: Colors.white70, fontSize: 10),
              columns: const [
                DataColumn(label: Text('Mes')),
                DataColumn(label: Text('Env'), numeric: true),
                DataColumn(label: Text('Uds'), numeric: true),
                DataColumn(label: Text('Ventas'), numeric: true),
                DataColumn(label: Text('Coste'), numeric: true),
                DataColumn(label: Text('Margen'), numeric: true),
                DataColumn(label: Text('P.Medio'), numeric: true),
                DataColumn(label: Text('P.Tarifa'), numeric: true),
                DataColumn(label: Text('Dto%'), numeric: true),
                DataColumn(label: Text('Lineas'), numeric: true),
              ],
              rows: [
                ...activeMonths.map((m) {
                  final d = yearData.months['$m']!;
                  final margin = d.sales > 0
                      ? ((d.sales - d.cost) / d.sales * 100)
                      : 0.0;
                  final marginColor = margin > 15
                      ? AppTheme.neonGreen
                      : margin > 0
                          ? Colors.orange
                          : AppTheme.error;
                  return DataRow(cells: [
                    DataCell(Text(_monthNames[m - 1].substring(0, 3),
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w500,
                          fontSize: 10,
                        ))),
                    DataCell(Text(_fmtNum(d.envases))),
                    DataCell(Text(_fmtNum(d.units))),
                    DataCell(Text(_fmtEur(d.sales),
                        style: const TextStyle(
                            color: AppTheme.neonGreen, fontSize: 10))),
                    DataCell(Text(_fmtEur(d.cost))),
                    DataCell(Text(_fmtPct(margin),
                        style: TextStyle(
                            color: marginColor, fontSize: 10))),
                    DataCell(Text(d.avgPrice > 0
                        ? _fmtEur(d.avgPrice, decimals: 3)
                        : '-')),
                    DataCell(Text(d.avgTariff > 0
                        ? _fmtEur(d.avgTariff, decimals: 3)
                        : '-')),
                    DataCell(Text(d.avgDiscount != null
                        ? _fmtPct(d.avgDiscount!)
                        : '-')),
                    DataCell(Text('${d.lineCount}')),
                  ]);
                }),
                // Totals row
                _totalRow(yearData),
              ],
            ),
          ),
        ),
      ],
    );
  }

  DataRow _totalRow(_YearData yearData) {
    final t = yearData.totals;
    final margin = t.sales > 0
        ? ((t.sales - t.cost) / t.sales * 100)
        : 0.0;
    const s = TextStyle(
      color: AppTheme.neonGreen,
      fontWeight: FontWeight.bold,
      fontSize: 10,
    );
    return DataRow(cells: [
      const DataCell(Text('TOTAL', style: s)),
      DataCell(Text(_fmtNum(t.envases), style: s)),
      DataCell(Text(_fmtNum(t.units), style: s)),
      DataCell(Text(_fmtEur(t.sales), style: s)),
      DataCell(Text(_fmtEur(t.cost), style: s)),
      DataCell(Text(_fmtPct(margin), style: s)),
      DataCell(Text(
          t.avgPrice > 0 ? _fmtEur(t.avgPrice, decimals: 3) : '-',
          style: s)),
      const DataCell(Text('-', style: s)),
      const DataCell(Text('-', style: s)),
      DataCell(Text('${t.lineCount}', style: s)),
    ]);
  }

  // ── Year-over-year comparison ──
  Widget _buildYearComparison() {
    if (_years.length < 2) return const SizedBox.shrink();

    final sortedYears = _years.keys.toList()..sort((a, b) => b.compareTo(a));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Comparativa por ejercicio',
            style: TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.bold,
            )),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: AppTheme.darkCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
                color: AppTheme.borderColor.withValues(alpha: 0.3)),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingRowHeight: 36,
              dataRowMinHeight: 36,
              dataRowMaxHeight: 36,
              columnSpacing: 14,
              horizontalMargin: 10,
              headingTextStyle: const TextStyle(
                color: AppTheme.neonPurple,
                fontSize: 10,
                fontWeight: FontWeight.bold,
              ),
              dataTextStyle: const TextStyle(
                  color: Colors.white70, fontSize: 11),
              columns: const [
                DataColumn(label: Text('Ano')),
                DataColumn(label: Text('Ventas'), numeric: true),
                DataColumn(label: Text('Coste'), numeric: true),
                DataColumn(label: Text('Margen%'), numeric: true),
                DataColumn(label: Text('Env'), numeric: true),
                DataColumn(label: Text('Uds'), numeric: true),
                DataColumn(label: Text('P.Medio'), numeric: true),
                DataColumn(label: Text('Lineas'), numeric: true),
                DataColumn(label: Text('vs Ant.'), numeric: true),
              ],
              rows: sortedYears.asMap().entries.map((entry) {
                final yr = entry.value;
                final t = _years[yr]!.totals;
                final margin = t.sales > 0
                    ? ((t.sales - t.cost) / t.sales * 100)
                    : 0.0;
                // YoY change
                String yoy = '-';
                Color yoyColor = Colors.white38;
                if (entry.key + 1 < sortedYears.length) {
                  final prevT = _years[sortedYears[entry.key + 1]]!.totals;
                  if (prevT.sales > 0) {
                    final pct =
                        ((t.sales - prevT.sales) / prevT.sales * 100);
                    yoy = '${pct >= 0 ? '+' : ''}${pct.toStringAsFixed(0)}%';
                    yoyColor = pct > 0
                        ? AppTheme.neonGreen
                        : pct < 0
                            ? AppTheme.error
                            : Colors.white54;
                  }
                }
                return DataRow(cells: [
                  DataCell(Text(yr,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ))),
                  DataCell(Text(_fmtEur(t.sales),
                      style: const TextStyle(
                          color: AppTheme.neonGreen, fontSize: 11))),
                  DataCell(Text(_fmtEur(t.cost))),
                  DataCell(Text(_fmtPct(margin),
                      style: TextStyle(
                        color: margin > 15
                            ? AppTheme.neonGreen
                            : AppTheme.error,
                        fontSize: 11,
                      ))),
                  DataCell(Text(_fmtNum(t.envases))),
                  DataCell(Text(_fmtNum(t.units))),
                  DataCell(Text(t.avgPrice > 0
                      ? _fmtEur(t.avgPrice, decimals: 3)
                      : '-')),
                  DataCell(Text('${t.lineCount}')),
                  DataCell(Text(yoy, style: TextStyle(
                      color: yoyColor,
                      fontWeight: FontWeight.bold,
                      fontSize: 11))),
                ]);
              }).toList(),
            ),
          ),
        ),
        // Grand total
        if (_years.length > 1) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                  color: AppTheme.neonPurple.withValues(alpha: 0.3)),
            ),
            child: Row(
              children: [
                const Icon(Icons.summarize,
                    color: AppTheme.neonPurple, size: 16),
                const SizedBox(width: 6),
                Text(
                  'Total ${_grandTotal.years} ejercicios: ',
                  style: const TextStyle(
                      color: Colors.white54, fontSize: 11),
                ),
                Text(_fmtEur(_grandTotal.sales),
                    style: const TextStyle(
                      color: AppTheme.neonGreen,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    )),
                const Text(' ventas  |  ',
                    style: TextStyle(
                        color: Colors.white38, fontSize: 11)),
                Text(_fmtNum(_grandTotal.envases),
                    style: const TextStyle(
                      color: AppTheme.neonBlue,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    )),
                const Text(' env  |  ',
                    style: TextStyle(
                        color: Colors.white38, fontSize: 11)),
                Text(_fmtNum(_grandTotal.units),
                    style: const TextStyle(
                      color: Colors.amber,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    )),
                const Text(' uds',
                    style: TextStyle(
                        color: Colors.white38, fontSize: 11)),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _legendDot(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8, height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 3),
        Text(label, style: TextStyle(color: color, fontSize: 10)),
      ],
    );
  }
}

// ── Data Models ──

class _KpiItem {
  final String label;
  final String value;
  final Color color;
  _KpiItem(this.label, this.value, this.color);
}

class _MonthData {
  final double sales;
  final double cost;
  final double units;
  final double envases;
  final double avgPrice;
  final double avgTariff;
  final double? avgDiscount;
  final int lineCount;

  _MonthData({
    this.sales = 0,
    this.cost = 0,
    this.units = 0,
    this.envases = 0,
    this.avgPrice = 0,
    this.avgTariff = 0,
    this.avgDiscount,
    this.lineCount = 0,
  });

  factory _MonthData.fromJson(Map<String, dynamic> j) => _MonthData(
        sales: (j['sales'] as num?)?.toDouble() ?? 0,
        cost: (j['cost'] as num?)?.toDouble() ?? 0,
        units: (j['units'] as num?)?.toDouble() ?? 0,
        envases: (j['envases'] as num?)?.toDouble() ?? 0,
        avgPrice: (j['avgPrice'] as num?)?.toDouble() ?? 0,
        avgTariff: (j['avgTariff'] as num?)?.toDouble() ?? 0,
        avgDiscount: j['avgDiscount'] != null
            ? (j['avgDiscount'] as num).toDouble()
            : null,
        lineCount: (j['lineCount'] as num?)?.toInt() ?? 0,
      );
}

class _YearTotals {
  final double sales;
  final double cost;
  final double units;
  final double envases;
  final double avgPrice;
  final int lineCount;

  _YearTotals({
    this.sales = 0,
    this.cost = 0,
    this.units = 0,
    this.envases = 0,
    this.avgPrice = 0,
    this.lineCount = 0,
  });

  factory _YearTotals.fromJson(Map<String, dynamic> j) => _YearTotals(
        sales: (j['sales'] as num?)?.toDouble() ?? 0,
        cost: (j['cost'] as num?)?.toDouble() ?? 0,
        units: (j['units'] as num?)?.toDouble() ?? 0,
        envases: (j['envases'] as num?)?.toDouble() ?? 0,
        avgPrice: (j['avgPrice'] as num?)?.toDouble() ?? 0,
        lineCount: (j['lineCount'] as num?)?.toInt() ?? 0,
      );
}

class _YearData {
  final Map<String, _MonthData> months;
  final _YearTotals totals;

  _YearData({required this.months, required this.totals});

  factory _YearData.fromJson(Map<String, dynamic> j) {
    final monthsRaw = j['months'] as Map<String, dynamic>? ?? {};
    final months = <String, _MonthData>{};
    for (final e in monthsRaw.entries) {
      months[e.key] =
          _MonthData.fromJson(e.value as Map<String, dynamic>);
    }
    return _YearData(
      months: months,
      totals: _YearTotals.fromJson(
          j['totals'] as Map<String, dynamic>? ?? {}),
    );
  }
}

class _GrandTotal {
  final double sales;
  final double cost;
  final double units;
  final double envases;
  final double avgPrice;
  final int years;

  _GrandTotal({
    this.sales = 0,
    this.cost = 0,
    this.units = 0,
    this.envases = 0,
    this.avgPrice = 0,
    this.years = 0,
  });

  factory _GrandTotal.fromJson(Map<String, dynamic> j) => _GrandTotal(
        sales: (j['sales'] as num?)?.toDouble() ?? 0,
        cost: (j['cost'] as num?)?.toDouble() ?? 0,
        units: (j['units'] as num?)?.toDouble() ?? 0,
        envases: (j['envases'] as num?)?.toDouble() ?? 0,
        avgPrice: (j['avgPrice'] as num?)?.toDouble() ?? 0,
        years: (j['years'] as num?)?.toInt() ?? 0,
      );
}
