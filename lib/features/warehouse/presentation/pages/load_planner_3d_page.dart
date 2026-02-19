/// LOAD PLANNER 3D PAGE — Tetris Logístico
/// Visualización 3D isométrica de la carga de un camión usando CustomPainter
/// Color semántico: 🟢 Seguro (<90%), 🟠 Óptimo (90-100%), 🔴 Exceso (>100%)

import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/warehouse_data_service.dart';

class LoadPlanner3DPage extends StatefulWidget {
  final String vehicleCode;
  final String vehicleName;
  final DateTime date;

  const LoadPlanner3DPage({
    super.key,
    required this.vehicleCode,
    required this.vehicleName,
    required this.date,
  });

  @override
  State<LoadPlanner3DPage> createState() => _LoadPlanner3DPageState();
}

class _LoadPlanner3DPageState extends State<LoadPlanner3DPage>
    with TickerProviderStateMixin {
  LoadPlanResult? _result;
  bool _loading = true;
  String? _error;
  int? _selectedBoxId;

  // 3D interaction
  double _rotationX = -0.45; // radians
  double _rotationY = 0.6;
  double _zoom = 1.0;
  Offset _lastPanPosition = Offset.zero;

  late AnimationController _glowController;

  @override
  void initState() {
    super.initState();
    _glowController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
    _loadPlan();
  }

  @override
  void dispose() {
    _glowController.dispose();
    super.dispose();
  }

  Future<void> _loadPlan() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await WarehouseDataService.planLoad(
        vehicleCode: widget.vehicleCode,
        year: widget.date.year,
        month: widget.date.month,
        day: widget.date.day,
      );
      if (mounted) {
        setState(() {
          _result = result;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'EXCESO':
        return Colors.redAccent;
      case 'OPTIMO':
        return Colors.amber;
      case 'SEGURO':
      default:
        return AppTheme.neonGreen;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: AppTheme.darkBase,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: Colors.white70),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'TETRIS LOGÍSTICO 3D',
              style: TextStyle(
                color: AppTheme.neonBlue,
                fontSize: 14,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.5,
              ),
            ),
            Text(
              '${widget.vehicleCode} · ${widget.vehicleName}',
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.5),
                fontSize: 12,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            onPressed: _loadPlan,
            icon: const Icon(Icons.refresh_rounded, color: AppTheme.neonGreen),
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(color: AppTheme.neonBlue),
                  SizedBox(height: 16),
                  Text('Calculando carga óptima...',
                      style: TextStyle(color: Colors.white54, fontSize: 14)),
                ],
              ),
            )
          : _error != null
              ? _buildError()
              : _buildContent(),
    );
  }

  Widget _buildContent() {
    final result = _result!;
    final status = result.metrics.status;
    final sColor = _statusColor(status);

    return Column(
      children: [
        // Status bar
        _buildStatusBar(result, sColor),

        // 3D Viewer
        Expanded(
          child: GestureDetector(
            onPanStart: (d) => _lastPanPosition = d.localPosition,
            onPanUpdate: (d) {
              setState(() {
                final delta = d.localPosition - _lastPanPosition;
                _rotationY += delta.dx * 0.008;
                _rotationX += delta.dy * 0.008;
                _rotationX = _rotationX.clamp(-1.2, 0.2);
                _lastPanPosition = d.localPosition;
              });
            },
            onScaleUpdate: (d) {
              if (d.pointerCount == 2) {
                setState(() {
                  _zoom = (_zoom * d.scale).clamp(0.3, 3.0);
                });
              }
            },
            onTapUp: (d) => _handleTap(d.localPosition),
            child: AnimatedBuilder(
              animation: _glowController,
              builder: (ctx, _) {
                return CustomPaint(
                  painter: _TruckLoadPainter(
                    result: result,
                    rotationX: _rotationX,
                    rotationY: _rotationY,
                    zoom: _zoom,
                    selectedBoxId: _selectedBoxId,
                    glowValue: _glowController.value,
                    statusColor: sColor,
                  ),
                  size: Size.infinite,
                );
              },
            ),
          ),
        ),

        // Selected box info
        if (_selectedBoxId != null) _buildSelectedBoxInfo(),

        // Metrics bar
        _buildMetricsBar(result),
      ],
    );
  }

  Widget _buildStatusBar(LoadPlanResult result, Color sColor) {
    final m = result.metrics;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: sColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: sColor.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(
            m.status == 'EXCESO'
                ? Icons.warning_rounded
                : m.status == 'OPTIMO'
                    ? Icons.check_circle_rounded
                    : Icons.verified_rounded,
            color: sColor,
            size: 22,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              m.status == 'EXCESO'
                  ? '⚠️ EXCESO: ${m.overflowCount} bultos sin espacio'
                  : m.status == 'OPTIMO'
                      ? '✅ CARGA ÓPTIMA — Camión al límite'
                      : '🟢 CARGA SEGURA — Espacio disponible',
              style: TextStyle(
                color: sColor,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: sColor.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              '${m.volumeOccupancyPct.toStringAsFixed(1)}%',
              style: TextStyle(
                color: sColor,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMetricsBar(LoadPlanResult result) {
    final m = result.metrics;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        border: Border(
            top: BorderSide(
                color: AppTheme.neonBlue.withValues(alpha: 0.2))),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _metric('BULTOS', '${m.placedCount}', AppTheme.neonBlue),
          _gauge('VOLUMEN', m.volumeOccupancyPct, AppTheme.neonGreen),
          _gauge('PESO', m.weightOccupancyPct, AppTheme.neonPurple),
          _metric('KG', m.totalWeightKg.toStringAsFixed(0), Colors.amber),
          if (m.overflowCount > 0)
            _metric('EXCESO', '${m.overflowCount}', Colors.redAccent),
        ],
      ),
    );
  }

  Widget _metric(String label, String value, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(value,
            style: TextStyle(
                color: color, fontSize: 18, fontWeight: FontWeight.w800)),
        Text(label,
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.4),
                fontSize: 10,
                fontWeight: FontWeight.w600)),
      ],
    );
  }

  Widget _gauge(String label, double pct, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 44,
          height: 44,
          child: Stack(
            alignment: Alignment.center,
            children: [
              CircularProgressIndicator(
                value: (pct / 100).clamp(0, 1),
                strokeWidth: 4,
                backgroundColor: color.withValues(alpha: 0.15),
                valueColor: AlwaysStoppedAnimation(color),
              ),
              Text(
                '${pct.toInt()}',
                style: TextStyle(
                    color: color,
                    fontSize: 12,
                    fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
        const SizedBox(height: 2),
        Text(label,
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.4),
                fontSize: 10,
                fontWeight: FontWeight.w600)),
      ],
    );
  }

  Widget _buildSelectedBoxInfo() {
    final box = _result?.placed.firstWhere(
      (b) => b.id == _selectedBoxId,
      orElse: () => PlacedBox(
          id: -1,
          label: '',
          orderNumber: 0,
          clientCode: '',
          articleCode: '',
          weight: 0,
          x: 0,
          y: 0,
          z: 0,
          w: 0,
          d: 0,
          h: 0),
    );
    if (box == null || box.id == -1) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.neonBlue.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.neonBlue.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          const Icon(Icons.inventory_2_rounded,
              color: AppTheme.neonBlue, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  box.label,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  'Pedido #${box.orderNumber} · ${box.clientCode} · ${box.weight.toStringAsFixed(1)} kg',
                  style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.5),
                      fontSize: 11),
                ),
              ],
            ),
          ),
          Text(
            '${box.w.toInt()}×${box.d.toInt()}×${box.h.toInt()} cm',
            style: const TextStyle(color: AppTheme.neonGreen, fontSize: 11),
          ),
          IconButton(
            icon: const Icon(Icons.close_rounded,
                color: Colors.white38, size: 18),
            onPressed: () => setState(() => _selectedBoxId = null),
          ),
        ],
      ),
    );
  }

  void _handleTap(Offset position) {
    // Simple box selection via center-projected comparison
    // A full implementation would inverse-project screen coordinates to 3D
    // For now, cycle through boxes on tap
    if (_result == null || _result!.placed.isEmpty) return;
    setState(() {
      if (_selectedBoxId == null) {
        _selectedBoxId = _result!.placed.first.id;
      } else {
        final idx = _result!.placed.indexWhere((b) => b.id == _selectedBoxId);
        if (idx >= 0 && idx < _result!.placed.length - 1) {
          _selectedBoxId = _result!.placed[idx + 1].id;
        } else {
          _selectedBoxId = null;
        }
      }
    });
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline_rounded,
              color: Colors.redAccent, size: 48),
          const SizedBox(height: 12),
          Text(_error ?? 'Error desconocido',
              style: const TextStyle(color: Colors.white70, fontSize: 14),
              textAlign: TextAlign.center),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _loadPlan,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Reintentar'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.2),
              foregroundColor: AppTheme.neonBlue,
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM PAINTER — Motor de renderizado 3D isométrico
// ═══════════════════════════════════════════════════════════════════════════

