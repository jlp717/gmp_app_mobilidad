/// Cargo Box Renderer — Renders placed boxes with lighting, labels, shadows,
/// selection glow, LOD, and overflow visualization

import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../data/warehouse_data_service.dart';
import 'projection_3d.dart';

class CargoBoxRenderer {
  final Projection3D proj;
  final Size size;
  final double ox, oy, oz;
  final ColorMode colorMode;
  final double maxWeight;
  final int? selectedId;
  final double glow;

  CargoBoxRenderer({
    required this.proj,
    required this.size,
    required this.ox,
    required this.oy,
    required this.oz,
    required this.colorMode,
    required this.maxWeight,
    this.selectedId,
    this.glow = 0.0,
  });

  // ─── Z-SORTED RENDER ─────────────────────────────────────────────────

  /// Render all placed boxes with Z-sorting, shadows, and labels.
  /// [cachedSort] can be provided for performance (reuse across frames).
  void renderAll(Canvas canvas, List<PlacedBox> placed,
      {List<PlacedBox>? cachedSort}) {
    final sorted = cachedSort ?? _zSort(placed);

    // Pass 1: Batch shadows
    _renderShadows(canvas, sorted);

    // Pass 2: Boxes with LOD
    for (final b in sorted) {
      _renderBox(canvas, b);
    }
  }

  /// Render overflow boxes outside the truck boundary
  void renderOverflow(Canvas canvas, List<PlacedBox> overflow, double containerDepth) {
    if (overflow.isEmpty) return;

    // Layout overflow boxes in front of the open doors
    double curX = 0, curY = 0, rowMaxH = 0;
    final overflowStartY = -30.0; // In front of doors
    const maxRowWidth = 300.0;

    for (int i = 0; i < overflow.length; i++) {
      final b = overflow[i];
      if (curX + b.w > maxRowWidth) {
        curX = 0;
        curY -= rowMaxH + 5;
        rowMaxH = 0;
      }

      final bx = ox + curX;
      final by = oy + overflowStartY + curY - b.d;
      final bz = oz;

      // Red-tinted rendering
      _renderOverflowBox(canvas, b, bx, by, bz);

      curX += b.w + 3;
      rowMaxH = math.max(rowMaxH, b.d);
    }

    // Dashed red boundary line
    final lineY = oy - 5;
    final dashPaint = Paint()
      ..color = Colors.redAccent.withValues(alpha: 0.6)
      ..strokeWidth = 1.5;
    for (double x = 0; x < (overflow.isEmpty ? 0 : 300); x += 12) {
      canvas.drawLine(
        proj.project(ox + x, lineY, oz, size),
        proj.project(ox + x + 6, lineY, oz, size),
        dashPaint,
      );
    }
  }

  // ─── Z-SORTING ────────────────────────────────────────────────────────

  List<PlacedBox> _zSort(List<PlacedBox> boxes) {
    return List<PlacedBox>.from(boxes)
      ..sort((a, b) {
        final za = proj.depth(
          ox + a.x + a.w / 2, oy + a.y + a.d / 2, oz + a.z + a.h / 2);
        final zb = proj.depth(
          ox + b.x + b.w / 2, oy + b.y + b.d / 2, oz + b.z + b.h / 2);
        return za.compareTo(zb);
      });
  }

  // ─── SHADOW BATCH ─────────────────────────────────────────────────────

  void _renderShadows(Canvas canvas, List<PlacedBox> sorted) {
    final shadowPath = Path();
    for (final b in sorted) {
      if (b.z > 15) continue; // Only ground-level shadows
      final pts = [
        proj.project(ox + b.x, oy + b.y, oz, size),
        proj.project(ox + b.x + b.w, oy + b.y, oz, size),
        proj.project(ox + b.x + b.w, oy + b.y + b.d, oz, size),
        proj.project(ox + b.x, oy + b.y + b.d, oz, size),
      ];
      shadowPath.addPolygon(pts.map((o) => Offset(o.dx, o.dy)).toList(), true);
    }
    canvas.drawPath(
      shadowPath,
      Paint()..color = Colors.black.withValues(alpha: 0.18),
    );
  }

  // ─── BOX RENDERING (with LOD) ─────────────────────────────────────────

