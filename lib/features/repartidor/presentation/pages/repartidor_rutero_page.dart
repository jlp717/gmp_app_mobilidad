import 'dart:async';

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/services/cache_prewarmer.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_sync_bridge.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_sync_notifier.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/futuristic_week_navigator.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/holographic_kpi_dashboard.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_rutero_reorder_modal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/reparto_sync_status_sheet.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_modal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/smart_delivery_card.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_tracking.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_tracking_panel.dart';

typedef RepartidorRuteroWeekLoader = Future<Map<String, dynamic>> Function({
  required String repartidorId,
  required DateTime date,
  required bool forceRefresh,
});

typedef RepartidorRuteroListLoader = Future<List<Map<String, dynamic>>>
    Function();

/// Repartidor Rutero Page - Futuristic Redesign
/// Features:
/// - Holographic week navigator with gestures
/// - KPI dashboard with gamification
/// - Smart delivery cards with AI suggestions
/// - Improved filtering and search
/// - JEFE "Ver como" comes from shell header only (widget.repartidorId)
class RepartidorRuteroPage extends ConsumerStatefulWidget {
  const RepartidorRuteroPage({
    super.key,
    this.repartidorId,
    this.repartidorNames,
    this.weekLoader,
    this.repartidoresLoader,
  });
  final String? repartidorId;
  final Map<String, String>? repartidorNames;
  final RepartidorRuteroWeekLoader? weekLoader;

  /// Kept for tests/back-compat; UI no longer loads a second Ver como list.
  final RepartidorRuteroListLoader? repartidoresLoader;

  @override
  ConsumerState<RepartidorRuteroPage> createState() =>
      _RepartidorRuteroPageState();
}