class _TruckLoadPainter extends CustomPainter {
  final LoadPlanResult result;
  final double rotationX;
  final double rotationY;
  final double zoom;
  final int? selectedBoxId;
  final double glowValue;
  final Color statusColor;

  _TruckLoadPainter({
    required this.result,
    required this.rotationX,
    required this.rotationY,
    required this.zoom,
    this.selectedBoxId,
    required this.glowValue,
    required this.statusColor,
  });

  /// Converts 3D coordinates to 2D screen coordinates using isometric projection
  Offset project3D(double x, double y, double z, Size size) {
    // Apply rotation
    final cosX = math.cos(rotationX);
    final sinX = math.sin(rotationX);
    final cosY = math.cos(rotationY);
    final sinY = math.sin(rotationY);

    // Rotate around Y axis (horizontal drag)
    final rx = x * cosY - y * sinY;
    final ry = x * sinY + y * cosY;
    final rz = z;

    // Rotate around X axis (vertical drag)
    final fy = ry * cosX - rz * sinX;
    final fz = ry * sinX + rz * cosX;

    // Scale and center
    final scale = 0.4 * zoom;
    final cx = size.width / 2;
    final cy = size.height * 0.55;

    return Offset(
      cx + rx * scale,
      cy + fy * scale - fz * scale,
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (result.truck == null) return;

    final truck = result.truck!;
    final cW = truck.interior.widthCm;
    final cD = truck.interior.lengthCm;
    final cH = truck.interior.heightCm;

    // Center the container
    final offsetX = -cW / 2;
    final offsetY = -cD / 2;
    final offsetZ = -cH / 2;

    // Draw container wireframe
    _drawContainer(canvas, size, offsetX, offsetY, offsetZ, cW, cD, cH);

    // Draw grid on floor
    _drawFloorGrid(canvas, size, offsetX, offsetY, offsetZ, cW, cD);

    // Sort boxes by depth (painter's algorithm: far to near)
    final sorted = List<PlacedBox>.from(result.placed);
    sorted.sort((a, b) {
      final depthA = a.x + a.y + a.z;
      final depthB = b.x + b.y + b.z;
      return depthA.compareTo(depthB);
    });

    // Draw boxes
    for (final box in sorted) {
      _drawBox(canvas, size, box, offsetX, offsetY, offsetZ, cW, cD, cH);
    }

    // Draw volume label
    _drawVolumeLabel(canvas, size);
  }

  void _drawContainer(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h) {
    final vertices = [
      // Bottom face
      project3D(ox, oy, oz, size),         // 0: bottom-front-left
      project3D(ox + w, oy, oz, size),     // 1: bottom-front-right
      project3D(ox + w, oy + d, oz, size), // 2: bottom-back-right
      project3D(ox, oy + d, oz, size),     // 3: bottom-back-left
      // Top face
      project3D(ox, oy, oz + h, size),         // 4
      project3D(ox + w, oy, oz + h, size),     // 5
      project3D(ox + w, oy + d, oz + h, size), // 6
      project3D(ox, oy + d, oz + h, size),     // 7
    ];

    final paint = Paint()
      ..color = statusColor.withValues(alpha: 0.15 + glowValue * 0.1)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    final edges = [
      [0, 1], [1, 2], [2, 3], [3, 0], // bottom
      [4, 5], [5, 6], [6, 7], [7, 4], // top
      [0, 4], [1, 5], [2, 6], [3, 7], // verticals
    ];

    for (final e in edges) {
      canvas.drawLine(vertices[e[0]], vertices[e[1]], paint);
    }
  }

  void _drawFloorGrid(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.04)
      ..strokeWidth = 0.5;

    const gridSpacing = 50.0; // 50cm grid
    for (double x = 0; x <= w; x += gridSpacing) {
      canvas.drawLine(
        project3D(ox + x, oy, oz, size),
        project3D(ox + x, oy + d, oz, size),
        paint,
      );
    }
    for (double y = 0; y <= d; y += gridSpacing) {
      canvas.drawLine(
        project3D(ox, oy + y, oz, size),
        project3D(ox + w, oy + y, oz, size),
        paint,
      );
    }
  }

