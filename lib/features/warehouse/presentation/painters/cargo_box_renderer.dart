/// Cargo Box Renderer v2 — Premium design with clear product distinction
/// Features:
/// - Gradient-lit faces (top bright → bottom dark)
/// - Large, readable product labels with pill backgrounds
/// - Selection glow with neon outline
/// - LOD: simplified rendering at low zoom
/// - Viewport culling: skip boxes off-screen
/// - Soft shadows between boxes
/// - Weight badge on each box

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
    this.glow = 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MAIN RENDER — Z-sorted, LOD-aware, culled
  // ═══════════════════════════════════════════════════════════════════════

  /// Render all placed boxes with Z-sorting, shadows, and labels.
  void renderAll(Canvas canvas, List<PlacedBox> placed,
      {List<PlacedBox>? cachedSort}) {
    if (placed.isEmpty) return;

    final sorted = cachedSort ?? _zSort(placed);

    // Draw shadows first (below all boxes)
    _renderShadows(canvas, sorted);

    // Draw boxes back-to-front
    for (final b in sorted) {
      _renderBox(canvas, b);
    }
  }

  /// Render overflow boxes outside the truck boundary
  void renderOverflow(
      Canvas canvas, List<PlacedBox> overflow, double containerDepth) {
    if (overflow.isEmpty) return;

    // Overflow label
    final labelPos = proj.project(ox, oy - 30, oz + 30, size);
    _drawText(
      canvas,
      labelPos,
      '⚠ ${overflow.length} cajas sin espacio',
      const TextStyle(
        color: Color(0xFFFF6B6B),
        fontSize: 11,
        fontWeight: FontWeight.bold,
      ),
      bgColor: const Color(0xCC1A1A2E),
    );

    // Render overflow boxes at the front, slightly offset
    for (int i = 0; i < overflow.length; i++) {
      final b = overflow[i];
      final bx = ox + b.x;
      final by = oy - 40 - (i * 5); // Stack in front
      final bz = oz + b.z;
      _renderOverflowBox(canvas, b, bx, by, bz);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Z-SORTING
  // ═══════════════════════════════════════════════════════════════════════

  List<PlacedBox> _zSort(List<PlacedBox> boxes) {
    return List<PlacedBox>.from(boxes)
      ..sort((a, b) {
        final za =
            proj.depth(ox + a.x + a.w / 2, oy + a.y + a.d / 2, oz + a.z + a.h / 2);
        final zb =
            proj.depth(ox + b.x + b.w / 2, oy + b.y + b.d / 2, oz + b.z + b.h / 2);
        return za.compareTo(zb);
      });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SHADOWS — Soft floor shadows
  // ═══════════════════════════════════════════════════════════════════════

  void _renderShadows(Canvas canvas, List<PlacedBox> sorted) {
    final shadowPaint = Paint()
      ..color = const Color(0x18000000)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4);

    for (final b in sorted) {
      // Only ground-level boxes cast floor shadows
      if (b.z > 1) continue;
      final pts = [
        proj.project(ox + b.x + 2, oy + b.y + 2, oz, size),
        proj.project(ox + b.x + b.w + 2, oy + b.y + 2, oz, size),
        proj.project(ox + b.x + b.w + 2, oy + b.y + b.d + 2, oz, size),
        proj.project(ox + b.x + 2, oy + b.y + b.d + 2, oz, size),
      ];
      canvas.drawPath(PolyHelper.pathOf(pts), shadowPaint);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SINGLE BOX — Premium rendering with gradient, label, and edge detail
  // ═══════════════════════════════════════════════════════════════════════

  void _renderBox(Canvas canvas, PlacedBox b) {
    final bx = ox + b.x, by = oy + b.y, bz = oz + b.z;
    final color = CargoColors.forBox(b, colorMode, maxWeight);
    final isSelected = b.id == selectedId;
    final alpha = isSelected ? 1.0 : 0.92;

    // Get all 8 corners
    final corners = proj.projectBox(bx, by, bz, b.w, b.d, b.h, size);

    // Viewport culling — skip if entirely off-screen
    if (!proj.isBoxVisible(corners, size)) return;

    // Determine projected area for LOD
    final screenArea = _approxScreenArea(corners);
    final isSmall = screenArea < 600;  // Small box at this zoom level
    final isTiny = screenArea < 150;   // Very small — minimal detail

    // ─── Face rendering ──────────────────────────────────────────────

    // Top face: corners [4,5,7,6] — Brightest
    final topPts = [corners[4], corners[5], corners[7], corners[6]];
    final topColorBright = Lighting3D.applyLight(color, 1.1, alpha);
    final topColorDark = Lighting3D.applyLight(color, 0.95, alpha);
    PolyHelper.fillFaceGradient(canvas, topPts, topColorBright, topColorDark);

    // Front face: corners [0,1,5,4] — Medium
    final frontPts = [corners[0], corners[1], corners[5], corners[4]];
    final frontTop = Lighting3D.applyLight(color, 0.8, alpha);
    final frontBot = Lighting3D.applyLight(color, 0.6, alpha);
    PolyHelper.fillFaceGradient(canvas, frontPts, frontTop, frontBot);

    // Right face: corners [1,3,7,5] — Darker
    final rightPts = [corners[1], corners[3], corners[7], corners[5]];
    final rightTop = Lighting3D.applyLight(color, 0.65, alpha);
    final rightBot = Lighting3D.applyLight(color, 0.45, alpha);
    PolyHelper.fillFaceGradient(canvas, rightPts, rightTop, rightBot);

    // Left face: corners [0,2,6,4] — Even darker (sometimes visible)
    final leftPts = [corners[0], corners[2], corners[6], corners[4]];
    PolyHelper.fillFaceSolid(canvas, leftPts, color, 0.5, alpha * 0.7);

    // Back face: corners [2,3,7,6] — Darkest
    final backPts = [corners[2], corners[3], corners[7], corners[6]];
    PolyHelper.fillFaceSolid(canvas, backPts, color, 0.35, alpha * 0.5);

    // ─── Edge lines ─────────────────────────────────────────────────

    if (!isTiny) {
      final edgeColor = isSelected
          ? Colors.white.withValues(alpha: 0.8)
          : Colors.white.withValues(alpha: 0.25);
      final edgeWidth = isSelected ? 2.0 : 0.8;

      // Top face edges (most visible)
      PolyHelper.strokeFace(canvas, topPts, edgeColor, edgeWidth);
      // Front face edges
      PolyHelper.strokeFace(canvas, frontPts, edgeColor, edgeWidth * 0.8);
      // Right face edges
      PolyHelper.strokeFace(canvas, rightPts, edgeColor, edgeWidth * 0.7);
    }

    // ─── Selection glow ─────────────────────────────────────────────

    if (isSelected) {
      final glowAlpha = 0.3 + glow * 0.15;
      final glowColor = color.withValues(alpha: glowAlpha);
      
      // Outer glow on top face
      final glowPaint = Paint()
        ..color = glowColor
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4;
      canvas.drawPath(PolyHelper.pathOf(topPts), glowPaint);
      canvas.drawPath(PolyHelper.pathOf(frontPts), glowPaint);
    }

    // ─── Labels (only for non-tiny boxes) ────────────────────────────

    if (!isTiny) {
      _drawBoxLabel(canvas, topPts, b, color, isSmall);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BOX LABEL — Product name + weight badge
  // ═══════════════════════════════════════════════════════════════════════

  void _drawBoxLabel(Canvas canvas, List<Offset> topPts, PlacedBox b,
      Color boxColor, bool isSmall) {
    // Center of top face
    final cx =
        (topPts[0].dx + topPts[1].dx + topPts[2].dx + topPts[3].dx) / 4;
    final cy =
        (topPts[0].dy + topPts[1].dy + topPts[2].dy + topPts[3].dy) / 4;
    final center = Offset(cx, cy);

    // Determine available width based on face size
    final faceWidth = (topPts[1] - topPts[0]).distance;
    if (faceWidth < 20) return; // Too small for labels

    // Article code (main label)
    final labelText = b.articleCode.length > 8
        ? b.articleCode.substring(0, 8)
        : b.articleCode;
    
    final fontSize = isSmall ? 8.0 : 10.0;
    final isSelected = b.id == selectedId;

    // Draw label with pill background
    _drawPillLabel(
      canvas,
      Offset(center.dx, center.dy - (isSmall ? 0 : 5)),
      labelText,
      TextStyle(
        color: _textColorForBg(boxColor),
        fontSize: fontSize,
        fontWeight: FontWeight.bold,
        letterSpacing: 0.3,
      ),
      bgColor: boxColor.withValues(alpha: 0.85),
      borderColor: isSelected ? Colors.white : null,
    );

    // Weight badge (only for larger boxes)
    if (!isSmall) {
      final weightText = b.weight < 1
          ? '${(b.weight * 1000).round()}g'
          : '${b.weight.toStringAsFixed(1)}kg';
      _drawPillLabel(
        canvas,
        Offset(center.dx, center.dy + 10),
        weightText,
        const TextStyle(
          color: Colors.white,
          fontSize: 7,
          fontWeight: FontWeight.w500,
        ),
        bgColor: const Color(0xAA000000),
      );
    }
  }

  /// Draw text inside a rounded pill background
  void _drawPillLabel(
    Canvas canvas,
    Offset center,
    String text,
    TextStyle style, {
    Color bgColor = const Color(0xCC000000),
    Color? borderColor,
  }) {
    final tp = TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: TextDirection.ltr,
    )..layout();

    final padH = 6.0, padV = 3.0;
    final rect = RRect.fromRectAndRadius(
      Rect.fromCenter(
        center: center,
        width: tp.width + padH * 2,
        height: tp.height + padV * 2,
      ),
      const Radius.circular(6),
    );

    // Background
    canvas.drawRRect(rect, Paint()..color = bgColor);
    
    // Border (for selected items)
    if (borderColor != null) {
      canvas.drawRRect(
        rect,
        Paint()
          ..color = borderColor
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
    }

    // Text
    tp.paint(
      canvas,
      Offset(center.dx - tp.width / 2, center.dy - tp.height / 2),
    );
  }

  /// Choose white or dark text based on background brightness
  Color _textColorForBg(Color bg) {
    final luminance = bg.computeLuminance();
    return luminance > 0.45 ? const Color(0xFF1A1A2E) : Colors.white;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // OVERFLOW BOX — Red-tinted, dashed outline
  // ═══════════════════════════════════════════════════════════════════════

  void _renderOverflowBox(
      Canvas canvas, PlacedBox b, double bx, double by, double bz) {
    final color = const Color(0xFFFF6B6B);
    final corners = proj.projectBox(bx, by, bz, b.w, b.d, b.h, size);

    // Top
    final topPts = [corners[4], corners[5], corners[7], corners[6]];
    PolyHelper.fillFaceSolid(canvas, topPts, color, 0.8, 0.5);

    // Front
    final frontPts = [corners[0], corners[1], corners[5], corners[4]];
    PolyHelper.fillFaceSolid(canvas, frontPts, color, 0.6, 0.4);

    // Right
    final rightPts = [corners[1], corners[3], corners[7], corners[5]];
    PolyHelper.fillFaceSolid(canvas, rightPts, color, 0.45, 0.4);

    // Dashed outline
    final dashPaint = Paint()
      ..color = const Color(0xFFFF4444)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;
    PolyHelper.strokeFace(canvas, topPts, const Color(0xFFFF4444), 1.5);
    
    // Label
    _drawBoxLabel(canvas, topPts, b, color, true);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INFO LABEL — Load metrics overlay
  // ═══════════════════════════════════════════════════════════════════════

  void drawInfoLabel(
      Canvas canvas, TruckInterior interior, LoadMetrics metrics) {
    // Position at top-right area
    final pos = Offset(size.width - 10, 10);

    final lines = [
      '📦 ${metrics.placedCount}/${metrics.totalBoxes} cajas',
      '📊 Vol: ${metrics.volumeOccupancyPct.toStringAsFixed(1)}%',
      '⚖️ Peso: ${metrics.totalWeightKg.toStringAsFixed(0)}/${metrics.maxPayloadKg.toStringAsFixed(0)} kg',
    ];

    double yOffset = pos.dy;
    for (final line in lines) {
      final tp = TextPainter(
        text: TextSpan(
          text: line,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.w500,
            height: 1.3,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();

      // Background pill
      final rect = RRect.fromRectAndRadius(
        Rect.fromLTWH(pos.dx - tp.width - 16, yOffset, tp.width + 16, tp.height + 8),
        const Radius.circular(6),
      );
      canvas.drawRRect(rect, Paint()..color = const Color(0xCC1A202C));

      tp.paint(canvas, Offset(pos.dx - tp.width - 8, yOffset + 4));
      yOffset += tp.height + 14;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  /// Approximate screen area of a projected box (for LOD decisions)
  double _approxScreenArea(List<Offset> corners) {
    if (corners.length < 4) return 0;
    // Use cross product of two edges of the top face
    final a = corners[5] - corners[4]; // front-top edge
    final b = corners[6] - corners[4]; // left-top edge
    return (a.dx * b.dy - a.dy * b.dx).abs();
  }

  /// Draw text at a position
  void _drawText(Canvas canvas, Offset pos, String text, TextStyle style,
      {Color? bgColor}) {
    final tp = TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: TextDirection.ltr,
    )..layout();

    if (bgColor != null) {
      final rect = RRect.fromRectAndRadius(
        Rect.fromCenter(
          center: pos,
          width: tp.width + 16,
          height: tp.height + 10,
        ),
        const Radius.circular(8),
      );
      canvas.drawRRect(rect, Paint()..color = bgColor);
    }

    tp.paint(canvas, Offset(pos.dx - tp.width / 2, pos.dy - tp.height / 2));
  }
}
