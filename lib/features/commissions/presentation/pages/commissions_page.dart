import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/utils/vendor_scope.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart';
import 'package:gmp_app_mobilidad/features/commissions/data/commissions_service.dart';
import 'package:gmp_app_mobilidad/features/commissions/presentation/widgets/pdf_range_dialog.dart';

BoxDecoration _commissionSurfaceDecoration({
  Color color = AppTheme.raisedSurface,
  Color borderColor = AppTheme.borderColor,
  double borderAlpha = 1,
  double radius = AppTheme.radiusMd,
}) {
  final hasVisibleSurface = color != Colors.transparent;
  return BoxDecoration(
    color: color,
    gradient: hasVisibleSurface
        ? LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              color,
              AppTheme.softPanel.withValues(alpha: 0.88),
              borderColor.withValues(alpha: 0.035),
            ],
          )
        : null,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: borderColor.withValues(alpha: borderAlpha)),
    boxShadow: hasVisibleSurface
        ? [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.12),
              blurRadius: 12,
              offset: const Offset(0, 5),
            ),
          ]
        : null,
  );
}

class CommissionsPage extends ConsumerStatefulWidget {
  const CommissionsPage(
      {required this.employeeCode,
      super.key,
      this.isJefeVentas = false,
      this.vendorSelectorCodes,
      this.includeAllVendorOption = true,
      this.forceShowVendorSelector = false});
  final String employeeCode;
  final bool isJefeVentas;
  final List<String>? vendorSelectorCodes;
  final bool includeAllVendorOption;
  final bool forceShowVendorSelector;

  @override
  ConsumerState<CommissionsPage> createState() => _CommissionsPageState();
}

class _CommissionsPageState extends ConsumerState<CommissionsPage> {
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic>? _data;
  DateTime? _lastFetchTime;
  bool _isInitialized = false;
  ProviderSubscription<String?>? _vendorSubscription;
  int _loadGeneration = 0;

  // Jefe View
  bool _isLoggedCommercial80() {
    final user = ref.read(authProvider).value?.user;
    return isCommercial80Code(user?.code);
  }

  Map<String, dynamic> _hiddenCommissionsData() => const {
        'success': true,
        'status': 'hidden',
        'hiddenForCommercial80': true,
        'grandTotalCommission': 0,
        'totals': {'commission': 0},
        'breakdown': [],
        'months': [],
        'quarters': [],
        'payments': {
          'monthly': {},
          'quarterly': {},
          'details': {},
          'total': 0,
        },
      };

  @override
  void initState() {
    super.initState();

    _isInitialized = true;
    _loadData();

    _vendorSubscription =
        ref.listenManual<String?>(selectedVendorProvider, (previous, next) {
      if (_isInitialized && previous != next) {
        _loadData();
      }
    });
  }

