import 'package:fl_chart/fl_chart.dart';

import 'package:flutter/material.dart';

import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';

import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';

/// KPI chips and mini bar chart for rich assistant answers.

class ChatDataCard extends StatelessWidget {
  const ChatDataCard({
    required this.kpis,
    this.chartData = const [],
    super.key,
  });

  final List<ChatKpiChip> kpis;

  final List<ChatChartPoint> chartData;

  @override
  Widget build(BuildContext context) {
    if (kpis.isEmpty && chartData.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (kpis.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: kpis
                .asMap()
                .entries
                .map((e) => _AnimatedKpiChip(kpi: e.value, index: e.key))
                .toList(),
          ),
        ],
        if (chartData.length >= 2) ...[
          const SizedBox(height: 12),
          _AnimatedMiniBarChart(points: chartData),
        ],
      ],
    );
  }
}

class _AnimatedKpiChip extends StatefulWidget {
  const _AnimatedKpiChip({required this.kpi, required this.index});

  final ChatKpiChip kpi;

  final int index;

  @override
  State<_AnimatedKpiChip> createState() => _AnimatedKpiChipState();
}

class _AnimatedKpiChipState extends State<_AnimatedKpiChip>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulse;

  late Animation<double> _glow;

  Color get _accent {
    switch (widget.kpi.trend) {
      case 'up':
        return AppColors.neonGreen;

      case 'down':
        return AppColors.quantumRed;

      default:
        return AppColors.neonBlue;
    }
  }

  @override
  void initState() {
    super.initState();

    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    )..repeat(reverse: true);

    _glow = Tween<double>(begin: 0.12, end: 0.28).animate(
      CurvedAnimation(parent: _pulse, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pulse.dispose();

    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 280 + widget.index * 60),
      curve: Curves.easeOutCubic,
      builder: (context, value, child) => Opacity(
        opacity: value,
        child: Transform.translate(
          offset: Offset(0, 8 * (1 - value)),
          child: child,
        ),
      ),
      child: AnimatedBuilder(
        animation: _glow,
        builder: (context, _) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                _accent.withValues(alpha: 0.15 + _glow.value),
                _accent.withValues(alpha: 0.05),
              ],
            ),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: _accent.withValues(alpha: 0.35)),
            boxShadow: widget.kpi.trend != 'neutral'
                ? [
                    BoxShadow(
                      color: _accent.withValues(alpha: _glow.value),
                      blurRadius: 12,
                      spreadRadius: 0,
                    ),
                  ]
                : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                widget.kpi.label.toUpperCase(),
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                  color: _accent.withValues(alpha: 0.85),
                  letterSpacing: 0.8,
                ),
              ),
              const SizedBox(height: 2),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    widget.kpi.value,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (widget.kpi.delta != null) ...[
                    const SizedBox(width: 6),
                    Icon(
                      widget.kpi.trend == 'up'
                          ? Icons.arrow_upward_rounded
                          : widget.kpi.trend == 'down'
                              ? Icons.arrow_downward_rounded
                              : Icons.remove_rounded,
                      size: 14,
                      color: _accent,
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AnimatedMiniBarChart extends StatefulWidget {
  const _AnimatedMiniBarChart({required this.points});

  final List<ChatChartPoint> points;

  @override
  State<_AnimatedMiniBarChart> createState() => _AnimatedMiniBarChartState();
}

class _AnimatedMiniBarChartState extends State<_AnimatedMiniBarChart>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  late Animation<double> _progress;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );

    _progress =
        CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic);

    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();

    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final maxVal =
        widget.points.map((p) => p.value).reduce((a, b) => a > b ? a : b);

    final safeMax = maxVal <= 0 ? 1.0 : maxVal;

    return AnimatedBuilder(
      animation: _progress,
      builder: (context, _) {
        return SizedBox(
          height: 72,
          child: BarChart(
            BarChartData(
              maxY: safeMax * 1.15,
              gridData: const FlGridData(show: false),
              borderData: FlBorderData(show: false),
              titlesData: FlTitlesData(
                topTitles: const AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
                rightTitles: const AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
                leftTitles: const AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    getTitlesWidget: (value, meta) {
                      final idx = value.toInt();

                      if (idx < 0 || idx >= widget.points.length) {
                        return const SizedBox.shrink();
                      }

                      return Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          widget.points[idx].label,
                          style: TextStyle(
                            color: Colors.grey.shade600,
                            fontSize: 9,
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
              barGroups: List.generate(widget.points.length, (i) {
                final color = i == widget.points.length - 1
                    ? AppColors.neonBlue
                    : AppColors.neonPurple.withValues(alpha: 0.7);

                return BarChartGroupData(
                  x: i,
                  barRods: [
                    BarChartRodData(
                      toY: widget.points[i].value * _progress.value,
                      width: 14,
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(4),
                      ),
                      gradient: LinearGradient(
                        begin: Alignment.bottomCenter,
                        end: Alignment.topCenter,
                        colors: [color.withValues(alpha: 0.5), color],
                      ),
                    ),
                  ],
                );
              }),
            ),
          ),
        );
      },
    );
  }
}
