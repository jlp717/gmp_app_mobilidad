// ignore_for_file: public_member_api_docs

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
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
  @override
  Widget build(BuildContext context) {
    if (widget.repartidorId.isEmpty || widget.repartidorId.contains(',')) {
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
      body: summaryAsync.when(
        data: (summary) => tiersAsync.when(
          data: (tiers) => _buildContent(summary, tiers),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, st) {
            Sentry.captureException(e, stackTrace: st);
            return _ErrorState(
              message: financeErrorMessage(e, 'No se pudieron cargar los tramos'),
              onRetry: () => ref.invalidate(repartidorCommissionTiersProvider),
            );
          },
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, st) {
          Sentry.captureException(e, stackTrace: st);
          return _ErrorState(
            message: financeErrorMessage(e, 'No se pudo cargar el resumen'),
            onRetry: () => ref.invalidate(
              repartidorCommissionSummaryProvider(summaryArgs),
            ),
          );
        },
      ),
    );
  }

  Widget _buildContent(
    RepartidorCommissionSummary summary,
    List<RepartidorCommissionTier> tiers,
  ) {
    final now = DateTime.now();

    return Column(
      children: [
        _Header(
          period: DateFormat('MM/yyyy').format(now),
          commission: summary.commission,
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              _SummaryGrid(summary: summary),
              const SizedBox(height: 12),
              _ReachedPanel(summary: summary),
              const SizedBox(height: 12),
              _TiersDisplay(tiers: tiers),
            ],
          ),
        ),
      ],
    );
  }
}

class ComisionesPage extends RepartidorComisionesFinanzasPage {
  const ComisionesPage({
    required super.repartidorId,
    super.key,
  });
}

class _Header extends StatelessWidget {
  const _Header({required this.period, required this.commission});

  final String period;
  final double commission;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(
        16,
        MediaQuery.of(context).padding.top + 14,
        16,
        14,
      ),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        border: Border(
          bottom: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Comisiones',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 14,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            _money(commission),
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontWeight: FontWeight.w800,
              fontSize: 28,
            ),
          ),
          Text(
            'Periodo: $period',
            style: const TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryGrid extends StatelessWidget {
  const _SummaryGrid({required this.summary});

  final RepartidorCommissionSummary summary;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 2.2,
        children: [
          _GridItem(
            label: 'Entregado',
            value: _money(summary.deliveredAmount),
            icon: Icons.local_shipping,
          ),
          _GridItem(
            label: 'Cobrado',
            value: _money(summary.collectedAmount),
            icon: Icons.trending_up,
          ),
          _GridItem(
            label: '% Cobro',
            value: _percent(summary.collectedPct),
            icon: Icons.percent,
          ),
          _GridItem(
            label: 'Comision',
            value: _money(summary.commission),
            icon: Icons.attach_money,
            highlight: true,
          ),
        ],
      ),
    );
  }
}

class _GridItem extends StatelessWidget {
  const _GridItem({
    required this.label,
    required this.value,
    required this.icon,
    this.highlight = false,
  });

  final String label;
  final String value;
  final IconData icon;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: highlight
            ? AppTheme.neonBlue.withValues(alpha: 0.1)
            : AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: highlight
              ? AppTheme.neonBlue.withValues(alpha: 0.3)
              : Colors.white.withValues(alpha: 0.05),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 4),
              Text(
                label,
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 11,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              color: highlight ? AppTheme.neonBlue : AppTheme.textPrimary,
              fontWeight: FontWeight.w700,
              fontSize: 15,
            ),
          ),
        ],
      ),
    );
  }
}

class _ReachedPanel extends StatelessWidget {
  const _ReachedPanel({required this.summary});

  final RepartidorCommissionSummary summary;

  @override
  Widget build(BuildContext context) {
    if (summary.reached.isEmpty) {
      return const SizedBox.shrink();
    }

    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Tramos alcanzados',
            style: TextStyle(
              color: AppTheme.textPrimary,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: summary.reached
                .map((t) => Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: AppTheme.neonGreen.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: AppTheme.neonGreen.withValues(alpha: 0.4),
                        ),
                      ),
                      child: Text(
                        '${_percent(t.thresholdPct)} → ${_percent(t.commissionPct)}',
                        style: const TextStyle(
                          color: AppTheme.neonGreen,
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                      ),
                    ))
                .toList(),
          ),
        ],
      ),
    );
  }
}

class _TiersDisplay extends StatelessWidget {
  const _TiersDisplay({required this.tiers});

  final List<RepartidorCommissionTier> tiers;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Tramos de comision',
            style: TextStyle(
              color: AppTheme.textPrimary,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          for (var i = 0; i < tiers.length; i++) ...[
            _TierDisplayRow(index: i, tier: tiers[i]),
            const SizedBox(height: 8),
          ],
        ],
      ),
    );
  }
}

class _TierDisplayRow extends StatelessWidget {
  const _TierDisplayRow({required this.index, required this.tier});

  final int index;
  final RepartidorCommissionTier tier;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: AppTheme.neonBlue.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(6),
          ),
          alignment: Alignment.center,
          child: Text(
            '${index + 1}',
            style: const TextStyle(
              color: AppTheme.neonBlue,
              fontWeight: FontWeight.w700,
              fontSize: 13,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            'Umbral: ${_percent(tier.thresholdPct)}',
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 14),
          ),
        ),
        Text(
          'Comision: ${_percent(tier.commissionPct)}',
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
        ),
      ],
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: child,
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, style: const TextStyle(color: AppTheme.textSecondary)),
          const SizedBox(height: 12),
          ElevatedButton(onPressed: onRetry, child: const Text('Reintentar')),
        ],
      ),
    );
  }
}

String _money(double value) {
  final fixed = value.toStringAsFixed(2).replaceAll('.', ',');
  return '$fixed EUR';
}

String _percent(double value) {
  final fixed = value.toStringAsFixed(1).replaceAll('.', ',');
  return '$fixed%';
}
