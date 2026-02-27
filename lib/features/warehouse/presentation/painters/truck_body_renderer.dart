/// Truck Body Renderer — Container, cab, wheels, ground
/// Clean, professional visual style with parametric vehicle taxonomy

import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'projection_3d.dart';

class TruckBodyRenderer {
  final Projection3D proj;
  final Size size;
  final double cW, cD, cH;
  final double ox, oy, oz;
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

  // ─── COLOR CONSTANTS ─────────────────────────────────────────────────
  // Clean, modern palette — lighter than before
  static const _floorColor = Color(0xFF2D3748);
  static const _wallColor = Color(0xFFE2E8F0);
  static const _gridColor = Color(0xFF4A5568);
  static const _edgeColor = Color(0xFF718096);
  static const _doorColor = Color(0xFFDDE3EA);
  static const _safetyYellow = Color(0xFFFFCA28);
  static const _safetyRed = Color(0xFFEF4444);

  // Cab colors
  static const _cabWhite = Color(0xFFFFFFFF);
  static const _cabLight = Color(0xFFF1F5F9);
  static const _cabDark = Color(0xFFE2E8F0);
  static const _glassBlue = Color(0xFF0EA5E9);
  static const _bumperDark = Color(0xFF334155);
  static const _grilleDark = Color(0xFF1E293B);

  // Wheel colors
  static const _tireDark = Color(0xFF0F172A);
  static const _rimSilver = Color(0xFFCBD5E1);
  static const _hubGrey = Color(0xFF94A3B8);

  void drawAll(Canvas canvas) {
    _drawGroundShadow(canvas);
    if (isVan) {
      _drawVanCab(canvas);
    } else {
      _drawTruckCab(canvas);
    }
    _drawCargoContainer(canvas);
    _drawWheels(canvas);
  }

  // ─── GROUND SHADOW ───────────────────────────────────────────────────
  void _drawGroundShadow(Canvas canvas) {
    final zFloor = oz - 2;
    final ext = 60.0;
    final frontD = isVan ? cD * 1.3 : cD * 1.5;

    // Soft ground shadow
    final pts = [
      proj.project(ox - ext, oy - ext, zFloor, size),
      proj.project(ox + cW + ext, oy - ext, zFloor, size),
      proj.project(ox + cW + ext, oy + frontD, zFloor, size),
      proj.project(ox - ext, oy + frontD, zFloor, size),
    ];
    canvas.drawPath(
      PolyHelper.pathOf(pts),
      Paint()
        ..color = Colors.black.withValues(alpha: 0.2)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 24),
    );

