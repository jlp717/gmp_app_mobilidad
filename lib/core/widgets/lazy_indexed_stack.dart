import 'package:flutter/material.dart';

/// Un `IndexedStack` que carga sus hijos (children) solo cuando son seleccionados.
/// Una vez que un hijo es instanciado, se mantiene en el árbol de widgets
/// (gracias al `IndexedStack` interno), preservando su estado para siempre.
class LazyIndexedStack extends StatefulWidget {
  final int index;
  final List<Widget> children;
  final AlignmentGeometry alignment;
  final TextDirection? textDirection;
  final StackFit sizing;

  const LazyIndexedStack({
    super.key,
    required this.index,
    required this.children,
    this.alignment = AlignmentDirectional.topStart,
    this.textDirection,
    this.sizing = StackFit.loose,
  });

  @override
  State<LazyIndexedStack> createState() => _LazyIndexedStackState();
}

class _LazyIndexedStackState extends State<LazyIndexedStack> {
  late List<bool> _activatedFlags;

  @override
  void initState() {
    super.initState();
    _activatedFlags = List.generate(widget.children.length, (i) => i == widget.index);
  }

  @override
  void didUpdateWidget(LazyIndexedStack oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.children.length != oldWidget.children.length) {
      // Re-initialize flags if the array length changed to avoid index out of bounds
      _activatedFlags = List.generate(
        widget.children.length,
        (i) => i == widget.index || (i < _activatedFlags.length && _activatedFlags[i]),
      );
    } else {
      _activatedFlags[widget.index] = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    return IndexedStack(
      index: widget.index,
      alignment: widget.alignment,
      textDirection: widget.textDirection,
      sizing: widget.sizing,
      children: List.generate(widget.children.length, (i) {
        if (_activatedFlags[i]) {
          return widget.children[i];
        }
        return const SizedBox.shrink(); // Widget vacío hasta que se activa
      }),
    );
  }
}
