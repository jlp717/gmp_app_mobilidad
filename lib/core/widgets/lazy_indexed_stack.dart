import 'package:flutter/material.dart';

/// Un `IndexedStack` que carga sus hijos (children) solo cuando son seleccionados.
/// Una vez que un hijo es instanciado, se mantiene en el árbol de widgets
/// (gracias al `IndexedStack` interno), preservando su estado para siempre.
///
/// V2: Añade una sutil animación de entrada (fade + scale) al cambiar de pestaña.
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
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    // Si hay hijos, arranca la animación inicial
    if (widget.children.isNotEmpty) {
      _animController.forward();
    }
  }

  @override
  void didUpdateWidget(LazyIndexedStack oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.children.length != oldWidget.children.length) {
      // Re-initialize flags if the array length changed to avoid index out of bounds
      _activatedFlags = List.generate(
        widget.children.length,
        (i) =>
            i == widget.index ||
            (i < _activatedFlags.length && _activatedFlags[i]),
      );
    } else {
      _activatedFlags[widget.index] = true;
    }

    // Trigger entrance animation when switching tabs
    if (widget.index != _previousIndex) {
      _previousIndex = widget.index;
      _animController.forward(from: 0.0);
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
        // Wrap the active child with an entrance animation
        if (i == widget.index) {
          return _TabEntrance(
            controller: _animController,
            child: widget.children[i],
          );
        }
        return widget.children[i];
      }),
    );
  }
}

/// Subtle entrance animation for tab switching — fade in + scale pop.
class _TabEntrance extends AnimatedWidget {
  final Widget child;

  const _TabEntrance({
    required Animation<double> controller,
    required this.child,
  }) : super(listenable: controller);

  @override
  Widget build(BuildContext context) {
    final animation = listenable as Animation<double>;
    return Opacity(
      opacity: animation.value,
      child: Transform.scale(
        // Scale from 0.97 → 1.0 for a subtle "pop" feel
        scale: 0.97 + (0.03 * animation.value),
        child: child,
      ),
    );
  }
}
