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
      
      final code = filterCode ?? defaultCode;
      
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
              _buildStep('📊 Objetivo = Ventas 2025 + 3% IPC', 
                  'Tu objetivo 2026 es lo que vendiste en 2025 más un 3%.\nEjemplo: 100.000€ (2025) → 103.000€ Objetivo (2026).'),
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

    // ... vars ...
    final months = _data?['months'] as List? ?? [];
    final quarters = _data?['quarters'] as List? ?? [];
    final status = _data?['status'] as String? ?? 'active';
    final isInformative = status == 'informative';
    final grandTotal = (_data?['totals']?['commission'] as num?)?.toDouble() ?? 0;

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
             lastSync: _lastFetchTime,
             isLoading: _isLoading,
             onSync: _loadData,
             error: _error,
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
             // Tier legend removed - available in info modal (ℹ️ button)
             // Warning for ALL mode
              if (context.watch<FilterProvider>().selectedVendor == '' || context.watch<FilterProvider>().selectedVendor == null)
               Container(
                 margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                 padding: const EdgeInsets.all(10),
                 decoration: BoxDecoration(
                   color: Colors.orange.withOpacity(0.1),
                   borderRadius: BorderRadius.circular(8),
                   border: Border.all(color: Colors.orange.withOpacity(0.3)),
                 ),
                 child: Row(
                   children: [
                     const Icon(Icons.info_outline, color: Colors.orange, size: 18),
                     const SizedBox(width: 8),
                     Expanded(
                       child: Text(
                         'Vista agregada: Los días de ritmo son orientativos (L-V estándar). Para datos precisos, consulte cada comercial individualmente o los Objetivos del mes completo.',
                         style: TextStyle(fontSize: 11, color: Colors.orange.shade200),
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
                     headingRowColor: MaterialStateProperty.all(AppTheme.surfaceColor.withOpacity(0.8)),
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
}
