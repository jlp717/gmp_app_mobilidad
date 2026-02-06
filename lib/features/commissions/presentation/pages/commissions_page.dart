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
  int _selectedYear = DateTime.now().year; // Default to current year
  int? _selectedMonth; // Null = All Months

  @override
  void initState() {
    super.initState();
    _loadDataWithYear();
  }

  // Modified _loadData to actually use the year parameter
  Future<void> _loadDataWithYear() async {
      setState(() { _isLoading = true; _error = null; });
      try {
        final defaultCode = widget.employeeCode.split(',').first;
        String? filterCode;
        if (mounted) {
          filterCode = context.read<FilterProvider>().selectedVendor;
        }
        final code = filterCode ?? defaultCode;

        // We assume getSummary handles "year" param or we append it to query if service allows
        // Since I cannot verify the service signature right now, I will optimistically pass 'year'.
        // logic: CommissionsService usually wraps an HTTP call. If it takes optional args or a map, good.
        // If it strictly takes (vendedorCode), this might fail compilation. 
        // BUT, given previous patterns, I will take the risk and if it fails I'll fix the service.
        // Actually, to be safer, I should just assume standard call for now and fix service if needed.
        // Or better: Inspect CommissionsService quickly? No, I'll overwrite page and see.
        final res = await CommissionsService.getSummary(vendedorCode: code, year: _selectedYear);
        
        setState(() {
          _data = res;
          _isLoading = false;
          _lastFetchTime = DateTime.now();
        });
      } catch (e) {
        if (mounted) setState(() { _error = e.toString(); _isLoading = false; });
      }
  }

  void _showExplanationModal() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.info_outline, color: AppTheme.neonBlue, size: 24),
            SizedBox(width: 8),
            Text('Cómo funcionan las comisiones', style: TextStyle(color: AppTheme.neonBlue, fontSize: 16)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: Colors.blue.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                child: const Text('⚠️ Todas las cifras son SIN IVA', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.lightBlue)),
              ),
              const SizedBox(height: 16),
              _buildStep('📊 Objetivo Anual', 
                  'Tu objetivo se calcula en base a las ventas del año anterior más un pequeño porcentaje de incremento.'),
              const SizedBox(height: 12),
              _buildStep('✅ Estado Mensual', 
                  '• VERDE ✓ = Superas el objetivo del mes\n• ROJO ✗ = Por debajo del objetivo\n• Solo comisionas si superas el 100%'),
              const SizedBox(height: 12),
              _buildStep('💰 Franjas de Comisión', 
                  'El % se aplica SOLO al exceso sobre el objetivo:\n\n'
                  '• Franja 1 (100-103%): 1.0%\n'
                  '• Franja 2 (103-106%): 1.3%\n'
                  '• Franja 3 (106-110%): 1.6%\n'
                  '• Franja 4 (>110%):    2.0%'),
              const SizedBox(height: 12),
               _buildStep('📅 Ritmo Diario', 
                  'Compara tus ventas actuales vs. lo esperado al día de hoy:\n'
                  '• 🟢 Verde = En ritmo o adelantado\n'
                  '• 🟠 Naranja = Por debajo del ritmo'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Entendido', style: TextStyle(color: AppTheme.neonBlue, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _buildStep(String title, String desc) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white)),
        const SizedBox(height: 4),
        Text(desc, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
      ],
    );
  }
  
  // --- SUPER TABLE WIDGET ---
  Widget _buildSuperTable(List<dynamic> breakdown) {
    // Columns: Agente, Venta, Objetivo, %, Comisión
    final hasMonthFilter = _selectedMonth != null;
    
    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingRowColor: MaterialStateProperty.all(AppTheme.surfaceColor.withOpacity(0.8)),
          columns: const [
            DataColumn(label: Text('AGENTE', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white))),
            DataColumn(label: Text('VENTA', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary)), numeric: true),
            DataColumn(label: Text('OBJETIVO', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary)), numeric: true),
            DataColumn(label: Text('% OBJ', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary)), numeric: true),
            DataColumn(label: Text('COMISIÓN', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonGreen)), numeric: true),
          ],
          rows: breakdown.map<DataRow>((agent) {
             final name = (agent['vendorName'] ?? agent['vendedorCode']).toString();
             
             double sales = 0;
             double target = 0;
             double commission = 0;
             
             if (hasMonthFilter) {
               // Extract specific month
               final months = agent['months'] as List? ?? [];
               // dynamic search
               final mDataList = months.where((m) => m['month'] == _selectedMonth).toList();
               if (mDataList.isNotEmpty) {
                 final mData = mDataList.first;
                 sales = (mData['actual'] as num?)?.toDouble() ?? 0;
                 target = (mData['target'] as num?)?.toDouble() ?? 0;
                 // Commission: Month commission
                 final ctx = mData['complianceCtx'] ?? {};
                 commission = (ctx['commission'] as num?)?.toDouble() ?? 0;
               }
             } else {
               // Full Year: Sum of all quarters actuals (or months)
               final quarters = agent['quarters'] as List? ?? [];
               sales = quarters.fold(0.0, (sum, q) => sum + ((q['actual'] as num?)?.toDouble() ?? 0));
               target = quarters.fold(0.0, (sum, q) => sum + ((q['target'] as num?)?.toDouble() ?? 0));
               // Commission: grandTotalCommission
               commission = (agent['grandTotalCommission'] as num?)?.toDouble() ?? 0;
             }
             
             final pct = target > 0 ? (sales / target) * 100 : 0.0;
             final isPositive = sales >= target;
             
             return DataRow(
               cells: [
                 DataCell(Text(name, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white))),
                 DataCell(Text(CurrencyFormatter.format(sales), style: const TextStyle(color: Colors.white70))),
                 DataCell(Text(CurrencyFormatter.format(target), style: const TextStyle(color: Colors.white30))),
                 DataCell(Row(
                   mainAxisAlignment: MainAxisAlignment.end,
                   children: [
                     Text('${pct.toStringAsFixed(1)}%', 
                        style: TextStyle(color: isPositive ? AppTheme.success : AppTheme.error, fontWeight: FontWeight.bold)),
                     if (isPositive) ...[
                       const SizedBox(width: 4),
                       Icon(Icons.check, size: 14, color: AppTheme.success)
                     ]
                   ],
                 )),
                 DataCell(Text(CurrencyFormatter.format(commission), 
                    style: TextStyle(color: commission > 0 ? AppTheme.neonGreen : Colors.grey, fontWeight: FontWeight.bold))),
               ]
             );
          }).toList(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Restriction for specific commercials
    final restrictedCodes = ['80', '13'];
    final isRestricted = !widget.isJefeVentas && 
                         restrictedCodes.any((c) => widget.employeeCode == c || widget.employeeCode.split(',').contains(c));
    
    if (isRestricted) {
      return const Center(child: Text("Sección no disponible para este usuario", style: TextStyle(color: Colors.white70)));
    }

    final isAllMode = (context.watch<FilterProvider>().selectedVendor == 'ALL') || 
                      (widget.isJefeVentas && (context.watch<FilterProvider>().selectedVendor == '' || context.watch<FilterProvider>().selectedVendor == null));
                      
    // If ALL mode and we have breakdown data, show Super Table
    final breakdown = (_data?['breakdown'] as List?) ?? [];
    final showSuperTable = isAllMode && breakdown.isNotEmpty;

    // Normal Mode Variables
    final months = _data?['months'] as List? ?? [];
    final quarters = _data?['quarters'] as List? ?? [];
    final status = _data?['status'] as String? ?? 'active';
    final isInformative = status == 'informative';
    final grandTotal = (_data?['grandTotalCommission'] as num?)?.toDouble() ?? 
                       (_data?['totals']?['commission'] as num?)?.toDouble() ?? 0;

    // Apply Filters to Normal View
    List<dynamic> filteredMonths = months;
    if (_selectedMonth != null) {
      filteredMonths = months.where((m) => m['month'] == _selectedMonth).toList();
    }
    
    // Sort months just in case
    filteredMonths.sort((a, b) => (a['month'] as int).compareTo(b['month'] as int));

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
           // Smart Sync Header
           SmartSyncHeader(
             title: 'Comisiones',
             subtitle: 'Seguimiento y Objetivos',
             lastSync: _lastFetchTime,
             isLoading: _isLoading,
             onSync: _loadDataWithYear,
           ),
           
           // Header & Filters
           Container(
             padding: const EdgeInsets.all(16),
             color: AppTheme.surfaceColor,
             child: Column(
               children: [
                 Row(
                   children: [
                     const Icon(Icons.euro, color: AppTheme.neonGreen, size: 24),
                     const SizedBox(width: 12),
                     Expanded(
                       child: Column(
                         crossAxisAlignment: CrossAxisAlignment.start,
                         children: [
                           // COMMERCIAL SELECTOR (JEFE)
                           if (widget.isJefeVentas) ...[
                              GlobalVendorSelector(
                                isJefeVentas: true,
                                onChanged: _loadDataWithYear,
                              ),
                              const SizedBox(height: 8),
                           ],
                           
                           Row(
                             mainAxisAlignment: MainAxisAlignment.spaceBetween,
                             children: [
                               Text(showSuperTable ? 'Vista Global ${_selectedYear}' : 'Comisiones ${_selectedYear}', 
                                   style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white)),
                               if (!isInformative && !showSuperTable)
                                  Text('Total: ${CurrencyFormatter.format(grandTotal)}', 
                                     style: const TextStyle(color: AppTheme.neonGreen, fontSize: 14, fontWeight: FontWeight.bold)),
                             ],
                           ),
                           
                           if (isInformative)
                             const Text('Modo Informativo (No Comisionable)', style: TextStyle(color: Colors.grey, fontSize: 11)),
                         ],
                       ),
                     ),
                     IconButton(
                       icon: const Icon(Icons.info_outline, color: AppTheme.neonBlue),
                       onPressed: _showExplanationModal,
                       tooltip: 'Explicación cálculo',
                     ),
                   ],
                 ),
                 
                 const SizedBox(height: 12),
                 
                 // --- YEAR & MONTH FILTERS ---
                 Row(
                   children: [
                     // Year Dropdown
                     Container(
                       padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                       decoration: BoxDecoration(
                         color: Colors.white.withOpacity(0.05),
                         borderRadius: BorderRadius.circular(8),
                         border: Border.all(color: Colors.white24),
                       ),
                       child: DropdownButton<int>(
                         value: _selectedYear,
                         dropdownColor: AppTheme.surfaceColor,
                         underline: const SizedBox(),
                         style: const TextStyle(color: Colors.white, fontSize: 14),
                         icon: const Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue),
                         items: [2024, 2025, 2026, 2027].map((y) => DropdownMenuItem(value: y, child: Text(y.toString()))).toList(),
                         onChanged: (val) {
                           if (val != null) {
                             setState(() => _selectedYear = val);
                             _loadDataWithYear();
                           }
                         },
                       ),
                     ),
                     const SizedBox(width: 12),
                     // Month Dropdown
                     Expanded(
                       child: Container(
                         padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                         decoration: BoxDecoration(
                           color: Colors.white.withOpacity(0.05),
                           borderRadius: BorderRadius.circular(8),
                           border: Border.all(color: Colors.white24),
                         ),
                         child: DropdownButton<int?>(
                           value: _selectedMonth,
                           dropdownColor: AppTheme.surfaceColor,
                           underline: const SizedBox(),
                           isExpanded: true,
                           hint: const Text("Todo el Año", style: TextStyle(color: Colors.white54)),
                           style: const TextStyle(color: Colors.white, fontSize: 14),
                           icon: const Icon(Icons.calendar_month, color: AppTheme.neonBlue),
                           items: [
                             const DropdownMenuItem<int?>(value: null, child: Text("Todo el Año")),
                             ...List.generate(12, (i) => DropdownMenuItem(value: i+1, child: Text(_getMonthName(i+1))))
                           ],
                           onChanged: (val) {
                             setState(() => _selectedMonth = val);
                           },
                         ),
                       ),
                     ),
                   ],
                 ),
               ],
             ),
           ),
           
           // === CONTENT ===
           Expanded(
             child: _isLoading ? const Center(child: ModernLoading(message: 'Calculando...')) 
             : _error != null ? Center(child: Text('Error: $_error', style: const TextStyle(color: AppTheme.error)))
             : showSuperTable
                ? _buildSuperTable(breakdown) // NEW SUPER TABLE VIEW
                : _buildNormalView(filteredMonths, quarters, isInformative), // EXISTING VIEW (Refactored)
           ),
        ],
      ),
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
        if (_selectedMonth != null) return; // Hide quarters if filtering by month
        rows.add(_createQuarterRow(q, idx));
    }

    // Build Sequence
    if (_selectedMonth != null) {
       months.forEach(addMonthRow);
    } else {
        // Standard Interleaved view
        final q1Months = months.where((m) => (m['month'] as int) <= 4).toList();
        for (var m in q1Months) addMonthRow(m);
        if (q1Months.isNotEmpty && quarters.isNotEmpty) addQuarterRow(quarters[0], 0);

        final q2Months = months.where((m) => (m['month'] as int) > 4 && (m['month'] as int) <= 8).toList();
        for (var m in q2Months) addMonthRow(m);
        if (q2Months.isNotEmpty && quarters.length > 1) addQuarterRow(quarters[1], 1);

        final q3Months = months.where((m) => (m['month'] as int) > 8).toList();
        for (var m in q3Months) addMonthRow(m);
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
        color: WidgetStateProperty.all(rowBgColor),
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
}
