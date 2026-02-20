/// LOAD PLANNER 3D PAGE — Tetris Logístico
/// Visualización 3D del camión/furgoneta con carga interactiva
/// Color semántico: SEGURO (<90%), OPTIMO (90-100%), EXCESO (>100%)

import 'dart:async';
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

  // Interactive orders
  List<TruckOrder> _allOrders = [];
  Set<int> _excludedIndices = {};
  bool _isManualMode = false;
  bool _recomputing = false;
  Timer? _debounce;

  // 3D interaction
  double _rotationX = -0.45;
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
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _loadPlan() async {
    setState(() {
      _loading = true;
      _error = null;
      _isManualMode = false;
      _excludedIndices = {};
    });
    try {
      final results = await Future.wait([
        WarehouseDataService.planLoad(
          vehicleCode: widget.vehicleCode,
          year: widget.date.year,
          month: widget.date.month,
          day: widget.date.day,
        ),
        WarehouseDataService.getTruckOrders(
          vehicleCode: widget.vehicleCode,
          year: widget.date.year,
          month: widget.date.month,
          day: widget.date.day,
        ),
      ]);
      if (mounted) {
        setState(() {
          _result = results[0] as LoadPlanResult;
          _allOrders = results[1] as List<TruckOrder>;
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

  Future<void> _rerunPacking() async {
    if (_recomputing) return;
    setState(() => _recomputing = true);

    try {
      final activeOrders = _allOrders
          .asMap()
          .entries
          .where((e) => !_excludedIndices.contains(e.key))
          .map((e) => e.value)
          .toList();

      final items = activeOrders
          .map((o) => <String, dynamic>{
                'articleCode': o.articleCode,
                'quantity': o.quantity > 0 ? o.quantity.round() : 1,
                'orderNumber': o.orderNumber,
                'clientCode': o.clientCode,
                'label': o.articleName,
              })
          .toList();

      final result = await WarehouseDataService.planLoadManual(
        vehicleCode: widget.vehicleCode,
        items: items,
      );
      if (mounted) {
        setState(() {
          _result = result;
          _recomputing = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _recomputing = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Error: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  void _removeOrder(int index) {
    setState(() {
      _excludedIndices.add(index);
      _isManualMode = true;
      _selectedBoxId = null;
    });
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _rerunPacking);
  }

  void _restoreOrder(int index) {
    setState(() {
      _excludedIndices.remove(index);
      if (_excludedIndices.isEmpty) _isManualMode = false;
    });
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _rerunPacking);
  }

  void _resetOrders() {
    setState(() {
      _excludedIndices = {};
      _isManualMode = false;
    });
    _loadPlan();
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
              'TETRIS LOGISTICO 3D',
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
          if (_isManualMode)
            IconButton(
              onPressed: _resetOrders,
              icon: const Icon(Icons.restart_alt_rounded,
                  color: Colors.amber, size: 22),
              tooltip: 'Restaurar pedidos originales',
            ),
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
                  Text('Calculando carga optima...',
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

        // 3D Viewer + Orders panel
        Expanded(
          child: Stack(
            children: [
              // 3D Canvas
              GestureDetector(
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

              // Recomputing overlay
              if (_recomputing)
                Positioned(
                  top: 12,
                  right: 12,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppTheme.darkCard.withValues(alpha: 0.9),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppTheme.neonBlue),
                        ),
                        SizedBox(width: 8),
                        Text('Recalculando...',
                            style: TextStyle(
                                color: Colors.white54, fontSize: 11)),
                      ],
                    ),
                  ),
                ),

              // Orders panel
              if (_allOrders.isNotEmpty) _buildOrdersPanel(),
            ],
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
                  ? '${m.placedCount} de ${m.totalBoxes} bultos cargados · ${m.overflowCount} sin espacio'
                  : m.status == 'OPTIMO'
                      ? 'CARGA OPTIMA — ${m.placedCount} bultos cargados'
                      : 'CARGA SEGURA — ${m.placedCount} bultos · Espacio disponible',
              style: TextStyle(
                color: sColor,
                fontSize: 12,
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
              m.status == 'EXCESO'
                  ? '${m.demandVsCapacityPct.toStringAsFixed(0)}%'
                  : '${m.volumeOccupancyPct.toStringAsFixed(1)}%',
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
          _metric('BULTOS', '${m.placedCount}/${m.totalBoxes}', AppTheme.neonBlue),
          _gauge('VOLUMEN', m.volumeOccupancyPct, AppTheme.neonGreen),
          _gauge('PESO', m.weightOccupancyPct, AppTheme.neonPurple),
          _metric('KG', m.totalWeightKg.toStringAsFixed(0), Colors.amber),
          if (m.overflowCount > 0)
            _gauge('DEMANDA', m.demandVsCapacityPct, Colors.redAccent),
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
                color: color, fontSize: 16, fontWeight: FontWeight.w800)),
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
          width: 40,
          height: 40,
          child: Stack(
            alignment: Alignment.center,
            children: [
              CircularProgressIndicator(
                value: (pct / 100).clamp(0, 1),
                strokeWidth: 3.5,
                backgroundColor: color.withValues(alpha: 0.15),
                valueColor: AlwaysStoppedAnimation(color),
              ),
              Text(
                '${pct.toInt()}',
                style: TextStyle(
                    color: color,
                    fontSize: 11,
                    fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
        const SizedBox(height: 2),
        Text(label,
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.4),
                fontSize: 9,
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
          x: 0, y: 0, z: 0,
          w: 0, d: 0, h: 0),
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
            '${box.w.toInt()}x${box.d.toInt()}x${box.h.toInt()} cm',
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

  // ─── Orders Panel (Draggable) ───────────────────────────────────────────

  Widget _buildOrdersPanel() {
    final activeCount = _allOrders.length - _excludedIndices.length;
    return DraggableScrollableSheet(
      initialChildSize: 0.07,
      minChildSize: 0.07,
      maxChildSize: 0.55,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: AppTheme.darkCard,
            borderRadius:
                const BorderRadius.vertical(top: Radius.circular(16)),
            border: Border.all(
                color: AppTheme.neonBlue.withValues(alpha: 0.2)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.4),
                blurRadius: 16,
                offset: const Offset(0, -4),
              ),
            ],
          ),
          child: ListView(
            controller: scrollController,
            padding: EdgeInsets.zero,
            children: [
              // Drag handle + header
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 8, bottom: 6),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Row(
                  children: [
                    const Icon(Icons.list_alt_rounded,
                        color: AppTheme.neonBlue, size: 18),
                    const SizedBox(width: 8),
                    Text(
                      'PEDIDOS EN CARGA',
                      style: TextStyle(
                        color: AppTheme.neonBlue,
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        '$activeCount/${_allOrders.length}',
                        style: const TextStyle(
                            color: AppTheme.neonBlue,
                            fontSize: 10,
                            fontWeight: FontWeight.w700),
                      ),
                    ),
                    const Spacer(),
                    if (_excludedIndices.isNotEmpty)
                      GestureDetector(
                        onTap: _resetOrders,
                        child: Text('Restaurar',
                            style: TextStyle(
                                color: Colors.amber.withValues(alpha: 0.8),
                                fontSize: 11,
                                fontWeight: FontWeight.w600)),
                      ),
                  ],
                ),
              ),
              const Divider(color: Colors.white12, height: 1),

              // Order items
              ..._allOrders.asMap().entries.map((entry) {
                final i = entry.key;
                final order = entry.value;
                final excluded = _excludedIndices.contains(i);
                return _buildOrderItem(order, i, excluded);
              }),
            ],
          ),
        );
      },
    );
  }

  Widget _buildOrderItem(TruckOrder order, int index, bool excluded) {
    return Dismissible(
      key: ValueKey('order_$index'),
      direction:
          excluded ? DismissDirection.none : DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: Colors.redAccent.withValues(alpha: 0.3),
        child:
            const Icon(Icons.remove_circle_outline, color: Colors.redAccent),
      ),
      onDismissed: (_) => _removeOrder(index),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          border: Border(
              bottom: BorderSide(color: Colors.white.withValues(alpha: 0.05))),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    order.articleName.isNotEmpty
                        ? order.articleName
                        : order.articleCode,
                    style: TextStyle(
                      color: excluded ? Colors.white30 : Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      decoration:
                          excluded ? TextDecoration.lineThrough : null,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    '#${order.orderNumber} · ${order.clientName.isNotEmpty ? order.clientName : order.clientCode}',
                    style: TextStyle(
                      color: excluded
                          ? Colors.white12
                          : Colors.white.withValues(alpha: 0.4),
                      fontSize: 10,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Text(
              '${order.quantity.toStringAsFixed(order.quantity == order.quantity.roundToDouble() ? 0 : 1)} uds',
              style: TextStyle(
                color: excluded ? Colors.white20 : AppTheme.neonGreen,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 12),
            if (excluded)
              GestureDetector(
                onTap: () => _restoreOrder(index),
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    color: AppTheme.neonGreen.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Icon(Icons.add_rounded,
                      color: AppTheme.neonGreen, size: 16),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _handleTap(Offset position) {
    if (_result == null || _result!.placed.isEmpty) return;
    setState(() {
      if (_selectedBoxId == null) {
        _selectedBoxId = _result!.placed.first.id;
      } else {
        final idx =
            _result!.placed.indexWhere((b) => b.id == _selectedBoxId);
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
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(_error ?? 'Error desconocido',
                style: const TextStyle(color: Colors.white70, fontSize: 14),
                textAlign: TextAlign.center),
          ),
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

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM PAINTER — Motor de renderizado 3D con silueta de vehiculo
// ═══════════════════════════════════════════════════════════════════════════════

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

  Offset project3D(double x, double y, double z, Size size) {
    final cosX = math.cos(rotationX);
    final sinX = math.sin(rotationX);
    final cosY = math.cos(rotationY);
    final sinY = math.sin(rotationY);

    final rx = x * cosY - y * sinY;
    final ry = x * sinY + y * cosY;

    final fy = ry * cosX - z * sinX;
    final fz = ry * sinX + z * cosX;

    final scale = 0.4 * zoom;
    final cx = size.width / 2;
    final cy = size.height * 0.55;

    return Offset(cx + rx * scale, cy + fy * scale - fz * scale);
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (result.truck == null) return;

    final truck = result.truck!;
    final cW = truck.interior.widthCm;
    final cD = truck.interior.lengthCm;
    final cH = truck.interior.heightCm;

    final ox = -cW / 2;
    final oy = -cD / 2;
    final oz = -cH / 2;

    final isVan = truck.vehicleType == 'VAN';

    // Draw vehicle silhouette
    _drawVehicleBody(canvas, size, ox, oy, oz, cW, cD, cH, isVan);
    _drawFloorGrid(canvas, size, ox, oy, oz, cW, cD);
    _drawWheels(canvas, size, ox, oy, oz, cW, cD, cH, isVan);

    // Sort and draw boxes
    final sorted = List<PlacedBox>.from(result.placed);
    sorted.sort((a, b) =>
        (a.x + a.y + a.z).compareTo(b.x + b.y + b.z));

    for (final box in sorted) {
      _drawBox(canvas, size, box, ox, oy, oz);
    }

    _drawVolumeLabel(canvas, size);
  }

  // ─── Vehicle Body ─────────────────────────────────────────────────────────

  void _drawVehicleBody(Canvas canvas, Size size, double ox, double oy,
      double oz, double w, double d, double h, bool isVan) {
    final alpha = 0.06 + glowValue * 0.04;

    // --- Cargo area (semi-transparent filled walls) ---
    // Floor
    _drawFace(canvas, size, [
      [ox, oy, oz], [ox + w, oy, oz],
      [ox + w, oy + d, oz], [ox, oy + d, oz],
    ], statusColor.withValues(alpha: alpha + 0.03));

    // Back wall (door)
    _drawFace(canvas, size, [
      [ox, oy, oz], [ox + w, oy, oz],
      [ox + w, oy, oz + h], [ox, oy, oz + h],
    ], statusColor.withValues(alpha: alpha));

    // Left wall
    _drawFace(canvas, size, [
      [ox, oy, oz], [ox, oy + d, oz],
      [ox, oy + d, oz + h], [ox, oy, oz + h],
    ], statusColor.withValues(alpha: alpha * 0.7));

    // Right wall
    _drawFace(canvas, size, [
      [ox + w, oy, oz], [ox + w, oy + d, oz],
      [ox + w, oy + d, oz + h], [ox + w, oy, oz + h],
    ], statusColor.withValues(alpha: alpha * 0.7));

    // Roof (very subtle)
    _drawFace(canvas, size, [
      [ox, oy, oz + h], [ox + w, oy, oz + h],
      [ox + w, oy + d, oz + h], [ox, oy + d, oz + h],
    ], statusColor.withValues(alpha: alpha * 0.3));

    // --- Wireframe edges ---
    final edgePaint = Paint()
      ..color = statusColor.withValues(alpha: 0.2 + glowValue * 0.1)
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;

    final v = [
      project3D(ox, oy, oz, size),
      project3D(ox + w, oy, oz, size),
      project3D(ox + w, oy + d, oz, size),
      project3D(ox, oy + d, oz, size),
      project3D(ox, oy, oz + h, size),
      project3D(ox + w, oy, oz + h, size),
      project3D(ox + w, oy + d, oz + h, size),
      project3D(ox, oy + d, oz + h, size),
    ];

    final edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    for (final e in edges) {
      canvas.drawLine(v[e[0]], v[e[1]], edgePaint);
    }

    // --- Cab ---
    final cabD = d * 0.22;
    final cabW = w;
    final cabOy = oy + d; // front of cargo
    final cabH = isVan ? h : h * 0.85;
    final cabOz = oz;

    // Cab body color
    final cabColor = Colors.blueGrey.withValues(alpha: 0.15);

    if (isVan) {
      // Van: continuous body with sloped windshield
      // Cab back (connects to cargo)
      _drawFace(canvas, size, [
        [ox, cabOy, cabOz], [ox + cabW, cabOy, cabOz],
        [ox + cabW, cabOy, cabOz + cabH], [ox, cabOy, cabOz + cabH],
      ], cabColor);

      // Cab left
      _drawFace(canvas, size, [
        [ox, cabOy, cabOz], [ox, cabOy + cabD, cabOz],
        [ox, cabOy + cabD * 0.7, cabOz + cabH], [ox, cabOy, cabOz + cabH],
      ], cabColor.withValues(alpha: 0.1));

      // Cab right
      _drawFace(canvas, size, [
        [ox + cabW, cabOy, cabOz], [ox + cabW, cabOy + cabD, cabOz],
        [ox + cabW, cabOy + cabD * 0.7, cabOz + cabH],
        [ox + cabW, cabOy, cabOz + cabH],
      ], cabColor.withValues(alpha: 0.1));

      // Windshield (sloped front)
      _drawFace(canvas, size, [
        [ox, cabOy + cabD, cabOz],
        [ox + cabW, cabOy + cabD, cabOz],
        [ox + cabW, cabOy + cabD * 0.7, cabOz + cabH],
        [ox, cabOy + cabD * 0.7, cabOz + cabH],
      ], Colors.lightBlue.withValues(alpha: 0.08));

      // Cab roof
      _drawFace(canvas, size, [
        [ox, cabOy, cabOz + cabH],
        [ox + cabW, cabOy, cabOz + cabH],
        [ox + cabW, cabOy + cabD * 0.7, cabOz + cabH],
        [ox, cabOy + cabD * 0.7, cabOz + cabH],
      ], cabColor.withValues(alpha: 0.08));
    } else {
      // Truck: separate cab below cargo roof height
      // Cab back
      _drawFace(canvas, size, [
        [ox, cabOy, cabOz], [ox + cabW, cabOy, cabOz],
        [ox + cabW, cabOy, cabOz + cabH], [ox, cabOy, cabOz + cabH],
      ], cabColor);

      // Cab floor (same level as cargo)
      _drawFace(canvas, size, [
        [ox, cabOy, cabOz], [ox + cabW, cabOy, cabOz],
        [ox + cabW, cabOy + cabD, cabOz], [ox, cabOy + cabD, cabOz],
      ], cabColor.withValues(alpha: 0.05));

      // Cab left
      _drawFace(canvas, size, [
        [ox, cabOy, cabOz], [ox, cabOy + cabD, cabOz],
        [ox, cabOy + cabD * 0.6, cabOz + cabH], [ox, cabOy, cabOz + cabH],
      ], cabColor.withValues(alpha: 0.1));

      // Cab right
      _drawFace(canvas, size, [
        [ox + cabW, cabOy, cabOz], [ox + cabW, cabOy + cabD, cabOz],
        [ox + cabW, cabOy + cabD * 0.6, cabOz + cabH],
        [ox + cabW, cabOy, cabOz + cabH],
      ], cabColor.withValues(alpha: 0.1));

      // Windshield (angled)
      _drawFace(canvas, size, [
        [ox, cabOy + cabD, cabOz],
        [ox + cabW, cabOy + cabD, cabOz],
        [ox + cabW, cabOy + cabD * 0.6, cabOz + cabH],
        [ox, cabOy + cabD * 0.6, cabOz + cabH],
      ], Colors.lightBlue.withValues(alpha: 0.1));

      // Cab roof
      _drawFace(canvas, size, [
        [ox, cabOy, cabOz + cabH],
        [ox + cabW, cabOy, cabOz + cabH],
        [ox + cabW, cabOy + cabD * 0.6, cabOz + cabH],
        [ox, cabOy + cabD * 0.6, cabOz + cabH],
      ], cabColor.withValues(alpha: 0.08));
    }

    // Cab edges
    final cabEdgePaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.12)
      ..strokeWidth = 0.8
      ..style = PaintingStyle.stroke;

    final slopeEnd = isVan ? cabD * 0.7 : cabD * 0.6;
    final cabVerts = [
      project3D(ox, cabOy, cabOz, size),
      project3D(ox + cabW, cabOy, cabOz, size),
      project3D(ox + cabW, cabOy + cabD, cabOz, size),
      project3D(ox, cabOy + cabD, cabOz, size),
      project3D(ox, cabOy, cabOz + cabH, size),
      project3D(ox + cabW, cabOy, cabOz + cabH, size),
      project3D(ox + cabW, cabOy + slopeEnd, cabOz + cabH, size),
      project3D(ox, cabOy + slopeEnd, cabOz + cabH, size),
    ];

    final cabEdges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (final e in cabEdges) {
      canvas.drawLine(cabVerts[e[0]], cabVerts[e[1]], cabEdgePaint);
    }
  }

  // ─── Wheels ───────────────────────────────────────────────────────────────

  void _drawWheels(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h, bool isVan) {
    final wheelR = h * 0.18;
    final wheelColor = Colors.white.withValues(alpha: 0.15);
    final wheelPaint = Paint()
      ..color = wheelColor
      ..style = PaintingStyle.fill;
    final wheelStroke = Paint()
      ..color = Colors.white.withValues(alpha: 0.25)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    // Wheel positions: left and right side, rear and front
    final wheelPositions = [
      // Rear wheels (at Y=0, back of truck)
      [ox - wheelR * 0.3, oy + d * 0.1, oz],
      [ox + w + wheelR * 0.3, oy + d * 0.1, oz],
      // Front wheels (under cab)
      [ox - wheelR * 0.3, oy + d + d * 0.15, oz],
      [ox + w + wheelR * 0.3, oy + d + d * 0.15, oz],
    ];

    for (final pos in wheelPositions) {
      _drawWheel(canvas, size, pos[0], pos[1], pos[2], wheelR, wheelPaint,
          wheelStroke);
    }
  }

  void _drawWheel(Canvas canvas, Size size, double cx, double cy, double cz,
      double radius, Paint fill, Paint stroke) {
    // Draw wheel as a circle in YZ plane
    const segments = 12;
    final points = <Offset>[];
    for (int i = 0; i <= segments; i++) {
      final angle = (i / segments) * 2 * math.pi;
      final wy = cy + math.cos(angle) * radius * 0.5;
      final wz = cz + math.sin(angle) * radius;
      points.add(project3D(cx, wy, wz, size));
    }

    final path = Path()..moveTo(points[0].dx, points[0].dy);
    for (int i = 1; i < points.length; i++) {
      path.lineTo(points[i].dx, points[i].dy);
    }
    path.close();

    canvas.drawPath(path, fill);
    canvas.drawPath(path, stroke);
  }

  // ─── Floor Grid ───────────────────────────────────────────────────────────

  void _drawFloorGrid(Canvas canvas, Size size, double ox, double oy,
      double oz, double w, double d) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.04)
      ..strokeWidth = 0.5;

    final gridSpacing = math.max(w, d) / 6;
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

  // ─── Cargo Boxes ──────────────────────────────────────────────────────────

  void _drawBox(Canvas canvas, Size size, PlacedBox box, double ox, double oy,
      double oz) {
    final bx = ox + box.x;
    final by = oy + box.y;
    final bz = oz + box.z;

    final hue = (box.orderNumber * 47.0) % 360;
    final isSelected = box.id == selectedBoxId;

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

    final topPaint = Paint()
      ..color = HSLColor.fromAHSL(1, hue, 0.7, isSelected ? 0.55 : 0.5)
          .toColor()
          .withValues(alpha: isSelected ? 0.9 : 0.6);
    final frontPaint = Paint()
      ..color = HSLColor.fromAHSL(1, hue, 0.6, isSelected ? 0.45 : 0.35)
          .toColor()
          .withValues(alpha: isSelected ? 0.9 : 0.7);
    final rightPaint = Paint()
      ..color = HSLColor.fromAHSL(1, hue, 0.5, isSelected ? 0.35 : 0.25)
          .toColor()
          .withValues(alpha: isSelected ? 0.9 : 0.7);

    canvas.drawPath(_pathFromPoints(topFace), topPaint);
    canvas.drawPath(_pathFromPoints(frontFace), frontPaint);
    canvas.drawPath(_pathFromPoints(rightFace), rightPaint);

    final edgePaint = Paint()
      ..color = isSelected
          ? AppTheme.neonBlue.withValues(alpha: 0.9)
          : Colors.white.withValues(alpha: 0.2)
      ..strokeWidth = isSelected ? 2.0 : 0.7
      ..style = PaintingStyle.stroke;

    canvas.drawPath(_pathFromPoints(topFace), edgePaint);
    canvas.drawPath(_pathFromPoints(frontFace), edgePaint);
    canvas.drawPath(_pathFromPoints(rightFace), edgePaint);

    if (isSelected) {
      final glowPaint = Paint()
        ..color = AppTheme.neonBlue.withValues(alpha: 0.3 * glowValue)
        ..strokeWidth = 4
        ..style = PaintingStyle.stroke
        ..maskFilter = const MaskFilter.blur(BlurStyle.outer, 8);
      canvas.drawPath(_pathFromPoints(topFace), glowPaint);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  void _drawFace(Canvas canvas, Size size, List<List<double>> coords,
      Color color) {
    final points = coords
        .map((c) => project3D(c[0], c[1], c[2], size))
        .toList();
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;
    canvas.drawPath(_pathFromPoints(points), paint);
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
        text:
            '${m.placedCount} bultos · ${m.totalWeightKg.toStringAsFixed(0)} kg',
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
