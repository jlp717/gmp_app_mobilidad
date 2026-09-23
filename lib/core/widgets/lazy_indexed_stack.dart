import 'package:flutter/material.dart';

/// IndexedStack that instantiates each child only after it has been selected.
/// Previously visited children stay mounted, so tab state is preserved.
class LazyIndexedStack extends StatefulWidget {
  const LazyIndexedStack({
    required this.index,
    required this.children,
    super.key,
    this.alignment = AlignmentDirectional.topStart,
    this.textDirection,
    this.sizing = StackFit.loose,
  });

  final int index;
  final List<Widget> children;
  final AlignmentGeometry alignment;
  final TextDirection? textDirection;
  final StackFit sizing;

  @override
  State<LazyIndexedStack> createState() => _LazyIndexedStackState();
}

class _LazyIndexedStackState extends State<LazyIndexedStack>
    with SingleTickerProviderStateMixin {
  late List<bool> _activatedFlags;
  late AnimationController _animController;
  int _previousIndex = 0;

  @override
  void initState() {
    super.initState();
    _activatedFlags =
        List.generate(widget.children.length, (i) => i == widget.index);
    _previousIndex = widget.index;
    // PERF: 160ms fade-only — Opacity+Scale+Translate rebuilt the whole tab
    // subtree every frame and added measurable INP on dense comercial shells.
    _animController = AnimationController(
      duration: const Duration(milliseconds: 160),
      vsync: this,
    );
    if (widget.children.isNotEmpty) {
      _animController.forward();
    }
  }

  @override
  void didUpdateWidget(LazyIndexedStack oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.children.isEmpty) return;

    if (widget.children.length != oldWidget.children.length) {
      _activatedFlags = List.generate(
        widget.children.length,
        (i) =>
            i == widget.index ||
            (i < _activatedFlags.length && _activatedFlags[i]),
      );
    } else {
      _activatedFlags[widget.index] = true;
    }

    if (widget.index != _previousIndex) {
      _previousIndex = widget.index;
      _animController.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return IndexedStack(
      index: widget.index,
      alignment: widget.alignment,
      textDirection: widget.textDirection,
      sizing: widget.sizing,
      children: List.generate(widget.children.length, (i) {
        if (!_activatedFlags[i]) {
          return const SizedBox.shrink();
        }

        final child = TickerMode(
          enabled: i == widget.index,
          child: widget.children[i],
        );

        if (i == widget.index) {
          if (reduceMotion) return child;
          return FadeTransition(
            opacity: CurvedAnimation(
              parent: _animController,
              curve: Curves.easeOut,
            ),
            child: RepaintBoundary(child: child),
          );
        }

        return child;
      }),
    );
  }
}
