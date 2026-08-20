/// Geometry audit for generated ZPL tickets.
///
/// Parses field origins (`^FO`), graphics (`^GFA`), bars (`^GB`) and
/// asserts they stay inside [ThermalTicketLayout] printable margins.
/// Used by automated tests to prove clipping cannot happen without a
/// physical printer.
library;

import 'package:gmp_app_mobilidad/features/repartidor/data/thermal_ticket_layout.dart';

class ZplGeometryIssue {
  const ZplGeometryIssue(this.message);
  final String message;

  @override
  String toString() => message;
}

class ZplGeometryReport {
  ZplGeometryReport({
    required this.printWidth,
    required this.labelLength,
    required this.firstContentY,
    required this.lastContentY,
    required this.fieldCount,
    required this.issues,
  });

  final int? printWidth;
  final int? labelLength;
  final int? firstContentY;
  final int? lastContentY;
  final int fieldCount;
  final List<ZplGeometryIssue> issues;

  bool get ok => issues.isEmpty;
}

class ThermalZplGeometry {
  ThermalZplGeometry._();

  static final RegExp _pw = RegExp(r'\^PW(\d+)');
  static final RegExp _ll = RegExp(r'\^LL(\d+)');
  static final RegExp _cf = RegExp(r'\^CF0,(\d+)');
  static final RegExp _fxLogo = RegExp(r'\^FXlogo,(\d+),(\d+)');
  static final RegExp _gb = RegExp(r'\^GB(\d+),(\d+),(\d+)');
  static final RegExp _gfa = RegExp(r'\^GFA,(\d+),(\d+),(\d+),');

