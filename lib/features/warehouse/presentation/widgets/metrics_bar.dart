import 'dart:math' as math;
import 'package:flutter/material.dart';

import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/warehouse/domain/models/load_planner_models.dart';

/// Premium metrics bar with circular gauges, animated counters and glow accents.
class MetricsBar extends StatelessWidget {
  const MetricsBar({
    required this.metrics,
    required this.saveState,
    super.key,
  });
  final PlannerMetrics? metrics;
  final SaveState saveState;

  @override
  Widget build(BuildContext context) {
    if (metrics == null) return const SizedBox.shrink();
    final m = metrics!;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom: BorderSide(
            color: AppTheme.borderColor.withValues(alpha: 0.8),
          ),
        ),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        child: Row(
          children: [
            // Volume circular gauge
            _CircularGaugeCard(
              label: 'Volumen',
              value: m.volumePct,
              current: (m.usedVolumeCm3 / 1e6).toStringAsFixed(1),
              unit: 'm³',
              max: '${(m.containerVolumeCm3 / 1e6).toStringAsFixed(1)} m³',
              color: _statusColor(m.volumePct),
            ),
            const SizedBox(width: 10),

            // Weight circular gauge
            _CircularGaugeCard(
              label: 'Peso',
              value: m.weightPct,
              current: m.totalWeightKg.toStringAsFixed(0),
              unit: 'kg',
              max: '${m.maxPayloadKg.toStringAsFixed(0)} kg',
              color: _statusColor(m.weightPct),
            ),
            const SizedBox(width: 10),

            // Status badge (with pulse for EXCESO)
            _PremiumStatusBadge(status: m.status),
            const SizedBox(width: 10),

            // Box count card
            _BoxCountCard(placed: m.placedCount, overflow: m.overflowCount),

            const Spacer(),

            // Save indicator
            _PremiumSaveIndicator(state: saveState),
          ],
        ),
      ),
    );
  }

  Color _statusColor(double pct) {
    if (pct > 95) return AppTheme.error;
    if (pct > 80) return AppTheme.warning;
    return AppTheme.success;
  }
}

// =============================================================================
// CIRCULAR GAUGE CARD – arc progress + value inside
// =============================================================================

