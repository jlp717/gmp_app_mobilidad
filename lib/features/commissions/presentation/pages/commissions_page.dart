import 'dart:ui';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/modern_loading.dart';
import '../../../../core/widgets/smart_sync_header.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../data/commissions_service.dart';
import 'package:provider/provider.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../../../features/rutero/presentation/pages/rutero_page.dart'; // Deep link to sibling feature

class CommissionsPage extends StatefulWidget {
  final String employeeCode;
  final bool isJefeVentas;

  const CommissionsPage({super.key, required this.employeeCode, this.isJefeVentas = false});

  @override
  State<CommissionsPage> createState() => _CommissionsPageState();
}

class _CommissionsPageState extends State<CommissionsPage> {
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic>? _data;
  DateTime? _lastFetchTime;
  
  // Filters
  List<int> _selectedYears = [DateTime.now().year]; // Default current
  List<int> _selectedMonths = []; // Empty = All

  @override
  void initState() {
    super.initState();
    _loadDataWithYear();
  }

  Future<void> _loadDataWithYear() async {
      setState(() { _isLoading = true; _error = null; });
      try {
        final defaultCode = widget.employeeCode.split(',').first;
        String? filterCode;
        if (mounted) {
          filterCode = context.read<FilterProvider>().selectedVendor;
        }
        final code = filterCode ?? defaultCode;

        // Verify we have years
        if (_selectedYears.isEmpty) _selectedYears = [DateTime.now().year];

        // Pass years as comma separated string or relies on service handling list?
        // Service expects 'year' as dynamic or int. 
        // We will modify the Service call to pass string "2024,2025" or similar logic.
        // Assuming CommissionsService.getSummary accepts dynamic year.
        final yearParam = _selectedYears.join(',');
        
        final res = await CommissionsService.getSummary(vendedorCode: code, year: yearParam);
        
        setState(() {
          _data = res;
          _isLoading = false;
          _lastFetchTime = DateTime.now();
        });
      } catch (e) {
        if (mounted) setState(() { _error = e.toString(); _isLoading = false; });
      }
  }
  
  // ... (Keep existing _showExplanationModal)

