import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/design/a11y_tokens.dart';
import 'package:gmp_app_mobilidad/core/design/gmp_feedback.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:go_router/go_router.dart';

/// El jefe elige un perfil de trabajo. El elegido se lee, no solo se colorea.
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
    final screenW = MediaQuery.sizeOf(context).width;
    final preferred = Responsive.clampWidth(context, 440);
    final dialogWidth = preferred > screenW - 32 ? screenW - 32 : preferred;

    return Dialog(
      backgroundColor: AppColors.transparent,
      insetPadding: EdgeInsets.symmetric(
        horizontal: isSmall ? 16 : 40,
        vertical: isSmall ? 12 : 24,
      ),
      child: Container(
        width: dialogWidth,
        padding: EdgeInsets.all(isSmall ? 20 : 28),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          borderRadius: BorderRadius.circular(AppTheme.radiusXl),
          border: Border.all(
            color: AppColors.themedWhite.withValues(alpha: 0.08),
          ),
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Elige cómo vas a trabajar',
                style: A11yTokens.title.copyWith(color: AppColors.themedWhite),
              ),
              const SizedBox(height: 8),
              Text(
                'Puedes vender, repartir o entrar en almacén. Luego podrás cambiar.',
                style: A11yTokens.body.copyWith(color: AppTheme.textSecondary),
              ),
              SizedBox(height: isSmall ? 16 : 24),
              _buildRoleOption(
                'COMERCIAL',
                Icons.shopping_bag_outlined,
                'Ventas',
                'Pedidos, clientes y cobros',
                AppTheme.info,
              ),
              const SizedBox(height: 10),
              _buildRoleOption(
                'REPARTIDOR',
                Icons.local_shipping_outlined,
                'Reparto',
                'Entregas y cobros de ruta',
                AppTheme.accentIndigo,
              ),
              const SizedBox(height: 10),
              _buildRoleOption(
                'ALMACEN',
                Icons.inventory_2_outlined,
                'Almacén',
                'Expediciones y preparación',
                AppTheme.accentRose,
              ),
              SizedBox(height: isSmall ? 16 : 24),
              Semantics(
                button: true,
                label: _isSwitching ? 'Cambiando perfil' : 'Confirmar perfil',
                child: FilledButton(
                  style: A11yTokens.touchButton(background: AppTheme.info),
                  onPressed: _isSwitching ? null : _confirmRole,
                  child: _isSwitching
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Confirmar'),
                ),
              ),
              const SizedBox(height: 8),
              Semantics(
                button: true,
                label: 'Cancelar y entrar como comercial',
                child: TextButton(
                  style: A11yTokens.touchButton(
                    foreground: AppTheme.textSecondary,
                  ),
                  onPressed: _isSwitching
                      ? null
                      : () {
                          Navigator.of(context).pop();
                          context.go('/dashboard');
                        },
                  child: const Text('Cancelar'),
                ),
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
    String detail,
    Color color,
  ) {
    final isSelected = _selectedRole == role;
    return Semantics(
      button: true,
      selected: isSelected,
      label: isSelected ? '$label. Elegido' : label,
      child: InkWell(
        onTap: _isSwitching ? null : () => setState(() => _selectedRole = role),
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        child: AnimatedContainer(
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : const Duration(milliseconds: 180),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: isSelected
                ? color.withValues(alpha: 0.12)
                : AppTheme.softPanel.withValues(alpha: 0.55),
            borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            border: Border.all(
              color: isSelected
                  ? color
                  : AppColors.themedWhite.withValues(alpha: 0.16),
              width: isSelected ? 2 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                icon,
                color: isSelected ? color : AppTheme.textSecondary,
                size: 28,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: AppColors.themedWhite,
                        fontWeight: FontWeight.w700,
                        fontSize: A11yTokens.minText,
                      ),
                    ),
                    Text(
                      detail,
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: A11yTokens.minText,
                      ),
                    ),
                    if (isSelected)
                      Text(
                        'Elegido',
                        style: TextStyle(
                          color: color,
                          fontSize: A11yTokens.minText,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
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
      if (!mounted) return;
      if (success) {
        Navigator.of(context).pop();
        context.go('/dashboard');
        return;
      }
      final error = ref.read(authProvider).value?.error ?? '';
      _showFailure(error);
    } catch (e) {
      if (mounted) _showFailure(e.toString());
    } finally {
      if (mounted) setState(() => _isSwitching = false);
    }
  }

  void _showFailure(String raw) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '${gmpWhatHappened(raw.isEmpty ? 'Error al cambiar el perfil' : raw)} ${gmpWhatToDo(raw)}',
          style: const TextStyle(fontSize: A11yTokens.minText),
        ),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
