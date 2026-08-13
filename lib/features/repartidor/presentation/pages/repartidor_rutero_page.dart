import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/futuristic_week_navigator.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/holographic_kpi_dashboard.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_rutero_reorder_modal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_modal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/smart_delivery_card.dart';

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
    with TickerProviderStateMixin {
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

    // Backend supports multi-ID for week endpoint (uses IN clause)
    await Future.wait([
      entregas.cargarAlbaranesPendientes(forceRefresh: forceRefresh),
      _loadWeekData(targetId, forceRefresh: forceRefresh),
    ]);
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
              '/repartidor/rutero/week/$repartidorId?date=${requestDate.toIso8601String().substring(0, 10)}',
              cacheKey:
                  'repartidor:rutero-week:$repartidorId:${requestDate.toIso8601String().substring(0, 10)}',
              cacheTTL: const Duration(minutes: 2),
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
    HapticFeedback.selectionClick();
    setState(() => _selectedDate = date);

    final entregas = ref.read(entregasProvider.notifier);
    entregas.seleccionarFecha(date);

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

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider.select((s) => s.value));

    final isLoading = ref.watch(entregasProvider.select((s) => s.isLoading));
    final error = ref.watch(entregasProvider.select((s) => s.error));
    final albaranes = ref.watch(entregasProvider.select((s) => s.albaranes));
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
        currentName = selectedName?.isNotEmpty == true
            ? selectedName!
            : 'Repartidor $scopedId';
      }
    }

    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: Column(
        children: [
          // HEADER (COMPACT)
          SmartSyncHeader(
            title: 'Rutero',
            subtitle: currentName,
            onSync: () => _loadData(forceRefresh: true),
            isLoading: isLoading || _isLoadingWeek,
            compact: true,
          ),

          // FUTURISTIC WEEK NAVIGATOR
          FuturisticWeekNavigator(
            selectedDate: _selectedDate,
            weekDays: _weekDays,
            onDaySelected: _onDaySelected,
            onWeekChange: _onWeekChange,
            isLoading: _isLoadingWeek,
            totalClients: albaranes.length,
          ),

          // ERROR BANNER
          if (error != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              margin: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: AppTheme.error.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
                border:
                    Border.all(color: AppTheme.error.withValues(alpha: 0.3)),
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
                      style:
                          const TextStyle(color: AppTheme.error, fontSize: 12),
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

          if (_weekError != null)
            TextButton.icon(
              key: const ValueKey('week-load-retry'),
              onPressed: () => _loadData(forceRefresh: true),
              icon: const Icon(Icons.refresh, color: AppTheme.error),
              label: Text(_weekError!),
            ),

          if (_identityError != null) _buildIdentityError(),

          // SEARCH & FILTER ROW
          _buildSearchAndFilters(
            filterDebeCobrar: filterDebeCobrar,
            filterTipoPago: filterTipoPago,
            sortBy: sortBy,
            albaranes: albaranes,
            authUserCode: authState?.user?.code,
          ),

          // HOLOGRAPHIC KPI DASHBOARD
          HolographicKpiDashboard(
            totalEntregas: albaranes.length,
            entregasCompletadas: resumenCompletedCount,
            montoACobrar: resumenTotalACobrar,
            montoOpcional: resumenTotalOpcional,
            totalMonto: resumenTotalBruto,
            isLoading: isLoading,
          ),

          // CLIENT LIST
          Expanded(
            child:
                isLoading ? _buildLoadingState() : _buildClientList(albaranes),
          ),
        ],
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
          const Icon(Icons.person_off_outlined,
              color: AppTheme.error, size: 18),
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
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: RepartidorExecutivePanel(
        accentColor: AppTheme.accentIndigo,
        padding: const EdgeInsets.all(8),
        child: Row(
          children: [
            // Clients Filter (responsive - flex instead of fixed width)
            ConstrainedBox(
              constraints: BoxConstraints(
                minWidth: 100,
                maxWidth: Responsive.value(context, phone: 130, desktop: 160),
              ),
              child: Container(
                height: 36,
                decoration: BoxDecoration(
                  color: AppTheme.softPanel,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.borderColor),
                ),
                child: Row(
                  children: [
                    const SizedBox(width: 8),
                    const Icon(
                      Icons.person_outline,
                      size: 14,
                      color: AppTheme.textSecondary,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: TextField(
                        controller: _searchClientController,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppTheme.textPrimary,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'Cliente...',
                          hintStyle: TextStyle(
                            fontSize: 11,
                            color: AppTheme.textSecondary,
                          ),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: EdgeInsets.zero,
                        ),
                        onChanged: (v) => ref
                            .read(entregasProvider.notifier)
                            .setSearchClient(v),
                      ),
                    ),
                    if (_searchClientController.text.isNotEmpty)
                      IconButton(
                        icon: const Icon(Icons.clear, size: 14),
                        onPressed: () {
                          _searchClientController.clear();
                          ref
                              .read(entregasProvider.notifier)
                              .setSearchClient('');
                        },
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                      ),
                  ],
                ),
              ),
            ),

            const SizedBox(width: 6),

            // Albaranes Filter (responsive - flex instead of fixed width)
            ConstrainedBox(
              constraints: BoxConstraints(
                minWidth: 90,
                maxWidth: Responsive.value(context, phone: 110, desktop: 130),
              ),
              child: Container(
                height: 36,
                decoration: BoxDecoration(
                  color: AppTheme.softPanel,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.borderColor),
                ),
                child: Row(
                  children: [
                    const SizedBox(width: 8),
                    const Icon(
                      Icons.description_outlined,
                      size: 14,
                      color: AppTheme.textSecondary,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: TextField(
                        controller: _searchAlbaranController,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppTheme.textPrimary,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'NÂº Alb/Fac...',
                          hintStyle: TextStyle(
                            fontSize: 11,
                            color: AppTheme.textSecondary,
                          ),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: EdgeInsets.zero,
                        ),
                        onChanged: (v) => ref
                            .read(entregasProvider.notifier)
                            .setSearchAlbaran(v),
                      ),
                    ),
                    if (_searchAlbaranController.text.isNotEmpty)
                      IconButton(
                        icon: const Icon(Icons.clear, size: 14),
                        onPressed: () {
                          _searchAlbaranController.clear();
                          ref
                              .read(entregasProvider.notifier)
                              .setSearchAlbaran('');
                        },
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                      ),
                  ],
                ),
              ),
            ),

            const SizedBox(width: 8),

            // Quick filter chips
            _buildQuickFilterChip(
              label: 'Cobrar',
              isSelected: filterDebeCobrar == 'S',
              color: AppTheme.obligatorio,
              icon: Icons.euro,
              onTap: () {
                HapticFeedback.selectionClick();
                ref.read(entregasProvider.notifier).setFilterDebeCobrar(
                      filterDebeCobrar == 'S' ? '' : 'S',
                    );
              },
            ),

            const SizedBox(width: 6),

            _buildQuickFilterChip(
              label: 'CrÃ©dito',
              isSelected: filterTipoPago == 'CREDITO',
              color: AppTheme.credito,
              icon: Icons.credit_card,
              onTap: () {
                HapticFeedback.selectionClick();
                ref.read(entregasProvider.notifier).setFilterTipoPago(
                      filterTipoPago == 'CREDITO' ? '' : 'CREDITO',
                    );
              },
            ),

            const SizedBox(width: 6),

            // Sort dropdown
            Container(
              height: 38,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                color: AppTheme.softPanel,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: sortBy,
                  icon: const Icon(
                    Icons.sort,
                    color: AppTheme.info,
                    size: 18,
                  ),
                  dropdownColor: AppTheme.raisedSurface,
                  items: const [
                    DropdownMenuItem(
                      value: 'default',
                      child: Text(
                        'â†• Orden',
                        style: TextStyle(
                            color: AppTheme.textPrimary, fontSize: 11),
                      ),
                    ),
                    DropdownMenuItem(
                      value: 'importe_desc',
                      child: Text(
                        'â†“ Mayor â‚¬',
                        style: TextStyle(
                            color: AppTheme.textPrimary, fontSize: 11),
                      ),
                    ),
                    DropdownMenuItem(
                      value: 'importe_asc',
                      child: Text(
                        'â†‘ Menor â‚¬',
                        style: TextStyle(
                            color: AppTheme.textPrimary, fontSize: 11),
                      ),
                    ),
                  ],
                  onChanged: (val) {
                    if (val != null) {
                      HapticFeedback.selectionClick();
                      ref.read(entregasProvider.notifier).setSortBy(val);
                    }
                  },
                ),
              ),
            ),

            if (canReorder) ...[
              const SizedBox(width: 6),
              Material(
                color: AppTheme.softPanel,
                borderRadius: BorderRadius.circular(10),
                child: InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: () => _openReorderModal(
                    scopedId,
                    List<AlbaranEntrega>.from(albaranes),
                  ),
                  child: Container(
                    height: 38,
                    width: 38,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppTheme.borderColor),
                    ),
                    child: const Icon(
                      Icons.reorder,
                      color: AppTheme.info,
                      size: 18,
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _openReorderModal(
    String repartidorId,
    List<AlbaranEntrega> albaranes,
  ) async {
    HapticFeedback.selectionClick();
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
    if (saved == true && mounted) {
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
    return RepartidorExecutivePill(
      label: label,
      icon: icon,
      color: color,
      selected: isSelected,
      onTap: onTap,
    );
  }

  Widget _buildLoadingState() {
    return const Center(
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

  Widget _buildClientList(List<AlbaranEntrega> albaranes) {
    if (albaranes.isEmpty) {
      return _buildEmptyState();
    }

    return AnimatedBuilder(
      animation: _listAnimController,
      builder: (context, child) {
        return FadeTransition(
          opacity: _listAnimController,
          child: SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(0, 0.1),
              end: Offset.zero,
            ).animate(
              CurvedAnimation(
                parent: _listAnimController,
                curve: Curves.easeOutCubic,
              ),
            ),
            child: RefreshIndicator(
              onRefresh: () => _loadData(forceRefresh: true),
              color: AppTheme.info,
              backgroundColor: AppTheme.raisedSurface,
              child: ListView.builder(
                physics: const AlwaysScrollableScrollPhysics(),
                // Responsive: less bottom padding on phones with bottom nav
                padding: EdgeInsets.only(
                  top: 4,
                  bottom: Responsive.useBottomNav(context) ? 16 : 100,
                ),
                itemCount: albaranes.length,
                itemBuilder: (context, index) {
                  final albaran = albaranes[index];

                  return Column(
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
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildEmptyState() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: Column(
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
            const Text(
              'No hay entregas para este dÃ­a',
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 18,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Selecciona otro dÃ­a en el calendario\no usa el buscador',
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
    final entregasNotifier = ref.read(entregasProvider.notifier);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => RuteroDetailModal(albaran: albaran, ref: ref),
    ).whenComplete(() {
      _isDetailModalOpen = false;
      if (mounted) {
        entregasNotifier.cargarAlbaranesPendientes(forceRefresh: true);
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
                style:
                    const TextStyle(color: AppTheme.textPrimary, fontSize: 16),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        content: TextField(
          controller: controller,
          maxLines: 3,
          autofocus: true,
          style: const TextStyle(color: AppTheme.textPrimary),
          decoration: InputDecoration(
            hintText: 'AÃ±adir nota...',
            hintStyle:
                TextStyle(color: AppTheme.textSecondary.withValues(alpha: 0.5)),
            filled: true,
            fillColor: AppTheme.softPanel,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: AppTheme.borderColor),
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
            child: const Text(
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
    );
  }
}