  @override
  void dispose() {
    _vendorSubscription?.close();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant CommissionsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.employeeCode != widget.employeeCode ||
        oldWidget.isJefeVentas != widget.isJefeVentas ||
        oldWidget.forceShowVendorSelector != widget.forceShowVendorSelector) {
      _loadData();
    }
  }

  Future<void> _loadData({bool forceRefresh = false}) async {
    final generation = ++_loadGeneration;
    if (_isLoggedCommercial80()) {
      if (!mounted) return;
      setState(() {
        _data = _hiddenCommissionsData();
        _isLoading = false;
        _error = null;
        _lastFetchTime = DateTime.now();
      });
      return;
    }
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final defaultCode = widget.employeeCode.split(',').first;

      // Use Provider if mounted, otherwise local fallback (init)
      String? filterCode;
      if (mounted) {
        filterCode = ref.read(selectedVendorProvider);
      }

      // For jefe de ventas: if no specific filter or 'ALL', request ALL vendors
      String code;
      final selectedCode =
          filterCode != null && filterCode.isNotEmpty && filterCode != 'ALL'
              ? filterCode
              : null;
      if (widget.isJefeVentas &&
          widget.includeAllVendorOption &&
          (filterCode == null || filterCode == '' || filterCode == 'ALL')) {
        code = 'ALL';
      } else {
        code = selectedCode ?? defaultCode;
      }

      final res = await CommissionsService.getSummary(
        vendedorCode: code,
        forceRefresh: forceRefresh,
      );
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _data = res;
        _isLoading = false;
        _lastFetchTime = DateTime.now();
      });
    } catch (e) {
      if (mounted && generation == _loadGeneration) {
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
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          side: const BorderSide(color: AppTheme.borderColor),
        ),
        title: const Row(
          children: [
            Icon(Icons.info_outline, color: AppTheme.info, size: 24),
            SizedBox(width: 8),
            Text('Cómo funcionan las comisiones',
                style: TextStyle(color: AppTheme.info, fontSize: 16)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: _commissionSurfaceDecoration(
                  color: AppTheme.info.withValues(alpha: 0.1),
                  borderColor: AppTheme.info,
                  borderAlpha: 0.32,
                ),
                child: const Text('⚠️ Todas las cifras son SIN IVA',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.info)),
              ),
              const SizedBox(height: 16),
              _buildStep(
                '📊 Objetivo Anual',
                'Tu objetivo se calcula en base a las ventas del año anterior más un pequeño porcentaje de incremento.',
              ),
              const SizedBox(height: 12),
              _buildStep(
                '✅ Estado Mensual',
                '• VERDE ✓ = Superas el objetivo del mes\n• ROJO ✗ = Por debajo del objetivo\n• Solo comisionas si superas el 100%',
              ),
              const SizedBox(height: 12),
              _buildStep(
                  'Franjas de Comisión',
                  'El % se aplica SOLO al exceso sobre el objetivo:\n\n'
                      '• Franja 1 (100-103%): 1.0%\n'
                      '• Franja 2 (103-106%): 1.3%\n'
                      '• Franja 3 (106-110%): 1.6%\n'
                      '• Franja 4 (>110%):    2.0%'),
              const SizedBox(height: 12),
              _buildStep(
                  'Ritmo Diario',
                  r'Compara tus ventas actuales vs. lo esperado al día de hoy:\n'
                      r'• ✓ Verde (Adelantado/En ritmo) = Vas por buen camino\n'
                      '• ⚠ Naranja (Rezagado) = Necesitas acelerar'),
              const SizedBox(height: 12),
              _buildStep(
                '🔒 Meses Pendientes',
                'Los meses futuros aparecen sombreados.\nSe "desbloquean" cuando llegue su fecha.',
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            style: TextButton.styleFrom(
              foregroundColor: AppTheme.info,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              ),
            ),
            child: const Text('Entendido',
                style: TextStyle(
                    color: AppTheme.info, fontWeight: FontWeight.bold)),
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
    double commissionMes = 0;

    List? vendorMonths;
    final breakdown =
        (_data?['breakdown'] as List?)?.cast<Map<String, dynamic>>() ?? [];
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
      // Get commission for THIS month from complianceCtx
      final ctx = monthData['complianceCtx'] as Map?;
      commissionMes = (ctx?['commission'] as num?)?.toDouble() ?? 0;
    }

    return {
      'objetivoMes': objetivoMes,
      'ventaActual': ventaActual,
      'ventasSobreObjetivo': ventasSobreObjetivo,
      'commissionMes': commissionMes,
    };
  }

  /// Returns a Set of months (1-12) already fully paid for a vendor.
  /// Partial or trivial payments (< 1 EUR) do not lock the month.
  Set<int> _getPaidMonthsForVendor(String vendorCode) {
    final paidMonths = <int>{};
    Map? paymentsMap;

    final breakdown =
        (_data?['breakdown'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    if (breakdown.isNotEmpty) {
      final vendorData = breakdown.firstWhere(
        (v) => v['vendedorCode']?.toString() == vendorCode,
        orElse: () => <String, dynamic>{},
      );
      paymentsMap = vendorData['payments'] as Map?;
    } else {
      paymentsMap = _data?['payments'] as Map?;
    }

    if (paymentsMap != null) {
      final monthly = (paymentsMap['monthly'] as Map?) ?? {};
      for (final entry in monthly.entries) {
        final monthNum = int.tryParse(entry.key.toString()) ?? 0;
        final paidAmount = (entry.value as num?)?.toDouble() ?? 0;
        if (monthNum <= 0 || paidAmount < 1.0) continue;

        final monthData = _getMonthDataForVendor(vendorCode, monthNum);
        final commission =
            (monthData['commissionMes'] as num?)?.toDouble() ?? 0;
        // Lock only when payment covers the generated commission (1 cent tolerance).
        if (commission <= 0 || paidAmount >= commission - 0.01) {
          paidMonths.add(monthNum);
        }
      }
    }
    return paidMonths;
  }

  /// Months with any prior payment (including partial/trivial) for warning UI.
  Set<int> _getMonthsWithAnyPayment(String vendorCode) {
    final monthsWithPayment = <int>{};
    Map? paymentsMap;

    final breakdown =
        (_data?['breakdown'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    if (breakdown.isNotEmpty) {
      final vendorData = breakdown.firstWhere(
        (v) => v['vendedorCode']?.toString() == vendorCode,
        orElse: () => <String, dynamic>{},
      );
      paymentsMap = vendorData['payments'] as Map?;
    } else {
      paymentsMap = _data?['payments'] as Map?;
    }

    if (paymentsMap != null) {
      final monthly = (paymentsMap['monthly'] as Map?) ?? {};
      for (final entry in monthly.entries) {
        final monthNum = int.tryParse(entry.key.toString()) ?? 0;
        final amount = (entry.value as num?)?.toDouble() ?? 0;
        if (monthNum > 0 && amount > 0) {
          monthsWithPayment.add(monthNum);
        }
      }
    }
    return monthsWithPayment;
  }

  double _getPaidAmountForMonth(String vendorCode, int month) {
    Map? paymentsMap;

    final breakdown =
        (_data?['breakdown'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    if (breakdown.isNotEmpty) {
      final vendorData = breakdown.firstWhere(
        (v) => v['vendedorCode']?.toString() == vendorCode,
        orElse: () => <String, dynamic>{},
      );
      paymentsMap = vendorData['payments'] as Map?;
    } else {
      paymentsMap = _data?['payments'] as Map?;
    }

    if (paymentsMap == null) return 0;
    final monthly = (paymentsMap['monthly'] as Map?) ?? {};
    return (monthly['$month'] as num?)?.toDouble() ??
        (monthly[month] as num?)?.toDouble() ??
        0;
  }

  double _getRemainingDueForMonth(String vendorCode, int month) {
    final monthData = _getMonthDataForVendor(vendorCode, month);
    final commission = (monthData['commissionMes'] as num?)?.toDouble() ?? 0;
    final alreadyPaid = _getPaidAmountForMonth(vendorCode, month);
    final remaining = commission - alreadyPaid;
    if (remaining > 0.01) return remaining;
    return commission > 0 ? commission : 0;
  }

  String _buildPayHelperText(String vendorCode, int month, double commission) {
    final alreadyPaid = _getPaidAmountForMonth(vendorCode, month);
    if (alreadyPaid > 0.01) {
      final remaining = (commission - alreadyPaid).clamp(0.0, double.infinity);
      return 'Comision ${_getMonthName(month)}: ${commission.toStringAsFixed(2)} € | '
          'Pagado: ${alreadyPaid.toStringAsFixed(2)} € | '
          'Pendiente: ${remaining.toStringAsFixed(2)} €';
    }
    return 'Comision ${_getMonthName(month)}: ${commission.toStringAsFixed(2)} €';
  }

  Future<void> _showPayDialog(
      String vendorCode, String vendorName, double currentGenerated) async {
    // Get already-paid months and per-month commissions
    final paidMonths = _getPaidMonthsForVendor(vendorCode);
    final monthsWithAnyPayment = _getMonthsWithAnyPayment(vendorCode);

    // Find first unpaid, non-future month as default selection
    final now = DateTime.now();
    var selectedMonth = now.month;
    for (var m = 1; m <= 12; m++) {
      if (!paidMonths.contains(m) && m <= now.month) {
        selectedMonth = m;
        break;
      }
    }
    // If all past months are paid, default to current month
    if (paidMonths.contains(selectedMonth)) {
      selectedMonth = now.month;
    }

    // Get commission for the initially selected month
    final initialMonthData = _getMonthDataForVendor(vendorCode, selectedMonth);
    var monthCommission = initialMonthData['commissionMes'] ?? 0;
    final initialSuggestedAmount =
        _getRemainingDueForMonth(vendorCode, selectedMonth);

    final amountController =
        TextEditingController(text: initialSuggestedAmount.toStringAsFixed(2));
    final conceptController = TextEditingController(text: 'Pago Comisiones');
    final observacionesController = TextEditingController();

    final adminCode = ProviderScope.containerOf(context)
            .read(authProvider)
            .value
            ?.user
            ?.code ??
        '';

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setStateDialog) {
          final currentAmount = double.tryParse(amountController.text) ?? 0;
          final alreadyPaid = _getPaidAmountForMonth(vendorCode, selectedMonth);
          final remainingDue =
              (monthCommission - alreadyPaid).clamp(0.0, double.infinity);
          // Require observaciones only when paying less than what is still pending.
          final observacionesRequired =
              (remainingDue - currentAmount) > 0.01 && currentAmount > 0;
          final isMonthPaid = paidMonths.contains(selectedMonth);
          final hasPriorPayment = monthsWithAnyPayment.contains(selectedMonth);
          final isMonthFuture = selectedMonth > now.month;

          return AlertDialog(
            backgroundColor: AppTheme.raisedSurface,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusLg),
              side: const BorderSide(color: AppTheme.borderColor),
            ),
            title: Text('Pagar a $vendorName',
                style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w800)),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Month selector with paid/future indicators
                  DropdownButtonFormField<int>(
                    initialValue: selectedMonth,
                    dropdownColor: AppTheme.raisedSurface,
                    style: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.w600,
                    ),
                    items: List.generate(12, (index) {
                      final m = index + 1;
                      final isPaid = paidMonths.contains(m);
                      final hasPayment = monthsWithAnyPayment.contains(m);
                      final isFuture = m > now.month;
                      var label = _getMonthName(m);
                      if (isPaid) {
                        label += '  ✓ PAGADO';
                      } else if (hasPayment) {
                        label += '  ◐ PAGO PARCIAL';
                      }
                      if (isFuture) label += '  (Futuro)';
                      return DropdownMenuItem(
                        value: m,
                        child: Text(
                          label,
                          style: TextStyle(
                            color: isPaid
                                ? AppTheme.success
                                : (hasPayment
                                    ? AppTheme.warning
                                    : (isFuture
                                        ? AppTheme.textTertiary
                                        : AppTheme.textPrimary)),
                            fontWeight: (isPaid || hasPayment)
                                ? FontWeight.bold
                                : FontWeight.normal,
                          ),
                        ),
                      );
                    }),
                    onChanged: (val) {
                      if (val == null) return;
                      final newMonthData =
                          _getMonthDataForVendor(vendorCode, val);
                      monthCommission = newMonthData['commissionMes'] ?? 0;
                      final suggestedAmount =
                          _getRemainingDueForMonth(vendorCode, val);
                      amountController.text =
                          suggestedAmount.toStringAsFixed(2);
                      setStateDialog(() => selectedMonth = val);
                    },
                    decoration: _payFieldDecoration(
                      labelText: 'Mes Correspondiente *',
                    ),
                  ),
                  const SizedBox(height: 8),

                  // Warning if month already paid or has prior partial payment
                  if (isMonthPaid)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      margin: const EdgeInsets.only(bottom: 8),
                      decoration: _commissionSurfaceDecoration(
                        color: AppTheme.warning.withValues(alpha: 0.1),
                        borderColor: AppTheme.warning,
                        borderAlpha: 0.35,
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.warning_amber_rounded,
                              color: AppTheme.warning, size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '${_getMonthName(selectedMonth)} ya esta pagado. Puedes registrar un ajuste adicional si necesitas corregir el importe.',
                              style: const TextStyle(
                                  color: AppTheme.warning, fontSize: 11),
                            ),
                          ),
                        ],
                      ),
                    )
                  else if (hasPriorPayment)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      margin: const EdgeInsets.only(bottom: 8),
                      decoration: _commissionSurfaceDecoration(
                        color: AppTheme.info.withValues(alpha: 0.1),
                        borderColor: AppTheme.info,
                        borderAlpha: 0.35,
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.info_outline,
                              color: AppTheme.info, size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '${_getMonthName(selectedMonth)} tiene un pago parcial (${alreadyPaid.toStringAsFixed(2)} €). '
                              'Puedes completar el pendiente (${remainingDue.toStringAsFixed(2)} €).',
                              style: const TextStyle(
                                  color: AppTheme.info, fontSize: 11),
                            ),
                          ),
                        ],
                      ),
                    ),

                  // Warning if future month
                  if (isMonthFuture)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      margin: const EdgeInsets.only(bottom: 8),
                      decoration: _commissionSurfaceDecoration(
                        color: AppTheme.info.withValues(alpha: 0.1),
                        borderColor: AppTheme.info,
                        borderAlpha: 0.35,
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.info_outline,
                              color: AppTheme.info, size: 18),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Este mes aún no ha terminado. La comisión puede cambiar.',
                              style:
                                  TextStyle(color: AppTheme.info, fontSize: 11),
                            ),
                          ),
                        ],
                      ),
                    ),

                  const SizedBox(height: 8),
                  TextField(
                    controller: amountController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: AppTheme.textPrimary),
                    decoration: _payFieldDecoration(
                      labelText: 'Importe (\u20ac) *',
                      helperText: _buildPayHelperText(
                          vendorCode, selectedMonth, monthCommission),
                      helperColor: hasPriorPayment && !isMonthPaid
                          ? AppTheme.warning
                          : AppTheme.success,
                    ),
                    onChanged: (val) => setStateDialog(() {}),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: observacionesController,
                    style: const TextStyle(color: AppTheme.textPrimary),
                    maxLines: 3,
                    maxLength: 500,
                    decoration: _payFieldDecoration(
                      labelText: observacionesRequired
                          ? 'Observaciones * (OBLIGATORIO)'
                          : 'Observaciones (Opcional)',
                      helperText: observacionesRequired
                          ? 'Debes explicar por que se paga menos de lo pendiente'
                          : 'Notas adicionales sobre este pago',
                      labelColor: observacionesRequired
                          ? AppTheme.warning
                          : AppTheme.textSecondary,
                      helperColor: observacionesRequired
                          ? AppTheme.warning
                          : AppTheme.textTertiary,
                      focusColor: observacionesRequired
                          ? AppTheme.warning
                          : AppTheme.info,
                      labelWeight: observacionesRequired
                          ? FontWeight.w800
                          : FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: conceptController,
                    style: const TextStyle(color: AppTheme.textPrimary),
                    decoration: _payFieldDecoration(
                      labelText: 'Concepto (Opcional)',
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                style: TextButton.styleFrom(
                  foregroundColor: AppTheme.textSecondary,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  ),
                ),
                child: const Text('Cancelar',
                    style: TextStyle(color: AppTheme.textTertiary)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                    backgroundColor:
                        isMonthPaid ? AppTheme.warning : AppTheme.info,
                    foregroundColor: AppTheme.textPrimary,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                    )),
                onPressed: () {
                  final amount = double.tryParse(amountController.text) ?? 0;
                  if (amount <= 0) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                          content: Text('El importe debe ser mayor que 0'),
                          backgroundColor: AppTheme.error),
                    );
                    return;
                  }
                  if (observacionesRequired &&
                      observacionesController.text.trim().isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                            'Debes indicar una observacion explicando por que se paga menos'),
                        backgroundColor: AppTheme.warning,
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

                  final monthSnapshot =
                      _getMonthDataForVendor(vendorCode, capturedMonth);
                  final alreadyPaidAtConfirm =
                      _getPaidAmountForMonth(vendorCode, capturedMonth);

                  _showPayConfirmation(
                    vendorCode: vendorCode,
                    vendorName: vendorName,
                    month: capturedMonth,
                    amount: capturedAmount,
                    generatedAmount: monthSnapshot['commissionMes'] ?? 0,
                    alreadyPaidAmount: alreadyPaidAtConfirm,
                    concept: capturedConcept,
                    observaciones: capturedObs,
                    adminCode: adminCode,
                    objetivoMes: monthSnapshot['objetivoMes'] ?? 0,
                    ventaActual: monthSnapshot['ventaActual'] ?? 0,
                    ventasSobreObjetivo:
                        monthSnapshot['ventasSobreObjetivo'] ?? 0,
                  );
                },
                child: Text(
                  isMonthPaid
                      ? 'Registrar ajuste'
                      : (hasPriorPayment
                          ? 'Completar pago'
                          : 'Revisar y Confirmar'),
                  style: const TextStyle(
                      color: AppTheme.textPrimary, fontWeight: FontWeight.bold),
                ),
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
    required double alreadyPaidAmount,
    required String concept,
    required String observaciones,
    required String adminCode,
    required double objetivoMes,
    required double ventaActual,
    required double ventasSobreObjetivo,
  }) async {
    final remainingBefore =
        (generatedAmount - alreadyPaidAmount).clamp(0.0, double.infinity);
    final isPartialPay = (remainingBefore - amount) > 0.01 && amount > 0;
    final isCompletionPay = alreadyPaidAmount > 0.01 && amount > 0;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          side: const BorderSide(color: AppTheme.borderColor),
        ),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded,
                color: AppTheme.warning, size: 28),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Confirmar Registro de Pago',
                style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.bold),
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
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 16),
              _confirmRow('Comercial', vendorName),
              _confirmRow('Mes', '${_getMonthName(month)} / 2026'),
              const Divider(color: AppTheme.borderColor, height: 16),
              _confirmRow(
                  'Venta del mes', CurrencyFormatter.format(ventaActual)),
              _confirmRow(
                  'Objetivo del mes', CurrencyFormatter.format(objetivoMes)),
              _confirmRow(
                'Ventas sobre objetivo',
                CurrencyFormatter.format(ventasSobreObjetivo),
                valueColor: ventasSobreObjetivo >= 0
                    ? AppTheme.success
                    : AppTheme.error,
              ),
              const Divider(color: AppTheme.borderColor, height: 16),
              _confirmRow('Comision generada',
                  CurrencyFormatter.format(generatedAmount)),
              if (alreadyPaidAmount > 0.01) ...[
                _confirmRow('Ya pagado este mes',
                    CurrencyFormatter.format(alreadyPaidAmount)),
                _confirmRow('Pendiente antes de este pago',
                    CurrencyFormatter.format(remainingBefore)),
              ],
              _confirmRow(
                'Importe a pagar',
                CurrencyFormatter.format(amount),
                valueColor: isPartialPay ? AppTheme.warning : AppTheme.success,
              ),
              _confirmRow('Observaciones',
                  observaciones.isEmpty ? 'Ninguna' : observaciones),
              const SizedBox(height: 12),
              if (isCompletionPay && !isPartialPay)
                _commissionNotice(
                  icon: Icons.payments_rounded,
                  color: AppTheme.success,
                  text: 'COMPLETAR PAGO PENDIENTE del mes',
                  strong: true,
                ),
              if (isPartialPay)
                _commissionNotice(
                  icon: Icons.warning,
                  color: AppTheme.error,
                  text: 'PAGO PARCIAL \u2013 se ha indicado observacion',
                  strong: true,
                ),
              const SizedBox(height: 12),
              _commissionNotice(
                icon: Icons.history_rounded,
                color: AppTheme.info,
                text: 'Este pago se guardara como un nuevo registro historico. '
                    'No se puede modificar despues.',
              ),
              const SizedBox(height: 8),
              _commissionNotice(
                icon: Icons.lock_clock_rounded,
                color: AppTheme.info,
                text:
                    'Los valores de ventas/objetivo/comision quedan registrados '
                    'en el momento del pago y pueden diferir de datos futuros.',
              ),
            ],
          ),
        ),
        actionsPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        actions: [
          SizedBox(
            width: double.infinity,
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(ctx),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.error,
                      side: const BorderSide(color: AppTheme.error),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                      ),
                    ),
                    child: const Text('CANCELAR',
                        style: TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 14)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.success,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                      ),
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
                          ventaActual: ventaActual,
                          ventasSobreObjetivo: ventasSobreObjetivo,
                        );

                        if (mounted && res['success'] == true) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('Pago registrado correctamente'),
                                backgroundColor: AppTheme.success),
                          );
                          _loadData(forceRefresh: true);
                        } else {
                          throw Exception(res['error'] ?? 'Error desconocido');
                        }
                      } catch (e) {
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                                content: Text('Error: $e'),
                                backgroundColor: AppTheme.error),
                          );
                        }
                      }
                    },
                    child: const Text(
                      'CONFIRMAR Y REGISTRAR PAGO',
                      style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 13),
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
            child: Text('$label:',
                style: const TextStyle(
                    color: AppTheme.textTertiary, fontSize: 12)),
          ),
          Expanded(
            child: Text(value,
                style: TextStyle(
                    color: valueColor ?? AppTheme.textPrimary,
                    fontWeight: FontWeight.bold,
                    fontSize: 12)),
          ),
        ],
      ),
    );
  }

  Widget _buildStep(String title, String desc) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title,
            style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 13,
                color: AppTheme.textPrimary)),
        const SizedBox(height: 4),
        Text(desc,
            style:
                const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
      ],
    );
  }

  OutlineInputBorder _payFieldBorder(Color color) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      borderSide: BorderSide(color: color),
    );
  }

  InputDecoration _payFieldDecoration({
    required String labelText,
    String? helperText,
    Color labelColor = AppTheme.textSecondary,
    Color helperColor = AppTheme.textTertiary,
    Color focusColor = AppTheme.info,
    FontWeight labelWeight = FontWeight.w600,
  }) {
    return InputDecoration(
      labelText: labelText,
      helperText: helperText,
      filled: true,
      fillColor: AppTheme.softPanel,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      labelStyle: TextStyle(color: labelColor, fontWeight: labelWeight),
      helperStyle: TextStyle(color: helperColor, fontSize: 11),
      counterStyle: const TextStyle(color: AppTheme.textTertiary, fontSize: 10),
      enabledBorder: _payFieldBorder(AppTheme.borderColor),
      focusedBorder: _payFieldBorder(focusColor),
      errorBorder: _payFieldBorder(AppTheme.error),
      focusedErrorBorder: _payFieldBorder(AppTheme.error),
    );
  }

  Widget _commissionNotice({
    required IconData icon,
    required Color color,
    required String text,
    bool strong = false,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: _commissionSurfaceDecoration(
        color: color.withValues(alpha: 0.1),
        borderColor: color,
        borderAlpha: 0.35,
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: strong ? FontWeight.w800 : FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final loggedUserCode = ref.watch(
      authProvider.select((state) => state.value?.user?.code),
    );
    if (isCommercial80Code(loggedUserCode)) {
      return Scaffold(
        backgroundColor: AppTheme.inkSurface,
        body: Column(
          children: [
            SmartSyncHeader(
              title: 'Comisiones',
              subtitle: 'Seguimiento y Objetivos',
              lastSync: _lastFetchTime,
              isLoading: false,
              onSync: () => _loadData(forceRefresh: true),
            ),
            const Expanded(child: SizedBox.shrink()),
          ],
        ),
      );
    }

    // Check if we're in jefe global ALL mode (per-vendor breakdown cards)
    final breakdown =
        (_data?['breakdown'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final isScopedTeamAggregate =
        (_data?['isScopedTeamAggregate'] as bool?) ?? false;
    final aggregateLabel =
        (_data?['aggregateLabel'] as String?) ?? 'Equipo Almería (72+73+81+83)';
    final isAllMode = breakdown.isNotEmpty && !isScopedTeamAggregate;

    // ... vars ...
    final months = _data?['months'] as List? ?? [];
    final quarters = _data?['quarters'] as List? ?? [];
    final status = _data?['status'] as String? ?? 'active';
    final isInformative = status == 'informative';
    final isTeamLead = (_data?['isTeamLead'] as bool?) ?? false;
    final hidePersonalCommissionBadge =
        (_data?['hidePersonalCommissionBadge'] as bool?) ?? false;
    final teamCommission =
        (_data?['teamCommission'] as Map?)?.cast<String, dynamic>();
    final grandTotal = (_data?['grandTotalCommission'] as num?)?.toDouble() ??
        (_data?['totals']?['commission'] as num?)?.toDouble() ??
        0.0;
    // Payments Data
    final paymentsData = (_data?['payments'] as Map?) ?? {};
    final totalPaid = (paymentsData['total'] as num?)?.toDouble() ?? 0.0;

    // Monthly paid for current month
    final now = DateTime.now();
    final currentMonthKey = now.month.toString();
    final monthlyPaidMap = (paymentsData['monthly'] as Map?) ?? {};
    final paidThisMonth =
        (monthlyPaidMap[currentMonthKey] as num?)?.toDouble() ?? 0.0;

    // Calculate summary stats
    double totalProvisionalCommission = 0;
    double totalActualSales = 0;
    double totalTarget = 0;
    double totalProRatedTarget = 0; // Expected sales by today
    Map<String, dynamic>? currentMonthData;

    for (final m in months) {
      final monthNum = (m['month'] as num?)?.toInt() ?? 0;
      final isFuture = (m['isFuture'] as bool?) ?? false;
      final actual = (m['actual'] as num?)?.toDouble() ?? 0;
      final target = (m['target'] as num?)?.toDouble() ?? 0;
      final dailyCtx = m['dailyComplianceCtx'] ?? {};
      final provisionalComm =
          (dailyCtx['provisionalCommission'] as num?)?.toDouble() ?? 0;
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
        currentMonthData = m as Map<String, dynamic>?;
      }
    }

    // Overall compliance: actual vs WHAT WE SHOULD HAVE BY NOW (not total target)
    final overallCompliance =
        totalTarget > 0 ? (totalActualSales / totalTarget) * 100 : 0;

    // Rhythm compliance: are we on track for the current day?
    // If totalProRatedTarget > 0, compare actual vs expected by today
    final rhythmCompliance = totalProRatedTarget > 0
        ? (totalActualSales / totalProRatedTarget) * 100
        : 100;
    final isOnRhythm = rhythmCompliance >= 100;
    final rhythmStatus = rhythmCompliance >= 105
        ? 'Adelantado'
        : (rhythmCompliance >= 95 ? 'En ritmo' : 'Rezagado');

    // Get payment authorization status
    final authState = ref.watch(authProvider).value;
    final curUserCode = authState?.user?.code?.trim() ?? '';
    final curUserName = authState?.user?.name?.toUpperCase() ?? '';
    // Allow payment for ADMIN users or specifically DIEGO (code 98)
    final normalizedCode = curUserCode.replaceFirst(RegExp('^0+'), '');
    final canPay =
        authState?.user?.tipoVendedor == 'ADMIN' || normalizedCode == '98';
    // PDF generation is ONLY for DIEGO
    final isDiego = curUserName == 'DIEGO' || normalizedCode == '98';

    // PDF dialog
    void showPdfDialog() {
      final selectedVendor = ref.read(selectedVendorProvider);
      final currentVendor = widget.isJefeVentas &&
              widget.includeAllVendorOption &&
              (selectedVendor == null ||
                  selectedVendor.isEmpty ||
                  selectedVendor == 'ALL')
          ? 'ALL'
          : (selectedVendor ??
              (_data?['vendor'] as String?) ??
              widget.employeeCode.split(',').first);
      showDialog(
        context: context,
        builder: (ctx) => PdfRangeDialog(vendorCode: currentVendor),
      );
    }

    // Prepare table rows (interleaving quarters)
    final rows = <DataRow>[];

    // Sort months just in case
    months.sort((a, b) => ((a['month'] as num?)?.toInt() ?? 0)
        .compareTo((b['month'] as num?)?.toInt() ?? 0));

    // Helper to add month row
    void addMonthRow(Map<String, dynamic> m) {
      final monthNum = (m['month'] as num?)?.toInt() ?? 0;
      final monthName = _getMonthName(monthNum);
      final target = (m['target'] as num?)?.toDouble() ?? 0;
      final ctx = (m['complianceCtx'] as Map?) ?? {};
      final actual = (m['actual'] as num?)?.toDouble() ?? 0;
      final bSales = (m['bSales'] as num?)?.toDouble() ?? 0;
      final lacSalesRaw = (m['lacSales'] as num?)?.toDouble();
      final lacSalesFallback = actual - bSales;
      final lacSales =
          lacSalesRaw ?? (lacSalesFallback > 0 ? lacSalesFallback : 0);
      final totalSales = (m['totalSales'] as num?)?.toDouble() ?? actual;
      final isFuture = (m['isFuture'] as bool?) ?? false;

      final pct = (ctx['pct'] as num?)?.toDouble() ?? 0;
      final tier = (ctx['tier'] as num?)?.toInt() ?? 0;
      final commission = (ctx['commission'] as num?)?.toDouble() ?? 0;

      final workingDays = (m['workingDays'] as num?)?.toInt() ?? 0;
      final dailyTarget = (m['dailyTarget'] as num?)?.toDouble() ?? 0;
      final dailyActual = (m['dailyActual'] as num?)?.toDouble() ?? 0;
      final dailyCtx = (m['dailyComplianceCtx'] as Map?) ?? {};
      final dailyGreen = (dailyCtx['isGreen'] as bool?) ?? false;

      // Color logic: future months get special styling
      final isPositive = hidePersonalCommissionBadge
          ? false
          : (actual >= target && target > 0);
      final color = isFuture
          ? AppTheme.textTertiary
          : (isPositive ? AppTheme.success : AppTheme.error);
      final dailyColor = isFuture
          ? AppTheme.textTertiary
          : (dailyGreen ? AppTheme.success : AppTheme.warning);
      final rowBgColor =
          isFuture ? AppTheme.mutedPanel : AppTheme.raisedSurface;
      final textOpacity = isFuture ? 0.4 : 1.0;

      // Monthly Pct Logic
      final pctDisplay = pct > 0 ? (pct - 100) : 0;
      final pctText = isFuture
          ? '-'
          : (pct > 100
              ? '+${pctDisplay.toStringAsFixed(1)}%'
              : '${pct.toStringAsFixed(1)}%');

      // Daily accumulated data (new from backend)
      final daysPassed = (m['daysPassed'] as num?)?.toInt() ?? 0;
      final proRatedTarget = (m['proRatedTarget'] as num?)?.toDouble() ?? 0;
      final provisionalCommission =
          (dailyCtx['provisionalCommission'] as num?)?.toDouble() ?? 0;
      final dailyTier = (dailyCtx['tier'] as num?)?.toInt() ?? 0;
      final dailyRate = (dailyCtx['rate'] as num?)?.toDouble() ?? 0;
      final dailyPct = (dailyCtx['pct'] as num?)?.toDouble() ?? 0;

      // Daily percentage text
      final dailyPctDisplay = dailyPct > 0 ? (dailyPct - 100) : 0;
      final dailyPctText = dailyPct > 100
          ? '+${dailyPctDisplay.toStringAsFixed(1)}%'
          : '${dailyPct.toStringAsFixed(1)}%';

      rows.add(
        DataRow(
          color: WidgetStateProperty.all(rowBgColor),
          cells: [
            // MES
            DataCell(
              Row(
                children: [
                  Text(monthName,
                      style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textPrimary
                              .withValues(alpha: textOpacity))),
                  if (isFuture) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 4, vertical: 2),
                      decoration: BoxDecoration(
                          color: AppTheme.textTertiary.withValues(alpha: 0.3),
                          borderRadius: BorderRadius.circular(4)),
                      child: const Text('PENDIENTE',
                          style: TextStyle(
                              fontSize: 8, color: AppTheme.textTertiary)),
                    ),
                  ],
                ],
              ),
            ),
            // OBJ. MES
            DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(target),
                style: TextStyle(
                    color:
                        AppTheme.textPrimary.withValues(alpha: textOpacity)))),
            // VENTA REAL o INCREMENTO EQUIPO (líder)
            DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(lacSales),
                style: TextStyle(color: color, fontWeight: FontWeight.bold))),
            DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(bSales),
                style: TextStyle(
                    color: bSales > 0 ? AppTheme.info : AppTheme.textTertiary,
                    fontWeight:
                        bSales > 0 ? FontWeight.bold : FontWeight.normal))),
            DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(totalSales),
                style: TextStyle(color: color, fontWeight: FontWeight.bold))),
            // ESTADO MES
            DataCell(
              isFuture
                  ? const Text('-',
                      style: TextStyle(color: AppTheme.textTertiary))
                  : Row(
                      children: [
                        Icon(isPositive ? Icons.check_circle : Icons.cancel,
                            color: color, size: 16),
                        if (isPositive && tier > 0) ...[
                          const SizedBox(width: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 4, vertical: 2),
                            decoration: BoxDecoration(
                                color: AppTheme.info.withValues(alpha: 0.2),
                                borderRadius: BorderRadius.circular(4)),
                            child: Text('F$tier',
                                style: const TextStyle(
                                    fontSize: 9, color: AppTheme.info)),
                          ),
                        ],
                      ],
                    ),
            ),
            // % SOBRE (mes)
            DataCell(Text(pctText,
                style: TextStyle(
                    color: isFuture ? AppTheme.textTertiary : color,
                    fontSize: 11))),
            // COMISIÓN MES
            DataCell(
              Text(
                isFuture
                    ? '-'
                    : (isInformative
                        ? '-'
                        : CurrencyFormatter.format(commission)),
                style: TextStyle(
                    color: isFuture
                        ? AppTheme.textTertiary
                        : (isInformative
                            ? AppTheme.textTertiary
                            : AppTheme.success),
                    fontWeight: FontWeight.bold),
              ),
            ),

            // === SECCIÓN RITMO DIARIO ===
            // DÍAS (transcurridos / totales)
            DataCell(Text(isFuture ? '-' : '$daysPassed/$workingDays',
                style: TextStyle(
                    color: AppTheme.textPrimary
                        .withValues(alpha: textOpacity * 0.7),
                    fontSize: 11))),
            // OBJ. ACUM. (pro-rated target)
            DataCell(Text(
                isFuture ? '-' : CurrencyFormatter.format(proRatedTarget),
                style: TextStyle(
                    fontSize: 11,
                    color:
                        AppTheme.textPrimary.withValues(alpha: textOpacity)))),
            // ESTADO RITMO + % SOBRE
            DataCell(
              isFuture
                  ? const Text('-',
                      style: TextStyle(color: AppTheme.textTertiary))
                  : Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                                dailyGreen
                                    ? Icons.check_circle
                                    : Icons.warning_amber,
                                color: dailyColor,
                                size: 14),
                            const SizedBox(width: 4),
                            Text(dailyPctText,
                                style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 11,
                                    color: dailyColor)),
                          ],
                        ),
                        if (dailyTier > 0)
                          Text(
                              'Franja $dailyTier (${dailyRate.toStringAsFixed(1)}%)',
                              style: TextStyle(fontSize: 9, color: dailyColor))
                        else if (!dailyGreen && actual > 0)
                          Text('Por debajo',
                              style: TextStyle(fontSize: 9, color: dailyColor)),
                      ],
                    ),
            ),
            // DIFERENCIA (Venta Real - Obj. Acumulado)
            DataCell(
              isFuture
                  ? const Text('-',
                      style: TextStyle(color: AppTheme.textTertiary))
                  : Text(
                      (actual - proRatedTarget) >= 0
                          ? '+${CurrencyFormatter.format(actual - proRatedTarget)}'
                          : CurrencyFormatter.format(actual - proRatedTarget),
                      style: TextStyle(
                        color: (actual - proRatedTarget) >= 0
                            ? AppTheme.success
                            : AppTheme.error,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                    ),
            ),
            // COMISIÓN PROVISIONAL
            DataCell(
              isFuture || isInformative
                  ? const Text('-',
                      style: TextStyle(color: AppTheme.textTertiary))
                  : Text(
                      CurrencyFormatter.format(provisionalCommission),
                      style: TextStyle(
                        color: provisionalCommission > 0
                            ? AppTheme.accentIndigo
                            : AppTheme.textTertiary,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                    ),
            ),
            // === PAGOS (NEW) ===
            // IMPORTE PAGADO
            DataCell(
              Builder(
                builder: (context) {
                  final detailsMap = paymentsData['details'] as Map?;
                  final details = detailsMap?[monthNum] ??
                      detailsMap?['$monthNum'] ??
                      detailsMap?[monthNum.toString()];
                  final importePagado =
                      ((details as Map?)?['totalPaid'] as num?)?.toDouble() ??
                          0;
                  return importePagado > 0
                      ? Text(
                          CurrencyFormatter.format(importePagado),
                          style: const TextStyle(
                              color: AppTheme.success,
                              fontSize: 10,
                              fontWeight: FontWeight.bold),
                        )
                      : const Text('-',
                          style: TextStyle(
                              color: AppTheme.textTertiary, fontSize: 10));
                },
              ),
            ),
            // VENTA REAL (momento pago)
            DataCell(
              Builder(
                builder: (context) {
                  final detailsMap = paymentsData['details'] as Map?;
                  final details = detailsMap?[monthNum] ??
                      detailsMap?['$monthNum'] ??
                      detailsMap?[monthNum.toString()];
                  final ventaComision =
                      ((details as Map?)?['ventaComision'] as num?)
                              ?.toDouble() ??
                          0;
                  return ventaComision > 0
                      ? Text(
                          CurrencyFormatter.format(ventaComision),
                          style: const TextStyle(
                              color: AppTheme.info,
                              fontSize: 10,
                              fontWeight: FontWeight.bold),
                        )
                      : const Text('-',
                          style: TextStyle(
                              color: AppTheme.textTertiary, fontSize: 10));
                },
              ),
            ),
            // OBJ. REAL (snapshot al momento del pago)
            DataCell(
              Builder(
                builder: (context) {
                  final detailsMap = paymentsData['details'] as Map?;
                  final details = detailsMap?[monthNum] ??
                      detailsMap?['$monthNum'] ??
                      detailsMap?[monthNum.toString()];
                  final objetivoReal =
                      ((details as Map?)?['objetivoReal'] as num?)
                              ?.toDouble() ??
                          0;
                  return objetivoReal > 0
                      ? Text(
                          CurrencyFormatter.format(objetivoReal),
                          style: const TextStyle(
                              color: AppTheme.accentAmber,
                              fontSize: 10,
                              fontWeight: FontWeight.bold),
                        )
                      : const Text('-',
                          style: TextStyle(
                              color: AppTheme.textTertiary, fontSize: 10));
                },
              ),
            ),
            // OBSERVACIONES
            DataCell(
              Builder(
                builder: (context) {
                  final detailsMap = paymentsData['details'] as Map?;
                  final details = detailsMap?[monthNum] ??
                      detailsMap?['$monthNum'] ??
                      detailsMap?[monthNum.toString()];
                  final observaciones =
                      ((details as Map?)?['observaciones'] as List?)
                              ?.join(' | ') ??
                          '';
                  return observaciones.isNotEmpty
                      ? Tooltip(
                          message: observaciones,
                          child: Container(
                            constraints: const BoxConstraints(maxWidth: 150),
                            child: Text(
                              observaciones,
                              style: const TextStyle(
                                  color: AppTheme.warning,
                                  fontSize: 10,
                                  fontStyle: FontStyle.italic),
                              overflow: TextOverflow.ellipsis,
                              maxLines: 2,
                            ),
                          ),
                        )
                      : const Text('-',
                          style: TextStyle(
                              color: AppTheme.textTertiary, fontSize: 10));
                },
              ),
            ),
          ],
        ),
      );
    }

    // Helper to add Quarter summary (Paid vs Real)
    void addQuarterRow(Map<String, dynamic> q, int qIndex) {
      if (q.isEmpty) return;

      final monthNow = DateTime.now().month;
      final currentQ =
          (monthNow - 1) ~/ 4; // 0 for Jan-Apr, 1 for May-Aug, 2 for Sep-Dec
      final isPast = qIndex < currentQ;
      final isCurrent = qIndex == currentQ;
      final isFuture = qIndex > currentQ;

      final name = (q['name'] as String?) ?? 'Trimestre';
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
        quarterPaid += (monthlyPaidMap[m] as num?)?.toDouble() ??
            (monthlyPaidMap['$m'] as num?)?.toDouble() ??
            (monthlyPaidMap[m.toString()] as num?)?.toDouble() ??
            0;
      }

      final bgColor = isPast
          ? AppTheme.mutedPanel
          : (isCurrent
              ? AppTheme.accentIndigo.withValues(alpha: 0.15)
              : Colors.transparent);
      final textColor = isPast
          ? AppTheme.textTertiary
          : (isCurrent ? AppTheme.accentIndigo : AppTheme.textTertiary);

      rows.add(
        DataRow(
          color: WidgetStateProperty.all(bgColor),
          cells: [
            DataCell(Text(name.toUpperCase(),
                style:
                    TextStyle(color: textColor, fontWeight: FontWeight.bold))),
            const DataCell(SizedBox()), // OBJ. MES
            const DataCell(SizedBox()), // VENTA LAC
            const DataCell(SizedBox()), // VENTA B
            const DataCell(SizedBox()), // VENTA TOTAL
            const DataCell(SizedBox()), // ESTADO
            const DataCell(SizedBox()), // %
            DataCell(
              isFuture
                  ? const Text('-')
                  : Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Generado: ${CurrencyFormatter.format(total)}',
                            style: TextStyle(
                                fontSize: 11,
                                color: isPast
                                    ? AppTheme.textTertiary
                                    : AppTheme.textSecondary)),
                        Text('Pagado: ${CurrencyFormatter.format(quarterPaid)}',
                            style: TextStyle(
                                fontSize: 12,
                                color: isPast
                                    ? AppTheme.textTertiary
                                    : AppTheme.success,
                                fontWeight: FontWeight.bold)),
                      ],
                    ),
            ),
            const DataCell(SizedBox()), // DÍAS
            const DataCell(SizedBox()), // OBJ. ACUM.
            const DataCell(SizedBox()), // RITMO
            const DataCell(SizedBox()), // DIFF
            const DataCell(SizedBox()), // COM. PROV.
            const DataCell(SizedBox()), // IMP. PAGADO (NEW)
            const DataCell(SizedBox()), // VENTA REAL (NEW)
            const DataCell(SizedBox()), // OBJ. REAL (NEW)
            const DataCell(SizedBox()), // OBSERVACIONES (NEW)
          ],
        ),
      );
    }

    // Build Sequence
    // Build Sequence
    final q1Months = months.where((m) => (m['month'] as int) <= 4).toList();
    for (final m in q1Months) {
      addMonthRow(m as Map<String, dynamic>);
    }
    if (q1Months.isNotEmpty && quarters.isNotEmpty)
      addQuarterRow(quarters[0] as Map<String, dynamic>, 0);

    final q2Months = months
        .where((m) => (m['month'] as int) > 4 && (m['month'] as int) <= 8)
        .toList();
    for (final m in q2Months) {
      addMonthRow(m as Map<String, dynamic>);
    }
    if (q2Months.isNotEmpty && quarters.length > 1)
      addQuarterRow(quarters[1] as Map<String, dynamic>, 1);

    final q3Months = months.where((m) => (m['month'] as int) > 8).toList();
    for (final m in q3Months) {
      addMonthRow(m as Map<String, dynamic>);
    }
    if (q3Months.isNotEmpty && quarters.length > 2)
      addQuarterRow(quarters[2] as Map<String, dynamic>, 2);

    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
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
            margin: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            decoration: _commissionSurfaceDecoration(
              color: AppTheme.raisedSurface,
              borderColor: AppTheme.borderColor,
              radius: AppTheme.radiusLg,
            ),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: _commissionSurfaceDecoration(
                    color: AppTheme.success.withValues(alpha: 0.12),
                    borderColor: AppTheme.success,
                    borderAlpha: 0.32,
                    radius: AppTheme.radiusMd,
                  ),
                  child:
                      const Icon(Icons.euro, color: AppTheme.success, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (widget.isJefeVentas ||
                          widget.forceShowVendorSelector) ...[
                        GlobalVendorSelector(
                          isJefeVentas: widget.isJefeVentas,
                          allowedVendorCodes: widget.vendorSelectorCodes,
                          includeAllOption: widget.includeAllVendorOption,
                          defaultVendorCode: widget.employeeCode,
                          forceShow: widget.forceShowVendorSelector,
                        ),
                      ] else
                        const Text('Comisiones 2026',
                            style: TextStyle(
                                color: AppTheme.textPrimary,
                                fontWeight: FontWeight.w800,
                                fontSize: 18)),
                      if (isInformative)
                        const Text('Modo Informativo (No Comisionable)',
                            style: TextStyle(
                                color: AppTheme.textTertiary, fontSize: 11))
                      else
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              'Generado: ${CurrencyFormatter.format(grandTotal)}',
                              style: const TextStyle(
                                  color: AppTheme.success,
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Pagado: ${CurrencyFormatter.format(totalPaid)}',
                              style: const TextStyle(
                                  color: AppTheme.info,
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
                if (canPay &&
                    !isAllMode &&
                    !((_data?['isExcluded'] as bool?) ?? false))
                  IconButton(
                    icon: const Icon(Icons.payment_rounded,
                        color: AppTheme.info, size: 28),
                    style: IconButton.styleFrom(
                      backgroundColor: AppTheme.info.withValues(alpha: 0.1),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                        side: BorderSide(
                          color: AppTheme.info.withValues(alpha: 0.24),
                        ),
                      ),
                    ),
                    // We need the ID/Code of the current single vendor
                    onPressed: () => _showPayDialog(
                        (_data?['vendor'] as String?) ??
                            widget.employeeCode.split(',').first,
                        'Vendedor',
                        grandTotal),
                    tooltip: 'Registrar Pago',
                  ),
                if (isDiego) // PDF button - DIEGO only
                  IconButton(
                    icon: const Icon(Icons.picture_as_pdf_rounded,
                        color: AppTheme.success, size: 28),
                    style: IconButton.styleFrom(
                      backgroundColor: AppTheme.success.withValues(alpha: 0.1),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                        side: BorderSide(
                          color: AppTheme.success.withValues(alpha: 0.24),
                        ),
                      ),
                    ),
                    onPressed: showPdfDialog,
                    tooltip: 'Generar Informe PDF',
                  ),
                IconButton(
                  icon: const Icon(Icons.info_outline, color: AppTheme.info),
                  style: IconButton.styleFrom(
                    backgroundColor: AppTheme.softPanel,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                      side: const BorderSide(color: AppTheme.borderColor),
                    ),
                  ),
                  onPressed: _showExplanationModal,
                  tooltip: 'Explicación cálculo',
                ),
              ],
            ),
          ),

          if (!isTeamLead &&
              (((_data?['isExcluded'] as bool?) ?? false) ||
                  hidePersonalCommissionBadge ||
                  isInformative))
            Container(
              width: double.infinity,
              margin: const EdgeInsets.all(12),
              padding: const EdgeInsets.all(12),
              decoration: _commissionSurfaceDecoration(
                color: AppTheme.warning.withValues(alpha: 0.12),
                borderColor: AppTheme.warning,
                borderAlpha: 0.34,
              ),
              child: Row(
                children: [
                  const Icon(Icons.money_off_rounded,
                      color: AppTheme.warning, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      hidePersonalCommissionBadge
                          ? 'Este comercial no genera comisión según configuración actual'
                          : 'Este comercial no participa en el plan de comisiones',
                      style: const TextStyle(
                          color: AppTheme.warning,
                          fontSize: 13,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              ),
            ),

          if (isScopedTeamAggregate)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              padding: const EdgeInsets.all(12),
              decoration: _commissionSurfaceDecoration(
                color: AppTheme.info.withValues(alpha: 0.12),
                borderColor: AppTheme.info,
                borderAlpha: 0.35,
              ),
              child: Row(
                children: [
                  const Icon(Icons.groups_rounded,
                      color: AppTheme.info, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Acumulado de su equipo — $aggregateLabel (suma mensual de 72, 73, 81 y 83).',
                      style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),

          if (isTeamLead && teamCommission != null && !isScopedTeamAggregate)
            _buildTeamLeadPanel(teamCommission),

          // === SUMMARY CARDS ===
          if (!Responsive.isLandscapeCompact(context) &&
              !_isLoading &&
              _error == null &&
              !isInformative) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  // Current Month Card
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: _commissionSurfaceDecoration(
                        color: AppTheme.raisedSurface,
                        borderColor: AppTheme.info,
                        borderAlpha: 0.32,
                        radius: AppTheme.radiusLg,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.calendar_today,
                                  color: AppTheme.info, size: 16),
                              const SizedBox(width: 6),
                              Text(
                                _getMonthName(DateTime.now().month)
                                    .toUpperCase(),
                                style: TextStyle(
                                    fontSize:
                                        Responsive.isSmall(context) ? 9 : 11,
                                    fontWeight: FontWeight.bold,
                                    color: AppTheme.info),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          if (currentMonthData != null) ...[
                            Text(
                              CurrencyFormatter.format(
                                (currentMonthData!['actual'] as num?)
                                        ?.toDouble() ??
                                    0,
                              ),
                              style: TextStyle(
                                  fontSize:
                                      Responsive.isSmall(context) ? 14 : 16,
                                  fontWeight: FontWeight.bold,
                                  color: AppTheme.textPrimary),
                            ),
                            Text(
                              hidePersonalCommissionBadge
                                  ? 'Ventas mes (sin comisión personal)'
                                  : 'de ${CurrencyFormatter.format((currentMonthData!['target'] as num?)?.toDouble() ?? 0)}',
                              style: TextStyle(
                                  fontSize: Responsive.isSmall(context) ? 8 : 9,
                                  color: AppTheme.textSecondary),
                            ),
                            if (!hidePersonalCommissionBadge) ...[
                              const SizedBox(height: 6),
                              ClipRRect(
                                borderRadius: BorderRadius.circular(4),
                                child: LinearProgressIndicator(
                                  value: ((currentMonthData!['actual'] as num?)
                                              ?.toDouble() ??
                                          0) /
                                      ((currentMonthData!['target'] as num?)
                                                  ?.toDouble() ??
                                              1)
                                          .clamp(0.01, double.infinity),
                                  backgroundColor: AppTheme.softPanel,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    ((currentMonthData!['actual'] as num?)
                                                    ?.toDouble() ??
                                                0) >=
                                            ((currentMonthData!['target']
                                                        as num?)
                                                    ?.toDouble() ??
                                                0)
                                        ? AppTheme.success
                                        : AppTheme.info,
                                  ),
                                  minHeight: 6,
                                ),
                              ),
                            ],
                          ] else
                            const Text('Sin datos',
                                style: TextStyle(color: AppTheme.textTertiary)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Provisional Commission Card
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: _commissionSurfaceDecoration(
                        color: AppTheme.raisedSurface,
                        borderColor: AppTheme.success,
                        borderAlpha: 0.32,
                        radius: AppTheme.radiusLg,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.trending_up,
                                  color: AppTheme.success, size: 16),
                              const SizedBox(width: 6),
                              Text('COMISIÓN PROV.',
                                  style: TextStyle(
                                      fontSize:
                                          Responsive.isSmall(context) ? 9 : 11,
                                      fontWeight: FontWeight.bold,
                                      color: AppTheme.success)),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            CurrencyFormatter.format(
                                totalProvisionalCommission),
                            style: TextStyle(
                                fontSize: Responsive.isSmall(context) ? 14 : 18,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.success),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Confirmado: ${CurrencyFormatter.format(grandTotal)}',
                            style: TextStyle(
                                fontSize: Responsive.isSmall(context) ? 8 : 10,
                                color: AppTheme.textSecondary),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Compliance Card - now uses RHYTHM-based comparison
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: _commissionSurfaceDecoration(
                        color: isOnRhythm
                            ? AppTheme.success.withValues(alpha: 0.1)
                            : AppTheme.warning.withValues(alpha: 0.1),
                        borderColor:
                            isOnRhythm ? AppTheme.success : AppTheme.warning,
                        borderAlpha: 0.32,
                        radius: AppTheme.radiusLg,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                isOnRhythm ? Icons.trending_up : Icons.speed,
                                color: isOnRhythm
                                    ? AppTheme.success
                                    : AppTheme.warning,
                                size: 14,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                'RITMO ACTUAL',
                                style: TextStyle(
                                  fontSize:
                                      Responsive.isSmall(context) ? 8 : 10,
                                  fontWeight: FontWeight.bold,
                                  color: isOnRhythm
                                      ? AppTheme.success
                                      : AppTheme.warning,
                                ),
                              ),
                            ],
                          ),
                          Text(
                            '(a día ${DateTime.now().day})',
                            style: TextStyle(
                                fontSize: 9, color: AppTheme.textTertiary),
                          ),
                          const SizedBox(height: 6),

                          // Metrics Row
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Rhythm (Month/Period pace)
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text('Vs Ritmo:',
                                      style: TextStyle(
                                          fontSize: Responsive.isSmall(context)
                                              ? 8
                                              : 10,
                                          color: AppTheme.textSecondary)),
                                  Text(
                                    '${rhythmCompliance.toStringAsFixed(1)}%',
                                    style: TextStyle(
                                        fontSize: Responsive.isSmall(context)
                                            ? 10
                                            : 12,
                                        fontWeight: FontWeight.bold,
                                        color: isOnRhythm
                                            ? AppTheme.success
                                            : AppTheme.warning),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              // Annual/Total
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text('Vs Obj. Total:',
                                      style: TextStyle(
                                          fontSize: Responsive.isSmall(context)
                                              ? 8
                                              : 10,
                                          color: AppTheme.textSecondary)),
                                  Text(
                                      '${overallCompliance.toStringAsFixed(1)}%',
                                      style: TextStyle(
                                          fontSize: Responsive.isSmall(context)
                                              ? 10
                                              : 12,
                                          fontWeight: FontWeight.bold,
                                          color: AppTheme.textPrimary)),
                                ],
                              ),
                            ],
                          ),

                          const SizedBox(height: 4),
                          Text(
                            rhythmStatus,
                            style: TextStyle(
                              fontSize: Responsive.isSmall(context) ? 9 : 11,
                              fontWeight: FontWeight.bold,
                              color: isOnRhythm
                                  ? AppTheme.success
                                  : AppTheme.warning,
                            ),
                          ),
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
                    padding: EdgeInsets.all(16),
                    child: SkeletonList(itemCount: 6, itemHeight: 60),
                  )
                : _error != null
                    ? Center(
                        child: Text('Error: $_error',
                            style: const TextStyle(color: AppTheme.error)))
                    : isAllMode
                        ? _buildAllVendorsTable(
                            breakdown) // Show ALL vendors table
                        : totalTarget <= 0 &&
                                !isInformative &&
                                !((_data?['isExcluded'] as bool?) ??
                                    false) // ZERO TARGET WARNING (but NOT if excluded)
                            ? const Center(
                                child: Padding(
                                  padding: EdgeInsets.all(32),
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.search_off_rounded,
                                          size: 56,
                                          color: AppTheme.textTertiary),
                                      SizedBox(height: 16),
                                      Text(
                                        'No se han encontrado comisiones para los filtros seleccionados',
                                        textAlign: TextAlign.center,
                                        style: TextStyle(
                                            color: AppTheme.textTertiary,
                                            fontSize: 16,
                                            fontWeight: FontWeight.w500),
                                      ),
                                      SizedBox(height: 8),
                                      Text(
                                        'Prueba a seleccionar otro comercial o verifica que existan datos de ventas disponibles.',
                                        textAlign: TextAlign.center,
                                        style: TextStyle(
                                            color: AppTheme.textTertiary,
                                            fontSize: 13),
                                      ),
                                    ],
                                  ),
                                ),
                              )
                            : SingleChildScrollView(
                                child: SingleChildScrollView(
                                  scrollDirection: Axis.horizontal,
                                  child: DataTable(
                                    columnSpacing: 20,
                                    headingRowColor: WidgetStateProperty.all(
                                      AppTheme.softPanel,
                                    ),
                                    border: TableBorder.all(
                                      color: AppTheme.borderColor,
                                    ),
                                    columns: [
                                      const DataColumn(
                                          label: Text('MES',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.textSecondary))),
                                      const DataColumn(
                                          label: Text('OBJ. MES',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.textSecondary))),
                                      const DataColumn(
                                          label: Text('VENTA LAC',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.textSecondary))),
                                      const DataColumn(
                                          label: Text('VENTA B',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.textSecondary))),
                                      const DataColumn(
                                          label: Text('VENTA TOTAL',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.textSecondary))),
                                      const DataColumn(
                                          label: Text('ESTADO',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.textSecondary))),
                                      const DataColumn(
                                          label: Text('%',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.textSecondary))),
                                      const DataColumn(
                                          label: Text('COMISIÓN',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color: AppTheme.success))),
                                      const DataColumn(
                                          label: Text('DÍAS',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.accentIndigo))),
                                      DataColumn(
                                          label: Text('OBJ. ACUM.',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.accentIndigo))),
                                      DataColumn(
                                          label: Text('RITMO',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.accentIndigo))),
                                      DataColumn(
                                          label: Text('DIFF',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.accentIndigo))),
                                      DataColumn(
                                          label: Text('COM. PROV.',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color:
                                                      AppTheme.accentIndigo))),
                                      // === PAGOS (NEW) ===
                                      DataColumn(
                                          label: Text('IMP. PAGADO',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color: AppTheme.info))),
                                      DataColumn(
                                          label: Text('VENTA REAL',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color: AppTheme.info))),
                                      DataColumn(
                                          label: Text('OBJ. REAL',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color: AppTheme.info))),
                                      DataColumn(
                                          label: Text('OBSERVACIONES',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color: AppTheme.info))),
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
    const names = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre'
    ];
    if (m < 1 || m > 12) return 'Mes $m';
    return names[m - 1];
  }

  Widget _buildTierChip(String tier, String range, String rate) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 4),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.info.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.info.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            decoration: BoxDecoration(
              color: AppTheme.info.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(tier,
                style: const TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.info)),
          ),
          const SizedBox(width: 4),
          Text('$range → $rate',
              style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }

  Widget _buildAllVendorsTable(List<dynamic> breakdown) {
    if (breakdown.isEmpty) {
      return const Center(
          child: Text('No hay datos disponibles',
              style: TextStyle(color: AppTheme.textSecondary)));
    }

    try {
      // Sort by grand total descending, handle nulls defensively
      final sorted = List<Map<String, dynamic>>.from(breakdown);
      sorted.sort((a, b) {
        final valA = (a['grandTotalCommission'] as num?)?.toDouble() ?? 0.0;
        final valB = (b['grandTotalCommission'] as num?)?.toDouble() ?? 0.0;
        return valB.compareTo(valA); // Descending
      });

      // Get payment authorization status
      final authState = ref.watch(authProvider).value;
      final curCode =
          (authState?.user?.code?.trim() ?? '').replaceFirst(RegExp('^0+'), '');
      final canPay =
          authState?.user?.tipoVendedor == 'ADMIN' || curCode == '98';

      return ColoredBox(
        color: AppTheme.inkSurface,
        child: ListView.builder(
          itemCount: sorted.length,
          itemBuilder: (context, index) {
            try {
              final r = sorted[index];
              final grandTotal =
                  (r['grandTotalCommission'] as num?)?.toDouble() ?? 0.0;
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
                color: AppTheme.error.withValues(alpha: 0.1),
                child: Text(
                    'Error mostrando vendedor: ${sorted[index]['vendedorCode'] ?? '?'}',
                    style: const TextStyle(color: AppTheme.error)),
              );
            }
          },
        ),
      );
    } catch (e) {
      debugPrint('Error sorting/building vendors table: $e');
      return Center(
          child: Text('Error mostrando lista: $e',
              style: const TextStyle(color: AppTheme.error)));
    }
  }

  Widget _buildTeamLeadTablePanel(Map<String, dynamic> team) {
    final monthRows =
        (team['months'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final nowMonth = DateTime.now().month;
    final ytdTeamComm =
        (team['annualTeamAggregateCommission'] as num?)?.toDouble() ??
            (team['annualTeamMembersCommission'] as num?)?.toDouble() ??
            0;
    final leaderOwnCommission =
        (_data?['grandTotalCommission'] as num?)?.toDouble() ??
            (team['leaderPersonalCommission'] as num?)?.toDouble() ??
            0;
    final totalToLeader = leaderOwnCommission + ytdTeamComm;

    final rows = <DataRow>[];
    for (final monthData in monthRows) {
      final month = (monthData['month'] as num?)?.toInt() ?? 0;
      if (month <= 0 || month > nowMonth) continue;

      final qualifies = (monthData['teamAggregateQualifies'] as bool?) ?? false;
      final tier = (monthData['teamAggregateTier'] as num?)?.toInt() ?? 0;
      rows.add(
        DataRow(
          color: WidgetStateProperty.all(
            qualifies
                ? AppTheme.success.withValues(alpha: 0.07)
                : AppTheme.warning.withValues(alpha: 0.07),
          ),
          cells: [
            DataCell(_teamTableText(_getMonthName(month))),
            DataCell(_teamTableText('80+72+73+81+83')),
            DataCell(_teamTableMoney(monthData['teamAggregatePrevSales'])),
            DataCell(_teamTableMoney(monthData['teamAggregateThreshold'])),
            DataCell(_teamTableMoney(monthData['teamAggregateCurrentSales'])),
            DataCell(_teamTableMoney(monthData['teamAggregateExcess'])),
            DataCell(_teamTableText(tier > 0 ? 'F$tier' : '-')),
            DataCell(
              _teamTableText(
                CurrencyFormatter.format(
                  (monthData['teamAggregateCommission'] as num?)?.toDouble() ??
                      0,
                ),
                color: qualifies ? AppTheme.success : AppTheme.warning,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      padding: const EdgeInsets.all(14),
      decoration: _commissionSurfaceDecoration(
        color: AppTheme.raisedSurface,
        borderColor: AppTheme.success,
        borderAlpha: 0.32,
        radius: AppTheme.radiusLg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.groups_rounded,
                  color: AppTheme.success, size: 22),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Equipo Almeria - acumulado especial 80',
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                  ),
                ),
              ),
              Text(
                CurrencyFormatter.format(totalToLeader),
                style: const TextStyle(
                  color: AppTheme.success,
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Propia 80: ${CurrencyFormatter.format(leaderOwnCommission)} | Especial acumulado: ${CurrencyFormatter.format(ytdTeamComm)}',
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 12),
          ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: Responsive.isSmall(context) ? 220 : 320,
            ),
            child: Scrollbar(
              child: SingleChildScrollView(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    headingRowHeight: 34,
                    dataRowMinHeight: 34,
                    dataRowMaxHeight: 42,
                    columnSpacing: 18,
                    horizontalMargin: 10,
                    headingRowColor: WidgetStateProperty.all(
                      AppTheme.softPanel,
                    ),
                    border: TableBorder.all(color: AppTheme.borderColor),
                    headingTextStyle: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.bold,
                      fontSize: 11,
                    ),
                    dataTextStyle: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontSize: 11,
                    ),
                    columns: const [
                      DataColumn(label: Text('Mes')),
                      DataColumn(label: Text('Origen')),
                      DataColumn(label: Text('Venta LY'), numeric: true),
                      DataColumn(label: Text('Umbral LY+10'), numeric: true),
                      DataColumn(label: Text('Venta actual'), numeric: true),
                      DataColumn(label: Text('Exceso'), numeric: true),
                      DataColumn(label: Text('Franja')),
                      DataColumn(label: Text('Comision'), numeric: true),
                    ],
                    rows: rows,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _teamTableMoney(dynamic value) => _teamTableText(
        CurrencyFormatter.format((value as num?)?.toDouble() ?? 0),
        color: AppTheme.textPrimary,
      );

  Widget _teamTableText(
    String value, {
    Color color = AppTheme.textSecondary,
    FontWeight fontWeight = FontWeight.w500,
  }) {
    return Text(
      value,
      style: TextStyle(color: color, fontSize: 11, fontWeight: fontWeight),
    );
  }

  Widget _buildTeamLeadPanel(Map<String, dynamic> team) {
    if (team.isNotEmpty) {
      return _buildTeamLeadTablePanel(team);
    }

    final members = (team['teamMembers'] as List?)?.cast<String>() ?? [];
    final monthRows =
        (team['months'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final nowMonth = DateTime.now().month;
    final ytdTeamComm =
        (team['annualTeamAggregateCommission'] as num?)?.toDouble() ??
            (team['annualTeamMembersCommission'] as num?)?.toDouble() ??
            0;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      padding: const EdgeInsets.all(14),
      decoration: _commissionSurfaceDecoration(
        color: AppTheme.raisedSurface,
        borderColor: AppTheme.success,
        borderAlpha: 0.32,
        radius: AppTheme.radiusLg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.groups_rounded, color: AppTheme.success, size: 22),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Equipo Almería — comisión por comercial',
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Especial 80 sobre acumulado 80+${members.join(', ')} con umbral LY+10, sin IPC.',
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 10),
          Text(
            'Especial acumulado YTD: ${CurrencyFormatter.format(ytdTeamComm)}',
            style: const TextStyle(
              color: AppTheme.success,
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          ...monthRows
              .where((m) => ((m['month'] as num?)?.toInt() ?? 0) <= nowMonth)
              .map((m) {
            final month = (m['month'] as num?)?.toInt() ?? 0;
            final teamComm =
                (m['teamAggregateCommission'] as num?)?.toDouble() ??
                    (m['teamMembersCommission'] as num?)?.toDouble() ??
                    0;
            final teamExcess = (m['teamAggregateExcess'] as num?)?.toDouble() ??
                (m['teamMembersExcess'] as num?)?.toDouble() ??
                0;
            final qualifying = (m['qualifyingMembers'] as num?)?.toInt() ?? 0;
            final memberList =
                (m['members'] as List?)?.cast<Map<String, dynamic>>() ?? [];
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _getMonthName(month),
                    style: const TextStyle(
                      color: AppTheme.info,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    'Equipo: $qualifying/4 superan umbral · '
                    'exceso ${CurrencyFormatter.format(teamExcess)} · '
                    'comisión ${CurrencyFormatter.format(teamComm)}',
                    style: const TextStyle(
                      color: AppTheme.success,
                      fontSize: 12,
                    ),
                  ),
                  ...memberList.map((mem) {
                    final code = mem['vendorCode']?.toString() ?? '';
                    final qualifies = (mem['qualifies'] as bool?) ?? false;
                    final ventas =
                        (mem['currentSales'] as num?)?.toDouble() ?? 0;
                    final umbral = (mem['threshold'] as num?)?.toDouble() ?? 0;
                    final comm = (mem['commission'] as num?)?.toDouble() ?? 0;
                    final tier = (mem['tier'] as num?)?.toInt() ?? 0;
                    return Text(
                      '  · $code — ${qualifies ? 'COMISIONA' : 'no'} · '
                      'ventas ${CurrencyFormatter.format(ventas)} / obj. ${CurrencyFormatter.format(umbral)}'
                      '${tier > 0 ? ' · F$tier' : ''} · '
                      'com. ${CurrencyFormatter.format(comm)}',
                      style: TextStyle(
                        color: qualifies
                            ? AppTheme.success.withValues(alpha: 0.85)
                            : AppTheme.warning,
                        fontSize: 11,
                      ),
                    );
                  }),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}

/// Expandable card for each vendor in ALL mode
class _VendorExpandableCard extends StatefulWidget {
  const _VendorExpandableCard({
    required this.data,
    required this.getMonthName,
    super.key,
    this.canPay = false,
    this.onPay,
  });
  final Map<String, dynamic> data;
  final bool canPay;
  final String Function(int) getMonthName;
  final Function(String, String)? onPay;

  @override
  State<_VendorExpandableCard> createState() => _VendorExpandableCardState();
}

class _VendorExpandableCardState extends State<_VendorExpandableCard> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final vendorCode = data['vendedorCode']?.toString() ?? '?';
    final vendorName = data['vendorName']?.toString() ?? 'Vendedor';
    final isExcluded = (data['isExcluded'] as bool?) ?? false;
    final grandTotal = (data['grandTotalCommission'] as num?)?.toDouble() ?? 0;

    final payments = (data['payments'] as Map?) ?? {};
    final totalPaid = (payments['total'] as num?)?.toDouble() ?? 0;
    final months = (data['months'] as List?) ?? [];
    final quarters = (data['quarters'] as List?) ?? [];

    // Calculate vendor totals (only non-future months for meaningful %)
    double totalTarget = 0, totalActual = 0;
    for (final m in months) {
      final isFuture = (m['isFuture'] as bool?) ?? false;
      if (!isFuture) {
        totalTarget += (m['target'] as num?)?.toDouble() ?? 0;
        totalActual += (m['actual'] as num?)?.toDouble() ?? 0;
      }
    }
    final vendorPct = totalTarget > 0 ? (totalActual / totalTarget * 100) : 0.0;
    final vendorPositive = totalActual >= totalTarget && totalTarget > 0;
    final statusColor = isExcluded
        ? AppTheme.textTertiary
        : (vendorPositive ? AppTheme.success : AppTheme.error);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: _commissionSurfaceDecoration(
        color: isExcluded
            ? AppTheme.mutedPanel.withValues(alpha: 0.54)
            : AppTheme.raisedSurface,
        borderColor: _isExpanded ? AppTheme.info : AppTheme.borderColor,
        borderAlpha: _isExpanded ? 0.5 : 1,
        radius: AppTheme.radiusLg,
      ),
      child: Column(
        children: [
          // HEADER (always visible) - tap to expand/collapse
          InkWell(
            onTap: () => setState(() => _isExpanded = !_isExpanded),
            borderRadius: BorderRadius.circular(8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: _commissionSurfaceDecoration(
                color: _isExpanded
                    ? AppTheme.info.withValues(alpha: 0.08)
                    : Colors.transparent,
                borderColor: Colors.transparent,
                radius: AppTheme.radiusLg,
              ),
              child: Row(
                children: [
                  // Left: Circle Avatar with Vendor Code
                  CircleAvatar(
                    radius: Responsive.isSmall(context) ? 10 : 12,
                    backgroundColor: isExcluded
                        ? AppTheme.mutedPanel
                        : AppTheme.info.withValues(alpha: 0.12),
                    child: Text(vendorCode,
                        style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: isExcluded
                                ? AppTheme.textTertiary
                                : AppTheme.info,
                            fontSize: Responsive.isSmall(context) ? 8 : 10)),
                  ),
                  const SizedBox(width: 8),

                  // Center: Name
                  Expanded(
                    child: Text(vendorName,
                        style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: isExcluded
                                ? AppTheme.textTertiary
                                : AppTheme.textPrimary,
                            fontSize: Responsive.isSmall(context) ? 11 : 13),
                        overflow: TextOverflow.ellipsis),
                  ),
                  const SizedBox(width: 8),
                  if (isExcluded) ...[
                    // Clear "NO COMISIONA" badge for excluded vendors
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                          color: AppTheme.warning.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(4)),
                      child: const Text('NO COMISIONA',
                          style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.warning)),
                    ),
                    const SizedBox(width: 8),
                  ],
                  // Compliance: Obj vs Venta for active months only
                  Tooltip(
                    message:
                        'Cumplimiento acumulado de meses activos (excluyendo futuros)',
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                            vendorPositive
                                ? Icons.trending_up
                                : Icons.trending_down,
                            color: statusColor,
                            size: 14),
                        const SizedBox(width: 4),
                        Text(
                          'Cumpl: ${vendorPct.toStringAsFixed(1)}% (Vta: ${CurrencyFormatter.format(totalActual)} / Obj: ${CurrencyFormatter.format(totalTarget)})',
                          style: TextStyle(
                              color: statusColor,
                              fontWeight: FontWeight.bold,
                              fontSize: Responsive.isSmall(context) ? 8 : 10),
                        ),
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
                            Text(
                                'Generado: ${CurrencyFormatter.format(grandTotal)}',
                                style: TextStyle(
                                    color: AppTheme.success,
                                    fontWeight: FontWeight.bold,
                                    fontSize:
                                        Responsive.isSmall(context) ? 10 : 12)),
                            Text(
                              'Pagado: ${CurrencyFormatter.format(totalPaid)}',
                              style: TextStyle(
                                  color: AppTheme.info,
                                  fontWeight: FontWeight.bold,
                                  fontSize:
                                      Responsive.isSmall(context) ? 8 : 9),
                            ),
                          ],
                        ),
                      ],
                    ),
                    if (widget.canPay)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: IconButton(
                          icon: const Icon(Icons.payment_rounded,
                              color: AppTheme.info, size: 22),
                          onPressed: () =>
                              widget.onPay?.call(vendorCode, vendorName),
                          tooltip: 'Pagar',
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                        ),
                      ),
                  ] else
                    const Text('0,00 €',
                        style: TextStyle(
                            color: AppTheme.textTertiary, fontSize: 12)),
                ],
              ),
            ),
          ),

          // EXPANDED CONTENT
          if (_isExpanded) ...[
            const Divider(height: 1, color: AppTheme.borderColor),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: _buildVendorDataTable(months, quarters, isExcluded),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildVendorDataTable(
      List<dynamic> months, List<dynamic> quarters, bool isExcluded) {
    final rows = <DataRow>[];
    final sortedMonths = List<dynamic>.from(months);
    sortedMonths.sort((a, b) => ((a['month'] as num?)?.toInt() ?? 0)
        .compareTo((b['month'] as num?)?.toInt() ?? 0));

    // Quarter definitions: Q1 = Ene-Abr, Q2 = May-Ago, Q3 = Sep-Dic
    const quarterRanges = [
      {'name': 'CUATRIMESTRE 1', 'label': 'Ene - Abr', 'start': 1, 'end': 4},
      {'name': 'CUATRIMESTRE 2', 'label': 'May - Ago', 'start': 5, 'end': 8},
      {'name': 'CUATRIMESTRE 3', 'label': 'Sep - Dic', 'start': 9, 'end': 12},
    ];

    var quarterIndex = 0;

    for (final m in sortedMonths) {
      final monthNum = (m['month'] as num?)?.toInt() ?? 0;

      // Check if we need to insert a quarter header BEFORE this month
      while (quarterIndex < quarterRanges.length &&
          monthNum > (quarterRanges[quarterIndex]['end']! as int)) {
        // Add quarter summary row
        final qr = quarterRanges[quarterIndex];
        final qData =
            quarters.length > quarterIndex ? quarters[quarterIndex] : null;
        rows.add(_buildQuarterRow(qr, qData, isExcluded));
        quarterIndex++;
      }

      // Add month row
      rows.add(_buildMonthRow(m, isExcluded));
    }

    // Add remaining quarters
    while (quarterIndex < quarterRanges.length) {
      final qr = quarterRanges[quarterIndex];
      final qData =
          quarters.length > quarterIndex ? quarters[quarterIndex] : null;
      rows.add(_buildQuarterRow(qr, qData, isExcluded));
      quarterIndex++;
    }

    return DataTable(
      columnSpacing: 10,
      dataRowMinHeight: 28,
      dataRowMaxHeight: 44,
      headingRowHeight: 36,
      headingRowColor: WidgetStateProperty.all(AppTheme.softPanel),
      border: TableBorder.all(color: AppTheme.borderColor),
      columns: const [
        DataColumn(
            label: Text('MES',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10))),
        DataColumn(
            label: Text('OBJETIVO',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10))),
        DataColumn(
            label: Text('VENTA LAC',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10))),
        DataColumn(
            label: Text('VENTA B',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10))),
        DataColumn(
            label: Text('VENTA TOTAL',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10))),
        DataColumn(
            label: Text('EST.',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10))),
        DataColumn(
            label: Text('%',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10))),
        DataColumn(
            label: Text('COMISIÓN',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.success,
                    fontSize: 10))),
        DataColumn(
            label: Text('DÍAS',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.accentIndigo,
                    fontSize: 10))),
        DataColumn(
            label: Text('OBJ.AC',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.accentIndigo,
                    fontSize: 10))),
        DataColumn(
            label: Text('RITMO',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.accentIndigo,
                    fontSize: 10))),
        DataColumn(
            label: Text('DIFF',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.accentIndigo,
                    fontSize: 10))),
        DataColumn(
            label: Text('COM.PRV',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.accentIndigo,
                    fontSize: 10))),
        DataColumn(
            label: Text('IMP.PAG',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.info,
                    fontSize: 10))),
        DataColumn(
            label: Text('V.REAL',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.info,
                    fontSize: 10))),
        DataColumn(
            label: Text('OBJ.REAL',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.info,
                    fontSize: 10))),
        DataColumn(
            label: Text('OBSERV.',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.info,
                    fontSize: 10))),
      ],
      rows: rows,
    );
  }

  DataRow _buildMonthRow(dynamic m, bool isExcluded) {
    final monthNum = (m['month'] as num?)?.toInt() ?? 0;
    final target = (m['target'] as num?)?.toDouble() ?? 0;
    final actual = (m['actual'] as num?)?.toDouble() ?? 0;
    final bSales = (m['bSales'] as num?)?.toDouble() ?? 0;
    final lacSalesRaw = (m['lacSales'] as num?)?.toDouble();
    final lacSalesFallback = actual - bSales;
    final lacSales =
        lacSalesRaw ?? (lacSalesFallback > 0 ? lacSalesFallback : 0);
    final totalSales = (m['totalSales'] as num?)?.toDouble() ?? actual;
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
    final provisionalCommission =
        (dailyCtx['provisionalCommission'] as num?)?.toDouble() ?? 0;
    final dailyPct = (dailyCtx['pct'] as num?)?.toDouble() ?? 0;

    final isPositive = actual >= target && target > 0;
    final color = isFuture || isExcluded
        ? AppTheme.textTertiary
        : (isPositive ? AppTheme.success : AppTheme.error);
    final dailyColor = isFuture || isExcluded
        ? AppTheme.textTertiary
        : (dailyGreen ? AppTheme.success : AppTheme.warning);
    final textOpacity = (isFuture || isExcluded) ? 0.5 : 1.0;

    final pctDisplay = pct > 0 ? (pct - 100) : 0;
    final pctText = isFuture
        ? '-'
        : (pct > 100
            ? '+${pctDisplay.toStringAsFixed(1)}%'
            : '${pct.toStringAsFixed(1)}%');
    final dailyPctDisplay = dailyPct > 0 ? (dailyPct - 100) : 0;
    final dailyPctText = dailyPct > 100
        ? '+${dailyPctDisplay.toStringAsFixed(1)}%'
        : '${dailyPct.toStringAsFixed(1)}%';

    return DataRow(
      color: WidgetStateProperty.all(
          isFuture ? AppTheme.mutedPanel : Colors.transparent),
      cells: [
        DataCell(
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(widget.getMonthName(monthNum),
                  style: TextStyle(
                      color:
                          AppTheme.textPrimary.withValues(alpha: textOpacity),
                      fontSize: 11)),
              if (isFuture) ...[
                const SizedBox(width: 4),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
                  decoration: BoxDecoration(
                      color: AppTheme.textTertiary.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(3)),
                  child: const Text('PEND',
                      style:
                          TextStyle(fontSize: 7, color: AppTheme.textTertiary)),
                ),
              ],
            ],
          ),
        ),
        DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(target),
            style: TextStyle(
                color: AppTheme.textPrimary.withValues(alpha: textOpacity),
                fontSize: 10))),
        DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(lacSales),
            style: TextStyle(
                color: color, fontWeight: FontWeight.bold, fontSize: 10))),
        DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(bSales),
            style: TextStyle(
                color: bSales > 0 ? AppTheme.info : AppTheme.textTertiary,
                fontWeight: bSales > 0 ? FontWeight.bold : FontWeight.normal,
                fontSize: 10))),
        DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(totalSales),
            style: TextStyle(
                color: color, fontWeight: FontWeight.bold, fontSize: 10))),
        DataCell(
          isFuture
              ? const Text('-',
                  style: TextStyle(color: AppTheme.textTertiary, fontSize: 10))
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(isPositive ? Icons.check_circle : Icons.cancel,
                        color: color, size: 12),
                    if (isPositive && tier > 0)
                      Text(' F$tier',
                          style: const TextStyle(
                              fontSize: 8, color: AppTheme.info)),
                  ],
                ),
        ),
        DataCell(Text(pctText, style: TextStyle(color: color, fontSize: 9))),
        DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(commission),
            style: TextStyle(
                color: isFuture ? AppTheme.textTertiary : AppTheme.success,
                fontWeight: FontWeight.bold,
                fontSize: 10))),
        DataCell(Text(isFuture ? '-' : '$daysPassed/$workingDays',
            style: TextStyle(
                color:
                    AppTheme.textPrimary.withValues(alpha: textOpacity * 0.7),
                fontSize: 9))),
        DataCell(Text(isFuture ? '-' : CurrencyFormatter.format(proRatedTarget),
            style: TextStyle(
                fontSize: 9,
                color: AppTheme.textPrimary.withValues(alpha: textOpacity)))),
        DataCell(
          isFuture
              ? const Text('-',
                  style: TextStyle(color: AppTheme.textTertiary, fontSize: 9))
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(dailyGreen ? Icons.check_circle : Icons.warning_amber,
                        color: dailyColor, size: 10),
                    Text(' $dailyPctText',
                        style: TextStyle(fontSize: 8, color: dailyColor)),
                  ],
                ),
        ),
        DataCell(
          isFuture
              ? const Text('-',
                  style: TextStyle(color: AppTheme.textTertiary, fontSize: 9))
              : Text(
                  (actual - proRatedTarget) >= 0
                      ? '+${CurrencyFormatter.format(actual - proRatedTarget)}'
                      : CurrencyFormatter.format(actual - proRatedTarget),
                  style: TextStyle(
                      color: (actual - proRatedTarget) >= 0
                          ? AppTheme.success
                          : AppTheme.error,
                      fontWeight: FontWeight.bold,
                      fontSize: 9),
                ),
        ),
        DataCell(
          isFuture
              ? const Text('-',
                  style: TextStyle(color: AppTheme.textTertiary, fontSize: 9))
              : Text(
                  CurrencyFormatter.format(provisionalCommission),
                  style: TextStyle(
                      color: provisionalCommission > 0
                          ? AppTheme.accentIndigo
                          : AppTheme.textTertiary,
                      fontWeight: FontWeight.bold,
                      fontSize: 9),
                ),
        ),
        // === PAGOS (NEW) ===
        // IMPORTE PAGADO
        DataCell(
          Builder(
            builder: (context) {
              final payments = widget.data['payments'] as Map?;
              final detailsMap = payments?['details'] as Map?;
              final details = detailsMap?[monthNum] ??
                  detailsMap?['$monthNum'] ??
                  detailsMap?[monthNum.toString()];
              final importePagado =
                  ((details as Map?)?['totalPaid'] as num?)?.toDouble() ?? 0;
              return importePagado > 0
                  ? Text(
                      CurrencyFormatter.format(importePagado),
                      style: const TextStyle(
                          color: AppTheme.success,
                          fontSize: 9,
                          fontWeight: FontWeight.bold),
                    )
                  : const Text('-',
                      style:
                          TextStyle(color: AppTheme.textTertiary, fontSize: 9));
            },
          ),
        ),
        // VENTA REAL (momento pago)
        DataCell(
          Builder(
            builder: (context) {
              final payments = widget.data['payments'] as Map?;
              final detailsMap = payments?['details'] as Map?;
              final details = detailsMap?[monthNum] ??
                  detailsMap?['$monthNum'] ??
                  detailsMap?[monthNum.toString()];
              final ventaComision =
                  ((details as Map?)?['ventaComision'] as num?)?.toDouble() ??
                      0;
              return ventaComision > 0
                  ? Text(
                      CurrencyFormatter.format(ventaComision),
                      style: const TextStyle(
                          color: AppTheme.info,
                          fontSize: 9,
                          fontWeight: FontWeight.bold),
                    )
                  : const Text('-',
                      style:
                          TextStyle(color: AppTheme.textTertiary, fontSize: 9));
            },
          ),
        ),
        // OBJ. REAL (snapshot al momento del pago)
        DataCell(
          Builder(
            builder: (context) {
              final payments = widget.data['payments'] as Map?;
              final detailsMap = payments?['details'] as Map?;
              final details = detailsMap?[monthNum] ??
                  detailsMap?['$monthNum'] ??
                  detailsMap?[monthNum.toString()];
              final objetivoReal =
                  ((details as Map?)?['objetivoReal'] as num?)?.toDouble() ?? 0;
              return objetivoReal > 0
                  ? Text(
                      CurrencyFormatter.format(objetivoReal),
                      style: const TextStyle(
                          color: AppTheme.accentAmber,
                          fontSize: 9,
                          fontWeight: FontWeight.bold),
                    )
                  : const Text('-',
                      style:
                          TextStyle(color: AppTheme.textTertiary, fontSize: 9));
            },
          ),
        ),
        // OBSERVACIONES
        DataCell(
          Builder(
            builder: (context) {
              final payments = widget.data['payments'] as Map?;
              final detailsMap = payments?['details'] as Map?;
              final details = detailsMap?[monthNum] ??
                  detailsMap?['$monthNum'] ??
                  detailsMap?[monthNum.toString()];
              final observaciones =
                  ((details as Map?)?['observaciones'] as List?)?.join(' | ') ??
                      '';
              return observaciones.isNotEmpty
                  ? Tooltip(
                      message: observaciones,
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 120),
                        child: Text(
                          observaciones,
                          style: const TextStyle(
                              color: AppTheme.warning,
                              fontSize: 9,
                              fontStyle: FontStyle.italic),
                          overflow: TextOverflow.ellipsis,
                          maxLines: 1,
                        ),
                      ),
                    )
                  : const Text('-',
                      style:
                          TextStyle(color: AppTheme.textTertiary, fontSize: 9));
            },
          ),
        ),
      ],
    );
  }

  DataRow _buildQuarterRow(
      Map<String, dynamic> qr, dynamic qData, bool isExcluded) {
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
    for (var m = startMonth; m <= endMonth; m++) {
      quarterPaid += (monthlyPaidMap[m] as num?)?.toDouble() ??
          (monthlyPaidMap['$m'] as num?)?.toDouble() ??
          (monthlyPaidMap[m.toString()] as num?)?.toDouble() ??
          0;
    }

    return DataRow(
      color:
          WidgetStateProperty.all(AppTheme.accentIndigo.withValues(alpha: 0.1)),
      cells: [
        DataCell(
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.calendar_view_month,
                  color: AppTheme.accentIndigo, size: 14),
              const SizedBox(width: 4),
              Text(name,
                  style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      color: AppTheme.accentIndigo,
                      fontSize: 10)),
              const SizedBox(width: 4),
              Text('($label)',
                  style: TextStyle(
                      color: AppTheme.textPrimary.withValues(alpha: 0.5),
                      fontSize: 9)),
            ],
          ),
        ),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        const DataCell(SizedBox()),
        DataCell(
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Gen: ${CurrencyFormatter.format(total)}',
                  style: TextStyle(
                      fontSize: 9,
                      color: isExcluded
                          ? AppTheme.textTertiary
                          : AppTheme.textSecondary)),
              Text('Pag: ${CurrencyFormatter.format(quarterPaid)}',
                  style: TextStyle(
                      fontSize: 10,
                      color:
                          isExcluded ? AppTheme.textTertiary : AppTheme.success,
                      fontWeight: FontWeight.bold)),
            ],
          ),
        ),
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
