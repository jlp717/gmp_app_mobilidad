/// Optimized ListView Widgets
/// ==========================
/// High-performance list widgets with:
/// - Increased cache extent for smoother scrolling
/// - AutomaticKeepAliveClientMixin for tab persistence
/// - RepaintBoundary for isolated repaints
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
  });
  final int itemCount;
  final Widget Function(BuildContext, int) itemBuilder;
  final ScrollController? controller;
  final EdgeInsets? padding;
  final ScrollPhysics? physics;
  final bool shrinkWrap;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: controller,
      padding: padding,
      physics: physics ?? const AlwaysScrollableScrollPhysics(),
      shrinkWrap: shrinkWrap,
      itemCount: itemCount,
      // OPTIMIZATION: Cache 3 screens worth of items
      cacheExtent: MediaQuery.of(context).size.height * 3,
      addSemanticIndexes: false, // Slight perf gain if not using accessibility
      itemBuilder: (context, index) {
        // Wrap each item in RepaintBoundary for isolated repaints
        return RepaintBoundary(
          child: itemBuilder(context, index),
        );
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
  });
  final int itemCount;
  final Widget Function(BuildContext, int) itemBuilder;

  @override
  Widget build(BuildContext context) {
    return SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) {
          return RepaintBoundary(
            child: itemBuilder(context, index),
          );
        },
        childCount: itemCount,
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
