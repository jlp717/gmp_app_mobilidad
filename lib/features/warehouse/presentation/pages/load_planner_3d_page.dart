/// TETRIS LOGISTICO 3D — Visualizacion de carga de camion/furgoneta
/// Panel interactivo con resumen por cliente, productos, y overflow

import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/warehouse_data_service.dart';

// ─── Color helpers ──────────────────────────────────────────────────────────
Color _clientColor(String clientCode) {
  final hash = clientCode.hashCode.abs();
  final hue = (hash * 47) % 360;
  return HSLColor.fromAHSL(1, hue.toDouble(), 0.65, 0.5).toColor();
}

String _sizeLabel(double weight) {
  if (weight <= 2) return 'S';
  if (weight <= 10) return 'M';
  if (weight <= 25) return 'L';
  return 'XL';
}

Color _sizeColor(double weight) {
  if (weight <= 2) return Colors.lightBlue;
  if (weight <= 10) return AppTheme.neonGreen;
  if (weight <= 25) return Colors.amber;
  return Colors.redAccent;
}

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
  Timer? _debounce;

  // 3D
  double _rotX = -0.45, _rotY = 0.6, _zoom = 1.0;
  Offset _lastPan = Offset.zero;

  // Panel
  int _panelTab = 0; // 0=resumen, 1=productos, 2=no caben

  late AnimationController _glowCtrl;

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
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _rerunPacking() async {
    if (_recomputing) return;
    setState(() => _recomputing = true);
    try {
      final active = _allOrders.asMap().entries
          .where((e) => !_excludedIndices.contains(e.key))
          .map((e) => e.value);
      final items = active.map((o) => <String, dynamic>{
        'articleCode': o.articleCode,
        'quantity': o.boxes > 0 ? o.boxes.round() : 1,
        'orderNumber': o.orderNumber,
        'clientCode': o.clientCode,
        'label': o.articleName,
      }).toList();
      final r = await WarehouseDataService.planLoadManual(
          vehicleCode: widget.vehicleCode, items: items);
      if (mounted) setState(() { _result = r; _selectedBoxId = null; _recomputing = false; });
    } catch (_) {
      if (mounted) setState(() => _recomputing = false);
    }
  }

  void _removeOrder(int i) {
    setState(() { _excludedIndices.add(i); _isManualMode = true; _selectedBoxId = null; });
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _rerunPacking);
  }

  void _restoreOrder(int i) {
    setState(() { _excludedIndices.remove(i); if (_excludedIndices.isEmpty) _isManualMode = false; });
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _rerunPacking);
  }

  void _resetOrders() {
    setState(() { _excludedIndices = {}; _isManualMode = false; _selectedBoxId = null; });
    _loadPlan();
  }

  Color _statusColor(String s) =>
      s == 'EXCESO' ? Colors.redAccent : s == 'OPTIMO' ? Colors.amber : AppTheme.neonGreen;

  // ─── Build ──────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: AppTheme.darkBase, elevation: 0,
        leading: IconButton(
            icon: const Icon(Icons.arrow_back_rounded, color: Colors.white70),
            onPressed: () => Navigator.pop(context)),
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('TETRIS LOGISTICO 3D',
              style: TextStyle(color: AppTheme.neonBlue, fontSize: 14,
                  fontWeight: FontWeight.w800, letterSpacing: 1.5)),
          Text('${widget.vehicleCode} · ${widget.vehicleName}',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.5), fontSize: 12)),
        ]),
        actions: [
          if (_isManualMode)
            IconButton(onPressed: _resetOrders,
                icon: const Icon(Icons.restart_alt_rounded, color: Colors.amber, size: 22)),
          IconButton(onPressed: _loadPlan,
              icon: const Icon(Icons.refresh_rounded, color: AppTheme.neonGreen)),
        ],
      ),
      body: _loading
          ? const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
              CircularProgressIndicator(color: AppTheme.neonBlue),
              SizedBox(height: 16),
              Text('Calculando carga...', style: TextStyle(color: Colors.white54, fontSize: 14)),
            ]))
          : _error != null ? _buildError() : _buildContent(),
    );
  }

  Widget _buildContent() {
    final r = _result!;
    final sc = _statusColor(r.metrics.status);

    return Column(children: [
      _buildStatusBar(r, sc),
      // 3D + selected box info
      Expanded(flex: 5, child: Stack(children: [
        Positioned.fill(child: GestureDetector(
          onPanStart: (d) => _lastPan = d.localPosition,
          onPanUpdate: (d) => setState(() {
            final delta = d.localPosition - _lastPan;
            _rotY += delta.dx * 0.008;
            _rotX = (_rotX + delta.dy * 0.008).clamp(-1.2, 0.2);
            _lastPan = d.localPosition;
          }),
          onScaleUpdate: (d) { if (d.pointerCount == 2) setState(() => _zoom = (_zoom * d.scale).clamp(0.3, 3.0)); },
          onTapUp: (_) => _handleTap(),
          child: AnimatedBuilder(
            animation: _glowCtrl,
            builder: (_, __) => CustomPaint(
              painter: _TruckPainter(
                result: r, rotX: _rotX, rotY: _rotY, zoom: _zoom,
                selectedId: _selectedBoxId, glow: _glowCtrl.value, statusColor: sc),
              size: Size.infinite)),
        )),
        if (_recomputing) Positioned(top: 8, right: 8, child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(color: AppTheme.darkCard.withValues(alpha: 0.9), borderRadius: BorderRadius.circular(8)),
          child: const Row(mainAxisSize: MainAxisSize.min, children: [
            SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.neonBlue)),
            SizedBox(width: 6),
            Text('Recalculando...', style: TextStyle(color: Colors.white54, fontSize: 10)),
          ]))),
        if (_selectedBoxId != null) Positioned(left: 8, right: 8, bottom: 8,
            child: _buildSelectedBox()),
      ])),
      // Panel inferior con tabs
      Expanded(flex: 4, child: _buildPanel(r)),
    ]);
  }

  // ─── Status Bar ─────────────────────────────────────────────────────────

  Widget _buildStatusBar(LoadPlanResult r, Color sc) {
    final m = r.metrics;
    String msg;
    if (m.status == 'EXCESO') {
      msg = 'No cabe todo. ${m.placedCount} de ${m.totalBoxes} cargados — sobran ${m.overflowCount} (${m.overflowWeightKg.toStringAsFixed(0)} kg)';
    } else if (m.status == 'OPTIMO') {
      msg = 'Camion casi lleno. ${m.placedCount} bultos, ${m.totalWeightKg.toStringAsFixed(0)} kg — queda poco espacio';
    } else {
      msg = 'Todo cabe. ${m.placedCount} bultos, ${m.totalWeightKg.toStringAsFixed(0)} kg';
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: sc.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: sc.withValues(alpha: 0.3))),
      child: Row(children: [
        Icon(m.status == 'EXCESO' ? Icons.warning_rounded
            : m.status == 'OPTIMO' ? Icons.check_circle_rounded : Icons.verified_rounded,
            color: sc, size: 20),
        const SizedBox(width: 8),
        Expanded(child: Text(msg, style: TextStyle(color: sc, fontSize: 11, fontWeight: FontWeight.w600))),
        // Weight indicator
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(color: sc.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(6)),
          child: Text('${m.totalWeightKg.toStringAsFixed(0)} / ${m.maxPayloadKg.toStringAsFixed(0)} kg',
              style: TextStyle(color: sc, fontSize: 11, fontWeight: FontWeight.w800)),
        ),
      ]),
    );
  }

  // ─── Selected Box ───────────────────────────────────────────────────────

  Widget _buildSelectedBox() {
    final box = _result?.placed.firstWhere((b) => b.id == _selectedBoxId,
        orElse: () => PlacedBox(id: -1, label: '', orderNumber: 0, clientCode: '',
            articleCode: '', weight: 0, x: 0, y: 0, z: 0, w: 0, d: 0, h: 0));
    if (box == null || box.id == -1) return const SizedBox.shrink();

    String client = box.clientCode;
    for (final o in _allOrders) {
      if (o.clientCode == box.clientCode && o.clientName.isNotEmpty) { client = o.clientName; break; }
    }
    final cc = _clientColor(box.clientCode);

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.darkCard.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cc.withValues(alpha: 0.4))),
      child: Row(children: [
        Container(
          width: 36, height: 36,
          decoration: BoxDecoration(color: cc.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(8)),
          child: Center(child: Text(_sizeLabel(box.weight),
              style: TextStyle(color: cc, fontSize: 14, fontWeight: FontWeight.w900))),
        ),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(box.label.isNotEmpty ? box.label : box.articleCode,
              style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
              maxLines: 1, overflow: TextOverflow.ellipsis),
          Text('$client · Pedido #${box.orderNumber}',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 10),
              maxLines: 1, overflow: TextOverflow.ellipsis),
        ])),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('${box.weight.toStringAsFixed(1)} kg',
              style: const TextStyle(color: Colors.amber, fontSize: 12, fontWeight: FontWeight.w700)),
          Text('${box.w.toInt()}x${box.d.toInt()}x${box.h.toInt()} cm',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 10)),
        ]),
        const SizedBox(width: 6),
        GestureDetector(
          onTap: () => setState(() => _selectedBoxId = null),
          child: const Icon(Icons.close_rounded, color: Colors.white30, size: 18)),
      ]),
    );
  }

  // ─── Panel inferior con tabs ────────────────────────────────────────────

  Widget _buildPanel(LoadPlanResult r) {
    final hasOverflow = r.metrics.overflowCount > 0;
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        border: Border(top: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.15)))),
      child: Column(children: [
        // Tab bar
        Container(
          padding: const EdgeInsets.fromLTRB(8, 6, 8, 0),
          child: Row(children: [
            _tab('RESUMEN', 0, Icons.dashboard_rounded),
            _tab('PRODUCTOS', 1, Icons.inventory_2_rounded),
            if (hasOverflow) _tab('NO CABEN (${r.metrics.overflowCount})', 2, Icons.warning_amber_rounded),
          ]),
        ),
        const Divider(color: Colors.white10, height: 1),
        Expanded(child:
          _panelTab == 0 ? _buildResumen(r) :
          _panelTab == 1 ? _buildProductos() :
          _buildOverflow(r)),
      ]),
    );
  }

  Widget _tab(String label, int idx, IconData icon) {
    final sel = _panelTab == idx;
    return Expanded(child: GestureDetector(
      onTap: () => setState(() => _panelTab = idx),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(
            color: sel ? AppTheme.neonBlue : Colors.transparent, width: 2))),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, size: 13, color: sel ? AppTheme.neonBlue : Colors.white30),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(
            color: sel ? AppTheme.neonBlue : Colors.white30,
            fontSize: 10, fontWeight: FontWeight.w700)),
        ]),
      ),
    ));
  }

  // ─── Tab: Resumen ───────────────────────────────────────────────────────

  Widget _buildResumen(LoadPlanResult r) {
    // Group orders by client
    final activeOrders = _allOrders.asMap().entries
        .where((e) => !_excludedIndices.contains(e.key))
        .map((e) => e.value).toList();

    final clientMap = <String, _ClientSummary>{};
    for (final o in activeOrders) {
      final key = o.clientCode;
      clientMap.putIfAbsent(key, () => _ClientSummary(
          code: key, name: o.clientName.isNotEmpty ? o.clientName : key));
      final cs = clientMap[key]!;
      cs.orders.add(o);
      cs.totalWeight += o.units * o.weightPerUnit;
      cs.totalBoxes += o.boxes > 0 ? o.boxes.round() : 1;
    }
    final clients = clientMap.values.toList()
      ..sort((a, b) => b.totalWeight.compareTo(a.totalWeight));

    final m = r.metrics;
    return ListView(padding: const EdgeInsets.all(8), children: [
      // Summary row
      Container(
        padding: const EdgeInsets.all(10),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: AppTheme.neonBlue.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(10)),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
          _summaryItem('Pedidos', '${activeOrders.map((o) => o.orderNumber).toSet().length}', AppTheme.neonBlue),
          _summaryItem('Clientes', '${clients.length}', AppTheme.neonPurple),
          _summaryItem('Bultos', '${m.placedCount}', AppTheme.neonGreen),
          _summaryItem('Peso', '${m.totalWeightKg.toStringAsFixed(0)} kg', Colors.amber),
        ]),
      ),
      // Client list
      ...clients.map((c) => _clientRow(c)),
    ]);
  }

  Widget _summaryItem(String label, String value, Color color) {
    return Column(mainAxisSize: MainAxisSize.min, children: [
      Text(value, style: TextStyle(color: color, fontSize: 16, fontWeight: FontWeight.w800)),
      Text(label, style: TextStyle(color: Colors.white.withValues(alpha: 0.35), fontSize: 9)),
    ]);
  }

  Widget _clientRow(_ClientSummary c) {
    final cc = _clientColor(c.code);
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: cc.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: cc.withValues(alpha: 0.1))),
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
        childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
        dense: true,
        leading: CircleAvatar(
          radius: 14, backgroundColor: cc.withValues(alpha: 0.15),
          child: Text(c.name.isNotEmpty ? c.name[0] : '?',
              style: TextStyle(color: cc, fontSize: 12, fontWeight: FontWeight.w700))),
        title: Text(c.name, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
            maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text('${c.orders.length} lineas · ${c.totalBoxes} bultos · ${c.totalWeight.toStringAsFixed(0)} kg',
            style: TextStyle(color: Colors.white.withValues(alpha: 0.35), fontSize: 10)),
        iconColor: Colors.white30,
        collapsedIconColor: Colors.white20,
        children: c.orders.map((o) => Padding(
          padding: const EdgeInsets.only(bottom: 3),
          child: Row(children: [
            Container(width: 20, height: 20,
              decoration: BoxDecoration(color: _sizeColor(o.weightPerUnit).withValues(alpha: 0.15), borderRadius: BorderRadius.circular(4)),
              child: Center(child: Text(_sizeLabel(o.weightPerUnit),
                  style: TextStyle(color: _sizeColor(o.weightPerUnit), fontSize: 8, fontWeight: FontWeight.w800)))),
            const SizedBox(width: 6),
            Expanded(child: Text(o.articleName.isNotEmpty ? o.articleName : o.articleCode,
                style: const TextStyle(color: Colors.white70, fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis)),
            Text(o.boxes > 0 ? '${o.boxes.toStringAsFixed(0)} cj' : '${o.units.toStringAsFixed(0)} ud',
                style: TextStyle(color: AppTheme.neonGreen.withValues(alpha: 0.7), fontSize: 10, fontWeight: FontWeight.w600)),
            const SizedBox(width: 8),
            Text('${(o.units * o.weightPerUnit).toStringAsFixed(1)} kg',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 10)),
          ]),
        )).toList(),
      ),
    );
  }

  // ─── Tab: Productos ─────────────────────────────────────────────────────

  Widget _buildProductos() {
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      itemCount: _allOrders.length,
      itemBuilder: (_, i) {
        final o = _allOrders[i];
        final excluded = _excludedIndices.contains(i);
        final weight = o.units * o.weightPerUnit;
        final cc = _clientColor(o.clientCode);

        return Dismissible(
          key: ValueKey('prod_$i'),
          direction: excluded ? DismissDirection.none : DismissDirection.endToStart,
          background: Container(
            alignment: Alignment.centerRight, padding: const EdgeInsets.only(right: 16),
            color: Colors.redAccent.withValues(alpha: 0.15),
            child: const Icon(Icons.remove_circle_outline, color: Colors.redAccent, size: 18)),
          onDismissed: (_) => _removeOrder(i),
          child: Container(
            margin: const EdgeInsets.only(bottom: 2),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              color: excluded ? Colors.transparent : cc.withValues(alpha: 0.03),
              borderRadius: BorderRadius.circular(6)),
            child: Row(children: [
              // Size badge
              Container(width: 24, height: 24,
                decoration: BoxDecoration(
                  color: excluded ? Colors.white.withValues(alpha: 0.03) : _sizeColor(weight).withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(5)),
                child: Center(child: Text(_sizeLabel(weight),
                    style: TextStyle(color: excluded ? Colors.white12 : _sizeColor(weight),
                        fontSize: 9, fontWeight: FontWeight.w800)))),
              const SizedBox(width: 8),
              // Product info
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(o.articleName.isNotEmpty ? o.articleName : o.articleCode,
                    style: TextStyle(color: excluded ? Colors.white20 : Colors.white, fontSize: 11,
                        fontWeight: FontWeight.w500,
                        decoration: excluded ? TextDecoration.lineThrough : null),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                Text('${o.clientName.isNotEmpty ? o.clientName : o.clientCode} · #${o.orderNumber}',
                    style: TextStyle(color: excluded ? Colors.white10 : Colors.white.withValues(alpha: 0.3), fontSize: 9)),
              ])),
              // Quantity
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text(o.boxes > 0 ? '${o.boxes.toStringAsFixed(0)} cajas' : '${o.units.toStringAsFixed(0)} uds',
                    style: TextStyle(color: excluded ? Colors.white12 : AppTheme.neonGreen,
                        fontSize: 10, fontWeight: FontWeight.w600)),
                if (weight > 0) Text('${weight.toStringAsFixed(1)} kg',
                    style: TextStyle(color: excluded ? Colors.white10 : Colors.white.withValues(alpha: 0.25), fontSize: 9)),
              ]),
              const SizedBox(width: 6),
              // Action button
              if (excluded)
                GestureDetector(onTap: () => _restoreOrder(i),
                    child: Container(padding: const EdgeInsets.all(3),
                        decoration: BoxDecoration(color: AppTheme.neonGreen.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(5)),
                        child: const Icon(Icons.add_rounded, color: AppTheme.neonGreen, size: 14)))
              else
                GestureDetector(onTap: () => _removeOrder(i),
                    child: Icon(Icons.remove_circle_outline, color: Colors.white.withValues(alpha: 0.12), size: 16)),
            ]),
          ),
        );
      },
    );
  }

  // ─── Tab: No caben ──────────────────────────────────────────────────────

  Widget _buildOverflow(LoadPlanResult r) {
    final overflow = r.overflow;
    if (overflow.isEmpty) {
      return const Center(child: Text('Todo cabe en el camion',
          style: TextStyle(color: Colors.white30, fontSize: 13)));
    }

    // Group overflow by article
    final grouped = <String, _OverflowGroup>{};
    for (final b in overflow) {
      grouped.putIfAbsent(b.articleCode, () => _OverflowGroup(
          code: b.articleCode, name: b.label, clientCode: b.clientCode));
      grouped[b.articleCode]!.count++;
      grouped[b.articleCode]!.totalWeight += b.weight;
    }
    final groups = grouped.values.toList()..sort((a, b) => b.totalWeight.compareTo(a.totalWeight));

    return ListView(padding: const EdgeInsets.all(8), children: [
      // Summary
      Container(
        padding: const EdgeInsets.all(10), margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: Colors.redAccent.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.redAccent.withValues(alpha: 0.15))),
        child: Row(children: [
          const Icon(Icons.warning_amber_rounded, color: Colors.redAccent, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text('${overflow.length} bultos no caben (${r.metrics.overflowWeightKg.toStringAsFixed(0)} kg)',
              style: const TextStyle(color: Colors.redAccent, fontSize: 12, fontWeight: FontWeight.w600))),
        ]),
      ),
      ...groups.map((g) {
        String client = g.clientCode;
        for (final o in _allOrders) {
          if (o.clientCode == g.clientCode && o.clientName.isNotEmpty) { client = o.clientName; break; }
        }
        return Container(
          margin: const EdgeInsets.only(bottom: 3),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: Colors.redAccent.withValues(alpha: 0.03),
            borderRadius: BorderRadius.circular(6)),
          child: Row(children: [
            Container(width: 28, height: 28,
              decoration: BoxDecoration(color: Colors.redAccent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(6)),
              child: Center(child: Text('${g.count}', style: const TextStyle(color: Colors.redAccent, fontSize: 12, fontWeight: FontWeight.w800)))),
            const SizedBox(width: 8),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(g.name.isNotEmpty ? g.name : g.code,
                  style: const TextStyle(color: Colors.white70, fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis),
              Text(client, style: TextStyle(color: Colors.white.withValues(alpha: 0.25), fontSize: 9)),
            ])),
            Text('${g.totalWeight.toStringAsFixed(1)} kg',
                style: const TextStyle(color: Colors.redAccent, fontSize: 11, fontWeight: FontWeight.w600)),
          ]),
        );
      }),
    ]);
  }

  // ─── Tap ────────────────────────────────────────────────────────────────

  void _handleTap() {
    if (_result == null || _result!.placed.isEmpty) return;
    setState(() {
      if (_selectedBoxId == null) {
        _selectedBoxId = _result!.placed.first.id;
      } else {
        final idx = _result!.placed.indexWhere((b) => b.id == _selectedBoxId);
        _selectedBoxId = (idx >= 0 && idx < _result!.placed.length - 1)
            ? _result!.placed[idx + 1].id : null;
      }
    });
  }

  Widget _buildError() => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
    const Icon(Icons.error_outline_rounded, color: Colors.redAccent, size: 48),
    const SizedBox(height: 12),
    Padding(padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Text(_error ?? 'Error', style: const TextStyle(color: Colors.white70, fontSize: 14), textAlign: TextAlign.center)),
    const SizedBox(height: 16),
    ElevatedButton.icon(onPressed: _loadPlan, icon: const Icon(Icons.refresh, size: 18), label: const Text('Reintentar'),
        style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.2), foregroundColor: AppTheme.neonBlue)),
  ]));
}

