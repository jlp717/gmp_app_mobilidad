/// WAREHOUSE PERSONNEL PAGE
/// Gestión de operarios de almacén / preparadores de pedidos

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../data/warehouse_data_service.dart';

class PersonnelPage extends StatefulWidget {
  const PersonnelPage({super.key});

  @override
  State<PersonnelPage> createState() => _PersonnelPageState();
}

class _PersonnelPageState extends State<PersonnelPage> {
  List<WarehousePerson> _personnel = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await WarehouseDataService.getPersonnel();
      if (mounted) setState(() { _personnel = data; _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showAddDialog() {
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    String selectedRole = 'PREPARADOR';

    showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: AppTheme.darkCard,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.3)),
          ),
          title: const Text('Nuevo Operario',
              style: TextStyle(color: AppTheme.neonBlue, fontWeight: FontWeight.w700)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _field(nameCtrl, 'Nombre completo', Icons.person_outline),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: selectedRole,
                  dropdownColor: AppTheme.darkCard,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Rol',
                    labelStyle: TextStyle(color: Colors.white.withValues(alpha: 0.5)),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.15)),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppTheme.neonBlue),
                    ),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'PREPARADOR', child: Text('Preparador')),
                    DropdownMenuItem(value: 'SUPERVISOR', child: Text('Supervisor')),
                    DropdownMenuItem(value: 'CARGADOR', child: Text('Cargador')),
                    DropdownMenuItem(value: 'EXPEDIDOR', child: Text('Expedidor')),
                  ],
                  onChanged: (v) => setDialogState(() => selectedRole = v!),
                ),
                const SizedBox(height: 12),
                _field(phoneCtrl, 'Teléfono', Icons.phone_outlined),
                const SizedBox(height: 12),
                _field(emailCtrl, 'Email', Icons.email_outlined),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text('Cancelar',
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.5))),
            ),
            ElevatedButton(
              onPressed: () async {
                if (nameCtrl.text.trim().isEmpty) return;
                Navigator.pop(ctx);
                try {
                  await WarehouseDataService.addPerson(
                    nombre: nameCtrl.text.trim(),
                    rol: selectedRole,
                    telefono: phoneCtrl.text.trim().isNotEmpty ? phoneCtrl.text.trim() : null,
                    email: emailCtrl.text.trim().isNotEmpty ? emailCtrl.text.trim() : null,
                  );
                  _load();
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Error: $e'), backgroundColor: Colors.redAccent),
                    );
                  }
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.3),
                foregroundColor: AppTheme.neonBlue,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              child: const Text('Añadir'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _field(TextEditingController ctrl, String label, IconData icon) {
    return TextField(
      controller: ctrl,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: Colors.white.withValues(alpha: 0.5)),
        prefixIcon: Icon(icon, color: AppTheme.neonBlue.withValues(alpha: 0.5), size: 20),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.15)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppTheme.neonBlue),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          // Header
          Container(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 10),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppTheme.neonPurple.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppTheme.neonPurple.withValues(alpha: 0.3)),
                  ),
                  child: const Icon(Icons.groups_rounded, color: AppTheme.neonPurple, size: 24),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('PERSONAL DE ALMACÉN',
                          style: TextStyle(
                              color: AppTheme.neonPurple,
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 1.2)),
                      Text('${_personnel.length} operarios activos',
                          style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.5),
                              fontSize: 12)),
                    ],
                  ),
                ),
                FloatingActionButton.small(
                  heroTag: 'add_person',
                  backgroundColor: AppTheme.neonPurple.withValues(alpha: 0.3),
                  onPressed: _showAddDialog,
                  child: const Icon(Icons.person_add_rounded, color: AppTheme.neonPurple, size: 20),
                ),
              ],
            ),
          ),

          // List
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: AppTheme.neonPurple))
                : _personnel.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.person_off_outlined,
                                color: Colors.white.withValues(alpha: 0.3), size: 48),
                            const SizedBox(height: 12),
                            Text('Sin personal registrado',
                                style: TextStyle(color: Colors.white.withValues(alpha: 0.5))),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _load,
                        color: AppTheme.neonPurple,
                        child: ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          itemCount: _personnel.length,
                          itemBuilder: (ctx, i) => _personCard(_personnel[i]),
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _personCard(WarehousePerson person) {
    final roleColor = _roleColor(person.role);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: roleColor.withValues(alpha: 0.15)),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 22,
            backgroundColor: roleColor.withValues(alpha: 0.15),
            child: Text(
              person.name.isNotEmpty ? person.name[0].toUpperCase() : '?',
              style: TextStyle(color: roleColor, fontWeight: FontWeight.w700, fontSize: 18),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(person.name,
                    style: const TextStyle(
                        color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: roleColor.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(person.role,
                          style: TextStyle(color: roleColor, fontSize: 10, fontWeight: FontWeight.w700)),
                    ),
                    if (person.phone.isNotEmpty) ...[
                      const SizedBox(width: 8),
                      Icon(Icons.phone_outlined, color: Colors.white.withValues(alpha: 0.3), size: 12),
                      const SizedBox(width: 4),
                      Text(person.phone,
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 11)),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Color _roleColor(String role) {
    switch (role) {
      case 'SUPERVISOR':
        return Colors.amber;
      case 'CARGADOR':
        return AppTheme.neonGreen;
      case 'EXPEDIDOR':
        return AppTheme.neonBlue;
      default:
        return AppTheme.neonPurple;
    }
  }
}
