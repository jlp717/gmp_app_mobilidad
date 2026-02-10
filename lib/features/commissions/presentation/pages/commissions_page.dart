import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/modern_loading.dart';
import '../../../../core/widgets/shimmer_skeleton.dart';
import '../../../../core/widgets/smart_sync_header.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../data/commissions_service.dart';
import 'package:provider/provider.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../../../core/providers/auth_provider.dart';


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



  Future<void> _loadData({bool forceRefresh = false}) async {
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

      final res = await CommissionsService.getSummary(
        vendedorCode: code,
        forceRefresh: forceRefresh,
      );
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

  /// Extracts month target/sales data for a vendor from current loaded _data
  Map<String, double> _getMonthDataForVendor(String vendorCode, int month) {
    double objetivoMes = 0;
    double ventasSobreObjetivo = 0;
    double ventaActual = 0;

    List? vendorMonths;
    final breakdown = (_data?['breakdown'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    if (breakdown.isNotEmpty) {
      final vendorData = breakdown.firstWhere(
        (v) => v['vendedorCode']?.toString() == vendorCode,
        orElse: () => <String, dynamic>{},
      );
      vendorMonths = vendorData['months'] as List?;
    } else {
      vendorMonths = _data?['months'] as List?;
    }

    if (vendorMonths != null) {
      final monthData = vendorMonths.cast<Map<String, dynamic>>().firstWhere(
        (m) => (m['month'] as num?)?.toInt() == month,
        orElse: () => <String, dynamic>{},
      );
      objetivoMes = (monthData['target'] as num?)?.toDouble() ?? 0;
      ventaActual = (monthData['actual'] as num?)?.toDouble() ?? 0;
      ventasSobreObjetivo = ventaActual - objetivoMes;
    }

    return {
      'objetivoMes': objetivoMes,
      'ventaActual': ventaActual,
      'ventasSobreObjetivo': ventasSobreObjetivo,
    };
  }

  Future<void> _showPayDialog(String vendorCode, String vendorName, double currentGenerated) async {
    final amountController = TextEditingController(text: currentGenerated.toStringAsFixed(2));
    final conceptController = TextEditingController(text: 'Pago Comisiones');
    final observacionesController = TextEditingController();
    int selectedMonth = DateTime.now().month;

    final adminCode = context.read<AuthProvider>().currentUser?.code ?? '';

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setStateDialog) {
          final currentAmount = double.tryParse(amountController.text) ?? 0;
          final observacionesRequired = currentAmount < currentGenerated && currentAmount > 0;

          return AlertDialog(
            backgroundColor: AppTheme.surfaceColor,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            title: Text('Pagar a $vendorName', style: const TextStyle(color: Colors.white)),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: amountController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Importe (\u20ac) *',
                      labelStyle: const TextStyle(color: Colors.white60),
                      helperText: 'Comision generada: ${currentGenerated.toStringAsFixed(2)} \u20ac',
                      helperStyle: const TextStyle(color: AppTheme.neonGreen, fontSize: 11),
                      enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.5))),
                    ),
                    onChanged: (val) => setStateDialog(() {}),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<int>(
                    value: selectedMonth,
                    dropdownColor: AppTheme.surfaceColor,
                    items: List.generate(12, (index) => DropdownMenuItem(
                      value: index + 1,
                      child: Text(_getMonthName(index + 1), style: const TextStyle(color: Colors.white)),
                    )),
                    onChanged: (val) => setStateDialog(() => selectedMonth = val!),
                    decoration: const InputDecoration(
                      labelText: 'Mes Correspondiente *',
                      labelStyle: TextStyle(color: Colors.white60),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: observacionesController,
                    style: const TextStyle(color: Colors.white),
                    maxLines: 3,
                    maxLength: 500,
                    decoration: InputDecoration(
                      labelText: observacionesRequired ? 'Observaciones * (OBLIGATORIO)' : 'Observaciones (Opcional)',
                      labelStyle: TextStyle(
                        color: observacionesRequired ? Colors.orange : Colors.white60,
                        fontWeight: observacionesRequired ? FontWeight.bold : FontWeight.normal,
                      ),
                      helperText: observacionesRequired
                          ? 'Debes explicar por que se paga menos de lo correspondiente'
                          : 'Notas adicionales sobre este pago',
                      helperStyle: TextStyle(
                        color: observacionesRequired ? Colors.orange : Colors.white38,
                        fontSize: 10,
                      ),
                      enabledBorder: UnderlineInputBorder(
                        borderSide: BorderSide(
                          color: observacionesRequired ? Colors.orange.withValues(alpha: 0.7) : AppTheme.neonBlue.withValues(alpha: 0.5),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: conceptController,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Concepto (Opcional)',
                      labelStyle: TextStyle(color: Colors.white60),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancelar', style: TextStyle(color: Colors.white60)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonBlue),
                onPressed: () {
                  final amount = double.tryParse(amountController.text) ?? 0;
                  if (amount <= 0) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('El importe debe ser mayor que 0'), backgroundColor: Colors.red),
                    );
                    return;
                  }
                  if (observacionesRequired && observacionesController.text.trim().isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Debes indicar una observacion explicando por que se paga menos'),
                        backgroundColor: Colors.orange,
                        duration: Duration(seconds: 4),
                      ),
                    );
                    return;
                  }

                  // Close input dialog, dispose controllers, open confirmation modal
                  Navigator.pop(ctx);

                  final capturedAmount = amount;
                  final capturedMonth = selectedMonth;
                  final capturedConcept = conceptController.text;
                  final capturedObs = observacionesController.text.trim();

                  // Dispose controllers to prevent memory leaks
                  amountController.dispose();
                  conceptController.dispose();
                  observacionesController.dispose();

                  final monthSnapshot = _getMonthDataForVendor(vendorCode, capturedMonth);

                  _showPayConfirmation(
                    vendorCode: vendorCode,
                    vendorName: vendorName,
                    month: capturedMonth,
                    amount: capturedAmount,
                    generatedAmount: currentGenerated,
                    concept: capturedConcept,
                    observaciones: capturedObs,
                    adminCode: adminCode,
                    objetivoMes: monthSnapshot['objetivoMes'] ?? 0,
                    ventaActual: monthSnapshot['ventaActual'] ?? 0,
                    ventasSobreObjetivo: monthSnapshot['ventasSobreObjetivo'] ?? 0,
                  );
                },
                child: const Text('Revisar y Confirmar', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
              ),
            ],
          );
        },
      ),
    );
  }

  /// Step 2: Confirmation modal with full details and safety warnings.
  /// Pagos son solo INSERT – no UPDATE. Snapshot historico intencional.
  Future<void> _showPayConfirmation({
    required String vendorCode,
    required String vendorName,
    required int month,
    required double amount,
    required double generatedAmount,
    required String concept,
    required String observaciones,
    required String adminCode,
    required double objetivoMes,
    required double ventaActual,
    required double ventasSobreObjetivo,
  }) async {
    final isPartialPay = amount < generatedAmount && amount > 0;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Colors.orange, size: 28),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Confirmar Registro de Pago',
                style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Estas a punto de registrar un pago de comision:',
                style: TextStyle(color: Colors.white70, fontSize: 13),
              ),
              const SizedBox(height: 16),
              _confirmRow('Comercial', vendorName),
              _confirmRow('Mes', '${_getMonthName(month)} / 2026'),
              const Divider(color: Colors.white12, height: 16),
              _confirmRow('Venta del mes', '${CurrencyFormatter.format(ventaActual)}'),
              _confirmRow('Objetivo del mes', '${CurrencyFormatter.format(objetivoMes)}'),
              _confirmRow('Ventas sobre objetivo', '${CurrencyFormatter.format(ventasSobreObjetivo)}',
                  valueColor: ventasSobreObjetivo >= 0 ? AppTheme.neonGreen : AppTheme.error),
              const Divider(color: Colors.white12, height: 16),
              _confirmRow('Comision generada', '${CurrencyFormatter.format(generatedAmount)}'),
              _confirmRow('Importe a pagar', '${CurrencyFormatter.format(amount)}',
                  valueColor: isPartialPay ? Colors.orange : AppTheme.neonGreen),
              _confirmRow('Observaciones', observaciones.isEmpty ? 'Ninguna' : observaciones),
              const SizedBox(height: 12),

              if (isPartialPay)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.red.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.withOpacity(0.4)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.warning, color: Colors.red, size: 18),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'PAGO PARCIAL \u2013 se ha indicado observacion',
                          style: TextStyle(color: Colors.red, fontSize: 12, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 12),

              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.blue.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'Este pago se guardara como un nuevo registro historico (snapshot). '
                  'No se puede modificar despues.',
                  style: TextStyle(color: Colors.lightBlue, fontSize: 11),
                ),
              ),
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.blue.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'Los valores de ventas/objetivo/comision son una foto del momento '
                  'y pueden diferir de datos futuros.',
                  style: TextStyle(color: Colors.lightBlue, fontSize: 11),
                ),
              ),
            ],
          ),
        ),
        actionsPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        actions: [
          SizedBox(
            width: double.infinity,
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(ctx),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red,
                      side: const BorderSide(color: Colors.red),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: const Text('CANCELAR', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.neonGreen,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    onPressed: () async {
                      Navigator.pop(ctx);
                      try {
                        final res = await CommissionsService.payCommission(
                          vendedorCode: vendorCode,
                          year: 2026,
                          month: month,
                          amount: amount,
                          generatedAmount: generatedAmount,
                          concept: concept,
                          adminCode: adminCode,
                          observaciones: observaciones,
                          objetivoMes: objetivoMes,
                          ventasSobreObjetivo: ventasSobreObjetivo,
                        );

                        if (mounted && res['success'] == true) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Pago registrado correctamente'), backgroundColor: Colors.green),
                          );
                          _loadData(forceRefresh: true);
                        } else {
                          throw Exception(res['error'] ?? 'Error desconocido');
                        }
                      } catch (e) {
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
                          );
                        }
                      }
                    },
                    child: const Text(
                      'CONFIRMAR Y REGISTRAR PAGO',
                      style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 13),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _confirmRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 150,
            child: Text('$label:', style: const TextStyle(color: Colors.white54, fontSize: 12)),
          ),
          Expanded(
            child: Text(value, style: TextStyle(color: valueColor ?? Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
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
    // Check if we're in ALL mode (breakdown available)
    final breakdown = (_data?['breakdown'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final isAllMode = breakdown.isNotEmpty;

    // ... vars ...
    final months = _data?['months'] as List? ?? [];
    final quarters = _data?['quarters'] as List? ?? [];
    final status = _data?['status'] as String? ?? 'active';
    final isInformative = status == 'informative';
    final grandTotal = (_data?['grandTotalCommission'] as num?)?.toDouble() ?? 
                       (_data?['totals']?['commission'] as num?)?.toDouble() ?? 0.0;
    // Payments Data
    final paymentsData = (_data?['payments'] as Map?) ?? {};
    final totalPaid = (paymentsData['total'] as num?)?.toDouble() ?? 0.0;
    
    // Monthly paid for current month
    final now = DateTime.now();
    final currentMonthKey = now.month.toString();
    final monthlyPaidMap = (paymentsData['monthly'] as Map?) ?? {};
    final paidThisMonth = (monthlyPaidMap[currentMonthKey] as num?)?.toDouble() ?? 0.0;

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

    // Get payment authorization status
    final authProvider = context.watch<AuthProvider>();
    final curUserCode = authProvider.currentUser?.code?.trim() ?? '';
    // Allow payment for ADMIN users or specifically DIEGO (code 98)
    final normalizedCode = curUserCode.replaceFirst(RegExp(r'^0+'), '');
    final canPay = authProvider.currentUser?.tipoVendedor == 'ADMIN' 
        || normalizedCode == '98';


    // Prepare table rows (interleaving quarters)
    final rows = <DataRow>[];
    
    // Sort months just in case
    months.sort((a, b) => ((a['month'] as num?)?.toInt() ?? 0).compareTo((b['month'] as num?)?.toInt() ?? 0));


    // Helper to add month row
    void addMonthRow(Map<String, dynamic> m) {
      final monthNum = (m['month'] as num?)?.toInt() ?? 0;
      final monthName = _getMonthName(monthNum);
      final target = (m['target'] as num?)?.toDouble() ?? 0;
      final actual = (m['actual'] as num?)?.toDouble() ?? 0;
      final isFuture = (m['isFuture'] as bool?) ?? false;
      
      final Map<dynamic, dynamic> ctx = (m['complianceCtx'] as Map?) ?? {};
      final pct = (ctx['pct'] as num?)?.toDouble() ?? 0;
      final tier = (ctx['tier'] as num?)?.toInt() ?? 0;
      final commission = (ctx['commission'] as num?)?.toDouble() ?? 0;
      
      final workingDays = (m['workingDays'] as num?)?.toInt() ?? 0;
      final dailyTarget = (m['dailyTarget'] as num?)?.toDouble() ?? 0;
      final dailyActual = (m['dailyActual'] as num?)?.toDouble() ?? 0;
      final Map<dynamic, dynamic> dailyCtx = (m['dailyComplianceCtx'] as Map?) ?? {};
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
          // === PAGOS (NEW) ===
          // IMPORTE PAGADO
          DataCell(Builder(builder: (context) {
            final detailsMap = paymentsData['details'] as Map?;
            final details = detailsMap?[monthNum] ?? detailsMap?['$monthNum'] ?? detailsMap?[monthNum.toString()];
            final importePagado = ((details as Map?)?['totalPaid'] as num?)?.toDouble() ?? 0;
            return importePagado > 0
                ? Text(
                    CurrencyFormatter.format(importePagado),
                    style: const TextStyle(color: AppTheme.neonGreen, fontSize: 10, fontWeight: FontWeight.bold)
                  )
                : const Text('-', style: TextStyle(color: Colors.grey, fontSize: 10));
          })),
          // VENTA REAL (momento pago)
          DataCell(Builder(builder: (context) {
            final detailsMap = paymentsData['details'] as Map?;
            final details = detailsMap?[monthNum] ?? detailsMap?['$monthNum'] ?? detailsMap?[monthNum.toString()];
            final ventaComision = ((details as Map?)?['ventaComision'] as num?)?.toDouble() ?? 0;
            return ventaComision > 0
                ? Text(
                    CurrencyFormatter.format(ventaComision),
                    style: const TextStyle(color: AppTheme.neonBlue, fontSize: 10, fontWeight: FontWeight.bold)
                  )
                : const Text('-', style: TextStyle(color: Colors.grey, fontSize: 10));
          })),
          // OBJ. REAL (snapshot al momento del pago)
          DataCell(Builder(builder: (context) {
            final detailsMap = paymentsData['details'] as Map?;
            final details = detailsMap?[monthNum] ?? detailsMap?['$monthNum'] ?? detailsMap?[monthNum.toString()];
            final objetivoReal = ((details as Map?)?['objetivoReal'] as num?)?.toDouble() ?? 0;
            return objetivoReal > 0
                ? Text(
                    CurrencyFormatter.format(objetivoReal),
                    style: const TextStyle(color: Colors.amber, fontSize: 10, fontWeight: FontWeight.bold)
                  )
                : const Text('-', style: TextStyle(color: Colors.grey, fontSize: 10));
          })),
          // OBSERVACIONES
          DataCell(Builder(builder: (context) {
            final detailsMap = paymentsData['details'] as Map?;
            final details = detailsMap?[monthNum] ?? detailsMap?['$monthNum'] ?? detailsMap?[monthNum.toString()];
            final observaciones = ((details as Map?)?['observaciones'] as List?)?.join(' | ') ?? '';
            return observaciones.isNotEmpty
                ? Tooltip(
                    message: observaciones,
                    child: Container(
                      constraints: const BoxConstraints(maxWidth: 150),
                      child: Text(
                        observaciones,
                        style: const TextStyle(color: Colors.orange, fontSize: 10, fontStyle: FontStyle.italic),
                        overflow: TextOverflow.ellipsis,
                        maxLines: 2,
                      ),
                    ),
                  )
                : const Text('-', style: TextStyle(color: Colors.grey, fontSize: 10));
          })),
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

       // Calculate REAL paid for this quarter from paymentsData
       final qMonthRanges = {
         0: [1, 2, 3, 4],
         1: [5, 6, 7, 8],
         2: [9, 10, 11, 12],
       };
       final qMonths = qMonthRanges[qIndex] ?? [];
       double quarterPaid = 0;
       final monthlyPaidMap = (paymentsData['monthly'] as Map?) ?? {};
       for (final m in qMonths) {
         quarterPaid += (monthlyPaidMap[m] as num?)?.toDouble()
             ?? (monthlyPaidMap['$m'] as num?)?.toDouble()
             ?? (monthlyPaidMap[m.toString()] as num?)?.toDouble()
             ?? 0;
       }

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
                  Text('Pagado: ${CurrencyFormatter.format(quarterPaid)}', style: TextStyle(fontSize: 12, color: isPast ? Colors.white60 : AppTheme.neonGreen, fontWeight: FontWeight.bold)),
                ]
            )),
            const DataCell(SizedBox()), // DÍAS
            const DataCell(SizedBox()), // OBJ. ACUM.
            const DataCell(SizedBox()), // RITMO
            const DataCell(SizedBox()), // DIFF
            const DataCell(SizedBox()), // COM. PROV.
            const DataCell(SizedBox()), // IMP. PAGADO (NEW)
            const DataCell(SizedBox()), // VENTA REAL (NEW)
            const DataCell(SizedBox()), // OBJ. REAL (NEW)
            const DataCell(SizedBox()), // OBSERVACIONES (NEW)
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
             onSync: () => _loadData(forceRefresh: true),
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
                         Column(
                           crossAxisAlignment: CrossAxisAlignment.end,
                           children: [
                             Text('Generado: ${CurrencyFormatter.format(grandTotal)}',
                               style: const TextStyle(color: AppTheme.neonGreen, fontSize: 13, fontWeight: FontWeight.bold)),
                             const SizedBox(height: 2),
                             Text('Pagado: ${CurrencyFormatter.format(totalPaid)}',
                               style: const TextStyle(color: AppTheme.neonBlue, fontSize: 11, fontWeight: FontWeight.bold)),
                           ],
                         ),
                     ],
                   ),
                 ),
                 if (canPay && !isAllMode)
                   IconButton(
                     icon: const Icon(Icons.payment_rounded, color: AppTheme.neonBlue, size: 28),
                     // We need the ID/Code of the current single vendor
                     onPressed: () => _showPayDialog(_data?['vendor'] ?? widget.employeeCode.split(',').first, 'Vendedor', grandTotal),
                     tooltip: 'Registrar Pago',
                   ),
                 IconButton(
                   icon: const Icon(Icons.info_outline, color: AppTheme.neonBlue),
                   onPressed: _showExplanationModal,
                   tooltip: 'Explicación cálculo',
                 ),
               ],
             ),
           ),
           
           // FASE 2: Inline exclusion banner instead of full screen block
           if ((_data?['isExcluded'] as bool?) ?? false)
             Container(
               width: double.infinity,
               margin: const EdgeInsets.all(12),
               padding: const EdgeInsets.all(12),
               decoration: BoxDecoration(
                 color: Colors.orange.withOpacity(0.1),
                 borderRadius: BorderRadius.circular(8),
                 border: Border.all(color: Colors.orange.withOpacity(0.3)),
               ),
               child: const Row(
                 children: [
                   Icon(Icons.money_off_rounded, color: Colors.orange, size: 20),
                   SizedBox(width: 8),
                   Expanded(
                     child: Text(
                       'Este comercial no participa en el plan de comisiones',
                       style: TextStyle(color: Colors.orange, fontSize: 13, fontWeight: FontWeight.bold),
                     ),
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
             // OPTIMIZATION: Use SkeletonList for perceived performance
             child: _isLoading 
               ? const Padding(
                   padding: EdgeInsets.all(16.0),
                   child: SkeletonList(itemCount: 6, itemHeight: 60),
                 )
             : _error != null ? Center(child: Text('Error: $_error', style: const TextStyle(color: AppTheme.error)))
             : isAllMode
               ? _buildAllVendorsTable(breakdown)  // Show ALL vendors table
             : totalTarget <= 0 && !isInformative // ZERO TARGET WARNING
               ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.search_off_rounded, size: 56, color: Colors.white24),
                        const SizedBox(height: 16),
                        const Text(
                          'No se han encontrado comisiones para los filtros seleccionados',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white54, fontSize: 16, fontWeight: FontWeight.w500),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Prueba a seleccionar otro comercial o verifica que existan datos de ventas disponibles.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white38, fontSize: 13),
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
                        // === PAGOS (NEW) ===
                        DataColumn(label: Text('IMP. PAGADO', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue))),
                        DataColumn(label: Text('VENTA REAL', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue))),
                        DataColumn(label: Text('OBJ. REAL', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue))),
                        DataColumn(label: Text('OBSERVACIONES', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue))),
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

  Widget _buildAllVendorsTable(List<dynamic> breakdown) {
    if (breakdown.isEmpty) {
      return const Center(child: Text('No hay datos disponibles', style: TextStyle(color: Colors.white54)));
    }

    try {
      // Sort by grand total descending, handle nulls defensively
      final List<Map<String, dynamic>> sorted = List<Map<String, dynamic>>.from(breakdown);
      sorted.sort((a, b) {
        final valA = (a['grandTotalCommission'] as num?)?.toDouble() ?? 0.0;
        final valB = (b['grandTotalCommission'] as num?)?.toDouble() ?? 0.0;
        return valB.compareTo(valA); // Descending
      });

      // Get payment authorization status
      final authProvider = context.watch<AuthProvider>();
      final curCode = (authProvider.currentUser?.code?.trim() ?? '').replaceFirst(RegExp(r'^0+'), '');
      final canPay = authProvider.currentUser?.tipoVendedor == 'ADMIN'
          || curCode == '98';

      return Container(
        color: AppTheme.darkBase,
        child: ListView.builder(
          itemCount: sorted.length,
          itemBuilder: (context, index) {
          try {
            final r = sorted[index];
            final grandTotal = (r['grandTotalCommission'] as num?)?.toDouble() ?? 0.0;
            return _VendorExpandableCard(
              data: r,
              canPay: canPay,
              getMonthName: _getMonthName,
              onPay: (code, name) => _showPayDialog(code, name, grandTotal),
            );
          } catch (itemErr) {
             debugPrint('Error rendering vendor card index $index: $itemErr');
             return Container(
               padding: const EdgeInsets.all(8),
               color: Colors.red.withOpacity(0.1),
               child: Text('Error mostrando vendedor: ${sorted[index]['vendedorCode'] ?? '?'}', style: const TextStyle(color: Colors.red)),
             );
          }
        },
      ),
    );
    } catch (e) {
      debugPrint('Error sorting/building vendors table: $e');
       return Center(child: Text('Error mostrando lista: $e', style: const TextStyle(color: Colors.red)));
    }
  }
}

