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
    _animController = AnimationController(
      duration: const Duration(milliseconds: 180),
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
          return _TabEntrance(
            controller: _animController,
            child: child,
          );
        }

        return child;
      }),
    );
  }
}

class _TabEntrance extends AnimatedWidget {
  const _TabEntrance({
    required Animation<double> controller,
    required this.child,
  }) : super(listenable: controller);

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final animation = listenable as Animation<double>;
    final curvedValue = Curves.easeOutCubic.transform(animation.value);

    return Opacity(
      opacity: curvedValue,
      child: Transform.translate(
        offset: Offset(0, 8 * (1 - curvedValue)),
        child: child,
      ),
    );
  }
}
