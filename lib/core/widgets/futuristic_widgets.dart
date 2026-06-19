import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Futuristic Holographic Card with dynamic glow effects and micro-interactions
class HolographicCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? margin;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final bool animateOnHover;
  final bool isInteractive;
  final List<Color>? gradientColors;
  final double? width;
  final double? height;
  final bool showHolographicEffect;

  const HolographicCard({
    super.key,
    required this.child,
    this.margin,
    this.padding,
    this.onTap,
    this.animateOnHover = true,
    this.isInteractive = true,
    this.gradientColors,
    this.width,
    this.height,
    this.showHolographicEffect = true,
  });

  @override
  Widget build(BuildContext context) {
    Widget card = Container(
      width: width,
      height: height,
      margin: margin,
      padding: padding ?? const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: gradientColors ??
              [
                AppTheme.darkSurface,
                AppTheme.darkCard,
              ],
        ),
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(
          color: AppTheme.neonBlue.withValues(alpha: 0.2),
          width: 0.5,
        ),
        boxShadow: [
          if (showHolographicEffect) ...[
            BoxShadow(
              color: AppTheme.neonBlue.withValues(alpha: 0.1),
              blurRadius: 20,
              offset: const Offset(0, 10),
            ),
            BoxShadow(
              color: AppTheme.neonPurple.withValues(alpha: 0.05),
              blurRadius: 30,
              offset: const Offset(0, 20),
            ),
          ]
        ],
      ),
      child: child,
    );

    if (isInteractive && onTap != null) {
      card = MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: onTap,
          child: animateOnHover
              ? card.animate().scale(
                    begin: const Offset(1.0, 1.0),
                    end: const Offset(1.02, 1.02),
                    duration: AppTheme.animNormal,
                  )
              : card,
        ),
      );
    }

    return card;
  }
}

/// Futuristic Neon Button with dynamic glow and pulse effects
class NeonButton extends StatefulWidget {
  final String text;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool isLoading;
  final bool isDisabled;
  final ButtonStyle? style;
  final Color? primaryColor;
  final Color? secondaryColor;

  const NeonButton({
    super.key,
    required this.text,
    this.onPressed,
    this.icon,
    this.isLoading = false,
    this.isDisabled = false,
    this.style,
    this.primaryColor,
    this.secondaryColor,
  });

  @override
  State<NeonButton> createState() => _NeonButtonState();
}

class _NeonButtonState extends State<NeonButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _glowController;
  late Animation<double> _glowAnimation;
  bool _isDisposed = false;

  @override
  void initState() {
    super.initState();
    _initAnimations();
  }

  void _initAnimations() {
    _glowController = AnimationController(
      duration: const Duration(milliseconds: 1500),
      vsync: this,
    );

    _glowAnimation = Tween<double>(begin: 0.5, end: 1.0).animate(
      CurvedAnimation(parent: _glowController, curve: Curves.easeInOut),
    );

    // Solo iniciar la repetición si el widget aún está montado
    if (mounted) {
      _glowController.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _isDisposed = true;
    try {
      _glowController.dispose();
    } catch (e) {
      // Silenciar cualquier error durante la eliminación si el ticker ya está cancelado
      debugPrint('Error disposing animation controller: $e');
    }
    super.dispose();
  }

  @override
  void didUpdateWidget(NeonButton oldWidget) {
    super.didUpdateWidget(oldWidget);

    // Reiniciar la animación si cambian ciertas propiedades
    if (oldWidget.isLoading != widget.isLoading ||
        oldWidget.isDisabled != widget.isDisabled ||
        oldWidget.onPressed != widget.onPressed) {
      if (widget.isLoading || widget.isDisabled || widget.onPressed == null) {
        // Detener la animación si el botón está deshabilitado
        _glowController.stop();
      } else {
        // Reiniciar la animación si el botón se habilita
        if (_glowController.status == AnimationStatus.dismissed ||
            _glowController.status == AnimationStatus.completed) {
          _glowController.repeat(reverse: true);
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isEnabled =
        !widget.isDisabled && !widget.isLoading && widget.onPressed != null;
    final primaryColor = widget.primaryColor ?? AppTheme.neonBlue;
    final secondaryColor = widget.secondaryColor ?? AppTheme.neonPurple;

    return AnimatedBuilder(
      animation: _glowAnimation,
      builder: (context, child) {
        if (_isDisposed) {
          // Retornar un widget simple si ya fue desechado
          return Opacity(
            opacity: 0.0,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppTheme.radiusFull),
              ),
              child: ElevatedButton(
                onPressed: null,
                style: (widget.style ??
                        ElevatedButton.styleFrom(
                          backgroundColor: Colors.grey,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(
                              horizontal: 24, vertical: 16),
                          shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(AppTheme.radiusFull),
                          ),
                        ))
                    .copyWith(
                  elevation: WidgetStateProperty.all(0),
                  shadowColor: WidgetStateProperty.all(Colors.transparent),
                ),
                child: Text(
                  widget.text,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey,
                  ),
                ),
              ),
            ),
          );
        }

        return Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [
                primaryColor,
                secondaryColor,
              ],
            ),
            borderRadius: BorderRadius.circular(AppTheme.radiusFull),
            boxShadow: [
              BoxShadow(
                color:
                    primaryColor.withValues(alpha: 0.4 * _glowAnimation.value),
                blurRadius: 20 * _glowAnimation.value,
                spreadRadius: 5 * _glowAnimation.value,
              ),
              BoxShadow(
                color: secondaryColor.withValues(
                    alpha: 0.3 * _glowAnimation.value),
                blurRadius: 30 * _glowAnimation.value,
                spreadRadius: 10 * _glowAnimation.value,
              ),
            ],
          ),
          child: ElevatedButton(
            onPressed: isEnabled ? widget.onPressed : null,
            style: (widget.style ??
                    ElevatedButton.styleFrom(
                      backgroundColor: Colors.transparent,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 24, vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(AppTheme.radiusFull),
                      ),
                    ))
                .copyWith(
              elevation: WidgetStateProperty.all(0),
              shadowColor: WidgetStateProperty.all(Colors.transparent),
            ),
            child: widget.isLoading
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  )
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (widget.icon != null) ...[
                        Icon(widget.icon, color: Colors.white, size: 18),
                        const SizedBox(width: 8),
                      ],
                      Text(
                        widget.text,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
          ),
        );
      },
    );
  }
}

