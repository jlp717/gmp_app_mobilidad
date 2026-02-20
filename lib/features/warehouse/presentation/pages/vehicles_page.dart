/// VEHICULOS PAGE — Gestión de flota de vehículos
/// Permite ver y configurar dimensiones interiores de cada vehículo

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/warehouse_data_service.dart';

class VehiclesPage extends StatefulWidget {
  const VehiclesPage({super.key});

  @override
  State<VehiclesPage> createState() => _VehiclesPageState();
}

class _VehiclesPageState extends State<VehiclesPage> {
  List<VehicleConfig> _vehicles = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final v = await WarehouseDataService.getVehicles();
      if (mounted) setState(() { _vehicles = v; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(children: [
        _buildHeader(),
        Expanded(child: _loading
            ? const Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))
            : _error != null
                ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.error_outline, color: Colors.redAccent, size: 40),
                    const SizedBox(height: 8),
                    Text(_error!, style: const TextStyle(color: Colors.white54, fontSize: 13)),
                    const SizedBox(height: 12),
                    TextButton(onPressed: _load, child: const Text('Reintentar')),
                  ]))
                : RefreshIndicator(
                    onRefresh: _load,
                    color: AppTheme.neonBlue,
                    child: ListView.builder(
                      padding: const EdgeInsets.all(12),
                      itemCount: _vehicles.length,
                      itemBuilder: (_, i) => _vehicleCard(_vehicles[i]),
                    ),
                  )),
      ]),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: AppTheme.neonPurple.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(10)),
          child: const Icon(Icons.local_shipping_rounded, color: AppTheme.neonPurple, size: 22),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('FLOTA DE VEHICULOS', style: TextStyle(
              color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: 1)),
          Text('${_vehicles.length} vehiculos registrados',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 11)),
        ])),
      ]),
    );
  }

  Widget _vehicleCard(VehicleConfig v) {
    final hasCustomInterior = v.interior.lengthCm > 0 && v.interior.widthCm > 0;
    final accentColor = hasCustomInterior ? AppTheme.neonGreen : Colors.amber;
    final interior = v.interior;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: accentColor.withValues(alpha: 0.1))),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _showEditDialog(v),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            // Vehicle icon
            Container(
              width: 48, height: 48,
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10)),
              child: const Icon(Icons.local_shipping_rounded,
                  color: AppTheme.neonBlue, size: 26),
            ),
            const SizedBox(width: 12),
            // Info
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Text(v.code, style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w700)),
                const SizedBox(width: 8),
                if (v.matricula.isNotEmpty)
                  Text(v.matricula, style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 11)),
              ]),
              if (v.description.isNotEmpty)
                Text(v.description, style: TextStyle(color: Colors.white.withValues(alpha: 0.5), fontSize: 11),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 4),
              Row(children: [
                _miniKpi('Interior', '${interior.lengthCm.toInt()}x${interior.widthCm.toInt()}x${interior.heightCm.toInt()} cm', AppTheme.neonBlue),
                const SizedBox(width: 12),
                _miniKpi('Carga', '${v.maxPayloadKg.toStringAsFixed(0)} kg', AppTheme.neonGreen),
                const SizedBox(width: 12),
                _miniKpi('Vol.', '${v.containerVolumeM3.toStringAsFixed(2)} m³', Colors.amber),
              ]),
            ])),
            // Edit indicator
            Icon(Icons.edit_rounded, color: Colors.white.withValues(alpha: 0.15), size: 18),
          ]),
        ),
      ),
    );
  }

  Widget _miniKpi(String label, String value, Color color) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(value, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700)),
      Text(label, style: TextStyle(color: Colors.white.withValues(alpha: 0.25), fontSize: 8)),
    ]);
  }

  void _showEditDialog(VehicleConfig v) {
    final largoC = TextEditingController(text: v.interior.lengthCm.toStringAsFixed(0));
    final anchoC = TextEditingController(text: v.interior.widthCm.toStringAsFixed(0));
    final altoC = TextEditingController(text: v.interior.heightCm.toStringAsFixed(0));
    final toleranciaC = TextEditingController(text: v.tolerancePct.toStringAsFixed(0));

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.darkCard,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 40, height: 4, decoration: BoxDecoration(
              color: Colors.white24, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 16),
          Text('Configurar ${v.code}', style: const TextStyle(
              color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
          Text(v.description, style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 12)),
          const SizedBox(height: 20),
          Row(children: [
            Expanded(child: _field(largoC, 'Largo (cm)', Icons.straighten)),
            const SizedBox(width: 10),
            Expanded(child: _field(anchoC, 'Ancho (cm)', Icons.width_normal)),
            const SizedBox(width: 10),
            Expanded(child: _field(altoC, 'Alto (cm)', Icons.height)),
          ]),
          const SizedBox(height: 12),
          _field(toleranciaC, 'Tolerancia exceso (%)', Icons.tune),
          const SizedBox(height: 20),
          SizedBox(width: double.infinity, height: 44, child: ElevatedButton.icon(
            onPressed: () async {
              try {
                await WarehouseDataService.updateTruckConfig(
                  vehicleCode: v.code,
                  largoInteriorCm: double.tryParse(largoC.text),
                  anchoInteriorCm: double.tryParse(anchoC.text),
                  altoInteriorCm: double.tryParse(altoC.text),
                  toleranciaExceso: double.tryParse(toleranciaC.text),
                );
                if (ctx.mounted) Navigator.pop(ctx);
                _load();
              } catch (e) {
                if (ctx.mounted) {
                  ScaffoldMessenger.of(ctx).showSnackBar(
                    SnackBar(content: Text('Error: $e'), backgroundColor: Colors.redAccent));
                }
              }
            },
            icon: const Icon(Icons.save_rounded, size: 18),
            label: const Text('GUARDAR', style: TextStyle(fontWeight: FontWeight.w700, letterSpacing: 1)),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.2),
              foregroundColor: AppTheme.neonBlue,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
          )),
        ]),
      ),
    );
  }

  Widget _field(TextEditingController c, String label, IconData icon) {
    return TextField(
      controller: c,
      keyboardType: TextInputType.number,
      style: const TextStyle(color: Colors.white, fontSize: 14),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 12),
        prefixIcon: Icon(icon, size: 18, color: Colors.white30),
        filled: true,
        fillColor: AppTheme.darkBase,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
    );
  }
}
