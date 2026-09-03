// ignore_for_file: public_member_api_docs

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/finance_error_message.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/providers/repartidor_finanzas_providers.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

/// Visual surface aligned with comercial `CommissionsPage` cards.
BoxDecoration _commissionSurfaceDecoration({
  Color? color,
  Color? borderColor,
  double borderAlpha = 1,
  double radius = AppTheme.radiusMd,
}) {
  final surfaceColor = color ?? AppTheme.raisedSurface;
  final outlineColor = borderColor ?? AppTheme.borderColor;
  final hasVisibleSurface = surfaceColor != AppColors.transparent;
  return BoxDecoration(
    color: surfaceColor,
    gradient: hasVisibleSurface
        ? LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              surfaceColor,
              AppTheme.softPanel.withValues(alpha: 0.88),
              outlineColor.withValues(alpha: 0.035),
            ],
          )
        : null,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: outlineColor.withValues(alpha: borderAlpha)),
    boxShadow: hasVisibleSurface
        ? [
            BoxShadow(
              color: AppColors.systemBlack.withValues(alpha: 0.12),
              blurRadius: 12,
              offset: const Offset(0, 5),
            ),
          ]
        : null,
  );
}

class RepartidorComisionesFinanzasPage extends ConsumerStatefulWidget {
  const RepartidorComisionesFinanzasPage({
    required this.repartidorId,
    super.key,
  });

  final String repartidorId;

  @override
  ConsumerState<RepartidorComisionesFinanzasPage> createState() =>
      _RepartidorComisionesFinanzasPageState();
}

String _spanishMonthName(int month) {
  const names = <String>[
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
    'Diciembre',
  ];
  if (month < 1 || month > 12) return '-';
  return names[month - 1];
}

class _MonthCommissionRow {
  const _MonthCommissionRow({
    required this.period,
    required this.summary,
    this.isFuture = false,
  });

  final DateTime period;
  final RepartidorCommissionSummary summary;
  final bool isFuture;
}

