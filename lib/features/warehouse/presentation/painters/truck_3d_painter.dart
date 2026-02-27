/// Truck 3D Painter — Main CustomPainter orchestrator
/// Delegates to TruckBodyRenderer and CargoBoxRenderer

import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../data/warehouse_data_service.dart';
import 'projection_3d.dart';
import 'truck_body_renderer.dart';
import 'cargo_box_renderer.dart';

class TruckPainter extends CustomPainter {
  final LoadPlanResult result;
  final double rotX, rotY, zoom;
  final Offset panOffset;
  final int? selectedId;
  final double glow;
  final Color statusColor;
  final ColorMode colorMode;
  final int animatedBoxCount; // -1 = show all, 0+ = show N boxes

  TruckPainter({
    required this.result,
    required this.rotX,
    required this.rotY,
    required this.zoom,
    this.panOffset = Offset.zero,
    this.selectedId,
    required this.glow,
    required this.statusColor,
    this.colorMode = ColorMode.product,
    this.animatedBoxCount = -1,
  });

  // Cache for Z-sorting
  static List<PlacedBox>? _cachedSorted;
  static double _cachedRotX = 0, _cachedRotY = 0;
  static int _cachedLen = 0;

  @override
  void paint(Canvas canvas, Size size) {
    if (result.truck == null) return;
    final t = result.truck!;

    // Structural floor: ensure minimum paint dimensions
    final cW = math.max(t.interior.widthCm, 160.0);
    final cD = math.max(t.interior.lengthCm, 250.0);
    final cH = math.max(t.interior.heightCm, 150.0);
    final isVan = t.interior.lengthCm > 0 && t.interior.lengthCm < 400;

    final ox = -cW / 2, oy = -cD / 2, oz = -cH / 2;

    final proj = Projection3D(
      rotX: rotX, rotY: rotY, zoom: zoom, panOffset: panOffset,
    );

    // Background glow (subtle status indication)
    final glowPaint = Paint()
      ..shader = RadialGradient(
        colors: [
          statusColor.withValues(alpha: 0.04 + glow * 0.02),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCenter(
        center: Offset(size.width / 2, size.height * 0.45),
        width: size.width,
        height: size.height,
      ));
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), glowPaint);

    // ─── Truck body ─────────────────────────────────────────────────
    final bodyRenderer = TruckBodyRenderer(
      proj: proj, size: size,
      cW: cW, cD: cD, cH: cH,
      ox: ox, oy: oy, oz: oz,
      isVan: isVan,
    );
    bodyRenderer.drawAll(canvas);

    // Weight heatmap (if in heatmap mode)
    if (colorMode == ColorMode.heatmap) {
      final maxW = result.placed.isEmpty
          ? 1.0
          : result.placed.map((b) => b.weight).reduce(math.max);
      bodyRenderer.drawWeightHeatmap(canvas, result.placed, maxW);
    }

    // ─── Cargo boxes ────────────────────────────────────────────────
    final maxW = result.placed.isEmpty
        ? 1.0
        : result.placed.map((b) => b.weight).reduce(math.max);

    final boxRenderer = CargoBoxRenderer(
      proj: proj, size: size,
      ox: ox, oy: oy, oz: oz,
      colorMode: colorMode,
      maxWeight: maxW,
      selectedId: selectedId,
      glow: glow,
    );

    // Apply animation count
    final visibleBoxes = animatedBoxCount >= 0
        ? result.placed.take(animatedBoxCount).toList()
        : result.placed;

    // Z-sort with caching
    final sorted = _getSorted(visibleBoxes, proj, ox, oy, oz);
    boxRenderer.renderAll(canvas, visibleBoxes, cachedSort: sorted);

    // Overflow visualization
    if (result.overflow.isNotEmpty) {
      boxRenderer.renderOverflow(canvas, result.overflow, cD);
    }

    // Info label
    boxRenderer.drawInfoLabel(canvas, t.interior, result.metrics);
  }

  List<PlacedBox> _getSorted(
      List<PlacedBox> boxes, Projection3D proj, double ox, double oy, double oz) {
    // Cache hit check
    if (_cachedSorted != null &&
        _cachedLen == boxes.length &&
        (rotX - _cachedRotX).abs() < 0.02 &&
        (rotY - _cachedRotY).abs() < 0.02) {
      return _cachedSorted!;
    }
    _cachedSorted = List<PlacedBox>.from(boxes)
      ..sort((a, b) {
        final za = proj.depth(
            ox + a.x + a.w / 2, oy + a.y + a.d / 2, oz + a.z + a.h / 2);
        final zb = proj.depth(
            ox + b.x + b.w / 2, oy + b.y + b.d / 2, oz + b.z + b.h / 2);
        return za.compareTo(zb);
      });
    _cachedRotX = rotX;
    _cachedRotY = rotY;
    _cachedLen = boxes.length;
    return _cachedSorted!;
  }

  @override
  bool shouldRepaint(covariant TruckPainter old) =>
      old.rotX != rotX ||
      old.rotY != rotY ||
      old.zoom != zoom ||
      old.panOffset != panOffset ||
      old.selectedId != selectedId ||
      old.colorMode != colorMode ||
      old.animatedBoxCount != animatedBoxCount ||
      (selectedId != null &&
          (old.glow * 10).round() != (glow * 10).round());
}
