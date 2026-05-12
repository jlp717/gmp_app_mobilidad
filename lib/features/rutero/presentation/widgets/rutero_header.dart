import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';

class RuteroHeader extends StatelessWidget {
  const RuteroHeader({
    super.key,
    required this.selectedRole,
    required this.isJefeVentas,
    required this.isSmallScreen,
    required this.onRoleChanged,
    required this.onSortTap,
  });

  final String selectedRole;
  final bool isJefeVentas;
  final bool isSmallScreen;
  final void Function(String role) onRoleChanged;
  final VoidCallback onSortTap;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppTheme.darkBase,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildTopBar(),
          if (isJefeVentas) const GlobalVendorSelector(isJefeVentas: true),
        ],
      ),
    );
  }

  Widget _buildTopBar() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Row(
        children: [
          const SizedBox(width: 12),
          Expanded(
            child: InkWell(
              onTap: () {
                onRoleChanged(
                  selectedRole == 'comercial' ? 'repartidor' : 'comercial',
                );
              },
              child: Row(
                children: [
                  ShaderMask(
                    shaderCallback: (bounds) => const LinearGradient(
                      colors: [AppTheme.neonPink, AppTheme.neonPurple],
                    ).createShader(bounds),
                    child: Text(
                      'RUTERO',
                      style: TextStyle(
                        fontSize: isSmallScreen ? 18 : 20,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: (selectedRole == 'comercial'
                              ? AppTheme.neonPink
                              : AppTheme.neonBlue)
                          .withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: (selectedRole == 'comercial'
                                ? AppTheme.neonPink
                                : AppTheme.neonBlue)
                            .withValues(alpha: 0.5),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          selectedRole == 'comercial'
                              ? Icons.shopping_bag_outlined
                              : Icons.local_shipping_outlined,
                          size: 12,
                          color: selectedRole == 'comercial'
                              ? AppTheme.neonPink
                              : AppTheme.neonBlue,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          selectedRole == 'comercial' ? 'VISITA' : 'REPARTO',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: selectedRole == 'comercial'
                                ? AppTheme.neonPink
                                : AppTheme.neonBlue,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          IconButton(
            onPressed: onSortTap,
            icon: const Icon(Icons.sort, color: Colors.white, size: 22),
            tooltip: 'Ordenar',
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
        ],
      ),
    );
  }
}
