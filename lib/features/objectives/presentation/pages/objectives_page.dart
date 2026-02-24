import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/api/api_config.dart';
import '../../data/objectives_service.dart';
import '../../../../core/widgets/modern_loading.dart';
import '../../../../core/utils/currency_formatter.dart';
import 'enhanced_client_matrix_page.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../../../core/widgets/smart_sync_header.dart';
import '../../../../core/widgets/error_state_widget.dart';

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
  DateTime? _lastFetchTime;
  
  // Multi-select filters
  Set<int> _selectedYears = {DateTime.now().year};
  Set<int> _selectedMonths = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}; // Full year by default
  int? _touchedIndex; // For manual tooltip control
  String? _selectedStatusFilter; // null=all, 'achieved', 'ontrack', 'atrisk', 'critical'
  
  // Jefe de ventas - Ver objetivos como
  List<Map<String, dynamic>> _vendedoresDisponibles = [];
  String? _selectedVendedor; // null = ver todos los comerciales
  
  // Filters for Client Tab
  List<String> _populations = [];
  String? _selectedPopulation;
  String _clientCodeFilter = '';
  String _nifFilter = '';
  
  late TabController _tabController;
  
  // Spanish format managed centrally
  // final _nf = NumberFormat.decimalPattern('es_ES');
  
  // Helper to format currency with €
  String _formatCurrency(double value) {
    return CurrencyFormatter.formatWhole(value);
  }
  
  static const List<String> _monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  static const List<String> _monthNamesShort = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
  ];

  int _totalClientsCount = 0; // Backend total count (ignoring limit)
  
  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    // Si es jefe de ventas, cargar lista de vendedores
    _loadPopulations();
    _loadPopulations();
    _loadData();
  }
  
  Future<void> _loadPopulations() async {
    try {
      final res = await ObjectivesService.getPopulations();
      setState(() {
        _populations = res;
      });
    } catch (e) {
      debugPrint('Error loading populations: $e');
    }
  }
  
  /// Obtiene el código del vendedor a usar (seleccionado o el propio)
  String get _activeVendedorCode {
    if (!mounted) return widget.employeeCode;
    final filterCode = context.read<FilterProvider>().selectedVendor;
    return filterCode ?? _selectedVendedor ?? widget.employeeCode;
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
      final evolutionRes = await ObjectivesService.getEvolution(
        vendedorCodes: _activeVendedorCode,
        years: _selectedYears.toList(),
      );

      // Load by-client objectives for selected periods
      final clientsRes = await ObjectivesService.getByClient(
        vendedorCodes: _activeVendedorCode,
        years: _selectedYears.toList(),
        months: _selectedMonths.toList(),
        city: _selectedPopulation,
        code: _clientCodeFilter.isNotEmpty ? _clientCodeFilter : null,
        nif: _nifFilter.isNotEmpty ? _nifFilter : null,
        name: _clientSearchQuery.isNotEmpty ? _clientSearchQuery : null,
        limit: 100,
      );
      
      // Parse new backend format: yearlyData
      final rawYearlyData = evolutionRes['yearlyData'] as Map<String, dynamic>? ?? {};
      final rawYearTotals = evolutionRes['yearTotals'] as Map<String, dynamic>? ?? {};
      
      final Map<String, List<Map<String, dynamic>>> parsedYearlyData = {};
      final Map<String, Map<String, dynamic>> parsedYearTotals = {};
      
      // Process yearlyData
      rawYearlyData.forEach((year, monthlyList) {
        parsedYearlyData[year] = (monthlyList as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
      });
      
      // Process yearTotals
      rawYearTotals.forEach((year, totals) {
        parsedYearTotals[year] = Map<String, dynamic>.from(totals as Map);
      });
      
      // Fallback for old format if new format is missing (safety)
      if (parsedYearlyData.isEmpty && evolutionRes['monthlyEvolution'] != null) {
        final monthlyEvolution = (evolutionRes['monthlyEvolution'] as List? ?? []).map((item) => Map<String, dynamic>.from(item as Map)).toList();
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
        final rawClients = clientsRes['clients'] ?? [];
        _clientsObjectives = (rawClients as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        _totalClientsCount = (clientsRes['count'] as num?)?.toInt() ?? _clientsObjectives.length;
        
        // Calculate objectives from parsed data
        _calculateObjectives();
        
        _isLoading = false;
        _lastFetchTime = DateTime.now();
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
    double totalPaceObjective = 0; // New: Objective based on days passed
    int totalWorkingDays = 0; // Track total working days
    int totalDaysPassed = 0; // Track days passed
    
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
            
            // Pacing Logic - FIXED 2.0:
            // Ensure we count proper days for current month
            // Pacing Logic - FIXED 2.0:
            // Ensure we count proper days for current month
            int workingDays = (monthData['workingDays'] as num?)?.toInt() ?? 22;
            int daysPassed = 0;
            
            final now = DateTime.now();
            final isCurrentMonth = year == now.year && monthNum == now.month;
            final isSelectedMonth = _selectedMonths.contains(monthNum);
            
            // SPECIAL FIX FOR 'All Agents' (Jefe de Ventas view)
            // If viewing all agents (no specific filter), calculate standard Mon-Sat working days
            // This avoids issues where aggregated data might have incorrect average days (e.g. 20 vs 24)
            bool isAllAgentsView = widget.isJefeVentas && (_selectedVendedor == null || _selectedVendedor!.isEmpty);
            
            if (isAllAgentsView) {
               // Calculate strict Mon-Sat days for this month
               int totalDaysInMonth = DateTime(year, monthNum + 1, 0).day;
               int monSatDays = 0;
               for (int day = 1; day <= totalDaysInMonth; day++) {
                 final d = DateTime(year, monthNum, day);
                 if (d.weekday != DateTime.sunday) {
                   monSatDays++;
                 }
               }
               workingDays = monSatDays;
               
               // Calculate days passed based on Mon-Sat logic
               if (year < now.year || (year == now.year && monthNum < now.month)) {
                 daysPassed = workingDays;
               } else if (isCurrentMonth && isSelectedMonth) {
                  // Count Mon-Sat days up to today
                  int passedCount = 0;
                  for (int day = 1; day <= now.day; day++) {
                    final d = DateTime(year, monthNum, day);
                    if (d.weekday != DateTime.sunday) {
                      passedCount++;
                    }
                  }
                  daysPassed = passedCount;
               }
            } else {
                // Standard logic for individual agents (trust backend data)
                if (year < now.year || (year == now.year && monthNum < now.month)) {
                  // Past month - use full working days
                  daysPassed = workingDays;
                } else if (isCurrentMonth && isSelectedMonth) {
                  // Current month and selected
                  final backendDays = (monthData['daysPassed'] as num?)?.toInt() ?? 0;
                  daysPassed = backendDays;
                }
            }
            // Future months = 0 daysPassed
            
            double paceObj = 0;
            // Allow daysPassed to be 0 for calculation (paceObj = 0)
            if (workingDays > 0) {
               paceObj = (obj / workingDays) * daysPassed;
            }
            
            totalSales += sales;
            totalObjective += obj;
            // Just sum paceObj directly
            totalPaceObjective += paceObj;
            totalWorkingDays += workingDays;
            totalDaysPassed += daysPassed;
            
            salesPerYear[year] = salesPerYear[year]! + sales;
            objectivePerYear[year] = objectivePerYear[year]! + obj;
          }
        }
      }
    }
    

    // Margin estimated as ~12% of sales (industry standard for distribution)
    double totalMargin = totalSales * 0.12;
    double targetMargin = totalObjective * 0.12;
    
    // Client count logic ...
    Set<String> uniqueClients = {};
    for (final client in _clientsObjectives) {
      final code = client['code']?.toString() ?? '';
      if (code.isNotEmpty) uniqueClients.add(code);
    }
    int actualClients = _totalClientsCount > 0 ? _totalClientsCount : uniqueClients.length;
    int targetClients = 50 * _selectedMonths.length; 
    
    // Consistent Total Objective Logic ...
    double totalAnnualObjective = 0;
    for (final year in _selectedYears) {
      final yearTotals = _yearTotals[year.toString()];
      if (yearTotals != null) {
        totalAnnualObjective += (yearTotals['annualObjective'] as num?)?.toDouble() ?? 0;
      }
    }
    
    double monthlyObjective = totalAnnualObjective > 0 ? totalAnnualObjective / 12 : 0;
    double consistentTarget = (monthlyObjective * _selectedMonths.length);
    
    // Use consistent target ONLY if totalObjective is zero (missing granular data)
    if (totalObjective == 0 && consistentTarget > 0) {
        totalObjective = consistentTarget;
    }
    // ELSE: Keep totalObjective as the sum of selected months (respects seasonality)
    
    // If pace calculation yielded 0 (e.g. historical data where daysPassed might be 0 or full), 
    // we should ensure it makes sense. 
    // Backend `calculateDaysPassed` returns full month days for past months.
    // So for past months, Pace Objective == Full Objective.
    // For current month, Pace Objective < Full Objective.
    // However, if we forced `totalObjective` to be `consistentTarget` above, we might have drifted from sum of months.
    // Let's ratio it:
    // Pacing Ratio = totalPaceObjective_Sum / totalObjective_Sum
    // Final Pace Target = consistentTarget * Ratio
    double paceRatio = (totalObjective > 0) ? (totalPaceObjective / totalObjective) : 0;
    // But `totalPaceObjective` comes from `monthData['objective']` sum, which might differ slightly from `consistentTarget`.
    // Valid approach: use `totalPaceObjective` directly if we trust monthly data, but consistentTarget is usually better for "Annual / 12".
    // Let's stick to accumulating raw pace values since they reflect the precise days.
    
    // Wait, if I replaced totalObjective with consistentTarget, I should probably re-scale Pacing too?
    // Not necessarily, if the difference is small. 
    // Let's trust the accumulation for Pacing as it's granular.
    
    double progress = totalObjective > 0 ? (totalSales / totalObjective) * 100 : 0;
    double paceProgress = totalPaceObjective > 0 ? (totalSales / totalPaceObjective) * 100 : 0;
    
    // ... rest of logic for margin/clients ...
    double marginProgress = targetMargin > 0 ? (totalMargin / targetMargin) * 100 : 0;
    double clientProgress = targetClients > 0 ? (actualClients / targetClients) * 100 : 0;
    
    // ... YTD logic ...
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
        'paceTarget': totalPaceObjective, // Store pace target
        'current': totalSales,
        'progress': progress,
        'paceProgress': paceProgress, // Store pace progress
        'annualObjective': totalAnnualObjective,
        'monthlyObjective': totalAnnualObjective > 0 ? totalAnnualObjective / 12 : 0,
        'yearsCount': _selectedYears.length,
        'monthsCount': _selectedMonths.length,
        'salesPerYear': salesPerYear,
        'objectivePerYear': objectivePerYear,
        // NEW: Days info for clear UI
        // FIXED: Use only current month's data for daily calculations to avoid mixing periods
        'workingDays': totalWorkingDays,
        'daysPassed': totalDaysPassed,
        // dailyTarget = what you need per day to meet your pace target (paceTarget / daysPassed)
        // This makes it consistent: if you sell dailyTarget each day, you'll meet paceTarget
        'dailyTarget': totalDaysPassed > 0 ? totalPaceObjective / totalDaysPassed : 0,
        // dailyActual = what you're actually selling per day
        'dailyActual': totalDaysPassed > 0 ? totalSales / totalDaysPassed : 0,
      },


      // ... same margin/clients ...
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

  // UI Building Sections ...

  // UI Building Sections ...

  // NOTE: _buildSummaryTab moved to line ~1010 to avoid duplication. 
  // Using the one with RefreshIndicator there.

  Widget _buildSalesCard(Map<String, dynamic>? data) {
    if (data == null) return const SizedBox();
    
    final current = (data['current'] as num?)?.toDouble() ?? 0;
    final target = (data['target'] as num?)?.toDouble() ?? 0;
    final progress = (data['progress'] as num?)?.toDouble() ?? 0;
    
    final paceTarget = (data['paceTarget'] as num?)?.toDouble() ?? 0;
    final paceProgress = (data['paceProgress'] as num?)?.toDouble() ?? 0;

    final progressColor = progress >= 100 ? AppTheme.neonGreen : (progress >= 80 ? AppTheme.neonBlue : AppTheme.error);
    final paceColor = paceProgress >= 100 ? Colors.cyanAccent : Colors.orangeAccent;
    
    // Determine if we should show Pace Bar
    final bool isFinished = (paceTarget - target).abs() < 1; 

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.2), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Ventas Totales', style: TextStyle(color: Colors.white70, fontSize: 14)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: progressColor.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text('${progress.toStringAsFixed(1)}%', style: TextStyle(color: progressColor, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(_formatCurrency(current), style: TextStyle(fontSize: Responsive.isSmall(context) ? 22 : 28, fontWeight: FontWeight.bold, color: Colors.white)),
          Text('Objetivo Mensual: ${_formatCurrency(target)}', style: TextStyle(color: Colors.grey, fontSize: Responsive.isSmall(context) ? 11 : 13)),
          
          const SizedBox(height: 16),
          
          // Main Progress Bar
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: target > 0 ? (current / target).clamp(0.0, 1.0) : 0,
              backgroundColor: Colors.white10,
              valueColor: AlwaysStoppedAnimation(progressColor),
              minHeight: 8,
            ),
          ),
          
          // --- PACING SECTION (Always show if Target > 0) ---
          if (target > 0) ...[ 
             const SizedBox(height: 24), // More space
             
             Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                   Row(children: [
                       Icon(Icons.speed, size: 16, color: paceColor),
                       const SizedBox(width: 8),
                       Text(
                           isFinished ? 'Objetivo Cierre (Calculado)' : 'Ritmo Diario (Días trabajados)', 
                           style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)
                       ),
                   ]),
                   if (!isFinished)
                     Text('${paceProgress.toStringAsFixed(1)}%', style: TextStyle(color: paceColor, fontWeight: FontWeight.bold, fontSize: 13)),
                ]
             ),
             const SizedBox(height: 8),
             
             Row(
                 mainAxisAlignment: MainAxisAlignment.spaceBetween,
                 children: [
                     // If finished, just show final diff
                     if (isFinished)
                        Text(
                           current >= target ? 'Objetivo Cumplido' : 'Objetivo No Alcanzado',
                           style: TextStyle(color: current >= target ? AppTheme.neonGreen : AppTheme.error, fontSize: 12)
                        )
                     else
                        Text(
                             paceProgress >= 100 
                                 ? '+${_formatCurrency(current - paceTarget)} sobre ritmo' 
                                 : '-${_formatCurrency(paceTarget - current)} bajo ritmo',
                             style: TextStyle(color: paceColor, fontSize: 12)
                        ),
                     
                     Text('Obj. Pace: ${_formatCurrency(paceTarget)}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                 ]
             ),
             
             const SizedBox(height: 8),
             ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: paceTarget > 0 ? (current / paceTarget).clamp(0.0, 1.0) : 0,
                  backgroundColor: Colors.white10,
                  valueColor: AlwaysStoppedAnimation(paceColor),
                  minHeight: 8,
                ),
              ),
          ]
        ],
      ),
    );
  }

  // FIXED: Properly return a widget for Metric Card
  Widget _buildMetricCard(String title, Map<String, dynamic>? data, IconData icon, Color color, {bool isCurrency = true}) {
    final current = (data?['current'] as num?)?.toDouble() ?? 0;
    final target = (data?['target'] as num?)?.toDouble() ?? 0;
    final progress = (data?['progress'] as num?)?.toDouble() ?? 0;
    
    final progressColor = progress >= 100 ? AppTheme.success : color;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 8),
              Expanded(child: Text(title, style: const TextStyle(color: Colors.white70, fontSize: 12, overflow: TextOverflow.ellipsis))),
            ],
          ),
          const SizedBox(height: 12),
          Text(isCurrency ? _formatCurrency(current) : current.toInt().toString(), 
              style: TextStyle(fontSize: Responsive.isSmall(context) ? 18 : 20, fontWeight: FontWeight.bold, color: Colors.white)),
          const SizedBox(height: 4),
          Text('Obj: ${isCurrency ? _formatCurrency(target) : target.toInt()}', 
              style: TextStyle(color: Colors.grey, fontSize: Responsive.isSmall(context) ? 10 : 11)),
          
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: target > 0 ? (current / target).clamp(0.0, 1.0) : 0,
              backgroundColor: Colors.white10,
              valueColor: AlwaysStoppedAnimation(progressColor),
              minHeight: 6,
            ),
          ),
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerRight,
            child: Text('${progress.toStringAsFixed(1)}%', 
                style: TextStyle(color: progressColor, fontSize: 11, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  // FIXED: This is the void method for showing the filter modal
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
                  children: ApiConfig.availableYears.map((y) => FilterChip(
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
    return GlobalVendorSelector(
      isJefeVentas: widget.isJefeVentas,
      onChanged: _loadData, // Reload data when filter changes
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
        
        // SmartSyncHeader - igual que en Clientes
        SmartSyncHeader(
          title: 'Estado de Objetivos',
          subtitle: _periodLabel.isNotEmpty ? _periodLabel : 'Resumen de Ventas',
          lastSync: _lastFetchTime,
          isLoading: _isLoading,
          onSync: _loadData,
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
              ? const Padding(
                  padding: EdgeInsets.all(40.0),
                  child: ModernLoading(message: 'Calculando objetivos...'),
                )
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
    return ErrorStateWidget(
      message: 'Error: $_error',
      onRetry: _loadData,
    );
  }

  Widget _buildClientFilters() {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
      color: AppTheme.darkBase,
      child: Column(
        children: [
          // Row 1: Search + Advanced Toggle
          Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: 40,
                  child: TextField(
                    decoration: InputDecoration(
                      hintText: 'Buscar (Enter para buscar en servidor)...',
                      prefixIcon: const Icon(Icons.search, size: 18),
                      filled: true,
                      fillColor: AppTheme.surfaceColor,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    style: const TextStyle(fontSize: 13),
                    textInputAction: TextInputAction.search,
                    onChanged: (val) {
                       setState(() => _clientSearchQuery = val);
                       // Optional: Debounce here if we want auto-search
                    },
                    onSubmitted: (_) => _loadData(),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                decoration: BoxDecoration(
                  color: AppTheme.surfaceColor,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: (_selectedPopulation != null || _clientCodeFilter.isNotEmpty || _nifFilter.isNotEmpty) 
                      ? AppTheme.neonPurple 
                      : Colors.transparent),
                ),
                child: IconButton(
                  icon: const Icon(Icons.filter_list),
                  color: (_selectedPopulation != null || _clientCodeFilter.isNotEmpty || _nifFilter.isNotEmpty) 
                      ? AppTheme.neonPurple 
                      : AppTheme.textSecondary,
                  onPressed: () {
                     // Toggle visibility or show modal? 
                     // Using ExpansionTile below is cleaner for inline.
                     // But we can't programmatically open ExpansionTile easily without key.
                     // Let's just use the ExpansionTile itself as the container.
                  },
                  tooltip: 'Filtros Avanzados',
                ),
              ),
            ],
          ),
          
          // Row 2: Advanced Filters (Expansion Tile)
          Theme(
            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              title: Text(
                (_selectedPopulation != null || _clientCodeFilter.isNotEmpty || _nifFilter.isNotEmpty)
                  ? 'Filtros Activos: ${[
                      _selectedPopulation, 
                      _clientCodeFilter.isNotEmpty ? "Cod: $_clientCodeFilter" : null,
                      _nifFilter.isNotEmpty ? "NIF: $_nifFilter" : null
                    ].where((e) => e != null).join(", ")}'
                  : 'Filtros Avanzados',
                style: TextStyle(
                  fontSize: 12, 
                  color: (_selectedPopulation != null || _clientCodeFilter.isNotEmpty || _nifFilter.isNotEmpty) 
                      ? AppTheme.neonPurple 
                      : AppTheme.textSecondary
                ),
              ),
              iconColor: AppTheme.neonPurple,
              collapsedIconColor: AppTheme.textSecondary,
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceColor,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    children: [
                      // Population Dropdown
                      DropdownButtonFormField<String>(
                        decoration: const InputDecoration(
                          labelText: 'Población',
                          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          isDense: true,
                        ),
                        isExpanded: true,
                        value: _selectedPopulation,
                        items: [
                          const DropdownMenuItem<String>(
                            value: null,
                            child: Text('Todas las poblaciones'),
                          ),
                          ..._populations.map((p) => DropdownMenuItem<String>(
                            value: p,
                            child: Text(p, overflow: TextOverflow.ellipsis),
                          )),
                        ],
                        onChanged: (val) => setState(() => _selectedPopulation = val),
                      ),
                      const SizedBox(height: 12),
                      
                      // Sort Dropdown (New)
                      DropdownButtonFormField<String>(
                        decoration: const InputDecoration(
                          labelText: 'Ordenar por',
                          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          isDense: true,
                          prefixIcon: Icon(Icons.sort, size: 18),
                        ),
                        value: _currentSort,
                        items: const [
                          DropdownMenuItem(value: 'objective_desc', child: Text('Mayor Objetivo')),
                          DropdownMenuItem(value: 'sales_desc', child: Text('Mayor Recaudado')),
                        ],
                        onChanged: (val) {
                          if (val != null) setState(() => _currentSort = val);
                        },
                      ),
                      const SizedBox(height: 12),
                      const SizedBox(height: 12),
                      
                      // Code & NIF Row
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              decoration: const InputDecoration(
                                labelText: 'Código Cliente',
                                isDense: true,
                              ),
                              onChanged: (val) => setState(() => _clientCodeFilter = val),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: TextField(
                              decoration: const InputDecoration(
                                labelText: 'NIF',
                                isDense: true,
                              ),
                              onChanged: (val) => setState(() => _nifFilter = val),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      
                      // Action Buttons
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () {
                                setState(() {
                                  _selectedPopulation = null;
                                  _clientCodeFilter = '';
                                  _nifFilter = '';
                                  _clientSearchQuery = ''; // Also clear search? Maybe not.
                                });
                                _loadData();
                              },
                              child: const Text('Limpiar'),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: ElevatedButton(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppTheme.neonPurple,
                                foregroundColor: Colors.white,
                              ),
                              onPressed: () {
                                // Close expansion tile? (Hard to do without key controller)
                                // Just load data
                                _loadData();
                              },
                              child: const Text('Aplicar Filtros'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
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
            if (!Responsive.isLandscapeCompact(context)) _buildYTDBanner(), // YTD accumulated progress
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
    
    // FIX: Only show YTD banner if strictly more than 1 month is selected
    // User expectation: Single month view should focus on that month's specific data, not "Acumulado"
    if (_selectedMonths.length <= 1) return const SizedBox.shrink();
    
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
                // Dynamic label based on selection
                Text('Acumulado $year (${_selectedMonths.length} meses)',
                    style: TextStyle(fontSize: Responsive.isSmall(context) ? 10 : 11, fontWeight: FontWeight.w500)),
                Text('${_formatCurrency(ytdSales)} de ${_formatCurrency(ytdObjective)}',
                    style: TextStyle(fontSize: Responsive.isSmall(context) ? 9 : 10, color: AppTheme.textSecondary)),
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
    final sortedYears = _selectedYears.toList()..sort((a, b) => b.compareTo(a)); // Descending sort
    
    return sortedYears.map((year) {
      final yearSales = salesPerYear[year] ?? 0;
      final yearObj = objPerYear[year] ?? 0;
      
      return Container(
        margin: const EdgeInsets.symmetric(horizontal: 0, vertical: 6),
        decoration: BoxDecoration(
          color: AppTheme.neonPurple.withOpacity(0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
        ),
        child: Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
            childrenPadding: const EdgeInsets.only(bottom: 10),
            minTileHeight: 40,
            iconColor: AppTheme.neonPurple,
            collapsedIconColor: AppTheme.neonPurple,
            title: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Objetivo $year', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white)),
                Text(_formatCurrency(yearObj), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.neonPurple)),
              ],
            ),
            subtitle: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Venta Actual', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                Text(_formatCurrency(yearSales), style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
            children: [
              Container(
                height: 1, 
                color: AppTheme.neonPurple.withOpacity(0.2), 
                margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 5)
              ),
              // List monthly objectives
              ...List.generate(12, (index) {
                  final m = index + 1;
                  final yearData = _yearlyData[year.toString()] ?? [];
                  final monthData = yearData.firstWhere((e) => e['month'] == m, orElse: () => {});
                  final obj = (monthData['objective'] as num?)?.toDouble() ?? 0;
                  final sales = (monthData['sales'] as num?)?.toDouble() ?? 0;
                  
                  // Check if month is passed or current (to show status color)
                  final now = DateTime.now();
                  final isPastOrCurrent = (year < now.year) || (year == now.year && m <= now.month);
                  final isAchieved = sales >= obj;
                  // If sales are 0 and objective is 0, it's neutral/achieved? 
                  // If objective > 0 and sales 0 => Failed (Error)
                  final color = !isPastOrCurrent ? Colors.white : (isAchieved ? AppTheme.success : AppTheme.error);

                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 30, 
                          child: Text(_monthNamesShort[index], style: TextStyle(fontSize: 11, color: AppTheme.textSecondary))
                        ),
                        Expanded(
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              // Sales (Actual)
                              if (sales > 0 || isPastOrCurrent)
                                Text(
                                  _formatCurrency(sales), 
                                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: color)
                                )
                              else 
                                const Text('-', style: TextStyle(fontSize: 11, color: Colors.grey)),
                                
                              const Padding(
                                padding: EdgeInsets.symmetric(horizontal: 4),
                                child: Text('/', style: TextStyle(fontSize: 10, color: Colors.grey)),
                              ),
                              
                              // Target
                              Text(
                                _formatCurrency(obj), 
                                style: const TextStyle(fontSize: 11, color: Colors.white70)
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        // Icon status
                        if (isPastOrCurrent)
                          Icon(
                            isAchieved ? Icons.check_circle : Icons.cancel,
                            size: 12,
                            color: color,
                          )
                        else
                          const Icon(Icons.circle_outlined, size: 12, color: Colors.grey),
                      ],
                    ),
                  );
              }),
            ],
          ),
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
                  margin: const EdgeInsets.symmetric(horizontal: 0),
                  decoration: BoxDecoration(
                    color: AppTheme.neonPurple.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
                  ),
                  child: Theme(
                    data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                    child: ExpansionTile(
                      tilePadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
                      childrenPadding: const EdgeInsets.only(bottom: 10),
                      minTileHeight: 40,
                      iconColor: AppTheme.neonPurple,
                      collapsedIconColor: AppTheme.neonPurple,
                      title: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Objetivo ${_selectedYears.first}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white)),
                          Text(_formatCurrency(annualObj), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.neonPurple)),
                        ],
                      ),
                      children: [
                        Container(
                          height: 1, 
                          color: AppTheme.neonPurple.withOpacity(0.2), 
                          margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 5)
                        ),
                        // List monthly objectives
                        ...List.generate(12, (index) {
                            final m = index + 1;
                            final yearData = _yearlyData[_selectedYears.first.toString()] ?? [];
                            final monthData = yearData.firstWhere((e) => e['month'] == m, orElse: () => {});
                            final obj = (monthData['objective'] as num?)?.toDouble() ?? 0;
                            final sales = (monthData['sales'] as num?)?.toDouble() ?? 0;
                            
                            // Check if month is passed or current (to show status color)
                            final now = DateTime.now();
                            final isPastOrCurrent = (_selectedYears.first < now.year) || (_selectedYears.first == now.year && m <= now.month);
                            final isAchieved = sales >= obj;
                            final color = !isPastOrCurrent ? Colors.white : (isAchieved ? AppTheme.success : AppTheme.error);

                            return Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6), // More padding
                              child: Row(
                                children: [
                                  SizedBox(
                                    width: 30, 
                                    child: Text(_monthNamesShort[index], style: TextStyle(fontSize: 11, color: AppTheme.textSecondary))
                                  ),
                                  Expanded(
                                    child: Row(
                                      mainAxisAlignment: MainAxisAlignment.end,
                                      children: [
                                        // Sales (Actual)
                                        if (sales > 0 || isPastOrCurrent)
                                          Text(
                                            _formatCurrency(sales), 
                                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: color)
                                          )
                                        else 
                                          const Text('-', style: TextStyle(fontSize: 11, color: Colors.grey)),
                                          
                                        const Padding(
                                          padding: EdgeInsets.symmetric(horizontal: 4),
                                          child: Text('/', style: TextStyle(fontSize: 10, color: Colors.grey)),
                                        ),
                                        
                                        // Target
                                        Text(
                                          _formatCurrency(obj), 
                                          style: const TextStyle(fontSize: 11, color: Colors.white70)
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  // Icon status
                                  if (isPastOrCurrent)
                                    Icon(
                                      isAchieved ? Icons.check_circle : Icons.cancel,
                                      size: 12,
                                      color: color,
                                    )
                                  else
                                    const Icon(Icons.circle_outlined, size: 12, color: Colors.grey),
                                ],
                              ),
                            );
                        }),
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 6),
              
              // Monthly average removed to avoid confusion with weighted seasonal objectives
              /* 
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Objetivo mensual (anual ÷ 12)', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
                  Text(_formatCurrency(monthlyObj), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w500)),
                ],
              ),
              const SizedBox(height: 4),
              */
              
              // FIX: Period objective label hidden as per user request
              // Kept commented for potential future use
              /*
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
              */
              const SizedBox(height: 10),
              
              // Current sales - big display
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('VENDIDO', style: TextStyle(fontSize: Responsive.isSmall(context) ? 8 : 9, color: AppTheme.textSecondary)),
                      Text(_formatCurrency(current), style: TextStyle(fontSize: Responsive.isSmall(context) ? 18 : 22, fontWeight: FontWeight.bold, color: progressColor)),
                    ],
                  ),
                  const Spacer(),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text('${progress.toStringAsFixed(1)}%', style: TextStyle(fontSize: Responsive.isSmall(context) ? 15 : 18, fontWeight: FontWeight.bold, color: progressColor)),
                      Text('cumplido', style: TextStyle(fontSize: Responsive.isSmall(context) ? 8 : 9, color: AppTheme.textSecondary)),
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
              
              // ============ RITMO DIARIO (Daily Pace) - CLEAR VERSION ============
              Builder(builder: (context) {
                final paceTarget = (sales['paceTarget'] as num?)?.toDouble() ?? 0;
                final paceProgress = (sales['paceProgress'] as num?)?.toDouble() ?? 0;
                final workingDays = (sales['workingDays'] as num?)?.toInt() ?? 0;
                final daysPassed = (sales['daysPassed'] as num?)?.toInt() ?? 0;
                final dailyTarget = (sales['dailyTarget'] as num?)?.toDouble() ?? 0;
                final dailyActual = (sales['dailyActual'] as num?)?.toDouble() ?? 0;
                
                // Period is "finished" if all days have passed
                final isFinished = daysPassed >= workingDays && workingDays > 0;
                final isOnTrack = dailyActual >= dailyTarget;
                // Green when on track, orange when behind - clear visual feedback
                final paceColor = isOnTrack ? AppTheme.success : Colors.orangeAccent;
                
                // Only show if there's a meaningful pace calculation context (working days exist)
                // FIX: Do NOT hide if daysPassed is 0. Only hide if workingDays is 0 (invalid data).
                // We want to see "Ritmo Diario" even on day 1 of the month.
                if (workingDays <= 0) return const SizedBox.shrink();
                
                return Container(
                  margin: const EdgeInsets.only(top: 16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: paceColor.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: paceColor.withOpacity(0.3)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header with icon and title
                      Row(
                        children: [
                          Icon(Icons.speed, size: 18, color: paceColor),
                          const SizedBox(width: 8),
                          Text(
                            isFinished ? 'Resultado del Periodo' : 'Ritmo Diario',
                            style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: paceColor),
                          ),
                          const Spacer(),
                          // Days badge
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: Colors.white10,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              '$daysPassed / $workingDays días',
                              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white),
                            ),
                          ),
                        ],
                      ),
                      
                      const SizedBox(height: 12),
                      
                      // Two column comparison: Required vs Actual
                      Row(
                        children: [
                          // Required daily
                          Expanded(
                            child: Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.05),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: const [
                                      Icon(Icons.assignment_outlined, size: 12, color: Colors.white70),
                                      SizedBox(width: 4),
                                      Text('Necesitas/día', style: TextStyle(fontSize: 9, color: Colors.white70)),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    _formatCurrency(dailyTarget),
                                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          // Actual daily
                          Expanded(
                            child: Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: paceColor.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: paceColor.withOpacity(0.5)),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Icon(isOnTrack ? Icons.check_circle_outline : Icons.warning_amber_outlined, size: 12, color: paceColor),
                                      const SizedBox(width: 4),
                                      Text('Vendes/día', style: TextStyle(fontSize: 9, color: paceColor)),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    _formatCurrency(dailyActual),
                                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: paceColor),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                      
                      const SizedBox(height: 10),
                      
                      // Clear status message
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 10),
                        decoration: BoxDecoration(
                          color: paceColor.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              isOnTrack ? Icons.trending_up : Icons.trending_down,
                              size: 14,
                              color: paceColor,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              isFinished
                                  ? (current >= periodTarget 
                                      ? '¡Objetivo cumplido!' 
                                      : 'Objetivo no alcanzado')
                                  : (isOnTrack
                                      ? 'Vas ${((dailyActual / dailyTarget - 1) * 100).toStringAsFixed(2)}% por ENCIMA del ritmo'
                                      : 'Vas ${((1 - dailyActual / dailyTarget) * 100).toStringAsFixed(2)}% por DEBAJO del ritmo'),
                              style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: paceColor),
                            ),
                          ],
                        ),
                      ),
                      
                      const SizedBox(height: 8),
                      
                      // Progress bar (pace)
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: paceTarget > 0 ? (current / paceTarget).clamp(0.0, 1.5) : 0,
                          backgroundColor: Colors.white10,
                          valueColor: AlwaysStoppedAnimation(paceColor),
                          minHeight: 6,
                        ),
                      ),
                      
                      const SizedBox(height: 4),
                      
                      // Bottom explanation
                      Text(
                        isFinished
                            ? 'Vendido: ${_formatCurrency(current)} de ${_formatCurrency(periodTarget)}'
                            : 'A día de hoy deberías llevar ${_formatCurrency(paceTarget)} y llevas ${_formatCurrency(current)}',
                        style: const TextStyle(fontSize: 9, color: Colors.white54),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                );
              }),

              
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
                  // format: _nf, // REMOVED
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
    
    // Calculate max Y across all data (considering only selected months)
    // Also consider proportional objective for current month
    final now = DateTime.now();
    double maxY = 0;
    for (final year in sortedYears) {
      final data = _yearlyData[year.toString()] ?? [];
      for (final m in data) {
        if (!sortedMonths.contains(m['month'])) continue; // Only check selected months
        final sales = (m['sales'] as num?)?.toDouble() ?? 0;
        final obj = (m['objective'] as num?)?.toDouble() ?? 0;
        final workingDays = (m['workingDays'] as num?)?.toInt() ?? 0;
        final daysPassed = (m['daysPassed'] as num?)?.toInt() ?? 0;
        
        // For current month, use proportional objective
        double displayObj = obj;
        final isCurrentMonth = year == now.year && m['month'] == now.month;
        // FIX: For current month, ALWAYS use proportional logic to match chart
        if (isCurrentMonth && workingDays > 0) {
          displayObj = (obj / workingDays) * daysPassed;
        } else if (isCurrentMonth && workingDays <= 0) {
          displayObj = 0;
        }
        
        if (sales > maxY) maxY = sales;
        if (displayObj > maxY) maxY = displayObj;
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
      
      // 2. Objective Line (Now Weighted/Seasonal)
      // For current month: show proportional objective (paceTarget) based on days passed
      // For past months: show full objective (all days passed)
      // Note: 'now' is already defined above
      final objSpots = sortedMonths.map((m) {

        final monthData = data.firstWhere((e) => e['month'] == m, orElse: () => {});
        final weightedObj = (monthData['objective'] as num?)?.toDouble() ?? 0;
        final workingDays = (monthData['workingDays'] as num?)?.toInt() ?? 0;
        final daysPassed = (monthData['daysPassed'] as num?)?.toInt() ?? 0;
        
        // Check if this is the current month and year
        final isCurrentMonth = year == now.year && m == now.month;
        
        // For current month, show proportional objective based on days worked
        // For past months, show full objective (daysPassed == workingDays)
        double displayObj = weightedObj;
        
        // FIX: For current month, ALWAYS use proportional, even if daysPassed is 0
        if (isCurrentMonth && workingDays > 0) {
           displayObj = (weightedObj / workingDays) * daysPassed;
        } else if (isCurrentMonth && workingDays <= 0) {
           // Fallback if no working days defined for current month
           displayObj = 0; 
        }
        
        return FlSpot((m - 1).toDouble(), displayObj);
      }).toList();
      
      if (objSpots.isNotEmpty) {
        lineBarsData.add(LineChartBarData(
          spots: objSpots,
          isCurved: true, // Curve it slightly to look natural
          curveSmoothness: 0.35,
          color: color.withOpacity(0.8), 
          barWidth: 2,
          dotData: const FlDotData(show: false),
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
                      reservedSize: 80, // Increased from 50 to prevent "200.000 €" wrapping
                      interval: baseInterval,
                      getTitlesWidget: (value, meta) {
                        if (value % 1 == 0) {
                            return Text(
                              CurrencyFormatter.format((value.round()).toDouble()), 
                              style: TextStyle(color: AppTheme.textSecondary, fontSize: 10), // Increased font slightly
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
                               text: CurrencyFormatter.format(spot.y),
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
  String _currentSort = 'objective_desc'; // Default sort

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

    // Sort Logic
    filteredClients.sort((a, b) {
      final double objA = (a['objective'] as num?)?.toDouble() ?? 0;
      final double objB = (b['objective'] as num?)?.toDouble() ?? 0;
      final double salesA = (a['current'] as num?)?.toDouble() ?? 0;
      final double salesB = (b['current'] as num?)?.toDouble() ?? 0;
      
      switch (_currentSort) {
        case 'sales_desc':
          return salesB.compareTo(salesA); // Mayor recaudado b - a
        case 'objective_desc':
        default:
          return objB.compareTo(objA); // Mayor objetivo b - a
      }
    });

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
        _buildClientFilters(),
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
            '${filteredClients.length} mostrados (Total: $_totalClientsCount)',
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
                // cf: _nf, // REMOVED
                showMargin: widget.isJefeVentas, // Pass permission checks
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => EnhancedClientMatrixPage(
                      clientCode: (client['code'] as String?) ?? '',
                      clientName: (client['name'] as String?) ?? 'Cliente',
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
  // final NumberFormat? format; // REMOVED
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
    // this.format, // REMOVED
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
      return CurrencyFormatter.formatWhole(value);
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
          
          Text(formatValue(current), style: TextStyle(fontSize: compact ? (Responsive.isSmall(context) ? 16 : 18) : 24, fontWeight: FontWeight.bold)),
          
          const SizedBox(height: 2),
          Text('Objetivo: ${formatValue(target)}', style: TextStyle(fontSize: compact ? (Responsive.isSmall(context) ? 8 : 9) : 10, color: AppTheme.textSecondary)),
          
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
  // final NumberFormat cf; // REMOVED
  final VoidCallback onTap;
  final bool showMargin; // New field

  const _ClientCard({
    required this.client, 
    // required this.cf, // REMOVED 
    required this.onTap,
    this.showMargin = false, // Default false
  });

  String _formatCurrency(double value) {
    return CurrencyFormatter.formatWhole(value);
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