class _RepartidorComisionesFinanzasPageState
    extends ConsumerState<RepartidorComisionesFinanzasPage> {
  bool _isLoading = true;
  Object? _error;
  DateTime? _lastFetchTime;
  late DateTime _selectedPeriod;
  RepartidorCommissionSummary? _summary;
  List<_MonthCommissionRow> _monthRows = const [];
  List<RepartidorCommissionTier> _tiers = const [];
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _selectedPeriod = DateTime(now.year, now.month);
    _loadData();
  }

  @override
  void didUpdateWidget(covariant RepartidorComisionesFinanzasPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repartidorId != widget.repartidorId) {
      _loadData(forceRefresh: true);
    }
  }

  Future<void> _changePeriod(int monthDelta) async {
    final next = DateTime(
      _selectedPeriod.year,
      _selectedPeriod.month + monthDelta,
    );
    final now = DateTime.now();
    if (next.isAfter(DateTime(now.year, now.month))) return;
    setState(() => _selectedPeriod = next);
    await _loadData();
  }

  Future<void> _loadData({bool forceRefresh = false}) async {
    if (widget.repartidorId.isEmpty) {
      setState(() {
        _isLoading = false;
        _error = null;
      });
      return;
    }
    final generation = ++_loadGeneration;
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final service = ref.read(repartidorFinanzasServiceProvider);
      if (forceRefresh) {
        ref.invalidate(repartidorCommissionTiersProvider);
      }
      final now = DateTime.now();
      final year = _selectedPeriod.year;
      final currentMonthCursor = DateTime(now.year, now.month);
      final monthFutures = <Future<_MonthCommissionRow>>[];
      for (var month = 1; month <= 12; month++) {
        final from = DateTime(year, month);
        final to = DateTime(year, month + 1, 0);
        final isFuture = from.isAfter(currentMonthCursor);
        if (isFuture) {
          monthFutures.add(
            Future.value(
              _MonthCommissionRow(
                period: from,
                isFuture: true,
                summary: RepartidorCommissionSummary(
                  repartidorId: widget.repartidorId,
                  deliveredAmount: 0,
                  collectedAmount: 0,
                  collectedPct: 0,
                  commission: 0,
                ),
              ),
            ),
          );
          continue;
        }
        monthFutures.add(
          service
              .getCommissionSummary(
                repartidorId: widget.repartidorId,
                from: from,
                to: to,
                forceRefresh: forceRefresh,
              )
              .then(
                (summary) => _MonthCommissionRow(
                  period: from,
                  summary: summary,
                ),
              ),
        );
      }
      final results = await Future.wait<dynamic>([
        Future.wait(monthFutures),
        if (forceRefresh)
          service.getCommissionTiers(forceRefresh: true)
        else
          ref.read(repartidorCommissionTiersProvider.future),
      ]);
      if (!mounted || generation != _loadGeneration) return;
      final rows = List<_MonthCommissionRow>.from(results[0] as List);
      _MonthCommissionRow? selected;
      for (final row in rows) {
        if (row.period.year == _selectedPeriod.year &&
            row.period.month == _selectedPeriod.month) {
          selected = row;
          break;
        }
      }
      // Prefer current/past month for KPI cards when selected period is future.
      if (selected == null || selected.isFuture) {
        for (var i = rows.length - 1; i >= 0; i--) {
          if (!rows[i].isFuture) {
            selected = rows[i];
            break;
          }
        }
      }
      selected ??= rows.isEmpty ? null : rows.last;
      setState(() {
        _monthRows = rows;
        _summary = selected?.summary;
        _tiers = results[1] as List<RepartidorCommissionTier>;
        _isLoading = false;
        _lastFetchTime = DateTime.now();
      });
    } catch (error, stackTrace) {
      await Sentry.captureException(error, stackTrace: stackTrace);
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _error = error;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.repartidorId.isEmpty) {
      return Scaffold(
        backgroundColor: AppTheme.inkSurface,
        body: Center(
          child: Text(
            'Selecciona un repartidor para consultar comisiones',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ),
      );
    }
    final now = DateTime.now();
    final canMoveNext = _selectedPeriod.isBefore(DateTime(now.year, now.month));
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: Column(
        children: [
          SmartSyncHeader(
            title: 'Comisiones',
            subtitle: 'Seguimiento y objetivos',
            isLoading: _isLoading,
            lastSync: _lastFetchTime,
            onSync: () => _loadData(forceRefresh: true),
          ),
          _Header(
            period:
                '${_spanishMonthName(_selectedPeriod.month)} ${_selectedPeriod.year}',
          ),
          _PeriodSelector(
            onPrevious: () => _changePeriod(-1),
            onNext: canMoveNext ? () => _changePeriod(1) : null,
          ),
          if (_isLoading)
            const Expanded(child: Center(child: SkeletonList(itemCount: 6)))
          else if (_error != null)
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      financeErrorMessage(
                        _error!,
                        'No se pudo cargar el resumen',
                      ),
                      style: TextStyle(color: AppTheme.textSecondary),
                    ),
                    const SizedBox(height: 12),
                    ElevatedButton(
                      onPressed: () => _loadData(forceRefresh: true),
                      child: const Text('Reintentar'),
                    ),
                  ],
                ),
              ),
            )
          else if (_tiers.isEmpty)
            Expanded(
              child: Center(
                child: RepartidorExecutivePanel(
                  accentColor: AppTheme.warning,
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'No hay tramos de comisión configurados',
                        style: TextStyle(color: AppTheme.textSecondary),
                      ),
                      const SizedBox(height: 12),
                      ElevatedButton(
                        onPressed: () => _loadData(forceRefresh: true),
                        child: const Text('Reintentar'),
                      ),
                    ],
                  ),
                ),
              ),
            )
          else if (_summary == null || _monthRows.isEmpty)
            Expanded(
              child: Center(
                child: Text(
                  'No hay comisiones para el periodo seleccionado',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
              ),
            )
          else
            _Content(
              summary: _summary!,
              monthRows: _monthRows,
              tiers: _tiers,
              now: _selectedPeriod,
            ),
        ],
      ),
    );
  }
}

