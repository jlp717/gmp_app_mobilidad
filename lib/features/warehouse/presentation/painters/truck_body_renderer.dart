/// Truck Body Renderer v2 — Premium visual design
/// Features:
/// - Metallic cab with windshield reflections
/// - Translucent container walls (see cargo inside)
/// - Floor grid for scale reference
/// - Dimension arrows with real measurements
/// - Dynamic shadows, gradient lighting
/// - Van vs Truck parametric morphing

import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../data/warehouse_data_service.dart';
import 'projection_3d.dart';

class TruckBodyRenderer {
  final Projection3D proj;
  final Size size;
  final double cW, cD, cH; // Container dims in cm
  final double ox, oy, oz; // Origin offsets
  final bool isVan;

  TruckBodyRenderer({
    required this.proj,
    required this.size,
    required this.cW,
    required this.cD,
    required this.cH,
    required this.ox,
    required this.oy,
    required this.oz,
    required this.isVan,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // COLORS — Premium metallic palette
  // ═══════════════════════════════════════════════════════════════════════
  
  // Container
  static const Color _containerBase = Color(0xFF2D3748);
  static const Color _containerFrame = Color(0xFF4A5568);
  static const Color _containerFloor = Color(0xFF1A202C);
  static const Color _containerWallAlpha = Color(0x30718096); // Translucent
  
  // Cab
  static const Color _cabPrimary = Color(0xFF1E40AF);    // Deep blue
  static const Color _cabSecondary = Color(0xFF2563EB);   // Lighter blue
  static const Color _cabAccent = Color(0xFF60A5FA);      // Bright accent
  static const Color _windshield = Color(0xFF38BDF8);     // Glass blue
  static const Color _headlight = Color(0xFFFDE68A);      // Warm yellow
  static const Color _chrome = Color(0xFFE2E8F0);         // Chrome silver
  
  // Environment
  static const Color _groundShadow = Color(0x20000000);
  static const Color _gridLine = Color(0x25FFFFFF);
  static const Color _gridLineAccent = Color(0x40FFFFFF);
  static const Color _measureLine = Color(0x60FFFFFF);

  void drawAll(Canvas canvas) {
    _drawGroundShadow(canvas);
    _drawContainerFloor(canvas);
    _drawFloorGrid(canvas);
    _drawContainerWalls(canvas);
    _drawContainerFrame(canvas);
    _drawDimensionArrows(canvas);
    
    if (isVan) {
      _drawVanCab(canvas);
    } else {
      _drawTruckCab(canvas);
    }
    _drawWheels(canvas);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GROUND SHADOW — Soft, realistic ground plane
  // ═══════════════════════════════════════════════════════════════════════

  void _drawGroundShadow(Canvas canvas) {
    // Soft elliptical shadow under the truck
    final center = proj.project(0, cD * 0.3, oz, size);
    final rx = cD * 0.5 * proj.zoom * 0.4;
    final ry = rx * 0.3;
    
    final shadowPaint = Paint()
      ..shader = RadialGradient(
        colors: [
          _groundShadow,
          _groundShadow.withValues(alpha: 0.05),
          Colors.transparent,
        ],
        stops: const [0.0, 0.6, 1.0],
      ).createShader(Rect.fromCenter(center: center, width: rx * 2, height: ry * 2));
    
    canvas.drawOval(
      Rect.fromCenter(center: center, width: rx * 2, height: ry * 2),
      shadowPaint,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONTAINER FLOOR — Solid, dark floor with subtle texture
  // ═══════════════════════════════════════════════════════════════════════

  void _drawContainerFloor(Canvas canvas) {
    final pts = [
      proj.project(ox, oy, oz, size),
      proj.project(ox + cW, oy, oz, size),
      proj.project(ox + cW, oy + cD, oz, size),
      proj.project(ox, oy + cD, oz, size),
    ];
    
    // Solid dark floor
    PolyHelper.fillFaceSolid(canvas, pts, _containerFloor, 0.9, 1.0);
    
    // Subtle border
    PolyHelper.strokeFace(canvas, pts, _containerFrame.withValues(alpha: 0.4), 1.5);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FLOOR GRID — Scale reference lines every 50cm
  // ═══════════════════════════════════════════════════════════════════════

  void _drawFloorGrid(Canvas canvas) {
    final gridSpacing = 50.0; // 50cm grid
    final gridPaint = Paint()
      ..color = _gridLine
      ..strokeWidth = 0.5
      ..style = PaintingStyle.stroke;
    final accentPaint = Paint()
      ..color = _gridLineAccent
      ..strokeWidth = 1.0
      ..style = PaintingStyle.stroke;

    // Width lines (X axis)
    for (double x = 0; x <= cW; x += gridSpacing) {
      final isAccent = (x % 100).abs() < 1;
      final p1 = proj.project(ox + x, oy, oz, size);
      final p2 = proj.project(ox + x, oy + cD, oz, size);
      canvas.drawLine(p1, p2, isAccent ? accentPaint : gridPaint);
    }
    
    // Depth lines (Y axis)
    for (double y = 0; y <= cD; y += gridSpacing) {
      final isAccent = (y % 100).abs() < 1;
      final p1 = proj.project(ox, oy + y, oz, size);
      final p2 = proj.project(ox + cW, oy + y, oz, size);
      canvas.drawLine(p1, p2, isAccent ? accentPaint : gridPaint);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONTAINER WALLS — Translucent with frame edges
  // ═══════════════════════════════════════════════════════════════════════

  void _drawContainerWalls(Canvas canvas) {
    // Left wall (translucent)
    final leftPts = [
      proj.project(ox, oy, oz, size),
      proj.project(ox, oy + cD, oz, size),
      proj.project(ox, oy + cD, oz + cH, size),
      proj.project(ox, oy, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, leftPts, _containerBase, Lighting3D.leftLight, 0.25);
    
    // Right wall (translucent)
    final rightPts = [
      proj.project(ox + cW, oy, oz, size),
      proj.project(ox + cW, oy + cD, oz, size),
      proj.project(ox + cW, oy + cD, oz + cH, size),
      proj.project(ox + cW, oy, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, rightPts, _containerBase, Lighting3D.rightLight, 0.25);
    
    // Back wall (slightly more opaque)
    final backPts = [
      proj.project(ox, oy + cD, oz, size),
      proj.project(ox + cW, oy + cD, oz, size),
      proj.project(ox + cW, oy + cD, oz + cH, size),
      proj.project(ox, oy + cD, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, backPts, _containerBase, Lighting3D.backLight, 0.35);
    
    // Roof (very translucent)
    final roofPts = [
      proj.project(ox, oy, oz + cH, size),
      proj.project(ox + cW, oy, oz + cH, size),
      proj.project(ox + cW, oy + cD, oz + cH, size),
      proj.project(ox, oy + cD, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, roofPts, _containerBase, Lighting3D.topLight, 0.12);
    
    // Open rear doors effect — no front wall, just door frame hints
    _drawDoorFrame(canvas);
  }

  void _drawDoorFrame(Canvas canvas) {
    // Left door frame
    final doorPaint = Paint()
      ..color = _containerFrame.withValues(alpha: 0.6)
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke;
    
    // Front opening with door frame hints
    final fl = proj.project(ox, oy, oz, size);
    final fr = proj.project(ox + cW, oy, oz, size);
    final tl = proj.project(ox, oy, oz + cH, size);
    final tr = proj.project(ox + cW, oy, oz + cH, size);
    
    // Draw door frame lines
    canvas.drawLine(fl, tl, doorPaint);
    canvas.drawLine(fr, tr, doorPaint);
    canvas.drawLine(tl, tr, doorPaint);
    canvas.drawLine(fl, fr, doorPaint);
    
    // Door hinge details
    final hingePaint = Paint()
      ..color = _chrome.withValues(alpha: 0.5)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    
    // Left door hinges (3 small dashes)
    for (final frac in [0.2, 0.5, 0.8]) {
      final hp = Offset.lerp(fl, tl, frac)!;
      final dx = (tl.dx - fl.dx).abs() > 2 ? 4.0 : 2.0;
      canvas.drawLine(hp, Offset(hp.dx - dx, hp.dy), hingePaint);
    }
    // Right door hinges
    for (final frac in [0.2, 0.5, 0.8]) {
      final hp = Offset.lerp(fr, tr, frac)!;
      final dx = (tr.dx - fr.dx).abs() > 2 ? 4.0 : 2.0;
      canvas.drawLine(hp, Offset(hp.dx + dx, hp.dy), hingePaint);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONTAINER FRAME — Structural edges
  // ═══════════════════════════════════════════════════════════════════════

  void _drawContainerFrame(Canvas canvas) {
    final framePaint = Paint()
      ..color = _containerFrame
      ..strokeWidth = 2.0
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    // Bottom edges
    _drawEdge(canvas, ox, oy, oz, ox + cW, oy, oz, framePaint);
    _drawEdge(canvas, ox, oy + cD, oz, ox + cW, oy + cD, oz, framePaint);
    _drawEdge(canvas, ox, oy, oz, ox, oy + cD, oz, framePaint);
    _drawEdge(canvas, ox + cW, oy, oz, ox + cW, oy + cD, oz, framePaint);
    
    // Top edges
    _drawEdge(canvas, ox, oy, oz + cH, ox + cW, oy, oz + cH, framePaint);
    _drawEdge(canvas, ox, oy + cD, oz + cH, ox + cW, oy + cD, oz + cH, framePaint);
    _drawEdge(canvas, ox, oy, oz + cH, ox, oy + cD, oz + cH, framePaint);
    _drawEdge(canvas, ox + cW, oy, oz + cH, ox + cW, oy + cD, oz + cH, framePaint);
    
    // Vertical edges
    _drawEdge(canvas, ox, oy, oz, ox, oy, oz + cH, framePaint);
    _drawEdge(canvas, ox + cW, oy, oz, ox + cW, oy, oz + cH, framePaint);
    _drawEdge(canvas, ox, oy + cD, oz, ox, oy + cD, oz + cH, framePaint);
    _drawEdge(canvas, ox + cW, oy + cD, oz, ox + cW, oy + cD, oz + cH, framePaint);
  }

  void _drawEdge(Canvas canvas, double x1, double y1, double z1, 
                  double x2, double y2, double z2, Paint paint) {
    canvas.drawLine(
      proj.project(x1, y1, z1, size),
      proj.project(x2, y2, z2, size),
      paint,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DIMENSION ARROWS — Real measurements on container edges
  // ═══════════════════════════════════════════════════════════════════════

  void _drawDimensionArrows(Canvas canvas) {
    final offset = 15.0; // Offset from container edge
    final arrowPaint = Paint()
      ..color = _measureLine
      ..strokeWidth = 1.0
      ..style = PaintingStyle.stroke;
    
    // Width arrow (bottom front)
    final wl = proj.project(ox, oy - offset, oz, size);
    final wr = proj.project(ox + cW, oy - offset, oz, size);
    canvas.drawLine(wl, wr, arrowPaint);
    _drawArrowHead(canvas, wl, wr, arrowPaint);
    _drawArrowHead(canvas, wr, wl, arrowPaint);
    _drawDimensionLabel(canvas, Offset.lerp(wl, wr, 0.5)!, '${cW.round()} cm');
    
    // Depth arrow (bottom left)
    final dl = proj.project(ox - offset, oy, oz, size);
    final dr = proj.project(ox - offset, oy + cD, oz, size);
    canvas.drawLine(dl, dr, arrowPaint);
    _drawArrowHead(canvas, dl, dr, arrowPaint);
    _drawArrowHead(canvas, dr, dl, arrowPaint);
    _drawDimensionLabel(canvas, Offset.lerp(dl, dr, 0.5)!, '${cD.round()} cm');
    
    // Height arrow (front left)
    final hl = proj.project(ox - offset, oy - offset, oz, size);
    final hr = proj.project(ox - offset, oy - offset, oz + cH, size);
    canvas.drawLine(hl, hr, arrowPaint);
    _drawArrowHead(canvas, hl, hr, arrowPaint);
    _drawArrowHead(canvas, hr, hl, arrowPaint);
    _drawDimensionLabel(canvas, Offset.lerp(hl, hr, 0.5)!, '${cH.round()} cm');
  }

  void _drawArrowHead(Canvas canvas, Offset from, Offset to, Paint paint) {
    final dir = to - from;
    final len = dir.distance;
    if (len < 5) return;
    final unit = dir / len;
    final perp = Offset(-unit.dy, unit.dx);
    final tipSize = 5.0;
    canvas.drawLine(from, from + unit * tipSize + perp * tipSize * 0.5, paint);
    canvas.drawLine(from, from + unit * tipSize - perp * tipSize * 0.5, paint);
  }

  void _drawDimensionLabel(Canvas canvas, Offset pos, String text) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: const TextStyle(
          color: Color(0xAAFFFFFF),
          fontSize: 9,
          fontWeight: FontWeight.w500,
          letterSpacing: 0.5,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    
    // Background pill
    final rect = RRect.fromRectAndRadius(
      Rect.fromCenter(center: pos, width: tp.width + 10, height: tp.height + 6),
      const Radius.circular(4),
    );
    canvas.drawRRect(rect, Paint()..color = const Color(0x60000000));
    tp.paint(canvas, Offset(pos.dx - tp.width / 2, pos.dy - tp.height / 2));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRUCK CAB — Metallic, premium design
  // ═══════════════════════════════════════════════════════════════════════

  void _drawTruckCab(Canvas canvas) {
    final cabW = cW * 1.05; // Slightly wider than container
    final cabD = cW * 0.55; // Proportional depth
    final cabH = cH * 0.9;  // Slightly lower
    final cabX = ox - (cabW - cW) / 2;
    final cabY = oy + cD;   // Behind the container
    final cabZ = oz;

    // Cab body — main block
    final bottomFront = [
      proj.project(cabX, cabY, cabZ, size),
      proj.project(cabX + cabW, cabY, cabZ, size),
      proj.project(cabX + cabW, cabY, cabZ + cabH * 0.65, size),
      proj.project(cabX, cabY, cabZ + cabH * 0.65, size),
    ];
    PolyHelper.fillFaceSolid(canvas, bottomFront, _cabPrimary, Lighting3D.frontLight, 0.95);
    PolyHelper.strokeFace(canvas, bottomFront, _cabSecondary.withValues(alpha: 0.3), 1);
    
    // Windshield area (angled)
    final windshield = [
      proj.project(cabX + cabW * 0.05, cabY, cabZ + cabH * 0.65, size),
      proj.project(cabX + cabW * 0.95, cabY, cabZ + cabH * 0.65, size),
      proj.project(cabX + cabW * 0.1, cabY - cabD * 0.2, cabZ + cabH, size),
      proj.project(cabX + cabW * 0.05, cabY - cabD * 0.2, cabZ + cabH, size),
    ];
    // Glass gradient effect
    PolyHelper.fillFaceSolid(canvas, windshield, _windshield, 0.8, 0.5);
    // Glass reflection line
    final reflectPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.15)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;
    final midW = Offset.lerp(windshield[0], windshield[1], 0.4)!;
    final midW2 = Offset.lerp(windshield[3], windshield[2], 0.4)!;
    canvas.drawLine(midW, midW2, reflectPaint);
    
    // Cab roof
    final roof = [
      proj.project(cabX, cabY - cabD * 0.2, cabZ + cabH, size),
      proj.project(cabX + cabW, cabY - cabD * 0.2, cabZ + cabH, size),
      proj.project(cabX + cabW, cabY + cabD, cabZ + cabH, size),
      proj.project(cabX, cabY + cabD, cabZ + cabH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, roof, _cabPrimary, Lighting3D.topLight, 0.85);
    PolyHelper.strokeFace(canvas, roof, _cabSecondary.withValues(alpha: 0.2), 1);
    
    // Cab side
    final side = [
      proj.project(cabX + cabW, cabY, cabZ, size),
      proj.project(cabX + cabW, cabY + cabD, cabZ, size),
      proj.project(cabX + cabW, cabY + cabD, cabZ + cabH, size),
      proj.project(cabX + cabW, cabY - cabD * 0.2, cabZ + cabH, size),
      proj.project(cabX + cabW, cabY, cabZ + cabH * 0.65, size),
    ];
    PolyHelper.fillFaceSolid(canvas, side, _cabSecondary, Lighting3D.rightLight, 0.9);
    PolyHelper.strokeFace(canvas, side, _cabAccent.withValues(alpha: 0.2), 1);
    
    // Side window
    final sideWin = [
      proj.project(cabX + cabW, cabY + cabD * 0.15, cabZ + cabH * 0.5, size),
      proj.project(cabX + cabW, cabY + cabD * 0.7, cabZ + cabH * 0.5, size),
      proj.project(cabX + cabW, cabY + cabD * 0.7, cabZ + cabH * 0.85, size),
      proj.project(cabX + cabW, cabY + cabD * 0.15, cabZ + cabH * 0.85, size),
    ];
    PolyHelper.fillFaceSolid(canvas, sideWin, _windshield, 0.7, 0.45);
    PolyHelper.strokeFace(canvas, sideWin, _chrome.withValues(alpha: 0.3), 1);
    
    // Headlights
    _drawHeadlight(canvas, cabX + cabW * 0.1, cabY, cabZ + cabH * 0.2);
    _drawHeadlight(canvas, cabX + cabW * 0.9, cabY, cabZ + cabH * 0.2);
    
    // Bumper
    final bumper = [
      proj.project(cabX - 2, cabY - 3, cabZ, size),
      proj.project(cabX + cabW + 2, cabY - 3, cabZ, size),
      proj.project(cabX + cabW + 2, cabY - 3, cabZ + cabH * 0.15, size),
      proj.project(cabX - 2, cabY - 3, cabZ + cabH * 0.15, size),
    ];
    PolyHelper.fillFaceSolid(canvas, bumper, _chrome, 0.7, 0.8);
    
    // Mirrors
    _drawMirror(canvas, cabX - 8, cabY + cabD * 0.3, cabZ + cabH * 0.6);
    _drawMirror(canvas, cabX + cabW + 8, cabY + cabD * 0.3, cabZ + cabH * 0.6);
  }

  void _drawVanCab(Canvas canvas) {
    // Van: integrated cab + container look
    final cabD = cW * 0.3;
    final cabY = oy + cD;
    
    // Van front (curved top)
    final front = [
      proj.project(ox, cabY, oz, size),
      proj.project(ox + cW, cabY, oz, size),
      proj.project(ox + cW, cabY, oz + cH * 0.55, size),
      proj.project(ox + cW * 0.9, cabY, oz + cH, size),
      proj.project(ox + cW * 0.1, cabY, oz + cH, size),
      proj.project(ox, cabY, oz + cH * 0.55, size),
    ];
    PolyHelper.fillFaceSolid(canvas, front, _cabPrimary, Lighting3D.frontLight, 0.92);
    PolyHelper.strokeFace(canvas, front, _cabSecondary.withValues(alpha: 0.3), 1);
    
    // Windshield
    final ws = [
      proj.project(ox + cW * 0.1, cabY, oz + cH * 0.55, size),
      proj.project(ox + cW * 0.9, cabY, oz + cH * 0.55, size),
      proj.project(ox + cW * 0.9, cabY, oz + cH * 0.95, size),
      proj.project(ox + cW * 0.1, cabY, oz + cH * 0.95, size),
    ];
    PolyHelper.fillFaceSolid(canvas, ws, _windshield, 0.8, 0.5);
    
    // Van side
    final side = [
      proj.project(ox + cW, cabY, oz, size),
      proj.project(ox + cW, cabY + cabD, oz, size),
      proj.project(ox + cW, cabY + cabD, oz + cH, size),
      proj.project(ox + cW, cabY, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, side, _cabSecondary, Lighting3D.rightLight, 0.85);
    
    // Van roof extension
    final roofExt = [
      proj.project(ox, cabY, oz + cH, size),
      proj.project(ox + cW, cabY, oz + cH, size),
      proj.project(ox + cW, cabY + cabD, oz + cH, size),
      proj.project(ox, cabY + cabD, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, roofExt, _cabPrimary, Lighting3D.topLight, 0.8);
    
    // Headlights
    _drawHeadlight(canvas, ox + cW * 0.15, cabY + 1, oz + cH * 0.2);
    _drawHeadlight(canvas, ox + cW * 0.85, cabY + 1, oz + cH * 0.2);
    
    // Mirrors
    _drawMirror(canvas, ox - 8, cabY + cabD * 0.3, oz + cH * 0.65);
    _drawMirror(canvas, ox + cW + 8, cabY + cabD * 0.3, oz + cH * 0.65);
  }

  void _drawHeadlight(Canvas canvas, double x, double y, double z) {
    final center = proj.project(x, y, z, size);
    final r = 4.0 * proj.zoom;
    if (r < 1) return;
    
    // Outer glow
    canvas.drawCircle(
      center, r * 2.5,
      Paint()
        ..color = _headlight.withValues(alpha: 0.15)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8),
    );
    // Inner bright
    canvas.drawCircle(
      center, r,
      Paint()
        ..color = _headlight
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2),
    );
    // Chrome ring
    canvas.drawCircle(
      center, r * 1.3,
      Paint()
        ..color = _chrome.withValues(alpha: 0.5)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
  }

  void _drawMirror(Canvas canvas, double x, double y, double z) {
    final center = proj.project(x, y, z, size);
    final r = 3.5 * proj.zoom;
    if (r < 1) return;
    
    // Mirror housing
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: center, width: r * 2, height: r * 3),
        Radius.circular(r * 0.5),
      ),
      Paint()..color = _containerBase,
    );
    // Mirror glass
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: center, width: r * 1.4, height: r * 2.2),
        Radius.circular(r * 0.3),
      ),
      Paint()..color = _windshield.withValues(alpha: 0.5),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WHEELS — 3D-looking wheels with hub detail
  // ═══════════════════════════════════════════════════════════════════════

  void _drawWheels(Canvas canvas) {
    final wheelR = cH * 0.18;
    final wheelZ = oz - wheelR * 0.4;

    if (isVan) {
      // Van: 4 wheels
      _drawWheel(canvas, ox, oy + cD * 0.15, wheelZ, wheelR);
      _drawWheel(canvas, ox + cW, oy + cD * 0.15, wheelZ, wheelR);
      _drawWheel(canvas, ox, oy + cD * 0.85, wheelZ, wheelR);
      _drawWheel(canvas, ox + cW, oy + cD * 0.85, wheelZ, wheelR);
    } else {
      // Truck: 6 wheels (dual rear)
      _drawWheel(canvas, ox, oy + cD * 0.12, wheelZ, wheelR);
      _drawWheel(canvas, ox + cW, oy + cD * 0.12, wheelZ, wheelR);
      _drawWheel(canvas, ox, oy + cD * 0.75, wheelZ, wheelR);
      _drawWheel(canvas, ox + cW, oy + cD * 0.75, wheelZ, wheelR);
      _drawWheel(canvas, ox, oy + cD * 0.88, wheelZ, wheelR);
      _drawWheel(canvas, ox + cW, oy + cD * 0.88, wheelZ, wheelR);
    }
  }

  void _drawWheel(Canvas canvas, double wx, double wy, double wz, double r) {
    final center = proj.project(wx, wy, wz, size);
    final sr = r * proj.zoom * 0.4;
    if (sr < 2) return;

    // Tire shadow
    canvas.drawCircle(
      Offset(center.dx + 1, center.dy + 2),
      sr * 1.1,
      Paint()..color = const Color(0x40000000)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3),
    );
    
    // Tire (dark rubber)
    canvas.drawCircle(center, sr, Paint()..color = const Color(0xFF1A1A2E));
    
    // Tire tread ring
    canvas.drawCircle(
      center, sr * 0.85,
      Paint()
        ..color = const Color(0xFF2D2D44)
        ..style = PaintingStyle.stroke
        ..strokeWidth = sr * 0.15,
    );
    
    // Hub cap (chrome)
    canvas.drawCircle(center, sr * 0.45, Paint()..color = _chrome.withValues(alpha: 0.6));
    
    // Hub center
    canvas.drawCircle(center, sr * 0.15, Paint()..color = const Color(0xFF4A5568));
    
    // Chrome rim
    canvas.drawCircle(
      center, sr * 0.65,
      Paint()
        ..color = _chrome.withValues(alpha: 0.3)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
    
    // Spoke lines (4 spokes)
    final spokePaint = Paint()
      ..color = _chrome.withValues(alpha: 0.25)
      ..strokeWidth = 1;
    for (int i = 0; i < 4; i++) {
      final angle = i * math.pi / 2;
      canvas.drawLine(
        Offset(center.dx + math.cos(angle) * sr * 0.2, center.dy + math.sin(angle) * sr * 0.2),
        Offset(center.dx + math.cos(angle) * sr * 0.6, center.dy + math.sin(angle) * sr * 0.6),
        spokePaint,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WEIGHT HEATMAP — Overlay on floor
  // ═══════════════════════════════════════════════════════════════════════

  void drawWeightHeatmap(Canvas canvas, List<dynamic> placed, double maxWeight) {
    if (placed.isEmpty) return;
    for (final b in placed) {
      if (b is! PlacedBox) continue;
      final color = CargoColors.byWeight(b.weight, maxWeight);
      final pts = [
        proj.project(ox + b.x, oy + b.y, oz + 0.5, size),
        proj.project(ox + b.x + b.w, oy + b.y, oz + 0.5, size),
        proj.project(ox + b.x + b.w, oy + b.y + b.d, oz + 0.5, size),
        proj.project(ox + b.x, oy + b.y + b.d, oz + 0.5, size),
      ];
      PolyHelper.fillFaceSolid(canvas, pts, color, 0.8, 0.3);
    }
  }
}
