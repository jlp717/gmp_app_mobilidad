import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter/services.dart';

import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/warehouse/domain/models/load_planner_models.dart';

/// Premium floating glassmorphism info card for the selected box.
/// Features: backdrop blur, dimension visualization, action buttons, smooth entry.
class BoxInfoOverlay extends StatefulWidget {
  const BoxInfoOverlay({
    required this.box,
    required this.index,
    required this.onClose,
    super.key,
  });
  final LoadBox box;
  final int index;
  final VoidCallback onClose;

  @override
  State<BoxInfoOverlay> createState() => _BoxInfoOverlayState();
}

class _BoxInfoOverlayState extends State<BoxInfoOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _entryCtrl;
  late final Animation<double> _slideAnim;
  late final Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _entryCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _slideAnim = Tween<double>(begin: 20, end: 0).animate(
      CurvedAnimation(parent: _entryCtrl, curve: Curves.easeOutCubic),
    );
    _fadeAnim = CurvedAnimation(parent: _entryCtrl, curve: Curves.easeOut);
    _entryCtrl.forward();
  }

  @override
  void dispose() {
    _entryCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Positioned(
      right: 12,
      bottom: 12,
      child: AnimatedBuilder(
        animation: _entryCtrl,
        builder: (_, child) => Transform.translate(
          offset: Offset(0, _slideAnim.value),
          child: Opacity(opacity: _fadeAnim.value, child: child),
        ),
        child: Material(
          color: AppColors.transparent,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
              child: Container(
                width: 240,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppTheme.raisedSurface.withValues(alpha: 0.94),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppTheme.borderColor),
                  boxShadow: AppTheme.elevation2,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Header with close
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(5),
                          decoration: BoxDecoration(
                            color: AppTheme.info.withValues(alpha: 0.14),
                            borderRadius: BorderRadius.circular(7),
                          ),
                          child: const Icon(
                            Icons.inventory_2_rounded,
                            size: 14,
                            color: AppTheme.info,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            widget.box.label,
                            style: TextStyle(
                              color: AppTheme.textPrimary,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              letterSpacing: 0,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        GestureDetector(
                          onTap: () {
                            HapticFeedback.lightImpact();
                            widget.onClose();
                          },
                          child: Container(
                            padding: const EdgeInsets.all(4),
                            decoration: BoxDecoration(
                              color: AppTheme.softPanel,
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Icon(
                              Icons.close_rounded,
                              size: 14,
                              color: AppTheme.textTertiary,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),

                    Divider(height: 1, color: AppTheme.borderColor),
                    const SizedBox(height: 10),

                    // Details
                    _InfoRow(
                      icon: Icons.tag_rounded,
                      label: 'Artículo',
                      value: widget.box.articleCode,
                    ),
                    _InfoRow(
                      icon: Icons.person_rounded,
                      label: 'Cliente',
                      value: widget.box.clientCode,
                    ),
                    _InfoRow(
                      icon: Icons.receipt_long_rounded,
                      label: 'Orden',
                      value: '#${widget.box.orderNumber}',
                    ),
                    const SizedBox(height: 6),

                    // Weight with emphasis
                    _InfoRow(
                      icon: Icons.fitness_center_rounded,
                      label: 'Peso',
                      value: '${widget.box.weight.toStringAsFixed(1)} kg',
                      valueColor: AppTheme.success,
                    ),

                    // Dimensions with mini visualization
                    _InfoRow(
                      icon: Icons.straighten_rounded,
                      label: 'Dims',
                      value:
                          '${widget.box.w.toStringAsFixed(0)}×${widget.box.d.toStringAsFixed(0)}×${widget.box.h.toStringAsFixed(0)} cm',
                    ),

                    // Position
                    _InfoRow(
                      icon: Icons.place_rounded,
                      label: 'Posición',
                      value:
                          'X:${widget.box.x.toStringAsFixed(0)} Y:${widget.box.y.toStringAsFixed(0)} Z:${widget.box.z.toStringAsFixed(0)}',
                      valueColor: AppTheme.info,
                    ),

                    const SizedBox(height: 8),

                    // Compact dimension bar visualization
                    _DimensionBars(
                      w: widget.box.w,
                      d: widget.box.d,
                      h: widget.box.h,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// INFO ROW – icon + label + value with subtle styling
// =============================================================================

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor,
  });
  final IconData icon;
  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Row(
        children: [
          Icon(
            icon,
            size: 12,
            color: AppTheme.textTertiary.withValues(alpha: 0.6),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: AppTheme.textTertiary.withValues(alpha: 0.8),
              fontSize: 11,
            ),
          ),
          const Spacer(),
          Text(
            value,
            style: TextStyle(
              color: valueColor ?? AppTheme.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w500,
              letterSpacing: 0,
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// DIMENSION BARS – compact W/D/H visualization
// =============================================================================

class _DimensionBars extends StatelessWidget {
  const _DimensionBars({
    required this.w,
    required this.d,
    required this.h,
  });
  final double w;
  final double d;
  final double h;

  @override
  Widget build(BuildContext context) {
    final maxDim = [w, d, h].reduce((a, b) => a > b ? a : b);
    if (maxDim <= 0) return const SizedBox.shrink();

    return Row(
      children: [
        _DimBar(label: 'L', value: w, maxDim: maxDim, color: AppTheme.info),
        const SizedBox(width: 6),
        _DimBar(label: 'A', value: d, maxDim: maxDim, color: AppTheme.success),
        const SizedBox(width: 6),
        _DimBar(
          label: 'H',
          value: h,
          maxDim: maxDim,
          color: AppTheme.accentIndigo,
        ),
      ],
    );
  }
}

class _DimBar extends StatelessWidget {
  const _DimBar({
    required this.label,
    required this.value,
    required this.maxDim,
    required this.color,
  });
  final String label;
  final double value;
  final double maxDim;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(
              color: color.withValues(alpha: 0.6),
              fontSize: 8,
              fontWeight: FontWeight.w700,
              letterSpacing: 0,
            ),
          ),
          const SizedBox(height: 2),
          ClipRRect(
            borderRadius: BorderRadius.circular(2),
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: (value / maxDim).clamp(0, 1)),
              duration: const Duration(milliseconds: 500),
              curve: Curves.easeOutCubic,
              builder: (_, v, __) => LinearProgressIndicator(
                value: v,
                minHeight: 3,
                backgroundColor: AppTheme.borderColor.withValues(alpha: 0.35),
                valueColor:
                    AlwaysStoppedAnimation(color.withValues(alpha: 0.6)),
              ),
            ),
          ),
          const SizedBox(height: 1),
          Text(
            value.toStringAsFixed(0),
            style: TextStyle(
              color: AppTheme.textTertiary.withValues(alpha: 0.6),
              fontSize: 8,
            ),
          ),
        ],
      ),
    );
  }
}
