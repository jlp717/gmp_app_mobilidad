import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/warehouse/application/load_planner_provider.dart';
import 'package:gmp_app_mobilidad/features/warehouse/domain/models/load_planner_models.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/widgets/box_info_overlay.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/widgets/load_canvas.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/widgets/metrics_bar.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/widgets/orders_panel_v2.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/widgets/planner_toolbar.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/widgets/warehouse_ui.dart';

/// Load Planner V2 – Premium redesign.
///
/// Layout: Header → Toolbar → MetricsBar → [Canvas (70%) | Panel (30%)]
/// Responsive: tablet = side-by-side, phone = canvas + bottom sheet.
class LoadPlannerV2Page extends ConsumerStatefulWidget {
  const LoadPlannerV2Page({
    required this.vehicleCode,
    required this.vehicleName,
    required this.date,
    super.key,
  });
  final String vehicleCode;
  final String vehicleName;
  final DateTime date;

  @override
  ConsumerState<LoadPlannerV2Page> createState() => _LoadPlannerV2PageState();
}

class _LoadPlannerV2PageState extends ConsumerState<LoadPlannerV2Page>
    with SingleTickerProviderStateMixin {
  bool _panelVisible = true;
  bool _wallsVisible = true;
  final _canvasKey = GlobalKey<LoadCanvasState>();

  late final AnimationController _shimmerCtrl;

  @override
  void initState() {
    super.initState();
    _shimmerCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(loadPlannerProvider.notifier).loadPlan(
            vehicleCode: widget.vehicleCode,
            date: widget.date,
          );
    });
  }

  @override
  void dispose() {
    _shimmerCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.of(context).size.width > 800;

    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: WarehouseUi.pageShell(
        child: Column(
          children: [
            // Premium gradient header
            _buildHeader(context),

            // Toolbar
            PlannerToolbar(
              onToggleWalls: () {
                HapticFeedback.lightImpact();
                setState(() => _wallsVisible = !_wallsVisible);
                _canvasKey.currentState?.toggleWalls(_wallsVisible);
              },
              onRepack: () {
                HapticFeedback.mediumImpact();
                _canvasKey.currentState?.repackBoxes();
              },
            ),

            // Metrics
            RepaintBoundary(
              child: Consumer(
                builder: (_, ref, __) {
                  final planner = ref.watch(loadPlannerProvider);
                  return MetricsBar(
                    metrics: planner.metrics,
                    saveState: planner.saveState,
                  );
                },
              ),
            ),

            // Main content
            Expanded(
              child: Consumer(
                builder: (context, ref, _) {
                  final planner = ref.watch(loadPlannerProvider);
                  if (planner.isLoading) {
                    return _buildShimmerLoading();
                  }

                  if (planner.error != null) {
                    return _buildError(planner.error!);
                  }

                  if (isWide) {
                    return _buildTabletLayout(planner);
                  } else {
                    return _buildPhoneLayout(planner);
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PREMIUM HEADER – gradient bg, glassmorphism back button, glow accents
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildHeader(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 8,
        left: 12,
        right: 12,
        bottom: 10,
      ),
      decoration: WarehouseUi.headerSurface(accent: AppTheme.info, radius: 0),
      child: Row(
        children: [
          // Glassmorphism back button
          _GlassIconButton(
            icon: Icons.arrow_back_rounded,
            onPressed: () async {
              HapticFeedback.lightImpact();
              final provider = ref.read(loadPlannerProvider);
              if (provider.hasManualChanges &&
                  provider.saveState != SaveState.saved) {
                await provider.saveLayout();
              }
              if (context.mounted) Navigator.of(context).pop();
            },
          ),
          const SizedBox(width: 12),

          // Vehicle info with subtle glow
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  widget.vehicleName.isNotEmpty
                      ? widget.vehicleName
                      : widget.vehicleCode,
                  style: AppTheme.displayTitle,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Icon(
                      Icons.local_shipping_outlined,
                      size: 12,
                      color: AppTheme.info,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      widget.vehicleCode,
                      style: TextStyle(
                        color: AppTheme.info,
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        letterSpacing: 0,
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      child: Container(
                        width: 3,
                        height: 3,
                        decoration: BoxDecoration(
                          color: AppTheme.textTertiary.withValues(alpha: 0.5),
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                    Icon(
                      Icons.calendar_today_outlined,
                      size: 11,
                      color: AppTheme.textTertiary.withValues(alpha: 0.6),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '${widget.date.day.toString().padLeft(2, '0')}/${widget.date.month.toString().padLeft(2, '0')}/${widget.date.year}',
                      style: AppTheme.captionText,
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Toggle panel button with glow state
          _GlassIconButton(
            icon: _panelVisible
                ? Icons.view_sidebar_rounded
                : Icons.view_sidebar_outlined,
            isActive: _panelVisible,
            onPressed: () {
              HapticFeedback.selectionClick();
              setState(() => _panelVisible = !_panelVisible);
            },
            tooltip: _panelVisible ? 'Ocultar panel' : 'Mostrar panel',
          ),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHIMMER LOADING – premium skeleton
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildShimmerLoading() {
    return AnimatedBuilder(
      animation: _shimmerCtrl,
      builder: (context, _) {
        return Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Pulsing truck icon
              ShaderMask(
                shaderCallback: (bounds) {
                  return LinearGradient(
                    colors: [
                      AppTheme.info.withValues(alpha: 0.25),
                      AppTheme.info,
                      AppTheme.info.withValues(alpha: 0.25),
                    ],
                    stops: [
                      (_shimmerCtrl.value - 0.3).clamp(0.0, 1.0),
                      _shimmerCtrl.value,
                      (_shimmerCtrl.value + 0.3).clamp(0.0, 1.0),
                    ],
                  ).createShader(bounds);
                },
                child: const Icon(
                  Icons.local_shipping_rounded,
                  size: 48,
                  color: AppTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 20),
              // Shimmer text
              Text(
                'Calculando carga...',
                style: TextStyle(
                  color: AppTheme.textSecondary.withValues(
                    alpha: 0.5 + (_shimmerCtrl.value * 0.5),
                  ),
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  letterSpacing: 0,
                ),
              ),
              const SizedBox(height: 12),
              // Progress bar
              SizedBox(
                width: 120,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    backgroundColor: AppTheme.softPanel,
                    color: AppTheme.info,
                    minHeight: 2,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLET LAYOUT – side by side with animated panel
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildTabletLayout(LoadPlannerProvider provider) {
    return Row(
      children: [
        // Canvas (main)
        Expanded(
          flex: _panelVisible ? 7 : 10,
          child: RepaintBoundary(
            child: Stack(
              children: [
                LoadCanvas(key: _canvasKey),

                // Box info overlay
                if (provider.selectedBoxIndex != null &&
                    provider.selectedBoxIndex! < provider.placedBoxes.length)
                  BoxInfoOverlay(
                    box: provider.placedBoxes[provider.selectedBoxIndex!],
                    index: provider.selectedBoxIndex!,
                    onClose: () => provider.clearSelection(),
                  ),

                // Glassmorphism collision warning
                if (provider.dragState?.hasCollision ?? false)
                  Positioned(
                    top: 12,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: BackdropFilter(
                          filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 10,
                            ),
                            decoration: BoxDecoration(
                              color: AppTheme.error.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: AppTheme.error.withValues(alpha: 0.6),
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: AppTheme.error.withValues(alpha: 0.2),
                                  blurRadius: 16,
                                ),
                              ],
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.warning_rounded,
                                  color: AppTheme.error,
                                  size: 16,
                                ),
                                SizedBox(width: 8),
                                Text(
                                  'Colisión detectada',
                                  style: TextStyle(
                                    color: AppTheme.error,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 0,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),

        // Animated side panel
        AnimatedSize(
          duration: AppTheme.animNormal,
          curve: Curves.easeInOutCubic,
          child: _panelVisible
              ? const SizedBox(
                  width: 300,
                  child: OrdersPanelV2(),
                )
              : const SizedBox.shrink(),
        ),
      ],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHONE LAYOUT – canvas + bottom sheet
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildPhoneLayout(LoadPlannerProvider provider) {
    return Stack(
      children: [
        // Full-screen canvas
        RepaintBoundary(child: LoadCanvas(key: _canvasKey)),

        // Box info overlay
        if (provider.selectedBoxIndex != null &&
            provider.selectedBoxIndex! < provider.placedBoxes.length)
          BoxInfoOverlay(
            box: provider.placedBoxes[provider.selectedBoxIndex!],
            index: provider.selectedBoxIndex!,
            onClose: () => provider.clearSelection(),
          ),

        // Premium FAB with glow
        Positioned(
          right: 16,
          bottom: 16,
          child: Container(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: AppTheme.info.withValues(alpha: 0.18),
                  blurRadius: 16,
                  spreadRadius: 1,
                ),
              ],
            ),
            child: FloatingActionButton.small(
              onPressed: () {
                HapticFeedback.mediumImpact();
                _showPanelSheet(context);
              },
              backgroundColor: AppTheme.info,
              foregroundColor: AppTheme.textPrimary,
              child: const Icon(Icons.list_rounded),
            ),
          ),
        ),
      ],
    );
  }

  void _showPanelSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        minChildSize: 0.3,
        maxChildSize: 0.85,
        expand: false,
        builder: (_, controller) {
          return Container(
            decoration: BoxDecoration(
              color: AppTheme.raisedSurface,
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(20)),
              border: Border(
                top: BorderSide(
                  color: AppTheme.borderColor.withValues(alpha: 0.9),
                ),
              ),
              boxShadow: AppTheme.elevation2,
            ),
            child: Column(
              children: [
                // Drag handle
                Container(
                  margin: const EdgeInsets.symmetric(vertical: 10),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTheme.borderColor,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const Expanded(child: OrdersPanelV2()),
              ],
            ),
          );
        },
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR STATE – premium design
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildError(String error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTheme.error.withValues(alpha: 0.1),
                border: Border.all(
                  color: AppTheme.error.withValues(alpha: 0.3),
                ),
              ),
              child: Icon(
                Icons.error_outline_rounded,
                size: 40,
                color: AppTheme.error.withValues(alpha: 0.8),
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'Error al cargar el plan',
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              error,
              style: const TextStyle(
                color: AppTheme.textTertiary,
                fontSize: 12,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.info.withValues(alpha: 0.14),
                    blurRadius: 12,
                  ),
                ],
              ),
              child: ElevatedButton.icon(
                onPressed: () {
                  HapticFeedback.lightImpact();
                  ref.read(loadPlannerProvider.notifier).loadPlan(
                        vehicleCode: widget.vehicleCode,
                        date: widget.date,
                        forceRefresh: true,
                      );
                },
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Reintentar'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// GLASS ICON BUTTON – shared glassmorphism button used in header
// =============================================================================

class _GlassIconButton extends StatelessWidget {
  const _GlassIconButton({
    required this.icon,
    required this.onPressed,
    this.isActive = false,
    this.tooltip,
  });
  final IconData icon;
  final VoidCallback onPressed;
  final bool isActive;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final child = GestureDetector(
      onTap: onPressed,
      child: AnimatedContainer(
        duration: AppTheme.animFast,
        width: 36,
        height: 36,
        decoration: WarehouseUi.executiveSurface(
          accent: isActive ? AppTheme.info : AppTheme.textTertiary,
          radius: AppTheme.radiusMd,
          borderAlpha: isActive ? 0.34 : 0.16,
          accentAlpha: isActive ? 0.12 : 0.03,
          elevated: isActive,
        ),
        child: Icon(
          icon,
          size: 18,
          color: isActive ? AppTheme.info : AppTheme.textPrimary,
        ),
      ),
    );

    if (tooltip != null) {
      return Tooltip(message: tooltip, child: child);
    }
    return child;
  }
}
