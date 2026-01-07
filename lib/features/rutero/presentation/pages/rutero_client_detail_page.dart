import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:intl/intl.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../../core/utils/currency_formatter.dart';

/// Comprehensive Client Detail Page for Rutero
/// Shows exhaustive breakdown with charts, statistics, purchase history
/// NO objectives data - purely sales/purchases analysis
class RuteroClientDetailPage extends StatefulWidget {
  final String clientCode;
  final String clientName;

  const RuteroClientDetailPage({
    super.key,
    required this.clientCode,
    required this.clientName,
  });

  @override
  State<RuteroClientDetailPage> createState() => _RuteroClientDetailPageState();
}

class _RuteroClientDetailPageState extends State<RuteroClientDetailPage>
    with SingleTickerProviderStateMixin {
  // Data state
  Map<String, dynamic> _clientData = {};
  bool _isLoading = true;
  String? _error;

  // Filters
  int _selectedYear = DateTime.now().year;
  int? _selectedMonth; // null = all months

  late TabController _tabController;

  // final _currencyFormat =
  //    NumberFormat.currency(symbol: '€', decimalDigits: 0, locale: 'es_ES');

  static const List<String> _monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final queryParams = {
        'year': _selectedYear.toString(),
      };
      if (_selectedMonth != null) {
        queryParams['filterMonth'] = _selectedMonth.toString();
      }

      final response = await ApiClient.get(
        '${ApiConfig.ruteroClientDetail}/${widget.clientCode}/detail',
        queryParameters: queryParams,
      );

      setState(() {
        _clientData = response;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: AppTheme.surfaceColor,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _clientData['client']?['razonSocial'] ?? widget.clientName,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              'Código: ${widget.clientCode}',
              style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
            ),
          ],
        ),
        actions: [
          // Year selector
          PopupMenuButton<int>(
            icon: const Icon(Icons.calendar_today),
            tooltip: 'Seleccionar año',
            onSelected: (year) {
              setState(() => _selectedYear = year);
              _loadData();
            },
            itemBuilder: (context) => ApiConfig.availableYears
                .map((y) => PopupMenuItem(
                      value: y,
                      child: Text(y.toString(),
                          style: TextStyle(
                              fontWeight: y == _selectedYear
                                  ? FontWeight.bold
                                  : FontWeight.normal)),
                    ))
                .toList(),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildErrorView()
              : Column(
                  children: [
                    // Tab bar
                    Container(
                      color: AppTheme.surfaceColor,
                      child: TabBar(
                        controller: _tabController,
                        indicatorColor: AppTheme.neonPurple,
                        labelColor: AppTheme.neonPurple,
                        unselectedLabelColor: AppTheme.textSecondary,
                        labelStyle: const TextStyle(fontSize: 12),
                        tabs: const [
                          Tab(text: 'Resumen', icon: Icon(Icons.dashboard, size: 16)),
                          Tab(text: 'Compras', icon: Icon(Icons.shopping_cart, size: 16)),
                          Tab(text: 'Productos', icon: Icon(Icons.inventory, size: 16)),
                        ],
                      ),
                    ),
                    // Content
                    Expanded(
                      child: TabBarView(
                        controller: _tabController,
                        children: [
                          _buildSummaryTab(),
                          _buildPurchasesTab(),
                          _buildProductsTab(),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }

  Widget _buildErrorView() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.error_outline, size: 64, color: AppTheme.error),
          const SizedBox(height: 16),
          Text('Error: $_error', textAlign: TextAlign.center),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _loadData,
            child: const Text('Reintentar'),
          ),
        ],
      ),
    );
  }

  // ==================== SUMMARY TAB ====================
  Widget _buildSummaryTab() {
    final totals = _clientData['totals'] as Map<String, dynamic>? ?? {};
    final monthlyData =
        List<Map<String, dynamic>>.from(_clientData['monthlyData'] ?? []);
    final yearlyTotals =
        List<Map<String, dynamic>>.from(_clientData['yearlyTotals'] ?? []);
    final freq = _clientData['purchaseFrequency'] as Map<String, dynamic>? ?? {};

    return RefreshIndicator(
      onRefresh: _loadData,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Year Total Card
            _buildYearTotalCard(totals),

            const SizedBox(height: 20),

            // Monthly Sales Chart with Y-axis in €
            Text(
              'Evolución Mensual $_selectedYear',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 12),
            _buildMonthlySalesChart(monthlyData),

            const SizedBox(height: 24),

            // Monthly Comparison
            Text(
              'Comparativa Mes a Mes',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 12),
            _buildMonthlyComparisonList(monthlyData),

            const SizedBox(height: 24),

            // Yearly History
            Text(
              'Histórico Anual',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 12),
            _buildYearlyHistoryCard(yearlyTotals),

            const SizedBox(height: 24),

            // Purchase Frequency
            _buildPurchaseFrequencyCard(freq),
          ],
        ),
      ),
    );
  }

  Widget _buildYearTotalCard(Map<String, dynamic> totals) {
    final isPositive = totals['isPositive'] == true;
    final variation = (totals['variation'] as num?)?.toDouble() ?? 0;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isPositive
              ? [AppTheme.success.withOpacity(0.2), AppTheme.success.withOpacity(0.1)]
              : [AppTheme.error.withOpacity(0.2), AppTheme.error.withOpacity(0.1)],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Icon(
                isPositive ? Icons.trending_up : Icons.trending_down,
                size: 40,
                color: isPositive ? AppTheme.success : AppTheme.error,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Total $_selectedYear',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text(
                      totals['currentYearFormatted'] ?? '0 €',
                      style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: isPositive ? AppTheme.success : AppTheme.error,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '${variation >= 0 ? '+' : ''}${variation.toStringAsFixed(1)}%',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildStatColumn('Año Anterior', totals['lastYearFormatted'] ?? '0 €'),
              _buildStatColumn(
                  'Promedio Mensual', totals['monthlyAverageFormatted'] ?? '0 €'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatColumn(String label, String value) {
    return Column(
      children: [
        Text(label, style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _buildMonthlySalesChart(List<Map<String, dynamic>> monthlyData) {
    if (monthlyData.isEmpty) {
      return const SizedBox(height: 200, child: Center(child: Text('Sin datos')));
    }

    final maxY = (_clientData['chartAxisMax'] as num?)?.toDouble() ?? 10000;

    return Container(
      height: 250,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
      ),
      child: BarChart(
        BarChartData(
          alignment: BarChartAlignment.spaceAround,
          maxY: maxY,
          barTouchData: BarTouchData(
            touchTooltipData: BarTouchTooltipData(
              getTooltipItem: (group, groupIndex, rod, rodIndex) {
                final month = monthlyData[groupIndex];
                final value = rodIndex == 0
                    ? month['currentYear']
                    : month['lastYear'];
                return BarTooltipItem(
                  '${rodIndex == 0 ? _selectedYear : _selectedYear - 1}\n${CurrencyFormatter.formatWhole(value)}',
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
                getTitlesWidget: (value, meta) {
                  if (value.toInt() >= 0 && value.toInt() < monthlyData.length) {
                    return Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        monthlyData[value.toInt()]['monthName'] ?? '',
                        style: const TextStyle(fontSize: 9),
                      ),
                    );
                  }
                  return const Text('');
                },
              ),
            ),
            // Y-AXIS WITH EXPLICIT € FORMATTING
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 50,
                getTitlesWidget: (value, meta) {
                  if (value == 0) return const Text('0 €', style: TextStyle(fontSize: 9));
                  final formatted = value >= 1000
                      ? '${(value / 1000).toStringAsFixed(0)}K €'
                      : '${value.toInt()} €';
                  return Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: Text(formatted, style: const TextStyle(fontSize: 9)),
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
            horizontalInterval: maxY / 4,
            getDrawingHorizontalLine: (value) => FlLine(
              color: Colors.grey.withOpacity(0.2),
              strokeWidth: 1,
            ),
          ),
          borderData: FlBorderData(show: false),
          barGroups: monthlyData.asMap().entries.map((entry) {
            final index = entry.key;
            final data = entry.value;
            final current = (data['currentYear'] as num?)?.toDouble() ?? 0;
            final last = (data['lastYear'] as num?)?.toDouble() ?? 0;

            return BarChartGroupData(
              x: index,
              barRods: [
                BarChartRodData(
                  toY: current,
                  color: AppTheme.neonBlue,
                  width: 6,
                  borderRadius: BorderRadius.circular(2),
                ),
                BarChartRodData(
                  toY: last,
                  color: AppTheme.textSecondary.withOpacity(0.4),
                  width: 6,
                  borderRadius: BorderRadius.circular(2),
                ),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildMonthlyComparisonList(List<Map<String, dynamic>> monthlyData) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: monthlyData.map((month) {
          final isPositive = month['isPositive'] == true;
          final variation = (month['variation'] as num?)?.toDouble() ?? 0;
          final current = (month['currentYear'] as num?)?.toDouble() ?? 0;

          if (current == 0) return const SizedBox.shrink();

          return ListTile(
            dense: true,
            leading: CircleAvatar(
              radius: 16,
              backgroundColor:
                  isPositive ? AppTheme.success.withOpacity(0.2) : AppTheme.error.withOpacity(0.2),
              child: Icon(
                isPositive ? Icons.arrow_upward : Icons.arrow_downward,
                size: 16,
                color: isPositive ? AppTheme.success : AppTheme.error,
              ),
            ),
            title: Text(
              _monthNames[(month['month'] as int) - 1],
              style: const TextStyle(fontWeight: FontWeight.w500),
            ),
            subtitle: Text(
              'Anterior: ${month['lastYearFormatted']}',
              style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
            ),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  month['currentYearFormatted'] ?? '0 €',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                Text(
                  '${variation >= 0 ? '+' : ''}${variation.toStringAsFixed(1)}%',
                  style: TextStyle(
                    fontSize: 11,
                    color: isPositive ? AppTheme.success : AppTheme.error,
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildYearlyHistoryCard(List<Map<String, dynamic>> yearlyTotals) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: yearlyTotals.map((y) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Text(
                  '${y['year']}',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        y['totalSalesFormatted'] ?? '0 €',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                      Text(
                        'Prom. mensual: ${y['monthlyAverageFormatted']}',
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
                Text(
                  '${y['activeMonths']} meses activos',
                  style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildPurchaseFrequencyCard(Map<String, dynamic> freq) {
    final isFrequent = freq['isFrequentBuyer'] == true;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isFrequent ? AppTheme.success.withOpacity(0.3) : Colors.transparent,
        ),
      ),
      child: Row(
        children: [
          Icon(
            isFrequent ? Icons.star : Icons.schedule,
            color: isFrequent ? AppTheme.success : AppTheme.textSecondary,
            size: 32,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isFrequent ? 'Cliente Frecuente' : 'Frecuencia de Compra',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                Text(
                  '${freq['avgPurchasesPerMonth'] ?? 0} compras/mes promedio',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          Text(
            '${freq['totalPurchaseDays'] ?? 0}',
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
          ),
          const SizedBox(width: 4),
          Text('días', style: TextStyle(color: AppTheme.textSecondary)),
        ],
      ),
    );
  }

  // ==================== PURCHASES TAB ====================
  Widget _buildPurchasesTab() {
    final purchases =
        List<Map<String, dynamic>>.from(_clientData['productPurchases'] ?? []);

    return Column(
      children: [
        // Month filter
        Container(
          padding: const EdgeInsets.all(8),
          color: AppTheme.surfaceColor,
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildMonthChip(null, 'Todos'),
                ...List.generate(12, (i) => _buildMonthChip(i + 1, _monthNames[i].substring(0, 3))),
              ],
            ),
          ),
        ),
        // List
        Expanded(
          child: purchases.isEmpty
              ? const Center(child: Text('No hay compras en este período'))
              : ListView.builder(
                  padding: const EdgeInsets.all(8),
                  itemCount: purchases.length,
                  itemBuilder: (context, index) {
                    final p = purchases[index];
                    return Card(
                      color: AppTheme.surfaceColor,
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        dense: true,
                        title: Text(
                          p['productName'] ?? 'Sin nombre',
                          style: const TextStyle(fontWeight: FontWeight.w500),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Código: ${p['productCode']} | Lote: ${p['lote'] ?? '-'}',
                              style: TextStyle(fontSize: 10, color: AppTheme.textSecondary),
                            ),
                            Text(
                              'Fecha: ${p['date']} | Factura: ${p['invoice'] ?? '-'}',
                              style: TextStyle(fontSize: 10, color: AppTheme.textSecondary),
                            ),
                          ],
                        ),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              p['totalFormatted'] ?? '0 €',
                              style: const TextStyle(fontWeight: FontWeight.bold),
                            ),
                            Text(
                              '${p['quantity']} uds',
                              style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                            ),
                          ],
                        ),
                        isThreeLine: true,
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildMonthChip(int? month, String label) {
    final isSelected = _selectedMonth == month;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: ChoiceChip(
        label: Text(label, style: TextStyle(fontSize: 11)),
        selected: isSelected,
        selectedColor: AppTheme.neonPurple,
        onSelected: (selected) {
          setState(() => _selectedMonth = selected ? month : null);
          _loadData();
        },
      ),
    );
  }

  // ==================== PRODUCTS TAB ====================
  Widget _buildProductsTab() {
    final topProducts =
        List<Map<String, dynamic>>.from(_clientData['topProducts'] ?? []);

    if (topProducts.isEmpty) {
      return const Center(child: Text('No hay productos'));
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: topProducts.length,
      itemBuilder: (context, index) {
        final p = topProducts[index];
        return Card(
          color: AppTheme.surfaceColor,
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: AppTheme.neonPurple.withOpacity(0.2),
                  child: Text(
                    '${index + 1}',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, color: AppTheme.neonPurple),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        p['name'] ?? 'Sin nombre',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        'Código: ${p['code']}',
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                      ),
                      Text(
                        '${p['purchases']} compras | ${p['totalUnits']} unidades',
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      p['totalSalesFormatted'] ?? '0 €',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                        color: AppTheme.neonBlue,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