/// Futuristic Data Visualization Card with animated metrics
class DataVizCard extends StatelessWidget {
  final String title;
  final String value;
  final String? subtitle;
  final IconData icon;
  final Color? iconColor;
  final Color? valueColor;
  final String? trend;
  final Color? trendColor;
  final IconData? trendIcon;

  const DataVizCard({
    super.key,
    required this.title,
    required this.value,
    this.subtitle,
    required this.icon,
    this.iconColor,
    this.valueColor,
    this.trend,
    this.trendColor,
    this.trendIcon,
  });

  @override
  Widget build(BuildContext context) {
    return HolographicCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color:
                      (iconColor ?? AppTheme.neonBlue).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                ),
                child: Icon(
                  icon,
                  color: iconColor ?? AppTheme.neonBlue,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            value,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: valueColor ?? AppTheme.textPrimary,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              subtitle!,
              style: TextStyle(
                fontSize: 12,
                color: AppTheme.textSecondary,
              ),
            ),
          ],
          if (trend != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(
                  trendIcon ??
                      (trend!.startsWith('+')
                          ? Icons.trending_up
                          : Icons.trending_down),
                  size: 14,
                  color: trendColor ??
                      (trend!.startsWith('+')
                          ? AppTheme.success
                          : AppTheme.error),
                ),
                const SizedBox(width: 4),
                Text(
                  trend!,
                  style: TextStyle(
                    fontSize: 12,
                    color: trendColor ??
                        (trend!.startsWith('+')
                            ? AppTheme.success
                            : AppTheme.error),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Futuristic Progress Indicator with holographic effects
class HolographicProgressIndicator extends StatelessWidget {
  final double value;
  final Color? color;
  final String? label;
  final String? percentage;

  const HolographicProgressIndicator({
    super.key,
    required this.value,
    this.color,
    this.label,
    this.percentage,
  });

  @override
  Widget build(BuildContext context) {
    final progressColor = color ?? AppTheme.neonBlue;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null || percentage != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                if (label != null)
                  Text(
                    label!,
                    style: TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                if (percentage != null)
                  Text(
                    percentage!,
                    style: TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
              ],
            ),
          ),
        Container(
          height: 8,
          decoration: BoxDecoration(
            color: AppTheme.darkSurface,
            borderRadius: BorderRadius.circular(AppTheme.radiusFull),
            border: Border.all(
              color: AppTheme.borderColor,
              width: 0.5,
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppTheme.radiusFull),
            child: LinearProgressIndicator(
              value: value,
              backgroundColor: Colors.transparent,
              valueColor: AlwaysStoppedAnimation<Color>(progressColor),
            ),
          ),
        ),
        if (value > 0)
          Container(
            height: 2,
            width: MediaQuery.of(context).size.width * value,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
                colors: [
                  progressColor.withValues(alpha: 0.3),
                  progressColor.withValues(alpha: 0.1),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// Futuristic Tab Bar with animated indicators
class FuturisticTabBar extends StatelessWidget {
  final List<String> tabs;
  final int selectedIndex;
  final ValueChanged<int>? onTap;
  final Color? activeColor;
  final Color? inactiveColor;

  const FuturisticTabBar({
    super.key,
    required this.tabs,
    required this.selectedIndex,
    this.onTap,
    this.activeColor,
    this.inactiveColor,
  });

  @override
  Widget build(BuildContext context) {
    final activeColor = this.activeColor ?? AppTheme.neonBlue;
    final inactiveColor = this.inactiveColor ?? AppTheme.textSecondary;

    return Container(
      height: 50,
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(
          color: AppTheme.borderColor,
          width: 0.5,
        ),
      ),
      child: Row(
        children: List.generate(tabs.length, (index) {
          final isActive = index == selectedIndex;
          return Expanded(
            child: GestureDetector(
              onTap: () => onTap?.call(index),
              child: AnimatedContainer(
                duration: AppTheme.animFast,
                decoration: BoxDecoration(
                  color: isActive ? AppTheme.darkCard : Colors.transparent,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  border: Border.all(
                    color: isActive ? activeColor : Colors.transparent,
                    width: 1,
                  ),
                ),
                child: Center(
                  child: Text(
                    tabs[index],
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight:
                          isActive ? FontWeight.w600 : FontWeight.normal,
                      color: isActive ? activeColor : inactiveColor,
                    ),
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
