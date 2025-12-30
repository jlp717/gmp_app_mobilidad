import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/providers/dashboard_provider.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../widgets/matrix_data_table.dart';

/// Professional Dashboard - Power BI Style for Sales Manager
/// Multi-select filters: Years, Months, Vendors
class DashboardContent extends StatefulWidget {
  const DashboardContent({super.key});

  @override
  State<DashboardContent> createState() => _DashboardContentState();
}

class _DashboardContentState extends State<DashboardContent> {
  // Multi-select date filters
  Set<int> _selectedYears = {DateTime.now().year};
  Set<int> _selectedMonths = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
  
  // Vendor filter (single select for simplicity)
  String? _selectedVendedor;
  List<Map<String, dynamic>> _vendedoresDisponibles = [];
  
  String _groupBy = 'vendor';
  
  // Data state
  Map<String, dynamic>? _kpiData;
  List<Map<String, dynamic>> _matrixRows = [];
  List<String> _matrixPeriods = [];
  bool _isLoading = false;
  String? _error;

  static const List<String> _monthNamesShort = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  @override
  void initState() {
    super.initState();
    _loadVendedores();
    _fetchAllData();
  }

  /// Load available vendors for filter
  Future<void> _loadVendedores() async {
    try {
      final response = await ApiClient.get('/rutero/vendedores');
      if (mounted) {
        setState(() {
          _vendedoresDisponibles = List<Map<String, dynamic>>.from(response['vendedores'] ?? []);
        });
      }
    } catch (e) {
      debugPrint('Error loading vendedores: $e');
    }
  }

  Future<void> _fetchAllData() async {
    if (!mounted) return;
    setState(() { _isLoading = true; _error = null; });
    
    final provider = Provider.of<DashboardProvider>(context, listen: false);
    
    try {
      final params = <String, String>{};
      
      // Vendor codes
      if (_selectedVendedor != null && _selectedVendedor!.isNotEmpty) {
        params['vendedorCodes'] = _selectedVendedor!;
      } else if (provider.vendedorCodes.isNotEmpty) {
        params['vendedorCodes'] = provider.vendedorCodes.join(',');
      }
      
      params['groupBy'] = _groupBy;
      
      // Fetch data
      final results = await Future.wait([
        ApiClient.get('/dashboard/matrix-data', queryParameters: params),
        ApiClient.get('/dashboard/metrics', queryParameters: params),
      ]);
      
      if (!mounted) return;
      
      setState(() {
        final matrixData = results[0];
        _matrixRows = List<Map<String, dynamic>>.from(matrixData['rows'] ?? []);
        _matrixPeriods = List<String>.from(matrixData['periods'] ?? []);
        _kpiData = results[1];
        _isLoading = false;
      });
    } catch (e) {
      debugPrint('Error fetching dashboard: $e');
      if (mounted) {
        setState(() { _error = e.toString(); _isLoading = false; });
      }
    }
  }

  /// Safe value extraction
  double _safeDouble(dynamic value) {
    if (value == null) return 0.0;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    if (value is Map) {
      // Handle nested value structures like {value: 123.45}
      final v = value['value'];
      if (v != null) return _safeDouble(v);
    }
    return 0.0;
  }

