import 'package:flutter/widgets.dart';

/// Lightweight responsive utilities for adapting UI to different screen sizes.
/// Baseline: 1280px wide landscape tablet (the original design target).
///
/// Breakpoints:
///   - Phone:   < 600 px
///   - Tablet:  600 – 899 px
///   - Desktop: >= 900 px  (large tablet / desktop)
///
/// [value] and [fontSize] use smooth linear interpolation across 4 thresholds
/// (600 / 900 / 1200) so sizes scale gradually instead of jumping.
class Responsive {
  Responsive._();

  // ---------------------------------------------------------------------------
  // Breakpoint queries
  // ---------------------------------------------------------------------------

  /// Phone-sized or very small tablet (< 600 logical px shortest side)
  static bool isSmall(BuildContext ctx) =>
      MediaQuery.of(ctx).size.shortestSide < 600;

  /// Semantic alias for [isSmall].
  static bool isPhone(BuildContext ctx) => isSmall(ctx);

  /// Medium tablet (600–899 logical px shortest side)
  static bool isMedium(BuildContext ctx) {
    final w = MediaQuery.of(ctx).size.shortestSide;
    return w >= 600 && w < 900;
  }

  /// Large tablet / desktop (>= 900 logical px shortest side)
  static bool isLarge(BuildContext ctx) =>
      MediaQuery.of(ctx).size.shortestSide >= 900;

  /// True when device is in landscape orientation.
  static bool isLandscape(BuildContext ctx) =>
      MediaQuery.of(ctx).orientation == Orientation.landscape;

  /// Whether to use bottom navigation (phones) instead of sidebar (tablets).
  static bool useBottomNav(BuildContext ctx) => isSmall(ctx);

  // ---------------------------------------------------------------------------
  // Landscape scaling multiplier
  // ---------------------------------------------------------------------------

  /// True when device is in landscape orientation AND vertical space is very limited (< 500px).
  /// This is used to aggressively hide or shrink non-essential UI elements to maximize list visibility.
  static bool isLandscapeCompact(BuildContext ctx) {
    if (!isLandscape(ctx)) return false;
    return MediaQuery.of(ctx).size.height < 500;
  }

  /// Returns a shrinking factor when a horizontal device has a very small height.
  /// Phones in landscape have little vertical space (< 500px), so we shrink everything.
  static double landscapeScale(BuildContext ctx) {
    if (!isLandscapeCompact(ctx)) return 1.0;
    
    final h = MediaQuery.of(ctx).size.height;
    // For heights between 250 and 500, return a value between 0.5 and 0.95
    // This aggressively shrinks fonts, paddings, and headers so users can see more data.
    return (0.5 + ((h - 250) / 250) * 0.45).clamp(0.5, 0.95);
  }

  // ---------------------------------------------------------------------------
  // Smooth interpolation helper
  // ---------------------------------------------------------------------------

  /// Returns a value that interpolates linearly between [phone], [tablet], and
  /// [desktop] across the 600 / 900 / 1200 px breakpoints.
  /// If [tablet] is omitted it defaults to the midpoint of phone & desktop.
  /// On screens >= 1200 px the [desktop] value is returned unchanged.
  static double value(BuildContext ctx, {
    required double phone,
    required double desktop,
    double? tablet,
  }) {
    final w = MediaQuery.of(ctx).size.shortestSide;
    final t = tablet ?? (phone + desktop) / 2;
    final factor = landscapeScale(ctx);
    if (w >= 1200) return desktop * factor;
    if (w >= 900) return (t + (desktop - t) * ((w - 900) / 300)) * factor;
    if (w >= 600) return (phone + (t - phone) * ((w - 600) / 300)) * factor;
    return phone * factor;
  }

  // ---------------------------------------------------------------------------
  // Dimension helpers
  // ---------------------------------------------------------------------------

  /// Scale a fixed value proportionally to screen size.
  /// Returns the original value on large screens (>= 1200px shortestSide).
  static double scale(BuildContext ctx, double val) {
    final width = MediaQuery.of(ctx).size.shortestSide;
    final factor = landscapeScale(ctx);
    if (width >= 1200) return val * factor;
    if (width >= 900) return val * 0.85 * factor;
    return val * 0.7 * factor;
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

  /// Width for the sidebar navigation (0 on phones — they use bottom nav).
  static double sidebarWidth(BuildContext ctx) {
    if (isSmall(ctx)) return 0;
    if (isMedium(ctx)) return 64;
    return 90;
  }

  // ---------------------------------------------------------------------------
  // Font size helpers
  // ---------------------------------------------------------------------------

  /// Returns [large] on big screens, [small] on phones, interpolated on medium.
  static double fontSize(BuildContext ctx,
      {required double small, required double large}) {
    final w = MediaQuery.of(ctx).size.shortestSide;
    final factor = landscapeScale(ctx);
    if (w >= 1200) return large * factor;
    if (w >= 900) return (small + (large - small) * 0.7) * factor;
    if (w >= 600) return (small + (large - small) * 0.4) * factor;
    return small * factor;
  }

  /// Convenience for icon sizes — same interpolation as [fontSize].
  static double iconSize(BuildContext ctx,
      {required double phone, required double desktop,}) =>
      fontSize(ctx, small: phone, large: desktop);

  // ---------------------------------------------------------------------------
  // Padding / spacing helpers
  // ---------------------------------------------------------------------------

  /// Returns [large] on big screens, [small] on phones.
  static double padding(BuildContext ctx,
      {required double small, required double large}) {
    final w = MediaQuery.of(ctx).size.shortestSide;
    final factor = landscapeScale(ctx);
    if (w >= 1200) return large * factor;
    if (w >= 600) return (small + (large - small) * 0.5) * factor;
    return small * factor;
  }

  /// Standard content padding that adapts to screen size.
  static EdgeInsets contentPadding(BuildContext ctx) {
    final w = MediaQuery.of(ctx).size.shortestSide;
    final factor = landscapeScale(ctx);
    if (w >= 1200) return EdgeInsets.all(24 * factor);
    if (w >= 600) return EdgeInsets.all(16 * factor);
    return EdgeInsets.all(10 * factor);
  }

  /// Spacing between cards/sections.
  static double spacing(BuildContext ctx) {
    final w = MediaQuery.of(ctx).size.shortestSide;
    final factor = landscapeScale(ctx);
    if (w >= 1200) return 24 * factor;
    if (w >= 600) return 16 * factor;
    return 10 * factor;
  }

  /// Modal/bottom-sheet height that adapts to orientation.
  /// In landscape the modal uses more of the available (shorter) height.
  static double modalHeight(BuildContext ctx, {
    double portraitFraction = 0.85,
    double landscapeFraction = 0.95,
  }) {
    final h = MediaQuery.of(ctx).size.height;
    final fraction = isLandscape(ctx) ? landscapeFraction : portraitFraction;
    return h * fraction;
  }

  /// Dialog width clamped to 92% of screen.
  static double dialogWidth(BuildContext ctx, double desired) =>
      clampWidth(ctx, desired, maxPercent: 0.92);
}