class _RepartidorRuteroPageState extends ConsumerState<RepartidorRuteroPage>
    with TickerProviderStateMixin, AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;
  DateTime _selectedDate = DateTime.now();
  List<Map<String, dynamic>> _weekDays = [];
  bool _isLoadingWeek = false;
  String? _weekError;
  String? _identityError;
  int _weekLoadGeneration = 0;
  String? _lastLoadedId;
  final TextEditingController _searchClientController = TextEditingController();
  final TextEditingController _searchAlbaranController =
      TextEditingController();
  final TextEditingController _searchOrdenController = TextEditingController();
  Timer? _loadDebounceTimer;
  Completer<void>? _loadCompleter;
  bool _isDetailModalOpen = false;

  late AnimationController _listAnimController;

  @override
  void initState() {
    super.initState();
    _listAnimController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
      _listAnimController.forward();
    });
  }

  @override
  void didUpdateWidget(covariant RepartidorRuteroPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repartidorId != widget.repartidorId) {
      _loadData(forceRefresh: true);
    }
  }

  @override
  void dispose() {
    _searchClientController.dispose();
    _searchAlbaranController.dispose();
    _searchOrdenController.dispose();
    _loadDebounceTimer?.cancel();
    if (_loadCompleter?.isCompleted == false) {
      _loadCompleter?.complete();
    }
    _listAnimController.dispose();
    super.dispose();
  }

  Future<void> _loadData({bool forceRefresh = false}) async {
    _loadDebounceTimer?.cancel();
    if (_loadCompleter?.isCompleted == false) {
      _loadCompleter?.complete();
    }

    final completer = Completer<void>();
    _loadCompleter = completer;

    Future<void> runLoad() async {
      try {
        await _executeLoadData(forceRefresh: forceRefresh);
        if (!completer.isCompleted) completer.complete();
      } catch (e, stackTrace) {
        if (!completer.isCompleted) {
          completer.completeError(e, stackTrace);
        }
      } finally {
        if (_loadCompleter == completer) {
          _loadCompleter = null;
        }
      }
    }

    if (forceRefresh) {
      unawaited(runLoad());
    } else {
      _loadDebounceTimer = Timer(
        const Duration(milliseconds: 300),
        () => unawaited(runLoad()),
      );
    }

    return completer.future;
  }

  Future<void> _executeLoadData({required bool forceRefresh}) async {
    if (!mounted) return;

    final auth = ref.read(authProvider).value;
    final entregas = ref.read(entregasProvider.notifier);

    // Shell header "Ver como" is the single source of truth (incl. ALL).
    final targetId = (widget.repartidorId ?? auth?.user?.code ?? '').trim();

    // NOTE: Multi-ID (comma-separated) IS supported by /pendientes endpoint
    // The week endpoint needs single ID, handled in _loadWeekData

    if (targetId.isEmpty) {
      if (mounted) {
        setState(() {
          _identityError =
              'No se ha podido determinar el repartidor del rutero.';
        });
      }
      return;
    }

    if (_identityError != null && mounted) {
      setState(() => _identityError = null);
    }

    if (_lastLoadedId != targetId) {
      _lastLoadedId = targetId;
    }

    entregas.setRepartidor(targetId, autoReload: false);
    entregas.seleccionarFecha(
      _selectedDate,
      forceRefresh: forceRefresh,
      autoReload: false,
    );

    await Future.wait([
      entregas.cargarAlbaranesPendientes(forceRefresh: forceRefresh),
      _loadWeekData(targetId, forceRefresh: forceRefresh),
    ]);
    // First page paints immediately. Remaining pages fill in background for a
    // single driver only — jefe ALL must not walk N serial fleet pages.
    if (!targetId.contains(',')) {
      unawaited(_loadRemainingDeliveryPages());
    }
  }

  Future<void> _loadRemainingDeliveryPages() async {
    for (var page = 1; page <= 3; page += 1) {
      if (!mounted) break;
      final current = ref.read(entregasProvider);
      if (!current.hasMore || current.error != null || current.isLoading) {
        break;
      }
      final previousOffset = current.nextOffset;
      await ref.read(entregasProvider.notifier).cargarMasAlbaranes();
      final next = ref.read(entregasProvider);
      if (next.hasMore && next.nextOffset <= previousOffset) break;
    }
  }

  Future<void> _loadWeekData(
    String repartidorId, {
    bool forceRefresh = false,
  }) async {
    final generation = ++_weekLoadGeneration;
    final requestDate = _selectedDate;
    if (mounted) setState(() => _isLoadingWeek = true);

    try {
      final response = widget.weekLoader != null
          ? await widget.weekLoader!(
              repartidorId: repartidorId,
              date: requestDate,
              forceRefresh: forceRefresh,
            )
          : await ApiClient.get(
              CachePreWarmer.weekFirstPaintPath(
                repartidorId,
                requestDate.toIso8601String().substring(0, 10),
              ),
              cacheKey: CachePreWarmer.weekFirstPaintCacheKey(
                repartidorId,
                requestDate.toIso8601String().substring(0, 10),
              ),
              cacheTTL: CachePreWarmer.repartoFirstPaintTtl,
              forceRefresh: forceRefresh,
            );
      if (generation != _weekLoadGeneration || !mounted) return;
      if (response['success'] == true) {
        setState(() {
          _weekDays = List<Map<String, dynamic>>.from(response['days'] as List);
          _weekError = null;
        });
      } else {
        setState(() {
          _weekDays = [];
          _weekError = 'No se pudo cargar la semana de reparto';
        });
      }
    } catch (_) {
      if (generation == _weekLoadGeneration && mounted) {
        setState(() {
          _weekDays = [];
          _weekError = 'No se pudo cargar la semana de reparto';
        });
      }
    } finally {
      if (mounted && generation == _weekLoadGeneration) {
        setState(() => _isLoadingWeek = false);
      }
    }
  }

  void _onDaySelected(DateTime date) {
    unawaited(HapticFeedback.selectionClick());
    setState(() => _selectedDate = date);

    final entregas = ref.read(entregasProvider.notifier);
    entregas.seleccionarFecha(date, autoReload: false);
    unawaited(_loadData());

    // Animate list
    _listAnimController.reset();
    _listAnimController.forward();
  }

  void _onWeekChange(int delta) {
    setState(() {
      _selectedDate = _selectedDate.add(Duration(days: 7 * delta));
    });
    _loadData();
  }

  void _updateRouteFilter(void Function(EntregasNotifier) update) {
    update(ref.read(entregasProvider.notifier));
    unawaited(_loadData());
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final authState = ref.watch(authProvider.select((s) => s.value));

    final isLoading = ref.watch(entregasProvider.select((s) => s.isLoading));
    final error = ref.watch(entregasProvider.select((s) => s.error));
    final albaranes = ref.watch(entregasProvider.select((s) => s.albaranes));
    final hasMore = ref.watch(entregasProvider.select((s) => s.hasMore));
    final resumenCompletedCount =
        ref.watch(entregasProvider.select((s) => s.resumenCompletedCount));
    final resumenTotalACobrar =
        ref.watch(entregasProvider.select((s) => s.resumenTotalACobrar));
    final resumenTotalOpcional =
        ref.watch(entregasProvider.select((s) => s.resumenTotalOpcional));
    final resumenTotalBruto =
        ref.watch(entregasProvider.select((s) => s.resumenTotalBruto));

    final filterDebeCobrar =
        ref.watch(entregasProvider.select((s) => s.filterDebeCobrar));
    final filterTipoPago =
        ref.watch(entregasProvider.select((s) => s.filterTipoPago));
    final sortBy = ref.watch(entregasProvider.select((s) => s.sortBy));

    // Header name follows shell Ver como (single id or ALL).
    var currentName = authState?.user?.name ?? 'Repartidor';
    final scopedId = (widget.repartidorId ?? '').trim();
    if ((authState?.user?.isJefeVentas ?? false) && scopedId.isNotEmpty) {
      if (scopedId.contains(',')) {
        currentName = 'Todos los repartidores';
      } else {
        final selectedName = widget.repartidorNames?[scopedId]?.trim();
        currentName = selectedName?.isNotEmpty ?? false
            ? selectedName!
            : 'Repartidor $scopedId';
      }
    }

    // Terminal visit states (entregado, noEntregado, rechazado) must not be
    // announced as "próxima parada": the driver already closed them. Pendiente,
    // enRuta and parcial remain navigation targets (parcial needs a revisit).
    final trackingStops = albaranes
        .where(
          (albaran) =>
              albaran.estado != EstadoEntrega.entregado &&
              albaran.estado != EstadoEntrega.noEntregado &&
              albaran.estado != EstadoEntrega.rechazado,
        )
        .map(
          (albaran) => RuteroTrackingStop(
            id: albaran.id,
            name: albaran.nombreCliente,
            latitude: albaran.latitud,
            longitude: albaran.longitud,
          ),
        )
        .toList(growable: false);
    final routeDateYmd = _selectedDate.toIso8601String().substring(0, 10);

    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: RefreshIndicator(
        onRefresh: () => _loadData(forceRefresh: true),
        color: AppTheme.info,
        backgroundColor: AppTheme.raisedSurface,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          // PERF: ~1.5 screens of cache so landscape dense lists scroll without
          // jank when cards enter the viewport.
          cacheExtent: MediaQuery.sizeOf(context).height * 1.5,
          slivers: [
            // HEADER (COMPACT)
            SliverToBoxAdapter(
              child: SmartSyncHeader(
                title: 'Rutero',
                subtitle: currentName,
                onSync: () => _loadData(forceRefresh: true),
                isLoading: isLoading || _isLoadingWeek,
                compact: true,
              ),
            ),

            // PENDING SYNC INDICATOR (EARS-11)
            const SliverToBoxAdapter(child: _PendingSyncChip()),

            // FUTURISTIC WEEK NAVIGATOR
            SliverToBoxAdapter(
              child: FuturisticWeekNavigator(
                selectedDate: _selectedDate,
                weekDays: _weekDays,
                onDaySelected: _onDaySelected,
                onWeekChange: _onWeekChange,
                isLoading: _isLoadingWeek,
                totalClients: albaranes.length,
              ),
            ),

            // ERROR BANNER
            if (error != null)
              SliverToBoxAdapter(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  margin: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: AppTheme.error.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: AppTheme.error.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.error_outline,
                        color: AppTheme.error,
                        size: 18,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          error,
                          style: const TextStyle(
                            color: AppTheme.error,
                            fontSize: 12,
                          ),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(
                          Icons.refresh,
                          color: AppTheme.error,
                          size: 18,
                        ),
                        onPressed: () => _loadData(forceRefresh: true),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                      ),
                    ],
                  ),
                ),
              ),

            if (_weekError != null)
              SliverToBoxAdapter(
                child: TextButton.icon(
                  key: const ValueKey('week-load-retry'),
                  onPressed: () => _loadData(forceRefresh: true),
                  icon: const Icon(Icons.refresh, color: AppTheme.error),
                  label: Text(_weekError!),
                ),
              ),

            if (_identityError != null)
              SliverToBoxAdapter(child: _buildIdentityError()),

            // SEARCH & FILTER ROW
            SliverToBoxAdapter(
              child: _buildSearchAndFilters(
                filterDebeCobrar: filterDebeCobrar,
                filterTipoPago: filterTipoPago,
                sortBy: sortBy,
                albaranes: albaranes,
                authUserCode: authState?.user?.code,
              ),
            ),

            // HOLOGRAPHIC KPI DASHBOARD
            SliverToBoxAdapter(
              child: HolographicKpiDashboard(
                totalEntregas: albaranes.length,
                entregasCompletadas: resumenCompletedCount,
                montoACobrar: resumenTotalACobrar,
                montoOpcional: resumenTotalOpcional,
                totalMonto: resumenTotalBruto,
                isLoading: isLoading,
              ),
            ),

            if (scopedId.isNotEmpty && !scopedId.contains(','))
              SliverToBoxAdapter(
                child: RuteroTrackingPanel(
                  repartidorId: scopedId,
                  routeDate: routeDateYmd,
                  stops: trackingStops,
                ),
              ),

            // CLIENT LIST
            if (isLoading || (albaranes.isEmpty && hasMore && error == null))
              SliverFillRemaining(
                hasScrollBody: false,
                child: _buildLoadingState(),
              )
            else
              _buildClientListSliver(albaranes),
          ],
        ),
      ),
    );
  }

  Widget _buildIdentityError() {
    return Container(
      key: const ValueKey('rutero-identity-error'),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.error.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.person_off_outlined,
            color: AppTheme.error,
            size: 18,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _identityError!,
              style: const TextStyle(color: AppTheme.error, fontSize: 12),
            ),
          ),
          TextButton(
            key: const ValueKey('rutero-identity-retry'),
            onPressed: () => _loadData(forceRefresh: true),
            child: const Text('Reintentar'),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchAndFilters({
    required String filterDebeCobrar,
    required String filterTipoPago,
    required String sortBy,
    required List albaranes,
    String? authUserCode,
  }) {
    final scopedId = (widget.repartidorId ?? authUserCode ?? '').trim();
    final canReorder = scopedId.isNotEmpty && !scopedId.contains(',');
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      child: RepartidorExecutivePanel(
        accentColor: AppTheme.accentIndigo,
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Busca una parada por cliente, número completo (P-15-2296) u orden de preparación.',
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 14,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 10),
            _ruteroSearchField(
              controller: _searchClientController,
              label: 'Cliente',
              hint: 'Nombre o código',
              onChanged: (value) => _updateRouteFilter(
                (notifier) =>
                    notifier.setSearchClient(value, autoReload: false),
              ),
            ),
            const SizedBox(height: 8),
            _ruteroSearchField(
              controller: _searchAlbaranController,
              label: 'Número',
              hint: 'Serie completa o número',
              onChanged: (value) => _updateRouteFilter(
                (notifier) =>
                    notifier.setSearchAlbaran(value, autoReload: false),
              ),
            ),
            const SizedBox(height: 8),
            _ruteroSearchField(
              controller: _searchOrdenController,
              label: 'Orden de preparación',
              hint: 'Número de orden',
              keyboardType: TextInputType.number,
              onChanged: (value) => _updateRouteFilter(
                (notifier) => notifier.setSearchOrden(value, autoReload: false),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Cobrar deja solo el cobro obligatorio. Crédito filtra esa forma de pago. '
              'Si ya está cobrado, se entrega y no sale en Cobros. '
              'Si el documento es 0,00 €, se puede entregar sin cobrar. '
              'Si la nota no carga, finaliza la entrega o pulsa Reintentar.',
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 13,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                // Quick filter chips
                _buildQuickFilterChip(
                  label: 'Cobrar',
                  isSelected: filterDebeCobrar == 'S',
                  color: AppTheme.obligatorio,
                  icon: Icons.euro,
                  onTap: () {
                    unawaited(HapticFeedback.selectionClick());
                    _updateRouteFilter(
                      (notifier) => notifier.setFilterDebeCobrar(
                        filterDebeCobrar == 'S' ? '' : 'S',
                        autoReload: false,
                      ),
                    );
                  },
                ),

                const SizedBox(width: 6),

                _buildQuickFilterChip(
                  label: 'Crédito',
                  isSelected: filterTipoPago == 'CREDITO',
                  color: AppTheme.credito,
                  icon: Icons.credit_card,
                  onTap: () {
                    unawaited(HapticFeedback.selectionClick());
                    _updateRouteFilter(
                      (notifier) => notifier.setFilterTipoPago(
                        filterTipoPago == 'CREDITO' ? '' : 'CREDITO',
                        autoReload: false,
                      ),
                    );
                  },
                ),

                const SizedBox(width: 6),

                Semantics(
                  label: 'Ordenar la lista',
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: sortBy,
                      icon: const Icon(Icons.sort,
                          color: AppTheme.info, size: 20),
                      dropdownColor: AppTheme.raisedSurface,
                      items: const [
                        DropdownMenuItem(
                          value: 'default',
                          child: Text('Orden de ruta'),
                        ),
                        DropdownMenuItem(
                          value: 'importe_desc',
                          child: Text('Mayor importe'),
                        ),
                        DropdownMenuItem(
                          value: 'importe_asc',
                          child: Text('Menor importe'),
                        ),
                      ],
                      onChanged: (val) {
                        if (val != null) {
                          unawaited(HapticFeedback.selectionClick());
                          _updateRouteFilter(
                            (notifier) =>
                                notifier.setSortBy(val, autoReload: false),
                          );
                        }
                      },
                    ),
                  ),
                ),
                if (canReorder)
                  Semantics(
                    button: true,
                    label: 'Ordenar paradas',
                    child: OutlinedButton.icon(
                      onPressed: () => _openReorderModal(
                        scopedId,
                        List<AlbaranEntrega>.from(albaranes),
                      ),
                      icon: const Icon(Icons.reorder),
                      label: const Text('Ordenar paradas'),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openReorderModal(
    String repartidorId,
    List<AlbaranEntrega> albaranes,
  ) async {
    unawaited(HapticFeedback.selectionClick());
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => RepartidorRuteroReorderModal(
          repartidorId: repartidorId,
          date: _selectedDate,
          albaranes: albaranes,
        ),
      ),
    );
    if ((saved ?? false) && mounted) {
      await _loadData(forceRefresh: true);
    }
  }

  Widget _buildQuickFilterChip({
    required String label,
    required bool isSelected,
    required Color color,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return Semantics(
      button: true,
      selected: isSelected,
      label: isSelected ? '$label, seleccionado' : label,
      child: RepartidorExecutivePill(
        label: label,
        icon: isSelected ? Icons.check_circle : icon,
        color: color,
        selected: isSelected,
        onTap: onTap,
      ),
    );
  }

  bool get _ruteroFiltersActive =>
      _searchClientController.text.trim().isNotEmpty ||
      _searchAlbaranController.text.trim().isNotEmpty ||
      _searchOrdenController.text.trim().isNotEmpty ||
      ref.read(entregasProvider).filterDebeCobrar.isNotEmpty ||
      ref.read(entregasProvider).filterTipoPago.isNotEmpty;

  Widget _ruteroSearchField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required ValueChanged<String> onChanged,
    TextInputType? keyboardType,
  }) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      style: const TextStyle(fontSize: 16),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        filled: true,
        fillColor: AppTheme.softPanel,
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: 'Borrar $label',
                onPressed: () {
                  controller.clear();
                  onChanged('');
                },
                icon: const Icon(Icons.clear),
              ),
      ),
      onChanged: onChanged,
    );
  }

  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 60,
            height: 60,
            child: CircularProgressIndicator(
              color: AppTheme.info,
              strokeWidth: 3,
            ),
          ),
          SizedBox(height: 16),
          Text(
            'Cargando entregas...',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildClientListSliver(List<AlbaranEntrega> albaranes) {
    if (albaranes.isEmpty) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: _buildEmptyState(),
      );
    }

    return SliverFadeTransition(
      opacity: _listAnimController,
      sliver: SliverPadding(
        padding: EdgeInsets.only(
          top: 4,
          bottom: Responsive.useBottomNav(context) ? 16 : 100,
        ),
        sliver: SliverList(
          delegate: SliverChildBuilderDelegate(
            (context, index) {
              final albaran = albaranes[index];

              return RepaintBoundary(
                child: Column(
                  children: [
                    SmartDeliveryCard(
                      albaran: albaran,
                      onTap: () => _showDetailDialog(albaran),
                      onSwipeComplete: () =>
                          _openConfirmationFromSwipe(albaran),
                      onSwipeNote: () => _showDetailDialog(albaran),
                      repartidorNames: widget.repartidorNames,
                    ),
                    if (index < albaranes.length - 1)
                      Divider(
                        height: 1,
                        thickness: 1,
                        color: AppTheme.borderColor.withValues(alpha: 0.3),
                        indent: 12,
                        endIndent: 12,
                      ),
                  ],
                ),
              );
            },
            childCount: albaranes.length,
            addAutomaticKeepAlives: false,
            addRepaintBoundaries: false,
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            RepartidorExecutivePanel(
              accentColor: AppTheme.info,
              padding: const EdgeInsets.all(28),
              borderRadius: AppTheme.radiusXl,
              child: Icon(
                Icons.inventory_2_outlined,
                size: 56,
                color: AppTheme.textSecondary.withValues(alpha: 0.5),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              _ruteroFiltersActive
                  ? 'Ninguna parada coincide'
                  : 'No hay entregas para este día',
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 18,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _ruteroFiltersActive
                  ? 'Prueba otro cliente, el número completo o la orden de preparación. '
                      'También puedes quitar Cobrar o Crédito.'
                  : 'Selecciona otro día en el calendario\no usa el buscador',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppTheme.textTertiary,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 24),
            OutlinedButton.icon(
              onPressed: () {
                HapticFeedback.lightImpact();
                _onDaySelected(DateTime.now());
              },
              icon: const Icon(Icons.today, size: 18),
              label: const Text('Ir a hoy'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.info,
                side: BorderSide(color: AppTheme.info.withValues(alpha: 0.5)),
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showDetailDialog(AlbaranEntrega albaran) {
    if (_isDetailModalOpen) {
      return;
    }

    _isDetailModalOpen = true;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.transparent,
      // The detail owns an explicit close action. Keeping the route from
      // dismissing by barrier tap or swipe guarantees that the confirmation
      // lock cannot be bypassed while evidence/payment is being persisted.
      isDismissible: false,
      enableDrag: false,
      builder: (ctx) => RuteroDetailModal(albaran: albaran, ref: ref),
    ).whenComplete(() {
      _isDetailModalOpen = false;
      if (mounted) {
        // Rebuild the complete route after a confirmation. A direct first
        // page reload would silently drop stops after the first 100 rows.
        unawaited(_loadData(forceRefresh: true));
      }
    });
  }

  /// A swipe is only a shortcut to the governed confirmation form. It never
  /// marks an order delivered or records a payment on its own.
  void _openConfirmationFromSwipe(AlbaranEntrega albaran) {
    if (albaran.estado == EstadoEntrega.entregado) {
      return;
    }
    HapticFeedback.mediumImpact();
    _showDetailDialog(albaran);
  }

  void _showQuickNoteDialog(AlbaranEntrega albaran) {
    final controller = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          side: BorderSide(color: AppTheme.info.withValues(alpha: 0.32)),
        ),
        title: Row(
          children: [
            const RepartidorExecutiveIcon(
              icon: Icons.note_add,
              color: AppTheme.info,
              size: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Nota para ${albaran.nombreCliente}',
                style: TextStyle(color: AppTheme.textPrimary, fontSize: 16),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        content: TextField(
          controller: controller,
          maxLines: 3,
          autofocus: true,
          style: TextStyle(color: AppTheme.textPrimary),
          decoration: InputDecoration(
            hintText: 'Añadir nota...',
            hintStyle:
                TextStyle(color: AppTheme.textSecondary.withValues(alpha: 0.5)),
            filled: true,
            fillColor: AppTheme.softPanel,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: BorderSide(color: AppTheme.borderColor),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: AppTheme.info),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(
              'Cancelar',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              _showDetailDialog(albaran);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.info,
              foregroundColor: AppTheme.textPrimary,
            ),
            child: const Text('Guardar'),
          ),
        ],
      ),
    ).whenComplete(controller.dispose);
  }
}

/// EARS-11: pending/failed offline operations indicator with counter and
/// access to the sync status sheet. Hidden while the queue is empty.
/// Shows live drain progress so the chip never looks "frozen" during sync.
class _PendingSyncChip extends StatelessWidget {
  const _PendingSyncChip();

  void _openSheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => const RepartoSyncStatusSheet(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<OfflineSyncProgress?>(
      valueListenable: OfflineSyncBridge.progress,
      builder: (context, syncProgress, _) {
        return ValueListenableBuilder<int>(
          valueListenable: OfflineSyncNotifier.pendingCount,
          builder: (context, pending, _) {
            return ValueListenableBuilder<int>(
              valueListenable: OfflineSyncNotifier.failedCount,
              builder: (context, failed, _) {
                final draining = syncProgress != null;
                if (!draining && pending <= 0 && failed <= 0) {
                  return const SizedBox.shrink();
                }
                final hasFailures = failed > 0;
                final label = draining
                    ? (syncProgress.message)
                    : hasFailures
                        ? '$pending pendientes · $failed con error'
                        : '$pending pendientes de sincronizar';
                return Semantics(
                  button: true,
                  label: draining
                      ? 'Sincronizando: ${syncProgress.message}'
                      : 'Sincronización: $pending pendientes, $failed con error',
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          ActionChip(
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize:
                                MaterialTapTargetSize.shrinkWrap,
                            avatar: draining
                                ? SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      value: syncProgress.fraction,
                                      color: AppTheme.info,
                                    ),
                                  )
                                : Icon(
                                    hasFailures
                                        ? Icons.error_outline
                                        : Icons.cloud_upload_outlined,
                                    size: 18,
                                    color: hasFailures
                                        ? AppTheme.error
                                        : AppTheme.warning,
                                  ),
                            label: Text(
                              label,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: draining
                                    ? AppTheme.info
                                    : hasFailures
                                        ? AppTheme.error
                                        : AppTheme.warning,
                              ),
                            ),
                            onPressed: () => _openSheet(context),
                          ),
                          if (draining && syncProgress.fraction != null) ...[
                            const SizedBox(height: 4),
                            SizedBox(
                              width: 220,
                              child: LinearProgressIndicator(
                                value: syncProgress.fraction,
                                minHeight: 2,
                                color: AppTheme.info,
                                backgroundColor:
                                    AppTheme.info.withValues(alpha: 0.15),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                );
              },
            );
          },
        );
      },
    );
  }
}
