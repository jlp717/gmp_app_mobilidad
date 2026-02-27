/// 3D Projection Engine — Math, lighting, and hit testing utilities
/// Used by all painters in the 3D load planner

import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../data/warehouse_data_service.dart';

// ═══════════════════════════════════════════════════════════════════════════════
// 3D PROJECTION
// ═══════════════════════════════════════════════════════════════════════════════

class Projection3D {
  final double rotX;
  final double rotY;
  final double zoom;
  final Offset panOffset;

  const Projection3D({
    required this.rotX,
    required this.rotY,
    required this.zoom,
    this.panOffset = Offset.zero,
  });

  /// Project a 3D point (x, y, z) to 2D screen coordinates
  Offset project(double x, double y, double z, Size size) {
    final cY = math.cos(rotX), sY = math.sin(rotX);
    final cX = math.cos(rotY), sX = math.sin(rotY);
    final rx = x * cX - y * sX;
    final ry = x * sX + y * cX;
    final fy = ry * cY - z * sY;
    final fz = ry * sY + z * cY;
    final sc = 0.4 * zoom;
    return Offset(
      size.width / 2 + rx * sc + panOffset.dx,
      size.height * 0.5 + fy * sc - fz * sc + panOffset.dy,
    );
  }

  /// Calculate depth value for Z-sorting (higher = further from camera)
  double depth(double x, double y, double z) {
    return (x) * math.cos(rotY) + (y) * math.sin(rotX) + (z);
  }

  /// Check if a projected point is within the viewport
  bool isVisible(Offset projected, Size size, double margin) {
    return projected.dx > -margin &&
        projected.dx < size.width + margin &&
        projected.dy > -margin &&
        projected.dy < size.height + margin;
  }

  /// Approximate projected screen area of a box
  double projectedArea(double w, double d, double h) {
    return w * d * zoom * zoom * 0.16;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIGHTING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

class Lighting3D {
  // Light direction (normalized): front-right-up
  static const double lx = 0.35, ly = -0.45, lz = 0.82;
  static const double ambient = 0.40;

  /// Calculate light intensity for a face with given normal (nx, ny, nz)
  static double intensity(double nx, double ny, double nz) {
    final dot = nx * lx + ny * ly + nz * lz;
    return (ambient + (1 - ambient) * dot.clamp(0, 1));
  }

  /// Apply lighting to a base color, returning a new color with alpha
  static Color applyLight(Color base, double light, double alpha) {
    final l = light.clamp(0.4, 1.8);
    final int r = (base.red * l).round().clamp(0, 255);
    final int g = (base.green * l).round().clamp(0, 255);
    final int b = (base.blue * l).round().clamp(0, 255);
    return Color.fromARGB((alpha * 255).round(), r, g, b);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATH & POLYGON HELPERS
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
  /// Returns null if no box was hit
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

      // Project 3 visible faces
      final topPts = [
        proj.project(bx, by, bz + b.h, canvasSize),
        proj.project(bx + b.w, by, bz + b.h, canvasSize),
        proj.project(bx + b.w, by + b.d, bz + b.h, canvasSize),
        proj.project(bx, by + b.d, bz + b.h, canvasSize),
      ];
      final frontPts = [
        proj.project(bx, by, bz, canvasSize),
        proj.project(bx + b.w, by, bz, canvasSize),
        proj.project(bx + b.w, by, bz + b.h, canvasSize),
        proj.project(bx, by, bz + b.h, canvasSize),
      ];
      final rightPts = [
        proj.project(bx + b.w, by, bz, canvasSize),
        proj.project(bx + b.w, by + b.d, bz, canvasSize),
        proj.project(bx + b.w, by + b.d, bz + b.h, canvasSize),
        proj.project(bx + b.w, by, bz + b.h, canvasSize),
      ];

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
// COLOR PALETTES
// ═══════════════════════════════════════════════════════════════════════════════

/// Color mode for cargo visualization
enum ColorMode { product, client, heatmap }

class CargoColors {
  static const palette = <Color>[
    Color(0xFFFF595E), // Coral Neon
    Color(0xFFFFCA3A), // Cyber Yellow
    Color(0xFF8AC926), // Yellow Green
    Color(0xFF1982C4), // Steel Blue
    Color(0xFF6A4C93), // Royal Purple
    Color(0xFF00F5D4), // Fluorescent Cyan
    Color(0xFFFF9F1C), // Deep Saffron
    Color(0xFFF15BB5), // Brilliant Rose
    Color(0xFF9B5DE5), // Amethyst
    Color(0xFF00BBF9), // Capri
    Color(0xFF38B000), // Kelly Green
    Color(0xFFE36414), // Tangelo
    Color(0xFF0D3B66), // Dark Indigo
    Color(0xFFF4D06F), // Naples Yellow
    Color(0xFFEF476F), // Paradise Pink
    Color(0xFF118AB2), // Blue NCS
  ];

  static Color byProduct(String articleCode) {
    return palette[articleCode.hashCode.abs() % palette.length];
  }

  static Color byClient(String clientCode) {
    return palette[clientCode.hashCode.abs() % palette.length];
  }

  static Color byWeight(double weight, double maxWeight) {
    final t = maxWeight > 0 ? (weight / maxWeight).clamp(0.0, 1.0) : 0.5;
    // Blue → Green → Yellow → Red
    if (t < 0.33) {
      return Color.lerp(const Color(0xFF3B82F6), const Color(0xFF22C55E), t / 0.33)!;
    } else if (t < 0.66) {
      return Color.lerp(const Color(0xFF22C55E), const Color(0xFFEAB308), (t - 0.33) / 0.33)!;
    } else {
      return Color.lerp(const Color(0xFFEAB308), const Color(0xFFEF4444), (t - 0.66) / 0.34)!;
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
    if (weight <= 10) return const Color(0xFF00FF88);
    if (weight <= 25) return Colors.amber;
    return Colors.redAccent;
  }
}
