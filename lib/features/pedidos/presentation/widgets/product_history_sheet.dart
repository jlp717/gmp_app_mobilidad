/// Product History Sheet
/// ====================
/// Bottom sheet showing a client's purchase history for a specific product
/// with year selector, bar chart, trend line, and monthly data table.
/// Design matches the sales_history ProductHistoryPage style.

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
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

  /// Selected year for detail view (null = most recent)
  String? _selectedYear;

  /// Toggle between envases and ventas €
  bool _showSales = false;

  static const _monthNames = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  static const _monthShort = [
    'ENE',
    'FEB',
    'MAR',
    'ABR',
    'MAY',
    'JUN',
    'JUL',
    'AGO',
    'SEP',
    'OCT',
    'NOV',
    'DIC',
  ];

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    setState(() {
      _loading = true;
      _error = null;
    });
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
      setState(() {
        _years = years;
        _grandTotal = _GrandTotal.fromJson(gt);
        _trend = (resp['trend'] ?? 'stable').toString();
        _selectedYear = sortedKeys.isNotEmpty ? sortedKeys.first : null;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  String _fmtEur(double val, {int decimals = 2}) {
    if (val >= 1000) {
      return '${val.toStringAsFixed(decimals)}\u20AC';
    }
    return '${val.toStringAsFixed(decimals)}\u20AC';
  }

  String _fmtNum(double val, {int decimals = 0}) {
    return val.toStringAsFixed(decimals);
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
            Text(
              'Cargando historial...',
              style: TextStyle(color: Colors.white54),
            ),
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
              Text(
                'Error: $_error',
                style: const TextStyle(color: Colors.white70),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: _loadHistory,
                icon: const Icon(Icons.refresh, color: AppTheme.neonBlue),
                label: const Text(
                  'Reintentar',
                  style: TextStyle(color: AppTheme.neonBlue),
                ),
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
                fontSize:
                    Responsive.fontSize(context, small: 14, large: 16),
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
        _buildSummaryRow(),
        const SizedBox(height: 16),
        _buildBarChart(),
        const SizedBox(height: 16),
        if (_years.length >= 2) ...[
          _buildTrendLine(),
          const SizedBox(height: 16),
        ],
        _buildMonthlyTable(),
        const SizedBox(height: 24),
      ],
    );
  }

  // ── Header: product info + trend badge ──
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
    final trendLabel =
        _trend == 'up' ? 'Subiendo' : _trend == 'down' ? 'Bajando' : 'Estable';

    final imageUrl = '${ApiConfig.baseUrl}/products/'
        '${Uri.encodeComponent(widget.productCode.trim())}/image';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Drag handle
        Center(
          child: Container(
            width: 40,
            height: 4,
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
            // Product thumbnail
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Container(
                width: 56,
                height: 56,
                color: AppTheme.darkCard,
                child: Image.network(
                  imageUrl,
                  headers: ApiClient.authHeaders,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const Icon(
                    Icons.image_not_supported_outlined,
                    color: Colors.white24,
                    size: 28,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            // Product name + code + client
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
                  Text(
                    'Cod: ${widget.productCode}',
                    style: const TextStyle(
                        color: Colors.white38, fontSize: 11),
                  ),
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
            // Trend badge
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
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
                  Text(
                    trendLabel,
                    style: TextStyle(
                      color: trendColor,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }

  // ── Year selector chips ──
  Widget _buildYearSelector() {
    final sortedYears = _years.keys.toList()..sort((a, b) => b.compareTo(a));

    return Row(
      children: [
        const Icon(Icons.calendar_today, color: Colors.white54, size: 14),
        const SizedBox(width: 6),
        const Text(
          'Ejercicio:',
          style: TextStyle(color: Colors.white54, fontSize: 12),
        ),
        const SizedBox(width: 8),
        ...sortedYears.map((yr) {
          final isSelected = yr == _selectedYear;
          return Padding(
            padding: const EdgeInsets.only(right: 6),
            child: GestureDetector(
              onTap: () => setState(() => _selectedYear = yr),
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: isSelected
                      ? AppTheme.neonBlue.withValues(alpha: 0.2)
                      : AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: isSelected
                        ? AppTheme.neonBlue
                        : AppTheme.borderColor,
                    width: isSelected ? 1.5 : 1,
                  ),
                ),
                child: Text(
                  yr,
                  style: TextStyle(
                    color:
                        isSelected ? AppTheme.neonBlue : Colors.white54,
                    fontSize: 13,
                    fontWeight: isSelected
                        ? FontWeight.bold
                        : FontWeight.normal,
                  ),
                ),
              ),
            ),
          );
        }),
        const Spacer(),
        // Refresh
        GestureDetector(
          onTap: _loadHistory,
          child: const Icon(Icons.refresh, color: Colors.white38, size: 18),
        ),
      ],
    );
  }

  // ── Summary row: 4 KPI cards ──
  Widget _buildSummaryRow() {
    if (_selectedYear == null || !_years.containsKey(_selectedYear)) {
      return const SizedBox.shrink();
    }
    final t = _years[_selectedYear!]!.totals;

    final items = [
      _KpiItem('Ventas', _fmtEur(t.sales), AppTheme.neonGreen),
      _KpiItem('Envases', _fmtNum(t.envases), AppTheme.neonBlue),
      _KpiItem('Unidades', _fmtNum(t.units), Colors.amber),
      _KpiItem('Precio Medio', _fmtEur(t.avgPrice, decimals: 3),
          AppTheme.neonPurple),
    ];

    return Row(
      children: items.map((item) {
        return Expanded(
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 3),
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
                Text(
                  item.label,
                  style: const TextStyle(
                      color: Colors.white54, fontSize: 9),
                ),
                const SizedBox(height: 3),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    item.value,
                    style: TextStyle(
                      color: item.color,
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  // ── Bar chart: monthly data for selected year vs previous ──
  Widget _buildBarChart() {
    if (_selectedYear == null) return const SizedBox.shrink();

    final sortedYears = _years.keys.toList()..sort((a, b) => b.compareTo(a));
    final currentYr = _selectedYear!;
    final currentIdx = sortedYears.indexOf(currentYr);
    final prevYr = currentIdx + 1 < sortedYears.length
        ? sortedYears[currentIdx + 1]
        : null;

    // Only show months that have data in either year
    final currentData = _years[currentYr]!;
    final prevData = prevYr != null ? _years[prevYr] : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              _showSales ? 'Ventas por mes' : 'Envases por mes',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
            ),
            const Spacer(),
            // Toggle button
            GestureDetector(
              onTap: () => setState(() => _showSales = !_showSales),
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.darkCard,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.borderColor),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      _showSales
                          ? Icons.euro_outlined
                          : Icons.inventory_2_outlined,
                      size: 12,
                      color: AppTheme.neonBlue,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      _showSales ? 'Ventas \u20AC' : 'Envases',
                      style: const TextStyle(
                          color: AppTheme.neonBlue, fontSize: 11),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 8),
            _legendDot(AppTheme.neonBlue, currentYr),
            if (prevYr != null) ...[
              const SizedBox(width: 6),
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
                    final val = rod.toY;
                    final label = _showSales
                        ? '${val.toStringAsFixed(0)}\u20AC'
                        : '${val.toStringAsFixed(1)} env';
                    return BarTooltipItem(
                      '$month $yr\n$label',
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
                      return Text(
                        _monthShort[idx],
                        style: const TextStyle(
                            color: Colors.white38, fontSize: 8),
                      );
                    },
                  ),
                ),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 40,
                    getTitlesWidget: (value, meta) {
                      final label = value >= 1000
                          ? '${(value / 1000).toStringAsFixed(1)}k'
                          : value.toStringAsFixed(0);
                      return Text(
                        label,
                        style: const TextStyle(
                            color: Colors.white24, fontSize: 9),
                      );
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
                final curVal = _showSales
                    ? (currentData.months[mo]?.sales ?? 0)
                    : (currentData.months[mo]?.envases ?? 0);
                final prevVal = prevData != null
                    ? (_showSales
                        ? (prevData.months[mo]?.sales ?? 0)
                        : (prevData.months[mo]?.envases ?? 0))
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

  // ── Trend line: year-over-year comparison ──
  Widget _buildTrendLine() {
    final sortedYears = _years.keys.toList()..sort();
    if (sortedYears.length < 2) return const SizedBox.shrink();

    final colors = [Colors.white30, AppTheme.neonPurple, AppTheme.neonBlue];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text(
              'Tendencia interanual',
              style: TextStyle(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
            ),
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
                        '$yr: ${spot.y.toStringAsFixed(0)}\u20AC',
                        TextStyle(
                          color:
                              colors[spot.barIndex % colors.length],
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
                      return Text(
                        _monthShort[idx],
                        style: const TextStyle(
                            color: Colors.white38, fontSize: 9),
                      );
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
                      return Text(
                        label,
                        style: const TextStyle(
                            color: Colors.white24, fontSize: 9),
                      );
                    },
                  ),
                ),
                topTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(
                    sideTitles: SideTitles(showTitles: false)),
              ),
              borderData: FlBorderData(show: false),
              lineBarsData:
                  sortedYears.asMap().entries.map((entry) {
                final yr = entry.value;
                final color = colors[entry.key % colors.length];
                final yearData = _years[yr]!;
                final spots = <FlSpot>[];
                for (int m = 1; m <= 12; m++) {
                  final val = yearData.months['$m']?.sales ?? 0;
                  if (val > 0 ||
                      m <= DateTime.now().month ||
                      yr != sortedYears.last) {
                    spots.add(FlSpot(m.toDouble() - 1, val));
                  }
                }
                final isLatest =
                    entry.key == sortedYears.length - 1;
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

  // ── Monthly data table (only months with data) ──
  Widget _buildMonthlyTable() {
    if (_selectedYear == null || !_years.containsKey(_selectedYear)) {
      return const SizedBox.shrink();
    }

    final yearData = _years[_selectedYear!]!;

    // Collect months that have data, sorted
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
          child: Text(
            'Sin datos para este ejercicio',
            style: TextStyle(color: Colors.white38, fontSize: 13),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Detalle mensual $_selectedYear',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 13,
            fontWeight: FontWeight.bold,
          ),
        ),
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
              columnSpacing: 14,
              horizontalMargin: 12,
              headingTextStyle: const TextStyle(
                color: AppTheme.neonBlue,
                fontSize: 11,
                fontWeight: FontWeight.bold,
              ),
              dataTextStyle:
                  const TextStyle(color: Colors.white70, fontSize: 11),
              columns: const [
                DataColumn(label: Text('Mes')),
                DataColumn(label: Text('Envases'), numeric: true),
                DataColumn(label: Text('Uds'), numeric: true),
                DataColumn(label: Text('Ventas'), numeric: true),
                DataColumn(label: Text('Precio'), numeric: true),
                DataColumn(label: Text('Dto %'), numeric: true),
              ],
              rows: [
                // Data rows — only months with activity
                ...activeMonths.map((m) {
                  final d = yearData.months['$m']!;
                  return DataRow(cells: [
                    DataCell(Text(
                      _monthNames[m - 1],
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w500,
                        fontSize: 11,
                      ),
                    )),
                    DataCell(Text(_fmtNum(d.envases))),
                    DataCell(Text(_fmtNum(d.units))),
                    DataCell(Text(
                      _fmtEur(d.sales),
                      style: const TextStyle(
                          color: AppTheme.neonGreen, fontSize: 11),
                    )),
                    DataCell(Text(
                      d.avgPrice > 0
                          ? _fmtEur(d.avgPrice, decimals: 3)
                          : '-',
                    )),
                    DataCell(Text(
                      d.avgDiscount != null
                          ? '${d.avgDiscount!.toStringAsFixed(1)}%'
                          : '-',
                    )),
                  ]);
                }),
                // Totals row
                DataRow(
                  cells: [
                    const DataCell(Text(
                      'TOTAL',
                      style: TextStyle(
                        color: AppTheme.neonGreen,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                    )),
                    DataCell(Text(
                      _fmtNum(yearData.totals.envases),
                      style: const TextStyle(
                        color: AppTheme.neonGreen,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                    )),
                    DataCell(Text(
                      _fmtNum(yearData.totals.units),
                      style: const TextStyle(
                        color: AppTheme.neonGreen,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                    )),
                    DataCell(Text(
                      _fmtEur(yearData.totals.sales),
                      style: const TextStyle(
                        color: AppTheme.neonGreen,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                    )),
                    DataCell(Text(
                      yearData.totals.avgPrice > 0
                          ? _fmtEur(yearData.totals.avgPrice,
                              decimals: 3)
                          : '-',
                      style: const TextStyle(
                        color: AppTheme.neonGreen,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                    )),
                    const DataCell(Text(
                      '-',
                      style: TextStyle(
                          color: AppTheme.neonGreen, fontSize: 11),
                    )),
                  ],
                ),
              ],
            ),
          ),
        ),
        // Grand total summary below table
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
                    color: Colors.white54,
                    fontSize: 11,
                  ),
                ),
                Text(
                  _fmtEur(_grandTotal.sales),
                  style: const TextStyle(
                    color: AppTheme.neonGreen,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
                const Text(
                  ' ventas  |  ',
                  style: TextStyle(color: Colors.white38, fontSize: 11),
                ),
                Text(
                  _fmtNum(_grandTotal.envases),
                  style: const TextStyle(
                    color: AppTheme.neonBlue,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
                const Text(
                  ' envases',
                  style: TextStyle(color: Colors.white38, fontSize: 11),
                ),
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
          width: 8,
          height: 8,
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
