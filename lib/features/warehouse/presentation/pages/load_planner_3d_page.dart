/// LOAD PLANNER 3D PAGE — Tetris Logistico
/// Visualizacion 3D del camion/furgoneta con carga interactiva

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
      _selectedBoxId = null;
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
                'quantity': o.boxes > 0 ? o.boxes.round() : 1,
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
          _selectedBoxId = null;
          _recomputing = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _recomputing = false);
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
      _selectedBoxId = null;
    });
    _loadPlan();
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'EXCESO':
        return Colors.redAccent;
      case 'OPTIMO':
        return Colors.amber;
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
            const Text(
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
              Positioned.fill(
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

              // Recomputing indicator
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
                                strokeWidth: 2, color: AppTheme.neonBlue)),
                        SizedBox(width: 8),
                        Text('Recalculando...',
                            style:
                                TextStyle(color: Colors.white54, fontSize: 11)),
                      ],
                    ),
                  ),
                ),

              // Orders panel
              if (_allOrders.isNotEmpty) _buildOrdersPanel(),
            ],
          ),
        ),

        // Selected box detail
        if (_selectedBoxId != null) _buildSelectedBoxInfo(),

        // Metrics bar
        _buildMetricsBar(result),
      ],
    );
  }

  // ─── Status Bar ─────────────────────────────────────────────────────────

  Widget _buildStatusBar(LoadPlanResult result, Color sColor) {
    final m = result.metrics;
    final pct = m.volumeOccupancyPct;

    String statusText;
    String pctText;

    if (m.status == 'EXCESO') {
      statusText =
          '${m.placedCount} de ${m.totalBoxes} cargados · ${m.overflowCount} no caben';
      pctText = '${pct.toStringAsFixed(0)}%';
    } else if (m.status == 'OPTIMO') {
      statusText = 'CARGA OPTIMA · ${m.placedCount} bultos';
      pctText = '${pct.toStringAsFixed(0)}%';
    } else {
      statusText = 'CARGA SEGURA · ${m.placedCount} bultos';
      pctText = '${pct.toStringAsFixed(0)}%';
    }

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
              statusText,
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
              pctText,
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

  // ─── Metrics Bar ────────────────────────────────────────────────────────

  Widget _buildMetricsBar(LoadPlanResult result) {
    final m = result.metrics;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 14),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        border: Border(
            top:
                BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.2))),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _metricCol(
              Icons.inventory_2_outlined,
              '${m.placedCount}',
              'de ${m.totalBoxes}',
              AppTheme.neonBlue),
          _gaugeCol('VOL', m.volumeOccupancyPct, AppTheme.neonGreen),
          _gaugeCol('PESO', m.weightOccupancyPct, AppTheme.neonPurple),
          _metricCol(
              Icons.fitness_center_outlined,
              '${m.totalWeightKg.toStringAsFixed(0)}',
              '/ ${m.maxPayloadKg.toStringAsFixed(0)} kg',
              Colors.amber),
          if (m.overflowCount > 0)
            _metricCol(
                Icons.warning_amber_rounded,
                '${m.overflowCount}',
                'no caben',
                Colors.redAccent),
        ],
      ),
    );
  }

  Widget _metricCol(IconData icon, String value, String sub, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: color.withValues(alpha: 0.7), size: 14),
        const SizedBox(height: 2),
        Text(value,
            style: TextStyle(
                color: color, fontSize: 15, fontWeight: FontWeight.w800)),
        Text(sub,
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.35),
                fontSize: 9,
                fontWeight: FontWeight.w500)),
      ],
    );
  }

  Widget _gaugeCol(String label, double pct, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 38,
          height: 38,
          child: Stack(
            alignment: Alignment.center,
            children: [
              CircularProgressIndicator(
                value: (pct / 100).clamp(0, 1),
                strokeWidth: 3,
                backgroundColor: color.withValues(alpha: 0.12),
                valueColor: AlwaysStoppedAnimation(
                    pct > 100 ? Colors.redAccent : color),
              ),
              Text(
                '${pct.toInt()}',
                style: TextStyle(
                    color: pct > 100 ? Colors.redAccent : color,
                    fontSize: 10,
                    fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
        const SizedBox(height: 2),
        Text(label,
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.35),
                fontSize: 9,
                fontWeight: FontWeight.w600)),
      ],
    );
  }

  // ─── Selected Box Detail ───────────────────────────────────────────────

  Widget _buildSelectedBoxInfo() {
    final box = _result?.placed.firstWhere(
      (b) => b.id == _selectedBoxId,
      orElse: () => PlacedBox(
          id: -1, label: '', orderNumber: 0, clientCode: '',
          articleCode: '', weight: 0, x: 0, y: 0, z: 0, w: 0, d: 0, h: 0),
    );
    if (box == null || box.id == -1) return const SizedBox.shrink();

    // Find client name from orders
    String clientName = box.clientCode;
    for (final o in _allOrders) {
      if (o.clientCode == box.clientCode && o.clientName.isNotEmpty) {
        clientName = o.clientName;
        break;
      }
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.neonBlue.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.inventory_2_rounded,
                    color: AppTheme.neonBlue, size: 16),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  box.label.isNotEmpty ? box.label : box.articleCode,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close_rounded,
                    color: Colors.white38, size: 18),
                onPressed: () => setState(() => _selectedBoxId = null),
                constraints: const BoxConstraints(),
                padding: EdgeInsets.zero,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              _infoChip(Icons.receipt_long_outlined,
                  'Pedido #${box.orderNumber}', AppTheme.neonGreen),
              const SizedBox(width: 8),
              Expanded(
                child: _infoChip(
                    Icons.store_outlined, clientName, AppTheme.neonPurple),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              _infoChip(Icons.fitness_center_outlined,
                  '${box.weight.toStringAsFixed(1)} kg', Colors.amber),
              const SizedBox(width: 8),
              _infoChip(Icons.straighten_outlined,
                  '${box.w.toInt()}x${box.d.toInt()}x${box.h.toInt()} cm',
                  Colors.white54),
              const SizedBox(width: 8),
              _infoChip(Icons.place_outlined,
                  '(${box.x.toInt()},${box.y.toInt()},${box.z.toInt()})',
                  Colors.white38),
            ],
          ),
        ],
      ),
    );
  }

  Widget _infoChip(IconData icon, String text, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: color.withValues(alpha: 0.7), size: 12),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            text,
            style: TextStyle(
                color: color.withValues(alpha: 0.8),
                fontSize: 11,
                fontWeight: FontWeight.w500),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
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
            border:
                Border.all(color: AppTheme.neonBlue.withValues(alpha: 0.15)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.5),
                blurRadius: 16,
                offset: const Offset(0, -4),
              ),
            ],
          ),
          child: ListView(
            controller: scrollController,
            padding: EdgeInsets.zero,
            children: [
              // Drag handle
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 8, bottom: 4),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              // Header
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Row(
                  children: [
                    Icon(Icons.list_alt_rounded,
                        color: AppTheme.neonBlue.withValues(alpha: 0.8),
                        size: 16),
                    const SizedBox(width: 6),
                    Text(
                      'PRODUCTOS',
                      style: TextStyle(
                        color: AppTheme.neonBlue,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        '$activeCount / ${_allOrders.length}',
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
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: Colors.amber.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Text('Restaurar todo',
                              style: TextStyle(
                                  color: Colors.amber,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600)),
                        ),
                      ),
                    const SizedBox(width: 4),
                    const Icon(Icons.keyboard_arrow_up_rounded,
                        color: Colors.white24, size: 20),
                  ],
                ),
              ),
              const Divider(color: Colors.white10, height: 1),

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
    final weight = order.units * order.weightPerUnit;
    return Dismissible(
      key: ValueKey('order_$index'),
      direction:
          excluded ? DismissDirection.none : DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: Colors.redAccent.withValues(alpha: 0.2),
        child: const Icon(Icons.remove_circle_outline,
            color: Colors.redAccent, size: 20),
      ),
      onDismissed: (_) => _removeOrder(index),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          border: Border(
              bottom:
                  BorderSide(color: Colors.white.withValues(alpha: 0.04))),
        ),
        child: Row(
          children: [
            // Article info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    order.articleName.isNotEmpty
                        ? order.articleName
                        : order.articleCode,
                    style: TextStyle(
                      color: excluded
                          ? Colors.white.withValues(alpha: 0.25)
                          : Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      decoration:
                          excluded ? TextDecoration.lineThrough : null,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 1),
                  Text(
                    '${order.clientName.isNotEmpty ? order.clientName : order.clientCode} · #${order.orderNumber}',
                    style: TextStyle(
                      color: excluded
                          ? Colors.white.withValues(alpha: 0.1)
                          : Colors.white.withValues(alpha: 0.35),
                      fontSize: 10,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            // Quantity + weight
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  order.boxes > 0
                      ? '${order.boxes.toStringAsFixed(0)} cajas'
                      : '${order.units.toStringAsFixed(order.units == order.units.roundToDouble() ? 0 : 1)} uds',
                  style: TextStyle(
                    color: excluded
                        ? Colors.white.withValues(alpha: 0.15)
                        : AppTheme.neonGreen,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (weight > 0)
                  Text(
                    '${weight.toStringAsFixed(1)} kg',
                    style: TextStyle(
                      color: excluded
                          ? Colors.white.withValues(alpha: 0.1)
                          : Colors.white.withValues(alpha: 0.3),
                      fontSize: 9,
                    ),
                  ),
              ],
            ),
            const SizedBox(width: 8),
            // Remove / restore button
            if (excluded)
              GestureDetector(
                onTap: () => _restoreOrder(index),
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    color: AppTheme.neonGreen.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Icon(Icons.add_rounded,
                      color: AppTheme.neonGreen, size: 16),
                ),
              )
            else
              GestureDetector(
                onTap: () => _removeOrder(index),
                child: Icon(Icons.remove_circle_outline,
                    color: Colors.white.withValues(alpha: 0.15), size: 18),
              ),
          ],
        ),
      ),
    );
  }

  // ─── Tap Handler ────────────────────────────────────────────────────────

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
// CUSTOM PAINTER — Vehiculo 3D con cabina, ruedas y carga
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
    final cy = size.height * 0.52;

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

    // 1. Vehicle body + cab
    _drawVehicleBody(canvas, size, ox, oy, oz, cW, cD, cH, isVan);

    // 2. Floor grid
    _drawFloorGrid(canvas, size, ox, oy, oz, cW, cD);

    // 3. Wheels
    _drawWheels(canvas, size, ox, oy, oz, cW, cD, cH, isVan);

    // 4. Cargo boxes (sorted far to near)
    final sorted = List<PlacedBox>.from(result.placed);
    sorted.sort(
        (a, b) => (a.x + a.y + a.z).compareTo(b.x + b.y + b.z));
    for (final box in sorted) {
      _drawBox(canvas, size, box, ox, oy, oz);
    }

    // 5. Info label
    _drawVolumeLabel(canvas, size);
  }

  // ─── Vehicle Body ─────────────────────────────────────────────────────

  void _drawVehicleBody(Canvas canvas, Size size, double ox, double oy,
      double oz, double w, double d, double h, bool isVan) {
    final a = 0.05 + glowValue * 0.03;

    // Cargo area — filled walls
    _fillFace(canvas, size,
        [[ox, oy, oz], [ox + w, oy, oz], [ox + w, oy + d, oz], [ox, oy + d, oz]],
        statusColor.withValues(alpha: a + 0.02)); // floor
    _fillFace(canvas, size,
        [[ox, oy, oz], [ox + w, oy, oz], [ox + w, oy, oz + h], [ox, oy, oz + h]],
        statusColor.withValues(alpha: a)); // back wall (doors)
    _fillFace(canvas, size,
        [[ox, oy, oz], [ox, oy + d, oz], [ox, oy + d, oz + h], [ox, oy, oz + h]],
        statusColor.withValues(alpha: a * 0.6)); // left wall
    _fillFace(canvas, size,
        [[ox + w, oy, oz], [ox + w, oy + d, oz], [ox + w, oy + d, oz + h], [ox + w, oy, oz + h]],
        statusColor.withValues(alpha: a * 0.6)); // right wall
    _fillFace(canvas, size,
        [[ox, oy, oz + h], [ox + w, oy, oz + h], [ox + w, oy + d, oz + h], [ox, oy + d, oz + h]],
        statusColor.withValues(alpha: a * 0.2)); // roof

    // Wireframe edges
    _drawEdges12(canvas, size, ox, oy, oz, w, d, h,
        statusColor.withValues(alpha: 0.15 + glowValue * 0.1), 1.2);

    // ── Cab ──
    final cabD = d * 0.22;
    final cabOy = oy + d;
    final cabH = isVan ? h : h * 0.85;
    final slopeRatio = isVan ? 0.65 : 0.55;
    final cabColor = Colors.blueGrey;

    // Cab walls
    _fillFace(canvas, size,
        [[ox, cabOy, oz], [ox + w, cabOy, oz], [ox + w, cabOy, oz + cabH], [ox, cabOy, oz + cabH]],
        cabColor.withValues(alpha: 0.12));
    _fillFace(canvas, size,
        [[ox, cabOy, oz], [ox, cabOy + cabD, oz], [ox, cabOy + cabD * slopeRatio, oz + cabH], [ox, cabOy, oz + cabH]],
        cabColor.withValues(alpha: 0.08));
    _fillFace(canvas, size,
        [[ox + w, cabOy, oz], [ox + w, cabOy + cabD, oz], [ox + w, cabOy + cabD * slopeRatio, oz + cabH], [ox + w, cabOy, oz + cabH]],
        cabColor.withValues(alpha: 0.08));
    // Windshield
    _fillFace(canvas, size,
        [[ox, cabOy + cabD, oz], [ox + w, cabOy + cabD, oz], [ox + w, cabOy + cabD * slopeRatio, oz + cabH], [ox, cabOy + cabD * slopeRatio, oz + cabH]],
        Colors.lightBlue.withValues(alpha: 0.08));
    // Cab roof
    _fillFace(canvas, size,
        [[ox, cabOy, oz + cabH], [ox + w, cabOy, oz + cabH], [ox + w, cabOy + cabD * slopeRatio, oz + cabH], [ox, cabOy + cabD * slopeRatio, oz + cabH]],
        cabColor.withValues(alpha: 0.06));
    // Cab floor
    _fillFace(canvas, size,
        [[ox, cabOy, oz], [ox + w, cabOy, oz], [ox + w, cabOy + cabD, oz], [ox, cabOy + cabD, oz]],
        cabColor.withValues(alpha: 0.04));

    // Cab wireframe
    final cv = [
      project3D(ox, cabOy, oz, size),
      project3D(ox + w, cabOy, oz, size),
      project3D(ox + w, cabOy + cabD, oz, size),
      project3D(ox, cabOy + cabD, oz, size),
      project3D(ox, cabOy, oz + cabH, size),
      project3D(ox + w, cabOy, oz + cabH, size),
      project3D(ox + w, cabOy + cabD * slopeRatio, oz + cabH, size),
      project3D(ox, cabOy + cabD * slopeRatio, oz + cabH, size),
    ];
    final cabEdgePaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.1)
      ..strokeWidth = 0.8
      ..style = PaintingStyle.stroke;
    for (final e in [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
      canvas.drawLine(cv[e[0]], cv[e[1]], cabEdgePaint);
    }
  }

  void _drawEdges12(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h, Color color, double strokeWidth) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = strokeWidth
      ..style = PaintingStyle.stroke;
    final v = [
      project3D(ox, oy, oz, size), project3D(ox + w, oy, oz, size),
      project3D(ox + w, oy + d, oz, size), project3D(ox, oy + d, oz, size),
      project3D(ox, oy, oz + h, size), project3D(ox + w, oy, oz + h, size),
      project3D(ox + w, oy + d, oz + h, size), project3D(ox, oy + d, oz + h, size),
    ];
    for (final e in [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
      canvas.drawLine(v[e[0]], v[e[1]], paint);
    }
  }

  // ─── Wheels ───────────────────────────────────────────────────────────

  void _drawWheels(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h, bool isVan) {
    final r = h * 0.16;
    final fill = Paint()..color = Colors.white.withValues(alpha: 0.1);
    final stroke = Paint()
      ..color = Colors.white.withValues(alpha: 0.2)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.8;

    // Rear axle
    _drawWheel(canvas, size, ox - r * 0.2, oy + d * 0.12, oz, r, fill, stroke);
    _drawWheel(canvas, size, ox + w + r * 0.2, oy + d * 0.12, oz, r, fill, stroke);
    // Front axle (under cab)
    _drawWheel(canvas, size, ox - r * 0.2, oy + d + d * 0.12, oz, r, fill, stroke);
    _drawWheel(canvas, size, ox + w + r * 0.2, oy + d + d * 0.12, oz, r, fill, stroke);
  }

  void _drawWheel(Canvas canvas, Size size, double cx, double cy, double cz,
      double radius, Paint fill, Paint stroke) {
    const seg = 12;
    final pts = <Offset>[];
    for (int i = 0; i <= seg; i++) {
      final a = (i / seg) * 2 * math.pi;
      pts.add(project3D(
          cx, cy + math.cos(a) * radius * 0.4, cz + math.sin(a) * radius, size));
    }
    final path = Path()..moveTo(pts[0].dx, pts[0].dy);
    for (int i = 1; i < pts.length; i++) {
      path.lineTo(pts[i].dx, pts[i].dy);
    }
    path.close();
    canvas.drawPath(path, fill);
    canvas.drawPath(path, stroke);
  }

  // ─── Floor Grid ───────────────────────────────────────────────────────

  void _drawFloorGrid(Canvas canvas, Size size, double ox, double oy,
      double oz, double w, double d) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.03)
      ..strokeWidth = 0.5;
    final sp = math.max(w, d) / 5;
    for (double x = 0; x <= w; x += sp) {
      canvas.drawLine(
          project3D(ox + x, oy, oz, size), project3D(ox + x, oy + d, oz, size), paint);
    }
    for (double y = 0; y <= d; y += sp) {
      canvas.drawLine(
          project3D(ox, oy + y, oz, size), project3D(ox + w, oy + y, oz, size), paint);
    }
  }

  // ─── Cargo Box ────────────────────────────────────────────────────────

  void _drawBox(Canvas canvas, Size size, PlacedBox box, double ox,
      double oy, double oz) {
    final bx = ox + box.x;
    final by = oy + box.y;
    final bz = oz + box.z;

    final hue = (box.orderNumber * 47.0) % 360;
    final sel = box.id == selectedBoxId;

    final top = [
      project3D(bx, by, bz + box.h, size),
      project3D(bx + box.w, by, bz + box.h, size),
      project3D(bx + box.w, by + box.d, bz + box.h, size),
      project3D(bx, by + box.d, bz + box.h, size),
    ];
    final front = [
      project3D(bx, by, bz, size),
      project3D(bx + box.w, by, bz, size),
      project3D(bx + box.w, by, bz + box.h, size),
      project3D(bx, by, bz + box.h, size),
    ];
    final right = [
      project3D(bx + box.w, by, bz, size),
      project3D(bx + box.w, by + box.d, bz, size),
      project3D(bx + box.w, by + box.d, bz + box.h, size),
      project3D(bx + box.w, by, bz + box.h, size),
    ];

    canvas.drawPath(_path(top), Paint()
      ..color = HSLColor.fromAHSL(1, hue, 0.7, sel ? 0.55 : 0.5)
          .toColor().withValues(alpha: sel ? 0.9 : 0.65));
    canvas.drawPath(_path(front), Paint()
      ..color = HSLColor.fromAHSL(1, hue, 0.6, sel ? 0.42 : 0.35)
          .toColor().withValues(alpha: sel ? 0.9 : 0.7));
    canvas.drawPath(_path(right), Paint()
      ..color = HSLColor.fromAHSL(1, hue, 0.5, sel ? 0.32 : 0.25)
          .toColor().withValues(alpha: sel ? 0.9 : 0.7));

    final ep = Paint()
      ..color = sel
          ? AppTheme.neonBlue.withValues(alpha: 0.9)
          : Colors.white.withValues(alpha: 0.15)
      ..strokeWidth = sel ? 1.8 : 0.6
      ..style = PaintingStyle.stroke;
    canvas.drawPath(_path(top), ep);
    canvas.drawPath(_path(front), ep);
    canvas.drawPath(_path(right), ep);

    if (sel) {
      canvas.drawPath(_path(top), Paint()
        ..color = AppTheme.neonBlue.withValues(alpha: 0.3 * glowValue)
        ..strokeWidth = 4
        ..style = PaintingStyle.stroke
        ..maskFilter = const MaskFilter.blur(BlurStyle.outer, 8));
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  void _fillFace(Canvas canvas, Size size, List<List<double>> pts, Color c) {
    final offsets = pts.map((p) => project3D(p[0], p[1], p[2], size)).toList();
    canvas.drawPath(_path(offsets), Paint()..color = c);
  }

  Path _path(List<Offset> pts) {
    final p = Path()..moveTo(pts[0].dx, pts[0].dy);
    for (int i = 1; i < pts.length; i++) {
      p.lineTo(pts[i].dx, pts[i].dy);
    }
    p.close();
    return p;
  }

  void _drawVolumeLabel(Canvas canvas, Size size) {
    final m = result.metrics;
    final truck = result.truck!;
    final tp = TextPainter(
      text: TextSpan(
        text:
            '${m.placedCount} bultos · ${m.totalWeightKg.toStringAsFixed(0)} / ${m.maxPayloadKg.toStringAsFixed(0)} kg · ${truck.interior.lengthCm.toInt()}x${truck.interior.widthCm.toInt()}x${truck.interior.heightCm.toInt()} cm',
        style: TextStyle(
          color: Colors.white.withValues(alpha: 0.25),
          fontSize: 10,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset(10, size.height - 20));
  }

  @override
  bool shouldRepaint(covariant _TruckLoadPainter old) => true;
}
