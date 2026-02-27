/// Load Planner Panel — Order management, summary, overflow tabs
/// Extracted from the monolithic load_planner_3d_page.dart

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/warehouse_data_service.dart';
import '../painters/projection_3d.dart';

// ─── Helper models ──────────────────────────────────────────────────────────

class ClientSummary {
  final String code, name;
  final List<TruckOrder> orders = [];
  double totalWeight = 0;
  int totalBoxes = 0;
  ClientSummary({required this.code, required this.name});
}

class OverflowGroup {
  final String code, name, clientCode;
  int count = 0;
  double totalWeight = 0;
  OverflowGroup(
      {required this.code, required this.name, required this.clientCode});
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER PANEL WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

class LoadPlannerPanel extends StatefulWidget {
  final LoadPlanResult result;
  final List<TruckOrder> allOrders;
  final Set<int> excludedIndices;
  final bool isManualMode;
  final bool recomputing;
  final VoidCallback onAddAll;
  final VoidCallback onRemoveAll;
  final VoidCallback onReset;
  final ValueChanged<int> onRemoveOrder;
  final ValueChanged<int> onRestoreOrder;
  final ValueChanged<TruckOrder>? onDragStarted;

  const LoadPlannerPanel({
    super.key,
    required this.result,
    required this.allOrders,
    required this.excludedIndices,
    required this.isManualMode,
    required this.recomputing,
    required this.onAddAll,
    required this.onRemoveAll,
    required this.onReset,
    required this.onRemoveOrder,
    required this.onRestoreOrder,
    this.onDragStarted,
  });

  @override
  State<LoadPlannerPanel> createState() => _LoadPlannerPanelState();
}

class _LoadPlannerPanelState extends State<LoadPlannerPanel> {
  int _panelTab = 0;

