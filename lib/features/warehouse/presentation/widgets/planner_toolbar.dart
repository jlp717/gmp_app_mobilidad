import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/warehouse/application/load_planner_provider.dart';
import 'package:gmp_app_mobilidad/features/warehouse/domain/models/load_planner_models.dart';

/// Premium floating-pill toolbar with animated highlight indicators.
class PlannerToolbar extends StatelessWidget {

  const PlannerToolbar({super.key, this.onToggleWalls, this.onRepack});
  final VoidCallback? onToggleWalls;
  final VoidCallback? onRepack;

  @override
  Widget build(BuildContext context) {
    return Consumer(
      builder: (context, ref, _) {
        final planner = ref.watch(loadPlannerProvider);
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                AppTheme.darkSurface.withValues(alpha: 0.95),
                AppTheme.darkBase.withValues(alpha: 0.9),
              ],
            ),
            border: Border(
              bottom: BorderSide(
                color: AppTheme.neonBlue.withValues(alpha: 0.1),
              ),
            ),
          ),
          child: Row(
            children: [
              // View mode pills
              _PillSegmented<ViewMode>(
                selected: planner.viewMode,
                options: const [
                  (ViewMode.perspective, Icons.view_in_ar_rounded, '3D'),
                  (ViewMode.top, Icons.layers_rounded, 'Planta'),
                  (ViewMode.front, Icons.crop_square_rounded, 'Frente'),
                ],
                onChanged: (v) {
                  HapticFeedback.selectionClick();
                  ref.read(loadPlannerProvider.notifier).setViewMode(v);
                },
              ),
              const SizedBox(width: 8),

              // Color mode pills
              _PillSegmented<ColorMode>(
                selected: planner.colorMode,
                options: const [
                  (ColorMode.product, Icons.inventory_2_rounded, 'Producto'),
                  (ColorMode.client, Icons.people_rounded, 'Cliente'),
                  (ColorMode.weight, Icons.fitness_center_rounded, 'Peso'),
                  (ColorMode.delivery, Icons.local_shipping_rounded, 'Entrega'),
                ],
                onChanged: (v) {
                  HapticFeedback.selectionClick();
                  ref.read(loadPlannerProvider.notifier).setColorMode(v);
                },
              ),

              const Spacer(),

              // Profit optimizer – glow on hover
              _GlowToolButton(
                icon: Icons.auto_awesome_rounded,
                tooltip: 'Optimizar carga (max beneficio)',
                enabled: !planner.isOptimizing,
                onPressed: () {
                  HapticFeedback.mediumImpact();
                  ref.read(loadPlannerProvider.notifier).runProfitOptimizer();
                },
                color: AppTheme.neonGreen,
              ),
              const SizedBox(width: 2),

              // Client-side 3D repack
              _GlowToolButton(
                icon: Icons.view_in_ar_rounded,
                tooltip: 'Reordenar cajas (bin packing 3D)',
                enabled: onRepack != null && planner.placedBoxes.isNotEmpty,
                onPressed: () {
                  HapticFeedback.mediumImpact();
                  onRepack?.call();
                },
                color: AppTheme.neonBlue,
              ),
              const SizedBox(width: 2),

              // Wall toggle
              _GlowToolButton(
                icon: Icons.grid_on_rounded,
                tooltip: 'Mostrar/ocultar paredes',
                onPressed: () {
                  HapticFeedback.lightImpact();
                  onToggleWalls?.call();
                },
                enabled: onToggleWalls != null,
              ),
              const SizedBox(width: 2),

              // Undo
              _GlowToolButton(
                icon: Icons.undo_rounded,
                tooltip: 'Deshacer',
                enabled: planner.canUndo,
                onPressed: () {
                  HapticFeedback.lightImpact();
                  ref.read(loadPlannerProvider.notifier).undo();
                },
              ),
              // Redo
              _GlowToolButton(
                icon: Icons.redo_rounded,
                tooltip: 'Rehacer',
                enabled: planner.canRedo,
                onPressed: () {
                  HapticFeedback.lightImpact();
                  ref.read(loadPlannerProvider.notifier).redo();
                },
              ),
              const SizedBox(width: 6),

              // Reset – warning glow
              _GlowToolButton(
                icon: Icons.refresh_rounded,
                tooltip: 'Recalcular (descartar cambios)',
                enabled: planner.hasManualChanges,
                onPressed: () => _confirmReset(context, ref),
                color: AppTheme.warning,
              ),
            ],
          ),
        );
      },
    );
  }

  void _confirmReset(BuildContext context, WidgetRef ref) {
    HapticFeedback.mediumImpact();
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: AppTheme.warning.withValues(alpha: 0.3),
          ),
        ),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded,
                color: AppTheme.warning, size: 22,),
            SizedBox(width: 8),
            Text('Recalcular carga'),
          ],
        ),
        content: const Text(
          'Se descartarán los cambios manuales y se recalculará la carga desde el algoritmo. Esta acción no se puede deshacer.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              ref.read(loadPlannerProvider.notifier).resetToAlgorithm();
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

// =============================================================================
// PILL SEGMENTED CONTROL – floating pill with animated highlight
// =============================================================================

class _PillSegmented<T> extends StatelessWidget {

  const _PillSegmented({
    required this.selected,
    required this.options,
    required this.onChanged,
  });
  final T selected;
  final List<(T, IconData, String)> options;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppTheme.darkCard.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: AppTheme.borderColor.withValues(alpha: 0.2),
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
              curve: Curves.easeOutCubic,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: isActive
                    ? AppTheme.neonBlue.withValues(alpha: 0.15)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(7),
                border: isActive
                    ? Border.all(
                        color: AppTheme.neonBlue.withValues(alpha: 0.3),
                      )
                    : null,
                boxShadow: isActive
                    ? [
                        BoxShadow(
                          color: AppTheme.neonBlue.withValues(alpha: 0.1),
                          blurRadius: 8,
                        ),
                      ]
                    : null,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    opt.$2,
                    size: 13,
                    color: isActive
                        ? AppTheme.neonBlue
                        : AppTheme.textTertiary.withValues(alpha: 0.7),
                  ),
                  const SizedBox(width: 4),
                  AnimatedDefaultTextStyle(
                    duration: AppTheme.animFast,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight:
                          isActive ? FontWeight.w600 : FontWeight.w400,
                      color: isActive
                          ? AppTheme.neonBlue
                          : AppTheme.textTertiary.withValues(alpha: 0.7),
                      letterSpacing: isActive ? 0.2 : 0.0,
                    ),
                    child: Text(opt.$3),
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

// =============================================================================
// GLOW TOOL BUTTON – icon button with subtle glow when active/hovered
// =============================================================================

class _GlowToolButton extends StatefulWidget {

  const _GlowToolButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed, this.enabled = true,
    this.color,
  });
  final IconData icon;
  final String tooltip;
  final bool enabled;
  final VoidCallback onPressed;
  final Color? color;

  @override
  State<_GlowToolButton> createState() => _GlowToolButtonState();
}

class _GlowToolButtonState extends State<_GlowToolButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final baseColor = widget.enabled
        ? (widget.color ?? AppTheme.textSecondary)
        : AppTheme.textTertiary.withValues(alpha: 0.3);

    return Tooltip(
      message: widget.tooltip,
      child: GestureDetector(
        onTapDown: widget.enabled ? (_) => setState(() => _pressed = true) : null,
        onTapUp: widget.enabled
            ? (_) {
                setState(() => _pressed = false);
                widget.onPressed();
              }
            : null,
        onTapCancel: () => setState(() => _pressed = false),
        child: AnimatedContainer(
          duration: AppTheme.animFast,
          padding: const EdgeInsets.all(7),
          decoration: BoxDecoration(
            color: _pressed
                ? baseColor.withValues(alpha: 0.1)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            boxShadow: _pressed && widget.enabled
                ? [
                    BoxShadow(
                      color: baseColor.withValues(alpha: 0.15),
                      blurRadius: 8,
                    ),
                  ]
                : null,
          ),
          child: Icon(widget.icon, size: 18, color: baseColor),
        ),
      ),
    );
  }
}
