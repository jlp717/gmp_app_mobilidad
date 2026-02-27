/// Truck 3D Painter v2 — Main CustomPainter orchestrator
/// Performance: throttled repaints, cached z-sort, image caching for truck body
/// Delegates to TruckBodyRenderer v2 and CargoBoxRenderer v2

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

  // Cache for Z-sorting — avoid re-sorting when rotation hasn't changed significantly
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
          statusColor.withValues(alpha: 0.03 + glow * 0.015),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCenter(
        center: Offset(size.width / 2, size.height * 0.45),
        width: size.width,
        height: size.height,
      ));
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), glowPaint);

    // ─── Truck body (premium design) ──────────────────────────────
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

    // ─── Cargo boxes (premium rendering) ─────────────────────────
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

    // Z-sort with caching (only recalculate on significant rotation change)
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
    // Cache hit check — only re-sort if rotation changed by > 3°
    if (_cachedSorted != null &&
        _cachedLen == boxes.length &&
        (rotX - _cachedRotX).abs() < 0.05 &&
        (rotY - _cachedRotY).abs() < 0.05) {
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

// ═══════════════════════════════════════════════════════════════════════════════
// TOP VIEW PAINTER — Bird's eye for clarity
// ═══════════════════════════════════════════════════════════════════════════════

class TopViewPainter extends CustomPainter {
  final LoadPlanResult result;
  final int? selectedId;
  final ColorMode colorMode;

  TopViewPainter({
    required this.result,
    this.selectedId,
    this.colorMode = ColorMode.product,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (result.truck == null) return;
    final t = result.truck!;
    final cW = math.max(t.interior.widthCm, 160.0);
    final cD = math.max(t.interior.lengthCm, 250.0);

    // Calculate scale to fit in canvas with padding
    final pad = 40.0;
    final scaleX = (size.width - pad * 2) / cW;
    final scaleY = (size.height - pad * 2) / cD;
    final scale = math.min(scaleX, scaleY);
    final offsetX = (size.width - cW * scale) / 2;
    final offsetY = (size.height - cD * scale) / 2;

    Offset toScreen(double x, double y) =>
        Offset(offsetX + x * scale, offsetY + y * scale);

    // Container outline
    final containerRect = Rect.fromLTWH(offsetX, offsetY, cW * scale, cD * scale);
    canvas.drawRect(
      containerRect,
      Paint()
        ..color = const Color(0xFF1A202C)
        ..style = PaintingStyle.fill,
    );
    canvas.drawRect(
      containerRect,
      Paint()
        ..color = const Color(0xFF4A5568)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    );

    // Grid
    final gridPaint = Paint()
      ..color = const Color(0x15FFFFFF)
      ..strokeWidth = 0.5;
    for (double x = 0; x <= cW; x += 50) {
      final p1 = toScreen(x, 0);
      final p2 = toScreen(x, cD);
      canvas.drawLine(p1, p2, gridPaint);
    }
    for (double y = 0; y <= cD; y += 50) {
      final p1 = toScreen(0, y);
      final p2 = toScreen(cW, y);
      canvas.drawLine(p1, p2, gridPaint);
    }

    // Draw boxes
    final maxW = result.placed.isEmpty
        ? 1.0
        : result.placed.map((b) => b.weight).reduce(math.max);

    for (final b in result.placed) {
      final color = CargoColors.forBox(b, colorMode, maxW);
      final isSelected = b.id == selectedId;
      final rect = Rect.fromLTWH(
        offsetX + b.x * scale,
        offsetY + b.y * scale,
        b.w * scale,
        b.d * scale,
      );

      // Fill
      canvas.drawRect(rect, Paint()..color = color.withValues(alpha: 0.85));

      // Border
      canvas.drawRect(
        rect,
        Paint()
          ..color = isSelected ? Colors.white : Colors.white.withValues(alpha: 0.3)
          ..style = PaintingStyle.stroke
          ..strokeWidth = isSelected ? 2.5 : 0.8,
      );

      // Label (if box is big enough)
      if (rect.width > 25 && rect.height > 15) {
        final labelText = b.articleCode.length > 6
            ? b.articleCode.substring(0, 6)
            : b.articleCode;
        final luminance = color.computeLuminance();
        final textColor = luminance > 0.45 ? const Color(0xFF1A1A2E) : Colors.white;
        
        final tp = TextPainter(
          text: TextSpan(
            text: labelText,
            style: TextStyle(
              color: textColor,
              fontSize: math.min(rect.height * 0.4, 10).toDouble(),
              fontWeight: FontWeight.bold,
            ),
          ),
          textDirection: TextDirection.ltr,
        )..layout(maxWidth: rect.width - 4);
        tp.paint(canvas, Offset(
          rect.center.dx - tp.width / 2,
          rect.center.dy - tp.height / 2,
        ));
      }
    }

    // Cab indicator
    final cabY = cD * scale + offsetY;
    final cabRect = RRect.fromRectAndRadius(
      Rect.fromLTWH(offsetX - 5, cabY, cW * scale + 10, 35),
      const Radius.circular(8),
    );
    canvas.drawRRect(cabRect, Paint()..color = const Color(0xFF1E40AF).withValues(alpha: 0.7));
    canvas.drawRRect(
      cabRect,
      Paint()
        ..color = const Color(0xFF60A5FA).withValues(alpha: 0.4)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    
    // "CABINA" label
    final cabTp = TextPainter(
      text: const TextSpan(
        text: 'CABINA',
        style: TextStyle(
          color: Color(0xAAFFFFFF),
          fontSize: 9,
          fontWeight: FontWeight.w600,
          letterSpacing: 2,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    cabTp.paint(canvas, Offset(
      offsetX + cW * scale / 2 - cabTp.width / 2,
      cabY + 12,
    ));

    // Dimensions
    final dimStyle = const TextStyle(
      color: Color(0xAAFFFFFF),
      fontSize: 9,
      fontWeight: FontWeight.w500,
    );
    // Width
    final wTp = TextPainter(
      text: TextSpan(text: '${cW.round()} cm', style: dimStyle),
      textDirection: TextDirection.ltr,
    )..layout();
    wTp.paint(canvas, Offset(
      offsetX + cW * scale / 2 - wTp.width / 2,
      offsetY - 15,
    ));
    // Depth
    final dTp = TextPainter(
      text: TextSpan(text: '${cD.round()} cm', style: dimStyle),
      textDirection: TextDirection.ltr,
    )..layout();
    
    canvas.save();
    canvas.translate(offsetX - 15, offsetY + cD * scale / 2 + dTp.width / 2);
    canvas.rotate(-math.pi / 2);
    dTp.paint(canvas, Offset.zero);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant TopViewPainter old) =>
      old.selectedId != selectedId || old.colorMode != colorMode;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRONT VIEW PAINTER — Cross-section showing stacking
// ═══════════════════════════════════════════════════════════════════════════════

class FrontViewPainter extends CustomPainter {
  final LoadPlanResult result;
  final int? selectedId;
  final ColorMode colorMode;

  FrontViewPainter({
    required this.result,
    this.selectedId,
    this.colorMode = ColorMode.product,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (result.truck == null) return;
    final t = result.truck!;
    final cW = math.max(t.interior.widthCm, 160.0);
    final cH = math.max(t.interior.heightCm, 150.0);

    final pad = 40.0;
    final scaleX = (size.width - pad * 2) / cW;
    final scaleY = (size.height - pad * 2) / cH;
    final scale = math.min(scaleX, scaleY);
    final offsetX = (size.width - cW * scale) / 2;
    final offsetY = size.height - pad - cH * scale; // Bottom-aligned

    Offset toScreen(double x, double z) =>
        Offset(offsetX + x * scale, offsetY + (cH - z) * scale);

    // Container outline
    final containerRect = Rect.fromLTWH(
      offsetX, offsetY, cW * scale, cH * scale,
    );
    canvas.drawRect(containerRect, Paint()..color = const Color(0xFF1A202C));
    canvas.drawRect(
      containerRect,
      Paint()
        ..color = const Color(0xFF4A5568)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    );

    // Grid
    final gridPaint = Paint()..color = const Color(0x15FFFFFF)..strokeWidth = 0.5;
    for (double x = 0; x <= cW; x += 50) {
      canvas.drawLine(toScreen(x, 0), toScreen(x, cH), gridPaint);
    }
    for (double z = 0; z <= cH; z += 50) {
      canvas.drawLine(toScreen(0, z), toScreen(cW, z), gridPaint);
    }

    // Draw boxes (front cross-section — project onto X-Z plane)
    final maxW = result.placed.isEmpty
        ? 1.0
        : result.placed.map((b) => b.weight).reduce(math.max);

    // Sort by depth (back-to-front for overlap)
    final sorted = List<PlacedBox>.from(result.placed)
      ..sort((a, b) => b.y.compareTo(a.y));

    for (final b in sorted) {
      final color = CargoColors.forBox(b, colorMode, maxW);
      final isSelected = b.id == selectedId;
      final topLeft = toScreen(b.x, b.z + b.h);
      final botRight = toScreen(b.x + b.w, b.z);
      final rect = Rect.fromPoints(topLeft, botRight);

      // Fill with slight transparency for depth
      final depthAlpha = 0.4 + (b.y / (t.interior.lengthCm > 0 ? t.interior.lengthCm : 1)) * 0.5;
      canvas.drawRect(rect, Paint()..color = color.withValues(alpha: depthAlpha.clamp(0.4, 0.9)));
      canvas.drawRect(
        rect,
        Paint()
          ..color = isSelected ? Colors.white : Colors.white.withValues(alpha: 0.2)
          ..style = PaintingStyle.stroke
          ..strokeWidth = isSelected ? 2 : 0.5,
      );

      // Label
      if (rect.width > 20 && rect.height > 12) {
        final label = b.articleCode.length > 5
            ? b.articleCode.substring(0, 5)
            : b.articleCode;
        final luminance = color.computeLuminance();
        final textColor = luminance > 0.45 ? const Color(0xFF1A1A2E) : Colors.white;
        final tp = TextPainter(
          text: TextSpan(
            text: label,
            style: TextStyle(color: textColor, fontSize: math.min(rect.height * 0.35, 9).toDouble(), fontWeight: FontWeight.bold),
          ),
          textDirection: TextDirection.ltr,
        )..layout(maxWidth: rect.width - 2);
        tp.paint(canvas, Offset(rect.center.dx - tp.width / 2, rect.center.dy - tp.height / 2));
      }
    }

    // Weight center indicator
    if (result.placed.isNotEmpty) {
      double totalWeight = 0, weightX = 0, weightZ = 0;
      for (final b in result.placed) {
        totalWeight += b.weight;
        weightX += (b.x + b.w / 2) * b.weight;
        weightZ += (b.z + b.h / 2) * b.weight;
      }
      if (totalWeight > 0) {
        final cogScreen = toScreen(weightX / totalWeight, weightZ / totalWeight);
        // CoG marker
        canvas.drawCircle(cogScreen, 6, Paint()..color = const Color(0xFFFF6B6B));
        canvas.drawCircle(
          cogScreen, 6,
          Paint()
            ..color = Colors.white
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.5,
        );
        // Label
        final cogTp = TextPainter(
          text: const TextSpan(
            text: 'CdG',
            style: TextStyle(color: Color(0xFFFF6B6B), fontSize: 8, fontWeight: FontWeight.bold),
          ),
          textDirection: TextDirection.ltr,
        )..layout();
        cogTp.paint(canvas, Offset(cogScreen.dx - cogTp.width / 2, cogScreen.dy + 10));
      }
    }

    // Dimensions
    final dimStyle = const TextStyle(color: Color(0xAAFFFFFF), fontSize: 9, fontWeight: FontWeight.w500);
    final wTp = TextPainter(
      text: TextSpan(text: '${cW.round()} cm', style: dimStyle),
      textDirection: TextDirection.ltr,
    )..layout();
    wTp.paint(canvas, Offset(
      offsetX + cW * scale / 2 - wTp.width / 2,
      offsetY + cH * scale + 8,
    ));
    
    final hTp = TextPainter(
      text: TextSpan(text: '${cH.round()} cm', style: dimStyle),
      textDirection: TextDirection.ltr,
    )..layout();
    canvas.save();
    canvas.translate(offsetX - 15, offsetY + cH * scale / 2 + hTp.width / 2);
    canvas.rotate(-math.pi / 2);
    hTp.paint(canvas, Offset.zero);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant FrontViewPainter old) =>
      old.selectedId != selectedId || old.colorMode != colorMode;
}