  /// Audit [zpl] against [layout]. Returns issues (empty = safe geometry).
  static ZplGeometryReport audit(String zpl, ThermalTicketLayout layout) {
    final issues = <ZplGeometryIssue>[];

    if (!zpl.contains('^XA') || !zpl.contains('^XZ')) {
      issues.add(const ZplGeometryIssue('Missing ^XA/^XZ envelope'));
    }
    if (!zpl.contains('^MNN')) {
      issues.add(const ZplGeometryIssue('Missing continuous media ^MNN'));
    }
    if (!zpl.contains('^LT0')) {
      issues.add(const ZplGeometryIssue('Missing ^LT0 (top origin)'));
    }
    if (!zpl.contains('^LH0,0')) {
      issues.add(const ZplGeometryIssue('Missing ^LH0,0'));
    }

    final pwMatch = _pw.firstMatch(zpl);
    final llMatch = _ll.firstMatch(zpl);
    final pw = pwMatch != null ? int.parse(pwMatch.group(1)!) : null;
    final ll = llMatch != null ? int.parse(llMatch.group(1)!) : null;

    if (pw == null) {
      issues.add(const ZplGeometryIssue('Missing ^PW'));
    } else if (pw != layout.printWidthDots) {
      issues.add(
        ZplGeometryIssue(
          '^PW=$pw but layout printable=${layout.printWidthDots}',
        ),
      );
    }

    // Exact logo size from ^FXlogo,w,h (emitted by generator).
    int? pendingLogoW;
    int? pendingLogoH;

    var font = 18;
    var firstY = 1 << 30;
    var lastY = 0;
    var fields = 0;

    for (final raw in zpl.split('\n')) {
      final line = raw.trimRight();

      final fx = _fxLogo.firstMatch(line);
      if (fx != null) {
        pendingLogoW = int.parse(fx.group(1)!);
        pendingLogoH = int.parse(fx.group(2)!);
        continue;
      }

      final cf = _cf.firstMatch(line);
      if (cf != null) {
        font = int.parse(cf.group(1)!);
      }

      final fo = RegExp(r'\^FO(\d+),(\d+)').firstMatch(line);
      if (fo == null) continue;

      final x = int.parse(fo.group(1)!);
      final y = int.parse(fo.group(2)!);
      fields++;
      if (y < firstY) firstY = y;
      if (y > lastY) lastY = y;

      if (x < layout.xLeft) {
        issues.add(ZplGeometryIssue('FO x=$x < left margin ${layout.xLeft}'));
      }

      final gfa = _gfa.firstMatch(line);
      if (gfa != null) {
        final width = pendingLogoW ?? (int.parse(gfa.group(3)!) * 8);
        final height = pendingLogoH ??
            (int.parse(gfa.group(3)!) == 0
                ? 0
                : int.parse(gfa.group(1)!) ~/ int.parse(gfa.group(3)!));
        pendingLogoW = null;
        pendingLogoH = null;
        _checkBox(
          issues,
          layout,
          x: x,
          y: y,
          width: width,
          height: height,
          label: 'GFA',
        );
        final expected = layout.centerX(width);
        if ((x - expected).abs() > 1) {
          issues.add(
            ZplGeometryIssue(
              'GFA not centered: x=$x expected=$expected (w=$width)',
            ),
          );
        }
        lastY = mathMax(lastY, y + height);
        continue;
      }

      final gb = _gb.firstMatch(line);
      if (gb != null) {
        final w = int.parse(gb.group(1)!);
        final h = int.parse(gb.group(2)!);
        _checkBox(
          issues,
          layout,
          x: x,
          y: y,
          width: w,
          height: h,
          label: 'GB',
        );
        lastY = mathMax(lastY, y + h);
        continue;
      }

      final fdIdx = line.indexOf('^FD');
      if (fdIdx >= 0) {
        final fdEnd = line.indexOf('^FS', fdIdx);
        final text = fdEnd > fdIdx
            ? line.substring(fdIdx + 3, fdEnd)
            : line.substring(fdIdx + 3);
        final width = text.length * layout.charDots(font);
        _checkBox(
          issues,
          layout,
          x: x,
          y: y,
          width: width,
          height: font,
          label: 'FD("$text")',
        );
        lastY = mathMax(lastY, y + font);
      }
    }

    if (fields == 0) {
      issues.add(const ZplGeometryIssue('No ^FO fields found'));
    }

    // Top: first ink must sit on the top margin (no dead feed).
    if (firstY != 1 << 30) {
      if (firstY < layout.marginTop) {
        issues.add(
          ZplGeometryIssue(
            'Content starts above top margin: y=$firstY < ${layout.marginTop}',
          ),
        );
      }
      if (firstY > layout.marginTop + 4) {
        issues.add(
          ZplGeometryIssue(
            'Dead space above content: firstY=$firstY '
            '(expected ≈ ${layout.marginTop})',
          ),
        );
      }
    }

    if (ll != null) {
      final expectedMin = lastY + layout.marginBottom;
      // LL must cover content + bottom margin, without huge trailing blank.
      if (ll < expectedMin - 2) {
        issues.add(
          ZplGeometryIssue(
            '^LL=$ll too short for content end=$lastY '
            '+ bottom=${layout.marginBottom}',
          ),
        );
      }
      if (ll > expectedMin + layout.rowGap(18) + 8) {
        issues.add(
          ZplGeometryIssue(
            '^LL=$ll leaves excess blank below content '
            '(end=$lastY, expected≈$expectedMin)',
          ),
        );
      }
    } else {
      issues.add(const ZplGeometryIssue('Missing ^LL'));
    }

    return ZplGeometryReport(
      printWidth: pw,
      labelLength: ll,
      firstContentY: firstY == 1 << 30 ? null : firstY,
      lastContentY: lastY,
      fieldCount: fields,
      issues: issues,
    );
  }

  static void _checkBox(
    List<ZplGeometryIssue> issues,
    ThermalTicketLayout layout, {
    required int x,
    required int y,
    required int width,
    required int height,
    required String label,
  }) {
    if (x < layout.xLeft) {
      issues.add(ZplGeometryIssue('$label left overflow: x=$x'));
    }
    if (x + width > layout.xRight + 1) {
      // +1 soft tolerance for rounding on CF0 width estimates
      issues.add(
        ZplGeometryIssue(
          '$label right overflow: x=$x w=$width '
          'ends=${x + width} > right=${layout.xRight}',
        ),
      );
    }
    if (y < 0) {
      issues.add(ZplGeometryIssue('$label negative y=$y'));
    }
  }

  static int mathMax(int a, int b) => a > b ? a : b;
}
