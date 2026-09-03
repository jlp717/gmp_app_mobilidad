import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:go_router/go_router.dart';

/// Role selection dialog with compact operational styling.
class RoleSelectionDialog extends StatefulWidget {
  const RoleSelectionDialog({super.key});

  @override
  State<RoleSelectionDialog> createState() => _RoleSelectionDialogState();
}

class _RoleSelectionDialogState extends State<RoleSelectionDialog> {
  String _selectedRole = 'COMERCIAL';
  bool _isSwitching = false;

  @override
  Widget build(BuildContext context) {
    final isSmall = Responsive.isSmall(context);
    final dialogWidth = Responsive.clampWidth(context, 440);

    return Dialog(
      backgroundColor: AppColors.transparent,
      insetPadding: EdgeInsets.symmetric(
        horizontal: isSmall ? 16 : 40,
        vertical: isSmall ? 12 : 24,
      ),
      child: Container(
        width: dialogWidth,
        padding: EdgeInsets.all(isSmall ? 24 : 32),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          borderRadius: BorderRadius.circular(AppTheme.radiusXl),
          border:
              Border.all(color: AppColors.themedWhite.withValues(alpha: 0.08)),
          boxShadow: [
            BoxShadow(
              color: AppColors.systemBlack.withValues(alpha: 0.4),
              blurRadius: 40,
              offset: const Offset(0, 20),
            ),
          ],
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppTheme.info,
                      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                    ),
                    child: Icon(
                      Icons.account_circle_rounded,
                      color: AppColors.themedWhite,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Selecciona tu Rol Activo',
                          style: TextStyle(
                            color: AppColors.themedWhite,
                            fontSize: isSmall ? 17 : 20,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Como Jefe, puedes operar en diferentes perfiles',
                          style: TextStyle(
                            color: AppColors.themedWhite.withValues(alpha: 0.4),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              SizedBox(height: isSmall ? 20 : 28),

              // Role options
              _buildRoleOption(
                'COMERCIAL',
                Icons.shopping_bag_outlined,
                'Gestión de Ventas',
                AppTheme.info,
              ),
              const SizedBox(height: 10),
              _buildRoleOption(
                'REPARTIDOR',
                Icons.local_shipping_outlined,
                'Gestión de Reparto',
                AppTheme.accentIndigo,
              ),
              const SizedBox(height: 10),
              _buildRoleOption(
                'ALMACEN',
                Icons.inventory_2_outlined,
                'Gestión de Almacén',
                AppTheme.accentRose,
              ),

              SizedBox(height: isSmall ? 20 : 28),

              // Actions
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: _isSwitching
                        ? null
                        : () {
                            Navigator.of(context).pop();
                            context.go('/dashboard');
                          },
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                      ),
                    ),
                    child: Text(
                      'Cancelar',
                      style: TextStyle(color: AppColors.themedWhite38),
                    ),
                  ),
                  const SizedBox(width: 10),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.info,
                      foregroundColor: AppColors.themedWhite,
                      padding: EdgeInsets.symmetric(
                        horizontal: isSmall ? 20 : 28,
                        vertical: isSmall ? 10 : 14,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                      ),
                      elevation: 0,
                      shadowColor: AppTheme.info.withValues(alpha: 0.3),
                    ),
                    onPressed: _isSwitching ? null : _confirmRole,
                    child: _isSwitching
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text(
                            'Confirmar',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              letterSpacing: 0,
                            ),
                          ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRoleOption(
    String role,
    IconData icon,
    String label,
    Color color,
  ) {
    final isSelected = _selectedRole == role;
    return InkWell(
      onTap: _isSwitching ? null : () => setState(() => _selectedRole = role),
      borderRadius: BorderRadius.circular(AppTheme.radiusLg),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isSelected
              ? color.withValues(alpha: 0.12)
              : AppTheme.softPanel.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(
            color: isSelected
                ? color.withValues(alpha: 0.3)
                : AppColors.themedWhite.withValues(alpha: 0.06),
            width: isSelected ? 1.5 : 1,
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: color.withValues(alpha: 0.08),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ]
              : [],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: (isSelected ? color : AppColors.themedWhite)
                    .withValues(alpha: isSelected ? 0.15 : 0.06),
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              ),
              child: Icon(
                icon,
                color: isSelected
                    ? color
                    : AppColors.themedWhite.withValues(alpha: 0.3),
                size: 22,
              ),
            ),
            const SizedBox(width: 14),
            Text(
              label,
              style: TextStyle(
                color: isSelected
                    ? AppColors.themedWhite
                    : AppColors.themedWhite.withValues(alpha: 0.5),
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                fontSize: 15,
              ),
            ),
            const Spacer(),
            AnimatedOpacity(
              duration: const Duration(milliseconds: 200),
              opacity: isSelected ? 1.0 : 0.0,
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(Icons.check_rounded, color: color, size: 16),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmRole() async {
    if (_isSwitching) return;
    setState(() => _isSwitching = true);
    final ref = ProviderScope.containerOf(context);
    try {
      final success =
          await ref.read(authProvider.notifier).switchRole(_selectedRole);
      if (success) {
        if (mounted) {
          Navigator.of(context).pop();
          context.go('/dashboard');
        }
      } else {
        if (mounted) {
          final error = ref.read(authProvider).value?.error;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Error: ${error ?? "Failed to switch role"}'),
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              ),
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSwitching = false);
    }
  }
}
