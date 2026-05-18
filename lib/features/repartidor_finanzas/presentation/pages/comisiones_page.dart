// ignore_for_file: public_member_api_docs

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/finance_error_message.dart';
import 'package:intl/intl.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

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

class _RepartidorComisionesFinanzasPageState
    extends ConsumerState<RepartidorComisionesFinanzasPage> {
  bool _isLoading = true;
  String? _error;
  DateTime? _lastFetchTime;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant RepartidorComisionesFinanzasPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repartidorId != widget.repartidorId) {
      _loadData(forceRefresh: true);
    }
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
      final now = DateTime.now();
      final from = DateTime(now.year, now.month);
      final to = DateTime(now.year, now.month + 1, 0);
      final summaryArgs = (
        repartidorId: widget.repartidorId,
        from: from,
        to: to,
        forceRefresh: forceRefresh,
      );
      await ref.read(repartidorCommissionSummaryProvider(summaryArgs).future);
      await ref.read(repartidorCommissionTiersProvider.future);
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
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

  @override
  Widget build(BuildContext context) {
    if (widget.repartidorId.isEmpty) {
      return const Scaffold(
        backgroundColor: AppTheme.darkBase,
        body: Center(
          child: Text(
            'Selecciona un repartidor para consultar comisiones',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ),
      );
    }

    final now = DateTime.now();
    final from = DateTime(now.year, now.month);
    final to = DateTime(now.year, now.month + 1, 0);
    final summaryArgs = (
      repartidorId: widget.repartidorId,
      from: from,
      to: to,
      forceRefresh: false,
    );
    final summaryAsync =
        ref.watch(repartidorCommissionSummaryProvider(summaryArgs));
    final tiersAsync = ref.watch(repartidorCommissionTiersProvider);

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          SmartSyncHeader(
            title: 'Comisiones',
            subtitle: 'Seguimiento y Objetivos',
            isLoading: _isLoading,
            lastSync: _lastFetchTime,
            onSync: () => _loadData(forceRefresh: true),
          ),
          _Header(period: DateFormat('MM/yyyy').format(now)),
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
                      style: const TextStyle(color: AppTheme.textSecondary),
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
          else
            summaryAsync.when(
              data: (summary) => tiersAsync.when(
                data: (tiers) =>
                    _Content(summary: summary, tiers: tiers, now: now),
                loading: () => const Expanded(
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (e, st) {
                  Sentry.captureException(e, stackTrace: st);
                  return Expanded(
                    child: Center(
                      child: Text(
                        financeErrorMessage(
                          e,
                          'No se pudieron cargar los tramos',
                        ),
                        style: const TextStyle(color: AppTheme.textSecondary),
                      ),
                    ),
                  );
                },
              ),
              loading: () => const Expanded(
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (e, st) {
                Sentry.captureException(e, stackTrace: st);
                return Expanded(
                  child: Center(
                    child: Text(
                      financeErrorMessage(e, 'No se pudo cargar el resumen'),
                      style: const TextStyle(color: AppTheme.textSecondary),
                    ),
                  ),
                );
              },
            ),
        ],
      ),
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
      color: AppTheme.surfaceColor,
      child: Row(
        children: [
          const Icon(Icons.euro, color: AppTheme.neonGreen, size: 24),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Comisiones $period',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                    color: Colors.white,
                  ),
                ),
                const Text(
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
    required this.tiers,
    required this.now,
  });

  final RepartidorCommissionSummary summary;
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
          if (!_isLoadingPlaceholder) ...[
            _SummaryCards(
              totalTarget: totalTarget,
              totalActual: totalActual,
              commission: summary.commission,
              overallCompliance: overallCompliance,
              isOnRhythm: isOnRhythm,
              collectedPct: summary.collectedPct,
            ),
          ],
          Expanded(
            child: _buildTable(context, tiers, summary),
          ),
        ],
      ),
    );
  }

  static const _isLoadingPlaceholder = false;

  Widget _buildTable(
    BuildContext context,
    List<RepartidorCommissionTier> tiers,
    RepartidorCommissionSummary summary,
  ) {
    final rows = <DataRow>[];
    final orderedTiers = [...tiers]..sort((a, b) {
        final byThreshold = a.thresholdPct.compareTo(b.thresholdPct);
        if (byThreshold != 0) return byThreshold;
        return a.sortOrder.compareTo(b.sortOrder);
      });
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
    final isPositive = appliedTier != null;
    final color = isPositive ? AppTheme.success : AppTheme.error;
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

    rows.add(
      DataRow(
        color: WidgetStateProperty.all(Colors.transparent),
        cells: [
          DataCell(
            Text(
              DateFormat('MMMM').format(now),
              style: const TextStyle(color: Colors.white, fontSize: 11),
            ),
          ),
          DataCell(
            Text(
              CurrencyFormatter.format(summary.deliveredAmount),
              style: const TextStyle(color: Colors.white, fontSize: 10),
            ),
          ),
          DataCell(
            Text(
              CurrencyFormatter.format(summary.collectedAmount),
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.bold,
                fontSize: 10,
              ),
            ),
          ),
          DataCell(
            Row(
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
                      color: AppTheme.neonBlue,
                    ),
                  ),
                ],
              ],
            ),
          ),
          DataCell(
            Text(
              '${summary.collectedPct.toStringAsFixed(1)}%',
              style: TextStyle(color: color, fontSize: 9),
            ),
          ),
          DataCell(
            Text(
              CurrencyFormatter.format(summary.commission),
              style: const TextStyle(
                color: AppTheme.neonGreen,
                fontWeight: FontWeight.bold,
                fontSize: 10,
              ),
            ),
          ),
          DataCell(
            Text(
              tierText,
              style: const TextStyle(
                color: AppTheme.neonBlue,
                fontSize: 9,
              ),
            ),
          ),
          DataCell(
            Text(
              CurrencyFormatter.format(thresholdAmount),
              style: const TextStyle(color: Colors.white70, fontSize: 9),
            ),
          ),
          DataCell(
            Text(
              appliedTier == null
                  ? '-'
                  : CurrencyFormatter.format(appliedTier.excess),
              style: TextStyle(
                color: isPositive ? AppTheme.success : AppTheme.textSecondary,
                fontWeight: FontWeight.bold,
                fontSize: 9,
              ),
            ),
          ),
          DataCell(
            Text(
              rateText,
              style:
                  const TextStyle(color: AppTheme.textSecondary, fontSize: 9),
            ),
          ),
        ],
      ),
    );

    return SingleChildScrollView(
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columnSpacing: 10,
          dataRowMinHeight: 28,
          dataRowMaxHeight: 44,
          headingRowHeight: 36,
          headingRowColor: WidgetStateProperty.all(
            AppTheme.darkBase,
          ),
          columns: const [
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
                'OBJETIVO',
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
                  color: AppTheme.neonGreen,
                  fontSize: 10,
                ),
              ),
            ),
            DataColumn(
              label: Text(
                'TRAMO',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: AppTheme.neonBlue,
                  fontSize: 10,
                ),
              ),
            ),
            DataColumn(
              label: Text(
                'UMBRAL',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: AppTheme.neonBlue,
                  fontSize: 10,
                ),
              ),
            ),
            DataColumn(
              label: Text(
                'EXCESO',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: AppTheme.neonBlue,
                  fontSize: 10,
                ),
              ),
            ),
            DataColumn(
              label: Text(
                'TIPO',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: AppTheme.neonBlue,
                  fontSize: 10,
                ),
              ),
            ),
          ],
          rows: rows,
        ),
      ),
    );
  }
}

