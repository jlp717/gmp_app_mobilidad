import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../application/load_planner_provider.dart';
import '../../domain/models/load_planner_models.dart';

/// Toolbar with view mode, color mode, undo/redo, reset, wall toggle.
class PlannerToolbar extends StatelessWidget {
  final VoidCallback? onToggleWalls;

  const PlannerToolbar({super.key, this.onToggleWalls});

  @override
  Widget build(BuildContext context) {
    return Consumer<LoadPlannerProvider>(
      builder: (context, provider, _) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            color: AppTheme.darkSurface.withOpacity(0.95),
            border: Border(
              bottom: BorderSide(
                color: AppTheme.neonBlue.withOpacity(0.15),
                width: 1,
              ),
            ),
          ),
          child: Row(
            children: [
              // View mode toggle
              _SegmentedButton<ViewMode>(
                selected: provider.viewMode,
                options: const [
                  (ViewMode.perspective, Icons.view_in_ar, '3D'),
                  (ViewMode.top, Icons.layers, 'Planta'),
                  (ViewMode.front, Icons.crop_square, 'Frente'),
                ],
                onChanged: provider.setViewMode,
              ),
              const SizedBox(width: 12),

              // Color mode toggle
              _SegmentedButton<ColorMode>(
                selected: provider.colorMode,
                options: const [
                  (ColorMode.product, Icons.inventory_2, 'Producto'),
                  (ColorMode.client, Icons.people, 'Cliente'),
                  (ColorMode.weight, Icons.fitness_center, 'Peso'),
                  (ColorMode.delivery, Icons.local_shipping, 'Entrega'),
                ],
                onChanged: provider.setColorMode,
              ),

              const Spacer(),

              // Profit optimizer
              _ToolButton(
                icon: Icons.auto_awesome,
                tooltip: 'Optimizar carga (max beneficio)',
                enabled: !provider.isOptimizing,
                onPressed: () => provider.runProfitOptimizer(),
                color: AppTheme.neonGreen,
              ),
              const SizedBox(width: 4),

              // Wall toggle
              _ToolButton(
                icon: Icons.grid_on,
                tooltip: 'Mostrar/ocultar paredes',
                onPressed: onToggleWalls ?? () {},
                enabled: onToggleWalls != null,
              ),
              const SizedBox(width: 4),

              // Undo
              _ToolButton(
                icon: Icons.undo,
                tooltip: 'Deshacer',
                enabled: provider.canUndo,
                onPressed: provider.undo,
              ),
              // Redo
              _ToolButton(
                icon: Icons.redo,
                tooltip: 'Rehacer',
                enabled: provider.canRedo,
                onPressed: provider.redo,
              ),
              const SizedBox(width: 8),

              // Reset to algorithm
              _ToolButton(
                icon: Icons.refresh,
                tooltip: 'Recalcular (descartar cambios)',
                enabled: provider.hasManualChanges,
                onPressed: () => _confirmReset(context, provider),
                color: AppTheme.warning,
              ),
            ],
          ),
        );
      },
    );
  }

  void _confirmReset(BuildContext context, LoadPlannerProvider provider) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        title: const Text('Recalcular carga'),
        content: const Text(
          'Se descartaran los cambios manuales y se recalculara la carga desde el algoritmo. Esta accion no se puede deshacer.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              provider.resetToAlgorithm();
            },
            child: const Text(
              'Recalcular',
              style: TextStyle(color: AppTheme.warning),
            ),
          ),
        ],
      ),
    );
  }
}

class _SegmentedButton<T> extends StatelessWidget {
  final T selected;
  final List<(T, IconData, String)> options;
  final ValueChanged<T> onChanged;

  const _SegmentedButton({
    required this.selected,
    required this.options,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.darkCard.withOpacity(0.5),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: AppTheme.borderColor.withOpacity(0.3),
          width: 1,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: options.map((opt) {
          final isActive = opt.$1 == selected;
          return GestureDetector(
            onTap: () => onChanged(opt.$1),
            child: AnimatedContainer(
              duration: AppTheme.animFast,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: isActive
                    ? AppTheme.neonBlue.withOpacity(0.2)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    opt.$2,
                    size: 14,
                    color: isActive ? AppTheme.neonBlue : AppTheme.textTertiary,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    opt.$3,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight:
                          isActive ? FontWeight.w600 : FontWeight.w400,
                      color: isActive
                          ? AppTheme.neonBlue
                          : AppTheme.textTertiary,
                    ),
                  ),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _ToolButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final bool enabled;
  final VoidCallback onPressed;
  final Color? color;

  const _ToolButton({
    required this.icon,
    required this.tooltip,
    this.enabled = true,
    required this.onPressed,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final c = enabled
        ? (color ?? AppTheme.textSecondary)
        : AppTheme.textTertiary.withOpacity(0.4);
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: enabled ? onPressed : null,
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Icon(icon, size: 18, color: c),
        ),
      ),
    );
  }
}
