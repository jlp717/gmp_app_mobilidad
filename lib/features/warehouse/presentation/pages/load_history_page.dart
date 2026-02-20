/// LOAD HISTORY PAGE — Historial de planificaciones de carga
/// Muestra registros históricos de cada vez que se planificó una carga

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/warehouse_data_service.dart';

class LoadHistoryPage extends StatefulWidget {
  const LoadHistoryPage({super.key});

  @override
  State<LoadHistoryPage> createState() => _LoadHistoryPageState();
}

class _LoadHistoryPageState extends State<LoadHistoryPage> {
  List<LoadHistoryEntry> _entries = [];
  List<VehicleConfig> _vehicles = [];
  bool _loading = true;
  String? _error;
  String? _selectedVehicle;

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  Future<void> _loadAll() async {
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        WarehouseDataService.getLoadHistory(vehicleCode: _selectedVehicle, limit: 50),
        WarehouseDataService.getVehicles(),
      ]);
      if (mounted) setState(() {
        _entries = results[0] as List<LoadHistoryEntry>;
        _vehicles = results[1] as List<VehicleConfig>;
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _loadHistory() async {
    setState(() { _loading = true; _error = null; });
    try {
      final entries = await WarehouseDataService.getLoadHistory(
          vehicleCode: _selectedVehicle, limit: 50);
      if (mounted) setState(() { _entries = entries; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Color _statusColor(String s) {
    if (s == 'EXCESO') return Colors.redAccent;
    if (s == 'OPTIMO') return Colors.amber;
    return AppTheme.neonGreen;
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(children: [
        _buildHeader(),
        _buildFilter(),
        Expanded(child: _loading
            ? const Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))
            : _error != null
                ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.error_outline, color: Colors.redAccent, size: 40),
                    const SizedBox(height: 8),
                    Text(_error!, style: const TextStyle(color: Colors.white54, fontSize: 13)),
                  ]))
                : _entries.isEmpty
                    ? const Center(child: Text('Sin historial de cargas',
                        style: TextStyle(color: Colors.white30, fontSize: 13)))
                    : RefreshIndicator(
                        onRefresh: _loadHistory,
                        color: AppTheme.neonBlue,
                        child: ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          itemCount: _entries.length,
                          itemBuilder: (_, i) => _entryCard(_entries[i]),
                        ),
                      )),
      ]),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: AppTheme.neonBlue.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(10)),
          child: const Icon(Icons.history_rounded, color: AppTheme.neonBlue, size: 22),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('HISTORIAL DE CARGAS', style: TextStyle(
              color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: 1)),
          Text('${_entries.length} planificaciones registradas',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 11)),
        ])),
      ]),
    );
  }

  Widget _buildFilter() {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      height: 44,
      child: ListView(scrollDirection: Axis.horizontal, children: [
        _filterChip('Todos', null),
        ..._vehicles.map((v) => _filterChip(v.code, v.code)),
      ]),
    );
  }

  Widget _filterChip(String label, String? code) {
    final sel = _selectedVehicle == code;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: FilterChip(
        selected: sel,
        label: Text(label, style: TextStyle(fontSize: 10, color: sel ? AppTheme.neonBlue : Colors.white38)),
        onSelected: (_) {
          setState(() => _selectedVehicle = code);
          _loadHistory();
        },
        selectedColor: AppTheme.neonBlue.withValues(alpha: 0.15),
        backgroundColor: AppTheme.darkCard,
        checkmarkColor: AppTheme.neonBlue,
        side: BorderSide(color: sel ? AppTheme.neonBlue.withValues(alpha: 0.3) : Colors.transparent),
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
      ),
    );
  }

  Widget _entryCard(LoadHistoryEntry e) {
    final sc = _statusColor(e.status);
    final volPct = e.volumePct.clamp(0, 100);

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: sc.withValues(alpha: 0.08))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Top row: vehicle + date + status
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppTheme.neonBlue.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(6)),
            child: Text(e.vehicleCode, style: const TextStyle(
                color: AppTheme.neonBlue, fontSize: 11, fontWeight: FontWeight.w800)),
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(e.date,
              style: TextStyle(color: Colors.white.withValues(alpha: 0.5), fontSize: 11))),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: sc.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(6)),
            child: Text(e.status,
                style: TextStyle(color: sc, fontSize: 10, fontWeight: FontWeight.w800)),
          ),
        ]),
        const SizedBox(height: 8),
        // Volume bar
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: LinearProgressIndicator(
            value: volPct / 100,
            backgroundColor: Colors.white.withValues(alpha: 0.05),
            valueColor: AlwaysStoppedAnimation(sc),
            minHeight: 6,
          ),
        ),
        const SizedBox(height: 6),
        // Bottom row: metrics
        Row(children: [
          _metric('Volumen', '${volPct.toStringAsFixed(0)}%', sc),
          _metric('Peso', '${e.weightKg.toStringAsFixed(0)} kg', Colors.amber),
          _metric('Pedidos', '${e.orderCount}', AppTheme.neonBlue),
          _metric('Bultos', '${e.boxCount}', AppTheme.neonGreen),
        ]),
      ]),
    );
  }

  Widget _metric(String label, String value, Color color) {
    return Expanded(child: Column(children: [
      Text(value, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
      Text(label, style: TextStyle(color: Colors.white.withValues(alpha: 0.25), fontSize: 8)),
    ]));
  }
}
