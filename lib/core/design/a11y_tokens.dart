import 'package:flutter/material.dart';

/// Tokens de lectura y toque para comerciales y repartidores.
///
/// El texto base es 16 px lógicos para que el escalado del sistema al 200 %
/// siga siendo usable. No se recorta el [TextScaler].
abstract final class A11yTokens {
  static const double minText = 16;
  static const double minTouch = 48;

  static const TextStyle body = TextStyle(
    fontSize: minText,
    height: 1.35,
    fontWeight: FontWeight.w500,
  );

  static const TextStyle title = TextStyle(
    fontSize: 20,
    height: 1.25,
    fontWeight: FontWeight.w700,
  );

  static ButtonStyle touchButton({Color? foreground, Color? background}) {
    return ButtonStyle(
      minimumSize: const WidgetStatePropertyAll(Size(minTouch, minTouch)),
      tapTargetSize: MaterialTapTargetSize.padded,
      textStyle: const WidgetStatePropertyAll(
        TextStyle(fontSize: minText, fontWeight: FontWeight.w700),
      ),
      foregroundColor:
          foreground == null ? null : WidgetStatePropertyAll(foreground),
      backgroundColor:
          background == null ? null : WidgetStatePropertyAll(background),
    );
  }
}