class _CircularGaugeCard extends StatelessWidget {
  const _CircularGaugeCard({
    required this.label,
    required this.value,
    required this.current,
    required this.unit,
    required this.max,
    required this.color,
  });
  final String label;
  final double value;
  final String current;
  final String unit;
  final String max;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.softPanel,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Circular arc gauge
          SizedBox(
            width: 36,
            height: 36,
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: value.clamp(0, 100) / 100),
              duration: const Duration(milliseconds: 800),
              curve: Curves.easeOutCubic,
              builder: (_, v, __) => CustomPaint(
                painter: _ArcPainter(
                  progress: v,
                  color: color,
                  bgColor: AppTheme.borderColor.withValues(alpha: 0.35),
                ),
                child: Center(
                  child: Text(
                    '${value.toInt()}%',
                    style: TextStyle(
                      color: color,
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),

          // Value + label
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  TweenAnimationBuilder<double>(
                    tween: Tween(
                      begin: 0,
                      end: double.tryParse(current) ?? 0,
                    ),
                    duration: const Duration(milliseconds: 800),
                    curve: Curves.easeOutCubic,
                    builder: (_, v, __) => Text(
                      current.contains('.')
                          ? v.toStringAsFixed(1)
                          : v.toInt().toString(),
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0,
                      ),
                    ),
                  ),
                  const SizedBox(width: 2),
                  Text(
                    unit,
                    style: const TextStyle(
                      color: AppTheme.textTertiary,
                      fontSize: 9,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
              Text(
                '$label · $max',
                style: AppTheme.captionText.copyWith(fontSize: 9),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// ARC PAINTER – draws circular progress arc
// =============================================================================

class _ArcPainter extends CustomPainter {
  _ArcPainter({
    required this.progress,
    required this.color,
    required this.bgColor,
  });
  final double progress;
  final Color color;
  final Color bgColor;

  @override
  void paint(Canvas canvas, Size size) {
    const strokeWidth = 3.5;
    final rect = Rect.fromLTWH(
      strokeWidth / 2,
      strokeWidth / 2,
      size.width - strokeWidth,
      size.height - strokeWidth,
    );

    // Background arc
    canvas.drawArc(
      rect,
      -math.pi * 0.75, // start at 7 o'clock
      math.pi * 1.5, // sweep 270 degrees
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.round
        ..color = bgColor,
    );

    // Progress arc
    if (progress > 0) {
      canvas.drawArc(
        rect,
        -math.pi * 0.75,
        math.pi * 1.5 * progress.clamp(0, 1),
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = strokeWidth
          ..strokeCap = StrokeCap.round
          ..color = color,
      );
    }
  }

  @override
  bool shouldRepaint(_ArcPainter oldDelegate) =>
      oldDelegate.progress != progress || oldDelegate.color != color;
}

// =============================================================================
// PREMIUM STATUS BADGE – with pulse animation for EXCESO
// =============================================================================

class _PremiumStatusBadge extends StatefulWidget {
  const _PremiumStatusBadge({required this.status});
  final LoadStatus status;

  @override
  State<_PremiumStatusBadge> createState() => _PremiumStatusBadgeState();
}

class _PremiumStatusBadgeState extends State<_PremiumStatusBadge>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseCtrl;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: AppTheme.animPulse,
    );
    if (widget.status == LoadStatus.exceso) {
      _pulseCtrl.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(_PremiumStatusBadge old) {
    super.didUpdateWidget(old);
    if (widget.status == LoadStatus.exceso && !_pulseCtrl.isAnimating) {
      _pulseCtrl.repeat(reverse: true);
    } else if (widget.status != LoadStatus.exceso && _pulseCtrl.isAnimating) {
      _pulseCtrl.stop();
      _pulseCtrl.value = 0;
    }
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final (label, color, icon) = switch (widget.status) {
      LoadStatus.seguro => (
          'SEGURO',
          AppTheme.success,
          Icons.check_circle_rounded
        ),
      LoadStatus.optimo => (
          'OPTIMO',
          AppTheme.warning,
          Icons.trending_up_rounded
        ),
      LoadStatus.exceso => ('EXCESO', AppTheme.error, Icons.warning_rounded),
    };

    return AnimatedBuilder(
      animation: _pulseCtrl,
      builder: (_, __) {
        final pulseOpacity = widget.status == LoadStatus.exceso
            ? 0.15 + (_pulseCtrl.value * 0.15)
            : 0.12;
        final glowBlur = widget.status == LoadStatus.exceso
            ? 8.0 + (_pulseCtrl.value * 8.0)
            : 4.0;

        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: color.withValues(alpha: pulseOpacity),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: color.withValues(alpha: 0.4),
            ),
            boxShadow: [
              BoxShadow(
                color: color.withValues(alpha: 0.15),
                blurRadius: glowBlur,
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 5),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// =============================================================================
// BOX COUNT CARD – placed + overflow with tiny gradient card
// =============================================================================

class _BoxCountCard extends StatelessWidget {
  const _BoxCountCard({required this.placed, required this.overflow});
  final int placed;
  final int overflow;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.softPanel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TweenAnimationBuilder<int>(
            tween: IntTween(begin: 0, end: placed),
            duration: const Duration(milliseconds: 600),
            curve: Curves.easeOutCubic,
            builder: (_, v, __) => Text(
              '$v',
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w800,
                letterSpacing: 0,
              ),
            ),
          ),
          Text(
            overflow > 0 ? '+$overflow fuera' : 'cajas',
            style: TextStyle(
              color: overflow > 0 ? AppTheme.error : AppTheme.textTertiary,
              fontSize: 9,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// PREMIUM SAVE INDICATOR – with subtle animations
// =============================================================================

class _PremiumSaveIndicator extends StatelessWidget {
  const _PremiumSaveIndicator({required this.state});
  final SaveState state;

  @override
  Widget build(BuildContext context) {
    final (icon, color, tip) = switch (state) {
      SaveState.saved => (
          Icons.cloud_done_rounded,
          AppTheme.success,
          'Guardado'
        ),
      SaveState.saving => (
          Icons.cloud_upload_rounded,
          AppTheme.info,
          'Guardando...'
        ),
      SaveState.unsaved => (
          Icons.cloud_off_rounded,
          AppTheme.warning,
          'Sin guardar'
        ),
      SaveState.error => (
          Icons.cloud_off_rounded,
          AppTheme.error,
          'Error al guardar'
        ),
    };

    return Tooltip(
      message: tip,
      child: AnimatedSwitcher(
        duration: AppTheme.animFast,
        child: Container(
          key: ValueKey(state),
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, size: 18, color: color.withValues(alpha: 0.8)),
        ),
      ),
    );
  }
}
