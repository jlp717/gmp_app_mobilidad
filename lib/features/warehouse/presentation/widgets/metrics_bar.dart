import 'package:flutter/material.dart';

import '../../../../core/theme/app_theme.dart';
import '../../domain/models/load_planner_models.dart';

/// Compact metrics bar showing volume, weight, status and box count.
/// Designed for the header area with animated progress bars.
class MetricsBar extends StatelessWidget {
  final PlannerMetrics? metrics;
  final SaveState saveState;

  const MetricsBar({
    super.key,
    required this.metrics,
    required this.saveState,
  });

  @override
  Widget build(BuildContext context) {
    if (metrics == null) return const SizedBox.shrink();
    final m = metrics!;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface.withOpacity(0.95),
        border: Border(
          bottom: BorderSide(
            color: AppTheme.neonBlue.withOpacity(0.2),
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          // Volume
          Expanded(
            child: _MetricGauge(
              label: 'Volumen',
              value: m.volumePct,
              current: '${(m.usedVolumeCm3 / 1e6).toStringAsFixed(1)} m\u00B3',
              max:
                  '${(m.containerVolumeCm3 / 1e6).toStringAsFixed(1)} m\u00B3',
              color: _statusColor(m.volumePct),
            ),
          ),
          const SizedBox(width: 16),

          // Weight
          Expanded(
            child: _MetricGauge(
              label: 'Peso',
              value: m.weightPct,
              current: '${m.totalWeightKg.toStringAsFixed(0)} kg',
              max: '${m.maxPayloadKg.toStringAsFixed(0)} kg',
              color: _statusColor(m.weightPct),
            ),
          ),
          const SizedBox(width: 16),

          // Status badge
          _StatusBadge(status: m.status),
          const SizedBox(width: 12),

          // Box count
          _BoxCount(placed: m.placedCount, overflow: m.overflowCount),
          const SizedBox(width: 12),

          // Save indicator
          _SaveIndicator(state: saveState),
        ],
      ),
    );
  }

  Color _statusColor(double pct) {
    if (pct > 95) return AppTheme.error;
    if (pct > 80) return AppTheme.warning;
    return AppTheme.success;
  }
}

class _MetricGauge extends StatelessWidget {
  final String label;
  final double value;
  final String current;
  final String max;
  final Color color;

  const _MetricGauge({
    required this.label,
    required this.value,
    required this.current,
    required this.max,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: const TextStyle(
                color: AppTheme.textTertiary,
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
            Text(
              '$current / $max',
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: value.clamp(0, 100) / 100),
            duration: AppTheme.animNormal,
            curve: Curves.easeOut,
            builder: (_, v, __) => LinearProgressIndicator(
              value: v,
              minHeight: 6,
              backgroundColor: AppTheme.darkCard,
              valueColor: AlwaysStoppedAnimation(color),
            ),
          ),
        ),
      ],
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final LoadStatus status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final (label, color, icon) = switch (status) {
      LoadStatus.seguro => ('SEGURO', AppTheme.success, Icons.check_circle),
      LoadStatus.optimo => ('OPTIMO', AppTheme.warning, Icons.trending_up),
      LoadStatus.exceso => ('EXCESO', AppTheme.error, Icons.warning_rounded),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.4), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _BoxCount extends StatelessWidget {
  final int placed;
  final int overflow;
  const _BoxCount({required this.placed, required this.overflow});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          '$placed',
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w700,
          ),
        ),
        Text(
          overflow > 0 ? '+$overflow fuera' : 'cajas',
          style: TextStyle(
            color: overflow > 0 ? AppTheme.error : AppTheme.textTertiary,
            fontSize: 10,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _SaveIndicator extends StatelessWidget {
  final SaveState state;
  const _SaveIndicator({required this.state});

  @override
  Widget build(BuildContext context) {
    final (icon, color, tip) = switch (state) {
      SaveState.saved => (Icons.cloud_done, AppTheme.success, 'Guardado'),
      SaveState.saving => (Icons.cloud_upload, AppTheme.neonBlue, 'Guardando...'),
      SaveState.unsaved => (Icons.cloud_off, AppTheme.warning, 'Sin guardar'),
      SaveState.error => (Icons.cloud_off, AppTheme.error, 'Error al guardar'),
    };

    return Tooltip(
      message: tip,
      child: Icon(icon, size: 18, color: color.withOpacity(0.7)),
    );
  }
}