/// Expandable card for each vendor in ALL mode
class _VendorExpandableCard extends StatefulWidget {
  final Map<String, dynamic> data;
  final bool canPay;
  final String Function(int) getMonthName;
  final Function(String, String)? onPay;

  const _VendorExpandableCard({
    super.key,
    required this.data,
    this.canPay = false,
    required this.getMonthName,
    this.onPay,
  });

  @override
  State<_VendorExpandableCard> createState() => _VendorExpandableCardState();
}

class _VendorExpandableCardState extends State<_VendorExpandableCard> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final vendorCode = data['vendedorCode']?.toString() ?? '???';
    final vendorName = data['vendorName']?.toString() ?? 'Vendedor';
    final isExcluded = (data['isExcluded'] as bool?) ?? false;
    final grandTotal = (data['grandTotalCommission'] as num?)?.toDouble() ?? 0;

    final payments = (data['payments'] as Map?) ?? {};
    final totalPaid = (payments['total'] as num?)?.toDouble() ?? 0;
    final months = (data['months'] as List?) ?? [];
    final quarters = (data['quarters'] as List?) ?? [];

    // Calculate vendor totals (only non-future months for meaningful %)
    double totalTarget = 0, totalActual = 0;
    for (var m in months) {
      final isFuture = (m['isFuture'] as bool?) ?? false;
      if (!isFuture) {
        totalTarget += (m['target'] as num?)?.toDouble() ?? 0;
        totalActual += (m['actual'] as num?)?.toDouble() ?? 0;
      }
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
                   // Left: Circle Avatar with Vendor Code
                  CircleAvatar(
                    radius: 12,
                    backgroundColor: isExcluded ? Colors.grey.withOpacity(0.2) : AppTheme.neonBlue.withOpacity(0.1),
                    child: Text(vendorCode, style: TextStyle(fontWeight: FontWeight.bold, color: isExcluded ? Colors.grey : AppTheme.neonBlue, fontSize: 10)),
                  ),
                  const SizedBox(width: 8),

                  // Center: Name
                  Expanded(
                    child: Text(vendorName, style: TextStyle(fontWeight: FontWeight.bold, color: isExcluded ? Colors.grey : Colors.white, fontSize: 13), overflow: TextOverflow.ellipsis),
                  ),
                  const SizedBox(width: 8),
                  if (isExcluded) ...[
                    // Clear "NO COMISIONA" badge for excluded vendors
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(color: Colors.orange.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                      child: const Text('NO COMISIONA', style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Colors.orange)),
                    ),
                    const SizedBox(width: 8),
                  ],
                  // Compliance: Obj vs Venta for active months only
                  Tooltip(
                    message: 'Cumplimiento acumulado: Venta real vs Objetivo (solo meses activos)',
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(vendorPositive ? Icons.trending_up : Icons.trending_down, color: statusColor, size: 14),
                        const SizedBox(width: 2),
                        Text('${vendorPct.toStringAsFixed(1)}%', style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 12)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Commission & Payment
                  if (!isExcluded) ...[
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                         // Calculate "Paid Month" if possible. Default to 0 if not found for current month.
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                             Text('Generado: ${CurrencyFormatter.format(grandTotal)}', style: const TextStyle(color: AppTheme.neonGreen, fontWeight: FontWeight.bold, fontSize: 12)),
                             Text('Pagado: ${CurrencyFormatter.format(totalPaid)}',
                               style: const TextStyle(color: AppTheme.neonBlue, fontWeight: FontWeight.bold, fontSize: 9)),
                          ],
                        ),
                      ],
                    ),
                    if (widget.canPay)
                       Padding(
                         padding: const EdgeInsets.only(left: 8.0),
                         child: IconButton(
                           icon: const Icon(Icons.payment_rounded, color: AppTheme.neonBlue, size: 22),
                           onPressed: () => widget.onPay?.call(vendorCode, vendorName),
                           tooltip: 'Pagar',
                           padding: EdgeInsets.zero,
                           constraints: const BoxConstraints(),
                         ),
                       ),
                  ] else
                    Text('0,00 €', style: TextStyle(color: Colors.grey, fontSize: 12)),
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
    sortedMonths.sort((a, b) => ((a['month'] as num?)?.toInt() ?? 0).compareTo((b['month'] as num?)?.toInt() ?? 0));

    // Quarter definitions: Q1 = Ene-Abr, Q2 = May-Ago, Q3 = Sep-Dic
    const quarterRanges = [
      {'name': 'CUATRIMESTRE 1', 'label': 'Ene - Abr', 'start': 1, 'end': 4},
      {'name': 'CUATRIMESTRE 2', 'label': 'May - Ago', 'start': 5, 'end': 8},
      {'name': 'CUATRIMESTRE 3', 'label': 'Sep - Dic', 'start': 9, 'end': 12},
    ];

    int quarterIndex = 0;

    for (final m in sortedMonths) {
      final monthNum = (m['month'] as num?)?.toInt() ?? 0;

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
        DataColumn(label: Text('IMP.PAG', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue, fontSize: 10))),
        DataColumn(label: Text('V.REAL', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue, fontSize: 10))),
        DataColumn(label: Text('OBJ.REAL', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue, fontSize: 10))),
        DataColumn(label: Text('OBSERV.', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue, fontSize: 10))),
      ],
      rows: rows,
    );
  }

  DataRow _buildMonthRow(dynamic m, bool isExcluded) {
    final monthNum = (m['month'] as num?)?.toInt() ?? 0;
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
        // === PAGOS (NEW) ===
        // IMPORTE PAGADO
        DataCell(Builder(builder: (context) {
          final payments = widget.data['payments'] as Map?;
          final detailsMap = payments?['details'] as Map?;
          final details = detailsMap?[monthNum] ?? detailsMap?['$monthNum'] ?? detailsMap?[monthNum.toString()];
          final importePagado = ((details as Map?)?['totalPaid'] as num?)?.toDouble() ?? 0;
          return importePagado > 0
              ? Text(
                  CurrencyFormatter.format(importePagado),
                  style: const TextStyle(color: AppTheme.neonGreen, fontSize: 9, fontWeight: FontWeight.bold)
                )
              : const Text('-', style: TextStyle(color: Colors.grey, fontSize: 9));
        })),
        // VENTA REAL (momento pago)
        DataCell(Builder(builder: (context) {
          final payments = widget.data['payments'] as Map?;
          final detailsMap = payments?['details'] as Map?;
          final details = detailsMap?[monthNum] ?? detailsMap?['$monthNum'] ?? detailsMap?[monthNum.toString()];
          final ventaComision = ((details as Map?)?['ventaComision'] as num?)?.toDouble() ?? 0;
          return ventaComision > 0
              ? Text(
                  CurrencyFormatter.format(ventaComision),
                  style: const TextStyle(color: AppTheme.neonBlue, fontSize: 9, fontWeight: FontWeight.bold)
                )
              : const Text('-', style: TextStyle(color: Colors.grey, fontSize: 9));
        })),
        // OBJ. REAL (snapshot al momento del pago)
        DataCell(Builder(builder: (context) {
          final payments = widget.data['payments'] as Map?;
          final detailsMap = payments?['details'] as Map?;
          final details = detailsMap?[monthNum] ?? detailsMap?['$monthNum'] ?? detailsMap?[monthNum.toString()];
          final objetivoReal = ((details as Map?)?['objetivoReal'] as num?)?.toDouble() ?? 0;
          return objetivoReal > 0
              ? Text(
                  CurrencyFormatter.format(objetivoReal),
                  style: const TextStyle(color: Colors.amber, fontSize: 9, fontWeight: FontWeight.bold)
                )
              : const Text('-', style: TextStyle(color: Colors.grey, fontSize: 9));
        })),
        // OBSERVACIONES
        DataCell(Builder(builder: (context) {
          final payments = widget.data['payments'] as Map?;
          final detailsMap = payments?['details'] as Map?;
          final details = detailsMap?[monthNum] ?? detailsMap?['$monthNum'] ?? detailsMap?[monthNum.toString()];
          final observaciones = ((details as Map?)?['observaciones'] as List?)?.join(' | ') ?? '';
          return observaciones.isNotEmpty
              ? Tooltip(
                  message: observaciones,
                  child: Container(
                    constraints: const BoxConstraints(maxWidth: 120),
                    child: Text(
                      observaciones,
                      style: const TextStyle(color: Colors.orange, fontSize: 9, fontStyle: FontStyle.italic),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  ),
                )
              : const Text('-', style: TextStyle(color: Colors.grey, fontSize: 9));
        })),
      ],
    );
  }

  DataRow _buildQuarterRow(Map<String, dynamic> qr, dynamic qData, bool isExcluded) {
    final name = qr['name'] as String;
    final label = qr['label'] as String;
    final commission = (qData?['commission'] as num?)?.toDouble() ?? 0;
    final additional = (qData?['additionalPayment'] as num?)?.toDouble() ?? 0;
    final total = commission + additional;

    // Calculate REAL paid for this quarter from vendor payment data
    final startMonth = qr['start'] as int;
    final endMonth = qr['end'] as int;
    final payments = widget.data['payments'] as Map?;
    final monthlyPaidMap = (payments?['monthly'] as Map?) ?? {};
    double quarterPaid = 0;
    for (int m = startMonth; m <= endMonth; m++) {
      quarterPaid += (monthlyPaidMap[m] as num?)?.toDouble()
          ?? (monthlyPaidMap['$m'] as num?)?.toDouble()
          ?? (monthlyPaidMap[m.toString()] as num?)?.toDouble()
          ?? 0;
    }

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
            Text('Pag: ${CurrencyFormatter.format(quarterPaid)}', style: TextStyle(fontSize: 10, color: isExcluded ? Colors.grey : AppTheme.neonGreen, fontWeight: FontWeight.bold)),
          ],
        )),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()), // IMP. PAGADO (NEW)
        const DataCell(SizedBox()), // VENTA REAL (NEW)
        const DataCell(SizedBox()), // OBJ. REAL (NEW)
        const DataCell(SizedBox()), // OBSERVACIONES (NEW)
      ],
    );
  }
}
