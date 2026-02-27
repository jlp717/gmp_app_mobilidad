/// 3D Projection Engine v2 — Optimized with precalculated trig, face culling,
/// and efficient hit testing. Performance-critical path.

import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../data/warehouse_data_service.dart';

// ═══════════════════════════════════════════════════════════════════════════════
// 3D PROJECTION — Precalculated sin/cos for performance
// ═══════════════════════════════════════════════════════════════════════════════

class Projection3D {
  final double rotX;
  final double rotY;
  final double zoom;
  final Offset panOffset;

  // Precalculated trig values — avoid recalculating per vertex
  late final double _cosX, _sinX, _cosY, _sinY;

  Projection3D({
    required this.rotX,
    required this.rotY,
    required this.zoom,
    this.panOffset = Offset.zero,
  }) {
    _cosY = math.cos(rotX);
    _sinY = math.sin(rotX);
    _cosX = math.cos(rotY);
    _sinX = math.sin(rotY);
  }

  /// Project a 3D point (x, y, z) to 2D screen coordinates
  Offset project(double x, double y, double z, Size size) {
    final rx = x * _cosX - y * _sinX;
    final ry = x * _sinX + y * _cosX;
    final fy = ry * _cosY - z * _sinY;
    final fz = ry * _sinY + z * _cosY;
    final sc = 0.4 * zoom;
    return Offset(
      size.width / 2 + rx * sc + panOffset.dx,
      size.height * 0.5 + fy * sc - fz * sc + panOffset.dy,
    );
  }

  /// Batch project 8 corners of a box — returns [fbl, fbr, bbl, bbr, ftl, ftr, btl, btr]
  List<Offset> projectBox(
      double bx, double by, double bz, double w, double d, double h, Size size) {
    return [
      project(bx, by, bz, size),         // 0: front-bottom-left
      project(bx + w, by, bz, size),     // 1: front-bottom-right
      project(bx, by + d, bz, size),     // 2: back-bottom-left
      project(bx + w, by + d, bz, size), // 3: back-bottom-right
      project(bx, by, bz + h, size),     // 4: front-top-left
      project(bx + w, by, bz + h, size), // 5: front-top-right
      project(bx, by + d, bz + h, size), // 6: back-top-left
      project(bx + w, by + d, bz + h, size), // 7: back-top-right
    ];
  }

  /// Calculate depth value for Z-sorting (higher = further from camera)
  double depth(double x, double y, double z) {
    return x * _cosX + y * _sinX * _cosY + z * _sinY;
  }

  /// Check if a projected point is within the viewport
  bool isVisible(Offset projected, Size size, double margin) {
    return projected.dx > -margin &&
        projected.dx < size.width + margin &&
        projected.dy > -margin &&
        projected.dy < size.height + margin;
  }

  /// Check if ANY corner of a projected box is visible
  bool isBoxVisible(List<Offset> corners, Size size, {double margin = 50}) {
    for (final c in corners) {
      if (isVisible(c, size, margin)) return true;
    }
    return false;
  }

