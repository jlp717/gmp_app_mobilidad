/// Truck Body Renderer v3 — Premium realistic design
/// Features:
/// - Metallic cab with windshield reflections + rejilla + matrícula
/// - Translucent container walls (see cargo inside)
/// - REAL 3D open doors with hinges, latch bars, and shadows
/// - Floor with wood plank texture + scale grid
/// - Lateral rails (for strapping) on interior walls
/// - LED light bar on ceiling
/// - Corner reinforcements (chrome triangles)
/// - Dimension arrows with real measurements
/// - Dynamic shadows, gradient lighting
/// - Van vs Truck parametric morphing
/// - Wheel arch intrusion for vans

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
  final String? matricula; // License plate text

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
    this.matricula,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // COLORS — Premium metallic palette
  // ═══════════════════════════════════════════════════════════════════════

  // Container
  static const Color _containerBase = Color(0xFF2D3748);
  static const Color _containerFrame = Color(0xFF4A5568);
  static const Color _containerFloor = Color(0xFF1A202C);

  // Cab
  static const Color _cabPrimary = Color(0xFF1E40AF);    // Deep blue
  static const Color _cabSecondary = Color(0xFF2563EB);   // Lighter blue
  static const Color _cabAccent = Color(0xFF60A5FA);      // Bright accent
  static const Color _windshield = Color(0xFF38BDF8);     // Glass blue
  static const Color _headlight = Color(0xFFFDE68A);      // Warm yellow
  static const Color _chrome = Color(0xFFE2E8F0);         // Chrome silver
  static const Color _indicator = Color(0xFFFF8C42);      // Orange indicator

  // Environment
  static const Color _groundShadow = Color(0x20000000);
  static const Color _gridLine = Color(0x25FFFFFF);
  static const Color _gridLineAccent = Color(0x55FFFFFF);
  static const Color _measureLine = Color(0x60FFFFFF);
  static const Color _woodPlank = Color(0x12FFFFFF);
  static const Color _railColor = Color(0x18FFFFFF);
  static const Color _ledColor = Color(0x45FFFFFF);

  void drawAll(Canvas canvas) {
    _drawGroundShadow(canvas);
    _drawContainerFloor(canvas);
    _drawFloorGrid(canvas);
    _drawContainerWalls(canvas);
    _drawLateralRails(canvas);
    _drawCeilingLED(canvas);
    _drawCornerReinforcements(canvas);
    _drawContainerFrame(canvas);
    _drawOpenDoors(canvas);
    _drawDimensionArrows(canvas);

    if (isVan) {
      _drawVanCab(canvas);
      _drawWheelArches(canvas);
    } else {
      _drawTruckCab(canvas);
    }
    _drawWheels(canvas);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GROUND SHADOW — Soft, realistic ground plane
  // ═══════════════════════════════════════════════════════════════════════

  void _drawGroundShadow(Canvas canvas) {
    final center = proj.project(0, cD * 0.3, oz, size);
    final rx = cD * 0.6 * proj.zoom * 0.45;
    final ry = rx * 0.35;

    final shadowPaint = Paint()
      ..shader = RadialGradient(
        colors: [
          _groundShadow.withValues(alpha: 0.18),
          _groundShadow.withValues(alpha: 0.06),
          Colors.transparent,
        ],
        stops: const [0.0, 0.55, 1.0],
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

    PolyHelper.fillFaceSolid(canvas, pts, _containerFloor, 0.9, 1.0);
    PolyHelper.strokeFace(canvas, pts, _containerFrame.withValues(alpha: 0.4), 1.5);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FLOOR GRID — Wood planks + scale reference lines
  // ═══════════════════════════════════════════════════════════════════════

  void _drawFloorGrid(Canvas canvas) {
    // ── Wood plank lines (every 20cm along Y axis) ──
    final plankPaint = Paint()
      ..color = _woodPlank
      ..strokeWidth = 0.3;
    for (double y = 0; y <= cD; y += 20) {
      final p1 = proj.project(ox, oy + y, oz + 0.2, size);
      final p2 = proj.project(ox + cW, oy + y, oz + 0.2, size);
      canvas.drawLine(p1, p2, plankPaint);
    }

    // ── Scale grid (every 50cm, accented every 100cm) ──
    const gridSpacing = 50.0;
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
      // Labeled marks every 100cm along depth
      if (isAccent && y > 0) {
        final labelPos = proj.project(ox - 5, oy + y, oz + 1, size);
        final tp = TextPainter(
          text: TextSpan(
            text: '${y.toInt()}',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.3),
              fontSize: 8,
            ),
          ),
          textDirection: TextDirection.ltr,
        )..layout();
        tp.paint(canvas, Offset(labelPos.dx - tp.width - 2, labelPos.dy - tp.height / 2));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LATERAL RAILS — Horizontal strapping rails on interior walls
  // ═══════════════════════════════════════════════════════════════════════

  void _drawLateralRails(Canvas canvas) {
    final railPaint = Paint()
      ..color = _railColor
      ..strokeWidth = 1;

    for (double z = 40; z < cH; z += 40) {
      // Left wall rails
      canvas.drawLine(
        proj.project(ox, oy, oz + z, size),
        proj.project(ox, oy + cD, oz + z, size),
        railPaint,
      );
      // Right wall rails
      canvas.drawLine(
        proj.project(ox + cW, oy, oz + z, size),
        proj.project(ox + cW, oy + cD, oz + z, size),
        railPaint,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CEILING LED — Light bar along the length of the container
  // ═══════════════════════════════════════════════════════════════════════

  void _drawCeilingLED(Canvas canvas) {
    final ledPaint = Paint()
      ..color = _ledColor
      ..strokeWidth = 2.5
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4);

    final led1 = proj.project(ox + cW / 2, oy + 10, oz + cH - 1, size);
    final led2 = proj.project(ox + cW / 2, oy + cD - 10, oz + cH - 1, size);
    canvas.drawLine(led1, led2, ledPaint);

    // Brighter core
    final corePaint = Paint()
      ..color = const Color(0x30FFFFFF)
      ..strokeWidth = 1.5;
    canvas.drawLine(led1, led2, corePaint);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CORNER REINFORCEMENTS — Chrome triangles at container corners
  // ═══════════════════════════════════════════════════════════════════════

  void _drawCornerReinforcements(Canvas canvas) {
    final cornerSize = math.min(cW, cH) * 0.06;
    final cPaint = Paint()..color = _chrome.withValues(alpha: 0.15);

    // Front-bottom-left corner (visible from front)
    final fbl = [
      proj.project(ox, oy, oz, size),
      proj.project(ox + cornerSize, oy, oz, size),
      proj.project(ox, oy, oz + cornerSize, size),
    ];
    canvas.drawPath(PolyHelper.pathOf(fbl), cPaint);

    // Front-bottom-right
    final fbr = [
      proj.project(ox + cW, oy, oz, size),
      proj.project(ox + cW - cornerSize, oy, oz, size),
      proj.project(ox + cW, oy, oz + cornerSize, size),
    ];
    canvas.drawPath(PolyHelper.pathOf(fbr), cPaint);

    // Front-top-left
    final ftl = [
      proj.project(ox, oy, oz + cH, size),
      proj.project(ox + cornerSize, oy, oz + cH, size),
      proj.project(ox, oy, oz + cH - cornerSize, size),
    ];
    canvas.drawPath(PolyHelper.pathOf(ftl), cPaint);

    // Front-top-right
    final ftr = [
      proj.project(ox + cW, oy, oz + cH, size),
      proj.project(ox + cW - cornerSize, oy, oz + cH, size),
      proj.project(ox + cW, oy, oz + cH - cornerSize, size),
    ];
    canvas.drawPath(PolyHelper.pathOf(ftr), cPaint);
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
    PolyHelper.fillFaceSolid(canvas, leftPts, _containerBase, Lighting3D.leftLight, 0.17);

    // Right wall (translucent — reduced alpha for cargo visibility)
    final rightPts = [
      proj.project(ox + cW, oy, oz, size),
      proj.project(ox + cW, oy + cD, oz, size),
      proj.project(ox + cW, oy + cD, oz + cH, size),
      proj.project(ox + cW, oy, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, rightPts, _containerBase, Lighting3D.rightLight, 0.17);

    // Back wall (reduced alpha for better cargo visibility)
    final backPts = [
      proj.project(ox, oy + cD, oz, size),
      proj.project(ox + cW, oy + cD, oz, size),
      proj.project(ox + cW, oy + cD, oz + cH, size),
      proj.project(ox, oy + cD, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, backPts, _containerBase, Lighting3D.backLight, 0.22);

    // Roof (very translucent)
    final roofPts = [
      proj.project(ox, oy, oz + cH, size),
      proj.project(ox + cW, oy, oz + cH, size),
      proj.project(ox + cW, oy + cD, oz + cH, size),
      proj.project(ox, oy + cD, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, roofPts, _containerBase, Lighting3D.topLight, 0.08);

    // Ambient occlusion — dark gradient at floor-wall junctions
    _drawAmbientOcclusion(canvas);
  }

  void _drawAmbientOcclusion(Canvas canvas) {
    final aoHeight = cH * 0.05;
    final aoPaint = Paint()..color = const Color(0x0A000000);

    // Left wall AO strip
    final lao = [
      proj.project(ox, oy, oz, size),
      proj.project(ox, oy + cD, oz, size),
      proj.project(ox, oy + cD, oz + aoHeight, size),
      proj.project(ox, oy, oz + aoHeight, size),
    ];
    canvas.drawPath(PolyHelper.pathOf(lao), aoPaint);

    // Right wall AO strip
    final rao = [
      proj.project(ox + cW, oy, oz, size),
      proj.project(ox + cW, oy + cD, oz, size),
      proj.project(ox + cW, oy + cD, oz + aoHeight, size),
      proj.project(ox + cW, oy, oz + aoHeight, size),
    ];
    canvas.drawPath(PolyHelper.pathOf(rao), aoPaint);

    // Back wall AO strip
    final bao = [
      proj.project(ox, oy + cD, oz, size),
      proj.project(ox + cW, oy + cD, oz, size),
      proj.project(ox + cW, oy + cD, oz + aoHeight, size),
      proj.project(ox, oy + cD, oz + aoHeight, size),
    ];
    canvas.drawPath(PolyHelper.pathOf(bao), aoPaint);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // OPEN DOORS — Real 3D doors opened at 90° with hinges, latches, shadow
  // ═══════════════════════════════════════════════════════════════════════

  void _drawOpenDoors(Canvas canvas) {
    final doorW = cW * 0.6;
    const doorThickness = 3.0;
    // Doors open at 90° outward (toward camera)
    // Hinge on left edge of left door, right edge of right door

    // ── Left door (hinged on ox, opens toward negative Y) ──
    final ldBotHinge = proj.project(ox, oy, oz, size);
    final ldTopHinge = proj.project(ox, oy, oz + cH, size);
    final ldBotFar = proj.project(ox, oy - doorW, oz, size);
    final ldTopFar = proj.project(ox, oy - doorW, oz + cH, size);

    // Door inner face
    final leftDoorFace = [ldBotHinge, ldBotFar, ldTopFar, ldTopHinge];
    PolyHelper.fillFaceSolid(canvas, leftDoorFace, _containerBase, Lighting3D.leftLight, 0.7);
    PolyHelper.strokeFace(canvas, leftDoorFace, _containerFrame.withValues(alpha: 0.5), 1.5);

    // Door top edge (thickness)
    final ldThickTop = [
      ldTopHinge,
      ldTopFar,
      proj.project(ox + doorThickness, oy - doorW, oz + cH, size),
      proj.project(ox + doorThickness, oy, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, ldThickTop, _containerFrame, Lighting3D.topLight, 0.5);

    // Door outer face (slightly visible)
    final ldOuterFace = [
      proj.project(ox + doorThickness, oy, oz, size),
      proj.project(ox + doorThickness, oy - doorW, oz, size),
      proj.project(ox + doorThickness, oy - doorW, oz + cH, size),
      proj.project(ox + doorThickness, oy, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, ldOuterFace, _containerBase, Lighting3D.rightLight, 0.5);

    // ── Right door (hinged on ox+cW, opens toward negative Y) ──
    final rdBotHinge = proj.project(ox + cW, oy, oz, size);
    final rdTopHinge = proj.project(ox + cW, oy, oz + cH, size);
    final rdBotFar = proj.project(ox + cW, oy - doorW, oz, size);
    final rdTopFar = proj.project(ox + cW, oy - doorW, oz + cH, size);

    final rightDoorFace = [rdBotHinge, rdBotFar, rdTopFar, rdTopHinge];
    PolyHelper.fillFaceSolid(canvas, rightDoorFace, _containerBase, Lighting3D.rightLight, 0.7);
    PolyHelper.strokeFace(canvas, rightDoorFace, _containerFrame.withValues(alpha: 0.5), 1.5);

    // Door top edge
    final rdThickTop = [
      rdTopHinge,
      rdTopFar,
      proj.project(ox + cW - doorThickness, oy - doorW, oz + cH, size),
      proj.project(ox + cW - doorThickness, oy, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, rdThickTop, _containerFrame, Lighting3D.topLight, 0.5);

    // Door outer face
    final rdOuterFace = [
      proj.project(ox + cW - doorThickness, oy, oz, size),
      proj.project(ox + cW - doorThickness, oy - doorW, oz, size),
      proj.project(ox + cW - doorThickness, oy - doorW, oz + cH, size),
      proj.project(ox + cW - doorThickness, oy, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, rdOuterFace, _containerBase, Lighting3D.leftLight, 0.5);

    // ── Hinges (chrome circles on hinge edge) ──
    final hingePaint = Paint()..color = _chrome.withValues(alpha: 0.7);
    final hingeR = 3.0 * proj.zoom;
    for (final frac in [0.15, 0.5, 0.85]) {
      // Left door hinges
      final lh = Offset.lerp(ldBotHinge, ldTopHinge, frac)!;
      if (hingeR > 1) canvas.drawCircle(lh, hingeR, hingePaint);
      // Right door hinges
      final rh = Offset.lerp(rdBotHinge, rdTopHinge, frac)!;
      if (hingeR > 1) canvas.drawCircle(rh, hingeR, hingePaint);
    }

    // ── Latch bars (vertical chrome bars on each door) ──
    final latchPaint = Paint()
      ..color = _chrome.withValues(alpha: 0.4)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    // Left door latch at 80% from hinge
    final llBot = Offset.lerp(ldBotHinge, ldBotFar, 0.8)!;
    final llTop = Offset.lerp(ldTopHinge, ldTopFar, 0.8)!;
    canvas.drawLine(
      Offset.lerp(llBot, llTop, 0.3)!,
      Offset.lerp(llBot, llTop, 0.7)!,
      latchPaint,
    );
    // Latch handle (small horizontal bar)
    final llMid = Offset.lerp(llBot, llTop, 0.5)!;
    canvas.drawLine(llMid, Offset(llMid.dx + 4, llMid.dy), latchPaint);

    // Right door latch
    final rlBot = Offset.lerp(rdBotHinge, rdBotFar, 0.8)!;
    final rlTop = Offset.lerp(rdTopHinge, rdTopFar, 0.8)!;
    canvas.drawLine(
      Offset.lerp(rlBot, rlTop, 0.3)!,
      Offset.lerp(rlBot, rlTop, 0.7)!,
      latchPaint,
    );
    final rlMid = Offset.lerp(rlBot, rlTop, 0.5)!;
    canvas.drawLine(rlMid, Offset(rlMid.dx - 4, rlMid.dy), latchPaint);

    // ── Door shadows on ground ──
    final shadowPaint = Paint()
      ..color = const Color(0x18000000)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5);
    // Left door shadow
    final lShadow = [
      ldBotHinge,
      ldBotFar,
      Offset(ldBotFar.dx, ldBotFar.dy + 10),
      Offset(ldBotHinge.dx, ldBotHinge.dy + 10),
    ];
    canvas.drawPath(PolyHelper.pathOf(lShadow), shadowPaint);
    // Right door shadow
    final rShadow = [
      rdBotHinge,
      rdBotFar,
      Offset(rdBotFar.dx, rdBotFar.dy + 10),
      Offset(rdBotHinge.dx, rdBotHinge.dy + 10),
    ];
    canvas.drawPath(PolyHelper.pathOf(rShadow), shadowPaint);

    // ── Door frame (the opening itself) ──
    final framePaint = Paint()
      ..color = _containerFrame.withValues(alpha: 0.7)
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke;
    final fl = proj.project(ox, oy, oz, size);
    final fr = proj.project(ox + cW, oy, oz, size);
    final tl = proj.project(ox, oy, oz + cH, size);
    final tr = proj.project(ox + cW, oy, oz + cH, size);
    canvas.drawLine(fl, tl, framePaint);
    canvas.drawLine(fr, tr, framePaint);
    canvas.drawLine(tl, tr, framePaint);
    canvas.drawLine(fl, fr, framePaint);
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
    const offset = 15.0;
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
    const tipSize = 5.0;
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

    final rect = RRect.fromRectAndRadius(
      Rect.fromCenter(center: pos, width: tp.width + 10, height: tp.height + 6),
      const Radius.circular(4),
    );
    canvas.drawRRect(rect, Paint()..color = const Color(0x60000000));
    tp.paint(canvas, Offset(pos.dx - tp.width / 2, pos.dy - tp.height / 2));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRUCK CAB — Metallic, premium design with grille + plate
  // ═══════════════════════════════════════════════════════════════════════

  void _drawTruckCab(Canvas canvas) {
    final cabW = cW * 1.05;
    final cabD = cW * 0.55;
    final cabH = cH * 0.9;
    final cabX = ox - (cabW - cW) / 2;
    final cabY = oy + cD;
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

    // Grille (horizontal lines between headlights)
    _drawGrille(canvas, cabX, cabY, cabZ, cabW, cabH);

    // Windshield area (angled)
    final windshield = [
      proj.project(cabX + cabW * 0.05, cabY, cabZ + cabH * 0.65, size),
      proj.project(cabX + cabW * 0.95, cabY, cabZ + cabH * 0.65, size),
      proj.project(cabX + cabW * 0.1, cabY - cabD * 0.2, cabZ + cabH, size),
      proj.project(cabX + cabW * 0.05, cabY - cabD * 0.2, cabZ + cabH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, windshield, _windshield, 0.8, 0.5);
    // Double reflection lines
    final reflectPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.15)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;
    final midW1 = Offset.lerp(windshield[0], windshield[1], 0.35)!;
    final midW1t = Offset.lerp(windshield[3], windshield[2], 0.35)!;
    canvas.drawLine(midW1, midW1t, reflectPaint);
    final midW2 = Offset.lerp(windshield[0], windshield[1], 0.65)!;
    final midW2t = Offset.lerp(windshield[3], windshield[2], 0.65)!;
    canvas.drawLine(midW2, midW2t, reflectPaint..color = Colors.white.withValues(alpha: 0.08));

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

    // Side indicators (orange)
    _drawIndicator(canvas, cabX + cabW, cabY + cabD * 0.05, cabZ + cabH * 0.35);

    // Bumper
    final bumper = [
      proj.project(cabX - 2, cabY - 3, cabZ, size),
      proj.project(cabX + cabW + 2, cabY - 3, cabZ, size),
      proj.project(cabX + cabW + 2, cabY - 3, cabZ + cabH * 0.15, size),
      proj.project(cabX - 2, cabY - 3, cabZ + cabH * 0.15, size),
    ];
    PolyHelper.fillFaceSolid(canvas, bumper, _chrome, 0.7, 0.8);

    // License plate on bumper
    _drawLicensePlate(canvas, cabX + cabW * 0.3, cabY - 3.5, cabZ + cabH * 0.04, cabW * 0.4, cabH * 0.08);

    // Mirrors
    _drawMirror(canvas, cabX - 8, cabY + cabD * 0.3, cabZ + cabH * 0.6);
    _drawMirror(canvas, cabX + cabW + 8, cabY + cabD * 0.3, cabZ + cabH * 0.6);
  }

  void _drawVanCab(Canvas canvas) {
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

    // Grille
    _drawGrille(canvas, ox, cabY, oz, cW, cH);

    // Windshield
    final ws = [
      proj.project(ox + cW * 0.1, cabY, oz + cH * 0.55, size),
      proj.project(ox + cW * 0.9, cabY, oz + cH * 0.55, size),
      proj.project(ox + cW * 0.9, cabY, oz + cH * 0.95, size),
      proj.project(ox + cW * 0.1, cabY, oz + cH * 0.95, size),
    ];
    PolyHelper.fillFaceSolid(canvas, ws, _windshield, 0.8, 0.5);
    // Reflection
    final reflectPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.12)
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;
    canvas.drawLine(
      Offset.lerp(ws[0], ws[1], 0.4)!,
      Offset.lerp(ws[3], ws[2], 0.4)!,
      reflectPaint,
    );

    // Van side
    final side = [
      proj.project(ox + cW, cabY, oz, size),
      proj.project(ox + cW, cabY + cabD, oz, size),
      proj.project(ox + cW, cabY + cabD, oz + cH, size),
      proj.project(ox + cW, cabY, oz + cH, size),
    ];
    PolyHelper.fillFaceSolid(canvas, side, _cabSecondary, Lighting3D.rightLight, 0.85);

    // Side indicator
    _drawIndicator(canvas, ox + cW, cabY + cabD * 0.1, oz + cH * 0.3);

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

    // Bumper
    final bumper = [
      proj.project(ox - 1, cabY + 1, oz, size),
      proj.project(ox + cW + 1, cabY + 1, oz, size),
      proj.project(ox + cW + 1, cabY + 1, oz + cH * 0.12, size),
      proj.project(ox - 1, cabY + 1, oz + cH * 0.12, size),
    ];
    PolyHelper.fillFaceSolid(canvas, bumper, _chrome, 0.6, 0.7);

    // License plate
    _drawLicensePlate(canvas, ox + cW * 0.3, cabY + 1.5, oz + cH * 0.03, cW * 0.4, cH * 0.07);

    // Mirrors
    _drawMirror(canvas, ox - 8, cabY + cabD * 0.3, oz + cH * 0.65);
    _drawMirror(canvas, ox + cW + 8, cabY + cabD * 0.3, oz + cH * 0.65);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CAB DETAILS — Grille, headlights, indicators, mirrors, license plate
  // ═══════════════════════════════════════════════════════════════════════

  void _drawGrille(Canvas canvas, double gx, double gy, double gz, double gw, double gh) {
    final grillePaint = Paint()
      ..color = _chrome.withValues(alpha: 0.2)
      ..strokeWidth = 0.8;
    // Horizontal grille lines
    final grillTop = gz + gh * 0.25;
    final grillBot = gz + gh * 0.45;
    final grillLeft = gx + gw * 0.2;
    final grillRight = gx + gw * 0.8;
    final numLines = 5;
    for (int i = 0; i <= numLines; i++) {
      final z = grillTop + (grillBot - grillTop) * i / numLines;
      canvas.drawLine(
        proj.project(grillLeft, gy, z, size),
        proj.project(grillRight, gy, z, size),
        grillePaint,
      );
    }
  }

  void _drawHeadlight(Canvas canvas, double x, double y, double z) {
    final center = proj.project(x, y, z, size);
    final r = 4.0 * proj.zoom;
    if (r < 1) return;

    canvas.drawCircle(
      center, r * 2.5,
      Paint()
        ..color = _headlight.withValues(alpha: 0.15)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8),
    );
    canvas.drawCircle(
      center, r,
      Paint()
        ..color = _headlight
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2),
    );
    canvas.drawCircle(
      center, r * 1.3,
      Paint()
        ..color = _chrome.withValues(alpha: 0.5)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
  }

  void _drawIndicator(Canvas canvas, double x, double y, double z) {
    final center = proj.project(x, y, z, size);
    final r = 2.5 * proj.zoom;
    if (r < 1) return;
    canvas.drawCircle(center, r, Paint()..color = _indicator.withValues(alpha: 0.7));
    canvas.drawCircle(
      center, r * 1.5,
      Paint()
        ..color = _indicator.withValues(alpha: 0.15)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4),
    );
  }

  void _drawMirror(Canvas canvas, double x, double y, double z) {
    final center = proj.project(x, y, z, size);
    final r = 3.5 * proj.zoom;
    if (r < 1) return;

    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: center, width: r * 2, height: r * 3),
        Radius.circular(r * 0.5),
      ),
      Paint()..color = _containerBase,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(center: center, width: r * 1.4, height: r * 2.2),
        Radius.circular(r * 0.3),
      ),
      Paint()..color = _windshield.withValues(alpha: 0.5),
    );
  }

  void _drawLicensePlate(Canvas canvas, double px, double py, double pz, double pw, double ph) {
    final plateText = matricula ?? '';
    if (plateText.isEmpty) return;

    final center = proj.project(px + pw / 2, py, pz + ph / 2, size);
    final plateW = pw * 0.25 * proj.zoom;
    final plateH = ph * 0.25 * proj.zoom;
    if (plateW < 10 || plateH < 4) return;

    // White plate background
    final plateRect = RRect.fromRectAndRadius(
      Rect.fromCenter(center: center, width: plateW, height: plateH),
      const Radius.circular(2),
    );
    canvas.drawRRect(plateRect, Paint()..color = Colors.white.withValues(alpha: 0.85));
    canvas.drawRRect(
      plateRect,
      Paint()
        ..color = const Color(0xFF1A1A2E)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.5,
    );

    // Plate text
    final tp = TextPainter(
      text: TextSpan(
        text: plateText.length > 8 ? plateText.substring(0, 8) : plateText,
        style: TextStyle(
          color: const Color(0xFF1A1A2E),
          fontSize: math.min(plateH * 0.6, 8).toDouble(),
          fontWeight: FontWeight.w900,
          letterSpacing: 0.5,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: plateW - 4);
    tp.paint(canvas, Offset(center.dx - tp.width / 2, center.dy - tp.height / 2));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WHEEL ARCHES — Interior space reduction for vans
  // ═══════════════════════════════════════════════════════════════════════

  void _drawWheelArches(Canvas canvas) {
    if (!isVan) return;
    // Vans have wheel arches that intrude into cargo space
    // Typically ~15cm from each side, 50cm tall, near the rear
    final archW = 15.0;
    final archH = 50.0;
    final archY = cD * 0.75; // Near rear wheels
    final archD = 60.0;

    final archPaint = Paint()..color = const Color(0xFF1A1A2E).withValues(alpha: 0.4);

    // Left wheel arch
    final leftArch = [
      proj.project(ox, oy + archY, oz, size),
      proj.project(ox + archW, oy + archY, oz, size),
      proj.project(ox + archW, oy + archY, oz + archH, size),
      proj.project(ox + archW, oy + archY + archD, oz + archH, size),
      proj.project(ox + archW, oy + archY + archD, oz, size),
      proj.project(ox, oy + archY + archD, oz, size),
    ];
    canvas.drawPath(PolyHelper.pathOf(leftArch), archPaint);

    // Right wheel arch
    final rightArch = [
      proj.project(ox + cW, oy + archY, oz, size),
      proj.project(ox + cW - archW, oy + archY, oz, size),
      proj.project(ox + cW - archW, oy + archY, oz + archH, size),
      proj.project(ox + cW - archW, oy + archY + archD, oz + archH, size),
      proj.project(ox + cW - archW, oy + archY + archD, oz, size),
      proj.project(ox + cW, oy + archY + archD, oz, size),
    ];
    canvas.drawPath(PolyHelper.pathOf(rightArch), archPaint);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WHEELS — 3D-looking wheels with hub detail
  // ═══════════════════════════════════════════════════════════════════════

  void _drawWheels(Canvas canvas) {
    final wheelR = cH * 0.18;
    final wheelZ = oz - wheelR * 0.4;

    if (isVan) {
      _drawWheel(canvas, ox, oy + cD * 0.15, wheelZ, wheelR);
      _drawWheel(canvas, ox + cW, oy + cD * 0.15, wheelZ, wheelR);
      _drawWheel(canvas, ox, oy + cD * 0.85, wheelZ, wheelR);
      _drawWheel(canvas, ox + cW, oy + cD * 0.85, wheelZ, wheelR);
    } else {
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
    // Spoke lines (5 spokes)
    final spokePaint = Paint()
      ..color = _chrome.withValues(alpha: 0.25)
      ..strokeWidth = 1;
    for (int i = 0; i < 5; i++) {
      final angle = i * math.pi * 2 / 5;
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
