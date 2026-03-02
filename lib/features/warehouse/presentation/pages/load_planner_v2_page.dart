import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../core/theme/app_theme.dart';
import '../../application/load_planner_provider.dart';
import '../../domain/models/load_planner_models.dart';
import '../widgets/box_info_overlay.dart';
import '../widgets/load_canvas.dart';
import '../widgets/metrics_bar.dart';
import '../widgets/orders_panel_v2.dart';
import '../widgets/planner_toolbar.dart';

/// Load Planner V2 — Complete redesign.
///
/// Layout: Header → Toolbar → MetricsBar → [Canvas (70%) | Panel (30%)]
/// Responsive: tablet = side-by-side, phone = canvas + bottom sheet.
class LoadPlannerV2Page extends StatefulWidget {
  final String vehicleCode;
  final String vehicleName;
  final DateTime date;

  const LoadPlannerV2Page({
    super.key,
    required this.vehicleCode,
    required this.vehicleName,
    required this.date,
  });

  @override
  State<LoadPlannerV2Page> createState() => _LoadPlannerV2PageState();
}

class _LoadPlannerV2PageState extends State<LoadPlannerV2Page> {
  bool _panelVisible = true;

  @override
  void initState() {
    super.initState();
    // Load plan on init
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<LoadPlannerProvider>().loadPlan(
            vehicleCode: widget.vehicleCode,
            date: widget.date,
          );
    });
  }

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.of(context).size.width > 800;

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          // Header
          _buildHeader(context),

          // Toolbar
          const PlannerToolbar(),

          // Metrics
          Consumer<LoadPlannerProvider>(
            builder: (_, p, __) => MetricsBar(
              metrics: p.metrics,
              saveState: p.saveState,
            ),
          ),

          // Main content
          Expanded(
            child: Consumer<LoadPlannerProvider>(
              builder: (context, provider, _) {
                if (provider.isLoading) {
                  return const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        CircularProgressIndicator(color: AppTheme.neonBlue),
                        SizedBox(height: 16),
                        Text(
                          'Calculando carga...',
                          style: TextStyle(
                            color: AppTheme.textTertiary,
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  );
                }

                if (provider.error != null) {
                  return _buildError(provider.error!);
                }

                if (isWide) {
                  return _buildTabletLayout(provider);
                } else {
                  return _buildPhoneLayout(provider);
                }
              },
            ),
          ),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildHeader(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 8,
        left: 12,
        right: 12,
        bottom: 8,
      ),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        border: Border(
          bottom: BorderSide(
            color: AppTheme.neonBlue.withOpacity(0.15),
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          // Back button
          IconButton(
            onPressed: () async {
              final provider = context.read<LoadPlannerProvider>();
              if (provider.hasManualChanges &&
                  provider.saveState != SaveState.saved) {
                await provider.saveLayout();
              }
              if (context.mounted) Navigator.of(context).pop();
            },
            icon: const Icon(Icons.arrow_back, color: AppTheme.textPrimary),
            iconSize: 20,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
          ),
          const SizedBox(width: 8),

          // Vehicle info
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  widget.vehicleName.isNotEmpty
                      ? widget.vehicleName
                      : widget.vehicleCode,
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  '${widget.vehicleCode}  |  ${widget.date.day}/${widget.date.month}/${widget.date.year}',
                  style: const TextStyle(
                    color: AppTheme.textTertiary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),

          // Toggle panel
          IconButton(
            onPressed: () => setState(() => _panelVisible = !_panelVisible),
            icon: Icon(
              _panelVisible ? Icons.view_sidebar : Icons.view_sidebar_outlined,
              color: _panelVisible ? AppTheme.neonBlue : AppTheme.textTertiary,
            ),
            iconSize: 20,
            tooltip: _panelVisible ? 'Ocultar panel' : 'Mostrar panel',
          ),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLET LAYOUT — side by side
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildTabletLayout(LoadPlannerProvider provider) {
    return Row(
      children: [
        // Canvas (main)
        Expanded(
          flex: _panelVisible ? 7 : 10,
          child: Stack(
            children: [
              const LoadCanvas(),

              // Box info overlay
              if (provider.selectedBoxIndex != null &&
                  provider.selectedBoxIndex! < provider.placedBoxes.length)
                BoxInfoOverlay(
                  box: provider.placedBoxes[provider.selectedBoxIndex!],
                  index: provider.selectedBoxIndex!,
                  onClose: () => provider.clearSelection(),
                ),

              // Drag collision warning
              if (provider.dragState?.hasCollision ?? false)
                Positioned(
                  top: 12,
                  left: 0,
                  right: 0,
                  child: Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: AppTheme.error.withOpacity(0.9),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.warning_rounded,
                            color: Colors.white,
                            size: 16,
                          ),
                          SizedBox(width: 6),
                          Text(
                            'Colision detectada',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),

        // Side panel
        if (_panelVisible)
          const SizedBox(
            width: 300,
            child: OrdersPanelV2(),
          ),
      ],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHONE LAYOUT — canvas + bottom sheet
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildPhoneLayout(LoadPlannerProvider provider) {
    return Stack(
      children: [
        // Full-screen canvas
        const LoadCanvas(),

        // Box info overlay
        if (provider.selectedBoxIndex != null &&
            provider.selectedBoxIndex! < provider.placedBoxes.length)
          BoxInfoOverlay(
            box: provider.placedBoxes[provider.selectedBoxIndex!],
            index: provider.selectedBoxIndex!,
            onClose: () => provider.clearSelection(),
          ),

        // FAB to open panel as bottom sheet
        Positioned(
          right: 16,
          bottom: 16,
          child: FloatingActionButton.small(
            onPressed: () => _showPanelSheet(context),
            backgroundColor: AppTheme.neonBlue,
            child: const Icon(Icons.list, color: AppTheme.darkBase),
          ),
        ),
      ],
    );
  }

  void _showPanelSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.darkSurface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => ChangeNotifierProvider.value(
        value: context.read<LoadPlannerProvider>(),
        child: DraggableScrollableSheet(
          initialChildSize: 0.5,
          minChildSize: 0.3,
          maxChildSize: 0.85,
          expand: false,
          builder: (_, controller) {
            return Column(
              children: [
                // Drag handle
                Container(
                  margin: const EdgeInsets.symmetric(vertical: 8),
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTheme.borderColor,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const Expanded(child: OrdersPanelV2()),
              ],
            );
          },
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR STATE
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildError(String error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline,
              size: 48,
              color: AppTheme.error.withOpacity(0.6),
            ),
            const SizedBox(height: 16),
            Text(
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
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: () {
                context.read<LoadPlannerProvider>().loadPlan(
                      vehicleCode: widget.vehicleCode,
                      date: widget.date,
                    );
              },
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }
}
