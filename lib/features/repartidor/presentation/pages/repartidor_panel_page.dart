/// REPARTIDOR PANEL PAGE v1.0
/// Dashboard adaptado para reparto con métricas de entregas, cobros y resumen diario
/// Equivalente al Panel de Ventas pero enfocado a operativa de reparto
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/error_state_widget.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

typedef RepartidorDeliverySummaryLoader = Future<Map<String, dynamic>>
    Function({
  required String repartidorId,
  required int year,
  required int month,
});

typedef RepartidorMonthlySummaryLoader = Future<RepartidorMonthlySummary>
    Function({
  required String repartidorId,
  required int year,
  required int month,
});

class RepartidorPanelPage extends StatefulWidget {
  const RepartidorPanelPage({
    required this.repartidorId,
    super.key,
    this.deliverySummaryLoader,
    this.monthlySummaryLoader,
  });

  final String repartidorId;
  final RepartidorDeliverySummaryLoader? deliverySummaryLoader;
  final RepartidorMonthlySummaryLoader? monthlySummaryLoader;

  @override
  State<RepartidorPanelPage> createState() => _RepartidorPanelPageState();
}

class _PanelLoadResult<T> {
  const _PanelLoadResult.success(this.value) : error = null;
  const _PanelLoadResult.failure(this.error) : value = null;

  final T? value;
  final Object? error;
}

class _RepartidorPanelPageState extends State<RepartidorPanelPage> {
  bool _isLoading = true;
  bool _isPartial = false;
  bool _isEmpty = false;
  bool _deliveryAvailable = false;
  String? _error;

  Map<String, dynamic> _deliverySummary = {};
  RepartidorMonthlySummary? _monthlyFinance;
  List<Map<String, dynamic>> _dailyData = [];

  int _selectedYear = DateTime.now().year;
  int _selectedMonth = DateTime.now().month;

  @override
  void initState() {
    super.initState();
    _loadAllData();
  }

  Future<_PanelLoadResult<T>> _capture<T>(Future<T> operation) async {
    try {
      return _PanelLoadResult<T>.success(await operation);
    } catch (error) {
      return _PanelLoadResult<T>.failure(error);
    }
  }

  Future<Map<String, dynamic>> _loadDeliverySummary() {
    final loader = widget.deliverySummaryLoader;
    if (loader != null) {
      return loader(
        repartidorId: widget.repartidorId,
        year: _selectedYear,
        month: _selectedMonth,
      );
    }
    return RepartidorDataService.getDeliverySummary(
      repartidorId: widget.repartidorId,
      year: _selectedYear,
      month: _selectedMonth,
    );
  }

  Future<RepartidorMonthlySummary> _loadMonthlySummary() {
    final loader = widget.monthlySummaryLoader;
    if (loader != null) {
      return loader(
        repartidorId: widget.repartidorId,
        year: _selectedYear,
        month: _selectedMonth,
      );
    }
    return RepartidorFinanzasService().getMonthlySummary(
      repartidorId: widget.repartidorId,
      year: _selectedYear,
      month: _selectedMonth,
    );
  }

  Future<void> _loadAllData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    final deliveryFuture = _capture<Map<String, dynamic>>(
      _loadDeliverySummary(),
    );
    final financeFuture = _capture<RepartidorMonthlySummary>(
      _loadMonthlySummary(),
    );
    final deliveryResult = await deliveryFuture;
    final financeResult = await financeFuture;
    if (!mounted) return;

    final deliveryData = deliveryResult.value;
    final summary = Map<String, dynamic>.from(
      (deliveryData?['summary'] as Map?) ?? const <String, dynamic>{},
    );
    final daily = ((deliveryData?['daily'] as List?) ?? const <dynamic>[])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final finance = financeResult.value;
    final allFailed =
        deliveryResult.error != null && financeResult.error != null;
    final hasDeliveryData = daily.isNotEmpty ||
        summary.values.any((value) => value is num && value != 0);

