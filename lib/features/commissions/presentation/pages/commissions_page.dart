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
  
  // Jefe View


  @override
  void initState() {
    super.initState();

    _loadData();
  }



  Future<void> _loadData() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final defaultCode = widget.employeeCode.split(',').first;

      // Use Provider if mounted, otherwise local fallback (init)
      String? filterCode;
      if (mounted) {
        filterCode = context.read<FilterProvider>().selectedVendor;
      }

      // For jefe de ventas: if no specific filter or 'ALL', request ALL vendors
      String code;
      if (widget.isJefeVentas && (filterCode == null || filterCode == '' || filterCode == 'ALL')) {
        code = 'ALL';
      } else {
        code = filterCode ?? defaultCode;
      }

      final res = await CommissionsService.getSummary(vendedorCode: code);
      setState(() {
        _data = res;
        _isLoading = false;
        _lastFetchTime = DateTime.now();
      });
    } catch (e) {
      if (mounted) {
          setState(() {
            _error = e.toString();
            _isLoading = false;
          });
      }
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
                  'Compara tus ventas actuales vs. lo esperado al día de hoy:\\n'
                  '• ✓ Verde (Adelantado/En ritmo) = Vas por buen camino\\n'
                  '• ⚠ Naranja (Rezagado) = Necesitas acelerar'),
              const SizedBox(height: 12),
              _buildStep('🔒 Meses Pendientes', 
                  'Los meses futuros aparecen sombreados.\nSe "desbloquean" cuando llegue su fecha.'),
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

  @override
  Widget build(BuildContext context) {
    // Restriction for specific commercials
    // Only block if NOT a manager and effectively is one of the restricted codes
    final restrictedCodes = ['80', '13'];
    final isRestricted = !widget.isJefeVentas && 
                         restrictedCodes.any((c) => widget.employeeCode == c || widget.employeeCode.split(',').contains(c));
    
    if (isRestricted) {
      return const Center(child: Text("Sección no disponible para este usuario", style: TextStyle(color: Colors.white70)));
    }

    // Check if we're in ALL mode (breakdown available)
    final breakdown = (_data?['breakdown'] as List?) ?? [];
    final isAllMode = breakdown.isNotEmpty;

    // ... vars ...
    final months = _data?['months'] as List? ?? [];
    final quarters = _data?['quarters'] as List? ?? [];
    final status = _data?['status'] as String? ?? 'active';
    final isInformative = status == 'informative';
    final grandTotal = (_data?['grandTotalCommission'] as num?)?.toDouble() ??
                       (_data?['totals']?['commission'] as num?)?.toDouble() ?? 0;

    // Calculate summary stats
    double totalProvisionalCommission = 0;
    double totalActualSales = 0;
    double totalTarget = 0;
    double totalProRatedTarget = 0; // Expected sales by today
    Map<String, dynamic>? currentMonthData;
    
    for (var m in months) {
      final monthNum = (m['month'] as num?)?.toInt() ?? 0;
      final isFuture = (m['isFuture'] as bool?) ?? false;
      final actual = (m['actual'] as num?)?.toDouble() ?? 0;
      final target = (m['target'] as num?)?.toDouble() ?? 0;
      final dailyCtx = m['dailyComplianceCtx'] ?? {};
      final provisionalComm = (dailyCtx['provisionalCommission'] as num?)?.toDouble() ?? 0;
      final proRatedTarget = (m['proRatedTarget'] as num?)?.toDouble() ?? 0;
      
      if (!isFuture) {
        totalProvisionalCommission += provisionalComm;
        totalActualSales += actual;
        totalTarget += target;
        // For current month, use proRatedTarget (expected by today)
        // For past months, use full target (should have been completed)
        if (monthNum == DateTime.now().month) {
          totalProRatedTarget += proRatedTarget; // Expected by today
        } else {
          totalProRatedTarget += target; // Full month target for past months
        }
      }
      
      // Current month (January = 1)
      if (monthNum == DateTime.now().month) {
        currentMonthData = m;
      }
    }
    
    // Overall compliance: actual vs WHAT WE SHOULD HAVE BY NOW (not total target)
    final overallCompliance = totalTarget > 0 ? (totalActualSales / totalTarget) * 100 : 0;
    
    // Rhythm compliance: are we on track for the current day?
    // If totalProRatedTarget > 0, compare actual vs expected by today
    final rhythmCompliance = totalProRatedTarget > 0 ? (totalActualSales / totalProRatedTarget) * 100 : 100;
    final isOnRhythm = rhythmCompliance >= 100;
    final rhythmStatus = rhythmCompliance >= 105 ? 'Adelantado' : (rhythmCompliance >= 95 ? 'En ritmo' : 'Rezagado');


    // Prepare table rows (interleaving quarters)
    final rows = <DataRow>[];
    
    // Sort months just in case
    months.sort((a, b) => (a['month'] as int).compareTo(b['month'] as int));


    // Helper to add month row
    void addMonthRow(Map<String, dynamic> m) {
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
      final dailyTarget = (m['dailyTarget'] as num?)?.toDouble() ?? 0;
      final dailyActual = (m['dailyActual'] as num?)?.toDouble() ?? 0;
      final dailyCtx = m['dailyComplianceCtx'] ?? {};
      final dailyGreen = (dailyCtx['isGreen'] as bool?) ?? false;

      // Color logic: future months get special styling
      final isPositive = actual >= target && target > 0;
      final color = isFuture ? Colors.grey : (isPositive ? AppTheme.success : AppTheme.error);
      final dailyColor = isFuture ? Colors.grey : (dailyGreen ? AppTheme.success : Colors.orangeAccent);
      final rowBgColor = isFuture ? Colors.black38 : AppTheme.surfaceColor;
      final textOpacity = isFuture ? 0.4 : 1.0;

      // Monthly Pct Logic
      final pctDisplay = pct > 0 ? (pct - 100) : 0;
      final pctText = isFuture ? '-'
          : (pct > 100 ? '+${pctDisplay.toStringAsFixed(1)}%' : '${pct.toStringAsFixed(1)}%');

      // Daily accumulated data (new from backend)
      final daysPassed = (m['daysPassed'] as num?)?.toInt() ?? 0;
      final proRatedTarget = (m['proRatedTarget'] as num?)?.toDouble() ?? 0;
      final provisionalCommission = (dailyCtx['provisionalCommission'] as num?)?.toDouble() ?? 0;
      final dailyTier = (dailyCtx['tier'] as num?)?.toInt() ?? 0;
      final dailyRate = (dailyCtx['rate'] as num?)?.toDouble() ?? 0;
      final dailyPct = (dailyCtx['pct'] as num?)?.toDouble() ?? 0;
      
      // Daily percentage text
      final dailyPctDisplay = dailyPct > 0 ? (dailyPct - 100) : 0;
      final dailyPctText = dailyPct > 100 
          ? '+${dailyPctDisplay.toStringAsFixed(1)}%' 
          : '${dailyPct.toStringAsFixed(1)}%';

      rows.add(DataRow(
        color: WidgetStateProperty.all(rowBgColor),
        cells: [
          // MES
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
          // OBJ. MES
          DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(target), style: TextStyle(color: Colors.white.withOpacity(textOpacity)))),
          // VENTA REAL (acumulada del mes)
          DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(actual), style: TextStyle(color: color, fontWeight: FontWeight.bold))),
          // ESTADO MES
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
          // % SOBRE (mes)
          DataCell(Text(pctText, style: TextStyle(color: isFuture ? Colors.grey : color, fontSize: 11))),
          // COMISIÓN MES
          DataCell(Text(
            isFuture ? '-' : (isInformative ? '-' : CurrencyFormatter.format(commission)), 
            style: TextStyle(color: isFuture ? Colors.grey : (isInformative ? Colors.grey : AppTheme.neonGreen), fontWeight: FontWeight.bold)
          )),
          
          // === SECCIÓN RITMO DIARIO ===
          // DÍAS (transcurridos / totales)
          DataCell(Text(isFuture ? '-' : '$daysPassed/$workingDays', style: TextStyle(color: Colors.white.withOpacity(textOpacity * 0.7), fontSize: 11))),
          // OBJ. ACUM. (pro-rated target)
          DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(proRatedTarget), style: TextStyle(fontSize: 11, color: Colors.white.withOpacity(textOpacity)))),
          // ESTADO RITMO + % SOBRE
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
                 else if (!dailyGreen && actual > 0)
                   Text('Por debajo', style: TextStyle(fontSize: 9, color: dailyColor))
                ],
          )),
          // DIFERENCIA (Venta Real - Obj. Acumulado)
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
          // COMISIÓN PROVISIONAL
          DataCell(isFuture || isInformative
            ? const Text('-', style: TextStyle(color: Colors.grey))
            : Text(
                CurrencyFormatter.format(provisionalCommission),
                style: TextStyle(
                  color: provisionalCommission > 0 ? AppTheme.neonPurple : Colors.grey,
                  fontWeight: FontWeight.bold,
                  fontSize: 11
                )
              )
          ),
        ],
      ));
    }


    // Helper to add Quarter summary (Paid vs Real)
    void addQuarterRow(Map<String, dynamic> q, int qIndex) {
       if (q.isEmpty) return;

       final monthNow = DateTime.now().month;
       final currentQ = (monthNow - 1) ~/ 4; // 0 for Jan-Apr, 1 for May-Aug, 2 for Sep-Dec
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
       
       rows.add(DataRow(
         color: WidgetStateProperty.all(bgColor),
         cells: [
            DataCell(Text(name.toUpperCase(), style: TextStyle(color: textColor, fontWeight: FontWeight.bold))),
            const DataCell(SizedBox()), // OBJ. MES
            const DataCell(SizedBox()), // VENTA
            const DataCell(SizedBox()), // ESTADO
            const DataCell(SizedBox()), // %
            DataCell( isFuture ? const Text('-') : Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Generado: ${CurrencyFormatter.format(total)}', style: TextStyle(fontSize: 11, color: isPast ? Colors.grey : Colors.white70)),
                  Text('Pagado: ${CurrencyFormatter.format(paid)}', style: TextStyle(fontSize: 12, color: isPast ? Colors.white60 : AppTheme.neonGreen, fontWeight: FontWeight.bold)),
                ]
            )),
            const DataCell(SizedBox()), // DÍAS
            const DataCell(SizedBox()), // OBJ. ACUM.
            const DataCell(SizedBox()), // RITMO
            const DataCell(SizedBox()), // DIFF
            const DataCell(SizedBox()), // COM. PROV.
         ]
       ));
    }


    // Build Sequence
    // Build Sequence
    final q1Months = months.where((m) => (m['month'] as int) <= 4).toList();
    for (var m in q1Months) addMonthRow(m);
    if (q1Months.isNotEmpty && quarters.isNotEmpty) addQuarterRow(quarters[0], 0);

    final q2Months = months.where((m) => (m['month'] as int) > 4 && (m['month'] as int) <= 8).toList();
    for (var m in q2Months) addMonthRow(m);
    if (q2Months.isNotEmpty && quarters.length > 1) addQuarterRow(quarters[1], 1);

    final q3Months = months.where((m) => (m['month'] as int) > 8).toList();
    for (var m in q3Months) addMonthRow(m);
    if (q3Months.isNotEmpty && quarters.length > 2) addQuarterRow(quarters[2], 2);
    
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
           // Smart Sync Header (like other pages)
           SmartSyncHeader(
             title: 'Comisiones',
             subtitle: 'Seguimiento y Objetivos',
             lastSync: _lastFetchTime,
             isLoading: _isLoading,
             onSync: _loadData,
           ),
           // Header
           Container(
             padding: const EdgeInsets.all(16),
             color: AppTheme.surfaceColor,
             child: Row(
               children: [
                 const Icon(Icons.euro, color: AppTheme.neonGreen, size: 24),
                 const SizedBox(width: 12),
                 Expanded(
                   child: Column(
                     crossAxisAlignment: CrossAxisAlignment.start,
                     children: [
                       if (widget.isJefeVentas) ...[
                          GlobalVendorSelector(
                            isJefeVentas: true,
                            onChanged: _loadData,
                          ),
                       ]
                       else
                         const Text('Comisiones 2026', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                         
                       if (isInformative)
                         const Text('Modo Informativo (No Comisionable)', style: TextStyle(color: Colors.grey, fontSize: 11))
                       else
                         Text('Total Acumulado: ${CurrencyFormatter.format(grandTotal)}', 
                             style: const TextStyle(color: AppTheme.neonGreen, fontSize: 14)),
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
           ),
           
           // === SUMMARY CARDS ===
           if (!_isLoading && _error == null && !isInformative) ...[
             Container(
               padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
               child: Row(
                 children: [
                   // Current Month Card
                   Expanded(
                     child: Container(
                       padding: const EdgeInsets.all(12),
                       decoration: BoxDecoration(
                         gradient: LinearGradient(
                           colors: [AppTheme.neonBlue.withOpacity(0.2), AppTheme.neonPurple.withOpacity(0.1)],
                         ),
                         borderRadius: BorderRadius.circular(12),
                         border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
                       ),
                       child: Column(
                         crossAxisAlignment: CrossAxisAlignment.start,
                         children: [
                           Row(
                             children: [
                               const Icon(Icons.calendar_today, color: AppTheme.neonBlue, size: 16),
                               const SizedBox(width: 6),
                               Text(_getMonthName(DateTime.now().month).toUpperCase(), 
                                   style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.neonBlue)),
                             ],
                           ),
                           const SizedBox(height: 6),
                           if (currentMonthData != null) ...[
                             Text(CurrencyFormatter.format((currentMonthData!['actual'] as num?)?.toDouble() ?? 0),
                                 style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white)),
                             Text('de ${CurrencyFormatter.format((currentMonthData!['target'] as num?)?.toDouble() ?? 0)}',
                                 style: TextStyle(fontSize: 9, color: Colors.white.withOpacity(0.6))),
                             const SizedBox(height: 6),
                             // Mini progress bar
                             ClipRRect(
                               borderRadius: BorderRadius.circular(4),
                               child: LinearProgressIndicator(
                                 value: ((currentMonthData!['actual'] as num?)?.toDouble() ?? 0) / 
                                        ((currentMonthData!['target'] as num?)?.toDouble() ?? 1).clamp(0.01, double.infinity),
                                 backgroundColor: Colors.white.withOpacity(0.1),
                                 valueColor: AlwaysStoppedAnimation<Color>(
                                   ((currentMonthData!['actual'] as num?)?.toDouble() ?? 0) >= 
                                   ((currentMonthData!['target'] as num?)?.toDouble() ?? 0)
                                   ? AppTheme.success : AppTheme.neonBlue
                                 ),
                                 minHeight: 6,
                               ),
                             ),
                           ] else
                             const Text('Sin datos', style: TextStyle(color: Colors.grey)),
                         ],
                       ),
                     ),
                   ),
                   const SizedBox(width: 8),
                   // Provisional Commission Card
                   Expanded(
                     child: Container(
                       padding: const EdgeInsets.all(12),
                       decoration: BoxDecoration(
                         gradient: LinearGradient(
                           colors: [AppTheme.neonGreen.withOpacity(0.2), AppTheme.success.withOpacity(0.1)],
                         ),
                         borderRadius: BorderRadius.circular(12),
                         border: Border.all(color: AppTheme.neonGreen.withOpacity(0.3)),
                       ),
                       child: Column(
                         crossAxisAlignment: CrossAxisAlignment.start,
                         children: [
                           const Row(
                             children: [
                               Icon(Icons.trending_up, color: AppTheme.neonGreen, size: 16),
                               SizedBox(width: 6),
                               Text('COMISIÓN PROV.', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.neonGreen)),
                             ],
                           ),
                           const SizedBox(height: 8),
                           Text(CurrencyFormatter.format(totalProvisionalCommission),
                               style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.neonGreen)),
                           const SizedBox(height: 2),
                           Text('Confirmado: ${CurrencyFormatter.format(grandTotal)}',
                               style: TextStyle(fontSize: 10, color: Colors.white.withOpacity(0.7))),
                         ],
                       ),
                     ),
                   ),
                   const SizedBox(width: 8),
                   // Compliance Card - now uses RHYTHM-based comparison
                   Expanded(
                     child: Container(
                       padding: const EdgeInsets.all(12),
                       decoration: BoxDecoration(
                         color: isOnRhythm 
                           ? AppTheme.success.withOpacity(0.15) 
                           : Colors.orange.withOpacity(0.15),
                         borderRadius: BorderRadius.circular(12),
                         border: Border.all(color: isOnRhythm 
                           ? AppTheme.success.withOpacity(0.3) 
                           : Colors.orange.withOpacity(0.3)),
                       ),
                       child: Column(
                         crossAxisAlignment: CrossAxisAlignment.start,
                         children: [
                           Row(
                             children: [
                               Icon(isOnRhythm ? Icons.trending_up : Icons.speed, 
                                   color: isOnRhythm ? AppTheme.success : Colors.orange, size: 16),
                               const SizedBox(width: 6),
                               Text('RITMO ACTUAL', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, 
                                   color: isOnRhythm ? AppTheme.success : Colors.orange)),
                             ],
                           ),
                           Text('(a día ${DateTime.now().day})',
                               style: TextStyle(fontSize: 9, color: Colors.white.withOpacity(0.5))),
                           const SizedBox(height: 6),
                           
                           // Metrics Row
                           Column(
                             crossAxisAlignment: CrossAxisAlignment.start,
                             children: [
                               // Rhythm (Month/Period pace)
                               Row(
                                 mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                 children: [
                                   Text('Vs Ritmo:', style: TextStyle(fontSize: 10, color: Colors.white70)),
                                   Text('${rhythmCompliance.toStringAsFixed(1)}%', 
                                     style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: isOnRhythm ? AppTheme.success : Colors.orange)),
                                 ],
                               ),
                               const SizedBox(height: 2),
                               // Annual/Total
                               Row(
                                 mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                 children: [
                                   Text('Vs Obj. Total:', style: TextStyle(fontSize: 10, color: Colors.white70)),
                                   Text('${overallCompliance.toStringAsFixed(1)}%', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white)),
                                 ],
                               ),
                             ],
                           ),
                           
                           const SizedBox(height: 4),
                           Text(rhythmStatus,
                               style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, 
                                   color: isOnRhythm ? AppTheme.success : Colors.orange)),
                         ],
                       ),
                     ),
                   ),
                 ],
               ),
             ),
           ],
           
           // Table


           Expanded(
             child: _isLoading ? const Center(child: ModernLoading(message: 'Calculando...'))
             : _error != null ? Center(child: Text('Error: $_error', style: const TextStyle(color: AppTheme.error)))
             : isAllMode
               ? _buildAllVendorsTable(breakdown)  // Show ALL vendors table
             : totalTarget <= 0 && !isInformative // ZERO TARGET WARNING
               ? Center(
                  child: Container(
                    padding: const EdgeInsets.all(24),
                    margin: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: AppTheme.darkSurface,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.orange.withOpacity(0.5)),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.info_outline, color: Colors.orange, size: 48),
                        const SizedBox(height: 16),
                        const Text('Sin Objetivo de Comisiones',
                            style: TextStyle(color: Colors.orange, fontSize: 18, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 12),
                        const Text(
                          'No se han encontrado ventas comisionables (Tipos AB/VT) en el año anterior para calcular el objetivo 2026.\nLas ventas de tipo "CM" u otros no generan objetivo ni comisiones.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white70, fontSize: 14),
                        ),
                      ],
                    ),
                  ),
               )
             : SingleChildScrollView(
                 scrollDirection: Axis.vertical,
                 child: SingleChildScrollView(
                   scrollDirection: Axis.horizontal,
                   child: DataTable(
                     columnSpacing: 20,
                     headingRowColor: WidgetStateProperty.all(AppTheme.surfaceColor.withOpacity(0.8)),
                      columns: const [
                        // === DATOS DEL MES ===
                        DataColumn(label: Text('MES', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
                        DataColumn(label: Text('OBJ. MES', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
                        DataColumn(label: Text('VENTA', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
                        DataColumn(label: Text('ESTADO', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
                        DataColumn(label: Text('%', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
                        DataColumn(label: Text('COMISIÓN', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonGreen))),
                        // === RITMO DIARIO (acumulado) ===
                        DataColumn(label: Text('DÍAS', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple))),
                        DataColumn(label: Text('OBJ. ACUM.', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple))),
                        DataColumn(label: Text('RITMO', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple))),
                        DataColumn(label: Text('DIFF', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple))),
                        DataColumn(label: Text('COM. PROV.', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple))),
                      ],

                     rows: rows,
                   ),
                 ),
               ),
           ),
        ],
      ),
    );
  }
  
  String _getMonthName(int m) {
    const names = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    if (m < 1 || m > 12) return 'Mes $m';
    return names[m - 1];
  }
  
  Widget _buildTierChip(String tier, String range, String rate) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 4),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.neonBlue.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            decoration: BoxDecoration(
              color: AppTheme.neonBlue.withOpacity(0.3),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(tier, style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.neonBlue)),
          ),
          const SizedBox(width: 4),
          Text('$range → $rate', style: TextStyle(fontSize: 9, color: Colors.white.withOpacity(0.7))),
        ],
      ),
    );
  }

  /// Builds the ALL vendors expandable list showing each vendor with their monthly data
  Widget _buildAllVendorsTable(List<dynamic> breakdown) {
    if (breakdown.isEmpty) {
      return const Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.group_off, size: 48, color: Colors.white24),
          SizedBox(height: 16),
          Text("No hay datos de vendedores", style: TextStyle(color: Colors.white54))
        ])
      );
    }

    // Sort by vendor code ascending
    final sorted = List<dynamic>.from(breakdown);
    sorted.sort((a, b) => (a['vendedorCode'] as String? ?? '').compareTo(b['vendedorCode'] as String? ?? ''));

    return ListView.builder(
      itemCount: sorted.length,
      itemBuilder: (context, index) => _VendorExpandableCard(
        vendor: sorted[index],
        getMonthName: _getMonthName,
      ),
    );
  }
}