// ─── Helper models ────────────────────────────────────────────────────────
class _ClientSummary {
  final String code, name;
  final List<TruckOrder> orders = [];
  double totalWeight = 0;
  int totalBoxes = 0;
  _ClientSummary({required this.code, required this.name});
}

class _OverflowGroup {
  final String code, name, clientCode;
  int count = 0;
  double totalWeight = 0;
  _OverflowGroup({required this.code, required this.name, required this.clientCode});
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM PAINTER — Vehiculo 3D con iluminacion y sombras
// ═══════════════════════════════════════════════════════════════════════════════

class _TruckPainter extends CustomPainter {
  final LoadPlanResult result;
  final double rotX, rotY, zoom;
  final int? selectedId;
  final double glow;
  final Color statusColor;

  _TruckPainter({
    required this.result, required this.rotX, required this.rotY,
    required this.zoom, this.selectedId, required this.glow, required this.statusColor,
  });

  // Light direction (normalized) for shading
  static const _lightX = 0.3, _lightY = -0.5, _lightZ = 0.8;

  Offset _p3d(double x, double y, double z, Size s) {
    final cY = math.cos(rotX), sY2 = math.sin(rotX);
    final cX = math.cos(rotY), sX2 = math.sin(rotY);
    final rx = x * cX - y * sX2;
    final ry = x * sX2 + y * cX;
    final fy = ry * cY - z * sY2;
    final fz = ry * sY2 + z * cY;
    final sc = 0.4 * zoom;
    return Offset(s.width / 2 + rx * sc, s.height * 0.5 + fy * sc - fz * sc);
  }