class _SummaryCards extends StatelessWidget {
  const _SummaryCards({
    required this.totalTarget,
    required this.totalActual,
    required this.commission,
    required this.overallCompliance,
    required this.isOnRhythm,
    required this.collectedPct,
  });

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

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: _Card(
              gradient: [
                AppTheme.neonBlue.withValues(alpha: 0.2),
                AppTheme.neonPurple.withValues(alpha: 0.1),
              ],
              borderColor: AppTheme.neonBlue.withValues(alpha: 0.3),
              icon: Icons.calendar_today,
              iconColor: AppTheme.neonBlue,
              title: DateFormat('MMMM').format(DateTime.now()).toUpperCase(),
              value: CurrencyFormatter.format(totalActual),
              subtitle: 'de ${CurrencyFormatter.format(totalTarget)}',
              progressValue: totalTarget > 0
                  ? (totalActual / totalTarget).clamp(0.01, double.infinity)
                  : 0.01,
              progressColor: totalActual >= totalTarget
                  ? AppTheme.success
                  : AppTheme.neonBlue,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _Card(
              gradient: [
                AppTheme.neonGreen.withValues(alpha: 0.2),
                AppTheme.success.withValues(alpha: 0.1),
              ],
              borderColor: AppTheme.neonGreen.withValues(alpha: 0.3),
              icon: Icons.trending_up,
              iconColor: AppTheme.neonGreen,
              title: 'COMISIÓN',
              value: CurrencyFormatter.format(commission),
              subtitle: '${collectedPct.toStringAsFixed(1)}% cobro',
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: isOnRhythm
                    ? AppTheme.success.withValues(alpha: 0.15)
                    : Colors.orange.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isOnRhythm
                      ? AppTheme.success.withValues(alpha: 0.3)
                      : Colors.orange.withValues(alpha: 0.3),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        isOnRhythm ? Icons.trending_up : Icons.speed,
                        color: isOnRhythm ? AppTheme.success : Colors.orange,
                        size: 14,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'RITMO',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: isOnRhythm ? AppTheme.success : Colors.orange,
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
                      color: isOnRhythm ? AppTheme.success : Colors.orange,
                    ),
                  ),
                  Text(
                    rhythmStatus,
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                      color: isOnRhythm ? AppTheme.success : Colors.orange,
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
    required this.gradient,
    required this.borderColor,
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.value,
    this.subtitle,
    this.progressValue,
    this.progressColor,
  });

  final List<Color> gradient;
  final Color borderColor;
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
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: gradient),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor),
      ),
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
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          if (subtitle != null)
            Text(
              subtitle!,
              style: TextStyle(
                fontSize: 9,
                color: Colors.white.withValues(alpha: 0.6),
              ),
            ),
          if (progressValue != null) ...[
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: progressValue,
                backgroundColor: Colors.white.withValues(alpha: 0.1),
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
