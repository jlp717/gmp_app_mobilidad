/// TETRIS LOGISTICO 3D v2 — Premium multi-view load planner
/// Features: 3D/Top/Front views, improved gestures, color legend

import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/warehouse_data_service.dart';
import '../painters/projection_3d.dart';
import '../painters/truck_3d_painter.dart';
import '../widgets/load_planner_panel.dart';

enum ViewMode { perspective, top, front }

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════════

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

  // Orders
  List<TruckOrder> _allOrders = [];
  Set<int> _excludedIndices = {};
  bool _isManualMode = false;
  bool _recomputing = false;
  bool _optimizing = false;
  bool _saving = false;
  Timer? _debounce;

  // 3D Camera
  double _rotX = -0.45, _rotY = 0.6, _zoom = 1.0;
  Offset _panOffset = Offset.zero;
  Offset _lastFocalPoint = Offset.zero;
  double _baseZoom = 1.0;

  // Color mode
  ColorMode _colorMode = ColorMode.product;
  ViewMode _viewMode = ViewMode.perspective;

  // Loading animation
  late AnimationController _glowCtrl;
  AnimationController? _loadAnimCtrl;
  int _animatedBoxCount = -1; // -1 = show all

  @override
  void initState() {
    super.initState();
    _glowCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 1500))
      ..repeat(reverse: true);
    _loadPlan();
  }

  @override
  void dispose() {
    _glowCtrl.dispose();
    _loadAnimCtrl?.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  // ─── Data loading ───────────────────────────────────────────────────────

  Future<void> _loadPlan() async {
    setState(() {
      _loading = true;
      _error = null;
      _isManualMode = false;
      _excludedIndices = {};
      _selectedBoxId = null;
      _animatedBoxCount = -1;
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
      final active = _allOrders
          .asMap()
          .entries
          .where((e) => !_excludedIndices.contains(e.key))
          .map((e) => e.value);
      final items = active
          .map((o) => <String, dynamic>{
                'articleCode': o.articleCode,
                'quantity': o.boxes > 0 ? o.boxes.round() : 1,
                'orderNumber': o.orderNumber,
                'clientCode': o.clientCode,
                'label': o.articleName,
              })
          .toList();
      final r = await WarehouseDataService.planLoadManual(
          vehicleCode: widget.vehicleCode, items: items);
      if (mounted) {
        setState(() {
          _result = r;
          _selectedBoxId = null;
          _recomputing = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _recomputing = false);
    }
  }

  void _removeOrder(int i) {
    setState(() {
      _excludedIndices.add(i);
      _isManualMode = true;
      _selectedBoxId = null;
    });
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _rerunPacking);
  }

  void _restoreOrder(int i) {
    setState(() {
      _excludedIndices.remove(i);
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
      _animatedBoxCount = -1;
    });
    _loadPlan();
  }

  // ─── Smart optimize ──────────────────────────────────────────────────

  Future<void> _smartOptimize() async {
    if (_optimizing) return;
    setState(() => _optimizing = true);
    try {
      final r = await WarehouseDataService.smartOptimize(
        vehicleCode: widget.vehicleCode,
        year: widget.date.year,
        month: widget.date.month,
        day: widget.date.day,
      );
      if (mounted) {
        setState(() {
          _result = r;
          _selectedBoxId = null;
          _optimizing = false;
          _isManualMode = true;
        });
        _playLoadAnimation();
        _showTruckFullModal(r);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _optimizing = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al optimizar: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    }
  }

  Future<void> _saveLoad() async {
    if (_saving || _result == null) return;
    setState(() => _saving = true);
    try {
      final r = _result!;
      final m = r.metrics;
      final placedMaps = r.placed.map((b) => {
        'clientCode': b.clientCode,
        'clientName': b.label,
        'articleCode': b.articleCode,
        'label': b.label,
        'weight': b.weight,
        'importeEur': b.importeEur,
        'margenEur': b.margenEur,
      }).toList();
      final overflowMaps = r.overflow.map((b) => {
        'clientCode': b.clientCode,
        'clientName': b.label,
        'articleCode': b.articleCode,
        'label': b.label,
        'weight': b.weight,
        'importeEur': b.importeEur,
        'margenEur': b.margenEur,
      }).toList();

      await WarehouseDataService.saveLoad(
        vehicleCode: widget.vehicleCode,
        year: widget.date.year,
        month: widget.date.month,
        day: widget.date.day,
        metrics: {
          'totalWeightKg': m.totalWeightKg,
          'usedVolumeCm3': m.usedVolumeCm3,
          'volumeOccupancyPct': m.volumeOccupancyPct,
          'weightOccupancyPct': m.weightOccupancyPct,
          'placedCount': m.placedCount,
          'totalBoxes': m.totalBoxes,
          'status': m.status,
          'totalImporteEur': m.totalImporteEur,
          'totalMargenEur': m.totalMargenEur,
        },
        placed: placedMaps,
        overflow: overflowMaps,
      );
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Carga guardada correctamente'),
            backgroundColor: Color(0xFF4CAF50),
            duration: Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al guardar: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    }
  }

  void _showTruckFullModal(LoadPlanResult r) {
    final m = r.metrics;
    final isFull =
        m.volumeOccupancyPct > 85 || m.weightOccupancyPct > 85;
    final sc = _statusColor(m.status);

    // Calculate balance
    final t = r.truck;
    final cL = t != null
        ? math.max(t.interior.lengthCm, 250.0)
        : 250.0;
    final cW = t != null
        ? math.max(t.interior.widthCm, 160.0)
        : 160.0;
    final axle =
        AxleBalanceHelper.axleDistribution(r.placed, cL);
    final lat =
        AxleBalanceHelper.lateralDistribution(r.placed, cW);
    final balanced =
        AxleBalanceHelper.isBalanced(r.placed, cL, cW);
    final bc = balanced ? AppTheme.neonGreen : Colors.amber;

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        margin: const EdgeInsets.all(12),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: AppTheme.darkCard.withValues(alpha: 0.98),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: sc.withValues(alpha: 0.5),
            width: 2,
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isFull
                  ? Icons.check_circle_rounded
                  : Icons.auto_awesome_rounded,
              color: sc,
              size: 48,
            ),
            const SizedBox(height: 12),
            Text(
              isFull
                  ? 'CAMION OPTIMIZADO'
                  : 'OPTIMIZACION COMPLETADA',
              style: TextStyle(
                color: sc,
                fontSize: 18,
                fontWeight: FontWeight.w800,
                letterSpacing: 1,
              ),
            ),
            const SizedBox(height: 16),
            _optimizeStatRow(
              'Bultos cargados',
              '${m.placedCount}/${m.totalBoxes}',
              AppTheme.neonBlue,
            ),
            _optimizeStatRow(
              'Volumen ocupado',
              '${m.volumeOccupancyPct.toStringAsFixed(1)}%',
              m.volumeOccupancyPct > 85
                  ? Colors.amber
                  : AppTheme.neonGreen,
            ),
            _optimizeStatRow(
              'Peso cargado',
              '${m.totalWeightKg.toStringAsFixed(0)}/'
                  '${m.maxPayloadKg.toStringAsFixed(0)} kg',
              m.weightOccupancyPct > 85
                  ? Colors.amber
                  : AppTheme.neonGreen,
            ),
            if (m.overflowCount > 0)
              _optimizeStatRow(
                'Sin espacio',
                '${m.overflowCount} bultos '
                    '(${m.overflowWeightKg.toStringAsFixed(0)} kg)',
                Colors.redAccent,
              ),
            // EUR economic data
            if (m.totalImporteEur > 0) ...[
              const SizedBox(height: 4),
              _optimizeStatRow(
                'Valor cargado',
                '${m.totalImporteEur.toStringAsFixed(2)} €',
                const Color(0xFF4CAF50),
              ),
              if (m.totalMargenEur > 0)
                _optimizeStatRow(
                  'Margen real',
                  '${m.totalMargenEur.toStringAsFixed(2)} €',
                  const Color(0xFF66BB6A),
                ),
              if (m.overflowImporteEur > 0)
                _optimizeStatRow(
                  'Valor excluido',
                  '${m.overflowImporteEur.toStringAsFixed(2)} €',
                  Colors.redAccent,
                ),
            ],
            // Axle balance section
            if (r.placed.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Divider(color: Colors.white10),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(
                    balanced
                        ? Icons.balance_rounded
                        : Icons.warning_amber_rounded,
                    color: bc,
                    size: 16,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'EQUILIBRIO DE EJES',
                    style: TextStyle(
                      color: bc,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: bc.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      balanced ? 'OK' : 'REVISAR',
                      style: TextStyle(
                        color: bc,
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _balanceItem(
                    'Frontal',
                    '${axle['frontPct']!.round()}%',
                    bc,
                  ),
                  _balanceItem(
                    'Trasero',
                    '${axle['rearPct']!.round()}%',
                    axle['rearPct']! > 65
                        ? Colors.redAccent
                        : bc,
                  ),
                  _balanceItem(
                    'Izquierda',
                    '${lat['leftPct']!.round()}%',
                    bc,
                  ),
                  _balanceItem(
                    'Derecha',
                    '${lat['rightPct']!.round()}%',
                    bc,
                  ),
                ],
              ),
            ],
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: () => Navigator.pop(ctx),
              icon: const Icon(Icons.close_rounded),
              label: const Text('Cerrar'),
              style: ElevatedButton.styleFrom(
                backgroundColor: sc.withValues(alpha: 0.2),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(
                  horizontal: 30,
                  vertical: 12,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _balanceItem(String label, String value, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.35),
            fontSize: 8,
          ),
        ),
      ],
    );
  }

  Widget _optimizeStatRow(String label, String value, Color color) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(color: Colors.white54, fontSize: 14),
          ),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  // ─── Loading animation ────────────────────────────────────────────────

  void _playLoadAnimation() {
    if (_result == null || _result!.placed.isEmpty) return;
    _loadAnimCtrl?.dispose();
    _animatedBoxCount = 0;

    _loadAnimCtrl = AnimationController(
      vsync: this,
      duration: Duration(
          milliseconds: math.min(3000, _result!.placed.length * 60)),
    )..addListener(() {
        final count =
            (_loadAnimCtrl!.value * _result!.placed.length).round();
        if (count != _animatedBoxCount) {
          setState(() => _animatedBoxCount = count);
        }
      });
    _loadAnimCtrl!.forward().whenComplete(() {
      if (mounted) setState(() => _animatedBoxCount = -1);
    });
  }

  // ─── Color mode ───────────────────────────────────────────────────────

  Color _statusColor(String s) => s == 'EXCESO'
      ? Colors.redAccent
      : s == 'OPTIMO'
          ? Colors.amber
          : AppTheme.neonGreen;

  // ─── Tap / Hit test ───────────────────────────────────────────────────

  void _handleTap(TapUpDetails details) {
    if (_result == null || _result!.placed.isEmpty) return;
    final t = _result!.truck!;
    final cW = math.max(t.interior.widthCm, 160.0);
    final cD = math.max(t.interior.lengthCm, 250.0);
    final cH = math.max(t.interior.heightCm, 150.0);
    final ox = -cW / 2, oy = -cD / 2, oz = -cH / 2;

    final proj = Projection3D(
        rotX: _rotX, rotY: _rotY, zoom: _zoom, panOffset: _panOffset);
    final canvasSize = context.size ?? Size.zero;

    final hit = HitTester.hitTest(
      tapPoint: details.localPosition,
      canvasSize: canvasSize,
      boxes: _result!.placed,
      proj: proj,
      ox: ox,
      oy: oy,
      oz: oz,
    );

    setState(() {
      if (hit != null) {
        _selectedBoxId = hit.id;
        _showBoxModal(hit);
      } else {
        _selectedBoxId = null;
      }
    });
  }

  // ─── Box modal ────────────────────────────────────────────────────────

  void _showBoxModal(PlacedBox box) {
    String client = box.clientCode;
    for (final o in _allOrders) {
      if (o.clientCode == box.clientCode && o.clientName.isNotEmpty) {
        client = o.clientName;
        break;
      }
    }
    final cc = CargoColors.byProduct(box.articleCode);

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => Container(
        margin: const EdgeInsets.all(12),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: AppTheme.darkCard.withValues(alpha: 0.98),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: cc.withValues(alpha: 0.5), width: 2),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                    color: cc.withValues(alpha: 0.2), shape: BoxShape.circle),
                child: Icon(Icons.inventory_2_rounded, color: cc, size: 28),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                          box.label.isNotEmpty
                              ? box.label
                              : box.articleCode,
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text('Pedido #${box.orderNumber}',
                          style: const TextStyle(
                              color: AppTheme.neonBlue,
                              fontWeight: FontWeight.w600)),
                    ]),
              ),
            ]),
            const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Divider(color: Colors.white24)),
            _modalRow(Icons.business_center_rounded, 'Cliente', client),
            _modalRow(Icons.straighten_rounded, 'Dimensiones',
                '${box.w.toInt()} x ${box.d.toInt()} x ${box.h.toInt()} cm'),
            _modalRow(Icons.scale_rounded, 'Peso',
                '${box.weight.toStringAsFixed(1)} kg'),
            _modalRow(Icons.location_on_rounded, 'Posicion',
                'X:${box.x.toInt()} Y:${box.y.toInt()} Z:${box.z.toInt()} cm'),
            const SizedBox(height: 20),
            Center(
              child: ElevatedButton.icon(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded),
                label: const Text('Cerrar'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: cc.withValues(alpha: 0.2),
                  foregroundColor: Colors.white,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 30, vertical: 12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _modalRow(IconData icon, String label, String value,
      {Color color = Colors.white70}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(children: [
        Icon(icon, color: Colors.white54, size: 20),
        const SizedBox(width: 12),
        Text('$label:', style: const TextStyle(color: Colors.white54, fontSize: 14)),
        const SizedBox(width: 8),
        Expanded(
            child: Text(value,
                style: TextStyle(
                    color: color,
                    fontSize: 15,
                    fontWeight: FontWeight.w600))),
      ]),
    );
  }

  // ─── Drag & Drop accept ──────────────────────────────────────────────

  void _onDragAccepted(TruckOrder order) {
    final idx = _allOrders.indexOf(order);
    if (idx >= 0 && _excludedIndices.contains(idx)) {
      _restoreOrder(idx);
    }
  }

  // ─── Build ────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: AppTheme.darkBase,
        elevation: 0,
        leading: IconButton(
            icon: const Icon(Icons.arrow_back_rounded, color: Colors.white70),
            onPressed: () => Navigator.pop(context)),
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('TETRIS LOGISTICO 3D',
              style: TextStyle(
                  color: AppTheme.neonBlue,
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.5)),
          Text(
            '${widget.vehicleCode} · ${widget.vehicleName}',
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.5), fontSize: 12),
          ),
        ]),
        actions: [
          // Color mode toggle
          PopupMenuButton<ColorMode>(
            icon: Icon(
              _colorMode == ColorMode.product
                  ? Icons.palette_rounded
                  : _colorMode == ColorMode.client
                      ? Icons.people_rounded
                      : Icons.thermostat_rounded,
              color: AppTheme.neonPurple,
              size: 20,
            ),
            color: AppTheme.darkCard,
            onSelected: (mode) => setState(() => _colorMode = mode),
            itemBuilder: (_) => [
              PopupMenuItem(
                value: ColorMode.product,
                child: Row(children: [
                  Icon(Icons.palette_rounded,
                      color: _colorMode == ColorMode.product
                          ? AppTheme.neonBlue
                          : Colors.white54,
                      size: 18),
                  const SizedBox(width: 8),
                  Text('Por Producto',
                      style: TextStyle(
                          color: _colorMode == ColorMode.product
                              ? AppTheme.neonBlue
                              : Colors.white70,
                          fontSize: 13)),
                ]),
              ),
              PopupMenuItem(
                value: ColorMode.client,
                child: Row(children: [
                  Icon(Icons.people_rounded,
                      color: _colorMode == ColorMode.client
                          ? AppTheme.neonBlue
                          : Colors.white54,
                      size: 18),
                  const SizedBox(width: 8),
                  Text('Por Cliente',
                      style: TextStyle(
                          color: _colorMode == ColorMode.client
                              ? AppTheme.neonBlue
                              : Colors.white70,
                          fontSize: 13)),
                ]),
              ),
              PopupMenuItem(
                value: ColorMode.heatmap,
                child: Row(children: [
                  Icon(Icons.thermostat_rounded,
                      color: _colorMode == ColorMode.heatmap
                          ? AppTheme.neonBlue
                          : Colors.white54,
                      size: 18),
                  const SizedBox(width: 8),
                  Text('Mapa de Peso',
                      style: TextStyle(
                          color: _colorMode == ColorMode.heatmap
                              ? AppTheme.neonBlue
                              : Colors.white70,
                          fontSize: 13)),
                ]),
              ),
            ],
          ),
          // View mode toggle
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 4),
            decoration: BoxDecoration(
              color: AppTheme.darkCard.withValues(alpha: 0.6),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              _viewModeBtn(ViewMode.perspective, Icons.view_in_ar_rounded, '3D'),
              _viewModeBtn(ViewMode.top, Icons.grid_on_rounded, 'Sup'),
              _viewModeBtn(ViewMode.front, Icons.view_agenda_rounded, 'Front'),
            ]),
          ),
          // Smart optimize button
          IconButton(
            onPressed: _optimizing ? null : _smartOptimize,
            icon: _optimizing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppTheme.neonGreen,
                    ),
                  )
                : const Icon(
                    Icons.auto_awesome_rounded,
                    color: AppTheme.neonGreen,
                    size: 22,
                  ),
            tooltip: 'Auto-Organizar (max margen)',
          ),
          // Play animation
          IconButton(
            onPressed: _playLoadAnimation,
            icon: const Icon(Icons.play_circle_outline_rounded,
                color: AppTheme.neonPurple, size: 22),
            tooltip: 'Animacion de carga',
          ),
          if (_isManualMode)
            IconButton(
                onPressed: _resetOrders,
                icon: const Icon(Icons.restart_alt_rounded,
                    color: Colors.amber, size: 22)),
          // Save to DB button
          IconButton(
            onPressed: (_saving || _result == null)
                ? null
                : _saveLoad,
            icon: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.amber,
                    ),
                  )
                : const Icon(
                    Icons.save_rounded,
                    color: Colors.amber,
                    size: 22,
                  ),
            tooltip: 'Guardar carga en BBDD',
          ),
          IconButton(
              onPressed: _loadPlan,
              icon: const Icon(Icons.refresh_rounded,
                  color: AppTheme.neonGreen)),
        ],
      ),
      body: _loading
          ? const Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
              CircularProgressIndicator(color: AppTheme.neonBlue),
              SizedBox(height: 16),
              Text('Calculando carga...',
                  style: TextStyle(color: Colors.white54, fontSize: 14)),
            ]))
          : _error != null
              ? _buildError()
              : _buildContent(),
    );
  }

  Widget _buildContent() {
    final r = _result!;
    final sc = _statusColor(r.metrics.status);
    final m = r.metrics;
    final isWide = MediaQuery.of(context).size.width > 600;

    final volPct = m.containerVolumeCm3 > 0
        ? (m.usedVolumeCm3 / m.containerVolumeCm3 * 100).clamp(0, 100)
        : 0.0;
    final wgtPct = m.maxPayloadKg > 0
        ? (m.totalWeightKg / m.maxPayloadKg * 100).clamp(0, 100)
        : 0.0;

    // 3D Canvas with DragTarget
    final canvas3D = Stack(children: [
      Positioned.fill(
        child: DragTarget<TruckOrder>(
          onAcceptWithDetails: (details) => _onDragAccepted(details.data),
          onWillAcceptWithDetails: (_) => true,
          builder: (context, candidateData, rejectedData) {
            return Stack(children: [
              Positioned.fill(
                child: GestureDetector(
                  // FIXED: Use only onScale* to avoid gesture arena conflict
                  onScaleStart: (d) {
                    _lastFocalPoint = d.localFocalPoint;
                    _baseZoom = _zoom;
                  },
                  onScaleUpdate: (d) {
                    setState(() {
                      if (d.pointerCount == 1) {
                        // Single finger: rotate
                        final delta = d.localFocalPoint - _lastFocalPoint;
                        _rotY += delta.dx * 0.008;
                        _rotX =
                            (_rotX + delta.dy * 0.008).clamp(-1.2, 0.2);
                      } else if (d.pointerCount >= 2) {
                        // Two fingers: zoom + pan
                        _zoom = (_baseZoom * d.scale).clamp(0.3, 3.0);
                        final delta = d.localFocalPoint - _lastFocalPoint;
                        _panOffset += delta * 0.5;
                      }
                      _lastFocalPoint = d.localFocalPoint;
                    });
                  },
                  onTapUp: _viewMode == ViewMode.perspective ? _handleTap : null,
                  onDoubleTap: () => setState(() {
                    _rotX = -0.45; _rotY = 0.6; _zoom = 1.0;
                    _panOffset = Offset.zero;
                  }),
                  child: AnimatedBuilder(
                    animation: _glowCtrl,
                    builder: (_, __) => RepaintBoundary(
                      child: CustomPaint(
                        painter: _buildCurrentPainter(r, sc),
                        size: Size.infinite,
                      ),
                    ),
                  ),
                ),
              ),
              // Drop zone highlight
              if (candidateData.isNotEmpty)
                Positioned.fill(
                  child: IgnorePointer(
                    child: Container(
                      decoration: BoxDecoration(
                        border: Border.all(
                            color: AppTheme.neonGreen.withValues(alpha: 0.6),
                            width: 2),
                        color: AppTheme.neonGreen.withValues(alpha: 0.05),
                      ),
                    ),
                  ),
                ),
            ]);
          },
        ),
      ),
      // Recalculating overlay
      if (_recomputing)
        Positioned(
          top: 8,
          right: 8,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
                color: AppTheme.darkCard.withValues(alpha: 0.9),
                borderRadius: BorderRadius.circular(8)),
            child: const Row(mainAxisSize: MainAxisSize.min, children: [
              SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: AppTheme.neonBlue)),
              SizedBox(width: 6),
              Text('Recalculando...',
                  style: TextStyle(color: Colors.white54, fontSize: 10)),
            ]),
          ),
        ),
      // Selected box info overlay
      if (_selectedBoxId != null)
        Positioned(
            left: 8, right: 8, bottom: 8, child: _buildSelectedBox()),
      // Live metrics overlay
      Positioned(
        left: 8,
        top: 8,
        child: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: AppTheme.darkCard.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: sc.withValues(alpha: 0.2)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _miniProgressBar('Volumen', volPct.toDouble(), sc),
              const SizedBox(height: 4),
              _miniProgressBar('Peso', wgtPct.toDouble(), sc),
              const SizedBox(height: 4),
              Text('${m.placedCount}/${m.totalBoxes} bultos',
                  style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.5),
                      fontSize: 9)),
              if (m.totalImporteEur > 0) ...[
                const SizedBox(height: 2),
                Text(
                  '${m.totalImporteEur.toStringAsFixed(0)} €',
                  style: const TextStyle(
                    color: Color(0xFF4CAF50),
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      // Color legend
      if (_result != null && _result!.placed.isNotEmpty)
        Positioned(
          right: 8,
          bottom: _selectedBoxId != null ? 70 : 8,
          child: _buildColorLegend(),
        ),
      // Axle balance indicator
      if (_result != null && _result!.placed.isNotEmpty && _result!.truck != null)
        Positioned(
          left: 8,
          bottom: _selectedBoxId != null ? 70 : 8,
          child: _buildAxleBalance(),
        ),
    ]);

    // Interactive order panel
    final orderPanel = LoadPlannerPanel(
      result: r,
      allOrders: _allOrders,
      excludedIndices: _excludedIndices,
      isManualMode: _isManualMode,
      recomputing: _recomputing,
      onSmartOptimize: _smartOptimize,
      optimizing: _optimizing,
      onAddAll: () {
        setState(() {
          _excludedIndices.clear();
          _isManualMode = false;
        });
        _loadPlan();
      },
      onRemoveAll: () {
        setState(() {
          _excludedIndices =
              Set.from(List.generate(_allOrders.length, (i) => i));
          _isManualMode = true;
        });
        _rerunPacking();
      },
      onReset: _resetOrders,
      onRemoveOrder: _removeOrder,
      onRestoreOrder: _restoreOrder,
    );

    if (isWide) {
      return Row(children: [
        Expanded(flex: 6, child: canvas3D),
        SizedBox(width: 280, child: orderPanel),
      ]);
    } else {
      return Column(children: [
        Expanded(flex: 5, child: canvas3D),
        Expanded(flex: 4, child: orderPanel),
      ]);
    }
  }

  // ─── Overlay widgets ──────────────────────────────────────────────────

  Widget _miniProgressBar(String label, double pct, Color color) {
    final c = pct > 90
        ? Colors.redAccent
        : pct > 70
            ? Colors.amber
            : color;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      SizedBox(
          width: 32,
          child: Text(label,
              style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.4), fontSize: 8))),
      SizedBox(
        width: 60,
        height: 4,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(2),
          child: LinearProgressIndicator(
              value: pct / 100, backgroundColor: Colors.white10, color: c),
        ),
      ),
      const SizedBox(width: 4),
      Text('${pct.toStringAsFixed(0)}%',
          style: TextStyle(
              color: c, fontSize: 8, fontWeight: FontWeight.w700)),
    ]);
  }

  Widget _buildSelectedBox() {
    final box = _result?.placed.firstWhere((b) => b.id == _selectedBoxId,
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
            h: 0));
    if (box == null || box.id == -1) return const SizedBox.shrink();

    String client = box.clientCode;
    for (final o in _allOrders) {
      if (o.clientCode == box.clientCode && o.clientName.isNotEmpty) {
        client = o.clientName;
        break;
      }
    }
    final cc = CargoColors.byClient(box.clientCode);

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.darkCard.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cc.withValues(alpha: 0.4)),
      ),
      child: Row(children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
              color: cc.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(8)),
          child: Center(
              child: Text(CargoColors.sizeLabel(box.weight),
                  style: TextStyle(
                      color: cc, fontSize: 14, fontWeight: FontWeight.w900))),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(box.label.isNotEmpty ? box.label : box.articleCode,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
              Text('$client · Pedido #${box.orderNumber}',
                  style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.4),
                      fontSize: 10),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('${box.weight.toStringAsFixed(1)} kg',
              style: const TextStyle(
                  color: Colors.amber,
                  fontSize: 12,
                  fontWeight: FontWeight.w700)),
          Text('${box.w.toInt()}x${box.d.toInt()}x${box.h.toInt()} cm',
              style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.3),
                  fontSize: 10)),
        ]),
        const SizedBox(width: 6),
        GestureDetector(
          onTap: () => setState(() => _selectedBoxId = null),
          child:
              const Icon(Icons.close_rounded, color: Colors.white30, size: 18),
        ),
      ]),
    );
  }

  Widget _buildError() => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.error_outline_rounded,
              color: Colors.redAccent, size: 48),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(_error ?? 'Error',
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
                foregroundColor: AppTheme.neonBlue),
          ),
        ]),
      );

  // ─── View mode toggle button ────────────────────────────────────────

  Widget _viewModeBtn(ViewMode mode, IconData icon, String label) {
    final isActive = _viewMode == mode;
    return GestureDetector(
      onTap: () => setState(() => _viewMode = mode),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: isActive
              ? AppTheme.neonBlue.withValues(alpha: 0.25)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon,
              color: isActive ? AppTheme.neonBlue : Colors.white38,
              size: 14),
          const SizedBox(width: 3),
          Text(label,
              style: TextStyle(
                  color: isActive ? AppTheme.neonBlue : Colors.white38,
                  fontSize: 9,
                  fontWeight: isActive ? FontWeight.bold : FontWeight.normal)),
        ]),
      ),
    );
  }

  // ─── Build the right painter for the current view ───────────────────

  CustomPainter _buildCurrentPainter(LoadPlanResult r, Color sc) {
    switch (_viewMode) {
      case ViewMode.top:
        return TopViewPainter(
          result: r,
          selectedId: _selectedBoxId,
          colorMode: _colorMode,
        );
      case ViewMode.front:
        return FrontViewPainter(
          result: r,
          selectedId: _selectedBoxId,
          colorMode: _colorMode,
        );
      case ViewMode.perspective:
        return TruckPainter(
          result: r,
          rotX: _rotX,
          rotY: _rotY,
          zoom: _zoom,
          panOffset: _panOffset,
          selectedId: _selectedBoxId,
          glow: _selectedBoxId != null ? _glowCtrl.value : 0.0,
          statusColor: sc,
          colorMode: _colorMode,
          animatedBoxCount: _animatedBoxCount,
        );
    }
  }

  // ─── Axle balance indicator ─────────────────────────────────────────

  Widget _buildAxleBalance() {
    final placed = _result!.placed;
    final t = _result!.truck!;
    final cL = math.max(t.interior.lengthCm, 250.0);
    final cW = math.max(t.interior.widthCm, 160.0);

    final axle = AxleBalanceHelper.axleDistribution(placed, cL);
    final lat = AxleBalanceHelper.lateralDistribution(placed, cW);
    final frontPct = axle['frontPct']!;
    final rearPct = axle['rearPct']!;
    final leftPct = lat['leftPct']!;
    final rightPct = lat['rightPct']!;
    final balanced = AxleBalanceHelper.isBalanced(placed, cL, cW);

    final bc = balanced ? AppTheme.neonGreen : Colors.amber;

    return Container(
      padding: const EdgeInsets.all(8),
      constraints: const BoxConstraints(maxWidth: 110),
      decoration: BoxDecoration(
        color: AppTheme.darkCard.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: bc.withValues(alpha: 0.3)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                balanced
                    ? Icons.balance_rounded
                    : Icons.warning_amber_rounded,
                color: bc,
                size: 12,
              ),
              const SizedBox(width: 4),
              Text(
                balanced ? 'EQUILIBRADO' : 'DESBALANCE',
                style: TextStyle(
                  color: bc,
                  fontSize: 7,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          // Cross diagram
          SizedBox(
            width: 80,
            height: 55,
            child: CustomPaint(
              painter: _BalanceDiagramPainter(
                frontPct: frontPct,
                rearPct: rearPct,
                leftPct: leftPct,
                rightPct: rightPct,
                balanced: balanced,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ─── Color legend ───────────────────────────────────────────────────

  Widget _buildColorLegend() {
    if (_result == null || _result!.placed.isEmpty) return const SizedBox();

    final maxW = _result!.placed.map((b) => b.weight).reduce(math.max);

    // Collect unique items for legend (max 8)
    final Map<String, Color> legendItems = {};
    for (final b in _result!.placed) {
      final key = _colorMode == ColorMode.product
          ? b.articleCode
          : _colorMode == ColorMode.client
              ? b.clientCode
              : CargoColors.sizeLabel(b.weight);
      if (!legendItems.containsKey(key)) {
        legendItems[key] = CargoColors.forBox(b, _colorMode, maxW);
      }
      if (legendItems.length >= 8) break;
    }

    final modeLabel = _colorMode == ColorMode.product
        ? 'Productos'
        : _colorMode == ColorMode.client
            ? 'Clientes'
            : 'Peso';

    return Container(
      padding: const EdgeInsets.all(8),
      constraints: const BoxConstraints(maxWidth: 140),
      decoration: BoxDecoration(
        color: AppTheme.darkCard.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(modeLabel,
              style: const TextStyle(
                  color: Colors.white54,
                  fontSize: 8,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1)),
          const SizedBox(height: 4),
          ...legendItems.entries.map((e) => Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Row(children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: e.value,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      e.key,
                      style: const TextStyle(
                          color: Colors.white60, fontSize: 8),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ]),
              )),
          if (legendItems.length >= 8)
            Text('+ ${_result!.placed.length - 8} más',
                style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.3),
                    fontSize: 7)),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BALANCE DIAGRAM — Mini cross showing weight distribution
// ═══════════════════════════════════════════════════════════════════════════════

class _BalanceDiagramPainter extends CustomPainter {
  final double frontPct, rearPct, leftPct, rightPct;
  final bool balanced;

  _BalanceDiagramPainter({
    required this.frontPct,
    required this.rearPct,
    required this.leftPct,
    required this.rightPct,
    required this.balanced,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final cx = size.width / 2;
    final cy = size.height / 2;
    final accent = balanced
        ? const Color(0xFF6BCB77)
        : const Color(0xFFFFE66D);

    // Truck outline (simplified top-down)
    final truckRect = RRect.fromRectAndRadius(
      Rect.fromCenter(
        center: Offset(cx, cy),
        width: size.width * 0.6,
        height: size.height * 0.85,
      ),
      const Radius.circular(4),
    );
    canvas.drawRRect(
      truckRect,
      Paint()..color = const Color(0x20FFFFFF),
    );
    canvas.drawRRect(
      truckRect,
      Paint()
        ..color = accent.withValues(alpha: 0.4)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );

    // Center cross lines
    final crossPaint = Paint()
      ..color = const Color(0x15FFFFFF)
      ..strokeWidth = 0.5;
    canvas.drawLine(
      Offset(cx, cy - size.height * 0.4),
      Offset(cx, cy + size.height * 0.4),
      crossPaint,
    );
    canvas.drawLine(
      Offset(cx - size.width * 0.28, cy),
      Offset(cx + size.width * 0.28, cy),
      crossPaint,
    );

    // Center of gravity dot
    final cogX = cx + (rightPct - leftPct) / 100 * size.width * 0.25;
    final cogY = cy + (rearPct - frontPct) / 100 * size.height * 0.35;
    canvas.drawCircle(
      Offset(cogX, cogY),
      4,
      Paint()..color = accent,
    );
    canvas.drawCircle(
      Offset(cogX, cogY),
      4,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );

    // Labels
    _drawLabel(canvas, '${frontPct.round()}%',
        Offset(cx, cy - size.height * 0.38), accent);
    _drawLabel(canvas, '${rearPct.round()}%',
        Offset(cx, cy + size.height * 0.38), accent);
    _drawLabel(canvas, '${leftPct.round()}%',
        Offset(cx - size.width * 0.28, cy), accent);
    _drawLabel(canvas, '${rightPct.round()}%',
        Offset(cx + size.width * 0.28, cy), accent);
  }

  void _drawLabel(
      Canvas canvas, String text, Offset pos, Color color) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: color,
          fontSize: 7,
          fontWeight: FontWeight.w700,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(
      canvas,
      Offset(pos.dx - tp.width / 2, pos.dy - tp.height / 2),
    );
  }

  @override
  bool shouldRepaint(covariant _BalanceDiagramPainter old) =>
      old.frontPct != frontPct ||
      old.rearPct != rearPct ||
      old.leftPct != leftPct ||
      old.rightPct != rightPct;
}