  double _faceLight(double nx, double ny, double nz) {
    // Lambert diffuse
    final dot = nx * _lightX + ny * _lightY + nz * _lightZ;
    return 0.3 + 0.7 * dot.clamp(0, 1);
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (result.truck == null) return;
    final t = result.truck!;
    final cW = t.interior.widthCm, cD = t.interior.lengthCm, cH = t.interior.heightCm;
    final ox = -cW / 2, oy = -cD / 2, oz = -cH / 2;
    final isVan = t.vehicleType == 'VAN';

    _drawBody(canvas, size, ox, oy, oz, cW, cD, cH, isVan);
    _drawGrid(canvas, size, ox, oy, oz, cW, cD);
    _drawWheels(canvas, size, ox, oy, oz, cW, cD, cH);

    // Sort boxes far to near
    final sorted = List<PlacedBox>.from(result.placed)
      ..sort((a, b) => (a.x + a.y + a.z).compareTo(b.x + b.y + b.z));

    // Draw shadows first
    for (final b in sorted) { _drawShadow(canvas, size, b, ox, oy, oz); }
    // Then boxes
    for (final b in sorted) { _drawBox(canvas, size, b, ox, oy, oz); }

    _drawLabel(canvas, size);
  }

  // ─── Vehicle body ─────────────────────────────────────────────────────

