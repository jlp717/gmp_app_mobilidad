/// Accessibility Utilities
/// =====================
/// Accessibility helpers for screen readers and accessibility tools
library;

import 'package:flutter/material.dart';

/// Semantic wrapper for better accessibility
class AccessibleWidget extends StatelessWidget {

  const AccessibleWidget({
    required this.child, super.key,
    this.label,
    this.hint,
    this.role,
    this.checked,
    this.enabled,
  });
  final Widget child;
  final String? label;
  final String? hint;
  final String? role;
  final bool? checked;
  final bool? enabled;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      hint: hint,
      button: role == 'button',
      link: role == 'link',
      checked: role == 'checkbox' ? checked : null,
      enabled: enabled,
      child: child,
    );
  }
}

/// Accessible button with label
class AccessibleButton extends StatelessWidget {

  const AccessibleButton({
    required this.onPressed, required this.child, super.key,
    this.semanticLabel,
  });
  final VoidCallback? onPressed;
  final Widget child;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      enabled: onPressed != null,
      child: InkWell(
        onTap: onPressed,
        child: child,
      ),
    );
  }
}

/// Accessible text field
class AccessibleTextField extends StatelessWidget {

  const AccessibleTextField({
    super.key,
    this.controller,
    this.label,
    this.hint,
    this.errorText,
    this.obscureText,
    this.keyboardType,
    this.onChanged,
  });
  final TextEditingController? controller;
  final String? label;
  final String? hint;
  final String? errorText;
  final bool? obscureText;
  final TextInputType? keyboardType;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      textField: true,
      label: label,
      hint: hint,
      child: TextField(
        controller: controller,
        obscureText: obscureText ?? false,
        keyboardType: keyboardType,
        onChanged: onChanged,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          errorText: errorText,
        ),
      ),
    );
  }
}

/// High contrast text for accessibility
class AccessibleText extends StatelessWidget {

  const AccessibleText(
    this.text, {
    super.key,
    this.style,
    this.fontSize,
    this.fontWeight,
    this.color,
    this.textAlign,
  });
  final String text;
  final TextStyle? style;
  final double? fontSize;
  final FontWeight? fontWeight;
  final Color? color;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    // Ensure minimum font size for accessibility
    final effectiveSize = fontSize ?? 14;
    final effectiveWeight = fontWeight ?? FontWeight.normal;

    return Semantics(
      label: text,
      child: Text(
        text,
        style: style ??
            TextStyle(
              fontSize: effectiveSize < 14 ? 14 : effectiveSize,
              fontWeight: effectiveWeight,
              color: color,
            ),
        textAlign: textAlign,
      ),
    );
  }
}

/// Helper to check if text scaling is reasonable
class TextScalingHelper {
  static double getScaledFontSize(BuildContext context, double baseSize) {
    final scale = MediaQuery.textScalerOf(context).scale(1);
    // Cap scaling at 1.3x to prevent UI breaks
    final clampedScale = scale.clamp(0.8, 1.3);
    return baseSize * clampedScale;
  }
}
