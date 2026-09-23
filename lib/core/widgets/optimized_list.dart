/// Optimized ListView Widgets
/// ==========================
/// High-performance list widgets with:
/// - Tunable cache extent (default 1 screen — enough for smooth scroll)
/// - Optional itemExtent / prototypeItem for O(1) scroll extent
/// - RepaintBoundary isolation when callers opt in
/// - Const optimizations
library;

import 'package:flutter/material.dart';

/// Optimized ListView.builder with performance settings
class OptimizedListView extends StatelessWidget {
  const OptimizedListView({
    required this.itemCount,
    required this.itemBuilder,
    super.key,
    this.controller,
    this.padding,
    this.physics,
    this.shrinkWrap = false,
    this.itemExtent,
    this.prototypeItem,
    this.cacheExtentScreens = 1.0,
    this.isolateRepaints = true,
  });
  final int itemCount;
  final Widget Function(BuildContext, int) itemBuilder;
  final ScrollController? controller;
  final EdgeInsets? padding;
  final ScrollPhysics? physics;
  final bool shrinkWrap;

  /// Fixed row height — enables cheap scroll-offset math (prefer when uniform).
  final double? itemExtent;

  /// Alternative to [itemExtent] when height is derived from a prototype widget.
  final Widget? prototypeItem;

  /// Screens of off-screen cache. 1.0 ≈ smooth without prebuilding 3 screens.
  final double cacheExtentScreens;

  /// Wrap each tile in RepaintBoundary (disable if tiles already isolate).
  final bool isolateRepaints;

  @override
  Widget build(BuildContext context) {
    // PERF: 1 screen cache — heavy cards at 1.5–3 screens inflate build/memory
    // with no perceived smoothness gain on operational lists.
    final cacheExtent =
        MediaQuery.sizeOf(context).height * cacheExtentScreens.clamp(0.25, 2.0);

    return ListView.builder(
      controller: controller,
      padding: padding,
      physics: physics ?? const AlwaysScrollableScrollPhysics(),
      shrinkWrap: shrinkWrap,
      itemCount: itemCount,
      itemExtent: itemExtent,
      prototypeItem: prototypeItem,
      cacheExtent: cacheExtent,
      // We wrap tiles ourselves when isolateRepaints; avoid double boundaries.
      addRepaintBoundaries: !isolateRepaints,
      addAutomaticKeepAlives: false,
      addSemanticIndexes: false,
      itemBuilder: (context, index) {
        final child = itemBuilder(context, index);
        if (!isolateRepaints) return child;
        return RepaintBoundary(child: child);
      },
    );
  }
}

/// Optimized SliverList for use in CustomScrollView
class OptimizedSliverList extends StatelessWidget {
  const OptimizedSliverList({
    required this.itemCount,
    required this.itemBuilder,
    super.key,
    this.itemExtent,
    this.isolateRepaints = true,
  });
  final int itemCount;
  final Widget Function(BuildContext, int) itemBuilder;
  final double? itemExtent;
  final bool isolateRepaints;

  @override
  Widget build(BuildContext context) {
    if (itemExtent != null) {
      return SliverFixedExtentList(
        itemExtent: itemExtent!,
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            final child = itemBuilder(context, index);
            return isolateRepaints ? RepaintBoundary(child: child) : child;
          },
          childCount: itemCount,
          addAutomaticKeepAlives: false,
          addRepaintBoundaries: !isolateRepaints,
        ),
      );
    }

    return SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) {
          final child = itemBuilder(context, index);
          return isolateRepaints ? RepaintBoundary(child: child) : child;
        },
        childCount: itemCount,
        addAutomaticKeepAlives: false,
        addRepaintBoundaries: !isolateRepaints,
      ),
    );
  }
}

/// Mixin for keeping tab state alive
/// Usage: Add to StatefulWidget that contains tabs
///
/// class MyTabState extends State<MyTab>
///     with AutomaticKeepAliveClientMixin, TabKeepAliveMixin {
///   @override
///   Widget build(BuildContext context) {
///     super.build(context); // Required call
///     return ...;
///   }
/// }
mixin TabKeepAliveMixin<T extends StatefulWidget>
    on AutomaticKeepAliveClientMixin<T> {
  @override
  bool get wantKeepAlive => true;
}

/// Optimized container with RepaintBoundary
/// Use for heavy widgets that re-render independently
class IsolatedWidget extends StatelessWidget {
  const IsolatedWidget({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(child: child);
  }
}

/// Debounced callback wrapper
/// Prevents callback from firing more than once per duration
class DebouncedCallback {
  DebouncedCallback({this.duration = const Duration(milliseconds: 300)});
  final Duration duration;
  DateTime? _lastCall;

  bool call() {
    final now = DateTime.now();
    if (_lastCall == null || now.difference(_lastCall!) > duration) {
      _lastCall = now;
      return true;
    }
    return false;
  }
}
