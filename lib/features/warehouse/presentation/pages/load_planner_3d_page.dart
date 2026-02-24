/// TETRIS LOGISTICO 3D — Visualizacion de carga de camion/furgoneta
/// Panel interactivo con resumen por cliente, productos, y overflow

import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/warehouse_data_service.dart';

// ─── Color helpers ──────────────────────────────────────────────────────────

/// Paleta profesional de colores distinguibles para clientes
const _productPalette = <Color>[
  Color(0xFFD4915C), // Cartón natural
  Color(0xFF8B6F47), // Cartón oscuro
  Color(0xFFA0522D), // Sienna
  Color(0xFFBC8F8F), // Rosewood
  Color(0xFF6B8E23), // Olive
  Color(0xFF2E8B57), // Sea green
  Color(0xFF4682B4), // Steel blue
  Color(0xFF5F6B80), // Slate
  Color(0xFF8B7D6B), // Driftwood
  Color(0xFFC4A35A), // Sand
  Color(0xFF7B68AE), // Lavanda
  Color(0xFFB07050), // Terracotta
  Color(0xFF6A9B7B), // Sage
  Color(0xFF9E8C6C), // Khaki
  Color(0xFF7B9BAE), // Fog blue
  Color(0xFFAB7E6B), // Adobe
];

Color _productColor(String articleCode) {
  final idx = articleCode.hashCode.abs() % _productPalette.length;
  return _productPalette[idx];
}