class _PeriodSelector extends StatelessWidget {
  const _PeriodSelector({required this.onPrevious, required this.onNext});

  final VoidCallback onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        IconButton(
          tooltip: 'Mes anterior',
          onPressed: onPrevious,
          icon: const Icon(Icons.chevron_left),
        ),
        Text(
          'Cambiar periodo',
          style: TextStyle(color: AppTheme.textSecondary),
        ),
        IconButton(
          tooltip: 'Mes siguiente',
          onPressed: onNext,
          icon: const Icon(Icons.chevron_right),
        ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.period});

  final String period;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      decoration: _commissionSurfaceDecoration(borderColor: AppTheme.success),
      child: Row(
        children: [
          const RepartidorExecutiveIcon(
            icon: Icons.euro,
            color: AppTheme.success,
            size: 24,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Comisiones $period',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                    color: AppTheme.textPrimary,
                  ),
                ),
                Text(
                  'Seguimiento de cobros y entregas',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({
    required this.summary,
    required this.monthRows,
    required this.tiers,
    required this.now,
  });

  final RepartidorCommissionSummary summary;
  final List<_MonthCommissionRow> monthRows;
  final List<RepartidorCommissionTier> tiers;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final totalTarget = summary.deliveredAmount;
    final totalActual = summary.collectedAmount;
    final overallCompliance =
        totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0.0;
    final isOnRhythm = overallCompliance >= 100;

    return Expanded(
      child: Column(
        children: [
          _SummaryCards(
            period: now,
            totalTarget: totalTarget,
            totalActual: totalActual,
            commission: summary.commission,
            overallCompliance: overallCompliance,
            isOnRhythm: isOnRhythm,
            collectedPct: summary.collectedPct,
          ),
          Expanded(
            child: _buildTable(context, tiers, monthRows),
          ),
        ],
      ),
    );
  }

  Widget _buildTable(
    BuildContext context,
    List<RepartidorCommissionTier> tiers,
    List<_MonthCommissionRow> monthRows,
  ) {
    final orderedTiers = [...tiers]..sort((a, b) {
        final byThreshold = a.thresholdPct.compareTo(b.thresholdPct);
        if (byThreshold != 0) return byThreshold;
        return a.sortOrder.compareTo(b.sortOrder);
      });

    DataRow buildRow(_MonthCommissionRow monthRow) {
      final summary = monthRow.summary;
      final isFuture = monthRow.isFuture;
      final appliedTier =
          summary.reached.isNotEmpty ? summary.reached.last : null;
      final firstTier = orderedTiers.isNotEmpty ? orderedTiers.first : null;
      final tierIndex = appliedTier == null
          ? 0
          : orderedTiers.indexWhere(
                (tier) =>
                    tier.thresholdPct == appliedTier.thresholdPct &&
                    tier.commissionPct == appliedTier.commissionPct,
              ) +
              1;
      final isPositive = !isFuture && appliedTier != null;
      final color = isFuture
          ? AppTheme.textTertiary
          : (isPositive ? AppTheme.success : AppTheme.error);
      final textOpacity = isFuture ? 0.45 : 1.0;
      final thresholdAmount = appliedTier?.thresholdAmount ??
          (firstTier == null
              ? 0.0
              : summary.deliveredAmount * (firstTier.thresholdPct / 100));
      final tierText = appliedTier == null
          ? '-'
          : 'F$tierIndex > '
              '${appliedTier.thresholdPct.toStringAsFixed(0)}%';
      final rateText = appliedTier == null
          ? '-'
          : '${appliedTier.commissionPct.toStringAsFixed(1)}%';
      final monthLabel = isFuture
          ? '${_spanishMonthName(monthRow.period.month)}  (Futuro)'
          : _spanishMonthName(monthRow.period.month);

      return DataRow(
        color: WidgetStateProperty.all(
          isFuture ? AppTheme.mutedPanel : AppTheme.raisedSurface,
        ),
        cells: [
          DataCell(
            Text(
              monthLabel,
              style: TextStyle(
                color: AppTheme.textPrimary.withValues(alpha: textOpacity),
                fontSize: 11,
              ),
            ),
          ),
          DataCell(
            Text(
              isFuture
                  ? '-'
                  : CurrencyFormatter.format(summary.deliveredAmount),
              style: TextStyle(
                color: AppTheme.textPrimary.withValues(alpha: textOpacity),
                fontSize: 10,
              ),
            ),
          ),
          DataCell(
            Text(
              isFuture
                  ? '-'
                  : CurrencyFormatter.format(summary.collectedAmount),
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.bold,
                fontSize: 10,
              ),
            ),
          ),
          DataCell(
            isFuture
                ? Text(
                    '-',
                    style: TextStyle(
                      color:
                          AppTheme.textTertiary.withValues(alpha: textOpacity),
                      fontSize: 10,
                    ),
                  )
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        isPositive ? Icons.check_circle : Icons.cancel,
                        color: color,
                        size: 12,
                      ),
                      if (isPositive) ...[
                        const SizedBox(width: 4),
                        Text(
                          tierText,
                          style: const TextStyle(
                            fontSize: 8,
                            color: AppTheme.info,
                          ),
                        ),
                      ],
                    ],
                  ),
          ),
          DataCell(
            Text(
              isFuture ? '-' : '${summary.collectedPct.toStringAsFixed(1)}%',
              style: TextStyle(color: color, fontSize: 9),
            ),
          ),
          DataCell(
            Text(
              isFuture ? '-' : CurrencyFormatter.format(summary.commission),
              style: TextStyle(
                color: isFuture ? AppTheme.textTertiary : AppTheme.success,
                fontWeight: FontWeight.bold,
                fontSize: 10,
              ),
            ),
          ),
          DataCell(
            Text(
              isFuture ? '-' : tierText,
              style: TextStyle(
                color: AppTheme.info.withValues(alpha: textOpacity),
                fontSize: 9,
              ),
            ),
          ),
          DataCell(
            Text(
              isFuture ? '-' : CurrencyFormatter.format(thresholdAmount),
              style: TextStyle(
                color: AppTheme.textSecondary.withValues(alpha: textOpacity),
                fontSize: 9,
              ),
            ),
          ),
          DataCell(
            Text(
              isFuture || appliedTier == null
                  ? '-'
                  : CurrencyFormatter.format(appliedTier.excess),
              style: TextStyle(
                color: isFuture
                    ? AppTheme.textTertiary
                    : (isPositive ? AppTheme.success : AppTheme.textSecondary),
                fontWeight: FontWeight.bold,
                fontSize: 9,
              ),
            ),
          ),
          DataCell(
            Text(
              isFuture ? '-' : rateText,
              style: TextStyle(
                color: AppTheme.textSecondary.withValues(alpha: textOpacity),
                fontSize: 9,
              ),
            ),
          ),
        ],
      );
    }

    return SingleChildScrollView(
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: RepartidorExecutivePanel(
          margin: const EdgeInsets.all(12),
          padding: EdgeInsets.zero,
          child: DataTable(
            columnSpacing: 10,
            dataRowMinHeight: 28,
            dataRowMaxHeight: 44,
            headingRowHeight: 36,
            headingRowColor: WidgetStateProperty.all(
              AppTheme.softPanel,
            ),
            columns: [
              DataColumn(
                label: Text(
                  'MES',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10,
                  ),
                ),
              ),
              DataColumn(
                label: Text(
                  'ENTREGADO',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10,
                  ),
                ),
              ),
              DataColumn(
                label: Text(
                  'COBRADO',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10,
                  ),
                ),
              ),
              DataColumn(
                label: Text(
                  'EST.',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10,
                  ),
                ),
              ),
              DataColumn(
                label: Text(
                  '%',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                    fontSize: 10,
                  ),
                ),
              ),
              DataColumn(
                label: Text(
                  'COMISIÓN',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.success,
                    fontSize: 10,
                  ),
                ),
              ),
              DataColumn(
                label: Text(
                  'TRAMO',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.info,
                    fontSize: 10,
                  ),
                ),
              ),
              DataColumn(
                label: Text(
                  'UMBRAL',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.info,
                    fontSize: 10,
                  ),
                ),
              ),
              DataColumn(
                label: Text(
                  'EXCESO',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.info,
                    fontSize: 10,
                  ),
                ),
              ),
              DataColumn(
                label: Text(
                  'TIPO',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.info,
                    fontSize: 10,
                  ),
                ),
              ),
            ],
            rows: monthRows.map(buildRow).toList(),
          ),
        ),
      ),
    );
  }
}