  void _showMonthPicker() async {
     // ... (Keep existing)
    final selected = Set<int>.from(_selectedMonths);
    await showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return AlertDialog(
              backgroundColor: AppTheme.surfaceColor,
              title: const Text('Seleccionar Meses', style: TextStyle(color: Colors.white)),
              content: SizedBox(
                width: double.maxFinite,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ListTile(
                        title: const Text("Seleccionar Todo", style: TextStyle(color: AppTheme.neonBlue, fontWeight: FontWeight.bold)),
                        onTap: () {
                          setModalState(() {
                             selected.clear();
                             // Logic: If user clicks 'Select All' usually means 'All' (empty list in logic) or actually all 12.
                             // But my logic says Empty = All. So clearing is "All".
                             // But UI should show all checked if all selected? 
                             // Let's stick to: Empty = All. But here we select specific months.
                             // If "All" text, clear set.
                          });
                        },
                        trailing: Icon(selected.isEmpty ? Icons.check_box : Icons.check_box_outline_blank, color: AppTheme.neonBlue),
                      ),
                      const Divider(color: Colors.white24),
                      ...List.generate(12, (index) {
                        final m = index + 1;
                        final isSelected = selected.contains(m);
                        return CheckboxListTile( // ...
                           title: Text(_getMonthName(m), style: const TextStyle(color: Colors.white)),
                           value: isSelected,
                           activeColor: AppTheme.neonBlue,
                           checkColor: Colors.black,
                           onChanged: (val) {
                             setModalState(() {
                               if (val == true) selected.add(m); else selected.remove(m);
                             });
                           }
                        );
                      }),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(onPressed: ()=>Navigator.pop(ctx), child: const Text("Cancelar", style: TextStyle(color:Colors.grey))),
                TextButton(
                  onPressed: () {
                     setState(() {
                       _selectedMonths = selected.toList()..sort();
                     });
                     Navigator.pop(ctx);
                     _loadDataWithYear(); // Refresh data with new filters (local filtering mostly but good to sync)
                  },
                  child: const Text('Aplicar', style: TextStyle(color: AppTheme.neonBlue, fontWeight: FontWeight.bold)),
                ),
              ]
            );
          });
      }
    );
  }

  void _showYearPicker() async {
    final selected = Set<int>.from(_selectedYears);
    final availableYears = [2024, 2025, 2026, 2027];
    
    await showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return AlertDialog(
              backgroundColor: AppTheme.surfaceColor,
              title: const Text('Seleccionar Años', style: TextStyle(color: Colors.white)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: availableYears.map((y) {
                    final isSelected = selected.contains(y);
                    return CheckboxListTile(
                      title: Text(y.toString(), style: const TextStyle(color: Colors.white)),
                      value: isSelected,
                      activeColor: AppTheme.neonBlue,
                      checkColor: Colors.black,
                      onChanged: (val) {
                        setModalState(() {
                           if (val == true) selected.add(y); else selected.remove(y);
                        });
                      },
                    );
                }).toList(),
              ),
              actions: [
                 TextButton(onPressed: ()=>Navigator.pop(ctx), child: const Text("Cancelar", style: TextStyle(color:Colors.grey))),
                 TextButton(
                   onPressed: () {
                      if (selected.isEmpty) selected.add(DateTime.now().year); // Enforce at least one
                      setState(() {
                        _selectedYears = selected.toList()..sort();
                      });
                      Navigator.pop(ctx);
                      _loadDataWithYear();
                   },
                   child: const Text("Aplicar", style: TextStyle(color: AppTheme.neonBlue, fontWeight: FontWeight.bold))
                 )
              ],
            );
          }
        );
      }
    );
  }

  @override
  Widget build(BuildContext context) {
    // ... (Keep restriction check)
    final restrictedCodes = ['80', '13'];
    final isRestricted = !widget.isJefeVentas && 
                         restrictedCodes.any((c) => widget.employeeCode == c || widget.employeeCode.split(',').contains(c));
    if (isRestricted) return const Center(child: Text("Sección no disponible", style: TextStyle(color: Colors.white70)));

    final isAllMode = (context.watch<FilterProvider>().selectedVendor == 'ALL') || 
                      (widget.isJefeVentas && (context.watch<FilterProvider>().selectedVendor == '' || context.watch<FilterProvider>().selectedVendor == null));
                      
    final breakdown = (_data?['breakdown'] as List?) ?? [];
    final showSuperTable = isAllMode && breakdown.isNotEmpty;

    final months = _data?['months'] as List? ?? [];
    final quarters = _data?['quarters'] as List? ?? [];
    final status = _data?['status'] as String? ?? 'active';
    final isInformative = status == 'informative';
    // Grand totals depend on backend sum now
    final grandTotal = (_data?['grandTotalCommission'] as num?)?.toDouble() ?? 
                       (_data?['totals']?['commission'] as num?)?.toDouble() ?? 0;

    // Filter Logic in Frontend for Display (Backend already aggregated years, here we agg months)
    List<dynamic> filteredMonths = months;
    if (_selectedMonths.isNotEmpty) {
      filteredMonths = months.where((m) => _selectedMonths.contains(m['month'])).toList();
    }
    filteredMonths.sort((a, b) => (a['month'] as int).compareTo(b['month'] as int));

    // Calculate Summary Metrics
    double totalSales = 0;
    double totalTarget = 0;
    double totalCommission = 0;
    
    // NOTE: If Multi-Year, 'months' array from backend contains summed data for Month 1, Month 2... across years.
    // So summing them up here gives Global Total.
    if (_selectedMonths.isNotEmpty) {
       for(var m in filteredMonths) {
           totalSales += (m['actual'] as num?)?.toDouble() ?? 0;
           totalTarget += (m['target'] as num?)?.toDouble() ?? 0;
           final ctx = m['complianceCtx'] ?? {};
           totalCommission += (ctx['commission'] as num?)?.toDouble() ?? 0;
       }
    } else {
       // Full Period
       if (quarters.isNotEmpty) {
           for(var q in quarters) {
               totalSales += (q['actual'] as num?)?.toDouble() ?? 0;
               totalTarget += (q['target'] as num?)?.toDouble() ?? 0;
           }
           totalCommission = grandTotal;
       } else {
           // Fallback to months sum if quarters empty
           for(var m in months) {
               totalSales += (m['actual'] as num?)?.toDouble() ?? 0;
               totalTarget += (m['target'] as num?)?.toDouble() ?? 0;
           }
           totalCommission = grandTotal;
       }
    }
    
    final totalPct = totalTarget > 0 ? (totalSales / totalTarget) * 100 : 0.0;
    final isPositive = totalSales >= totalTarget;

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
           SmartSyncHeader(
             title: 'Comisiones',
             subtitle: 'Seguimiento y Objetivos',
             lastSync: _lastFetchTime,
             isLoading: _isLoading,
             onSync: _loadDataWithYear,
           ),
           
           Container(
             padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
             color: AppTheme.surfaceColor,
             child: Column(
               children: [
                 if (widget.isJefeVentas) 
                   Padding(
                     padding: const EdgeInsets.only(bottom: 12.0),
                     child: GlobalVendorSelector(isJefeVentas: true, onChanged: _loadDataWithYear),
                   ),

                 Row(
                   crossAxisAlignment: CrossAxisAlignment.center, 
                   children: [
                     // LEFT: Compact Selectors
                     Column(
                         crossAxisAlignment: CrossAxisAlignment.start,
                         children: [
                             // Years
                             InkWell(
                                 onTap: _showYearPicker,
                                 child: Container(
                                     width: 100, height: 32,
                                     padding: const EdgeInsets.symmetric(horizontal: 8),
                                     margin: const EdgeInsets.only(bottom: 6),
                                     decoration: BoxDecoration(color: Colors.white.withOpacity(0.05), border: Border.all(color: Colors.white24), borderRadius: BorderRadius.circular(6)),
                                     child: Row(
                                         mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                         children: [
                                             Flexible(child: Text(_selectedYears.length > 1 ? "${_selectedYears.length} Años" : _selectedYears.first.toString(), style: const TextStyle(fontSize: 12, color: Colors.white), overflow: TextOverflow.ellipsis)),
                                             const Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue, size: 16)
                                         ]
                                     )
                                 )
                             ),
                             // Months
                             InkWell(
                                 onTap: _showMonthPicker,
                                 child: Container(
                                     width: 100, height: 32,
                                     padding: const EdgeInsets.symmetric(horizontal: 8),
                                     decoration: BoxDecoration(color: Colors.white.withOpacity(0.05), border: Border.all(color: Colors.white24), borderRadius: BorderRadius.circular(6)),
                                     child: Row(
                                         mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                         children: [
                                             Flexible(child: Text(_selectedMonths.isEmpty ? "Todo el Año" : (_selectedMonths.length==1 ? _getMonthName(_selectedMonths.first) : "${_selectedMonths.length} Meses"), style: const TextStyle(fontSize: 12, color: Colors.white), overflow: TextOverflow.ellipsis)),
                                             const Icon(Icons.calendar_month, color: AppTheme.neonBlue, size: 16)
                                         ]
                                     )
                                 )
                             ),
                         ]
                     ),
                     
                     const SizedBox(width: 16),
                     
                     // RIGHT: Classic "Tags" (Middle)
                     Expanded(
                        child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceEvenly, // "Middle" look
                            children: [
                                _buildMiddleTag("OBJETIVO", CurrencyFormatter.format(totalTarget), Colors.white54),
                                _buildMiddleTag("VENTA", CurrencyFormatter.format(totalSales), isPositive ? AppTheme.success : Colors.white),
                                _buildMiddleTag("COMISIÓN", CurrencyFormatter.format(totalCommission), AppTheme.neonGreen, isBold: true),
                            ]
                        )
                     )
                   ],
                 ),
               ],
             ),
           ),
           
           Expanded(
             child: _isLoading ? const Center(child: ModernLoading(message: 'Calculando...')) 
             : _error != null ? Center(child: Text('Error: $_error', style: const TextStyle(color: AppTheme.error)))
             : showSuperTable
                ? _buildSuperTable(breakdown) 
                : _buildNormalView(filteredMonths, quarters, isInformative), 
           ),
        ],
      )
    );
  }

  // Restored Design Tag
  Widget _buildMiddleTag(String label, String value, Color color, {bool isBold = false}) {
     return Column(
         mainAxisSize: MainAxisSize.min,
         children: [
             Text(label, style: const TextStyle(fontSize: 10, color: Colors.white54, fontWeight: FontWeight.w600)),
             const SizedBox(height: 2),
             Text(value, style: TextStyle(fontSize: 15, color: color, fontWeight: isBold ? FontWeight.w900 : FontWeight.bold))
         ]
     );
  } 
  
  // Refactored existing Normal View
  Widget _buildNormalView(List<dynamic> months, List<dynamic> quarters, bool isInformative) {
    if (months.isEmpty && quarters.isEmpty) {
         return const Center(
             child: Column(mainAxisSize: MainAxisSize.min, children: [
                 Icon(Icons.search_off, size: 48, color: Colors.white24),
                 SizedBox(height: 16),
                 Text("No hay datos para la selección", style: TextStyle(color: Colors.white54))
             ])
         );
    }
    
    // Prepare table rows
    final rows = <DataRow>[];
    
    // Helper to add month row
    void addMonthRow(Map<String, dynamic> m) {
       rows.add(_createMonthRow(m, isInformative));
    }
    
    // Helper to add Quarter
    void addQuarterRow(Map<String, dynamic> q, int idx) {
        if (_selectedMonths.isNotEmpty) return; // Hide quarters if filtering by month
        rows.add(_createQuarterRow(q, idx));
    }

    // Build Sequence
    if (_selectedMonths.isNotEmpty) {
       months.forEach((m) => addMonthRow(m as Map<String, dynamic>));
    } else {
        // Standard Interleaved view
        final q1Months = months.where((m) => (m['month'] as int) <= 4).toList();
        for (var m in q1Months) addMonthRow(m as Map<String, dynamic>);
        if (q1Months.isNotEmpty && quarters.isNotEmpty) addQuarterRow(quarters[0], 0);

        final q2Months = months.where((m) => (m['month'] as int) > 4 && (m['month'] as int) <= 8).toList();
        for (var m in q2Months) addMonthRow(m as Map<String, dynamic>);
        if (q2Months.isNotEmpty && quarters.length > 1) addQuarterRow(quarters[1], 1);

        final q3Months = months.where((m) => (m['month'] as int) > 8).toList();
        for (var m in q3Months) addMonthRow(m as Map<String, dynamic>);
        if (q3Months.isNotEmpty && quarters.length > 2) addQuarterRow(quarters[2], 2);
    }
    
    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columnSpacing: 20,
          headingRowColor: MaterialStateProperty.all(AppTheme.surfaceColor.withOpacity(0.8)),
          columns: const [
            DataColumn(label: Text('MES', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
            DataColumn(label: Text('OBJ. MES', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
            DataColumn(label: Text('VENTA', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
            DataColumn(label: Text('ESTADO', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
            DataColumn(label: Text('%', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
            DataColumn(label: Text('COMISIÓN', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonGreen))),
            DataColumn(label: Text('DÍAS', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple))),
            DataColumn(label: Text('OBJ. ACUM.', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple))),
            DataColumn(label: Text('RITMO', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple))),
            DataColumn(label: Text('DIFF', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple))),
            DataColumn(label: Text('COM. PROV.', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple))),
          ],
          rows: rows,
        ),
      ),
    );
  }

  // --- ROW CREATORS ---
  DataRow _createMonthRow(Map<String, dynamic> m, bool isInformative) {
      final monthNum = m['month'] as int;
      final monthName = _getMonthName(monthNum);
      final target = (m['target'] as num?)?.toDouble() ?? 0;
      final actual = (m['actual'] as num?)?.toDouble() ?? 0;
      final isFuture = (m['isFuture'] as bool?) ?? false;
      
      final ctx = m['complianceCtx'] ?? {};
      final pct = (ctx['pct'] as num?)?.toDouble() ?? 0;
      final tier = (ctx['tier'] as num?)?.toInt() ?? 0;
      final commission = (ctx['commission'] as num?)?.toDouble() ?? 0;
      
      final workingDays = (m['workingDays'] as num?)?.toInt() ?? 0;
      final proRatedTarget = (m['proRatedTarget'] as num?)?.toDouble() ?? 0;
      final daysPassed = (m['daysPassed'] as num?)?.toInt() ?? 0;
      
      final dailyCtx = m['dailyComplianceCtx'] ?? {};
      final dailyGreen = (dailyCtx['isGreen'] as bool?) ?? false;
      final provisionalCommission = (dailyCtx['provisionalCommission'] as num?)?.toDouble() ?? 0;
      final dailyTier = (dailyCtx['tier'] as num?)?.toInt() ?? 0;
      final dailyRate = (dailyCtx['rate'] as num?)?.toDouble() ?? 0;
      final dailyPct = (dailyCtx['pct'] as num?)?.toDouble() ?? 0;

      final isPositive = actual >= target && target > 0;
      final color = isFuture ? Colors.grey : (isPositive ? AppTheme.success : AppTheme.error);
      final dailyColor = isFuture ? Colors.grey : (dailyGreen ? AppTheme.success : Colors.orangeAccent);
      final rowBgColor = isFuture ? Colors.black38 : AppTheme.surfaceColor;
      final textOpacity = isFuture ? 0.4 : 1.0;

      final pctDisplay = pct > 0 ? (pct - 100) : 0;
      final pctText = isFuture ? '-' : (pct > 100 ? '+${pctDisplay.toStringAsFixed(1)}%' : '${pct.toStringAsFixed(1)}%');
      
      final dailyPctDisplay = dailyPct > 0 ? (dailyPct - 100) : 0;
      final dailyPctText = dailyPct > 100 ? '+${dailyPctDisplay.toStringAsFixed(1)}%' : '${dailyPct.toStringAsFixed(1)}%';

      return DataRow(
        color: MaterialStateProperty.all(rowBgColor),
        cells: [
          DataCell(Row(
            children: [
              Text(monthName, style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white.withOpacity(textOpacity))),
              if (isFuture) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  decoration: BoxDecoration(color: Colors.grey.withOpacity(0.3), borderRadius: BorderRadius.circular(4)),
                  child: const Text('PENDIENTE', style: TextStyle(fontSize: 8, color: Colors.grey)),
                )
              ]
            ],
          )),
          DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(target), style: TextStyle(color: Colors.white.withOpacity(textOpacity)))),
          DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(actual), style: TextStyle(color: color, fontWeight: FontWeight.bold))),
          DataCell(isFuture 
            ? const Text('-', style: TextStyle(color: Colors.grey))
            : Row(
               children: [
                 Icon(isPositive ? Icons.check_circle : Icons.cancel, color: color, size: 16),
                 if (isPositive && tier > 0) ...[
                   const SizedBox(width: 4),
                   Container(
                     padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                     decoration: BoxDecoration(color: AppTheme.neonBlue.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                     child: Text('F$tier', style: const TextStyle(fontSize: 9, color: AppTheme.neonBlue)),
                   )
                 ]
               ],
          )),
          DataCell(Text(pctText, style: TextStyle(color: isFuture ? Colors.grey : color, fontSize: 11))),
          DataCell(Text(
            isFuture ? '-' : (isInformative ? '-' : CurrencyFormatter.format(commission)), 
            style: TextStyle(color: isFuture ? Colors.grey : (isInformative ? Colors.grey : AppTheme.neonGreen), fontWeight: FontWeight.bold)
          )),
          
          DataCell(Text(isFuture ? '-' : '$daysPassed/$workingDays', style: TextStyle(color: Colors.white.withOpacity(textOpacity * 0.7), fontSize: 11))),
          DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(proRatedTarget), style: TextStyle(fontSize: 11, color: Colors.white.withOpacity(textOpacity)))),
          DataCell(isFuture 
            ? const Text('-', style: TextStyle(color: Colors.grey))
            : Column(
               mainAxisAlignment: MainAxisAlignment.center,
               crossAxisAlignment: CrossAxisAlignment.start,
               children: [
                 Row(children: [
                   Icon(dailyGreen ? Icons.check_circle : Icons.warning_amber, color: dailyColor, size: 14),
                   const SizedBox(width: 4),
                   Text(dailyPctText, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: dailyColor)),
                 ]),
                 if (dailyTier > 0) 
                   Text('Franja $dailyTier (${dailyRate.toStringAsFixed(1)}%)', style: TextStyle(fontSize: 9, color: dailyColor))
               ],
          )),
          DataCell(isFuture 
            ? const Text('-', style: TextStyle(color: Colors.grey))
            : Text(
                (actual - proRatedTarget) >= 0 
                  ? '+${CurrencyFormatter.format(actual - proRatedTarget)}'
                  : CurrencyFormatter.format(actual - proRatedTarget),
                style: TextStyle(
                  color: (actual - proRatedTarget) >= 0 ? AppTheme.success : AppTheme.error,
                  fontWeight: FontWeight.bold,
                  fontSize: 11
                )
              )
          ),
          DataCell(isFuture || isInformative
            ? const Text('-', style: TextStyle(color: Colors.grey))
            : Text(
                CurrencyFormatter.format(provisionalCommission),
                style: TextStyle(color: provisionalCommission > 0 ? AppTheme.neonPurple : Colors.grey, fontWeight: FontWeight.bold, fontSize: 11)
              )
          ),
        ],
      );
  }

  DataRow _createQuarterRow(Map<String, dynamic> q, int qIndex) {
       final monthNow = DateTime.now().month;
       final currentQ = (monthNow - 1) ~/ 4; 
       final isPast = qIndex < currentQ;
       final isCurrent = qIndex == currentQ;
       final isFuture = qIndex > currentQ;
       
       final name = q['name'] ?? 'Trimestre';
       final commission = (q['commission'] as num?)?.toDouble() ?? 0;
       final additional = (q['additionalPayment'] as num?)?.toDouble() ?? 0;
       final total = commission + additional;
       final paid = commission; 

       final bgColor = isPast ? Colors.black26 : (isCurrent ? AppTheme.neonPurple.withOpacity(0.15) : Colors.transparent);
       final textColor = isPast ? Colors.grey : (isCurrent ? AppTheme.neonPurple : Colors.white24);
       
       return DataRow(
         color: WidgetStateProperty.all(bgColor),
         cells: [
            DataCell(Text(name.toUpperCase(), style: TextStyle(color: textColor, fontWeight: FontWeight.bold))),
            const DataCell(SizedBox()), 
            const DataCell(SizedBox()), 
            const DataCell(SizedBox()), 
            const DataCell(SizedBox()), 
            DataCell( isFuture ? const Text('-') : Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Generado: ${CurrencyFormatter.format(total)}', style: TextStyle(fontSize: 11, color: isPast ? Colors.grey : Colors.white70)),
                  Text('Pagado: ${CurrencyFormatter.format(paid)}', style: TextStyle(fontSize: 12, color: isPast ? Colors.white60 : AppTheme.neonGreen, fontWeight: FontWeight.bold)),
                ]
            )),
            const DataCell(SizedBox()), 
            const DataCell(SizedBox()), 
            const DataCell(SizedBox()), 
            const DataCell(SizedBox()), 
            const DataCell(SizedBox()), 
         ]
       );
  }

  String _getMonthName(int m) {
    const names = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    if (m < 1 || m > 12) return 'Mes $m';
    return names[m - 1];
  }

  /// Super Table: Shows breakdown of all vendors when in 'ALL' mode
  Widget _buildSuperTable(List<dynamic> breakdown) {
    if (breakdown.isEmpty) {
      return const Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.search_off, size: 48, color: Colors.white24),
          SizedBox(height: 16),
          Text("No hay datos de vendedores", style: TextStyle(color: Colors.white54))
        ])
      );
    }

    // Sort by grandTotalCommission descending
    final sorted = List<dynamic>.from(breakdown);
    sorted.sort((a, b) => ((b['grandTotalCommission'] as num?) ?? 0).compareTo((a['grandTotalCommission'] as num?) ?? 0));

    // Calculate totals for each vendor
    final rows = sorted.map<DataRow>((v) {
      final code = v['vendedorCode'] as String? ?? '?';
      final name = v['vendorName'] as String? ?? 'Sin Nombre';
      final commission = (v['grandTotalCommission'] as num?)?.toDouble() ?? 0;
      final isExcluded = (v['isExcluded'] as bool?) ?? false;

      // Sum up months for totals
      final months = (v['months'] as List?) ?? [];
      double totalTarget = 0;
      double totalActual = 0;
      for (var m in months) {
        totalTarget += (m['target'] as num?)?.toDouble() ?? 0;
        totalActual += (m['actual'] as num?)?.toDouble() ?? 0;
      }

      final pct = totalTarget > 0 ? (totalActual / totalTarget * 100) : 0.0;
      final isPositive = totalActual >= totalTarget && totalTarget > 0;
      final color = isPositive ? AppTheme.success : AppTheme.error;

      return DataRow(
        color: WidgetStateProperty.all(isExcluded ? Colors.black26 : AppTheme.surfaceColor),
        cells: [
          DataCell(Text(code, style: TextStyle(fontWeight: FontWeight.bold, color: isExcluded ? Colors.grey : Colors.white))),
          DataCell(Text(name, style: TextStyle(color: isExcluded ? Colors.grey : Colors.white70))),
          DataCell(Text(CurrencyFormatter.format(totalTarget), style: TextStyle(color: isExcluded ? Colors.grey : Colors.white54))),
          DataCell(Text(CurrencyFormatter.format(totalActual), style: TextStyle(color: isExcluded ? Colors.grey : color, fontWeight: FontWeight.bold))),
          DataCell(Text('${pct.toStringAsFixed(1)}%', style: TextStyle(color: isExcluded ? Colors.grey : color, fontSize: 12))),
          DataCell(Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(CurrencyFormatter.format(commission), style: TextStyle(color: isExcluded ? Colors.grey : AppTheme.neonGreen, fontWeight: FontWeight.bold)),
              if (isExcluded) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  decoration: BoxDecoration(color: Colors.orange.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                  child: const Text('EXCLUIDO', style: TextStyle(fontSize: 8, color: Colors.orange)),
                )
              ]
            ],
          )),
        ],
      );
    }).toList();

    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columnSpacing: 24,
          headingRowColor: WidgetStateProperty.all(AppTheme.surfaceColor.withOpacity(0.8)),
          columns: const [
            DataColumn(label: Text('CÓD', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
            DataColumn(label: Text('VENDEDOR', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
            DataColumn(label: Text('OBJETIVO', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
            DataColumn(label: Text('VENTA', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
            DataColumn(label: Text('%', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
            DataColumn(label: Text('COMISIÓN', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonGreen))),
          ],
          rows: rows,
        ),
      ),
    );
  }
}