  @override
  Widget build(BuildContext context) {
    final m = widget.result.metrics;
    final sc = _statusColor(m.status);

    return Container(
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        border: Border(
          left: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.15)),
        ),
      ),
      child: Column(children: [
        // Header with metrics
        _buildHeader(m, sc),
        const Divider(color: Colors.white10, height: 1),
        // Status banner
        _buildStatusBar(m, sc),
        // Tabs
        _buildTabs(m),
        const Divider(color: Colors.white10, height: 1),
        // Tab content
        Expanded(
          child: _panelTab == 0
              ? _buildResumen()
              : _panelTab == 1
                  ? _buildProductos()
                  : _buildOverflow(),
        ),
      ]),
    );
  }

  Color _statusColor(String s) => s == 'EXCESO'
      ? Colors.redAccent
      : s == 'OPTIMO'
          ? Colors.amber
          : AppTheme.neonGreen;

  // ─── HEADER ───────────────────────────────────────────────────────────

  Widget _buildHeader(LoadMetrics m, Color sc) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [
          AppTheme.neonBlue.withValues(alpha: 0.08),
          Colors.transparent,
        ]),
      ),
      child: Column(children: [
        Row(children: [
          const Icon(Icons.inventory_2_rounded,
              color: AppTheme.neonBlue, size: 16),
          const SizedBox(width: 6),
          Text('PEDIDOS DEL DIA',
              style: TextStyle(
                  color: AppTheme.neonBlue,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1)),
          const Spacer(),
          Text(
            '${widget.allOrders.length - widget.excludedIndices.length}/${widget.allOrders.length}',
            style: const TextStyle(
                color: AppTheme.neonGreen,
                fontSize: 11,
                fontWeight: FontWeight.w700),
          ),
        ]),
        const SizedBox(height: 8),
        // Action buttons
        Row(children: [
          Expanded(
              child: _actionBtn(
                  'Añadir Todo', Icons.add_circle_outline, AppTheme.neonGreen,
                  widget.onAddAll)),
          const SizedBox(width: 4),
          Expanded(
              child: _actionBtn('Quitar Todo', Icons.remove_circle_outline,
                  Colors.redAccent, widget.onRemoveAll)),
          const SizedBox(width: 4),
          _actionBtn(
              'Reset', Icons.restart_alt_rounded, Colors.amber, widget.onReset),
        ]),
        const SizedBox(height: 6),
        // Progress bars
        _progressBar('Peso', m.totalWeightKg, m.maxPayloadKg, 'kg', sc),
        const SizedBox(height: 4),
        _progressBar(
            'Vol.', m.usedVolumeCm3 / 1e6, m.containerVolumeCm3 / 1e6, 'm³', sc),
      ]),
    );
  }

  // ─── STATUS BAR ───────────────────────────────────────────────────────

  Widget _buildStatusBar(LoadMetrics m, Color sc) {
    String msg;
    if (m.status == 'EXCESO') {
      msg =
          'No cabe todo. ${m.placedCount} de ${m.totalBoxes} cargados — sobran ${m.overflowCount} (${m.overflowWeightKg.toStringAsFixed(0)} kg)';
    } else if (m.status == 'OPTIMO') {
      msg =
          'Camion casi lleno. ${m.placedCount} bultos, ${m.totalWeightKg.toStringAsFixed(0)} kg — queda poco espacio';
    } else {
      msg =
          'Todo cabe. ${m.placedCount} bultos, ${m.totalWeightKg.toStringAsFixed(0)} kg';
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: sc.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: sc.withValues(alpha: 0.3)),
      ),
      child: Row(children: [
        Icon(
          m.status == 'EXCESO'
              ? Icons.warning_rounded
              : m.status == 'OPTIMO'
                  ? Icons.check_circle_rounded
                  : Icons.verified_rounded,
          color: sc,
          size: 20,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(msg,
              style: TextStyle(
                  color: sc, fontSize: 11, fontWeight: FontWeight.w600)),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: sc.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            '${m.totalWeightKg.toStringAsFixed(0)} / ${m.maxPayloadKg.toStringAsFixed(0)} kg',
            style: TextStyle(
                color: sc, fontSize: 11, fontWeight: FontWeight.w800),
          ),
        ),
      ]),
    );
  }

  // ─── TABS ─────────────────────────────────────────────────────────────

  Widget _buildTabs(LoadMetrics m) {
    final hasOverflow = m.overflowCount > 0;
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 6, 8, 0),
      child: Row(children: [
        _tab('RESUMEN', 0, Icons.dashboard_rounded),
        _tab('PRODUCTOS', 1, Icons.inventory_2_rounded),
        if (hasOverflow)
          _tab('NO CABEN (${m.overflowCount})', 2,
              Icons.warning_amber_rounded),
      ]),
    );
  }

  Widget _tab(String label, int idx, IconData icon) {
    final sel = _panelTab == idx;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _panelTab = idx),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: sel ? AppTheme.neonBlue : Colors.transparent,
                width: 2,
              ),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon,
                  size: 13,
                  color: sel ? AppTheme.neonBlue : Colors.white30),
              const SizedBox(width: 4),
              Text(label,
                  style: TextStyle(
                      color: sel ? AppTheme.neonBlue : Colors.white30,
                      fontSize: 10,
                      fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
    );
  }

  // ─── TAB: RESUMEN ─────────────────────────────────────────────────────

  Widget _buildResumen() {
    final activeOrders = widget.allOrders
        .asMap()
        .entries
        .where((e) => !widget.excludedIndices.contains(e.key))
        .map((e) => e.value)
        .toList();

    final clientMap = <String, ClientSummary>{};
    for (final o in activeOrders) {
      final key = o.clientCode;
      clientMap.putIfAbsent(
          key,
          () => ClientSummary(
              code: key,
              name: o.clientName.isNotEmpty ? o.clientName : key));
      final cs = clientMap[key]!;
      cs.orders.add(o);
      cs.totalWeight += o.units * o.weightPerUnit;
      cs.totalBoxes += o.boxes > 0 ? o.boxes.round() : 1;
    }
    final clients = clientMap.values.toList()
      ..sort((a, b) => b.totalWeight.compareTo(a.totalWeight));

    final m = widget.result.metrics;
    return ListView(padding: const EdgeInsets.all(8), children: [
      // Summary row
      Container(
        padding: const EdgeInsets.all(10),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: AppTheme.neonBlue.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _summaryItem(
                'Pedidos',
                '${activeOrders.map((o) => o.orderNumber).toSet().length}',
                AppTheme.neonBlue),
            _summaryItem(
                'Clientes', '${clients.length}', AppTheme.neonPurple),
            _summaryItem('Bultos', '${m.placedCount}', AppTheme.neonGreen),
            _summaryItem(
                'Peso', '${m.totalWeightKg.toStringAsFixed(0)} kg', Colors.amber),
          ],
        ),
      ),
      ...clients.map((c) => _clientRow(c)),
    ]);
  }

  Widget _summaryItem(String label, String value, Color color) {
    return Column(mainAxisSize: MainAxisSize.min, children: [
      Text(value,
          style: TextStyle(
              color: color, fontSize: 16, fontWeight: FontWeight.w800)),
      Text(label,
          style: TextStyle(
              color: Colors.white.withValues(alpha: 0.35), fontSize: 9)),
    ]);
  }

  Widget _clientRow(ClientSummary c) {
    final cc = CargoColors.byClient(c.code);
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: cc.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: cc.withValues(alpha: 0.1)),
      ),
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 10),
        childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
        dense: true,
        leading: CircleAvatar(
          radius: 14,
          backgroundColor: cc.withValues(alpha: 0.15),
          child: Text(c.name.isNotEmpty ? c.name[0] : '?',
              style: TextStyle(
                  color: cc, fontSize: 12, fontWeight: FontWeight.w700)),
        ),
        title: Text(c.name,
            style: const TextStyle(
                color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
            maxLines: 1,
            overflow: TextOverflow.ellipsis),
        subtitle: Text(
            '${c.orders.length} lineas · ${c.totalBoxes} bultos · ${c.totalWeight.toStringAsFixed(0)} kg',
            style: TextStyle(
                color: Colors.white.withValues(alpha: 0.35), fontSize: 10)),
        iconColor: Colors.white30,
        collapsedIconColor: Colors.white.withValues(alpha: 0.2),
        children: c.orders
            .map((o) => Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Row(children: [
                    Container(
                      width: 20,
                      height: 20,
                      decoration: BoxDecoration(
                        color: CargoColors.sizeColor(o.weightPerUnit)
                            .withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Center(
                        child: Text(
                          CargoColors.sizeLabel(o.weightPerUnit),
                          style: TextStyle(
                              color: CargoColors.sizeColor(o.weightPerUnit),
                              fontSize: 8,
                              fontWeight: FontWeight.w800),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                          o.articleName.isNotEmpty
                              ? o.articleName
                              : o.articleCode,
                          style: const TextStyle(
                              color: Colors.white70, fontSize: 11),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                    ),
                    Text(
                        o.boxes > 0
                            ? '${o.boxes.toStringAsFixed(0)} cj'
                            : '${o.units.toStringAsFixed(0)} ud',
                        style: TextStyle(
                            color: AppTheme.neonGreen.withValues(alpha: 0.7),
                            fontSize: 10,
                            fontWeight: FontWeight.w600)),
                    const SizedBox(width: 8),
                    Text(
                        '${(o.units * o.weightPerUnit).toStringAsFixed(1)} kg',
                        style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.3),
                            fontSize: 10)),
                  ]),
                ))
            .toList(),
      ),
    );
  }

  // ─── TAB: PRODUCTOS ───────────────────────────────────────────────────

  Widget _buildProductos() {
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      itemCount: widget.allOrders.length,
      itemBuilder: (_, i) {
        final o = widget.allOrders[i];
        final excluded = widget.excludedIndices.contains(i);
        final weight = o.units * o.weightPerUnit;
        final cc = CargoColors.byClient(o.clientCode);

        final child = AnimatedOpacity(
          opacity: excluded ? 0.4 : 1.0,
          duration: const Duration(milliseconds: 300),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOutCubic,
            margin: const EdgeInsets.only(bottom: 2),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
            decoration: BoxDecoration(
              color: excluded
                  ? Colors.transparent
                  : cc.withValues(alpha: 0.05),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                  color: excluded
                      ? Colors.white10
                      : cc.withValues(alpha: 0.15)),
            ),
            child: Row(children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(shape: BoxShape.circle, color: cc),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      o.articleName.isNotEmpty ? o.articleName : o.articleCode,
                      style: TextStyle(
                        color: excluded ? Colors.white30 : Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w500,
                        decoration:
                            excluded ? TextDecoration.lineThrough : null,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      '${o.clientName.isNotEmpty ? o.clientName : o.clientCode} · #${o.orderNumber}',
                      style: TextStyle(
                          color:
                              excluded ? Colors.white10 : Colors.white24,
                          fontSize: 8),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    o.boxes > 0
                        ? '${o.boxes.toStringAsFixed(0)}cj'
                        : '${o.units.toStringAsFixed(0)}u',
                    style: TextStyle(
                        color:
                            excluded ? Colors.white12 : AppTheme.neonGreen,
                        fontSize: 9,
                        fontWeight: FontWeight.w600),
                  ),
                  if (weight > 0)
                    Text('${weight.toStringAsFixed(1)}kg',
                        style: TextStyle(
                            color: Colors.white.withValues(
                                alpha: excluded ? 0.08 : 0.2),
                            fontSize: 8)),
                ],
              ),
              const SizedBox(width: 4),
              SizedBox(
                width: 34,
                height: 20,
                child: Switch(
                  value: !excluded,
                  onChanged: (v) => v
                      ? widget.onRestoreOrder(i)
                      : widget.onRemoveOrder(i),
                  activeColor: AppTheme.neonGreen,
                  activeTrackColor: AppTheme.neonGreen.withValues(alpha: 0.3),
                  inactiveThumbColor: Colors.white24,
                  inactiveTrackColor: Colors.white10,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ),
            ]),
          ),
        );

        // Wrap with LongPressDraggable for drag & drop
        return LongPressDraggable<TruckOrder>(
          data: o,
          onDragStarted: () => widget.onDragStarted?.call(o),
          feedback: Material(
            elevation: 6,
            borderRadius: BorderRadius.circular(8),
            color: Colors.transparent,
            child: Container(
              width: 140,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppTheme.darkCard.withValues(alpha: 0.95),
                border: Border.all(color: cc.withValues(alpha: 0.6)),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                o.articleName.isNotEmpty ? o.articleName : o.articleCode,
                style: const TextStyle(
                    color: Colors.white, fontSize: 11),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          childWhenDragging:
              Opacity(opacity: 0.3, child: child),
          child: child,
        );
      },
    );
  }

  // ─── TAB: NO CABEN ───────────────────────────────────────────────────

  Widget _buildOverflow() {
    final overflow = widget.result.overflow;
    if (overflow.isEmpty) {
      return const Center(
          child: Text('Todo cabe en el camion',
              style: TextStyle(color: Colors.white30, fontSize: 13)));
    }

    final grouped = <String, OverflowGroup>{};
    for (final b in overflow) {
      grouped.putIfAbsent(
          b.articleCode,
          () => OverflowGroup(
              code: b.articleCode,
              name: b.label,
              clientCode: b.clientCode));
      grouped[b.articleCode]!.count++;
      grouped[b.articleCode]!.totalWeight += b.weight;
    }
    final groups = grouped.values.toList()
      ..sort((a, b) => b.totalWeight.compareTo(a.totalWeight));

    return ListView(padding: const EdgeInsets.all(8), children: [
      Container(
        padding: const EdgeInsets.all(10),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: Colors.redAccent.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.redAccent.withValues(alpha: 0.15)),
        ),
        child: Row(children: [
          const Icon(Icons.warning_amber_rounded,
              color: Colors.redAccent, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '${overflow.length} bultos no caben (${widget.result.metrics.overflowWeightKg.toStringAsFixed(0)} kg)',
              style: const TextStyle(
                  color: Colors.redAccent,
                  fontSize: 12,
                  fontWeight: FontWeight.w600),
            ),
          ),
        ]),
      ),
      ...groups.map((g) {
        String client = g.clientCode;
        for (final o in widget.allOrders) {
          if (o.clientCode == g.clientCode && o.clientName.isNotEmpty) {
            client = o.clientName;
            break;
          }
        }
        return Container(
          margin: const EdgeInsets.only(bottom: 3),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: Colors.redAccent.withValues(alpha: 0.03),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: Colors.redAccent.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Center(
                child: Text('${g.count}',
                    style: const TextStyle(
                        color: Colors.redAccent,
                        fontSize: 12,
                        fontWeight: FontWeight.w800)),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(g.name.isNotEmpty ? g.name : g.code,
                      style:
                          const TextStyle(color: Colors.white70, fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                  Text(client,
                      style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.25),
                          fontSize: 9)),
                ],
              ),
            ),
            Text('${g.totalWeight.toStringAsFixed(1)} kg',
                style: const TextStyle(
                    color: Colors.redAccent,
                    fontSize: 11,
                    fontWeight: FontWeight.w600)),
          ]),
        );
      }),
    ]);
  }

  // ─── WIDGETS HELPERS ──────────────────────────────────────────────────

  Widget _progressBar(
      String label, double used, double max, String unit, Color sc) {
    final pct = max > 0 ? (used / max).clamp(0.0, 1.0) : 0.0;
    final c = pct > 0.9
        ? Colors.redAccent
        : pct > 0.7
            ? Colors.amber
            : AppTheme.neonGreen;
    return Row(children: [
      SizedBox(
          width: 28,
          child: Text(label,
              style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.4), fontSize: 9))),
      Expanded(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: SizedBox(
            height: 6,
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: pct),
              duration: const Duration(milliseconds: 600),
              curve: Curves.easeOutCubic,
              builder: (_, v, __) => LinearProgressIndicator(
                  value: v, backgroundColor: Colors.white10, color: c),
            ),
          ),
        ),
      ),
      const SizedBox(width: 6),
      Text(
        '${used.toStringAsFixed(1)}/${max.toStringAsFixed(1)} $unit',
        style: TextStyle(
            color: Colors.white.withValues(alpha: 0.4), fontSize: 8),
      ),
    ]);
  }

  Widget _actionBtn(
      String label, IconData icon, Color color, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 6),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 3),
            Flexible(
              child: Text(label,
                  style: TextStyle(
                      color: color,
                      fontSize: 8,
                      fontWeight: FontWeight.w700),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
    );
  }
}
