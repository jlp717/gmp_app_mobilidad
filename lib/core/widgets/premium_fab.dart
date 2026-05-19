import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Premium animated FloatingActionButton with gradient, glow, and pulse.
///
/// Features:
/// - Gradient background (blue → cyan)
/// - Glow shadow that responds to press
/// - Subtle idle pulse animation
/// - Smooth scale transition on press
class PremiumFloatingActionButton extends StatefulWidget {
  const PremiumFloatingActionButton({
    required this.onPressed,
    this.icon,
    this.label,
    this.accentColor,
    this.size = 56,
    super.key,
  });

  final VoidCallback onPressed;
  final IconData? icon;
  final String? label;
  final Color? accentColor;
  final double size;

  @override
  State<PremiumFloatingActionButton> createState() => _PremiumFloatingActionButtonState();
}

class _PremiumFloatingActionButtonState extends State<PremiumFloatingActionButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      duration: const Duration(milliseconds: 2000),
      vsync: this,
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.accentColor ?? AppTheme.neonBlue;
    final isExtended = widget.label != null;

    return AnimatedBuilder(
      animation: _pulseController,
      builder: (context, child) {
        final pulseValue = 0.92 + (0.08 * _pulseController.value);
        final glowOpacity = 0.15 + (0.15 * _pulseController.value);

        return Transform.scale(
          scale: pulseValue,
          child: Container(
            width: isExtended ? null : widget.size,
            height: widget.size,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [color, AppTheme.neonCyan],
              ),
              shape: isExtended ? BoxShape.rectangle : BoxShape.circle,
              borderRadius: isExtended
                  ? BorderRadius.circular(AppTheme.radiusFull)
                  : null,
              boxShadow: [
                BoxShadow(
                  color: color.withValues(alpha: glowOpacity),
                  blurRadius: 20,
                  spreadRadius: 2,
                ),
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.3),
                  blurRadius: 12,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: widget.onPressed,
                borderRadius: isExtended
                    ? BorderRadius.circular(AppTheme.radiusFull)
                    : BorderRadius.circular(widget.size / 2),
                splashColor: Colors.white.withValues(alpha: 0.2),
                highlightColor: Colors.transparent,
                child: isExtended
                    ? Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (widget.icon != null) ...[
                              Icon(widget.icon, size: 20, color: AppTheme.darkBase),
                              const SizedBox(width: 8),
                            ],
                            Text(
                              widget.label!,
                              style: const TextStyle(
                                color: AppTheme.darkBase,
                                fontWeight: FontWeight.w700,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      )
                    : Center(
                        child: Icon(
                          widget.icon ?? Icons.add,
                          size: 24,
                          color: AppTheme.darkBase,
                        ),
                      ),
              ),
            ),
          ),
        );
      },
    );
  }
}
