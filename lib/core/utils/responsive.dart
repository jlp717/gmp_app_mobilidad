import 'package:flutter/widgets.dart';

/// Lightweight responsive utilities for adapting UI to different screen sizes.
/// Baseline: 1280px wide landscape tablet (the original design target).
class Responsive {
  Responsive._();

  // ---------------------------------------------------------------------------
  // Breakpoint queries
  // ---------------------------------------------------------------------------

  /// Phone-sized or very small tablet (< 600 logical px wide)
  static bool isSmall(BuildContext ctx) =>
      MediaQuery.of(ctx).size.width < 600;

  /// Medium tablet (600–899 logical px wide)
  static bool isMedium(BuildContext ctx) {
    final w = MediaQuery.of(ctx).size.width;
    return w >= 600 && w < 900;
  }

  /// Large tablet / desktop (>= 900 logical px wide)
  static bool isLarge(BuildContext ctx) =>
      MediaQuery.of(ctx).size.width >= 900;

  // ---------------------------------------------------------------------------
  // Dimension helpers
  // ---------------------------------------------------------------------------

  /// Scale a fixed value proportionally to screen width.
  /// Returns the original value on large screens (>= 1200px).
  static double scale(BuildContext ctx, double value) {
    final width = MediaQuery.of(ctx).size.width;
    if (width >= 1200) return value;
    if (width >= 900) return value * 0.85;
    return value * 0.7;
  }

  /// Clamp a desired width so it never exceeds [maxPercent] of screen width.
  static double clampWidth(BuildContext ctx, double desired,
      {double maxPercent = 0.9}) {
    final screenW = MediaQuery.of(ctx).size.width;
    final max = screenW * maxPercent;
    return desired > max ? max : desired;
  }

  /// Clamp a desired height so it never exceeds [maxPercent] of screen height.
  static double clampHeight(BuildContext ctx, double desired,
      {double maxPercent = 0.9}) {
    final screenH = MediaQuery.of(ctx).size.height;
    final max = screenH * maxPercent;
    return desired > max ? max : desired;
  }

  // ---------------------------------------------------------------------------
  // Font size helpers
  // ---------------------------------------------------------------------------

  /// Returns [large] on big screens, [small] on phones, interpolated on medium.
  static double fontSize(BuildContext ctx,
      {required double small, required double large}) {
    final w = MediaQuery.of(ctx).size.width;
    if (w >= 1200) return large;
    if (w >= 900) return small + (large - small) * 0.7;
    if (w >= 600) return small + (large - small) * 0.4;
    return small;
  }

  // ---------------------------------------------------------------------------
  // Padding / spacing helpers
  // ---------------------------------------------------------------------------

  /// Returns [large] on big screens, [small] on phones.
  static double padding(BuildContext ctx,
      {required double small, required double large}) {
    final w = MediaQuery.of(ctx).size.width;
    if (w >= 1200) return large;
    if (w >= 600) return small + (large - small) * 0.5;
    return small;
  }

  /// Standard content padding that adapts to screen size.
  static EdgeInsets contentPadding(BuildContext ctx) {
    final w = MediaQuery.of(ctx).size.width;
    if (w >= 1200) return const EdgeInsets.all(24);
    if (w >= 600) return const EdgeInsets.all(16);
    return const EdgeInsets.all(10);
  }

  /// Spacing between cards/sections.
  static double spacing(BuildContext ctx) {
    final w = MediaQuery.of(ctx).size.width;
    if (w >= 1200) return 24;
    if (w >= 600) return 16;
    return 10;
  }
}