  void _drawBody(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h, bool isVan) {
    final a = 0.05 + glow * 0.03;
    // Cargo walls
    _face(canvas, size, [[ox,oy,oz],[ox+w,oy,oz],[ox+w,oy+d,oz],[ox,oy+d,oz]], statusColor.withValues(alpha: a + 0.02));
    _face(canvas, size, [[ox,oy,oz],[ox+w,oy,oz],[ox+w,oy,oz+h],[ox,oy,oz+h]], statusColor.withValues(alpha: a));
    _face(canvas, size, [[ox,oy,oz],[ox,oy+d,oz],[ox,oy+d,oz+h],[ox,oy,oz+h]], statusColor.withValues(alpha: a * 0.6));
    _face(canvas, size, [[ox+w,oy,oz],[ox+w,oy+d,oz],[ox+w,oy+d,oz+h],[ox+w,oy,oz+h]], statusColor.withValues(alpha: a * 0.6));
    _face(canvas, size, [[ox,oy,oz+h],[ox+w,oy,oz+h],[ox+w,oy+d,oz+h],[ox,oy+d,oz+h]], statusColor.withValues(alpha: a * 0.2));
    _edges(canvas, size, ox, oy, oz, w, d, h, statusColor.withValues(alpha: 0.15 + glow * 0.08), 1.0);

    // Cab
    final cabD = d * 0.22, cabOy = oy + d, cabH = isVan ? h : h * 0.85;
    final sr = isVan ? 0.65 : 0.55;
    final cc = Colors.blueGrey;
    _face(canvas, size, [[ox,cabOy,oz],[ox+w,cabOy,oz],[ox+w,cabOy,oz+cabH],[ox,cabOy,oz+cabH]], cc.withValues(alpha: 0.1));
    _face(canvas, size, [[ox,cabOy,oz],[ox,cabOy+cabD,oz],[ox,cabOy+cabD*sr,oz+cabH],[ox,cabOy,oz+cabH]], cc.withValues(alpha: 0.07));
    _face(canvas, size, [[ox+w,cabOy,oz],[ox+w,cabOy+cabD,oz],[ox+w,cabOy+cabD*sr,oz+cabH],[ox+w,cabOy,oz+cabH]], cc.withValues(alpha: 0.07));
    _face(canvas, size, [[ox,cabOy+cabD,oz],[ox+w,cabOy+cabD,oz],[ox+w,cabOy+cabD*sr,oz+cabH],[ox,cabOy+cabD*sr,oz+cabH]], Colors.lightBlue.withValues(alpha: 0.07));
    _face(canvas, size, [[ox,cabOy,oz+cabH],[ox+w,cabOy,oz+cabH],[ox+w,cabOy+cabD*sr,oz+cabH],[ox,cabOy+cabD*sr,oz+cabH]], cc.withValues(alpha: 0.05));

    // Cab edges
    final cv = [
      _p3d(ox,cabOy,oz,size), _p3d(ox+w,cabOy,oz,size),
      _p3d(ox+w,cabOy+cabD,oz,size), _p3d(ox,cabOy+cabD,oz,size),
      _p3d(ox,cabOy,oz+cabH,size), _p3d(ox+w,cabOy,oz+cabH,size),
      _p3d(ox+w,cabOy+cabD*sr,oz+cabH,size), _p3d(ox,cabOy+cabD*sr,oz+cabH,size),
    ];
    final ep = Paint()..color = Colors.white.withValues(alpha: 0.08)..strokeWidth = 0.7..style = PaintingStyle.stroke;
    for (final e in [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
      canvas.drawLine(cv[e[0]], cv[e[1]], ep);
    }
  }

  void _edges(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h, Color c, double sw) {
    final p = Paint()..color = c..strokeWidth = sw..style = PaintingStyle.stroke;
    final v = [_p3d(ox,oy,oz,size),_p3d(ox+w,oy,oz,size),_p3d(ox+w,oy+d,oz,size),_p3d(ox,oy+d,oz,size),
      _p3d(ox,oy,oz+h,size),_p3d(ox+w,oy,oz+h,size),_p3d(ox+w,oy+d,oz+h,size),_p3d(ox,oy+d,oz+h,size)];
    for (final e in [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
      canvas.drawLine(v[e[0]], v[e[1]], p);
    }
  }

  // ─── Wheels ───────────────────────────────────────────────────────────

  void _drawWheels(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h) {
    final r = h * 0.15;
    final f = Paint()..color = Colors.white.withValues(alpha: 0.08);
    final s = Paint()..color = Colors.white.withValues(alpha: 0.15)..style = PaintingStyle.stroke..strokeWidth = 0.7;
    for (final pos in [[ox-r*0.2,oy+d*0.1],[ox+w+r*0.2,oy+d*0.1],[ox-r*0.2,oy+d*1.15],[ox+w+r*0.2,oy+d*1.15]]) {
      final pts = List.generate(13, (i) {
        final a = (i / 12) * 2 * math.pi;
        return _p3d(pos[0], pos[1] + math.cos(a) * r * 0.4, oz + math.sin(a) * r, size);
      });
      final path = Path()..moveTo(pts[0].dx, pts[0].dy);
      for (final p in pts.skip(1)) { path.lineTo(p.dx, p.dy); }
      path.close();
      canvas.drawPath(path, f);
      canvas.drawPath(path, s);
    }
  }

  // ─── Floor grid ───────────────────────────────────────────────────────

  void _drawGrid(Canvas canvas, Size size, double ox, double oy, double oz, double w, double d) {
    final p = Paint()..color = Colors.white.withValues(alpha: 0.03)..strokeWidth = 0.4;
    final sp = math.max(w, d) / 5;
    for (double x = 0; x <= w; x += sp) {
      canvas.drawLine(_p3d(ox+x,oy,oz,size), _p3d(ox+x,oy+d,oz,size), p);
    }
    for (double y = 0; y <= d; y += sp) {
      canvas.drawLine(_p3d(ox,oy+y,oz,size), _p3d(ox+w,oy+y,oz,size), p);
    }
  }

  // ─── Box shadow ───────────────────────────────────────────────────────

  void _drawShadow(Canvas canvas, Size size, PlacedBox b, double ox, double oy, double oz) {
    // Project box footprint onto floor (z = oz)
    final pts = [
      _p3d(ox+b.x, oy+b.y, oz, size),
      _p3d(ox+b.x+b.w, oy+b.y, oz, size),
      _p3d(ox+b.x+b.w, oy+b.y+b.d, oz, size),
      _p3d(ox+b.x, oy+b.y+b.d, oz, size),
    ];
    final path = Path()..moveTo(pts[0].dx, pts[0].dy);
    for (final p in pts.skip(1)) { path.lineTo(p.dx, p.dy); }
    path.close();
    canvas.drawPath(path, Paint()..color = Colors.black.withValues(alpha: 0.15));
  }

  // ─── Cargo box ────────────────────────────────────────────────────────

  void _drawBox(Canvas canvas, Size size, PlacedBox b, double ox, double oy, double oz) {
    final bx = ox + b.x, by = oy + b.y, bz = oz + b.z;
    final cc = _clientColor(b.clientCode);
    final sel = b.id == selectedId;

    // Top face (normal = 0,0,1)
    final topL = _faceLight(0, 0, 1);
    final topPts = [_p3d(bx,by,bz+b.h,size),_p3d(bx+b.w,by,bz+b.h,size),
        _p3d(bx+b.w,by+b.d,bz+b.h,size),_p3d(bx,by+b.d,bz+b.h,size)];
    // Front face (normal = 0,-1,0)
    final frontL = _faceLight(0, -1, 0);
    final frontPts = [_p3d(bx,by,bz,size),_p3d(bx+b.w,by,bz,size),
        _p3d(bx+b.w,by,bz+b.h,size),_p3d(bx,by,bz+b.h,size)];
    // Right face (normal = 1,0,0)
    final rightL = _faceLight(1, 0, 0);
    final rightPts = [_p3d(bx+b.w,by,bz,size),_p3d(bx+b.w,by+b.d,bz,size),
        _p3d(bx+b.w,by+b.d,bz+b.h,size),_p3d(bx+b.w,by,bz+b.h,size)];

    // Draw filled faces with Lambert shading
    _drawFaceLit(canvas, topPts, cc, topL, sel ? 0.9 : 0.7);
    _drawFaceLit(canvas, frontPts, cc, frontL, sel ? 0.9 : 0.7);
    _drawFaceLit(canvas, rightPts, cc, rightL, sel ? 0.9 : 0.7);

    // Edges
    final ep = Paint()
      ..color = sel ? AppTheme.neonBlue.withValues(alpha: 0.9) : Colors.white.withValues(alpha: 0.12)
      ..strokeWidth = sel ? 1.5 : 0.5..style = PaintingStyle.stroke;
    canvas.drawPath(_pathOf(topPts), ep);
    canvas.drawPath(_pathOf(frontPts), ep);
    canvas.drawPath(_pathOf(rightPts), ep);

    if (sel) {
      canvas.drawPath(_pathOf(topPts), Paint()
        ..color = AppTheme.neonBlue.withValues(alpha: 0.3 * glow)
        ..strokeWidth = 3..style = PaintingStyle.stroke
        ..maskFilter = const MaskFilter.blur(BlurStyle.outer, 6));
    }
  }

  void _drawFaceLit(Canvas canvas, List<Offset> pts, Color base, double light, double alpha) {
    final hsl = HSLColor.fromColor(base);
    final lit = (hsl.lightness * light).clamp(0.1, 0.8);
    final c = hsl.withLightness(lit).toColor().withValues(alpha: alpha);
    canvas.drawPath(_pathOf(pts), Paint()..color = c);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  void _face(Canvas canvas, Size size, List<List<double>> pts, Color c) {
    final offsets = pts.map((p) => _p3d(p[0], p[1], p[2], size)).toList();
    canvas.drawPath(_pathOf(offsets), Paint()..color = c);
  }

  Path _pathOf(List<Offset> pts) {
    final p = Path()..moveTo(pts[0].dx, pts[0].dy);
    for (int i = 1; i < pts.length; i++) { p.lineTo(pts[i].dx, pts[i].dy); }
    p.close(); return p;
  }

  void _drawLabel(Canvas canvas, Size size) {
    final m = result.metrics;
    final t = result.truck!;
    final tp = TextPainter(
      text: TextSpan(text:
        '${m.placedCount} bultos · ${m.totalWeightKg.toStringAsFixed(0)}/${m.maxPayloadKg.toStringAsFixed(0)} kg · ${t.interior.lengthCm.toInt()}x${t.interior.widthCm.toInt()}x${t.interior.heightCm.toInt()} cm',
        style: TextStyle(color: Colors.white.withValues(alpha: 0.2), fontSize: 9)),
      textDirection: TextDirection.ltr)..layout();
    tp.paint(canvas, Offset(8, size.height - 16));
  }

  @override
  bool shouldRepaint(covariant _TruckPainter old) => true;
}
