import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_theme.dart';
import '../../domain/models/load_planner_models.dart';

/// Premium floating glassmorphism info card for the selected box.
/// Features: backdrop blur, dimension visualization, action buttons, smooth entry.
class BoxInfoOverlay extends StatefulWidget {
  final LoadBox box;
  final int index;
  final VoidCallback onClose;

  const BoxInfoOverlay({
    super.key,
    required this.box,
    required this.index,
    required this.onClose,
  });

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
          color: Colors.transparent,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
              child: Container(
                width: 240,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppTheme.darkCard.withOpacity(0.6),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: AppTheme.neonBlue.withOpacity(0.25),
                    width: 1,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.neonBlue.withOpacity(0.1),
                      blurRadius: 20,
                    ),
                    BoxShadow(
                      color: Colors.black.withOpacity(0.3),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ],
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
                            color: AppTheme.neonBlue.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(7),
                          ),
                          child: const Icon(
                            Icons.inventory_2_rounded,
                            size: 14,
                            color: AppTheme.neonBlue,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            widget.box.label,
                            style: const TextStyle(
                              color: AppTheme.textPrimary,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              letterSpacing: -0.2,
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
                              color: AppTheme.darkCard.withOpacity(0.5),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: const Icon(
                              Icons.close_rounded,
                              size: 14,
                              color: AppTheme.textTertiary,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),

                    // Subtle divider
                    Container(
                      height: 1,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            Colors.transparent,
                            AppTheme.neonBlue.withOpacity(0.2),
                            Colors.transparent,
                          ],
                        ),
                      ),
                    ),
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
                      valueColor: AppTheme.neonGreen,
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
                      valueColor: AppTheme.neonBlue,
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
// INFO ROW — icon + label + value with subtle styling
// =============================================================================

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color? valueColor;

  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Row(
        children: [
          Icon(icon, size: 12, color: AppTheme.textTertiary.withOpacity(0.6)),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: AppTheme.textTertiary.withOpacity(0.8),
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
              letterSpacing: -0.1,
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// DIMENSION BARS — compact W/D/H visualization
// =============================================================================

class _DimensionBars extends StatelessWidget {
  final double w;
  final double d;
  final double h;

  const _DimensionBars({
    required this.w,
    required this.d,
    required this.h,
  });

  @override
  Widget build(BuildContext context) {
    final maxDim = [w, d, h].reduce((a, b) => a > b ? a : b);
    if (maxDim <= 0) return const SizedBox.shrink();

    return Row(
      children: [
        _DimBar(label: 'L', value: w, maxDim: maxDim, color: AppTheme.neonBlue),
        const SizedBox(width: 6),
        _DimBar(label: 'A', value: d, maxDim: maxDim, color: AppTheme.neonGreen),
        const SizedBox(width: 6),
        _DimBar(label: 'H', value: h, maxDim: maxDim, color: AppTheme.neonPurple),
      ],
    );
  }
}

class _DimBar extends StatelessWidget {
  final String label;
  final double value;
  final double maxDim;
  final Color color;

  const _DimBar({
    required this.label,
    required this.value,
    required this.maxDim,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(
              color: color.withOpacity(0.6),
              fontSize: 8,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
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
                backgroundColor: AppTheme.darkCard.withOpacity(0.4),
                valueColor: AlwaysStoppedAnimation(color.withOpacity(0.6)),
              ),
            ),
          ),
          const SizedBox(height: 1),
          Text(
            '${value.toStringAsFixed(0)}',
            style: TextStyle(
              color: AppTheme.textTertiary.withOpacity(0.6),
              fontSize: 8,
            ),
          ),
        ],
      ),
    );
  }
}