  void _drawBox(Canvas canvas, Size size, PlacedBox box, double ox, double oy,
      double oz, double cW, double cD, double cH) {
    final bx = ox + box.x;
    final by = oy + box.y;
    final bz = oz + box.z;

    // Generate a hue based on order number for color variety
    final hue = (box.orderNumber * 47.0) % 360;
    final baseColor = HSLColor.fromAHSL(1, hue, 0.7, 0.5).toColor();
    final isSelected = box.id == selectedBoxId;

    // Three visible faces in isometric: top, front, right
    final topFace = [
      project3D(bx, by, bz + box.h, size),
      project3D(bx + box.w, by, bz + box.h, size),
      project3D(bx + box.w, by + box.d, bz + box.h, size),
      project3D(bx, by + box.d, bz + box.h, size),
    ];
    final frontFace = [
      project3D(bx, by, bz, size),
      project3D(bx + box.w, by, bz, size),
      project3D(bx + box.w, by, bz + box.h, size),
      project3D(bx, by, bz + box.h, size),
    ];
    final rightFace = [
      project3D(bx + box.w, by, bz, size),
      project3D(bx + box.w, by + box.d, bz, size),
      project3D(bx + box.w, by + box.d, bz + box.h, size),
      project3D(bx + box.w, by, bz + box.h, size),
    ];

    // Fill faces with different brightness for depth effect
    final topPaint = Paint()
      ..color = baseColor.withValues(alpha: isSelected ? 0.9 : 0.6);
    final frontPaint = Paint()
      ..color = HSLColor.fromAHSL(
              1, hue, 0.6, isSelected ? 0.45 : 0.35)
          .toColor()
          .withValues(alpha: isSelected ? 0.9 : 0.7);
    final rightPaint = Paint()
      ..color = HSLColor.fromAHSL(
              1, hue, 0.5, isSelected ? 0.35 : 0.25)
          .toColor()
          .withValues(alpha: isSelected ? 0.9 : 0.7);

    // Draw faces
    canvas.drawPath(_pathFromPoints(topFace), topPaint);
    canvas.drawPath(_pathFromPoints(frontFace), frontPaint);
    canvas.drawPath(_pathFromPoints(rightFace), rightPaint);

    // Draw edges
    final edgePaint = Paint()
      ..color = isSelected
          ? AppTheme.neonBlue.withValues(alpha: 0.9)
          : Colors.white.withValues(alpha: 0.2)
      ..strokeWidth = isSelected ? 2.0 : 0.7
      ..style = PaintingStyle.stroke;

    canvas.drawPath(_pathFromPoints(topFace), edgePaint);
    canvas.drawPath(_pathFromPoints(frontFace), edgePaint);
    canvas.drawPath(_pathFromPoints(rightFace), edgePaint);

    // Selected glow
    if (isSelected) {
      final glowPaint = Paint()
        ..color = AppTheme.neonBlue.withValues(alpha: 0.3 * glowValue)
        ..strokeWidth = 4
        ..style = PaintingStyle.stroke
        ..maskFilter = const MaskFilter.blur(BlurStyle.outer, 8);
      canvas.drawPath(_pathFromPoints(topFace), glowPaint);
    }
  }

  Path _pathFromPoints(List<Offset> points) {
    final path = Path()..moveTo(points[0].dx, points[0].dy);
    for (int i = 1; i < points.length; i++) {
      path.lineTo(points[i].dx, points[i].dy);
    }
    path.close();
    return path;
  }

  void _drawVolumeLabel(Canvas canvas, Size size) {
    final m = result.metrics;
    final tp = TextPainter(
      text: TextSpan(
        text: '${m.placedCount} bultos · ${m.totalWeightKg.toStringAsFixed(0)} kg',
        style: TextStyle(
          color: Colors.white.withValues(alpha: 0.3),
          fontSize: 12,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset(12, size.height - 24));
  }

  @override
  bool shouldRepaint(covariant _TruckLoadPainter old) => true;
}