class _SummaryCards extends StatelessWidget {
  const _SummaryCards({
    required this.period,
    required this.totalTarget,
    required this.totalActual,
    required this.commission,
    required this.overallCompliance,
    required this.isOnRhythm,
    required this.collectedPct,
  });

  final DateTime period;
  final double totalTarget;
  final double totalActual;
  final double commission;
  final double overallCompliance;
  final bool isOnRhythm;
  final double collectedPct;

  @override
  Widget build(BuildContext context) {
    final rhythmStatus = overallCompliance >= 105
        ? 'Adelantado'
        : (overallCompliance >= 95 ? 'En ritmo' : 'Rezagado');
    final rhythmColor = isOnRhythm ? AppTheme.success : AppTheme.warning;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: _Card(
              accentColor: AppTheme.info,
              icon: Icons.calendar_today,
              iconColor: AppTheme.info,
              title: _spanishMonthName(period.month).toUpperCase(),
              value: CurrencyFormatter.format(totalActual),
              subtitle: 'de ${CurrencyFormatter.format(totalTarget)}',
              progressValue: totalTarget > 0
                  ? (totalActual / totalTarget).clamp(0.0, 1.0)
                  : 0.0,
              progressColor:
                  totalActual >= totalTarget ? AppTheme.success : AppTheme.info,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _Card(
              accentColor: AppTheme.success,
              icon: Icons.trending_up,
              iconColor: AppTheme.success,
              title: 'COMISIÓN',
              value: CurrencyFormatter.format(commission),
              subtitle: '${collectedPct.toStringAsFixed(1)}% cobro',
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration:
                  _commissionSurfaceDecoration(borderColor: rhythmColor),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        isOnRhythm ? Icons.trending_up : Icons.speed,
                        color: rhythmColor,
                        size: 14,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'RITMO',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: rhythmColor,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${overallCompliance.toStringAsFixed(1)}%',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: rhythmColor,
                    ),
                  ),
                  Text(
                    rhythmStatus,
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                      color: rhythmColor,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({
    required this.accentColor,
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.value,
    this.subtitle,
    this.progressValue,
    this.progressColor,
  });

  final Color accentColor;
  final IconData icon;
  final Color iconColor;
  final String title;
  final String value;
  final String? subtitle;
  final double? progressValue;
  final Color? progressColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: _commissionSurfaceDecoration(borderColor: accentColor),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: iconColor, size: 16),
              const SizedBox(width: 6),
              Text(
                title,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: iconColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: AppTheme.textPrimary,
            ),
          ),
          if (subtitle != null)
            Text(
              subtitle!,
              style: TextStyle(
                fontSize: 9,
                color: AppTheme.textSecondary,
              ),
            ),
          if (progressValue != null) ...[
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: progressValue,
                backgroundColor: AppTheme.mutedPanel,
                valueColor: AlwaysStoppedAnimation<Color>(
                  progressColor ?? AppTheme.success,
                ),
                minHeight: 6,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class ComisionesPage extends RepartidorComisionesFinanzasPage {
  const ComisionesPage({required super.repartidorId, super.key});
}
