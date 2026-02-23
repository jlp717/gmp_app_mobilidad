import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/providers/auth_provider.dart';
import '../../../../core/utils/responsive.dart';

class RoleSelectionDialog extends StatefulWidget {
  const RoleSelectionDialog({super.key});

  @override
  State<RoleSelectionDialog> createState() => _RoleSelectionDialogState();
}

class _RoleSelectionDialogState extends State<RoleSelectionDialog> {
  String _selectedRole = 'COMERCIAL';
  String _viewAs = 'ALL_DRIVERS';

  @override
  Widget build(BuildContext context) {
    final isSmall = Responsive.isSmall(context);
    final dialogWidth = Responsive.clampWidth(context, 420);

    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: EdgeInsets.symmetric(
        horizontal: isSmall ? 16 : 40,
        vertical: isSmall ? 12 : 24,
      ),
      child: Container(
        width: dialogWidth,
        padding: EdgeInsets.all(isSmall ? 16 : 24),
        decoration: BoxDecoration(
          color: AppTheme.darkCard,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white10),
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Selecciona tu Rol Activo',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: isSmall ? 17 : 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Como Jefe de Ventas, puedes operar como Comercial o gestionar Reparto.',
                style: TextStyle(color: Colors.white60, fontSize: 13),
              ),
              SizedBox(height: isSmall ? 16 : 24),

              // ROLE SELECTOR
              _buildRoleOption(
                'COMERCIAL',
                Icons.shopping_bag_outlined,
                'Gestión de Ventas',
                AppTheme.neonBlue
              ),
              const SizedBox(height: 12),
              _buildRoleOption(
                'REPARTIDOR',
                Icons.local_shipping_outlined,
                'Gestión de Reparto',
                AppTheme.neonPurple
              ),
              const SizedBox(height: 12),
              _buildRoleOption(
                'ALMACEN',
                Icons.inventory_2_outlined,
                'Gestión de Almacén',
                AppTheme.neonPink
              ),

              // VIEW AS SELECTOR MOVED TO DASHBOARD

              SizedBox(height: isSmall ? 16 : 24),

              // ACTIONS
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () {
                       Navigator.of(context).pop();
                       context.go('/dashboard');
                    },
                    child: const Text('Cancelar', style: TextStyle(color: Colors.white38)),
                  ),
                  const SizedBox(width: 12),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.neonGreen,
                      foregroundColor: Colors.black,
                      padding: EdgeInsets.symmetric(
                        horizontal: isSmall ? 16 : 24,
                        vertical: isSmall ? 8 : 12,
                      ),
                    ),
                    onPressed: _confirmRole,
                    child: const Text('Confirmar', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRoleOption(String role, IconData icon, String label, Color color) {
    final isSelected = _selectedRole == role;
    return GestureDetector(
      onTap: () => setState(() => _selectedRole = role),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isSelected ? color.withOpacity(0.15) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? color : Colors.white10,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(icon, color: isSelected ? color : Colors.white38),
            const SizedBox(width: 16),
            Text(
              label,
              style: TextStyle(
                color: isSelected ? Colors.white : Colors.white60,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                fontSize: 15,
              ),
            ),
            const Spacer(),
            if (isSelected)
              Icon(Icons.check_circle, color: color, size: 20),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmRole() async {
    final auth = context.read<AuthProvider>();
    try {
      final success = await auth.switchRole(_selectedRole);
      if (success) {
        if (mounted) {
            Navigator.of(context).pop();
            context.go('/dashboard');
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
      }
    }
  }
}