  /// Approximate projected screen area of a box
  double projectedArea(double w, double d, double h) {
    return w * d * zoom * zoom * 0.16;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIGHTING ENGINE — Enhanced with specular highlights
// ═══════════════════════════════════════════════════════════════════════════════

class Lighting3D {
  // Light direction (normalized): front-right-up
  static const double lx = 0.35, ly = -0.45, lz = 0.82;
  static const double ambient = 0.35;

  /// Calculate light intensity for a face with given normal (nx, ny, nz)
  static double intensity(double nx, double ny, double nz) {
    final dot = nx * lx + ny * ly + nz * lz;
    return (ambient + (1 - ambient) * dot.clamp(0, 1));
  }

  /// Face-specific intensity presets for quick lookup
  static const double topLight = 1.0;     // Brightest — facing light
  static const double frontLight = 0.75;  // Medium
  static const double rightLight = 0.55;  // Darker side
  static const double leftLight = 0.45;   // Darkest side
  static const double backLight = 0.35;   // Very dark
  static const double bottomLight = 0.30; // Darkest

  /// Apply lighting to a base color with alpha
  static Color applyLight(Color base, double light, double alpha) {
    final l = light.clamp(0.3, 1.5);
    final int r = (base.red * l).round().clamp(0, 255);
    final int g = (base.green * l).round().clamp(0, 255);
    final int b = (base.blue * l).round().clamp(0, 255);
    return Color.fromARGB((alpha * 255).round(), r, g, b);
  }

  /// Create a gradient-like effect on a face (top → bottom darkening)
  static List<Color> faceGradient(Color base, double light, double alpha) {
    return [
      applyLight(base, light * 1.15, alpha),  // Top of face — brighter
      applyLight(base, light * 0.85, alpha),  // Bottom of face — darker
    ];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATH & POLYGON HELPERS — Optimized
// ═══════════════════════════════════════════════════════════════════════════════

class PolyHelper {
  /// Build a closed Path from a list of 2D points
  static Path pathOf(List<Offset> pts) {
    if (pts.isEmpty) return Path();
    final p = Path()..moveTo(pts[0].dx, pts[0].dy);
    for (int i = 1; i < pts.length; i++) {
      p.lineTo(pts[i].dx, pts[i].dy);
    }
    p.close();
    return p;
  }

  /// Fill a 3D face defined by 3D coords with a lit, alpha-blended color
  static void fillFace(
    Canvas canvas,
    Projection3D proj,
    Size size,
    List<List<double>> pts3d,
    Color base,
    double light, {
    double alpha = 1.0,
  }) {
    final offsets = pts3d.map((p) => proj.project(p[0], p[1], p[2], size)).toList();
    final color = Lighting3D.applyLight(base, light, alpha);
    canvas.drawPath(pathOf(offsets), Paint()..color = color..style = PaintingStyle.fill);
  }

  /// Fill a face from pre-projected 2D offsets
  static void fillFaceSolid(
    Canvas canvas,
    List<Offset> pts,
    Color base,
    double light,
    double alpha,
  ) {
    final color = Lighting3D.applyLight(base, light, alpha);
    canvas.drawPath(
      pathOf(pts),
      Paint()..color = color..style = PaintingStyle.fill,
    );
  }

  /// Fill with gradient paint for premium look
  static void fillFaceGradient(
    Canvas canvas,
    List<Offset> pts,
    Color colorTop,
    Color colorBottom,
  ) {
    if (pts.length < 3) return;
    // Calculate bounding box for gradient
    double minY = double.infinity, maxY = double.negativeInfinity;
    for (final p in pts) {
      if (p.dy < minY) minY = p.dy;
      if (p.dy > maxY) maxY = p.dy;
    }
    final paint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [colorTop, colorBottom],
      ).createShader(Rect.fromLTRB(0, minY, 1, maxY))
      ..style = PaintingStyle.fill;
    canvas.drawPath(pathOf(pts), paint);
  }

  /// Draw a wireframe outline on projected points
  static void strokeFace(
    Canvas canvas,
    List<Offset> pts,
    Color color,
    double width,
  ) {
    canvas.drawPath(
      pathOf(pts),
      Paint()
        ..color = color
        ..strokeWidth = width
        ..style = PaintingStyle.stroke,
    );
  }

  /// Point-in-polygon test (ray casting algorithm)
  static bool pointInPolygon(Offset point, List<Offset> polygon) {
    if (polygon.length < 3) return false;
    bool inside = false;
    int j = polygon.length - 1;
    for (int i = 0; i < polygon.length; i++) {
      if ((polygon[i].dy > point.dy) != (polygon[j].dy > point.dy) &&
          point.dx <
              (polygon[j].dx - polygon[i].dx) *
                      (point.dy - polygon[i].dy) /
                      (polygon[j].dy - polygon[i].dy) +
                  polygon[i].dx) {
        inside = !inside;
      }
      j = i;
    }
    return inside;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HIT TESTING — Find which box was tapped
// ═══════════════════════════════════════════════════════════════════════════════

class HitTester {
  /// Find the frontmost box under the tap point
  static PlacedBox? hitTest({
    required Offset tapPoint,
    required Size canvasSize,
    required List<PlacedBox> boxes,
    required Projection3D proj,
    required double ox,
    required double oy,
    required double oz,
  }) {
    PlacedBox? hit;
    double hitDepth = double.negativeInfinity;

    for (final b in boxes) {
      final bx = ox + b.x, by = oy + b.y, bz = oz + b.z;
      final depth = proj.depth(bx + b.w / 2, by + b.d / 2, bz + b.h / 2);

      final corners = proj.projectBox(bx, by, bz, b.w, b.d, b.h, canvasSize);
      // Top face: 4,5,7,6
      final topPts = [corners[4], corners[5], corners[7], corners[6]];
      // Front face: 0,1,5,4
      final frontPts = [corners[0], corners[1], corners[5], corners[4]];
      // Right face: 1,3,7,5
      final rightPts = [corners[1], corners[3], corners[7], corners[5]];

      if (PolyHelper.pointInPolygon(tapPoint, topPts) ||
          PolyHelper.pointInPolygon(tapPoint, frontPts) ||
          PolyHelper.pointInPolygon(tapPoint, rightPts)) {
        if (depth > hitDepth) {
          hit = b;
          hitDepth = depth;
        }
      }
    }
    return hit;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR PALETTES — Premium, high-contrast colors for product distinction
// ═══════════════════════════════════════════════════════════════════════════════

/// Color mode for cargo visualization
enum ColorMode { product, client, heatmap }

class CargoColors {
  // Premium palette — high saturation, distinct hues, designed for dark backgrounds
  static const palette = <Color>[
    Color(0xFFFF6B6B), // Soft Red
    Color(0xFF4ECDC4), // Teal
    Color(0xFFFFE66D), // Warm Yellow
    Color(0xFF95E1D3), // Mint
    Color(0xFFA06CD5), // Purple
    Color(0xFFFF8C42), // Orange
    Color(0xFF6BCB77), // Green
    Color(0xFF4D96FF), // Blue
    Color(0xFFFF6B9D), // Pink
    Color(0xFF00D2FF), // Cyan
    Color(0xFFFF9A9E), // Salmon
    Color(0xFFA8E6CF), // Pale Green
    Color(0xFFDDA0DD), // Plum
    Color(0xFFF0E68C), // Khaki
    Color(0xFF87CEEB), // Sky Blue
    Color(0xFFFFB347), // Pastel Orange
  ];

  static Color byProduct(String articleCode) {
    return palette[articleCode.hashCode.abs() % palette.length];
  }

  static Color byClient(String clientCode) {
    return palette[clientCode.hashCode.abs() % palette.length];
  }

  static Color byWeight(double weight, double maxWeight) {
    final t = maxWeight > 0 ? (weight / maxWeight).clamp(0.0, 1.0) : 0.5;
    if (t < 0.33) {
      return Color.lerp(const Color(0xFF4D96FF), const Color(0xFF6BCB77), t / 0.33)!;
    } else if (t < 0.66) {
      return Color.lerp(const Color(0xFF6BCB77), const Color(0xFFFFE66D), (t - 0.33) / 0.33)!;
    } else {
      return Color.lerp(const Color(0xFFFFE66D), const Color(0xFFFF6B6B), (t - 0.66) / 0.34)!;
    }
  }

  static Color forBox(PlacedBox box, ColorMode mode, double maxWeight) {
    switch (mode) {
      case ColorMode.product:
        return byProduct(box.articleCode);
      case ColorMode.client:
        return byClient(box.clientCode);
      case ColorMode.heatmap:
        return byWeight(box.weight, maxWeight);
    }
  }

  static String sizeLabel(double weight) {
    if (weight <= 2) return 'S';
    if (weight <= 10) return 'M';
    if (weight <= 25) return 'L';
    return 'XL';
  }

  static Color sizeColor(double weight) {
    if (weight <= 2) return Colors.lightBlue;
    if (weight <= 10) return const Color(0xFF6BCB77);
    if (weight <= 25) return Colors.amber;
    return Colors.redAccent;
  }
}
