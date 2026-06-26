import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Pull-to-refresh indicator with the shared operational palette.
class PremiumRefreshIndicator extends StatelessWidget {
  const PremiumRefreshIndicator({
    required this.onRefresh,
    required this.child,
    this.color,
    super.key,
  });

  final Future<void> Function() onRefresh;
  final Widget child;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRefresh,
      displacement: 60,
      edgeOffset: 0,
      strokeWidth: 2.5,
      backgroundColor: AppTheme.raisedSurface,
      color: color ?? AppTheme.info,
      child: child,
    );
  }
}

/// Wraps a scroll view with consistent app scroll physics.
class SmoothScrollView extends StatelessWidget {
  const SmoothScrollView({
    required this.child,
    this.physics,
    super.key,
  });

  final Widget child;
  final ScrollPhysics? physics;

  @override
  Widget build(BuildContext context) {
    return ScrollConfiguration(
      behavior: _SmoothScrollBehavior(
        physics: physics ?? const BouncingScrollPhysics(),
      ),
      child: child,
    );
  }
}

class _SmoothScrollBehavior extends ScrollBehavior {
  final ScrollPhysics physics;

  const _SmoothScrollBehavior({required this.physics});

  @override
  ScrollPhysics getScrollPhysics(BuildContext context) {
    return physics;
  }
}