  void _renderBox(Canvas canvas, PlacedBox b) {
    final bx = ox + b.x, by = oy + b.y, bz = oz + b.z;
    final cc = CargoColors.forBox(b, colorMode, maxWeight);
    final sel = b.id == selectedId;
    final alpha = sel ? 0.98 : 0.88;

    // Project faces
    final topPts = [
      proj.project(bx, by, bz + b.h, size),
      proj.project(bx + b.w, by, bz + b.h, size),
      proj.project(bx + b.w, by + b.d, bz + b.h, size),
      proj.project(bx, by + b.d, bz + b.h, size),
    ];
    final frontPts = [
      proj.project(bx, by, bz, size),
      proj.project(bx + b.w, by, bz, size),
      proj.project(bx + b.w, by, bz + b.h, size),
      proj.project(bx, by, bz + b.h, size),
    ];
    final rightPts = [
      proj.project(bx + b.w, by, bz, size),
      proj.project(bx + b.w, by + b.d, bz, size),
      proj.project(bx + b.w, by + b.d, bz + b.h, size),
      proj.project(bx + b.w, by, bz + b.h, size),
    ];

    // LOD: Approximate projected area
    final projArea = proj.projectedArea(b.w, b.d, b.h);

    if (projArea < 80) {
      // LOD 0: Top face only
      PolyHelper.fillFaceSolid(
          canvas, topPts, cc, Lighting3D.intensity(0, 0, 1) * 1.4, alpha * 0.8);
    } else if (projArea < 300) {
      // LOD 1: Top + front, no border
      PolyHelper.fillFaceSolid(
          canvas, topPts, cc, Lighting3D.intensity(0, 0, 1) * 1.4, alpha);
      PolyHelper.fillFaceSolid(
          canvas, frontPts, cc, Lighting3D.intensity(0, -1, 0) * 1.2, alpha);
    } else {
      // LOD 2: Full render — 3 faces + border + edge bevel + label
      PolyHelper.fillFaceSolid(
          canvas, topPts, cc, Lighting3D.intensity(0, 0, 1) * 1.4, alpha);
      PolyHelper.fillFaceSolid(
          canvas, frontPts, cc, Lighting3D.intensity(0, -1, 0) * 1.2, alpha);
      PolyHelper.fillFaceSolid(
          canvas, rightPts, cc, Lighting3D.intensity(1, 0, 0) * 1.1, alpha);

      // Edge bevel (1px lighter line on top edges)
      final bevelPaint = Paint()
        ..color = Colors.white.withValues(alpha: 0.18)
        ..strokeWidth = 0.5;
      canvas.drawLine(topPts[0], topPts[1], bevelPaint);
      canvas.drawLine(topPts[1], topPts[2], bevelPaint);

      // Wireframe borders
      final borderCol = sel
          ? Colors.white
          : Colors.white.withValues(alpha: 0.15);
      final borderWidth = sel ? 1.6 : 0.4;
      PolyHelper.strokeFace(canvas, topPts, borderCol, borderWidth);
      PolyHelper.strokeFace(canvas, frontPts, borderCol, borderWidth);
      PolyHelper.strokeFace(canvas, rightPts, borderCol, borderWidth);

      // Floating label on top face (only for large boxes)
      if (projArea > 800 && b.label.isNotEmpty) {
        _drawLabel(canvas, topPts, b.label, cc);
      }
    }

    // Selection glow
    if (sel && glow > 0.05) {
      canvas.drawPath(
        PolyHelper.pathOf(topPts),
        Paint()
          ..color = Colors.white.withValues(alpha: 0.5 * glow)
          ..strokeWidth = 2.5
          ..style = PaintingStyle.stroke,
      );
      canvas.drawPath(
        PolyHelper.pathOf(frontPts),
        Paint()
          ..color = Colors.white.withValues(alpha: 0.3 * glow)
          ..strokeWidth = 2.0
          ..style = PaintingStyle.stroke,
      );
    }
  }

  // ─── OVERFLOW BOX ─────────────────────────────────────────────────────

  void _renderOverflowBox(Canvas canvas, PlacedBox b, double bx, double by, double bz) {
    final cc = Colors.redAccent;

    final topPts = [
      proj.project(bx, by, bz + b.h, size),
      proj.project(bx + b.w, by, bz + b.h, size),
      proj.project(bx + b.w, by + b.d, bz + b.h, size),
      proj.project(bx, by + b.d, bz + b.h, size),
    ];
    final frontPts = [
      proj.project(bx, by, bz, size),
      proj.project(bx + b.w, by, bz, size),
      proj.project(bx + b.w, by, bz + b.h, size),
      proj.project(bx, by, bz + b.h, size),
    ];
    final rightPts = [
      proj.project(bx + b.w, by, bz, size),
      proj.project(bx + b.w, by + b.d, bz, size),
      proj.project(bx + b.w, by + b.d, bz + b.h, size),
      proj.project(bx + b.w, by, bz + b.h, size),
    ];

    PolyHelper.fillFaceSolid(
        canvas, topPts, cc, Lighting3D.intensity(0, 0, 1) * 1.2, 0.5);
    PolyHelper.fillFaceSolid(
        canvas, frontPts, cc, Lighting3D.intensity(0, -1, 0), 0.5);
    PolyHelper.fillFaceSolid(
        canvas, rightPts, cc, Lighting3D.intensity(1, 0, 0), 0.5);

    // Red dashed border
    PolyHelper.strokeFace(
        canvas, topPts, Colors.redAccent.withValues(alpha: 0.7), 1.0);
  }

  // ─── FLOATING LABEL ON TOP FACE ──────────────────────────────────────

  void _drawLabel(Canvas canvas, List<Offset> topPts, String label, Color boxColor) {
    // Center of top face
    final cx = (topPts[0].dx + topPts[2].dx) / 2;
    final cy = (topPts[0].dy + topPts[2].dy) / 2;

    // Truncate label
    final text = label.length > 10 ? '${label.substring(0, 9)}...' : label;

    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: Colors.white.withValues(alpha: 0.85),
          fontSize: 7.5 * proj.zoom.clamp(0.6, 1.5),
          fontWeight: FontWeight.w600,
          shadows: [
            Shadow(color: Colors.black.withValues(alpha: 0.6), blurRadius: 2),
          ],
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: 100);

    tp.paint(canvas, Offset(cx - tp.width / 2, cy - tp.height / 2));
  }

  // ─── DIMENSION LABEL ─────────────────────────────────────────────────

  void drawInfoLabel(Canvas canvas, TruckInterior interior, LoadMetrics metrics) {
    final isVan = interior.lengthCm > 0 && interior.lengthCm < 400;
    final type = isVan ? 'FURGONETA' : 'CAMION';

    final text =
        '$type (${interior.lengthCm.toInt()}x${interior.widthCm.toInt()}x${interior.heightCm.toInt()}cm) · '
        '${metrics.placedCount} bultos · ${metrics.totalWeightKg.toStringAsFixed(0)}/${metrics.maxPayloadKg.toStringAsFixed(0)} kg';

    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: Colors.white.withValues(alpha: 0.35),
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset(16, size.height - 28));
  }
}
