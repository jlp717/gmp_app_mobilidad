/// Product History Sheet
/// ====================
/// Bottom sheet showing a client's purchase history for a specific product
/// with monthly bar chart, trend line, and data table

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

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
    return showModalBottomSheet(
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

class _ProductHistorySheetState extends State<ProductHistorySheet> {
  bool _loading = true;
  String? _error;
  Map<String, _YearData> _years = {};
  _GrandTotal _grandTotal = _GrandTotal();
  String _trend = 'stable';
  bool _showSales = false; // false = envases, true = sales €

  static const _months = [
    'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
    'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'
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
        '/pedidos/product-history/${widget.productCode}/${widget.clientCode}',
      );
      final yearsRaw = resp['years'] as Map<String, dynamic>? ?? {};
      final years = <String, _YearData>{};
      for (final entry in yearsRaw.entries) {
        years[entry.key] = _YearData.fromJson(
          entry.value as Map<String, dynamic>,
        );
      }
      final gt = resp['grandTotal'] as Map<String, dynamic>? ?? {};
      setState(() {
        _years = years;
        _grandTotal = _GrandTotal.fromJson(gt);
        _trend = (resp['trend'] ?? 'stable').toString();
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

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
              const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
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
            Icon(Icons.history, color: Colors.white38, size: 48),
            const SizedBox(height: 12),
            Text('Sin historial de compras\npara este producto',
                style: TextStyle(
                  color: Colors.white54,
                  fontSize: Responsive.fontSize(context, small: 14, large: 16),
                ),
                textAlign: TextAlign.center),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      children: [
        _buildHeader(),
        const SizedBox(height: 16),
        _buildSummaryCards(),
        const SizedBox(height: 20),
        _buildBarChart(),
        const SizedBox(height: 20),
        _buildTrendLine(),
        const SizedBox(height: 20),
        _buildDataTable(),
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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Drag handle
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
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.productName,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: Responsive.fontSize(context, small: 16, large: 18),
                      fontWeight: FontWeight.bold,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${widget.productCode} · ${widget.clientName}',
                    style: TextStyle(
                      color: AppTheme.neonBlue,
                      fontSize: Responsive.fontSize(context, small: 12, large: 13),
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: trendColor.withOpacity(0.15),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: trendColor.withOpacity(0.4)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(trendIcon, color: trendColor, size: 18),
                  const SizedBox(width: 4),
                  Text(
                    _trend == 'up' ? 'Subiendo' : _trend == 'down' ? 'Bajando' : 'Estable',
                    style: TextStyle(color: trendColor, fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }

  // ── Summary Cards ──
  Widget _buildSummaryCards() {
    final cards = [
      _SummaryItem('Ventas', '\u20AC${_grandTotal.sales.toStringAsFixed(0)}', AppTheme.neonGreen),
      _SummaryItem('Envases', _grandTotal.envases.toStringAsFixed(0), AppTheme.neonBlue),
      _SummaryItem('Precio Medio', '\u20AC${_grandTotal.avgPrice.toStringAsFixed(3)}', AppTheme.neonPurple),
      _SummaryItem('Periodos', '${_grandTotal.years} anos', Colors.white70),
    ];

    return SizedBox(
      height: 68,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: cards.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (_, i) {
          final c = cards[i];
          return Container(
            width: 110,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: c.color.withOpacity(0.3)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(c.label,
                    style: TextStyle(color: Colors.white54, fontSize: 10)),
                const SizedBox(height: 4),
                Text(c.value,
                    style: TextStyle(
                      color: c.color,
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                    )),
              ],
            ),
          );
        },
      ),
    );
  }

  // ── Bar Chart: Monthly envases/sales ──
  Widget _buildBarChart() {
    final sortedYears = _years.keys.toList()..sort((a, b) => b.compareTo(a));
    if (sortedYears.isEmpty) return const SizedBox.shrink();

    final currentYr = sortedYears.first;
    final prevYr = sortedYears.length > 1 ? sortedYears[1] : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              _showSales ? 'Ventas (\u20AC) por mes' : 'Cajas por mes',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.bold,
              ),
            ),
            const Spacer(),
            // Toggle sales/envases
            GestureDetector(
              onTap: () => setState(() => _showSales = !_showSales),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.borderColor),
                ),
                child: Text(
                  _showSales ? '\u20AC Ventas' : 'Cajas',
                  style: const TextStyle(color: AppTheme.neonBlue, fontSize: 11),
                ),
              ),
            ),
            const SizedBox(width: 8),
            // Legend
            _legendDot(AppTheme.neonBlue, currentYr),
            if (prevYr != null) ...[
              const SizedBox(width: 8),
              _legendDot(Colors.white24, prevYr),
            ],
          ],
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 200,
          child: BarChart(
            BarChartData(
              barTouchData: BarTouchData(
                touchTooltipData: BarTouchTooltipData(
                  getTooltipItem: (group, groupIndex, rod, rodIndex) {
                    final month = _months[group.x];
                    final yr = rodIndex == 0 ? currentYr : prevYr ?? '';
                    final val = rod.toY;
                    return BarTooltipItem(
                      '$month $yr\n${_showSales ? '\u20AC${val.toStringAsFixed(0)}' : '${val.toStringAsFixed(1)} cj'}',
                      const TextStyle(color: Colors.white, fontSize: 11),
                    );
                  },
                ),
              ),
              titlesData: FlTitlesData(
                show: true,
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 22,
                    getTitlesWidget: (value, meta) {
                      final idx = value.toInt();
                      if (idx < 0 || idx >= 12) return const SizedBox.shrink();
                      return Text(_months[idx],
                          style: const TextStyle(color: Colors.white38, fontSize: 9));
                    },
                  ),
                ),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 40,
                    getTitlesWidget: (value, meta) {
                      return Text(
                        value >= 1000 ? '${(value / 1000).toStringAsFixed(0)}k' : value.toStringAsFixed(0),
                        style: const TextStyle(color: Colors.white24, fontSize: 9),
                      );
                    },
                  ),
                ),
                topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
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
                final curVal = _showSales
                    ? (_years[currentYr]?.months[mo]?.sales ?? 0)
                    : (_years[currentYr]?.months[mo]?.envases ?? 0);
                final prevVal = prevYr != null
                    ? (_showSales
                        ? (_years[prevYr]?.months[mo]?.sales ?? 0)
                        : (_years[prevYr]?.months[mo]?.envases ?? 0))
                    : 0.0;

                return BarChartGroupData(
                  x: i,
                  barRods: [
                    BarChartRodData(
                      toY: curVal,
                      color: AppTheme.neonBlue,
                      width: prevYr != null ? 6 : 10,
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                    ),
                    if (prevYr != null)
                      BarChartRodData(
                        toY: prevVal,
                        color: Colors.white24,
                        width: 6,
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
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

  // ── Trend Line Chart ──
  Widget _buildTrendLine() {
    final sortedYears = _years.keys.toList()..sort();
    if (sortedYears.length < 2) return const SizedBox.shrink();

    final colors = [Colors.white24, AppTheme.neonPurple, AppTheme.neonBlue];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text('Tendencia interanual (\u20AC)',
                style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
            const Spacer(),
            ...sortedYears.asMap().entries.map((e) => Padding(
              padding: const EdgeInsets.only(left: 8),
              child: _legendDot(colors[e.key % colors.length], e.value),
            )),
          ],
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 160,
          child: LineChart(
            LineChartData(
              lineTouchData: LineTouchData(
                touchTooltipData: LineTouchTooltipData(
                  getTooltipItems: (spots) {
                    return spots.map((spot) {
                      final yr = sortedYears[spot.barIndex];
                      return LineTooltipItem(
                        '$yr: \u20AC${spot.y.toStringAsFixed(0)}',
                        TextStyle(color: colors[spot.barIndex % colors.length], fontSize: 11),
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
                      if (idx < 0 || idx >= 12) return const SizedBox.shrink();
                      return Text(_months[idx],
                          style: const TextStyle(color: Colors.white38, fontSize: 9));
                    },
                  ),
                ),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 40,
                    getTitlesWidget: (value, meta) {
                      return Text(
                        value >= 1000 ? '${(value / 1000).toStringAsFixed(0)}k' : value.toStringAsFixed(0),
                        style: const TextStyle(color: Colors.white24, fontSize: 9),
                      );
                    },
                  ),
                ),
                topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              ),
              borderData: FlBorderData(show: false),
              lineBarsData: sortedYears.asMap().entries.map((entry) {
                final yr = entry.value;
                final color = colors[entry.key % colors.length];
                final yearData = _years[yr]!;
                final spots = <FlSpot>[];
                for (int m = 1; m <= 12; m++) {
                  final val = yearData.months['$m']?.sales ?? 0;
                  if (val > 0 || m <= DateTime.now().month || yr != sortedYears.last) {
                    spots.add(FlSpot(m.toDouble() - 1, val));
                  }
                }
                return LineChartBarData(
                  spots: spots,
                  isCurved: true,
                  color: color,
                  barWidth: entry.key == sortedYears.length - 1 ? 2.5 : 1.5,
                  dotData: FlDotData(show: spots.length < 13),
                  belowBarData: entry.key == sortedYears.length - 1
                      ? BarAreaData(
                          show: true,
                          color: color.withOpacity(0.08),
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

  // ── Data Table ──
  Widget _buildDataTable() {
    final sortedYears = _years.keys.toList()..sort((a, b) => b.compareTo(a));
    if (sortedYears.isEmpty) return const SizedBox.shrink();

    final currentYr = sortedYears.first;
    final yearData = _years[currentYr]!;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Detalle mensual $currentYr',
            style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: AppTheme.darkCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.borderColor.withOpacity(0.3)),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingRowHeight: 36,
              dataRowMinHeight: 32,
              dataRowMaxHeight: 32,
              columnSpacing: 16,
              horizontalMargin: 12,
              headingTextStyle: const TextStyle(
                color: AppTheme.neonBlue, fontSize: 11, fontWeight: FontWeight.bold,
              ),
              dataTextStyle: const TextStyle(color: Colors.white70, fontSize: 11),
              columns: const [
                DataColumn(label: Text('Mes')),
                DataColumn(label: Text('Cajas'), numeric: true),
                DataColumn(label: Text('Uds'), numeric: true),
                DataColumn(label: Text('Ventas \u20AC'), numeric: true),
                DataColumn(label: Text('Precio'), numeric: true),
                DataColumn(label: Text('Dto %'), numeric: true),
              ],
              rows: [
                ...List.generate(12, (i) {
                  final mo = '${i + 1}';
                  final d = yearData.months[mo];
                  final hasData = d != null && (d.sales > 0 || d.envases > 0);
                  final style = TextStyle(
                    color: hasData ? Colors.white : Colors.white24,
                    fontSize: 11,
                  );
                  return DataRow(
                    cells: [
                      DataCell(Text(_months[i], style: style)),
                      DataCell(Text(d?.envases.toStringAsFixed(0) ?? '-', style: style)),
                      DataCell(Text(d?.units.toStringAsFixed(0) ?? '-', style: style)),
                      DataCell(Text(d != null ? d.sales.toStringAsFixed(0) : '-', style: style)),
                      DataCell(Text(d != null && d.avgPrice > 0 ? d.avgPrice.toStringAsFixed(3) : '-', style: style)),
                      DataCell(Text(d?.avgDiscount != null ? d!.avgDiscount!.toStringAsFixed(1) : '-', style: style)),
                    ],
                  );
                }),
                // Totals row
                DataRow(
                  cells: [
                    DataCell(Text('TOTAL',
                        style: TextStyle(color: AppTheme.neonGreen, fontWeight: FontWeight.bold, fontSize: 11))),
                    DataCell(Text(yearData.totals.envases.toStringAsFixed(0),
                        style: TextStyle(color: AppTheme.neonGreen, fontWeight: FontWeight.bold, fontSize: 11))),
                    DataCell(Text(yearData.totals.units.toStringAsFixed(0),
                        style: TextStyle(color: AppTheme.neonGreen, fontWeight: FontWeight.bold, fontSize: 11))),
                    DataCell(Text(yearData.totals.sales.toStringAsFixed(0),
                        style: TextStyle(color: AppTheme.neonGreen, fontWeight: FontWeight.bold, fontSize: 11))),
                    DataCell(Text(yearData.totals.avgPrice > 0 ? yearData.totals.avgPrice.toStringAsFixed(3) : '-',
                        style: TextStyle(color: AppTheme.neonGreen, fontWeight: FontWeight.bold, fontSize: 11))),
                    DataCell(Text('-',
                        style: TextStyle(color: AppTheme.neonGreen, fontSize: 11))),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _legendDot(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 8, height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 3),
        Text(label, style: TextStyle(color: color, fontSize: 10)),
      ],
    );
  }
}

// ── Models ──

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
    this.sales = 0, this.cost = 0, this.units = 0, this.envases = 0,
    this.avgPrice = 0, this.avgTariff = 0, this.avgDiscount,
    this.lineCount = 0,
  });

  factory _MonthData.fromJson(Map<String, dynamic> j) => _MonthData(
    sales: (j['sales'] as num?)?.toDouble() ?? 0,
    cost: (j['cost'] as num?)?.toDouble() ?? 0,
    units: (j['units'] as num?)?.toDouble() ?? 0,
    envases: (j['envases'] as num?)?.toDouble() ?? 0,
    avgPrice: (j['avgPrice'] as num?)?.toDouble() ?? 0,
    avgTariff: (j['avgTariff'] as num?)?.toDouble() ?? 0,
    avgDiscount: j['avgDiscount'] != null ? (j['avgDiscount'] as num).toDouble() : null,
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
    this.sales = 0, this.cost = 0, this.units = 0, this.envases = 0,
    this.avgPrice = 0, this.lineCount = 0,
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
      months[e.key] = _MonthData.fromJson(e.value as Map<String, dynamic>);
    }
    return _YearData(
      months: months,
      totals: _YearTotals.fromJson(j['totals'] as Map<String, dynamic>? ?? {}),
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
    this.sales = 0, this.cost = 0, this.units = 0, this.envases = 0,
    this.avgPrice = 0, this.years = 0,
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

class _SummaryItem {
  final String label;
  final String value;
  final Color color;
  _SummaryItem(this.label, this.value, this.color);
}