  int _safeInt(dynamic value) {
    if (value == null) return 0;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? 0;
    if (value is Map) {
      final v = value['value'];
      if (v != null) return _safeInt(v);
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<DashboardProvider>(context);
    final isJefeVentas = provider.isJefeVentas;

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: RefreshIndicator(
        onRefresh: _fetchAllData,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildHeader(),
              const SizedBox(height: 16),
              if (isJefeVentas) ...[
                _buildVendedorSelector(),
                const SizedBox(height: 12),
              ],
              _buildDateFilters(),
              const SizedBox(height: 16),
              if (_isLoading)
                const Center(child: Padding(
                  padding: EdgeInsets.all(32),
                  child: CircularProgressIndicator(),
                ))
              else if (_error != null)
                _buildErrorWidget()
              else ...[
                _buildKPISection(),
                const SizedBox(height: 24),
                _buildGroupByToggle(),
                const SizedBox(height: 16),
                if (_matrixRows.isNotEmpty) _buildSalesChart(),
                const SizedBox(height: 16),
                MatrixDataTable(
                  rows: _matrixRows,
                  periods: _matrixPeriods,
                  groupBy: _groupBy,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        const Icon(Icons.dashboard, color: AppTheme.neonBlue, size: 28),
        const SizedBox(width: 12),
        const Text('Panel de Control', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
        const Spacer(),
        IconButton(
          icon: const Icon(Icons.refresh, color: Colors.white70),
          onPressed: _fetchAllData,
        ),
      ],
    );
  }

  Widget _buildErrorWidget() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.error.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
          const SizedBox(height: 12),
          Text('Error: $_error', style: const TextStyle(color: Colors.white70, fontSize: 12)),
          const SizedBox(height: 12),
          ElevatedButton(onPressed: _fetchAllData, child: const Text('Reintentar')),
        ],
      ),
    );
  }

  Widget _buildVendedorSelector() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.person_search, color: AppTheme.neonBlue, size: 20),
          const SizedBox(width: 8),
          const Text('Comercial:', style: TextStyle(fontSize: 12, color: Colors.white70)),
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(
                color: AppTheme.darkBase,
                borderRadius: BorderRadius.circular(8),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _selectedVendedor ?? '',
                  isExpanded: true,
                  isDense: true,
                  dropdownColor: AppTheme.darkCard,
                  icon: const Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue, size: 20),
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                  items: [
                    const DropdownMenuItem<String>(
                      value: '',
                      child: Text('Todos los comerciales', style: TextStyle(color: Colors.white)),
                    ),
                    ..._vendedoresDisponibles.map((v) {
                      final code = v['code']?.toString() ?? '';
                      final name = v['name']?.toString() ?? '';
                      final clients = (v['clients'] as num?)?.toInt() ?? 0;
                      final displayName = name.isNotEmpty ? name : 'Vendedor $code';
                      return DropdownMenuItem<String>(
                        value: code,
                        child: Text('$displayName ($clients)', style: const TextStyle(color: Colors.white)),
                      );
                    }),
                  ],
                  onChanged: (value) {
                    setState(() => _selectedVendedor = value?.isEmpty == true ? null : value);
                    _fetchAllData();
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDateFilters() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Years
          Row(
            children: [
              const Text('Años:', style: TextStyle(color: AppTheme.neonBlue, fontSize: 12, fontWeight: FontWeight.bold)),
              const Spacer(),
              TextButton(
                onPressed: () {
                  setState(() => _selectedYears = {2023, 2024, 2025});
                  _fetchAllData();
                },
                child: const Text('Todos', style: TextStyle(fontSize: 10)),
              ),
            ],
          ),
          Wrap(
            spacing: 8,
            children: [2023, 2024, 2025].map((year) => FilterChip(
              label: Text('$year', style: const TextStyle(fontSize: 11)),
              selected: _selectedYears.contains(year),
              onSelected: (selected) {
                setState(() {
                  if (selected) {
                    _selectedYears.add(year);
                  } else if (_selectedYears.length > 1) {
                    _selectedYears.remove(year);
                  }
                });
                _fetchAllData();
              },
              selectedColor: AppTheme.neonPurple.withOpacity(0.3),
              checkmarkColor: AppTheme.neonPurple,
              visualDensity: VisualDensity.compact,
            )).toList(),
          ),
          const SizedBox(height: 12),
          // Months
          Row(
            children: [
              const Text('Meses:', style: TextStyle(color: AppTheme.neonBlue, fontSize: 12, fontWeight: FontWeight.bold)),
              const Spacer(),
              TextButton(
                onPressed: () {
                  setState(() => _selectedMonths = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12});
                  _fetchAllData();
                },
                child: const Text('Todos', style: TextStyle(fontSize: 10)),
              ),
              TextButton(
                onPressed: () {
                  setState(() => _selectedMonths = {for (var i = 1; i <= DateTime.now().month; i++) i});
                  _fetchAllData();
                },
                child: const Text('YTD', style: TextStyle(fontSize: 10)),
              ),
              TextButton(
                onPressed: () {
                  setState(() => _selectedMonths.clear());
                  _fetchAllData();
                },
                child: const Text('Ninguno', style: TextStyle(fontSize: 10)),
              ),
            ],
          ),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: List.generate(12, (i) => FilterChip(
              label: Text(_monthNamesShort[i], style: const TextStyle(fontSize: 10)),
              selected: _selectedMonths.contains(i + 1),
              onSelected: (selected) {
                setState(() {
                  if (selected) {
                    _selectedMonths.add(i + 1);
                  } else {
                    _selectedMonths.remove(i + 1);
                  }
                });
                _fetchAllData();
              },
              selectedColor: AppTheme.neonBlue.withOpacity(0.3),
              checkmarkColor: AppTheme.neonBlue,
              visualDensity: VisualDensity.compact,
            )),
          ),
        ],
      ),
    );
  }

  Widget _buildKPISection() {
    if (_kpiData == null) return const SizedBox();
    
    final totalSales = _safeDouble(_kpiData!['totalSales']);
    final totalOrders = _safeInt(_kpiData!['totalOrders']);
    final uniqueClients = _safeInt(_kpiData!['uniqueClients']);
    final todaySales = _safeDouble(_kpiData!['todaySales']);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Indicadores', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _buildKPICard('Ventas Período', CurrencyFormatter.formatWhole(totalSales), Icons.euro, AppTheme.neonBlue)),
            const SizedBox(width: 12),
            Expanded(child: _buildKPICard('Clientes', uniqueClients.toString(), Icons.people, AppTheme.neonPurple)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _buildKPICard('Ventas Hoy', CurrencyFormatter.formatWhole(todaySales), Icons.today, Colors.amber)),
            const SizedBox(width: 12),
            Expanded(child: _buildKPICard('Pedidos Hoy', totalOrders.toString(), Icons.shopping_cart, AppTheme.neonGreen)),
          ],
        ),
      ],
    );
  }

  Widget _buildKPICard(String title, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [color.withOpacity(0.15), color.withOpacity(0.05)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(height: 8),
          Text(title, style: const TextStyle(color: Colors.white70, fontSize: 11)),
          const SizedBox(height: 4),
          Text(value, style: TextStyle(color: color, fontSize: 16, fontWeight: FontWeight.bold), overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }

  Widget _buildGroupByToggle() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Ver matriz por:', style: TextStyle(color: Colors.white70, fontSize: 12)),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'vendor', label: Text('Comercial'), icon: Icon(Icons.badge, size: 16)),
              ButtonSegment(value: 'client', label: Text('Cliente'), icon: Icon(Icons.person, size: 16)),
              ButtonSegment(value: 'product', label: Text('Producto'), icon: Icon(Icons.inventory, size: 16)),
            ],
            selected: {_groupBy},
            onSelectionChanged: (Set<String> selection) {
              setState(() => _groupBy = selection.first);
              _fetchAllData();
            },
            style: ButtonStyle(
              backgroundColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.selected)) return AppTheme.neonBlue.withOpacity(0.3);
                return AppTheme.darkBase;
              }),
              foregroundColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.selected)) return AppTheme.neonBlue;
                return Colors.white70;
              }),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSalesChart() {
    if (_matrixRows.isEmpty) return const SizedBox();

    final chartData = _matrixRows.take(8).toList();
    final maxVal = chartData.map((d) => _safeDouble(d['total'])).fold<double>(0, (a, b) => a > b ? a : b);
    
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Top ${_groupBy == 'vendor' ? 'Comerciales' : _groupBy == 'client' ? 'Clientes' : 'Productos'}',
            style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 180,
            child: BarChart(
              BarChartData(
                alignment: BarChartAlignment.spaceAround,
                maxY: maxVal * 1.2,
                barTouchData: BarTouchData(enabled: true),
                titlesData: FlTitlesData(
                  show: true,
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      getTitlesWidget: (value, meta) {
                        if (value.toInt() >= chartData.length) return const SizedBox();
                        final label = (chartData[value.toInt()]['code'] ?? '').toString();
                        return Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(label.length > 6 ? label.substring(0, 6) : label, style: const TextStyle(color: Colors.white54, fontSize: 9)),
                        );
                      },
                    ),
                  ),
                  leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                ),
                borderData: FlBorderData(show: false),
                gridData: const FlGridData(show: false),
                barGroups: chartData.asMap().entries.map((entry) {
                  return BarChartGroupData(
                    x: entry.key,
                    barRods: [
                      BarChartRodData(
                        toY: _safeDouble(entry.value['total']),
                        color: AppTheme.neonBlue,
                        width: 18,
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                      ),
                    ],
                  );
                }).toList(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
