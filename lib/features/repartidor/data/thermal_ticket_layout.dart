import 'dart:math' as math;

/// Adaptive thermal layout for Zebra/ZPL tickets (58mm or 80mm @ any DPI).
///
/// Critical safeguard: `^PW` uses the **printable** width, not media width.
/// 80 mm rolls print ~72 mm (576 dots @ 203 dpi); using 640 clips the right
/// edge. Uniform insets keep ink off all four edges without wasting a blank
/// feed above the logo.
class ThermalTicketLayout {
  const ThermalTicketLayout({
    required this.widthMm,
    this.dpi = 203,
  }) : assert(widthMm == 58 || widthMm == 80);

  final int widthMm;
  final int dpi;

  /// Soft inset on every side (~3 mm). Enough to avoid cutter/head clipping.
  static const double marginMm = 3.0;

  /// Printable width inside the roll (not the physical media width).
  static const double printable58Mm = 48.0;
  static const double printable80Mm = 72.0;

  /// Infer common mobile printer widths from Bluetooth name.
  static int inferWidthMm(String? printerName) {
    final name = (printerName ?? '').toUpperCase();
    const narrowHints = <String>[
      'ZQ110',
      'ZQ210',
      'ZQ220',
      'IMZ220',
      'MZ220',
      '58MM',
      '58 MM',
      '2IN',
      '2"',
    ];
    for (final hint in narrowHints) {
      if (name.contains(hint)) return 58;
    }
    return 80;
  }

  factory ThermalTicketLayout.forPrinter({
    String? printerName,
    int? widthMmOverride,
    int dpi = 203,
  }) {
    final mm = (widthMmOverride == 58 || widthMmOverride == 80)
        ? widthMmOverride!
        : inferWidthMm(printerName);
    return ThermalTicketLayout(widthMm: mm, dpi: dpi);
  }

  int dotsForMm(double mm) => ((mm / 25.4) * dpi).round();

  /// `^PW` — printable head width (safeguard against right-edge clipping).
  int get printWidthDots {
    // Canonical Zebra widths @ 203dpi; scale for other densities.
    if (dpi == 203) {
      return widthMm <= 58 ? 384 : 576;
    }
    return dotsForMm(widthMm <= 58 ? printable58Mm : printable80Mm);
  }

  /// Same inset left/right/top/bottom.
  int get margin => math.max(16, dotsForMm(marginMm));

  int get marginTop => margin;
  int get marginBottom => margin;

  int get xLeft => margin;
  int get xRight => printWidthDots - margin;

  int get contentWidth => math.max(64, xRight - xLeft);

  int get lineW => contentWidth;

  /// Logo starts after top margin — no dead feed above.
  int get yStart => marginTop;

  /// Logo must fit entirely inside the content box.
  int get logoMaxWidth => contentWidth;

  /// Keep banner readable but compact (~14–16 mm tall max).
  int get logoMaxHeight => math.min(
      dotsForMm(16), (logoMaxWidth * 437 / 1542).round().clamp(48, 120));

  // Columns: reserve a fixed right pocket for amounts so they never clip.
  int get _amountPocket => math.max(56, (contentWidth * 0.18).round());
  int get _bultPocket => math.max(36, (contentWidth * 0.10).round());

  int get colPtda => xLeft;
  int get colDesc => xLeft + math.max(28, (contentWidth * 0.09).round());
  int get colImp => xRight - _amountPocket;
  int get colBult => colImp - _bultPocket;

  int get totalsAnchor => xLeft + (contentWidth * 0.38).round();

  int fontSize(int base) {
    if (widthMm <= 58) return math.max(12, (base * 0.86).round());
    return base;
  }

  /// Conservative CF0 width so text stays inside [xLeft, xRight].
  int charDots(int fontSize) => math.max(8, (fontSize * 0.62).round());

  int charsFor(int fontSize, {int? maxWidthDots}) {
    final budget = maxWidthDots ?? contentWidth;
    return math.max(10, budget ~/ charDots(fontSize));
  }

  int charsBetween(int xFrom, int xTo, int fontSize) {
    return charsFor(fontSize, maxWidthDots: math.max(8, xTo - xFrom));
  }

  int rowGap(int fontSize) => fontSize + 6;

  /// Center [elementWidth] inside the content box; clamp so it never overflows.
  int centerX(int elementWidth) {
    final ideal = xLeft + ((contentWidth - elementWidth) / 2).floor();
    final maxX = math.max(xLeft, xRight - elementWidth);
    return ideal.clamp(xLeft, maxX);
  }

  /// Clamp any FO x so [elementWidth] stays inside side margins.
  int clampX(int x, int elementWidth) {
    final maxX = math.max(xLeft, xRight - elementWidth);
    return x.clamp(xLeft, maxX);
  }

  /// Label length = content end + bottom margin (no trailing blank feed).
  int labelLength(int contentEndY) => contentEndY + marginBottom;
}

/// Measured ZPL graphic (`^GFA`) for centering and Y advance.
class ZplGraphic {
  const ZplGraphic({
    required this.command,
    required this.widthDots,
    required this.heightDots,
  });

  final String command;
  final int widthDots;
  final int heightDots;
}
