/// WAREHOUSE PERSONNEL PAGE
/// Gestión de operarios de almacén / preparadores de pedidos
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/optimized_list.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';
import 'package:gmp_app_mobilidad/features/warehouse/data/warehouse_data_service.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/widgets/warehouse_ui.dart';

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

  Future<void> _load({bool forceRefresh = false}) async {
    setState(() => _loading = true);
    try {
      final data = await WarehouseDataService.getPersonnel(
        forceRefresh: forceRefresh,
      );
      if (mounted) {
        setState(() {
          _personnel = data;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showAddDialog() {
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    var selectedRole = 'PREPARADOR';

    showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: AppTheme.raisedSurface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            side: BorderSide(color: AppTheme.borderColor),
          ),
          title: Text(
            'Nuevo Operario',
            style: TextStyle(
              color: AppTheme.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _field(nameCtrl, 'Nombre completo', Icons.person_outline),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: selectedRole,
                  dropdownColor: AppTheme.raisedSurface,
                  style: TextStyle(color: AppTheme.textPrimary),
                  decoration: InputDecoration(
                    labelText: 'Rol',
                    labelStyle: TextStyle(color: AppTheme.textSecondary),
                    filled: true,
                    fillColor: AppTheme.softPanel,
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide(color: AppTheme.borderColor),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide:
                          const BorderSide(color: AppTheme.accentIndigo),
                    ),
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: 'PREPARADOR',
                      child: Text('Preparador'),
                    ),
                    DropdownMenuItem(
                      value: 'SUPERVISOR',
                      child: Text('Supervisor'),
                    ),
                    DropdownMenuItem(
                      value: 'CARGADOR',
                      child: Text('Cargador'),
                    ),
                    DropdownMenuItem(
                      value: 'EXPEDIDOR',
                      child: Text('Expedidor'),
                    ),
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
              child: Text(
                'Cancelar',
                style: TextStyle(color: AppTheme.textTertiary),
              ),
            ),
            ElevatedButton(
              onPressed: () async {
                if (nameCtrl.text.trim().isEmpty) return;
                Navigator.pop(ctx);
                try {
                  await WarehouseDataService.addPerson(
                    nombre: nameCtrl.text.trim(),
                    rol: selectedRole,
                    telefono: phoneCtrl.text.trim().isNotEmpty
                        ? phoneCtrl.text.trim()
                        : null,
                    email: emailCtrl.text.trim().isNotEmpty
                        ? emailCtrl.text.trim()
                        : null,
                  );
                  _load(forceRefresh: true);
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('Error: $e'),
                        backgroundColor: AppTheme.error,
                      ),
                    );
                  }
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.accentIndigo,
                foregroundColor: AppTheme.textPrimary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
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
      style: TextStyle(color: AppTheme.textPrimary),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(color: AppTheme.textSecondary),
        prefixIcon: Icon(icon, color: AppTheme.accentIndigo, size: 20),
        filled: true,
        fillColor: AppTheme.softPanel,
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: AppTheme.borderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppTheme.accentIndigo),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: WarehouseUi.pageShell(
        child: Column(
          children: [
            Container(
              margin: const EdgeInsets.fromLTRB(12, 10, 12, 8),
              padding: EdgeInsets.fromLTRB(
                Responsive.padding(context, small: 14, large: 20),
                12,
                Responsive.padding(context, small: 14, large: 20),
                10,
              ),
              decoration:
                  WarehouseUi.headerSurface(accent: AppTheme.accentIndigo),
              child: Row(
                children: [
                  Container(
                    padding: EdgeInsets.all(
                      Responsive.padding(context, small: 8, large: 10),
                    ),
                    decoration: WarehouseUi.surface(
                      color: AppTheme.accentIndigo.withValues(alpha: 0.15),
                      borderColor: AppTheme.accentIndigo,
                      borderAlpha: 0.3,
                    ),
                    child: Icon(
                      Icons.groups_rounded,
                      color: AppTheme.accentIndigo,
                      size: Responsive.iconSize(
                        context,
                        phone: 20,
                        desktop: 24,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'PERSONAL DE ALMACÉN',
                          style: TextStyle(
                            color: AppTheme.accentIndigo,
                            fontSize: Responsive.fontSize(
                              context,
                              small: 13,
                              large: 16,
                            ),
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0,
                          ),
                        ),
                        Text(
                          '${_personnel.length} operarios activos',
                          style: TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (kDebugMode)
                    IconButton(
                      icon: const Icon(
                        Icons.cleaning_services_rounded,
                        color: AppTheme.warning,
                        size: 20,
                      ),
                      tooltip: 'Limpiar entradas de test',
                      style: WarehouseUi.iconButtonStyle(AppTheme.warning),
                      onPressed: () async {
                        try {
                          await WarehouseDataService.cleanupTestPersonnel();
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Entradas de test limpiadas'),
                                backgroundColor: AppTheme.warning,
                              ),
                            );
                            _load(forceRefresh: true);
                          }
                        } catch (e) {
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text('Error: $e'),
                                backgroundColor: AppTheme.error,
                              ),
                            );
                          }
                        }
                      },
                    ),
                  FloatingActionButton.small(
                    heroTag: 'add_person',
                    backgroundColor: AppTheme.accentIndigo,
                    foregroundColor: AppTheme.textPrimary,
                    onPressed: _showAddDialog,
                    child: const Icon(Icons.person_add_rounded, size: 20),
                  ),
                ],
              ),
            ),
            Expanded(
              child: _loading
                  ? const SkeletonList(itemCount: 4, itemHeight: 80)
                  : _personnel.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.person_off_outlined,
                                color: AppTheme.textTertiary,
                                size: 48,
                              ),
                              SizedBox(height: 12),
                              Text(
                                'Sin personal registrado',
                                style: TextStyle(
                                  color: AppTheme.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: () => _load(forceRefresh: true),
                          color: AppTheme.accentIndigo,
                          child: OptimizedListView(
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                            itemCount: _personnel.length,
                            itemBuilder: (ctx, i) => _personCard(_personnel[i]),
                          ),
                        ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _personCard(WarehousePerson person) {
    final roleColor = _roleColor(person.role);
    final isCustom = person.source == 'custom';
    return GestureDetector(
      onLongPress: isCustom ? () => _showPersonActions(person) : null,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding:
            EdgeInsets.all(Responsive.padding(context, small: 10, large: 12)),
        decoration: WarehouseUi.executiveSurface(
          accent: roleColor,
          borderAlpha: isCustom ? 0.26 : 0.16,
          accentAlpha: isCustom ? 0.08 : 0.04,
        ),
        child: Row(
          children: [
            CircleAvatar(
              radius: Responsive.value(context, phone: 18, desktop: 22),
              backgroundColor: roleColor.withValues(alpha: 0.15),
              child: Text(
                person.name.isNotEmpty ? person.name[0].toUpperCase() : '?',
                style: TextStyle(
                  color: roleColor,
                  fontWeight: FontWeight.w700,
                  fontSize: Responsive.fontSize(context, small: 14, large: 18),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          person.name,
                          style: TextStyle(
                            color: AppTheme.textPrimary,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      if (!isCustom)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: AppTheme.softPanel,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'ERP',
                            style: TextStyle(
                              color: AppTheme.textTertiary,
                              fontSize: 8,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: roleColor.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          person.role,
                          style: TextStyle(
                            color: roleColor,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      if (person.phone.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Icon(
                          Icons.phone_outlined,
                          color: AppTheme.textTertiary,
                          size: 12,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          person.phone,
                          style: TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 11,
                          ),
                        ),
                      ],
                      if (person.email.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Icon(
                          Icons.email_outlined,
                          color: AppTheme.textTertiary,
                          size: 12,
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            if (isCustom)
              Icon(
                Icons.more_vert_rounded,
                color: AppTheme.textTertiary,
                size: 18,
              ),
          ],
        ),
      ),
    );
  }

  void _showPersonActions(WarehousePerson person) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.raisedSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppTheme.radiusLg),
        ),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              person.name,
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.edit_rounded, color: AppTheme.info),
              title: Text(
                'Editar',
                style: TextStyle(color: AppTheme.textPrimary),
              ),
              onTap: () {
                Navigator.pop(ctx);
                _showEditDialog(person);
              },
            ),
            ListTile(
              leading: const Icon(
                Icons.delete_outline_rounded,
                color: AppTheme.error,
              ),
              title: const Text(
                'Eliminar',
                style: TextStyle(color: AppTheme.error),
              ),
              onTap: () {
                Navigator.pop(ctx);
                _confirmDelete(person);
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showEditDialog(WarehousePerson person) {
    final nameCtrl = TextEditingController(text: person.name);
    final phoneCtrl = TextEditingController(text: person.phone);
    final emailCtrl = TextEditingController(text: person.email);
    var selectedRole = person.role;

    showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: AppTheme.raisedSurface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            side: BorderSide(color: AppTheme.borderColor),
          ),
          title: Text(
            'Editar Operario',
            style: TextStyle(
              color: AppTheme.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _field(nameCtrl, 'Nombre completo', Icons.person_outline),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: selectedRole,
                  dropdownColor: AppTheme.raisedSurface,
                  style: TextStyle(color: AppTheme.textPrimary),
                  decoration: InputDecoration(
                    labelText: 'Rol',
                    labelStyle: TextStyle(color: AppTheme.textSecondary),
                    filled: true,
                    fillColor: AppTheme.softPanel,
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide(color: AppTheme.borderColor),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide:
                          const BorderSide(color: AppTheme.accentIndigo),
                    ),
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: 'PREPARADOR',
                      child: Text('Preparador'),
                    ),
                    DropdownMenuItem(
                      value: 'SUPERVISOR',
                      child: Text('Supervisor'),
                    ),
                    DropdownMenuItem(
                      value: 'CARGADOR',
                      child: Text('Cargador'),
                    ),
                    DropdownMenuItem(
                      value: 'EXPEDIDOR',
                      child: Text('Expedidor'),
                    ),
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
              child: Text(
                'Cancelar',
                style: TextStyle(color: AppTheme.textTertiary),
              ),
            ),
            ElevatedButton(
              onPressed: () async {
                if (nameCtrl.text.trim().isEmpty) return;
                Navigator.pop(ctx);
                try {
                  await WarehouseDataService.updatePerson(
                    id: person.id,
                    nombre: nameCtrl.text.trim(),
                    rol: selectedRole,
                    telefono: phoneCtrl.text.trim(),
                    email: emailCtrl.text.trim(),
                  );
                  _load(forceRefresh: true);
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('Error: $e'),
                        backgroundColor: AppTheme.error,
                      ),
                    );
                  }
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.accentIndigo,
                foregroundColor: AppTheme.textPrimary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: const Text('Guardar'),
            ),
          ],
        ),
      ),
    );
  }

  void _confirmDelete(WarehousePerson person) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          side: BorderSide(color: AppTheme.borderColor),
        ),
        title: const Text(
          'Eliminar operario',
          style: TextStyle(color: AppTheme.error, fontWeight: FontWeight.w700),
        ),
        content: Text(
          '¿Eliminar a ${person.name}?',
          style: TextStyle(color: AppTheme.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(
              'Cancelar',
              style: TextStyle(color: AppTheme.textTertiary),
            ),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              try {
                await WarehouseDataService.deletePerson(person.id);
                _load(forceRefresh: true);
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Error: $e'),
                      backgroundColor: AppTheme.error,
                    ),
                  );
                }
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.error.withValues(alpha: 0.3),
              foregroundColor: AppTheme.error,
            ),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
  }

  Color _roleColor(String role) {
    switch (role) {
      case 'SUPERVISOR':
        return AppTheme.warning;
      case 'CARGADOR':
        return AppTheme.success;
      case 'EXPEDIDOR':
        return AppTheme.info;
      default:
        return AppTheme.accentIndigo;
    }
  }
}