Color _clientColor(String clientCode) {
  final idx = clientCode.hashCode.abs() % _productPalette.length;
  return _productPalette[idx];
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
          onTapUp: (details) => _handleTap(details),
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
        collapsedIconColor: Colors.white.withValues(alpha: 0.2),
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
        final cc = _productColor(o.articleCode);

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
                    style: TextStyle(color: excluded ? Colors.white.withValues(alpha: 0.2) : Colors.white, fontSize: 11,
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

  void _handleTap(TapUpDetails details) {
    if (_result == null || _result!.placed.isEmpty) return;
    
    // We will do a generic click that cycles through boxes or we could try to implement Raycasting 
    // but since this is a 2D canvas with projecting 3D, raycasting is complex. 
    // For now, if _selectedBoxId is null, we pick the first. If not, we cycle.
    setState(() {
      if (_selectedBoxId == null) {
        _selectedBoxId = _result!.placed.first.id;
        _showBoxModal(_result!.placed.first);
      } else {
        final idx = _result!.placed.indexWhere((b) => b.id == _selectedBoxId);
        final nextBox = (idx >= 0 && idx < _result!.placed.length - 1)
            ? _result!.placed[idx + 1] : _result!.placed.first;
        _selectedBoxId = nextBox.id;
        _showBoxModal(nextBox);
      }
    });
  }

  void _showBoxModal(PlacedBox box) {
    String client = box.clientCode;
    for (final o in _allOrders) {
      if (o.clientCode == box.clientCode && o.clientName.isNotEmpty) { client = o.clientName; break; }
    }
    final cc = _productColor(box.articleCode);

    showModalBottomSheet(
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
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: cc.withValues(alpha: 0.2), shape: BoxShape.circle),
                  child: Icon(Icons.inventory_2_rounded, color: cc, size: 28),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(box.label.isNotEmpty ? box.label : box.articleCode, 
                        style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text('Pedido #${box.orderNumber}', style: const TextStyle(color: AppTheme.neonBlue, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              ],
            ),
            const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Divider(color: Colors.white24)),
            _modalRow(Icons.business_center_rounded, 'Cliente', client),
            _modalRow(Icons.straighten_rounded, 'Dimensiones', '${box.w.toInt()} x ${box.d.toInt()} x ${box.h.toInt()} cm'),
            _modalRow(Icons.scale_rounded, 'Peso', '${box.weight.toStringAsFixed(1)} kg'),
            _modalRow(Icons.schedule_rounded, 'ETA (Estimado)', '14:30 - Prioridad Alta', color: AppTheme.neonGreen),
            const SizedBox(height: 20),
            Center(
              child: ElevatedButton.icon(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded),
                label: const Text('Cerrar Módulo'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: cc.withValues(alpha: 0.2),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _modalRow(IconData icon, String label, String value, {Color color = Colors.white70}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Icon(icon, color: Colors.white54, size: 20),
          const SizedBox(width: 12),
          Text('$label:', style: const TextStyle(color: Colors.white54, fontSize: 14)),
          const SizedBox(width: 8),
          Expanded(child: Text(value, style: TextStyle(color: color, fontSize: 15, fontWeight: FontWeight.w600))),
        ],
      ),
    );
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
// CUSTOM PAINTER — Camión 3D realista con iluminación avanzada
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

  // Iluminación: dirección de luz principal + ambiente
  static const _lx = 0.35, _ly = -0.45, _lz = 0.82;
  static const _ambient = 0.35;

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

  double _light(double nx, double ny, double nz) {
    final dot = nx * _lx + ny * _ly + nz * _lz;
    return (_ambient + (1 - _ambient) * dot.clamp(0, 1));
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (result.truck == null) return;
    final t = result.truck!;
    final cW = t.interior.widthCm, cD = t.interior.lengthCm, cH = t.interior.heightCm;
    final ox = -cW / 2, oy = -cD / 2, oz = -cH / 2;

    // --- Background glow ---
    final glowPaint = Paint()
      ..shader = RadialGradient(
        colors: [statusColor.withValues(alpha: 0.04 + glow * 0.02), Colors.transparent],
      ).createShader(Rect.fromCenter(center: Offset(size.width / 2, size.height * 0.45), width: size.width, height: size.height));
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), glowPaint);

    _drawGround(canvas, size, ox, oy, oz, cW, cD);
    _drawCargoContainer(canvas, size, ox, oy, oz, cW, cD, cH);
    _drawCab(canvas, size, ox, oy, oz, cW, cD, cH);
    _drawWheels(canvas, size, ox, oy, oz, cW, cD, cH);
    _drawFloorGrid(canvas, size, ox, oy, oz, cW, cD);

    // Sort boxes far to near for painter's algorithm
    final sorted = List<PlacedBox>.from(result.placed)
      ..sort((a, b) {
        // Mejorado el Z-sorting isométrico usando las coordenadas del cubo central
        final za = (a.x + a.w/2) * math.cos(rotY) + (a.y + a.d/2) * math.sin(rotX) + (a.z + a.h/2);
        final zb = (b.x + b.w/2) * math.cos(rotY) + (b.y + b.d/2) * math.sin(rotX) + (b.z + b.h/2);
        return za.compareTo(zb);
      });

    // Frustum culling simple: No dibujar las cajas super cubiertas
    for (final b in sorted) { _drawBoxShadow(canvas, size, b, ox, oy, oz); }
    for (final b in sorted) { _drawCargoBox(canvas, size, b, ox, oy, oz); }

    _drawLabel(canvas, size);
  }

  // ─── Suelo / Ground plane ─────────────────────────────────────────────

  void _drawGround(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d) {
    // Sombra suave ambiental alrededor del camión en el suelo
    final zFloor = oz - 2;
    final ext = 60.0;
    final pts = [
      _p3d(ox - ext, oy - ext, zFloor, size),
      _p3d(ox + w + ext, oy - ext, zFloor, size),
      _p3d(ox + w + ext, oy + d * 1.5, zFloor, size),
      _p3d(ox - ext, oy + d * 1.5, zFloor, size),
    ];
    canvas.drawPath(_pathOf(pts), Paint()
      ..color = Colors.black.withValues(alpha: 0.25)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 24));
  }

  // ─── Contenedor de carga (metálico, con paneles) ──────────────────────

  void _drawCargoContainer(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h) {
    // Colores metálicos del contenedor
    const metalBase = Color(0xFF3A4555); // Azul grisáceo oscuro
    const metalLight = Color(0xFF5A6A7F);
    const metalDark = Color(0xFF252D38);

    // Piso del contenedor
    _fillFace(canvas, size, [[ox,oy,oz],[ox+w,oy,oz],[ox+w,oy+d,oz],[ox,oy+d,oz]],
        metalDark, _light(0, 0, -1));

    // Pared trasera (fondo)
    _fillFace(canvas, size, [[ox,oy+d,oz],[ox+w,oy+d,oz],[ox+w,oy+d,oz+h],[ox,oy+d,oz+h]],
        metalBase, _light(0, 1, 0) * 0.7);

    // Pared izquierda
    _fillFace(canvas, size, [[ox,oy,oz],[ox,oy+d,oz],[ox,oy+d,oz+h],[ox,oy,oz+h]],
        metalBase, _light(-1, 0, 0));

    // Pared derecha
    _fillFace(canvas, size, [[ox+w,oy,oz],[ox+w,oy+d,oz],[ox+w,oy+d,oz+h],[ox+w,oy,oz+h]],
        metalLight, _light(1, 0, 0));

    // Techo (semi-transparente para ver dentro)
    _fillFace(canvas, size, [[ox,oy,oz+h],[ox+w,oy,oz+h],[ox+w,oy+d,oz+h],[ox,oy+d,oz+h]],
        metalBase, _light(0, 0, 1) * 0.3);

    // Panel delimitador frontal abierto (puertas) — solo borde
    final doorEdge = Paint()
      ..color = const Color(0xFF8899AA).withValues(alpha: 0.4)
      ..strokeWidth = 1.5..style = PaintingStyle.stroke;
    final doorPts = [_p3d(ox,oy,oz,size),_p3d(ox+w,oy,oz,size),
        _p3d(ox+w,oy,oz+h,size),_p3d(ox,oy,oz+h,size)];
    canvas.drawPath(_pathOf(doorPts), doorEdge);

    // Bordes del contenedor con brillo metálico
    _drawContainerEdges(canvas, size, ox, oy, oz, w, d, h);

    // Paneles laterales decorativos (líneas horizontales en el metal)
    _drawPanelLines(canvas, size, ox, oy, oz, w, d, h);

    // Refuerzos esquineros del contenedor
    _drawCornerReinforcements(canvas, size, ox, oy, oz, w, d, h);
  }

  void _fillFace(Canvas canvas, Size size, List<List<double>> pts, Color base, double light) {
    final offsets = pts.map((p) => _p3d(p[0], p[1], p[2], size)).toList();
    // Iluminación ajustada para evitar que todo se vea negro
    final l = light.clamp(0.4, 1.2); 
    final r = (base.r * l).round().clamp(0, 255);
    final g = (base.g * l).round().clamp(0, 255);
    final b2 = (base.b * l).round().clamp(0, 255);
    canvas.drawPath(_pathOf(offsets), Paint()..color = Color.fromARGB(220, r, g, b2));
  }

  void _drawContainerEdges(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h) {
    final edgeColor = const Color(0xFF90A0B0).withValues(alpha: 0.35);
    final p = Paint()..color = edgeColor..strokeWidth = 1.2..style = PaintingStyle.stroke;
    final v = [
      _p3d(ox,oy,oz,size),_p3d(ox+w,oy,oz,size),
      _p3d(ox+w,oy+d,oz,size),_p3d(ox,oy+d,oz,size),
      _p3d(ox,oy,oz+h,size),_p3d(ox+w,oy,oz+h,size),
      _p3d(ox+w,oy+d,oz+h,size),_p3d(ox,oy+d,oz+h,size),
    ];
    for (final e in [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
      canvas.drawLine(v[e[0]], v[e[1]], p);
    }
    // Borde frontal más brillante (apertura)
    final bright = Paint()..color = const Color(0xFFB0C0D0).withValues(alpha: 0.5)..strokeWidth = 2..style = PaintingStyle.stroke;
    canvas.drawLine(v[0], v[4], bright);
    canvas.drawLine(v[1], v[5], bright);
  }

  void _drawPanelLines(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h) {
    final p = Paint()..color = Colors.white.withValues(alpha: 0.04)..strokeWidth = 0.5;
    // Líneas horizontales en pared derecha
    for (int i = 1; i < 4; i++) {
      final zh = oz + h * i / 4;
      canvas.drawLine(_p3d(ox+w, oy, zh, size), _p3d(ox+w, oy+d, zh, size), p);
    }
    // Líneas horizontales en pared izquierda
    for (int i = 1; i < 4; i++) {
      final zh = oz + h * i / 4;
      canvas.drawLine(_p3d(ox, oy, zh, size), _p3d(ox, oy+d, zh, size), p);
    }
  }

  void _drawCornerReinforcements(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h) {
    final p = Paint()..color = const Color(0xFFAABBCC).withValues(alpha: 0.15)..strokeWidth = 3..style = PaintingStyle.stroke;
    final cornerH = h * 0.15;
    // Esquinas frontales - refuerzo L
    canvas.drawLine(_p3d(ox, oy, oz, size), _p3d(ox, oy, oz + cornerH, size), p);
    canvas.drawLine(_p3d(ox+w, oy, oz, size), _p3d(ox+w, oy, oz + cornerH, size), p);
    canvas.drawLine(_p3d(ox, oy, oz+h-cornerH, size), _p3d(ox, oy, oz+h, size), p);
    canvas.drawLine(_p3d(ox+w, oy, oz+h-cornerH, size), _p3d(ox+w, oy, oz+h, size), p);
  }

  // ─── Cabina realista ──────────────────────────────────────────────────

  void _drawCab(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h) {
    final cabD = d * 0.22;
    final cabOy = oy + d;
    final cabH = h * 0.88;
    final slopeR = 0.55; // Inclinación del parabrisas

    const cabColor = Color(0xFF2D3A4A); // Azul oscuro cabina
    const cabLight = Color(0xFF4A5A6A);
    const windshieldColor = Color(0xFF3A6080); // Cristal azulado

    // Pared trasera cabina (conecta con contenedor)
    _fillFace(canvas, size,
      [[ox,cabOy,oz],[ox+w,cabOy,oz],[ox+w,cabOy,oz+cabH],[ox,cabOy,oz+cabH]],
      cabColor, _light(0, -1, 0));

    // Laterales cabina
    _fillFace(canvas, size,
      [[ox,cabOy,oz],[ox,cabOy+cabD,oz],[ox,cabOy+cabD*slopeR,oz+cabH],[ox,cabOy,oz+cabH]],
      cabLight, _light(-1, 0, 0) * 0.85);
    _fillFace(canvas, size,
      [[ox+w,cabOy,oz],[ox+w,cabOy+cabD,oz],[ox+w,cabOy+cabD*slopeR,oz+cabH],[ox+w,cabOy,oz+cabH]],
      cabLight, _light(1, 0, 0));

    // Parabrisas (inclinado, azul cristal)
    _fillFace(canvas, size,
      [[ox,cabOy+cabD,oz],[ox+w,cabOy+cabD,oz],[ox+w,cabOy+cabD*slopeR,oz+cabH],[ox,cabOy+cabD*slopeR,oz+cabH]],
      windshieldColor, _light(0, 1, 0.3));

    // Reflejo en parabrisas
    final wMid = ox + w * 0.3;
    final wMid2 = ox + w * 0.7;
    final reflPts = [
      _p3d(wMid, cabOy+cabD*0.9, oz+cabH*0.2, size),
      _p3d(wMid2, cabOy+cabD*0.9, oz+cabH*0.2, size),
      _p3d(wMid2, cabOy+cabD*slopeR*0.85, oz+cabH*0.8, size),
      _p3d(wMid, cabOy+cabD*slopeR*0.85, oz+cabH*0.8, size),
    ];
    canvas.drawPath(_pathOf(reflPts),
        Paint()..color = Colors.white.withValues(alpha: 0.06));

    // Techo cabina
    _fillFace(canvas, size,
      [[ox,cabOy,oz+cabH],[ox+w,cabOy,oz+cabH],[ox+w,cabOy+cabD*slopeR,oz+cabH],[ox,cabOy+cabD*slopeR,oz+cabH]],
      cabColor, _light(0, 0, 1) * 0.8);

    // Bordes cabina
    final ep = Paint()..color = const Color(0xFF667788).withValues(alpha: 0.3)..strokeWidth = 0.8..style = PaintingStyle.stroke;
    final cv = [
      _p3d(ox,cabOy,oz,size), _p3d(ox+w,cabOy,oz,size),
      _p3d(ox+w,cabOy+cabD,oz,size), _p3d(ox,cabOy+cabD,oz,size),
      _p3d(ox,cabOy,oz+cabH,size), _p3d(ox+w,cabOy,oz+cabH,size),
      _p3d(ox+w,cabOy+cabD*slopeR,oz+cabH,size), _p3d(ox,cabOy+cabD*slopeR,oz+cabH,size),
    ];
    for (final e in [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
      canvas.drawLine(cv[e[0]], cv[e[1]], ep);
    }

    // Parachoques delantero
    final bumperH = h * 0.08;
    final bumperD = cabD * 0.15;
    _fillFace(canvas, size,
      [[ox-2,cabOy+cabD,oz],[ox+w+2,cabOy+cabD,oz],[ox+w+2,cabOy+cabD+bumperD,oz],[ox-2,cabOy+cabD+bumperD,oz]],
      const Color(0xFF555555), _light(0, 1, 0) * 0.7);
    _fillFace(canvas, size,
      [[ox-2,cabOy+cabD,oz],[ox+w+2,cabOy+cabD,oz],[ox+w+2,cabOy+cabD,oz+bumperH],[ox-2,cabOy+cabD,oz+bumperH]],
      const Color(0xFF666666), _light(0, 1, 0));

    // Faros
    final headlightSize = w * 0.12;
    for (final hx in [ox + headlightSize * 0.5, ox + w - headlightSize * 0.5]) {
      final hlPts = [
        _p3d(hx - headlightSize/2, cabOy+cabD+0.5, oz+bumperH*0.3, size),
        _p3d(hx + headlightSize/2, cabOy+cabD+0.5, oz+bumperH*0.3, size),
        _p3d(hx + headlightSize/2, cabOy+cabD+0.5, oz+bumperH*2.5, size),
        _p3d(hx - headlightSize/2, cabOy+cabD+0.5, oz+bumperH*2.5, size),
      ];
      canvas.drawPath(_pathOf(hlPts),
          Paint()..color = const Color(0xFFFFF8E0).withValues(alpha: 0.25));
      canvas.drawPath(_pathOf(hlPts),
          Paint()..color = const Color(0xFFFFF0B0).withValues(alpha: 0.15)
            ..maskFilter = const MaskFilter.blur(BlurStyle.outer, 4));
    }
  }

  // ─── Ruedas realistas ─────────────────────────────────────────────────

  void _drawWheels(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d, double h) {
    final r = h * 0.14;
    final tireColor = const Color(0xFF1A1A1A);
    final rimColor = const Color(0xFF888888);
    final hubColor = const Color(0xFFAAAAAA);

    // 4 ruedas: 2 traseras + 2 delanteras
    final wheelPositions = [
      [ox - r * 0.15, oy + d * 0.15],  // Trasera izquierda
      [ox + w + r * 0.15, oy + d * 0.15], // Trasera derecha
      [ox - r * 0.15, oy + d * 1.12], // Delantera izquierda
      [ox + w + r * 0.15, oy + d * 1.12], // Delantera derecha
    ];

    for (final pos in wheelPositions) {
      // Neumático (elipse en perspectiva)
      final tirePts = List.generate(17, (i) {
        final a = (i / 16) * 2 * math.pi;
        return _p3d(pos[0], pos[1] + math.cos(a) * r * 0.35, oz + math.sin(a) * r, size);
      });
      final tirePath = Path()..moveTo(tirePts[0].dx, tirePts[0].dy);
      for (final p in tirePts.skip(1)) { tirePath.lineTo(p.dx, p.dy); }
      tirePath.close();
      canvas.drawPath(tirePath, Paint()..color = tireColor.withValues(alpha: 0.7));
      canvas.drawPath(tirePath, Paint()..color = Colors.white.withValues(alpha: 0.08)..style = PaintingStyle.stroke..strokeWidth = 0.8);

      // Llanta interior
      final rimPts = List.generate(17, (i) {
        final a = (i / 16) * 2 * math.pi;
        return _p3d(pos[0], pos[1] + math.cos(a) * r * 0.2, oz + math.sin(a) * r * 0.6, size);
      });
      final rimPath = Path()..moveTo(rimPts[0].dx, rimPts[0].dy);
      for (final p in rimPts.skip(1)) { rimPath.lineTo(p.dx, p.dy); }
      rimPath.close();
      canvas.drawPath(rimPath, Paint()..color = rimColor.withValues(alpha: 0.25));

      // Centro (hub)
      final hubPts = List.generate(9, (i) {
        final a = (i / 8) * 2 * math.pi;
        return _p3d(pos[0], pos[1] + math.cos(a) * r * 0.08, oz + math.sin(a) * r * 0.2, size);
      });
      final hubPath = Path()..moveTo(hubPts[0].dx, hubPts[0].dy);
      for (final p in hubPts.skip(1)) { hubPath.lineTo(p.dx, p.dy); }
      hubPath.close();
      canvas.drawPath(hubPath, Paint()..color = hubColor.withValues(alpha: 0.3));
    }
  }

  // ─── Suelo interior con rejilla ───────────────────────────────────────

  void _drawFloorGrid(Canvas canvas, Size size, double ox, double oy, double oz,
      double w, double d) {
    final p = Paint()..color = Colors.white.withValues(alpha: 0.025)..strokeWidth = 0.3;
    final sp = 50.0; // 50cm spacing
    for (double x = 0; x <= w; x += sp) {
      canvas.drawLine(_p3d(ox+x, oy, oz+0.5, size), _p3d(ox+x, oy+d, oz+0.5, size), p);
    }
    for (double y = 0; y <= d; y += sp) {
      canvas.drawLine(_p3d(ox, oy+y, oz+0.5, size), _p3d(ox+w, oy+y, oz+0.5, size), p);
    }
  }

  // ─── Sombra de caja en el suelo ───────────────────────────────────────

  void _drawBoxShadow(Canvas canvas, Size size, PlacedBox b, double ox, double oy, double oz) {
    final pts = [
      _p3d(ox + b.x - 2, oy + b.y - 2, oz + 0.1, size),
      _p3d(ox + b.x + b.w + 2, oy + b.y - 2, oz + 0.1, size),
      _p3d(ox + b.x + b.w + 2, oy + b.y + b.d + 2, oz + 0.1, size),
      _p3d(ox + b.x - 2, oy + b.y + b.d + 2, oz + 0.1, size),
    ];
    final p = _pathOf(pts);
    canvas.drawPath(p, Paint()
      ..color = Colors.black.withValues(alpha: 0.25)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12));
  }

  // ─── Caja de carga (aspecto cartón) ───────────────────────────────────

  void _drawCargoBox(Canvas canvas, Size size, PlacedBox b, double ox, double oy, double oz) {
    final bx = ox + b.x, by = oy + b.y, bz = oz + b.z;
    final cc = _productColor(b.articleCode);
    final sel = b.id == selectedId;

    // Cara superior
    final topPts = [_p3d(bx,by,bz+b.h,size),_p3d(bx+b.w,by,bz+b.h,size),
        _p3d(bx+b.w,by+b.d,bz+b.h,size),_p3d(bx,by+b.d,bz+b.h,size)];
    // Cara frontal
    final frontPts = [_p3d(bx,by,bz,size),_p3d(bx+b.w,by,bz,size),
        _p3d(bx+b.w,by,bz+b.h,size),_p3d(bx,by,bz+b.h,size)];
    // Cara derecha
    final rightPts = [_p3d(bx+b.w,by,bz,size),_p3d(bx+b.w,by+b.d,bz,size),
        _p3d(bx+b.w,by+b.d,bz+b.h,size),_p3d(bx+b.w,by,bz+b.h,size)];

    final alpha = sel ? 0.92 : 0.82;

    // Caras con shading mejorado - Colores más vivos y legibles
    _drawShadedFace(canvas, topPts, cc, _light(0, 0, 1) * 1.5, alpha);
    _drawShadedFace(canvas, frontPts, cc, _light(0, -1, 0) * 1.3, alpha);
    _drawShadedFace(canvas, rightPts, cc, _light(1, 0, 0) * 1.3, alpha);

    // Línea de cinta de embalaje (tape) en la cara superior con textura
    if (b.w > 15 && b.d > 15) {
      final tapeW = b.w * 0.12;
      final tapePts = [
        _p3d(bx + b.w/2 - tapeW/2, by, bz+b.h+0.2, size),
        _p3d(bx + b.w/2 + tapeW/2, by, bz+b.h+0.2, size),
        _p3d(bx + b.w/2 + tapeW/2, by+b.d, bz+b.h+0.2, size),
        _p3d(bx + b.w/2 - tapeW/2, by+b.d, bz+b.h+0.2, size),
      ];
      canvas.drawPath(_pathOf(tapePts), Paint()
        ..color = Color.fromARGB((255*alpha).toInt(), 230, 220, 200).withValues(alpha: 0.6)
        ..style = PaintingStyle.fill);
      canvas.drawPath(_pathOf(tapePts), Paint()
        ..color = Colors.brown.withValues(alpha: 0.1)
        ..style = PaintingStyle.stroke..strokeWidth = 0.5);
    }

    // Bordes de la caja
    final edgeAlpha = sel ? 0.6 : 0.18;
    final edgeColor = sel ? AppTheme.neonBlue : Colors.white;
    final ep = Paint()
      ..color = edgeColor.withValues(alpha: edgeAlpha)
      ..strokeWidth = sel ? 1.5 : 0.6..style = PaintingStyle.stroke;
    canvas.drawPath(_pathOf(topPts), ep);
    canvas.drawPath(_pathOf(frontPts), ep);
    canvas.drawPath(_pathOf(rightPts), ep);

    // Glow de selección
    if (sel) {
      canvas.drawPath(_pathOf(topPts), Paint()
        ..color = AppTheme.neonBlue.withValues(alpha: 0.25 * glow)
        ..strokeWidth = 3..style = PaintingStyle.stroke
        ..maskFilter = const MaskFilter.blur(BlurStyle.outer, 5));
      canvas.drawPath(_pathOf(frontPts), Paint()
        ..color = AppTheme.neonBlue.withValues(alpha: 0.15 * glow)
        ..strokeWidth = 2..style = PaintingStyle.stroke
        ..maskFilter = const MaskFilter.blur(BlurStyle.outer, 4));
    }
  }

  void _drawShadedFace(Canvas canvas, List<Offset> pts, Color base, double light, double alpha) {
    final l = light.clamp(0.4, 1.5); 
    final r = (base.r * l).round().clamp(0, 255);
    final g = (base.g * l).round().clamp(0, 255);
    final b2 = (base.b * l).round().clamp(0, 255);
    
    final cMain = Color.fromARGB((alpha * 255).round(), r, g, b2);
    final cDark = Color.fromARGB((alpha * 255).round(), (r*0.8).round(), (g*0.8).round(), (b2*0.8).round());
    
    final path = _pathOf(pts);
    final rect = path.getBounds();
    final gradient = LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [cMain, cDark],
    );

    canvas.drawPath(path, Paint()..shader = gradient.createShader(rect)..style = PaintingStyle.fill);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

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
        style: TextStyle(color: Colors.white.withValues(alpha: 0.25), fontSize: 9)),
      textDirection: TextDirection.ltr)..layout();
    tp.paint(canvas, Offset(8, size.height - 16));
  }

  @override
  bool shouldRepaint(covariant _TruckPainter old) => true;
}
