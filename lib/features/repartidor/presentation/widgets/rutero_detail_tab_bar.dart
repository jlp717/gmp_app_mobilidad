import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_delivery_validation.dart';

class RuteroDetailTabBar extends StatelessWidget {
  const RuteroDetailTabBar({
    required this.tabController,
    required this.isUrgent,
    super.key,
    this.productErrorCount = 0,
    this.paymentErrorCount = 0,
    this.finalizeErrorCount = 0,
  });

  final TabController tabController;
  final bool isUrgent;
  final int productErrorCount;
  final int paymentErrorCount;
  final int finalizeErrorCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom:
              BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.8)),
        ),
      ),
      child: TabBar(
        controller: tabController,
        dividerColor: Colors.transparent,
        indicatorSize: TabBarIndicatorSize.tab,
        indicator: BoxDecoration(
          color: AppTheme.info.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(color: AppTheme.info.withValues(alpha: 0.28)),
        ),
        labelColor: AppTheme.info,
        unselectedLabelColor: AppTheme.textSecondary,
        labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
        tabs: [
          Tab(
            icon: _TabIcon(
              icon: Icons.inventory_2_outlined,
              errorCount: productErrorCount,
            ),
            text: 'PRODUCTOS',
          ),
          Tab(
            icon: _TabIcon(
              icon: Icons.payment,
              errorCount: paymentErrorCount,
              color: isUrgent ? AppTheme.obligatorio : null,
            ),
            text: 'COBRO',
          ),
          Tab(
            icon: _TabIcon(
              icon: Icons.check_circle_outline,
              errorCount: finalizeErrorCount,
            ),
            text: 'FINALIZAR',
          ),
        ],
      ),
    );
  }
}

class _TabIcon extends StatelessWidget {
  const _TabIcon({
    required this.icon,
    required this.errorCount,
    this.color,
  });

  final IconData icon;
  final int errorCount;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Badge(
      isLabelVisible: errorCount > 0,
      backgroundColor: AppTheme.error,
      textColor: Colors.white,
      label: Text('$errorCount'),
      child: Icon(
        icon,
        size: 20,
        color: errorCount > 0 ? AppTheme.error : color,
      ),
    );
  }
}

class RuteroValidationBanner extends StatelessWidget {
  const RuteroValidationBanner({
    required this.issues,
    required this.onIssueTap,
    super.key,
  });

  final List<RuteroFieldIssue> issues;
  final void Function(RuteroFieldIssue issue) onIssueTap;

  String _tabLabel(RuteroDeliveryTab tab) {
    switch (tab) {
      case RuteroDeliveryTab.products:
        return 'Productos';
      case RuteroDeliveryTab.payment:
        return 'Cobro';
      case RuteroDeliveryTab.finalize:
        return 'Finalizar';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (issues.isEmpty) return const SizedBox.shrink();
    final visible = issues.take(3).toList();
    final extra = issues.length - visible.length;

    return Material(
      color: AppTheme.error.withValues(alpha: 0.16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: AppTheme.error.withValues(alpha: 0.7),
              width: 1.5,
            ),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              issues.length == 1
                  ? 'Revisa este dato para confirmar'
                  : 'Revisa ${issues.length} datos para confirmar',
              style: const TextStyle(
                color: AppTheme.error,
                fontWeight: FontWeight.w800,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 6),
            ...visible.map(
              (issue) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: InkWell(
                  onTap: () => onIssueTap(issue),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.error_outline,
                        color: AppTheme.error,
                        size: 16,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '${_tabLabel(issue.tab)} · ${issue.message}',
                          style: const TextStyle(
                            color: AppTheme.error,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            height: 1.25,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (extra > 0)
              Text(
                '+$extra más. Pulsa la pestaña marcada en rojo.',
                style: const TextStyle(
                  color: AppTheme.error,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

InputDecoration ruteroErrorInputDecoration({
  required String label,
  String? errorText,
  Widget? prefixIcon,
  String? hintText,
  String? suffixText,
  bool alignLabelWithHint = false,
}) {
  final hasError = errorText != null && errorText.isNotEmpty;
  final radius = BorderRadius.circular(AppTheme.radiusMd);
  final errorBorder = OutlineInputBorder(
    borderRadius: radius,
    borderSide: const BorderSide(color: AppTheme.error, width: 2.5),
  );
  return InputDecoration(
    labelText: label,
    hintText: hintText,
    suffixText: suffixText,
    prefixIcon: prefixIcon,
    alignLabelWithHint: alignLabelWithHint,
    filled: true,
    fillColor:
        hasError ? AppTheme.error.withValues(alpha: 0.22) : AppTheme.softPanel,
    errorText: errorText,
    errorMaxLines: 4,
    errorStyle: const TextStyle(
      color: AppTheme.error,
      fontSize: 15,
      fontWeight: FontWeight.w800,
      height: 1.3,
    ),
    border: OutlineInputBorder(borderRadius: radius),
    enabledBorder: hasError
        ? errorBorder
        : OutlineInputBorder(
            borderRadius: radius,
            borderSide: BorderSide(color: AppTheme.borderColor),
          ),
    focusedBorder: hasError
        ? errorBorder
        : OutlineInputBorder(
            borderRadius: radius,
            borderSide: const BorderSide(color: AppTheme.info, width: 1.5),
          ),
    errorBorder: errorBorder,
    focusedErrorBorder: errorBorder,
  );
}

class RuteroErrorSpotlight extends StatefulWidget {
  const RuteroErrorSpotlight({
    required this.active,
    required this.child,
    this.message,
    super.key,
  });

  final bool active;
  final String? message;
  final Widget child;

  @override
  State<RuteroErrorSpotlight> createState() => _RuteroErrorSpotlightState();
}

class _RuteroErrorSpotlightState extends State<RuteroErrorSpotlight>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
    );
    if (widget.active) {
      _pulse.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(RuteroErrorSpotlight oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !_pulse.isAnimating) {
      _pulse.repeat(reverse: true);
    } else if (!widget.active && _pulse.isAnimating) {
      _pulse
        ..stop()
        ..reset();
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return AnimatedBuilder(
      animation: _pulse,
      builder: (context, child) {
        final t = widget.active && !reduceMotion ? _pulse.value : 0.0;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: widget.active ? const EdgeInsets.all(10) : EdgeInsets.zero,
          decoration: BoxDecoration(
            color: widget.active
                ? AppTheme.error.withValues(alpha: 0.18 + (0.10 * t))
                : null,
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            border: widget.active
                ? Border.all(
                    color: AppTheme.error,
                    width: 2.5 + (1.5 * t),
                  )
                : Border.all(color: Colors.transparent, width: 0),
            boxShadow: widget.active
                ? [
                    BoxShadow(
                      color:
                          AppTheme.error.withValues(alpha: 0.38 + (0.28 * t)),
                      blurRadius: 16 + (10 * t),
                      spreadRadius: 1 + t,
                    ),
                  ]
                : null,
          ),
          child: child,
        );
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.message != null && widget.message!.isNotEmpty) ...[
            Text(
              widget.message!,
              style: const TextStyle(
                color: AppTheme.error,
                fontSize: 16,
                fontWeight: FontWeight.w800,
                height: 1.25,
              ),
            ),
            const SizedBox(height: 8),
          ],
          widget.child,
        ],
      ),
    );
  }
}
