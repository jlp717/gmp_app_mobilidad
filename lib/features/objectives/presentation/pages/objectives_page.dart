import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import 'enhanced_client_matrix_page.dart';

/// Objectives Page - Track sales goals with multi-select filters
class ObjectivesPage extends StatefulWidget {
  final String employeeCode;
  final bool isJefeVentas;
  
  const ObjectivesPage({super.key, required this.employeeCode, this.isJefeVentas = false});

  @override
  State<ObjectivesPage> createState() => _ObjectivesPageState();
}

class _ObjectivesPageState extends State<ObjectivesPage> with SingleTickerProviderStateMixin {
  // Data
  Map<String, dynamic> _objectives = {};
  List<Map<String, dynamic>> _clientsObjectives = [];
  Map<String, List<Map<String, dynamic>>> _yearlyData = {}; // Data per year
  Map<String, Map<String, dynamic>> _yearTotals = {}; // Totals per year
  
  bool _isLoading = true;
  String? _error;
  
  // Multi-select filters
  Set<int> _selectedYears = {DateTime.now().year};
  Set<int> _selectedMonths = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}; // Full year by default
  int? _touchedIndex; // For manual tooltip control
  String? _selectedStatusFilter; // null=all, 'achieved', 'ontrack', 'atrisk', 'critical'
  
  // Jefe de ventas - Ver objetivos como
  List<Map<String, dynamic>> _vendedoresDisponibles = [];
  String? _selectedVendedor; // null = ver todos los comerciales
  
  late TabController _tabController;
  
  // Spanish format: 6.150,00 €
  final _nf = NumberFormat.decimalPattern('es_ES');
  
  // Helper to format currency with €
  String _formatCurrency(double value) {
    return '${_nf.format(value.round())} €';
  }
  
  static const List<String> _monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  static const List<String> _monthNamesShort = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    // Si es jefe de ventas, cargar lista de vendedores
    if (widget.isJefeVentas) {
      _loadVendedores();
    }
    _loadData();
  }
  
  /// Obtiene el código del vendedor a usar (seleccionado o el propio)
  String get _activeVendedorCode => _selectedVendedor ?? widget.employeeCode;
  
  /// Carga la lista de vendedores disponibles (solo para jefe de ventas)
  Future<void> _loadVendedores() async {
    try {
      final response = await ApiClient.get(
        '/rutero/vendedores',
      );
      
      setState(() {
        _vendedoresDisponibles = List<Map<String, dynamic>>.from(response['vendedores'] ?? []);
      });
    } catch (e) {
      // Silently fail - vendedores list is optional
      debugPrint('Error loading vendedores: $e');
    }
  }
  
  /// Cambia el vendedor seleccionado para "Ver objetivos como"
  void _onVendedorChanged(String? vendedorCode) {
    setState(() => _selectedVendedor = vendedorCode);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() { _isLoading = true; _error = null; });

    try {
      // Load evolution data for selected years
      final evolutionRes = await ApiClient.get(
        ApiConfig.objectivesEvolution,
        queryParameters: {
          'vendedorCodes': _activeVendedorCode,
          'years': _selectedYears.join(','),
        },
      );
      
      // Load by-client objectives for selected periods
      final clientsRes = await ApiClient.get(
        ApiConfig.objectivesByClient,
        queryParameters: {
          'vendedorCodes': _activeVendedorCode,
          'years': _selectedYears.join(','),
          'months': _selectedMonths.join(','),
          'limit': '50',
        },
      );
      
      // Parse new backend format: yearlyData
      final rawYearlyData = evolutionRes['yearlyData'] as Map<String, dynamic>? ?? {};
      final rawYearTotals = evolutionRes['yearTotals'] as Map<String, dynamic>? ?? {};
      
      final Map<String, List<Map<String, dynamic>>> parsedYearlyData = {};
      final Map<String, Map<String, dynamic>> parsedYearTotals = {};
      
      // Process yearlyData
      rawYearlyData.forEach((year, monthlyList) {
        parsedYearlyData[year] = List<Map<String, dynamic>>.from(monthlyList);
      });
      
      // Process yearTotals
      rawYearTotals.forEach((year, totals) {
        parsedYearTotals[year] = Map<String, dynamic>.from(totals as Map);
      });
      
      // Fallback for old format if new format is missing (safety)
      if (parsedYearlyData.isEmpty && evolutionRes['monthlyEvolution'] != null) {
        final monthlyEvolution = List<Map<String, dynamic>>.from(evolutionRes['monthlyEvolution'] ?? []);
        final primaryYear = (evolutionRes['year'] as num?)?.toInt() ?? DateTime.now().year;
        final sortedSelectedYears = _selectedYears.toList()..sort((a, b) => b.compareTo(a));
        
        for (final selectedYear in sortedSelectedYears) {
            parsedYearlyData[selectedYear.toString()] = [];
            final salesField = (selectedYear == primaryYear) ? 'actual' : 'lastYear';
            double yearTotalSales = 0;
            double yearTotalObjective = 0;
            
            for (int m = 1; m <= 12; m++) {
              final monthData = monthlyEvolution.firstWhere((e) => (e['month'] as num?)?.toInt() == m, orElse: () => {});
              final sales = (monthData[salesField] as num?)?.toDouble() ?? 0;
              final objective = (monthData['objective'] as num?)?.toDouble() ?? 0;
              yearTotalSales += sales;
              yearTotalObjective += objective;
              
              parsedYearlyData[selectedYear.toString()]!.add({
                'month': m,
                'sales': sales,
                'objective': objective,
                'margin': sales * 0.12,
                'clients': 0,
              });
            }
            parsedYearTotals[selectedYear.toString()] = {
              'totalSales': yearTotalSales,
              'annualObjective': yearTotalObjective,
            };
        }
      }
      
      setState(() {
        _yearlyData = parsedYearlyData;
        _yearTotals = parsedYearTotals;
        _clientsObjectives = List<Map<String, dynamic>>.from(clientsRes['clients'] ?? []);
        
        // Calculate objectives from parsed data
        _calculateObjectives();
        
        _isLoading = false;
      });
    } catch (e) {
      debugPrint('Error loading objectives: $e');
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  void _calculateObjectives() {
    // Sum totals from yearlyData for selected months across all years
    double totalSales = 0;
    double totalObjective = 0;
    
    // Per-year breakdown for display
    Map<int, double> salesPerYear = {};
    Map<int, double> objectivePerYear = {};
    
    // Iterate through all selected years
    for (final year in _selectedYears) {
      salesPerYear[year] = 0;
      objectivePerYear[year] = 0;
      
      final yearData = _yearlyData[year.toString()];
      if (yearData != null) {
        for (final monthData in yearData) {
          final monthNum = (monthData['month'] as num?)?.toInt() ?? 0;
          // Only include selected months
          if (_selectedMonths.contains(monthNum)) {
            final sales = (monthData['sales'] as num?)?.toDouble() ?? 0;
            final obj = (monthData['objective'] as num?)?.toDouble() ?? 0;
            totalSales += sales;
            totalObjective += obj;
            salesPerYear[year] = salesPerYear[year]! + sales;
            objectivePerYear[year] = objectivePerYear[year]! + obj;
          }
        }
      }
    }
    
    // Margin estimated as ~12% of sales (industry standard for distribution)
    double totalMargin = totalSales * 0.12;
    double targetMargin = totalObjective * 0.12;
    
    // Client count from clientsObjectives API response (unique clients in period)
    // Count unique client codes
    Set<String> uniqueClients = {};
    for (final client in _clientsObjectives) {
      final code = client['code']?.toString() ?? '';
      if (code.isNotEmpty) uniqueClients.add(code);
    }
    int actualClients = uniqueClients.length;
    int targetClients = 50 * _selectedMonths.length; // Target ~50 clients per month
    
    // Calculate progress
    double totalAnnualObjective = 0;
    double totalAnnualSales = 0;
    for (final year in _selectedYears) {
      final yearTotals = _yearTotals[year.toString()];
      if (yearTotals != null) {
        totalAnnualObjective += (yearTotals['annualObjective'] as num?)?.toDouble() ?? 0;
        totalAnnualSales += (yearTotals['totalSales'] as num?)?.toDouble() ?? 0;
      }
    }

    // Force period target to be consistent with annual/monthly objective
    // annualObjective is the source of truth. Monthly is Annual / 12.
    // Period Target should be Monthly * Selected Months count.
    double monthlyObjective = totalAnnualObjective > 0 ? totalAnnualObjective / 12 : 0;
    // However, if we have multiple years selected, we need to handle that.
    // Actually, totalAnnualObjective is the sum of annual objectives for all selected years.
    // So monthlyObjective here is the "Average Monthly" across selected years?
    // No, if I select 2024 and 2025. 
    // The "Period Target" should be: Sum of (AnnualObj_Year / 12) * SelectedMonths_Year
    // But since selected months are the SAME for all years (e.g. Jan, Feb)...
    // It is simply: (Sum(AnnualObj_AllYears) / 12) * SelectedMonths.length
    
    double consistentTarget = (monthlyObjective * _selectedMonths.length);
    
    // Check if we should use the sum from monthly data or the consistent calculation
    // Using consistent calculation is safer to avoid "49.002 vs 65.255" issues
    if (totalObjective == 0 && consistentTarget > 0) {
        totalObjective = consistentTarget;
    } else {
        // If we have data, PREFER the consistent target to ensure UI consistency
        totalObjective = consistentTarget;
    }
    
    double progress = totalObjective > 0 ? (totalSales / totalObjective) * 100 : 0;
    
    // Restore Margin & Client Progress
    double marginProgress = targetMargin > 0 ? (totalMargin / targetMargin) * 100 : 0;
    double clientProgress = targetClients > 0 ? (actualClients / targetClients) * 100 : 0;
    
    // Restore YTD Logic
    final now = DateTime.now();
    double ytdSales = 0;
    double ytdObjective = 0;
    final currentYearData = _yearlyData[now.year.toString()];
    if (currentYearData != null) {
      for (final monthData in currentYearData) {
        final monthNum = (monthData['month'] as num?)?.toInt() ?? 0;
        if (monthNum <= now.month) {
          ytdSales += (monthData['sales'] as num?)?.toDouble() ?? 0;
          ytdObjective += (monthData['objective'] as num?)?.toDouble() ?? 0;
        }
      }
    }
    double ytdProgress = ytdObjective > 0 ? (ytdSales / ytdObjective) * 100 : 0;

    _objectives = {
      'sales': {
        'target': totalObjective,
        'current': totalSales,
        'progress': progress,
        'annualObjective': totalAnnualObjective,
        'monthlyObjective': totalAnnualObjective > 0 ? totalAnnualObjective / 12 : 0,
        'yearsCount': _selectedYears.length,
        'monthsCount': _selectedMonths.length,
        'salesPerYear': salesPerYear,
        'objectivePerYear': objectivePerYear,
      },
      'margin': {
        'target': targetMargin,
        'current': totalMargin,
        'progress': marginProgress,
      },
      'clients': {
        'target': targetClients.toDouble(),
        'current': actualClients.toDouble(),
        'progress': clientProgress,
      },
      'ytd': {
        'sales': ytdSales,
        'objective': ytdObjective,
        'progress': ytdProgress,
        'year': now.year,
      },
    };
  }

  void _showFilterModal() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surfaceColor,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => SafeArea(
          child: SingleChildScrollView(
            padding: EdgeInsets.only(
              left: 16, right: 16, top: 16,
              bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Filtrar por Período', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const SizedBox(height: 12),
                
                // Year selector (multi-select)
                const Text('Años (selecciona varios)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  children: [2023, 2024, 2025].map((y) => FilterChip(
                    label: Text('$y'),
                    selected: _selectedYears.contains(y),
                    onSelected: (s) {
                      setModalState(() {
                        if (s) {
                          _selectedYears.add(y);
                        } else if (_selectedYears.length > 1) {
                          _selectedYears.remove(y);
                        }
                      });
                    },
                    selectedColor: AppTheme.neonPurple.withOpacity(0.3),
                    checkmarkColor: AppTheme.neonPurple,
                  )).toList(),
                ),
                const SizedBox(height: 16),
                
                // Month selector
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Meses', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
                    Row(
                      children: [
                        TextButton(
                          onPressed: () => setModalState(() => _selectedMonths = {1,2,3,4,5,6,7,8,9,10,11,12}),
                          child: const Text('TODO', style: TextStyle(fontSize: 10)),
                        ),
                        TextButton(
                          onPressed: () => setModalState(() => _selectedMonths = {for (var i = 1; i <= DateTime.now().month; i++) i}),
                          child: const Text('YTD', style: TextStyle(fontSize: 10)),
                        ),
                        TextButton(
                          onPressed: () => setModalState(() => _selectedMonths = {}),
                          child: const Text('NINGUNO', style: TextStyle(fontSize: 10)),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6, runSpacing: 6,
                  children: List.generate(12, (i) => FilterChip(
                    label: Text(_monthNamesShort[i], style: const TextStyle(fontSize: 11)),
                    selected: _selectedMonths.contains(i + 1),
                    onSelected: (s) {
                      setModalState(() {
                        if (s) _selectedMonths.add(i + 1);
                        else _selectedMonths.remove(i + 1);
                      });
                    },
                    selectedColor: AppTheme.neonBlue.withOpacity(0.3),
                    checkmarkColor: AppTheme.neonBlue,
                    visualDensity: VisualDensity.compact,
                  )),
                ),
                const SizedBox(height: 20),
                
                // Apply button
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.neonPurple,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    onPressed: () {
                      Navigator.pop(ctx);
                      setState(() {});
                      _loadData();
                    },
                    child: const Text('Aplicar Filtros', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String get _periodLabel {
    if (_selectedMonths.isEmpty || _selectedYears.isEmpty) return 'Sin selección';
    
    final yearsStr = _selectedYears.length == 1 
        ? '${_selectedYears.first}' 
        : _selectedYears.toList().join(', ');
    
    if (_selectedMonths.length == 12) return 'Todo $yearsStr';
    if (_selectedMonths.length == 1) return '${_monthNames[_selectedMonths.first - 1]} $yearsStr';
    
    final sorted = _selectedMonths.toList()..sort();
    // Check if consecutive
    bool consecutive = true;
    for (int i = 1; i < sorted.length; i++) {
      if (sorted[i] != sorted[i-1] + 1) { consecutive = false; break; }
    }
    
    if (consecutive) {
      return '${_monthNamesShort[sorted.first - 1]} - ${_monthNamesShort[sorted.last - 1]} $yearsStr';
    }
    return '${_selectedMonths.length} meses $yearsStr';
  }

  /// Widget de selección de vendedor para "Ver objetivos como" (solo jefe de ventas)
  Widget _buildVendedorSelector() {
    // Ensure selected value exists in items, otherwise reset to empty
    final validVendedorCodes = _vendedoresDisponibles.map((v) => v['code']?.toString() ?? '').toSet();
    final currentValue = (_selectedVendedor != null && validVendedorCodes.contains(_selectedVendedor)) 
        ? _selectedVendedor! 
        : '';
    
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      color: AppTheme.surfaceColor,
      child: Row(
        children: [
          const Icon(Icons.visibility, color: AppTheme.neonBlue, size: 18),
          const SizedBox(width: 8),
          const Text('Ver como:', style: TextStyle(fontSize: 12, color: Colors.white70)),
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
              decoration: BoxDecoration(
                color: AppTheme.darkSurface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: currentValue,
                  isExpanded: true,
                  isDense: true,
                  dropdownColor: AppTheme.darkCard,
                  icon: const Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue, size: 20),
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                  items: [
                    const DropdownMenuItem<String>(
                      value: '',
                      child: Text('Todos los comerciales', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
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
                    _loadData();
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Header with filter button
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          color: AppTheme.surfaceColor,
          child: Row(
            children: [
              const Icon(Icons.track_changes, color: AppTheme.neonPurple, size: 20),
              const SizedBox(width: 8),
              const Text('Objetivos', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              const Spacer(),
              // Filter button (replaces arrows)
              InkWell(
                onTap: _showFilterModal,
                borderRadius: BorderRadius.circular(20),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.neonPurple.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppTheme.neonPurple.withOpacity(0.5)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_periodLabel, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      const SizedBox(width: 4),
                      const Icon(Icons.arrow_drop_down, size: 18),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        
        // Selector de vendedor para jefe de ventas
        if (widget.isJefeVentas) _buildVendedorSelector(),
        
        // Tab bar
        Container(
          height: 36,
          color: AppTheme.surfaceColor,
          child: TabBar(
            controller: _tabController,
            indicatorColor: AppTheme.neonPurple,
            labelColor: AppTheme.neonPurple,
            unselectedLabelColor: AppTheme.textSecondary,
            labelStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
            tabs: const [
              Tab(text: 'Resumen'),
              Tab(text: 'Por Cliente'),
            ],
          ),
        ),
        
        // Content
        Expanded(
          child: _isLoading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? _buildError()
                  : TabBarView(
                      controller: _tabController,
                      children: [
                        _buildSummaryTab(),
                        _buildClientTab(),
                      ],
                    ),
        ),
      ],
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 48, color: AppTheme.error),
          const SizedBox(height: 16),
          Text('Error: $_error', textAlign: TextAlign.center),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: _loadData, child: const Text('Reintentar')),
        ],
      ),
    );
  }

  Widget _buildSummaryTab() {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildYTDBanner(), // YTD accumulated progress
            const SizedBox(height: 12),
            _buildObjectiveCards(),
            const SizedBox(height: 16),
            _buildEvolutionChart(),
            const SizedBox(height: 16), // Extra padding at bottom
          ],
        ),
      ),
    );
  }
  
  Widget _buildYTDBanner() {
    final ytd = _objectives['ytd'] as Map<String, dynamic>? ?? {};
    final ytdSales = (ytd['sales'] as num?)?.toDouble() ?? 0;
    final ytdObjective = (ytd['objective'] as num?)?.toDouble() ?? 0;
    final ytdProgress = (ytd['progress'] as num?)?.toDouble() ?? 0;
    final year = (ytd['year'] as num?)?.toInt() ?? DateTime.now().year;
    
    if (ytdObjective == 0) return const SizedBox.shrink();
    
    final isOnTrack = ytdProgress >= 100;
    final color = isOnTrack ? AppTheme.success : (ytdProgress >= 90 ? Colors.orange : AppTheme.error);
    
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [color.withOpacity(0.2), color.withOpacity(0.05)],
        ),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Icon(isOnTrack ? Icons.emoji_events : Icons.trending_up, color: color, size: 28),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Acumulado $year (hasta ${_monthNamesShort[DateTime.now().month - 1]})',
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500)),
                Text('${_formatCurrency(ytdSales)} de ${_formatCurrency(ytdObjective)}',
                    style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: color.withOpacity(0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text('${ytdProgress.toStringAsFixed(1)}%',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: color)),
          ),
        ],
      ),
    );
  }
  
  List<Widget> _buildYearBreakdownCards(Map<String, dynamic> sales) {
    final salesPerYear = sales['salesPerYear'] as Map<int, double>? ?? {};
    final objPerYear = sales['objectivePerYear'] as Map<int, double>? ?? {};
    final sortedYears = _selectedYears.toList()..sort();
    
    return sortedYears.map((year) {
      final yearSales = salesPerYear[year] ?? 0;
      final yearObj = objPerYear[year] ?? 0;
      final yearProg = yearObj > 0 ? (yearSales / yearObj * 100) : 0;
      
      return Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor.withOpacity(0.5),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: Colors.grey.withOpacity(0.2)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Objetivo $year', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                Text(_formatCurrency(yearObj), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.neonPurple)),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Vendido $year', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
                Text('${_formatCurrency(yearSales)} (${yearProg.toStringAsFixed(0)}%)', 
                    style: TextStyle(fontSize: 10, color: yearProg >= 100 ? AppTheme.success : AppTheme.textSecondary)),
              ],
            ),
          ],
        ),
      );
    }).toList();
  }

  Widget _buildObjectiveCards() {
    final sales = _objectives['sales'] as Map<String, dynamic>? ?? {};
    final margin = _objectives['margin'] as Map<String, dynamic>? ?? {};
    final clients = _objectives['clients'] as Map<String, dynamic>? ?? {};
    
    final annualObj = (sales['annualObjective'] as num?)?.toDouble() ?? 0;
    final monthlyObj = (sales['monthlyObjective'] as num?)?.toDouble() ?? 0;
    final periodTarget = (sales['target'] as num?)?.toDouble() ?? 0;
    final current = (sales['current'] as num?)?.toDouble() ?? 0;
    final progress = (sales['progress'] as num?)?.toDouble() ?? 0;
    final variation = (sales['variation'] as num?)?.toDouble();
    
    final isAchieved = progress >= 100;
    final progressColor = progress >= 100 ? AppTheme.success : (progress >= 80 ? Colors.orange : AppTheme.error);
    
    return Column(
      children: [
        // Main sales card - enhanced view
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppTheme.surfaceColor,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: isAchieved ? AppTheme.success.withOpacity(0.5) : Colors.transparent, width: 2),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                children: [
                  const Icon(Icons.euro, size: 20, color: AppTheme.neonBlue),
                  const SizedBox(width: 6),
                  const Text('VENTAS', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                  const Spacer(),
                  if (isAchieved) const Icon(Icons.check_circle, color: AppTheme.success, size: 18),
                ],
              ),
              const SizedBox(height: 12),
              
              // Per-year objective breakdown when multiple years selected
              if (_selectedYears.length > 1) ...[
                // Show each year's objective
                ..._buildYearBreakdownCards(sales),
              ] else ...[
                // Single year - show simple annual objective
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppTheme.neonPurple.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Objetivo ${_selectedYears.first}', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w500)),
                      Text(_formatCurrency(annualObj), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.neonPurple)),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 6),
              
              // Monthly objective
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Objetivo mensual (anual ÷ 12)', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
                  Text(_formatCurrency(monthlyObj), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w500)),
                ],
              ),
              const SizedBox(height: 4),
              
              // Period objective (based on selected months)
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Objetivo ${_selectedMonths.length} mes${_selectedMonths.length != 1 ? 'es' : ''}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500)),
                    Text(_formatCurrency(periodTarget), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.neonBlue)),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              
              // Current sales - big display
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('VENDIDO', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
                      Text(_formatCurrency(current), style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: progressColor)),
                    ],
                  ),
                  const Spacer(),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text('${progress.toStringAsFixed(1)}%', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: progressColor)),
                      Text('cumplido', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              
              // Progress bar
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: (progress / 100).clamp(0.0, 1.0),
                  backgroundColor: progressColor.withOpacity(0.2),
                  valueColor: AlwaysStoppedAnimation(progressColor),
                  minHeight: 8,
                ),
              ),
              
              // Variation if available
              if (variation != null && variation != 0) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    Icon(variation >= 0 ? Icons.trending_up : Icons.trending_down, size: 14, color: variation >= 0 ? AppTheme.success : AppTheme.error),
                    const SizedBox(width: 4),
                    Text('${variation >= 0 ? '+' : ''}${variation.toStringAsFixed(1)}% vs año anterior', 
                      style: TextStyle(fontSize: 10, color: variation >= 0 ? AppTheme.success : AppTheme.error)),
                  ],
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            // Only show Margin if Sales Manager
            if (widget.isJefeVentas) ...[
              Expanded(
                child: _ObjectiveCard(
                  title: 'Margen',
                  icon: Icons.trending_up,
                  target: (margin['target'] as num?)?.toDouble() ?? 0,
                  current: (margin['current'] as num?)?.toDouble() ?? 0,
                  progress: (margin['progress'] as num?)?.toDouble() ?? 0,
                  format: _nf,
                  compact: true,
                ),
              ),
              const SizedBox(width: 10),
            ],
            // Clients card takes remaining space (full width if Margin hidden)
            Expanded(
              child: _ObjectiveCard(
                title: 'Clientes',
                icon: Icons.people,
                target: (clients['target'] as num?)?.toDouble() ?? 0,
                current: (clients['current'] as num?)?.toDouble() ?? 0,
                progress: (clients['progress'] as num?)?.toDouble() ?? 0,
                isCount: true,
                compact: true,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildEvolutionChart() {
    if (_yearlyData.isEmpty) {
      return Container(
        height: 200,
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.bar_chart, size: 48, color: AppTheme.textSecondary.withOpacity(0.5)),
              const SizedBox(height: 8),
              Text('Sin datos para mostrar', style: TextStyle(color: AppTheme.textSecondary)),
            ],
          ),
        ),
      );
    }
  
    // Define a premium color palette
    final List<Color> palette = [
      AppTheme.neonPurple,
      const Color(0xFF38B6FF), // Electric Blue
      const Color(0xFFFF6584), // Vibrant Pink/Red
      const Color(0xFFFFC107), // Amber
    ];

    final sortedYears = _selectedYears.toList()..sort();
    final sortedMonths = _selectedMonths.toList()..sort();
    final yearColors = <int, Color>{};
    
    // Colors for different years
    // Ensure we cycle colors so 2024 and 2025 have distinct hues
    for (int i = 0; i < sortedYears.length; i++) {
        // Reverse index so newest year gets index 0 (Purple)
        int colorIdx = (sortedYears.length - 1 - i) % palette.length;
        yearColors[sortedYears[i]] = palette[colorIdx];
    }
    
    // Calculate max Y across all data (considering only selected months?)
    double maxY = 0;
    for (final year in sortedYears) {
      final data = _yearlyData[year.toString()] ?? [];
      for (final m in data) {
        if (!sortedMonths.contains(m['month'])) continue; // Only check selected months
        final sales = (m['sales'] as num?)?.toDouble() ?? 0;
        final obj = (m['objective'] as num?)?.toDouble() ?? 0;
        if (sales > maxY) maxY = sales;
        if (obj > maxY) maxY = obj;
      }
    }
    
    // Round maxY to nearest nice ceiling for clean axis
    double baseInterval = maxY > 0 ? maxY / 4 : 25000;
    // Round interval to nearest 5000 or 10000
    if (baseInterval > 10000) {
      baseInterval = ((baseInterval / 10000).ceil() * 10000).toDouble();
    } else {
      baseInterval = ((baseInterval / 1000).ceil() * 1000).toDouble();
    }
    double roundedMaxY = baseInterval * 5; // Ensure 5 steps
    if (roundedMaxY < maxY) roundedMaxY += baseInterval;

    // Build chart data
    List<LineChartBarData> lineBarsData = [];
  
    for (final year in sortedYears) {
      final data = _yearlyData[year.toString()] ?? [];
      final color = yearColors[year]!;
      
      // Calculate TRUE Annual Average for the Straight Line
      double annualObj = 0;
      if (_yearTotals.containsKey(year.toString())) {
         annualObj = (_yearTotals[year.toString()]!['annualObjective'] as num?)?.toDouble() ?? 0;
      }
      double flatMonthlyObj = annualObj > 0 ? annualObj / 12 : 0;
      
      // 1. Sales Line
      final salesSpots = sortedMonths.map((m) {
        final monthData = data.firstWhere((e) => e['month'] == m, orElse: () => {});
        return FlSpot((m - 1).toDouble(), (monthData['sales'] as num?)?.toDouble() ?? 0);
      }).toList();
      
      if (salesSpots.isNotEmpty) {
        lineBarsData.add(LineChartBarData(
          spots: salesSpots,
          isCurved: true,
          curveSmoothness: 0.35,
          color: color,
          barWidth: 3,
          isStrokeCapRound: true,
          dotData: FlDotData(
            show: true,
            getDotPainter: (spot, percent, bar, index) {
              return FlDotCirclePainter(
                radius: 4,
                color: Colors.white,
                strokeWidth: 2,
                strokeColor: color,
              );
            },
          ),
          belowBarData: BarAreaData(
             show: true,
             gradient: LinearGradient(
               colors: [color.withOpacity(0.2), color.withOpacity(0.0)],
               begin: Alignment.topCenter,
               end: Alignment.bottomCenter,
             ),
          ),
        ));
      }
      
      // 2. Objective Line
      // Ensure it is drawn! 
      final objSpots = sortedMonths.map((m) {
        return FlSpot((m - 1).toDouble(), flatMonthlyObj);
      }).toList();
      
      if (objSpots.isNotEmpty) {
        lineBarsData.add(LineChartBarData(
          spots: objSpots,
          isCurved: false,
          color: color.withOpacity(0.8), 
          barWidth: 2,
          dotData: const FlDotData(show: false),
          // Use different dash pattern based on year index? Or just standard.
          dashArray: [5, 5], 
          belowBarData: BarAreaData(show: false),
        ));
      }
    }
  
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
               const Column(
                 crossAxisAlignment: CrossAxisAlignment.start,
                 children: [
                   Text('Evolución de Ventas', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                   Text('Sólida: Venta  |  Discontinua: Obj.', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                 ],
               ),
               // Legend
               Wrap(
                 spacing: 12,
                 children: [
                   for (final year in sortedYears.reversed)
                     Row(
                       mainAxisSize: MainAxisSize.min,
                       children: [
                         Container(
                           width: 8, height: 8,
                           decoration: BoxDecoration(color: yearColors[year], shape: BoxShape.circle),
                         ),
                         const SizedBox(width: 4),
                         Text('$year', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                       ],
                     ),
                 ],
               ),
            ],
          ),
          const SizedBox(height: 20),
          
          // Chart
          SizedBox(
            height: 260,
            child: LineChart(
              LineChartData(
                minY: 0,
                maxY: roundedMaxY,
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  horizontalInterval: baseInterval,
                  getDrawingHorizontalLine: (value) => FlLine(
                    color: Colors.grey.withOpacity(0.1),
                    strokeWidth: 1,
                    dashArray: [4, 4], 
                  ),
                ),
                titlesData: FlTitlesData(
                  topTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  rightTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 50,
                      interval: baseInterval,
                      getTitlesWidget: (value, meta) {
                        if (value % 1 == 0) {
                             return Text(
                              '${_nf.format(value.round())} €', 
                              style: TextStyle(color: AppTheme.textSecondary, fontSize: 9),
                            );
                        }
                        return const SizedBox.shrink();
                      },
                    ),
                  ),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 22,
                      interval: 1,
                      getTitlesWidget: (value, meta) {
                        final idx = value.toInt();
                        if (idx >= 0 && idx < 12) {
                             if (!_selectedMonths.contains(idx + 1)) return const SizedBox.shrink();
                             return Padding(
                               padding: const EdgeInsets.only(top: 6),
                               child: Text(
                                 _monthNamesShort[idx],
                                 style: TextStyle(
                                   fontSize: 10,
                                   fontWeight: FontWeight.bold,
                                   color: AppTheme.textPrimary,
                                 ),
                               ),
                             );
                        }
                        return const SizedBox.shrink();
                      },
                    ),
                  ),
                ),
                borderData: FlBorderData(show: false),
                lineBarsData: lineBarsData,
                lineTouchData: LineTouchData(
                  enabled: true,
                  handleBuiltInTouches: true,
                  touchTooltipData: LineTouchTooltipData(
                    tooltipBgColor: const Color(0xFF1A1A2E).withOpacity(0.95), // Premium dark blue
                    tooltipRoundedRadius: 12,
                    tooltipPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    tooltipBorder: BorderSide(color: Colors.white.withOpacity(0.15), width: 1),
                    getTooltipItems: (touchedSpots) {
                      return touchedSpots.map((spot) {
                         int monthIdx = spot.x.toInt();
                         String monthName = (monthIdx >= 0 && monthIdx < _monthNamesShort.length) 
                             ? _monthNamesShort[monthIdx] : '';
                         
                         // Robust check: Objective lines have dashArray set, Sales lines don't
                         bool isObj = spot.bar.dashArray != null;
                         
                         // Use the spot's built-in barIndex which is reliable
                         int barIndex = spot.barIndex;
                         int yearIndex = barIndex >= 0 ? barIndex ~/ 2 : 0;
                         int year = (yearIndex < sortedYears.length && yearIndex >= 0) ? sortedYears[yearIndex] : sortedYears.firstOrNull ?? 0;
                         
                         final Color lineColor = spot.bar.color ?? Colors.white;
  
                         return LineTooltipItem(
                           // Clearly distinguish Objective vs Sales
                            '${isObj ? "Objetivo" : "Ventas"} $monthName $year\n',
                           TextStyle(
                             color: lineColor,
                             fontWeight: FontWeight.bold,
                             fontSize: 12,
                           ),
                           children: [
                             TextSpan(
                               text: '${_nf.format(spot.y)} €',
                               style: const TextStyle(
                                 color: Colors.white,
                                 fontWeight: FontWeight.w600,
                                 fontSize: 14,
                               ),
                             ),
                           ],
                         );
                      }).toList();
                    },
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _legendItem(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
      ],
    );
  }

  Widget _buildYTDSummary() {
    final sales = _objectives['sales'] as Map<String, dynamic>? ?? {};
    final progress = (sales['progress'] as num?)?.toDouble() ?? 0;
    final isAchieved = progress >= 100;
    
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isAchieved
              ? [AppTheme.success.withOpacity(0.2), AppTheme.success.withOpacity(0.1)]
              : [AppTheme.neonPurple.withOpacity(0.2), AppTheme.neonPurple.withOpacity(0.1)],
        ),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(isAchieved ? Icons.emoji_events : Icons.timeline, size: 32, color: isAchieved ? AppTheme.success : AppTheme.neonPurple),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Período: $_periodLabel', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                Text('Real: ${_formatCurrency((sales['current'] as num?)?.toDouble() ?? 0)}', style: const TextStyle(fontSize: 11)),
                Text('Objetivo: ${_formatCurrency((sales['target'] as num?)?.toDouble() ?? 0)}', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: isAchieved ? AppTheme.success : AppTheme.neonPurple,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text('${progress.toStringAsFixed(0)}%', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
          ),
        ],
      ),
    );
  }

  String _clientSearchQuery = '';

  Widget _buildClientTab() {
    if (_clientsObjectives.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.people_outline, size: 48, color: AppTheme.textSecondary),
            SizedBox(height: 12),
            Text('No hay datos de clientes'),
          ],
        ),
      );
    }

    // Filter by search query AND status
    final filteredClients = _clientsObjectives.where((c) {
      // Status filter
      if (_selectedStatusFilter != null && c['status'] != _selectedStatusFilter) {
        return false;
      }
      // Search filter
      if (_clientSearchQuery.isEmpty) return true;
      final name = c['name']?.toString().toLowerCase() ?? '';
      final code = c['code']?.toString().toLowerCase() ?? '';
      return name.contains(_clientSearchQuery.toLowerCase()) || code.contains(_clientSearchQuery.toLowerCase());
    }).toList();

    // Count by status
    final statusCounts = {
      'achieved': _clientsObjectives.where((c) => c['status'] == 'achieved').length,
      'ontrack': _clientsObjectives.where((c) => c['status'] == 'ontrack').length,
      'atrisk': _clientsObjectives.where((c) => c['status'] == 'atrisk').length,
      'critical': _clientsObjectives.where((c) => c['status'] == 'critical').length,
    };
    
    return Column(
      children: [
        // Search field
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
          child: SizedBox(
            height: 40,
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Buscar cliente...',
                prefixIcon: const Icon(Icons.search, size: 18),
                filled: true,
                fillColor: AppTheme.surfaceColor,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
              style: const TextStyle(fontSize: 13),
              onChanged: (val) => setState(() => _clientSearchQuery = val),
            ),
          ),
        ),
        // Status filter chips
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _statusFilterChip(null, 'Todos', Icons.list, AppTheme.textSecondary, _clientsObjectives.length),
                const SizedBox(width: 6),
                _statusFilterChip('achieved', 'Conseguido', Icons.check_circle, Colors.green, statusCounts['achieved']!),
                const SizedBox(width: 6),
                _statusFilterChip('ontrack', 'En camino', Icons.trending_up, Colors.blue, statusCounts['ontrack']!),
                const SizedBox(width: 6),
                _statusFilterChip('atrisk', 'En riesgo', Icons.warning, Colors.orange, statusCounts['atrisk']!),
                const SizedBox(width: 6),
                _statusFilterChip('critical', 'Crítico', Icons.error, Colors.red, statusCounts['critical']!),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        // Client count
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            '${filteredClients.length} clientes',
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
          ),
        ),
        // Client list
        const SizedBox(height: 8),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: filteredClients.length,
            itemBuilder: (context, index) {
              final client = filteredClients[index];
              return _ClientCard(
                client: client,
                cf: _nf,
                showMargin: widget.isJefeVentas, // Pass permission checks
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => EnhancedClientMatrixPage(
                      clientCode: client['code'],
                      clientName: client['name'] ?? 'Cliente',
                      isJefeVentas: widget.isJefeVentas,
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _statusFilterChip(String? status, String label, IconData icon, Color color, int count) {
    final isSelected = _selectedStatusFilter == status;
    return GestureDetector(
      onTap: () => setState(() => _selectedStatusFilter = status),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? color.withOpacity(0.15) : AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: isSelected ? color : Colors.transparent, width: 1.5),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: isSelected ? color : AppTheme.textSecondary),
            const SizedBox(width: 4),
            Text(
              '$label ($count)',
              style: TextStyle(
                fontSize: 11,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                color: isSelected ? color : AppTheme.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
} // End of _ObjectivesPageState

class _ObjectiveCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final double target;
  final double current;
  final double progress;
  final double? variation;
  final NumberFormat? format;
  final bool isCount;
  final bool compact;
  final String? subtitle;

  const _ObjectiveCard({
    required this.title,
    required this.icon,
    required this.target,
    required this.current,
    required this.progress,
    this.variation,
    this.format,
    this.isCount = false,
    this.compact = false,
    this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    final isAchieved = progress >= 100;
    final progressColor = progress >= 100 ? AppTheme.success : (progress >= 80 ? Colors.orange : AppTheme.error);
    
    String formatValue(double value) {
      if (isCount) return value.toInt().toString();
      return '${format?.format(value.round()) ?? value.toStringAsFixed(0)} €';
    }
    
    return Container(
      padding: EdgeInsets.all(compact ? 10 : 14),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: isAchieved ? AppTheme.success.withOpacity(0.5) : Colors.transparent, width: 2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: compact ? 16 : 20, color: progressColor),
              const SizedBox(width: 6),
              Text(title, style: TextStyle(fontSize: compact ? 11 : 13, fontWeight: FontWeight.bold)),
              const Spacer(),
              if (isAchieved) const Icon(Icons.check_circle, color: AppTheme.success, size: 16),
            ],
          ),
          SizedBox(height: compact ? 6 : 10),
          
          Text(formatValue(current), style: TextStyle(fontSize: compact ? 18 : 24, fontWeight: FontWeight.bold)),
          
          const SizedBox(height: 2),
          Text('Objetivo: ${formatValue(target)}', style: TextStyle(fontSize: compact ? 9 : 10, color: AppTheme.textSecondary)),
          
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(subtitle!, style: TextStyle(fontSize: 9, color: AppTheme.neonPurple)),
          ],
          
          SizedBox(height: compact ? 6 : 10),
          
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: (progress / 100).clamp(0.0, 1.0),
              backgroundColor: progressColor.withOpacity(0.2),
              valueColor: AlwaysStoppedAnimation(progressColor),
              minHeight: compact ? 5 : 6,
            ),
          ),
          
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('${progress.toStringAsFixed(0)}%', style: TextStyle(color: progressColor, fontWeight: FontWeight.bold, fontSize: 11)),
              if (variation != null)
                Row(
                  children: [
                    Icon(variation! >= 0 ? Icons.trending_up : Icons.trending_down, size: 12, color: variation! >= 0 ? AppTheme.success : AppTheme.error),
                    const SizedBox(width: 2),
                    Text('${variation! >= 0 ? '+' : ''}${variation!.toStringAsFixed(1)}%', style: TextStyle(fontSize: 10, color: variation! >= 0 ? AppTheme.success : AppTheme.error)),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ClientCard extends StatelessWidget {
  final Map<String, dynamic> client;
  final NumberFormat cf;
  final VoidCallback onTap;
  final bool showMargin; // New field

  const _ClientCard({
    required this.client, 
    required this.cf, 
    required this.onTap,
    this.showMargin = false, // Default false
  });

  String _formatCurrency(double value) {
    return '${cf.format(value)} €';
  }

  void _openInMaps(BuildContext context) async {
    final lat = (client['lat'] as num?)?.toDouble();
    final lng = (client['lng'] as num?)?.toDouble();
    final name = client['name'] as String? ?? '';
    final address = client['address'] as String? ?? '';
    final city = client['city'] as String? ?? '';
    final postalCode = client['postalCode'] as String? ?? '';
    
    // Build search query with business name for better results
    final addressParts = [address, postalCode, city].where((s) => s.isNotEmpty).join(', ');
    final searchQuery = name.isNotEmpty 
        ? '$name, $addressParts'
        : addressParts;
    
    final encodedQuery = Uri.encodeComponent(searchQuery);
    
    // Build URL list - prioritize geo intent (most compatible)
    List<String> urls = [];
    
    if (lat != null && lng != null && (lat != 0 || lng != 0)) {
      // If we have coordinates, use geo intent with label
      urls.add('geo:$lat,$lng?q=$lat,$lng($encodedQuery)');
      urls.add('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng');
    }
    
    // Always add fallback with address/name
    if (searchQuery.isNotEmpty) {
      urls.add('geo:0,0?q=$encodedQuery'); // Geo intent - opens default maps app
      urls.add('https://www.google.com/maps/dir/?api=1&destination=$encodedQuery');
      urls.add('https://www.google.com/maps/search/?api=1&query=$encodedQuery');
    }
    
    if (urls.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sin ubicación disponible')),
      );
      return;
    }
    
    // Try launching directly without canLaunchUrl (more compatible on Android 11+)
    for (final urlStr in urls) {
      try {
        final url = Uri.parse(urlStr);
        final launched = await launchUrl(url, mode: LaunchMode.externalApplication);
        if (launched) return;
      } catch (e) {
        // Try next URL format
      }
    }
    
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se puede abrir el mapa. Instala Google Maps.'), backgroundColor: AppTheme.error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    // ... (keep existing variable extraction)
    final code = client['code'] as String? ?? '';
    final name = client['name'] as String? ?? 'Sin nombre';
    final address = client['address'] as String? ?? '';
    final city = client['city'] as String? ?? '';
    final postalCode = client['postalCode'] as String? ?? '';
    final phone = client['phone'] as String? ?? '';
    final route = client['route'] as String? ?? '';
    
    final objective = (client['objective'] as num?)?.toDouble() ?? 0;
    final current = (client['current'] as num?)?.toDouble() ?? 0;
    final margin = (client['margin'] as num?)?.toDouble() ?? 0;
    final progress = (client['progress'] as num?)?.toDouble() ?? 0;
    final status = client['status'] as String? ?? 'critical';
    
    final lat = (client['lat'] as num?)?.toDouble();
    final lng = (client['lng'] as num?)?.toDouble();
    
    final hasAddress = address.isNotEmpty || city.isNotEmpty || (lat != null && lng != null && (lat != 0 || lng != 0));
    
    Color statusColor;
    String statusText;
    switch (status) {
      case 'achieved': statusColor = AppTheme.success; statusText = 'Conseguido'; break;
      case 'ontrack': statusColor = Colors.lightGreen; statusText = 'En camino'; break;
      case 'atrisk': statusColor = Colors.orange; statusText = 'En riesgo'; break;
      default: statusColor = AppTheme.error; statusText = 'Crítico';
    }
    
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      color: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: statusColor.withOpacity(0.3))),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header: Name + Code + Status
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold), overflow: TextOverflow.ellipsis),
                        Text('Cód: $code', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: statusColor.withOpacity(0.2), borderRadius: BorderRadius.circular(12)),
                    child: Text(statusText, style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: statusColor)),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              
              // Address + Route + Maps button
              if (hasAddress || route.isNotEmpty)
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(color: AppTheme.darkBase.withOpacity(0.5), borderRadius: BorderRadius.circular(6)),
                  child: Row(
                    children: [
                      const Icon(Icons.location_on, size: 14, color: AppTheme.neonBlue),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (address.isNotEmpty) Text(address, style: const TextStyle(fontSize: 10), overflow: TextOverflow.ellipsis),
                            if (city.isNotEmpty || postalCode.isNotEmpty) Text('$postalCode $city'.trim(), style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
                          ],
                        ),
                      ),
                      if (route.isNotEmpty)
                        Container(
                          margin: const EdgeInsets.only(right: 4),
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(color: AppTheme.neonPurple.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                          child: Text('Ruta $route', style: const TextStyle(fontSize: 8, fontWeight: FontWeight.w500)),
                        ),
                      if (hasAddress)
                        IconButton(
                          icon: const Icon(Icons.map, size: 18, color: AppTheme.neonBlue),
                          onPressed: () => _openInMaps(context),
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                          tooltip: 'Abrir en Google Maps',
                        ),
                    ],
                  ),
                ),
              
              if (phone.isNotEmpty) ...[
                const SizedBox(height: 4),
                Row(children: [const Icon(Icons.phone, size: 12, color: AppTheme.textSecondary), const SizedBox(width: 4), Text(phone, style: TextStyle(fontSize: 10, color: AppTheme.textSecondary))]),
              ],
              
              const SizedBox(height: 8),
              
              // Sales data with progress bar
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(gradient: LinearGradient(colors: [statusColor.withOpacity(0.1), statusColor.withOpacity(0.05)]), borderRadius: BorderRadius.circular(8)),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('OBJETIVO', style: TextStyle(fontSize: 8, color: AppTheme.textSecondary)), Text(_formatCurrency(objective), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500))]),
                        Column(crossAxisAlignment: CrossAxisAlignment.center, children: [Text('VENDIDO', style: TextStyle(fontSize: 8, color: AppTheme.textSecondary)), Text(_formatCurrency(current), style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: statusColor))]),
                        if (showMargin)
                          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [Text('MARGEN', style: TextStyle(fontSize: 8, color: AppTheme.textSecondary)), Text(_formatCurrency(margin), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500))]),
                      ],
                    ),
                    const SizedBox(height: 6),
                    ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: (progress / 100).clamp(0.0, 1.0), backgroundColor: statusColor.withOpacity(0.2), valueColor: AlwaysStoppedAnimation(statusColor), minHeight: 6)),
                    const SizedBox(height: 4),
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Progreso', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)), Text('${progress.toStringAsFixed(1)}%', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: statusColor))]),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [Text('Ver historial de compras', style: TextStyle(fontSize: 9, color: AppTheme.neonBlue)), const Icon(Icons.chevron_right, size: 14, color: AppTheme.neonBlue)]),
            ],
          ),
        ),
      ),
    );
  }
}
