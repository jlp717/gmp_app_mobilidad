import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Premium pull-to-refresh indicator with branded styling.
///
/// Features:
/// - Neon-colored progress indicator
/// - Smooth spring-like overscroll
/// - Consistent with V2.5 theme
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
      strokeWidth: 3,
      backgroundColor: AppTheme.darkCard,
      color: color ?? AppTheme.neonBlue,
      child: child,
    );
  }
}

/// Wraps a scroll view with smooth bouncing physics (iOS-like feel).
///
/// Use this to give any scrollable area a premium, smooth scrolling feel.
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
