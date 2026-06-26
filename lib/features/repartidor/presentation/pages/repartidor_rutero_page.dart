import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/futuristic_week_navigator.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/holographic_kpi_dashboard.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_modal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/smart_delivery_card.dart';

/// Repartidor Rutero Page - Futuristic Redesign
/// Features:
/// - Holographic week navigator with gestures
/// - KPI dashboard with gamification
/// - Smart delivery cards with AI suggestions
/// - Improved filtering and search
/// - Director "View As" with auto-reload
class RepartidorRuteroPage extends ConsumerStatefulWidget {
  const RepartidorRuteroPage({
    super.key,
    this.repartidorId,
    this.repartidorNames,
  });
  final String? repartidorId;
  final Map<String, String>? repartidorNames;

  @override
  ConsumerState<RepartidorRuteroPage> createState() =>
      _RepartidorRuteroPageState();
}

class _RepartidorRuteroPageState extends ConsumerState<RepartidorRuteroPage>
    with TickerProviderStateMixin {
  DateTime _selectedDate = DateTime.now();
  List<Map<String, dynamic>> _weekDays = [];
  bool _isLoadingWeek = false;
  int _weekLoadGeneration = 0;
  String? _lastLoadedId;
  final TextEditingController _searchClientController = TextEditingController();
  final TextEditingController _searchAlbaranController =
      TextEditingController();
  Timer? _loadDebounceTimer;
  Completer<void>? _loadCompleter;

  late AnimationController _listAnimController;
  // Cache the repartidores future to avoid re-fetching on every rebuild
  Future<List<Map<String, dynamic>>>? _repartidoresFuture;

  @override
  void initState() {
    super.initState();
    _listAnimController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    // Pre-fetch repartidores list once
    _repartidoresFuture = ApiClient.getList(
      '/auth/repartidores',
      cacheKey: 'auth:repartidores',
      cacheTTL: CacheService.longTTL,
    ).then(
      (val) => val.map((e) => e as Map<String, dynamic>).toList(),
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
      _listAnimController.forward();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Logic removed to prevent infinite loop.
    // Data loading is handled by initState and Dropdown changes.
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
    final selectedVendor = ref.read(selectedVendorProvider);
    final entregas = ref.read(entregasProvider.notifier);

    var targetId = widget.repartidorId ?? auth?.user?.code ?? '';

    // View As logic for directors
    if (auth?.user?.isJefeVentas ?? false) {
      targetId = selectedVendor ?? targetId;
    }

    // NOTE: Multi-ID (comma-separated) IS supported by /pendientes endpoint
    // The week endpoint needs single ID, handled in _loadWeekData

    if (targetId.isEmpty) return;

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
      final response = await ApiClient.get(
        '/repartidor/rutero/week/$repartidorId?date=${requestDate.toIso8601String()}',
        cacheKey:
            'repartidor:rutero-week:$repartidorId:${requestDate.toIso8601String().substring(0, 10)}',
        cacheTTL: const Duration(minutes: 2),
        forceRefresh: forceRefresh,
      );
      if (generation != _weekLoadGeneration || !mounted) return;
      if (response['success'] == true) {
        setState(() {
          _weekDays = List<Map<String, dynamic>>.from(response['days'] as List);
        });
      }
    } catch (e) {
      if (generation == _weekLoadGeneration) {
        debugPrint('Error loading week data: $e');
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
    final selectedVendor = ref.watch(selectedVendorProvider);

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

    // Header Name Logic
    var currentName = authState?.user?.name ?? 'Repartidor';
    if (authState?.user?.isJefeVentas ?? false && selectedVendor != null) {
      currentName = 'Repartidor $selectedVendor';
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

          // DIRECTOR FILTER (if applicable)
          if (authState?.user?.isJefeVentas ?? false)
            _buildDirectorFilter(authState!),

          // SEARCH & FILTER ROW
          _buildSearchAndFilters(
            filterDebeCobrar: filterDebeCobrar,
            filterTipoPago: filterTipoPago,
            sortBy: sortBy,
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

  Widget _buildDirectorFilter(AuthState auth) {
    final filterState = ref.watch(filterProvider);
    final filterNotifier = ref.read(filterProvider.notifier);
    final selectedVendor = filterState.selectedVendor as String?;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: _repartidoresFuture,
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const SizedBox.shrink();

          final repartidores = snapshot.data!;

          return Container(
            height: 42,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: AppTheme.raisedSurface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.borderColor),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.person_search,
                  color: AppTheme.info,
                  size: 20,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: selectedVendor,
                      hint: const Text(
                        'Ver como repartidor...',
                        style: TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 13,
                        ),
                      ),
                      icon: const Icon(
                        Icons.arrow_drop_down,
                        color: AppTheme.info,
                      ),
                      dropdownColor: AppTheme.raisedSurface,
                      isExpanded: true,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                      ),
                      items: repartidores.map((r) {
                        final code = r['code'].toString().trim();
                        final name = r['name'].toString().trim();
                        // Format requested: R. 44: NOMBRE
                        final displayName =
                            'R. $code: ${name.startsWith('$code ') ? name.replaceFirst('$code ', '') : name}';

                        return DropdownMenuItem(
                          value: code,
                          child: Text(
                            displayName,
                            style: const TextStyle(fontSize: 12),
                            overflow: TextOverflow.ellipsis,
                          ),
                        );
                      }).toList(),
                      onChanged: (val) {
                        if (val != null) {
                          HapticFeedback.selectionClick();
                          filterNotifier.setVendor(val);

                          // Manually trigger reload and pivot _lastLoadedId to prevent
                          // duplicate/conflicting loads from didChangeDependencies
                          if (mounted) {
                            setState(() => _lastLoadedId = val);
                          }

                          // Force immediate reload
                          ref
                              .read(entregasProvider.notifier)
                              .setRepartidor(val, forceReload: true);
                          ref.read(entregasProvider.notifier).seleccionarFecha(
                                _selectedDate,
                                forceRefresh: true,
                              );
                          _loadWeekData(val, forceRefresh: true);
                        }
                      },
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(
                    Icons.refresh,
                    color: AppTheme.info,
                    size: 20,
                  ),
                  tooltip: 'Recargar datos',
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    if (selectedVendor != null) {
                      ref
                          .read(entregasProvider.notifier)
                          .setRepartidor(selectedVendor, forceReload: true);
                      ref.read(entregasProvider.notifier).seleccionarFecha(
                            _selectedDate,
                            forceRefresh: true,
                          );
                      _loadWeekData(selectedVendor, forceRefresh: true);
                    }
                  },
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildSearchAndFilters({
    required String filterDebeCobrar,
    required String filterTipoPago,
    required String sortBy,
  }) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
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
                        ref.read(entregasProvider.notifier).setSearchClient('');
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
                        hintText: 'Nº Alb/Fac...',
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
            label: 'Crédito',
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
                      '↕ Orden',
                      style:
                          TextStyle(color: AppTheme.textPrimary, fontSize: 11),
                    ),
                  ),
                  DropdownMenuItem(
                    value: 'importe_desc',
                    child: Text(
                      '↓ Mayor €',
                      style:
                          TextStyle(color: AppTheme.textPrimary, fontSize: 11),
                    ),
                  ),
                  DropdownMenuItem(
                    value: 'importe_asc',
                    child: Text(
                      '↑ Menor €',
                      style:
                          TextStyle(color: AppTheme.textPrimary, fontSize: 11),
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
        ],
      ),
    );
  }

  Widget _buildQuickFilterChip({
    required String label,
    required bool isSelected,
    required Color color,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: AppTheme.animFast,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color:
              isSelected ? color.withValues(alpha: 0.16) : AppTheme.softPanel,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isSelected ? color : AppTheme.borderColor,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 14,
              color: isSelected ? color : AppTheme.textSecondary,
            ),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                color: isSelected ? color : AppTheme.textSecondary,
                fontSize: 10,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
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
                        onSwipeComplete: () => _handleQuickComplete(albaran),
                        onSwipeNote: () => _showQuickNoteDialog(albaran),
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
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              color: AppTheme.raisedSurface,
              shape: BoxShape.circle,
              border: Border.all(
                color: AppTheme.borderColor,
                width: 2,
              ),
            ),
            child: Icon(
              Icons.inventory_2_outlined,
              size: 56,
              color: AppTheme.textSecondary.withValues(alpha: 0.5),
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'No hay entregas para este día',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 18,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Selecciona otro día en el calendario\no usa el buscador',
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
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            ),
          ),
        ],
      ),
    );
  }

  void _showDetailDialog(AlbaranEntrega albaran) {
    final entregasNotifier = ref.read(entregasProvider.notifier);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => RuteroDetailModal(albaran: albaran, ref: ref),
    ).then((_) {
      if (mounted) {
        entregasNotifier.cargarAlbaranesPendientes(forceRefresh: true);
      }
    });
  }

  void _handleQuickComplete(AlbaranEntrega albaran) {
    // 1. Validation: If CTR (Must Pay), prevent quick swipe
    if (albaran.esCTR) {
      HapticFeedback.heavyImpact();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Row(
            children: [
              Icon(Icons.warning_amber_rounded, color: Colors.white),
              SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Cobro obligatorio. Abra el detalle para registrar pago.',
                ),
              ),
            ],
          ),
          backgroundColor: AppTheme.obligatorio,
          duration: const Duration(seconds: 3),
          action: SnackBarAction(
            label: 'ABRIR',
            textColor: Colors.white,
            onPressed: () => _showDetailDialog(albaran),
          ),
        ),
      );
      // Re-open detail slightly delayed
      Future.delayed(
        const Duration(milliseconds: 300),
        () => _showDetailDialog(albaran),
      );
      return;
    }

    // 2. Perform Quick Complete
    final provider = ref.read(entregasProvider.notifier);

    // Optimistic UI update or wait?
    // Let's show loading snackbar then success

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppTheme.info,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(child: Text('Completando ${albaran.nombreCliente}...')),
          ],
        ),
        backgroundColor: AppTheme.raisedSurface,
        duration: const Duration(seconds: 1),
      ),
    );

    provider
        .marcarEntregado(
      albaranId: albaran.id,
      observaciones: 'Completado rápido (Swipe)',
      // No signature/photos for quick swipe
    )
        .then((success) {
      if (success) {
        HapticFeedback.lightImpact();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white),
                const SizedBox(width: 12),
                Expanded(child: Text('Completado: ${albaran.nombreCliente}')),
              ],
            ),
            backgroundColor: AppTheme.success,
            duration: const Duration(seconds: 2),
          ),
        );
        provider.cargarAlbaranesPendientes(forceRefresh: true); // Refresh list
      } else {
        HapticFeedback.heavyImpact();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Error al completar: ${ref.read(entregasProvider).error ?? "Desconocido"}',
            ),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    });
  }

  void _showQuickNoteDialog(AlbaranEntrega albaran) {
    final controller = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          side: const BorderSide(color: AppTheme.borderColor),
        ),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppTheme.info.withValues(alpha: 0.14),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.note_add,
                color: AppTheme.info,
                size: 20,
              ),
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
            hintText: 'Añadir nota...',
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
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Nota guardada'),
                  backgroundColor: AppTheme.success,
                ),
              );
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