    // Subtle ground plane grid
    final floorPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.04)
      ..strokeWidth = 0.3;
    for (double gx = -ext; gx <= cW + ext; gx += 80) {
      canvas.drawLine(
        proj.project(ox + gx, oy - ext, zFloor, size),
        proj.project(ox + gx, oy + frontD, zFloor, size),
        floorPaint,
      );
    }
    for (double gy = -ext; gy <= frontD; gy += 80) {
      canvas.drawLine(
        proj.project(ox - ext, oy + gy, zFloor, size),
        proj.project(ox + cW + ext, oy + gy, zFloor, size),
        floorPaint,
      );
    }
  }

  // ─── CARGO CONTAINER ─────────────────────────────────────────────────
  void _drawCargoContainer(Canvas canvas) {
    final w = cW, d = cD, h = cH;

    // FLOOR
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, oy, oz], [ox + w, oy, oz], [ox + w, oy + d, oz], [ox, oy + d, oz],
    ], _floorColor, Lighting3D.intensity(0, 0, -1));

    // Floor grid
    final gridPaint = Paint()
      ..color = _gridColor.withValues(alpha: 0.35)
      ..strokeWidth = 0.3;
    for (double gx = 0; gx <= w; gx += 40) {
      canvas.drawLine(
        proj.project(ox + gx, oy, oz + 0.5, size),
        proj.project(ox + gx, oy + d, oz + 0.5, size),
        gridPaint,
      );
    }
    for (double gy = 0; gy <= d; gy += 40) {
      canvas.drawLine(
        proj.project(ox, oy + gy, oz + 0.5, size),
        proj.project(ox + w, oy + gy, oz + 0.5, size),
        gridPaint,
      );
    }

    // BACK WALL (visible through open doors)
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, oy + d, oz], [ox + w, oy + d, oz],
      [ox + w, oy + d, oz + h], [ox, oy + d, oz + h],
    ], _wallColor.withValues(alpha: 0.5), Lighting3D.intensity(0, 1, 0) * 0.7);

    // LEFT WALL (semi-transparent)
    final leftPts = [
      proj.project(ox, oy, oz, size),
      proj.project(ox, oy + d, oz, size),
      proj.project(ox, oy + d, oz + h, size),
      proj.project(ox, oy, oz + h, size),
    ];
    canvas.drawPath(
      PolyHelper.pathOf(leftPts),
      Paint()..color = _wallColor.withValues(alpha: 0.35),
    );
    // Wall reinforcement bars
    for (double gz = h * 0.25; gz < h; gz += h * 0.25) {
      canvas.drawLine(
        proj.project(ox, oy, oz + gz, size),
        proj.project(ox, oy + d, oz + gz, size),
        Paint()..color = _edgeColor.withValues(alpha: 0.25)..strokeWidth = 1.2,
      );
    }

    // RIGHT WALL (semi-transparent)
    final rightPts = [
      proj.project(ox + w, oy, oz, size),
      proj.project(ox + w, oy + d, oz, size),
      proj.project(ox + w, oy + d, oz + h, size),
      proj.project(ox + w, oy, oz + h, size),
    ];
    canvas.drawPath(
      PolyHelper.pathOf(rightPts),
      Paint()..color = _wallColor.withValues(alpha: 0.35),
    );
    for (double gz = h * 0.25; gz < h; gz += h * 0.25) {
      canvas.drawLine(
        proj.project(ox + w, oy, oz + gz, size),
        proj.project(ox + w, oy + d, oz + gz, size),
        Paint()..color = _edgeColor.withValues(alpha: 0.25)..strokeWidth = 1.2,
      );
    }

    // ROOF (very transparent)
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, oy, oz + h], [ox + w, oy, oz + h],
      [ox + w, oy + d, oz + h], [ox, oy + d, oz + h],
    ], _wallColor, Lighting3D.intensity(0, 0, 1), alpha: 0.08);

    // OPEN REAR DOORS
    final doorSwing = d * 0.3;
    final doorH = h * 0.95;
    // Left door
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, oy, oz], [ox, oy - doorSwing, oz],
      [ox, oy - doorSwing, oz + doorH], [ox, oy, oz + doorH],
    ], _doorColor, Lighting3D.intensity(-1, -0.5, 0));
    // Left door handle
    canvas.drawLine(
      proj.project(ox + 2, oy - doorSwing * 0.3, oz + h * 0.45, size),
      proj.project(ox + 2, oy - doorSwing * 0.3, oz + h * 0.55, size),
      Paint()..color = _bumperDark..strokeWidth = 2..strokeCap = StrokeCap.round,
    );
    // Right door
    PolyHelper.fillFace(canvas, proj, size, [
      [ox + w, oy, oz], [ox + w, oy - doorSwing, oz],
      [ox + w, oy - doorSwing, oz + doorH], [ox + w, oy, oz + doorH],
    ], _doorColor, Lighting3D.intensity(1, -0.5, 0));
    // Right door handle
    canvas.drawLine(
      proj.project(ox + w - 2, oy - doorSwing * 0.3, oz + h * 0.45, size),
      proj.project(ox + w - 2, oy - doorSwing * 0.3, oz + h * 0.55, size),
      Paint()..color = _bumperDark..strokeWidth = 2..strokeCap = StrokeCap.round,
    );

    // WIREFRAME EDGES (clean border lines)
    final border = Paint()
      ..color = _edgeColor.withValues(alpha: 0.25)
      ..strokeWidth = 0.7
      ..style = PaintingStyle.stroke;
    final v = [
      proj.project(ox, oy, oz, size),
      proj.project(ox + w, oy, oz, size),
      proj.project(ox + w, oy + d, oz, size),
      proj.project(ox, oy + d, oz, size),
      proj.project(ox, oy, oz + h, size),
      proj.project(ox + w, oy, oz + h, size),
      proj.project(ox + w, oy + d, oz + h, size),
      proj.project(ox, oy + d, oz + h, size),
    ];
    for (final e in [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ]) {
      canvas.drawLine(v[e[0]], v[e[1]], border);
    }

    // Edge highlights (subtle bright line on top edges for depth)
    final highlight = Paint()
      ..color = Colors.white.withValues(alpha: 0.12)
      ..strokeWidth = 0.5;
    canvas.drawLine(v[4], v[5], highlight);
    canvas.drawLine(v[5], v[6], highlight);
    canvas.drawLine(v[4], v[7], highlight);

    // SAFETY REFLECTIVE STRIPS on rear wall
    final stripPaint = Paint()
      ..color = _safetyYellow.withValues(alpha: 0.4)
      ..strokeWidth = 2.5;
    canvas.drawLine(
      proj.project(ox + 5, oy + d - 1, oz + h * 0.02, size),
      proj.project(ox + w - 5, oy + d - 1, oz + h * 0.02, size),
      stripPaint,
    );
    canvas.drawLine(
      proj.project(ox + 5, oy + d - 1, oz + h * 0.06, size),
      proj.project(ox + w - 5, oy + d - 1, oz + h * 0.06, size),
      Paint()..color = _safetyRed.withValues(alpha: 0.35)..strokeWidth = 2.5,
    );

    // Corrugated panel lines on outside walls (trucks only)
    if (!isVan) {
      for (double x = 30; x < w; x += 40) {
        canvas.drawLine(
          proj.project(ox + x, oy + d, oz, size),
          proj.project(ox + x, oy + d, oz + h, size),
          Paint()..color = _edgeColor.withValues(alpha: 0.1)..strokeWidth = 0.4,
        );
      }
    }
  }

  // ─── TRUCK CAB (Rigid truck >= 400cm) ────────────────────────────────
  void _drawTruckCab(Canvas canvas) {
    final w = cW, d = cD, h = cH;
    final cabD = math.max(100.0, d * 0.18);
    final cabH = math.max(200.0, h * 0.85);
    final gap = 15.0;
    final cY = oy + d + gap;

    // Side panels
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, cY, oz], [ox + w, cY, oz], [ox + w, cY, oz + cabH], [ox, cY, oz + cabH],
    ], _cabDark, Lighting3D.intensity(0, -1, 0));

    PolyHelper.fillFace(canvas, proj, size, [
      [ox, cY, oz], [ox, cY + cabD, oz],
      [ox, cY + cabD, oz + cabH * 0.7], [ox, cY + cabD * 0.8, oz + cabH],
      [ox, cY, oz + cabH],
    ], _cabDark, Lighting3D.intensity(-1, 0, 0));

    PolyHelper.fillFace(canvas, proj, size, [
      [ox + w, cY, oz], [ox + w, cY + cabD, oz],
      [ox + w, cY + cabD, oz + cabH * 0.7], [ox + w, cY + cabD * 0.8, oz + cabH],
      [ox + w, cY, oz + cabH],
    ], _cabWhite, Lighting3D.intensity(1, 0, 0));

    // Front lower panel
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, cY + cabD, oz], [ox + w, cY + cabD, oz],
      [ox + w, cY + cabD, oz + cabH * 0.4], [ox, cY + cabD, oz + cabH * 0.4],
    ], _cabWhite, Lighting3D.intensity(0, 1, 0));

    // Windshield
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, cY + cabD, oz + cabH * 0.4], [ox + w, cY + cabD, oz + cabH * 0.4],
      [ox + w, cY + cabD * 0.8, oz + cabH], [ox, cY + cabD * 0.8, oz + cabH],
    ], _glassBlue, Lighting3D.intensity(0, 1, 1), alpha: 0.85);

    // Windshield reflection highlight
    final reflStart = proj.project(ox + w * 0.3, cY + cabD * 0.92, oz + cabH * 0.6, size);
    final reflEnd = proj.project(ox + w * 0.7, cY + cabD * 0.88, oz + cabH * 0.85, size);
    canvas.drawLine(
      reflStart, reflEnd,
      Paint()..color = Colors.white.withValues(alpha: 0.25)..strokeWidth = 1.5,
    );

    // Roof
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, cY, oz + cabH], [ox + w, cY, oz + cabH],
      [ox + w, cY + cabD * 0.8, oz + cabH], [ox, cY + cabD * 0.8, oz + cabH],
    ], _cabDark, Lighting3D.intensity(0, 0, 1));

    // Aero deflector
    final defH = h - cabH;
    if (defH > 20) {
      PolyHelper.fillFace(canvas, proj, size, [
        [ox, cY, oz + cabH], [ox + w, cY, oz + cabH],
        [ox + w, cY, oz + cabH + defH], [ox, cY, oz + cabH + defH],
      ], _cabDark, Lighting3D.intensity(0, -1, 0));
      PolyHelper.fillFace(canvas, proj, size, [
        [ox, cY + cabD * 0.5, oz + cabH], [ox + w, cY + cabD * 0.5, oz + cabH],
        [ox + w, cY, oz + cabH + defH], [ox, cY, oz + cabH + defH],
      ], _cabLight, Lighting3D.intensity(0, 1, 1));
    }

    // Bumper
    PolyHelper.fillFace(canvas, proj, size, [
      [ox - 4, cY + cabD, oz], [ox + w + 4, cY + cabD, oz],
      [ox + w + 4, cY + cabD + 20, oz + 30], [ox - 4, cY + cabD + 20, oz + 30],
    ], _bumperDark, Lighting3D.intensity(0, 1, 0));

    // Grille
    PolyHelper.fillFace(canvas, proj, size, [
      [ox + w * 0.2, cY + cabD + 1, oz + 30],
      [ox + w * 0.8, cY + cabD + 1, oz + 30],
      [ox + w * 0.8, cY + cabD + 1, oz + cabH * 0.35],
      [ox + w * 0.2, cY + cabD + 1, oz + cabH * 0.35],
    ], _grilleDark, Lighting3D.intensity(0, 1, 0));

    // Headlights (two small bright circles)
    _drawHeadlight(canvas, ox + w * 0.1, cY + cabD + 1, oz + cabH * 0.25);
    _drawHeadlight(canvas, ox + w * 0.9, cY + cabD + 1, oz + cabH * 0.25);

    // Side mirrors
    _drawMirror(canvas, ox - 8, cY + cabD * 0.6, oz + cabH * 0.7);
    _drawMirror(canvas, ox + w + 8, cY + cabD * 0.6, oz + cabH * 0.7);
  }

  // ─── VAN CAB (Furgoneta < 400cm) ────────────────────────────────────
  void _drawVanCab(Canvas canvas) {
    final w = cW, d = cD, h = cH;
    final cabD = math.max(120.0, d * 0.38);
    final cY = oy + d;

    // Side panels (unibody, no gap)
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, cY, oz], [ox, cY + cabD, oz],
      [ox, cY + cabD * 0.85, oz + h * 0.45],
      [ox, cY + cabD * 0.4, oz + h],
      [ox, cY, oz + h],
    ], _cabDark, Lighting3D.intensity(-1, 0, 0));

    PolyHelper.fillFace(canvas, proj, size, [
      [ox + w, cY, oz], [ox + w, cY + cabD, oz],
      [ox + w, cY + cabD * 0.85, oz + h * 0.45],
      [ox + w, cY + cabD * 0.4, oz + h],
      [ox + w, cY, oz + h],
    ], _cabLight, Lighting3D.intensity(1, 0, 0));

    // Front lower (hood/nose)
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, cY + cabD, oz], [ox + w, cY + cabD, oz],
      [ox + w, cY + cabD * 0.85, oz + h * 0.45],
      [ox, cY + cabD * 0.85, oz + h * 0.45],
    ], _cabLight, Lighting3D.intensity(0, 1, 0.5));

    // Windshield
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, cY + cabD * 0.85, oz + h * 0.45],
      [ox + w, cY + cabD * 0.85, oz + h * 0.45],
      [ox + w, cY + cabD * 0.4, oz + h],
      [ox, cY + cabD * 0.4, oz + h],
    ], _glassBlue, Lighting3D.intensity(0, 1, 1.5), alpha: 0.85);

    // Windshield reflection
    final reflStart = proj.project(ox + w * 0.25, cY + cabD * 0.7, oz + h * 0.6, size);
    final reflEnd = proj.project(ox + w * 0.65, cY + cabD * 0.55, oz + h * 0.85, size);
    canvas.drawLine(
      reflStart, reflEnd,
      Paint()..color = Colors.white.withValues(alpha: 0.2)..strokeWidth = 1.2,
    );

    // Roof (unibody)
    PolyHelper.fillFace(canvas, proj, size, [
      [ox, cY, oz + h], [ox + w, cY, oz + h],
      [ox + w, cY + cabD * 0.4, oz + h], [ox, cY + cabD * 0.4, oz + h],
    ], _cabDark, Lighting3D.intensity(0, 0, 1));

    // Bumper
    PolyHelper.fillFace(canvas, proj, size, [
      [ox - 2, cY + cabD - 8, oz], [ox + w + 2, cY + cabD - 8, oz],
      [ox + w + 2, cY + cabD + 12, oz + 25], [ox - 2, cY + cabD + 12, oz + 25],
    ], _bumperDark, Lighting3D.intensity(0, 1, 0));

    // Headlights
    _drawHeadlight(canvas, ox + w * 0.08, cY + cabD + 1, oz + h * 0.2);
    _drawHeadlight(canvas, ox + w * 0.92, cY + cabD + 1, oz + h * 0.2);

    // Side mirrors
    _drawMirror(canvas, ox - 6, cY + cabD * 0.5, oz + h * 0.7);
    _drawMirror(canvas, ox + w + 6, cY + cabD * 0.5, oz + h * 0.7);
  }

  // ─── HEADLIGHT ───────────────────────────────────────────────────────
  void _drawHeadlight(Canvas canvas, double x, double y, double z) {
    final center = proj.project(x, y, z, size);
    canvas.drawCircle(
      center, 4.0 * proj.zoom,
      Paint()..color = const Color(0xFFFEF3C7).withValues(alpha: 0.7),
    );
    canvas.drawCircle(
      center, 2.5 * proj.zoom,
      Paint()..color = Colors.white.withValues(alpha: 0.9),
    );
  }

  // ─── MIRROR ──────────────────────────────────────────────────────────
  void _drawMirror(Canvas canvas, double x, double y, double z) {
    final pts = [
      proj.project(x, y - 8, z, size),
      proj.project(x, y + 8, z, size),
      proj.project(x, y + 8, z + 12, size),
      proj.project(x, y - 8, z + 12, size),
    ];
    canvas.drawPath(
      PolyHelper.pathOf(pts),
      Paint()..color = _bumperDark.withValues(alpha: 0.6),
    );
  }

  // ─── WHEELS ──────────────────────────────────────────────────────────
  void _drawWheels(Canvas canvas) {
    final w = cW, d = cD, h = cH;
    final r = math.min(80.0, h * (isVan ? 0.22 : 0.16));

    final rearY = oy + (isVan ? d * 0.15 : d * 0.20);
    final frontY = oy + d + (isVan ? d * 0.22 : 60.0);

    final positions = <List<double>>[
      [ox - r * 0.2, rearY],
      [ox + w + r * 0.2, rearY],
      [ox - r * 0.2, frontY],
      [ox + w + r * 0.2, frontY],
    ];

    // Extra rear axle for heavy trucks (> 6m)
    if (!isVan && d > 600) {
      positions.insert(0, [ox - r * 0.2, rearY + r * 2.8]);
      positions.insert(1, [ox + w + r * 0.2, rearY + r * 2.8]);
    }

    for (final pos in positions) {
      _drawWheel(canvas, pos[0], pos[1], r);
    }
  }

  void _drawWheel(Canvas canvas, double wx, double wy, double r) {
    const segments = 12; // Reduced from 18 for performance

    // Outer tire
    final tirePath = Path();
    for (int i = 0; i <= segments; i++) {
      final a = (i / segments) * math.pi * 2;
      final pt = proj.project(
        wx, wy + math.cos(a) * r * 0.4, oz + r * 0.3 + math.sin(a) * r, size,
      );
      i == 0 ? tirePath.moveTo(pt.dx, pt.dy) : tirePath.lineTo(pt.dx, pt.dy);
    }
    canvas.drawPath(tirePath, Paint()..color = _tireDark);

    // Sidewall
    final sideWallPath = Path();
    for (int i = 0; i <= segments; i++) {
      final a = (i / segments) * math.pi * 2;
      final pt = proj.project(
        wx, wy + math.cos(a) * r * 0.32, oz + r * 0.3 + math.sin(a) * r * 0.82, size,
      );
      i == 0 ? sideWallPath.moveTo(pt.dx, pt.dy) : sideWallPath.lineTo(pt.dx, pt.dy);
    }
    canvas.drawPath(sideWallPath, Paint()..color = const Color(0xFF1E293B));

    // Rim
    final rimPath = Path();
    for (int i = 0; i <= 10; i++) {
      final a = (i / 10) * math.pi * 2;
      final pt = proj.project(
        wx, wy + math.cos(a) * r * 0.24, oz + r * 0.3 + math.sin(a) * r * 0.6, size,
      );
      i == 0 ? rimPath.moveTo(pt.dx, pt.dy) : rimPath.lineTo(pt.dx, pt.dy);
    }
    canvas.drawPath(rimPath, Paint()..color = _rimSilver);

    // Hub
    final hubCenter = proj.project(wx, wy, oz + r * 0.3, size);
    canvas.drawCircle(hubCenter, r * 0.08 * proj.zoom, Paint()..color = _hubGrey);

    // Spokes
    for (int s = 0; s < 5; s++) {
      final a = (s / 5) * math.pi * 2;
      final spokeEnd = proj.project(
        wx, wy + math.cos(a) * r * 0.22, oz + r * 0.3 + math.sin(a) * r * 0.55, size,
      );
      canvas.drawLine(
        hubCenter, spokeEnd,
        Paint()..color = _hubGrey.withValues(alpha: 0.6)..strokeWidth = 0.8,
      );
    }
  }

  // ─── WEIGHT HEATMAP FLOOR ────────────────────────────────────────────
  void drawWeightHeatmap(Canvas canvas, List<dynamic> placed, double maxWeight) {
    if (maxWeight <= 0) return;
    const cellSize = 30.0;

    // Accumulate weight per cell
    final cellsW = (cW / cellSize).ceil();
    final cellsD = (cD / cellSize).ceil();
    final grid = List.generate(cellsW, (_) => List.filled(cellsD, 0.0));
    double maxCell = 0;

    for (final b in placed) {
      final bx = (b as dynamic).x as double;
      final by = (b as dynamic).y as double;
      final bw = (b as dynamic).w as double;
      final bd = (b as dynamic).d as double;
      final weight = (b as dynamic).weight as double;

      final x1 = (bx / cellSize).floor().clamp(0, cellsW - 1);
      final x2 = ((bx + bw) / cellSize).ceil().clamp(0, cellsW);
      final y1 = (by / cellSize).floor().clamp(0, cellsD - 1);
      final y2 = ((by + bd) / cellSize).ceil().clamp(0, cellsD);
      final area = (x2 - x1) * (y2 - y1);
      if (area <= 0) continue;
      final wPerCell = weight / area;

      for (int gx = x1; gx < x2 && gx < cellsW; gx++) {
        for (int gy = y1; gy < y2 && gy < cellsD; gy++) {
          grid[gx][gy] += wPerCell;
          if (grid[gx][gy] > maxCell) maxCell = grid[gx][gy];
        }
      }
    }

    if (maxCell <= 0) return;

    for (int gx = 0; gx < cellsW; gx++) {
      for (int gy = 0; gy < cellsD; gy++) {
        if (grid[gx][gy] <= 0) continue;
        final t = (grid[gx][gy] / maxCell).clamp(0.0, 1.0);
        final color = CargoColors.byWeight(grid[gx][gy], maxCell);
        PolyHelper.fillFace(canvas, proj, size, [
          [ox + gx * cellSize, oy + gy * cellSize, oz + 0.5],
          [ox + (gx + 1) * cellSize, oy + gy * cellSize, oz + 0.5],
          [ox + (gx + 1) * cellSize, oy + (gy + 1) * cellSize, oz + 0.5],
          [ox + gx * cellSize, oy + (gy + 1) * cellSize, oz + 0.5],
        ], color, 1.0, alpha: 0.25 + t * 0.2);
      }
    }
  }
}
