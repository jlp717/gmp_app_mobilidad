import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/modern_loading.dart';
import '../../../../core/providers/dashboard_provider.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';

/// Professional Advanced Analytics Page
/// Features: Multi-year comparison, Spanish formatting, Advanced filters
class AnalyticsPage extends StatefulWidget {
  const AnalyticsPage({super.key});

  @override
  State<AnalyticsPage> createState() => _AnalyticsPageState();
}

class _AnalyticsPageState extends State<AnalyticsPage> {
  // Filter state
  Set<int> _selectedYears = {DateTime.now().year}; // Multi-select years
  int? _selectedMonth; // null = "Todo"
 String _granularity = 'month'; // 'month' or 'week'
  bool _upToToday = false; // YTD toggle

  // Data state
  List<Map<String, dynamic>> _evolutionData = [];
  Map<String, dynamic>? _yoyData;
  List<Map<String, dynamic>> _topClients = [];
  List<Map<String, dynamic>> _topProducts = [];
  Map<String, dynamic>? _trendsData;
  List<Map<String, dynamic>> _marginsData = [];
  Map<String, dynamic>? _kpiData;
  
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _fetchAllData();
  }

  Future<void> _fetchAllData() async {
    setState(() => _isLoading = true);
    
    try {
      // Build filter params
      final yearsParam = _selectedYears.join(',');
      final monthParam = _selectedMonth?.toString() ?? '';
      final upToTodayParam = _upToToday.toString();
      
      // Fetch all data in parallel
      final results = await Future.wait([
        ApiClient.get('/dashboard/sales-evolution', queryParameters: {
          'years': yearsParam,
          'granularity': _granularity,
          'upToToday': upToTodayParam,
          'months': '36',
        }),
        ApiClient.get('/dashboard/yoy-comparison', queryParameters: {
          'year': _selectedYears.first.toString(),
        }),
        ApiClient.get('/analytics/top-clients', queryParameters: {
          'year': _selectedYears.first.toString(),
          if (monthParam.isNotEmpty) 'month': monthParam,
          'limit': '10',
        }),
        ApiClient.get('/analytics/top-products', queryParameters: {
          'year': _selectedYears.first.toString(),
          if (monthParam.isNotEmpty) 'month': monthParam,
          'limit': '10',
        }),
        ApiClient.get('/analytics/trends'),
        ApiClient.get('/analytics/margins', queryParameters: {
          'year': _selectedYears.first.toString(),
        }),
        ApiClient.get('/dashboard/metrics'),
      ]);

      setState(() {
        final rawEvolution = results[0]['evolution'] ?? [];
        _evolutionData = (rawEvolution as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        _yoyData = results[1];
        final rawClients = results[2]['clients'] ?? [];
        _topClients = (rawClients as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        final rawProducts = results[3]['products'] ?? [];
        _topProducts = (rawProducts as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        _trendsData = results[4];
        final rawMargins = results[5]['margins'] ?? [];
        _marginsData = (rawMargins as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        _kpiData = results[6];
        _isLoading = false;
      });
    } catch (e) {
      print('Error fetching analytics: $e');
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: _isLoading
          ? const Center(child: ModernLoading(message: 'Analizando datos...'))
          : RefreshIndicator(
              onRefresh: _fetchAllData,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildHeader(),
                    const SizedBox(height: 16),
                    _buildFilterPanel(),
                    const SizedBox(height: 24),
                    _buildKPISection(),
                    const SizedBox(height: 24),
                    _buildEvolutionChart(),
                    const SizedBox(height: 24),
                    _buildYoYComparison(),
                    const SizedBox(height: 24),
                    _buildMarginsChart(),
                    const SizedBox(height: 24),
                    _buildTrendsSection(),
                    const SizedBox(height: 24),
                    _buildTopListsSection(),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        const Icon(Icons.analytics, color: AppTheme.neonBlue, size: 32),
        const SizedBox(width: 12),
        const Text(
          'Analíticas Avanzadas',
          style: TextStyle(
            color: Colors.white,
            fontSize: 24,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }

  Widget _buildFilterPanel() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Filtros',
            style: TextStyle(color: AppTheme.neonBlue, fontSize: 16, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          
          // Year multi-select chips
          const Text('Años:', style: TextStyle(color: Colors.white70, fontSize: 14)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: ApiConfig.availableYears.map((year) {
              final isSelected = _selectedYears.contains(year);
              return FilterChip(
                label: Text(year.toString()),
                selected: isSelected,
                onSelected: (selected) {
                  setState(() {
                    if (selected) {
                      _selectedYears.add(year);
                    } else {
                      if (_selectedYears.length > 1) {
                        _selectedYears.remove(year);
                      }
                    }
                  });
                  _fetchAllData();
                },
                backgroundColor: AppTheme.darkBase,
                selectedColor: AppTheme.neonBlue.withOpacity(0.3),
                labelStyle: TextStyle(
                  color: isSelected ? AppTheme.neonBlue : Colors.white70,
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                ),
                checkmarkColor: AppTheme.neonBlue,
              );
            }).toList(),
          ),
          
          const SizedBox(height: 16),
          
          // Month dropdown
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Mes:', style: TextStyle(color: Colors.white70, fontSize: 14)),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<int?>(
                      value: _selectedMonth,
                      decoration: InputDecoration(
                        filled: true,
                        fillColor: AppTheme.darkBase,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      ),
                      dropdownColor: AppTheme.darkBase,
                      style: const TextStyle(color: Colors.white),
                      items: [
                        const DropdownMenuItem(value: null, child: Text('Todo el año')),
                        ...List.generate(12, (i) => i + 1).map((month) => DropdownMenuItem(
                          value: month,
                          child: Text(DateFormatter.getMonthName(month)),
                        )),
                      ],
                      onChanged: (value) {
                        setState(() => _selectedMonth = value);
                        _fetchAllData();
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              
              // Granularity toggle
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Vista:', style: TextStyle(color: Colors.white70, fontSize: 14)),
                    const SizedBox(height: 8),
                    SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(value: 'month', label: Text('Mensual'), icon: Icon(Icons.calendar_month, size: 16)),
                        ButtonSegment(value: 'week', label: Text('Semanal'), icon: Icon(Icons.calendar_view_week, size: 16)),
                      ],
                      selected: {_granularity},
                      onSelectionChanged: (Set<String> selection) {
                        setState(() => _granularity = selection.first);
                        _fetchAllData();
                      },
                      style: ButtonStyle(
                        backgroundColor: MaterialStateProperty.resolveWith((states) {
                          if (states.contains(MaterialState.selected)) {
                            return AppTheme.neonBlue.withOpacity(0.3);
                          }
                          return AppTheme.darkBase;
                        }),
                        foregroundColor: MaterialStateProperty.resolveWith((states) {
                          if (states.contains(MaterialState.selected)) {
                            return AppTheme.neonBlue;
                          }
                          return Colors.white70;
                        }),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          
          const SizedBox(height: 16),
          
          // YTD Toggle
          SwitchListTile(
            title: const Text('Hasta hoy (YTD)', style: TextStyle(color: Colors.white, fontSize: 14)),
            subtitle: Text(
              _upToToday ? 'Comparando solo hasta la fecha actual' : 'Comparando períodos completos',
              style: const TextStyle(color: Colors.white54, fontSize: 12),
            ),
            value: _upToToday,
            onChanged: (value) {
              setState(() => _upToToday = value);
              _fetchAllData();
            },
            activeColor: AppTheme.neonGreen,
            contentPadding: EdgeInsets.zero,
          ),
          
          // Filter summary
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppTheme.darkBase,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                const Icon(Icons.filter_list, color: AppTheme.neonBlue, size: 16),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _buildFilterSummary(),
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _buildFilterSummary() {
    final years = _selectedYears.toList()..sort();
    final yearStr = years.length == 1 ? years.first.toString() : '${years.first}-${years.last}';
    final monthStr = _selectedMonth != null ? DateFormatter.getMonthName(_selectedMonth!) : 'Todo el año';
    final viewStr = _granularity == 'week' ? 'Semanal' : 'Mensual';
    final ytdStr = _upToToday ? ' (Hasta hoy)' : '';
    return '$yearStr • $monthStr • $viewStr$ytdStr';
  }

  Widget _buildKPISection() {
    if (_kpiData == null) return const SizedBox();
    
    // Calculate totals from evolution data - group by year+month to avoid duplicates
    final monthlyData = <String, Map<String, dynamic>>{};
    
    for (final item in _evolutionData) {
      final year = item['year'] as int;
      if (_selectedYears.contains(year)) {
        final month = item['month'] as int;
        final key = '$year-$month';
        
        // Only count each year-month combination once
        if (!monthlyData.containsKey(key)) {
          monthlyData[key] = item;
        }
      }
    }
    
    double totalSales = 0.0;
    int totalClients = 0;
    
    for (final item in monthlyData.values) {
      totalSales += (item['totalSales'] as num?)?.toDouble() ?? 0.0;
      totalClients += (item['uniqueClients'] as num?)?.toInt() ?? 0;
    }
    
    final totalMargin = 0.0; // Not available in CVC

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Indicadores Clave',
          style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _buildKPICard('Ventas Totales', CurrencyFormatter.formatWhole(totalSales), Icons.attach_money, AppTheme.neonBlue)),
            const SizedBox(width: 12),
            // Only show margin if > 0
            if (totalMargin > 0) ...[  
              Expanded(child: _buildKPICard('Margen Total', CurrencyFormatter.formatWhole(totalMargin), Icons.trending_up, AppTheme.neonGreen)),
              const SizedBox(width: 12),
            ],
            Expanded(child: _buildKPICard('Clientes Únicos', totalClients.toString(), Icons.people, AppTheme.neonPurple)),
          ],
        ),
      ],
    );
  }

  Widget _buildKPICard(String title, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [color.withOpacity(0.1), color.withOpacity(0.05)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 32),
          const SizedBox(height: 12),
          Text(title, style: const TextStyle(color: Colors.white70, fontSize: 12)),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(color: color, fontSize: 20, fontWeight: FontWeight.bold),
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _buildEvolutionChart() {
    if (_evolutionData.isEmpty) {
      return const Card(child: Padding(padding: EdgeInsets.all(32), child: Center(child: Text('No hay datos de evolución'))));
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                'Evolución de Ventas',
                style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const Spacer(),
              if (_selectedYears.length > 1) _buildChartLegend(),
            ],
          ),
          const SizedBox(height: 24),
          SizedBox(
            height: 300,
            child: LineChart(_buildEvolutionLineChartData()),
          ),
        ],
      ),
    );
  }

  Widget _buildChartLegend() {
    final yearColors = {
      2023: Colors.grey,
      2024: AppTheme.neonBlue,
      2025: AppTheme.neonGreen,
    };
    
    return Wrap(
      spacing: 16,
      children: _selectedYears.map((year) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 16,
              height: 3,
              color: yearColors[year] ?? Colors.white,
            ),
            const SizedBox(width: 4),
            Text(
              year.toString(),
              style: TextStyle(color: yearColors[year] ?? Colors.white, fontSize: 12),
            ),
          ],
        );
      }).toList(),
    );
  }

  LineChartData _buildEvolutionLineChartData() {
    // Group data by year - ONLY for selected years
    final dataByYear = <int, List<FlSpot>>{};
    final allMonths = <int>{};
    
    for (final item in _evolutionData) {
      final year = item['year'] as int;
      
      // FILTER: Only include data for selected years
      if (!_selectedYears.contains(year)) continue;
      
      final month = item['month'] as int;
      final sales = (item['totalSales'] as num?)?.toDouble() ?? 0.0;
      
      dataByYear.putIfAbsent(year, () => []);
      dataByYear[year]!.add(FlSpot(month.toDouble(), sales));
      allMonths.add(month);
    }

    // Create line bar data for each year
    final yearColors = {
      2023: Colors.grey,
      2024: AppTheme.neonBlue,
      2025: AppTheme.neonGreen,
    };
    
    final lineBarsData = dataByYear.entries.map((entry) {
      return LineChartBarData(
        spots: entry.value..sort((a, b) => a.x.compareTo(b.x)),
        isCurved: true,
        color: yearColors[entry.key] ?? Colors.white,
        barWidth: 3,
        isStrokeCapRound: true,
        dotData: FlDotData(
          show: true,
          getDotPainter: (spot, percent, barData, index) => FlDotCirclePainter(
            radius: 4,
            color: yearColors[entry.key] ?? Colors.white,
            strokeWidth: 2,
            strokeColor: AppTheme.darkBase,
          ),
        ),
        belowBarData: BarAreaData(
          show: true,
          gradient: LinearGradient(
            colors: [
              (yearColors[entry.key] ?? Colors.white).withOpacity(0.1),
              (yearColors[entry.key] ?? Colors.white).withOpacity(0.0),
            ],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
      );
    }).toList();

    // Find max value for Y axis
    double maxY = 0;
    for (final line in dataByYear.values) {
      for (final spot in line) {
        if (spot.y > maxY) maxY = spot.y;
      }
    }

    return LineChartData(
      lineBarsData: lineBarsData,
      titlesData: FlTitlesData(
        leftTitles: AxisTitles(
          sideTitles: SideTitles(
            showTitles: true,
            reservedSize: 60,
            getTitlesWidget: (value, meta) {
              return Text(
                CurrencyFormatter.formatAxis(value),
                style: const TextStyle(color: Colors.white54, fontSize: 10),
              );
            },
          ),
        ),
        bottomTitles: AxisTitles(
          sideTitles: SideTitles(
            showTitles: true,
            reservedSize: 32,
            getTitlesWidget: (value, meta) {
              if (_granularity == 'week') {
                // For weekly view, show week numbers
                final week = value.toInt();
                if (week < 1 || week > 53) return const SizedBox();
                return Text(
                  'S$week',
                  style: const TextStyle(color: Colors.white54, fontSize: 10),
                );
              } else {
                // For monthly view, show month names
                final month = value.toInt();
                if (month < 1 || month > 12) return const SizedBox();
                return Text(
                  DateFormatter.getMonthName(month, short: true),
                  style: const TextStyle(color: Colors.white54, fontSize: 10),
                );
              }
            },
          ),
        ),
        rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
      ),
      gridData: FlGridData(
        show: true,
        drawVerticalLine: false,
        getDrawingHorizontalLine: (value) => FlLine(
          color: Colors.white10,
          strokeWidth: 1,
        ),
      ),
      borderData: FlBorderData(show: false),
      minX: 1,
      maxX: 12,
      minY: 0,
      maxY: maxY * 1.1,
      lineTouchData: LineTouchData(
        touchTooltipData: LineTouchTooltipData(
          tooltipBgColor: AppTheme.darkBase,
          getTooltipItems: (touchedSpots) {
            return touchedSpots.map((spot) {
              final month = spot.x.toInt();
              // Find which year this spot belongs to by checking bar index
              final barIndex = touchedSpots.indexOf(spot);
              final year = dataByYear.keys.toList()[barIndex % dataByYear.length];
              
              return LineTooltipItem(
                '${DateFormatter.getMonthName(month, short: true)} $year\n${CurrencyFormatter.format(spot.y)}',
                TextStyle(color: spot.bar.gradient?.colors.first ?? spot.bar.color),
              );
            }).toList();
          },
        ),
      ),
    );
  }

  Widget _buildYoYComparison() {
    if (_yoyData == null) return const SizedBox();
    
    final currentYear = _yoyData!['currentYear'] ?? {};
    final lastYear = _yoyData!['lastYear'] ?? {};
    final growth = _yoyData!['growth'] ?? {};
    
    final currentSales = (currentYear['sales'] as num?)?.toDouble() ?? 0.0;
    final lastSales = (lastYear['sales'] as num?)?.toDouble() ?? 0.0;
    final growthPercent = (growth['salesPercent'] as num?)?.toDouble() ?? 0.0;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Comparativa Interanual',
            style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _buildYoYCard(
                  currentYear['year'].toString(),
                  CurrencyFormatter.formatWhole(currentSales),
                  AppTheme.neonBlue,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildYoYCard(
                  lastYear['year'].toString(),
                  CurrencyFormatter.formatWhole(lastSales),
                  Colors.white54,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildGrowthCard(growthPercent),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildYoYCard(String year, String value, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkBase,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          Text(year, style: TextStyle(color: color, fontSize: 14)),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(color: color, fontSize: 16, fontWeight: FontWeight.bold),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildGrowthCard(double percent) {
    final isPositive = percent >= 0;
    final color = isPositive ? AppTheme.neonGreen : Colors.redAccent;
    
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          Icon(
            isPositive ? Icons.trending_up : Icons.trending_down,
            color: color,
            size: 24,
          ),
          const SizedBox(height: 4),
          Text(
            '${isPositive ? '+' : ''}${percent.toStringAsFixed(1)}%',
            style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }

  Widget _buildMarginsChart() {
    if (_marginsData.isEmpty) return const SizedBox();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonGreen.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Análisis de Márgenes',
            style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 24),
          SizedBox(
            height: 250,
            child: BarChart(_buildMarginsBarChartData()),
          ),
        ],
      ),
    );
  }

  BarChartData _buildMarginsBarChartData() {
    final barGroups = _marginsData.asMap().entries.map((entry) {
      final index = entry.key;
      final item = entry.value;
      final month = item['month'] as int;
      final marginPercent = ((item['marginPercent'] as num?)?.toDouble() ?? 0.0).abs();
      
      return BarChartGroupData(
        x: month,
        barRods: [
          BarChartRodData(
            toY: marginPercent,
            color: AppTheme.neonGreen,
            width: 16,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
            gradient: LinearGradient(
              colors: [AppTheme.neonGreen, AppTheme.neonGreen.withOpacity(0.5)],
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
            ),
          ),
        ],
      );
    }).toList();

    return BarChartData(
      barGroups: barGroups,
      titlesData: FlTitlesData(
        leftTitles: AxisTitles(
          sideTitles: SideTitles(
            showTitles: true,
            reservedSize: 40,
            getTitlesWidget: (value, meta) {
              return Text(
                '${value.toStringAsFixed(0)}%',
                style: const TextStyle(color: Colors.white54, fontSize: 10),
              );
            },
          ),
        ),
        bottomTitles: AxisTitles(
          sideTitles: SideTitles(
            showTitles: true,
            getTitlesWidget: (value, meta) {
              final month = value.toInt();
              if (month < 1 || month > 12) return const SizedBox();
              return Text(
                DateFormatter.getMonthName(month, short: true),
                style: const TextStyle(color: Colors.white54, fontSize: 10),
              );
            },
          ),
        ),
        rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
      ),
      gridData: FlGridData(
        show: true,
        drawVerticalLine: false,
        getDrawingHorizontalLine: (value) => FlLine(color: Colors.white10, strokeWidth: 1),
      ),
      borderData: FlBorderData(show: false),
      barTouchData: BarTouchData(
        touchTooltipData: BarTouchTooltipData(
          tooltipBgColor: AppTheme.darkBase,
          getTooltipItem: (group, groupIndex, rod, rodIndex) {
            return BarTooltipItem(
              '${DateFormatter.getMonthName(group.x)}\n${rod.toY.toStringAsFixed(1)}%',
              const TextStyle(color: AppTheme.neonGreen),
            );
          },
        ),
      ),
    );
  }

  Widget _buildTrendsSection() {
    if (_trendsData == null) return const SizedBox();
    
    final trend = _trendsData!['trend'] ?? 'stable';
    final predictions = _trendsData!['predictions'] as List? ?? [];
    
    // Get current month for next month prediction labels
    final now = DateTime.now();
    final nextMonths = List.generate(3, (i) {
      final futureMonth = DateTime(now.year, now.month + i + 1);
      return DateFormatter.getMonthName(futureMonth.month, short: true);
    });
    
    // Trend icon and color
    IconData trendIcon;
    Color trendColor;
    String trendText;
    
    if (trend == 'upward') {
      trendIcon = Icons.trending_up;
      trendColor = AppTheme.neonGreen;
      trendText = 'Tendencia Alcista';
    } else if (trend == 'downward') {
      trendIcon = Icons.trending_down;
      trendColor = Colors.redAccent;
      trendText = 'Tendencia Bajista';
    } else {
      trendIcon = Icons.trending_flat;
      trendColor = Colors.grey;
      trendText = 'Tendencia Estable';
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: trendColor.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(trendIcon, color: trendColor, size: 24),
              const SizedBox(width: 8),
              Text(
                trendText,
                style: TextStyle(color: trendColor, fontSize: 18, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Predicción basada en histórico de 6 meses',
            style: const TextStyle(color: Colors.white54, fontSize: 12),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppTheme.darkBase.withOpacity(0.3),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: Colors.white10),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline, size: 14, color: Colors.white54),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Usamos regresión lineal sobre tus ventas de los últimos 6 meses para estimar los próximos 3 meses.',
                    style: const TextStyle(color: Colors.white54, fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'Ventas Estimadas Próximos 3 Meses',
            style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          ...predictions.asMap().entries.map((entry) {
            final index = entry.key;
            final prediction = entry.value;
            final predictedSales = (prediction['predictedSales'] as num?)?.toDouble() ?? 0.0;
            final confidence = (prediction['confidence'] as num?)?.toDouble() ?? 0.0;
            final monthName = index < nextMonths.length ? nextMonths[index] : 'Mes ${index + 1}';
            
            return _buildPredictionItem(
              monthName,
              CurrencyFormatter.formatWhole(predictedSales),
              confidence,
              trendColor,
            );
          }),
        ],
      ),
    );
  }

  Widget _buildPredictionItem(String monthName, String salesValue, double confidence, Color trendColor) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                monthName,
                style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w500),
              ),
              Text(
                salesValue,
                style: TextStyle(color: trendColor, fontSize: 14, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: LinearProgressIndicator(
                  value: confidence,
                  backgroundColor: Colors.white10,
                  color: trendColor.withOpacity(0.7),
                  minHeight: 6,
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'Confianza: ${(confidence * 100).toStringAsFixed(0)}%',
                style: const TextStyle(color: Colors.white54, fontSize: 11),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTopListsSection() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: _buildTopClients()),
        const SizedBox(width: 16),
        Expanded(child: _buildTopProducts()),
      ],
    );
  }

  Widget _buildTopClients() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Top 10 Clientes',
            style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          ..._topClients.asMap().entries.map((entry) {
            final index = entry.key;
            final client = entry.value;
            final name = client['name'] ?? '';
            final sales = (client['totalSales'] as num?)?.toDouble() ?? 0.0;
            return _buildRankedListItem(index + 1, name, CurrencyFormatter.formatWhole(sales));
          }),
        ],
      ),
    );
  }

  Widget _buildTopProducts() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonGreen.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Top 10 Productos',
            style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          ..._topProducts.asMap().entries.map((entry) {
            final index = entry.key;
            final product = entry.value;
            final name = product['name'] ?? '';
            final sales = (product['totalSales'] as num?)?.toDouble() ?? 0.0;
            return _buildRankedListItem(index + 1, name, CurrencyFormatter.formatWhole(sales));
          }),
        ],
      ),
    );
  }

  Widget _buildRankedListItem(int rank, String name, String value) {
    Color rankColor = Colors.white54;
    if (rank == 1) rankColor = Colors.amber;
    if (rank == 2) rankColor = Colors.grey[400]!;
    if (rank == 3) rankColor = Colors.brown[300]!;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Container(
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              color: rankColor.withOpacity(0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Center(
              child: Text(
                rank.toString(),
                style: TextStyle(color: rankColor, fontSize: 11, fontWeight: FontWeight.bold),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              name.length > 25 ? '${name.substring(0, 25)}...' : name,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(
            value,
            style: const TextStyle(color: AppTheme.neonBlue, fontSize: 12, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}