    setState(() {
      _deliverySummary = summary;
      _dailyData = daily;
      _monthlyFinance = finance;
      _deliveryAvailable = deliveryResult.error == null;
      _isPartial = !allFailed &&
          (deliveryResult.error != null || financeResult.error != null);
      _isEmpty =
          !allFailed && !_isPartial && !hasDeliveryData && finance!.isEmpty;
      _error = allFailed ? 'No se pudieron cargar los datos del periodo' : null;
      _isLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: Column(
        children: [
          _buildHeader(),
          Expanded(
            child: _isLoading
                ? const SkeletonList(itemCount: 4, itemHeight: 112)
                : _error != null
                    ? ErrorStateWidget(
                        message: _error!,
                        onRetry: _loadAllData,
                      )
                    : RefreshIndicator(
                        onRefresh: _loadAllData,
                        child: ListView(
                          padding: EdgeInsets.all(
                            Responsive.padding(context, small: 10, large: 16),
                          ),
                          children: [
                            if (_isPartial) ...[
                              _buildPartialNotice(),
                              const SizedBox(height: 16),
                            ],
                            if (_isEmpty)
                              _buildEmptyState()
                            else ...[
                              if (_deliveryAvailable) ...[
                                _buildKPICards(),
                                const SizedBox(height: 16),
                              ],
                              _buildFinancialCard(),
                              if (_deliveryAvailable) ...[
                                const SizedBox(height: 16),
                                _buildDailyChart(),
                                const SizedBox(height: 16),
                                _buildDailyTable(),
                              ],
                            ],
                          ],
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: EdgeInsets.fromLTRB(
        Responsive.padding(context, small: 12, large: 20),
        20,
        Responsive.padding(context, small: 12, large: 20),
        16,
      ),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(bottom: BorderSide(color: AppTheme.borderColor)),
        boxShadow: AppTheme.elevation1,
      ),
      child: Row(
        children: [
          Container(
            width: Responsive.value(context, phone: 48, desktop: 56),
            height: Responsive.value(context, phone: 48, desktop: 56),
            decoration: BoxDecoration(
              color: AppTheme.info.withValues(alpha: 0.16),
              shape: BoxShape.circle,
              border: Border.all(color: AppTheme.info.withValues(alpha: 0.32)),
            ),
            child: Center(
              child: Text(
                widget.repartidorId.isNotEmpty
                    ? widget.repartidorId
                        .substring(0, math.min(2, widget.repartidorId.length))
                        .toUpperCase()
                    : 'R',
                style: const TextStyle(
                  color: AppTheme.info,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'RESUMEN DEL PERIODO',
                  style: TextStyle(
                    fontSize: 10,
                    color: AppTheme.textTertiary,
                    letterSpacing: 0,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Repartidor ${widget.repartidorId}',
                  style: TextStyle(
                    fontSize: Responsive.fontSize(
                      context,
                      small: 16,
                      large: 20,
                    ),
                    fontWeight: FontWeight.w900,
                    color: AppTheme.textPrimary,
                  ),
                ),
                Text(
                  'Entregas y liquidaciones del periodo',
                  style: TextStyle(
                    fontSize: Responsive.fontSize(
                      context,
                      small: 10,
                      large: 12,
                    ),
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          // Sector de filtros dinámicos (mes/año)
          _buildMonthSelector(),
        ],
      ),
    );
  }

  Widget _buildMonthSelector() {
    final months = [
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic',
    ];
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Year dropdown
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: AppTheme.info.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppTheme.info.withValues(alpha: 0.28)),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<int>(
              value: _selectedYear,
              isDense: true,
              dropdownColor: AppTheme.raisedSurface,
              style: const TextStyle(
                color: AppTheme.info,
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
              items: [
                for (int y = DateTime.now().year;
                    y >= DateTime.now().year - 2;
                    y--)
                  DropdownMenuItem(value: y, child: Text('$y')),
              ],
              onChanged: (v) {
                if (v != null) {
                  setState(() => _selectedYear = v);
                  _loadAllData();
                }
              },
            ),
          ),
        ),
        const SizedBox(width: 8),
        // Month dropdown
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: AppTheme.warning.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppTheme.warning.withValues(alpha: 0.28)),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<int>(
              value: _selectedMonth,
              isDense: true,
              dropdownColor: AppTheme.raisedSurface,
              style: const TextStyle(
                color: AppTheme.warning,
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
              items: [
                for (int m = 1; m <= 12; m++)
                  DropdownMenuItem(value: m, child: Text(months[m - 1])),
              ],
              onChanged: (v) {
                if (v != null) {
                  setState(() => _selectedMonth = v);
                  _loadAllData();
                }
              },
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPartialNotice() {
    final missingLabel = _deliveryAvailable ? 'datos financieros' : 'entregas';
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.warning.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.warning.withValues(alpha: 0.35)),
      ),
      child: ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(
          Icons.warning_amber_rounded,
          color: AppTheme.warning,
        ),
        title: const Text('Datos parciales'),
        subtitle: Text(
          'No se pudieron cargar $missingLabel. El resto de datos sí está disponible.',
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(14),
      ),
      child: ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(Icons.inbox_outlined, color: AppTheme.textSecondary),
        title: Text('Sin datos para este periodo'),
        subtitle: Text('No hay entregas, cobros ni liquidaciones registradas.'),
      ),
    );
  }

  Widget _buildKPICards() {
    final total = _deliverySummary['totalAlbaranes'] ?? 0;
    final entregados = _deliverySummary['entregados'] ?? 0;
    final noEntregados = _deliverySummary['noEntregados'] ?? 0;
    final pendientes = _deliverySummary['pendientes'] ?? 0;
    final importe =
        (_deliverySummary['importeTotal'] as num?)?.toDouble() ?? 0.0;
    final pctEntrega =
        (_deliverySummary['pctEntrega'] as num?)?.toDouble() ?? 0.0;

    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        _kpiWidget(
          'Total Albaranes',
          '$total',
          Icons.receipt_long,
          AppTheme.info,
        ),
        _kpiWidget(
          'Entregados',
          '$entregados',
          Icons.check_circle,
          AppTheme.success,
        ),
        _kpiWidget(
          'No Entregados',
          '$noEntregados',
          Icons.cancel,
          AppTheme.error,
        ),
        _kpiWidget(
          'Pendientes',
          '$pendientes',
          Icons.pending,
          AppTheme.warning,
        ),
        _kpiWidget(
          '% Entrega',
          '${pctEntrega.toStringAsFixed(1)}%',
          Icons.pie_chart,
          AppTheme.accentIndigo,
        ),
        _kpiWidget(
          'Importe Total',
          CurrencyFormatter.format(importe),
          Icons.euro,
          AppTheme.info,
        ),
      ],
    );
  }

  Widget _kpiWidget(String label, String value, IconData icon, Color color) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // En móviles pequeños, queremos 2 columnas (ancho ~ 150-180)
        // En pantallas más anchas podemos dejarlo fluir
        final width = (MediaQuery.of(context).size.width - 44) /
            2; // - padding(32) - spacing(12)

        return Container(
          width: width > 180 ? 180 : width,
          padding: EdgeInsets.all(
            Responsive.padding(context, small: 10, large: 14),
          ),
          decoration: BoxDecoration(
            color: AppTheme.raisedSurface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: color.withValues(alpha: 0.2)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, color: color, size: 18),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      label,
                      style: TextStyle(
                        fontSize: Responsive.fontSize(
                          context,
                          small: 9,
                          large: 11,
                        ),
                        color: AppTheme.textSecondary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  value,
                  style: TextStyle(
                    fontSize: Responsive.fontSize(
                      context,
                      small: 16,
                      large: 20,
                    ),
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildFinancialCard() {
    if (_monthlyFinance == null) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          borderRadius: BorderRadius.circular(14),
        ),
        child: const ListTile(
          leading: Icon(Icons.warning_amber_rounded, color: AppTheme.warning),
          title: Text('Datos financieros no disponibles'),
          subtitle: Text(
            'Las entregas se muestran con la información disponible.',
          ),
        ),
      );
    }
    final finance = _monthlyFinance!;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Resumen financiero mensual',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _miniStat(
                'Cobrado',
                CurrencyFormatter.format(finance.totalCobrado),
              ),
              _miniStat(
                'Liquidado',
                CurrencyFormatter.format(finance.totalLiquidado),
              ),
              _miniStat(
                'Pendiente',
                CurrencyFormatter.format(finance.saldoPendiente),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _miniStat(String label, String value) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              fontSize: Responsive.fontSize(context, small: 10, large: 13),
              fontWeight: FontWeight.bold,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              fontSize: Responsive.fontSize(context, small: 8, large: 10),
              color: AppTheme.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDailyChart() {
    if (_dailyData.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Center(
          child: Text(
            'Sin datos de entregas para este período',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ),
      );
    }

    final maxTotal = _dailyData.fold<double>(0, (double m, d) {
      final t = ((d['total'] ?? 0) as num).toDouble();
      return t > m ? t : m;
    });

    return Container(
      padding: EdgeInsets.all(
        Responsive.padding(context, small: 10, large: 16),
      ),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.bar_chart,
                color: AppTheme.info,
                size: Responsive.iconSize(context, phone: 18, desktop: 20),
              ),
              const SizedBox(width: 8),
              Text(
                'Entregas Diarias',
                style: TextStyle(
                  fontSize: Responsive.fontSize(context, small: 12, large: 15),
                  fontWeight: FontWeight.bold,
                  color: AppTheme.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: Responsive.clampHeight(context, 140),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: _dailyData.map((d) {
                final total = ((d['total'] ?? 0) as num).toDouble();
                final delivered = ((d['delivered'] ?? 0) as num).toDouble();
                final height = maxTotal > 0 ? (total / maxTotal * 100) : 0.0;
                final deliveredHeight =
                    maxTotal > 0 ? (delivered / maxTotal * 100) : 0.0;
                final day = d['day'] ?? 0;

                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 1),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        FittedBox(
                          child: Text(
                            '${total.toInt()}',
                            style: TextStyle(
                              fontSize: 8,
                              color: AppTheme.textSecondary,
                            ),
                          ),
                        ),
                        const SizedBox(height: 2),
                        Stack(
                          alignment: Alignment.bottomCenter,
                          children: [
                            Container(
                              height: height.clamp(2.0, 100.0),
                              decoration: BoxDecoration(
                                color: AppTheme.info.withValues(alpha: 0.18),
                                borderRadius: BorderRadius.circular(3),
                              ),
                            ),
                            Container(
                              height: deliveredHeight.clamp(0.0, 100.0),
                              decoration: BoxDecoration(
                                color: AppTheme.success.withValues(alpha: 0.78),
                                borderRadius: BorderRadius.circular(3),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        FittedBox(
                          child: Text(
                            '${day.toString().padLeft(2, '0')}/${_selectedMonth.toString().padLeft(2, '0')}',
                            style: TextStyle(
                              fontSize: 8,
                              color: AppTheme.textSecondary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: AppTheme.info.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 4),
              Text(
                'Total',
                style: TextStyle(fontSize: 10, color: AppTheme.textSecondary),
              ),
              const SizedBox(width: 16),
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: AppTheme.success.withValues(alpha: 0.78),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 4),
              Text(
                'Entregados',
                style: TextStyle(fontSize: 10, color: AppTheme.textSecondary),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDailyTable() {
    if (_dailyData.isEmpty) return const SizedBox.shrink();

    return Container(
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Row(
              children: [
                Icon(
                  Icons.table_chart,
                  color: AppTheme.accentIndigo,
                  size: Responsive.iconSize(context, phone: 18, desktop: 20),
                ),
                const SizedBox(width: 8),
                Text(
                  'Detalle diario',
                  style: TextStyle(
                    fontSize: Responsive.fontSize(
                      context,
                      small: 12,
                      large: 15,
                    ),
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
              ],
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SizedBox(
              width: 470,
              child: Column(
                children: [
                  // Table header
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(color: AppTheme.softPanel),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 50,
                          child: Text(
                            'Día',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.textSecondary,
                            ),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            'Total',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.textSecondary,
                            ),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            'Entreg.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.success,
                            ),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            'No Ent.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.error,
                            ),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            'Pend.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.warning,
                            ),
                          ),
                        ),
                        SizedBox(
                          width: 80,
                          child: Text(
                            'Importe',
                            textAlign: TextAlign.right,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.textSecondary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  ..._dailyData.map((d) {
                    final day = (d['day'] as int?) ?? 0;
                    final total = (d['total'] as int?) ?? 0;
                    final delivered = (d['delivered'] as int?) ?? 0;
                    final notDel = (d['notDelivered'] as int?) ?? 0;
                    final pending = (d['pending'] as int?) ?? 0;
                    final amount = ((d['amount'] ?? 0) as num).toDouble();

                    return Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        border: Border(
                          bottom: BorderSide(
                            color: AppTheme.borderColor.withValues(alpha: 0.4),
                          ),
                        ),
                      ),
                      child: Row(
                        children: [
                          SizedBox(
                            width: 50,
                            child: Text(
                              '${day.toString().padLeft(2, '0')}/${_selectedMonth.toString().padLeft(2, '0')}',
                              style: TextStyle(
                                fontSize: 12,
                                color: AppTheme.textPrimary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              '$total',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 12,
                                color: AppTheme.textPrimary,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              '$delivered',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppTheme.success,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              '$notDel',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 12,
                                color: notDel > 0
                                    ? AppTheme.error
                                    : AppTheme.textSecondary,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              '$pending',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 12,
                                color: pending > 0
                                    ? AppTheme.warning
                                    : AppTheme.textSecondary,
                              ),
                            ),
                          ),
                          SizedBox(
                            width: 80,
                            child: Text(
                              CurrencyFormatter.format(amount),
                              textAlign: TextAlign.right,
                              style: TextStyle(
                                fontSize: 12,
                                color: AppTheme.textPrimary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
