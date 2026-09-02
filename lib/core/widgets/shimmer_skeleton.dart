import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

/// Shimmer effect widget for loading states.
class ShimmerLoading extends StatefulWidget {
  const ShimmerLoading({
    required this.child,
    super.key,
    this.isLoading = true,
  });

  final Widget child;
  final bool isLoading;

  @override
  State<ShimmerLoading> createState() => _ShimmerLoadingState();
}

class _ShimmerLoadingState extends State<ShimmerLoading>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    );
    if (widget.isLoading) _controller.repeat();
    _animation = Tween<double>(begin: -1.2, end: 1.2).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOutSine),
    );
  }

  @override
  void didUpdateWidget(covariant ShimmerLoading oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isLoading && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!widget.isLoading && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isLoading) return widget.child;

    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return ShaderMask(
          shaderCallback: (bounds) {
            return LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [
                AppTheme.raisedSurface,
                AppTheme.mutedPanel,
                AppTheme.raisedSurface,
              ],
              stops: [
                (_animation.value - 0.45).clamp(0.0, 1.0),
                _animation.value.clamp(0.0, 1.0),
                (_animation.value + 0.45).clamp(0.0, 1.0),
              ],
            ).createShader(bounds);
          },
          blendMode: BlendMode.srcATop,
          child: widget.child,
        );
      },
      child: widget.child,
    );
  }
}

/// Skeleton placeholder for list items.
class SkeletonCard extends StatelessWidget {
  const SkeletonCard({
    super.key,
    this.height = 120,
    this.width,
    this.margin = const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
  });

  final double height;
  final double? width;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      width: width,
      margin: EdgeInsets.symmetric(
        horizontal: Responsive.padding(context, small: 12, large: 20),
        vertical: 8,
      ),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: AppTheme.borderColor.withValues(alpha: 0.72)),
      ),
      child: Padding(
        padding: EdgeInsets.all(
          Responsive.padding(context, small: 12, large: 16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _skeletonBox(width: 44, height: 44, radius: AppTheme.radiusMd),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _skeletonBox(height: 14),
                      const SizedBox(height: 8),
                      _skeletonBox(width: 120, height: 10),
                    ],
                  ),
                ),
                _skeletonBox(width: 70, height: 18),
              ],
            ),
            const Spacer(),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                _skeletonBox(width: 80, height: 32),
                const SizedBox(width: 10),
                _skeletonBox(width: 90, height: 32),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Skeleton list - shows multiple skeleton cards.
class SkeletonList extends StatelessWidget {
  const SkeletonList({
    super.key,
    this.itemCount = 5,
    this.itemHeight = 120,
  });

  final int itemCount;
  final double itemHeight;

  @override
  Widget build(BuildContext context) {
    return ShimmerLoading(
      child: ListView.builder(
        physics: const NeverScrollableScrollPhysics(),
        shrinkWrap: true,
        itemCount: itemCount,
        itemBuilder: (context, index) => SkeletonCard(height: itemHeight),
      ),
    );
  }
}

/// Skeleton for summary cards.
class SkeletonSummary extends StatelessWidget {
  const SkeletonSummary({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerLoading(
      child: Container(
        margin: EdgeInsets.all(
          Responsive.padding(context, small: 12, large: 20),
        ),
        padding: EdgeInsets.all(
          Responsive.padding(context, small: 16, large: 24),
        ),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(
            color: AppTheme.borderColor.withValues(alpha: 0.72),
          ),
        ),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _SummarySkeletonItem(),
            _SummarySkeletonItem(),
            _SummarySkeletonItem(),
          ],
        ),
      ),
    );
  }
}

class _SummarySkeletonItem extends StatelessWidget {
  const _SummarySkeletonItem();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _skeletonBox(height: 28, width: 70),
        const SizedBox(height: 8),
        _skeletonBox(height: 12, width: 50),
      ],
    );
  }
}

Widget _skeletonBox({
  required double height,
  double? width,
  double radius = 6,
}) {
  return Container(
    width: width ?? double.infinity,
    height: height,
    decoration: BoxDecoration(
      color: AppTheme.mutedPanel,
      borderRadius: BorderRadius.circular(radius),
    ),
  );
}