/// Expandable card for each vendor in ALL mode
class _VendorExpandableCard extends StatefulWidget {
  final dynamic vendor;
  final String Function(int) getMonthName;

  const _VendorExpandableCard({required this.vendor, required this.getMonthName});

  @override
  State<_VendorExpandableCard> createState() => _VendorExpandableCardState();
}

class _VendorExpandableCardState extends State<_VendorExpandableCard> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    final v = widget.vendor;
    final code = v['vendedorCode'] as String? ?? '?';
    final name = v['vendorName'] as String? ?? 'Sin Nombre';
    final grandTotal = (v['grandTotalCommission'] as num?)?.toDouble() ?? 0;
    final isExcluded = (v['isExcluded'] as bool?) ?? false;
    final months = (v['months'] as List?) ?? [];
    final quarters = (v['quarters'] as List?) ?? [];

    // Calculate vendor totals
    double totalTarget = 0, totalActual = 0;
    for (var m in months) {
      totalTarget += (m['target'] as num?)?.toDouble() ?? 0;
      totalActual += (m['actual'] as num?)?.toDouble() ?? 0;
    }
    final vendorPct = totalTarget > 0 ? (totalActual / totalTarget * 100) : 0.0;
    final vendorPositive = totalActual >= totalTarget && totalTarget > 0;
    final statusColor = isExcluded ? Colors.grey : (vendorPositive ? AppTheme.success : AppTheme.error);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: isExcluded ? Colors.black26 : AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: _isExpanded ? AppTheme.neonBlue.withOpacity(0.5) : Colors.white12),
      ),
      child: Column(
        children: [
          // HEADER (always visible) - tap to expand/collapse
          InkWell(
            onTap: () => setState(() => _isExpanded = !_isExpanded),
            borderRadius: BorderRadius.circular(8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: _isExpanded ? AppTheme.neonBlue.withOpacity(0.1) : Colors.transparent,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
              ),
              child: Row(
                children: [
                  // Expand/Collapse arrow
                  Icon(
                    _isExpanded ? Icons.keyboard_arrow_down : Icons.keyboard_arrow_right,
                    color: AppTheme.neonBlue,
                    size: 24,
                  ),
                  const SizedBox(width: 8),
                  // Code
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(code, style: TextStyle(fontWeight: FontWeight.bold, color: isExcluded ? Colors.grey : AppTheme.neonBlue, fontSize: 12)),
                  ),
                  const SizedBox(width: 10),
                  // Name
                  Expanded(
                    child: Text(name, style: TextStyle(fontWeight: FontWeight.bold, color: isExcluded ? Colors.grey : Colors.white, fontSize: 13), overflow: TextOverflow.ellipsis),
                  ),
                  if (isExcluded) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(color: Colors.orange.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                      child: const Text('EXCL', style: TextStyle(fontSize: 9, color: Colors.orange)),
                    ),
                    const SizedBox(width: 8),
                  ],
                  // Status icon
                  Icon(vendorPositive ? Icons.check_circle : Icons.cancel, color: statusColor, size: 18),
                  const SizedBox(width: 4),
                  Text('${vendorPct.toStringAsFixed(0)}%', style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 12)),
                  const SizedBox(width: 12),
                  // Commission total
                  Text(CurrencyFormatter.format(grandTotal), style: TextStyle(color: isExcluded ? Colors.grey : AppTheme.neonGreen, fontWeight: FontWeight.bold, fontSize: 14)),
                ],
              ),
            ),
          ),

          // EXPANDED CONTENT
          if (_isExpanded) ...[
            const Divider(height: 1, color: Colors.white12),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: _buildVendorDataTable(months, quarters, isExcluded),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildVendorDataTable(List<dynamic> months, List<dynamic> quarters, bool isExcluded) {
    final rows = <DataRow>[];
    final sortedMonths = List<dynamic>.from(months);
    sortedMonths.sort((a, b) => (a['month'] as int).compareTo(b['month'] as int));

    // Quarter definitions: Q1 = Ene-Abr, Q2 = May-Ago, Q3 = Sep-Dic
    const quarterRanges = [
      {'name': 'CUATRIMESTRE 1', 'label': 'Ene - Abr', 'start': 1, 'end': 4},
      {'name': 'CUATRIMESTRE 2', 'label': 'May - Ago', 'start': 5, 'end': 8},
      {'name': 'CUATRIMESTRE 3', 'label': 'Sep - Dic', 'start': 9, 'end': 12},
    ];

    int quarterIndex = 0;

    for (final m in sortedMonths) {
      final monthNum = m['month'] as int;

      // Check if we need to insert a quarter header BEFORE this month
      while (quarterIndex < quarterRanges.length && monthNum > (quarterRanges[quarterIndex]['end'] as int)) {
        // Add quarter summary row
        final qr = quarterRanges[quarterIndex];
        final qData = quarters.length > quarterIndex ? quarters[quarterIndex] : null;
        rows.add(_buildQuarterRow(qr, qData, isExcluded));
        quarterIndex++;
      }

      // Add month row
      rows.add(_buildMonthRow(m, isExcluded));
    }

    // Add remaining quarters
    while (quarterIndex < quarterRanges.length) {
      final qr = quarterRanges[quarterIndex];
      final qData = quarters.length > quarterIndex ? quarters[quarterIndex] : null;
      rows.add(_buildQuarterRow(qr, qData, isExcluded));
      quarterIndex++;
    }

    return DataTable(
      columnSpacing: 10,
      dataRowMinHeight: 28,
      dataRowMaxHeight: 44,
      headingRowHeight: 36,
      headingRowColor: WidgetStateProperty.all(AppTheme.darkBase),
      columns: const [
        DataColumn(label: Text('MES', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary, fontSize: 10))),
        DataColumn(label: Text('OBJETIVO', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary, fontSize: 10))),
        DataColumn(label: Text('VENTA', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary, fontSize: 10))),
        DataColumn(label: Text('EST.', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary, fontSize: 10))),
        DataColumn(label: Text('%', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary, fontSize: 10))),
        DataColumn(label: Text('COMISIÓN', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonGreen, fontSize: 10))),
        DataColumn(label: Text('DÍAS', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple, fontSize: 10))),
        DataColumn(label: Text('OBJ.AC', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple, fontSize: 10))),
        DataColumn(label: Text('RITMO', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple, fontSize: 10))),
        DataColumn(label: Text('DIFF', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple, fontSize: 10))),
        DataColumn(label: Text('COM.PRV', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple, fontSize: 10))),
      ],
      rows: rows,
    );
  }

  DataRow _buildMonthRow(dynamic m, bool isExcluded) {
    final monthNum = m['month'] as int;
    final target = (m['target'] as num?)?.toDouble() ?? 0;
    final actual = (m['actual'] as num?)?.toDouble() ?? 0;
    final isFuture = (m['isFuture'] as bool?) ?? false;

    final ctx = m['complianceCtx'] ?? {};
    final pct = (ctx['pct'] as num?)?.toDouble() ?? 0;
    final tier = (ctx['tier'] as num?)?.toInt() ?? 0;
    final commission = (ctx['commission'] as num?)?.toDouble() ?? 0;

    final workingDays = (m['workingDays'] as num?)?.toInt() ?? 0;
    final daysPassed = (m['daysPassed'] as num?)?.toInt() ?? 0;
    final proRatedTarget = (m['proRatedTarget'] as num?)?.toDouble() ?? 0;

    final dailyCtx = m['dailyComplianceCtx'] ?? {};
    final dailyGreen = (dailyCtx['isGreen'] as bool?) ?? false;
    final provisionalCommission = (dailyCtx['provisionalCommission'] as num?)?.toDouble() ?? 0;
    final dailyPct = (dailyCtx['pct'] as num?)?.toDouble() ?? 0;

    final isPositive = actual >= target && target > 0;
    final color = isFuture || isExcluded ? Colors.grey : (isPositive ? AppTheme.success : AppTheme.error);
    final dailyColor = isFuture || isExcluded ? Colors.grey : (dailyGreen ? AppTheme.success : Colors.orangeAccent);
    final textOpacity = (isFuture || isExcluded) ? 0.5 : 1.0;

    final pctDisplay = pct > 0 ? (pct - 100) : 0;
    final pctText = isFuture ? '-' : (pct > 100 ? '+${pctDisplay.toStringAsFixed(1)}%' : '${pct.toStringAsFixed(1)}%');
    final dailyPctDisplay = dailyPct > 0 ? (dailyPct - 100) : 0;
    final dailyPctText = dailyPct > 100 ? '+${dailyPctDisplay.toStringAsFixed(1)}%' : '${dailyPct.toStringAsFixed(1)}%';

    return DataRow(
      color: WidgetStateProperty.all(isFuture ? Colors.black26 : Colors.transparent),
      cells: [
        DataCell(Row(mainAxisSize: MainAxisSize.min, children: [
          Text(widget.getMonthName(monthNum), style: TextStyle(color: Colors.white.withOpacity(textOpacity), fontSize: 11)),
          if (isFuture) ...[
            const SizedBox(width: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
              decoration: BoxDecoration(color: Colors.grey.withOpacity(0.3), borderRadius: BorderRadius.circular(3)),
              child: const Text('PEND', style: TextStyle(fontSize: 7, color: Colors.grey)),
            )
          ]
        ])),
        DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(target), style: TextStyle(color: Colors.white.withOpacity(textOpacity), fontSize: 10))),
        DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(actual), style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 10))),
        DataCell(isFuture ? const Text('-', style: TextStyle(color: Colors.grey, fontSize: 10)) : Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(isPositive ? Icons.check_circle : Icons.cancel, color: color, size: 12),
          if (isPositive && tier > 0) Text(' F$tier', style: const TextStyle(fontSize: 8, color: AppTheme.neonBlue)),
        ])),
        DataCell(Text(pctText, style: TextStyle(color: color, fontSize: 9))),
        DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(commission), style: TextStyle(color: isFuture ? Colors.grey : AppTheme.neonGreen, fontWeight: FontWeight.bold, fontSize: 10))),
        DataCell(Text(isFuture ? '-' : '$daysPassed/$workingDays', style: TextStyle(color: Colors.white.withOpacity(textOpacity * 0.7), fontSize: 9))),
        DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(proRatedTarget), style: TextStyle(fontSize: 9, color: Colors.white.withOpacity(textOpacity)))),
        DataCell(isFuture ? const Text('-', style: TextStyle(color: Colors.grey, fontSize: 9)) : Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(dailyGreen ? Icons.check_circle : Icons.warning_amber, color: dailyColor, size: 10),
          Text(' $dailyPctText', style: TextStyle(fontSize: 8, color: dailyColor)),
        ])),
        DataCell(isFuture ? const Text('-', style: TextStyle(color: Colors.grey, fontSize: 9)) : Text(
          (actual - proRatedTarget) >= 0 ? '+${CurrencyFormatter.format(actual - proRatedTarget)}' : CurrencyFormatter.format(actual - proRatedTarget),
          style: TextStyle(color: (actual - proRatedTarget) >= 0 ? AppTheme.success : AppTheme.error, fontWeight: FontWeight.bold, fontSize: 9),
        )),
        DataCell(isFuture ? const Text('-', style: TextStyle(color: Colors.grey, fontSize: 9)) : Text(
          CurrencyFormatter.format(provisionalCommission),
          style: TextStyle(color: provisionalCommission > 0 ? AppTheme.neonPurple : Colors.grey, fontWeight: FontWeight.bold, fontSize: 9),
        )),
      ],
    );
  }

  DataRow _buildQuarterRow(Map<String, dynamic> qr, dynamic qData, bool isExcluded) {
    final name = qr['name'] as String;
    final label = qr['label'] as String;
    final commission = (qData?['commission'] as num?)?.toDouble() ?? 0;
    final additional = (qData?['additionalPayment'] as num?)?.toDouble() ?? 0;
    final total = commission + additional;

    return DataRow(
      color: WidgetStateProperty.all(AppTheme.neonPurple.withOpacity(0.1)),
      cells: [
        DataCell(Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.calendar_view_month, color: AppTheme.neonPurple, size: 14),
          const SizedBox(width: 4),
          Text(name, style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonPurple, fontSize: 10)),
          const SizedBox(width: 4),
          Text('($label)', style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 9)),
        ])),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        DataCell(Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Gen: ${CurrencyFormatter.format(total)}', style: TextStyle(fontSize: 9, color: isExcluded ? Colors.grey : Colors.white70)),
            Text('Pag: ${CurrencyFormatter.format(commission)}', style: TextStyle(fontSize: 10, color: isExcluded ? Colors.grey : AppTheme.neonGreen, fontWeight: FontWeight.bold)),
          ],
        )),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
      ],
    );
  }
}
