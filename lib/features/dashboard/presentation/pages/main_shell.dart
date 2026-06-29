import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/services/navigation_config_service.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/pages/chatbot_page.dart';
import 'package:gmp_app_mobilidad/features/chatbot/providers/chatbot_shell_navigation.dart';
import 'package:gmp_app_mobilidad/core/widgets/lazy_indexed_stack.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/clients/presentation/pages/simple_client_list_page.dart';
import 'package:gmp_app_mobilidad/features/cobros/presentation/pages/cobros_page.dart';
import 'package:gmp_app_mobilidad/features/commissions/presentation/pages/commissions_page.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/pages/dashboard_content.dart';
import 'package:gmp_app_mobilidad/features/facturas/presentation/pages/facturas_page.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/presentation/pages/kpi_dashboard_page.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/presentation/pages/comercial_liquidacion_diaria_page.dart';
import 'package:gmp_app_mobilidad/features/objectives/presentation/pages/objectives_page.dart';
import 'package:gmp_app_mobilidad/features/objectives/presentation/pages/client_evolution_page.dart';
import 'package:gmp_app_mobilidad/features/bolsa/presentation/pages/bolsa_page.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/pages/pedidos_page.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_clientes_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_historico_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_panel_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_rutero_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/comisiones_page.dart'
    as repartidor_finanzas;
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/liquidacion_diaria_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/repartidor_evolution_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/vencimientos_page.dart';
import 'package:gmp_app_mobilidad/features/rutero/presentation/pages/rutero_page.dart';
import 'package:gmp_app_mobilidad/features/settings/presentation/pages/network_settings_page.dart';
import 'package:gmp_app_mobilidad/features/settings/presentation/pages/notification_settings_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/articles_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/load_history_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/personnel_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/vehicles_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/warehouse_dashboard_page.dart';
import 'package:url_launcher/url_launcher.dart';

/// Main app shell with navigation rail for tablet mode
/// Dashboard is only visible for Jefe de Ventas
class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key});

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  int _currentIndex = 0;
  bool _isNavExpanded = true;

  String? _selectedRepartidor = 'ALL';
  List<Map<String, dynamic>> _repartidoresOptions = [];
  bool _isLoadingRepartidores = false;

  bool _forceRepartidorMode = false;
  bool _forceAlmacenMode = false;

  String? _pendingClientId;
  String? _pendingClientName;

  @override
  void initState() {
    super.initState();
    final visualQaRole = _visualQaRoleOverride();
    if (visualQaRole == 'almacen' || visualQaRole == 'almacén') {
      _forceAlmacenMode = true;
      _forceRepartidorMode = false;
    } else if (visualQaRole == 'repartidor') {
      _forceRepartidorMode = true;
      _forceAlmacenMode = false;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkConnection();
      _checkForUpdates();

      final authState = ref.read(authProvider).value;
      final role = authState?.user?.role ?? '';
      if (role == 'REPARTIDOR') {
        _forceRepartidorMode = true;
      }
    });
  }

  String _visualQaRoleOverride() {
    if (!kDebugMode) return '';
    const definedRole = String.fromEnvironment('GMP_VISUAL_QA_ROLE');
    final role = definedRole.isNotEmpty
        ? definedRole
        : Uri.base.queryParameters['gmpVisualQaRole'] ?? '';
    return role.trim().toLowerCase();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Auth redirect is handled by GoRouter in main.dart – no manual navigation needed here.
  }

  bool get _isRepartidorEffective {
    final authState = ref.read(authProvider).value;
    if (_forceRepartidorMode) return true;
    if (_forceAlmacenMode) return false;
    return authState?.user?.isRepartidor ?? false;
  }

  bool get _isAlmacenEffective {
    if (_forceAlmacenMode) return true;
    return false;
  }

  bool _hasScopedVendorAccess(UserModel user, List<String> vendorCodes) {
    // Commercial 80 (Almeria lead) gets team view access
    final normalizedCode = user.code.replaceFirst(RegExp(r'^0+'), '');
    if (normalizedCode == '80' && vendorCodes.length > 1) return true;
    return !user.isJefeVentas && vendorCodes.length > 1;
  }

  String _defaultScopedVendor(UserModel user, List<String> vendorCodes) {
    // Commercial 80 (Almeria lead) defaults to ALL team members
    final normalizedCode = user.code.replaceFirst(RegExp(r'^0+'), '');
    if (normalizedCode == '80') return 'ALL';
    final ownCode = user.vendedorCode ?? user.code;
    if (vendorCodes.contains(ownCode)) return ownCode;
    return vendorCodes.isNotEmpty ? vendorCodes.first : ownCode;
  }

  void _ensureScopedVendorSelection(UserModel user, List<String> vendorCodes) {
    if (!_hasScopedVendorAccess(user, vendorCodes)) return;
    final selected = ref.read(selectedVendorProvider);
    if (selected != null && vendorCodes.contains(selected)) return;

    final defaultCode = _defaultScopedVendor(user, vendorCodes);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(filterProvider.notifier).setVendor(defaultCode);
    });
  }

  @override
  void dispose() {
    super.dispose();
  }

  void _checkForUpdates() {
    final authState = ref.read(authProvider).value;
    if (!(authState?.updateAvailable ?? false)) return;

    final isMandatory = authState?.isMandatoryUpdate ?? false;

    showDialog(
      context: context,
      barrierDismissible: !isMandatory,
      builder: (context) => PopScope(
        canPop: !isMandatory,
        child: AlertDialog(
          title: Text(
            isMandatory
                ? 'Actualización Obligatoria'
                : 'Actualización Disponible',
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontWeight: FontWeight.bold,
              fontSize: 20,
            ),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                (authState?.updateMessage.isNotEmpty ?? false)
                    ? authState!.updateMessage
                    : 'Hay una nueva versión de la app con mejoras críticas.',
                style: const TextStyle(color: AppTheme.textSecondary),
              ),
              if (isMandatory) ...[
                const SizedBox(height: 16),
                const Text(
                  'Esta actualización es necesaria para garantizar la integridad de los datos y el correcto funcionamiento.',
                  style: TextStyle(
                    color: AppTheme.warning,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ],
          ),
          backgroundColor: AppTheme.raisedSurface,
          actions: [
            if (!isMandatory)
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text(
                  'MÁS TARDE',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
              )
            else
              const TextButton(
                onPressed: SystemNavigator.pop,
                child: Text(
                  'CERRAR APP',
                  style: TextStyle(color: AppTheme.error),
                ),
              ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.success,
                foregroundColor: Colors.white,
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              onPressed: () {
                launchUrl(
                  Uri.parse(authState?.playStoreUrl ?? ''),
                  mode: LaunchMode.externalApplication,
                );
              },
              child: const Text(
                'ACTUALIZAR AHORA',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _checkConnection() async {
    final authState = ref.read(authProvider).value;
    final user = authState?.user;
    if (user != null) {
      if (user.isJefeVentas) {
        // Fetch repartidores
        _fetchRepartidores();
      } else {
        // Non-Jefe starts at first available section (Clientes)
        setState(() {
          _currentIndex = 0; // Will map to Clientes for non-Jefe
        });
      }
    }
  }

  // Show logout confirmation modal
  Future<void> _showLogoutConfirmation(AuthState authState) async {
    final shouldLogout = await showDialog<bool>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.56),
      builder: (context) => _LogoutConfirmationDialog(
        userName: authState.user?.name ?? 'Usuario',
      ),
    );

    if ((shouldLogout ?? false) && mounted) {
      await ProviderScope.containerOf(context)
          .read(authProvider.notifier)
          .logout();
    }
  }

  Future<void> _fetchRepartidores() async {
    setState(() => _isLoadingRepartidores = true);
    try {
      debugPrint('[MainShell] _fetchRepartidores: calling API...');
      final res = await ApiClient.getList(
        '/auth/repartidores',
        cacheKey: 'auth:repartidores',
        cacheTTL: CacheService.longTTL,
      );
      debugPrint(
        '[MainShell] _fetchRepartidores: got ${res.length} items, type=${res.runtimeType}',
      );
      if (res.isNotEmpty) {
        debugPrint(
          '[MainShell] First item: ${res.first} (type=${res.first.runtimeType})',
        );
      }
      if (!mounted) return;
      setState(() {
        // Helper to safely get value regardless of case
        String? getValue(Map m, String key) {
          if (m.containsKey(key)) return m[key]?.toString();
          if (m.containsKey(key.toUpperCase())) {
            return m[key.toUpperCase()]?.toString();
          }
          if (m.containsKey(key.toLowerCase())) {
            return m[key.toLowerCase()]?.toString();
          }
          return null;
        }

        _repartidoresOptions = res
            .map((item) {
              final m = Map<String, dynamic>.from(item as Map);
              return {
                'code':
                    getValue(m, 'code') ?? getValue(m, 'CODIGOVENDEDOR') ?? '',
                'name': getValue(m, 'name') ??
                    getValue(m, 'NOMBREVENDEDOR') ??
                    'Desconocido',
              };
            })
            .where(
              (item) =>
                  item['code'] != null && item['code'].toString().isNotEmpty,
            )
            .toList();

        // Sort by code ascending
        _repartidoresOptions.sort(
          (a, b) => (a['code']?.toString() ?? '')
              .compareTo(b['code']?.toString() ?? ''),
        );

        debugPrint(
          '[MainShell] _fetchRepartidores: mapped ${_repartidoresOptions.length} options',
        );
        _isLoadingRepartidores = false;
      });
    } catch (e, stack) {
      debugPrint('[MainShell] ERROR fetching repartidores: $e');
      debugPrint('[MainShell] Stack: $stack');
      if (mounted) setState(() => _isLoadingRepartidores = false);
    }
  }

  List<_NavItem> _getNavItems(bool isJefeVentas, List<String> vendorCodes) {
    final authState = ref.read(authProvider).value;
    final user = authState?.user;
    final normalizedUserCode =
        (user?.code ?? '').replaceFirst(RegExp(r'^0+'), '');
    final showCommissions =
        (user?.showCommissions ?? false) && normalizedUserCode != '80';

    final navItems = NavigationConfigService.getNavItems(
      isAlmacen: _isAlmacenEffective,
      isRepartidor: _isRepartidorEffective,
      isJefeVentas: isJefeVentas,
      showCommissions: showCommissions,
    );

    final mappedItems = navItems
        .map(
          (item) => _NavItem(
            icon: item.icon,
            selectedIcon: item.selectedIcon,
            label: item.label,
            color: item.color,
          ),
        )
        .toList();

    if (!isJefeVentas && !_isAlmacenEffective && !_isRepartidorEffective) {
      const priority = [
        'Pedidos',
        'Clientes',
        'Cobros',
        'Liquidación',
        'Ruta',
        'Objetivos',
        'Comisiones',
        'Facturas',
        'Alertas',
        'Bolsa',
        'Evolución',
        'Evolución',
        'Asistente',
      ];
      mappedItems.sort((a, b) {
        final ai = priority.indexOf(a.label);
        final bi = priority.indexOf(b.label);
        final ar = ai == -1 ? priority.length : ai;
        final br = bi == -1 ? priority.length : bi;
        return ar.compareTo(br);
      });
    }

    return mappedItems;
  }

  List<Map<String, String>> _getRepartidores(List<String> codes) {
    return [
      {'code': 'ALL', 'name': 'Todos los Repartidores'},
      ...codes.map((c) => {'code': c, 'name': 'Repartidor $c'}),
    ];
  }

  @override
  Widget build(BuildContext context) {
    // PERFORMANCE: Use select() to only rebuild when user changes
    final user = ref.watch(authProvider.select((state) => state.value?.user));

    if (user == null) {
      return const Scaffold(
        body: Center(child: ModernLoading(message: 'Cargando...')),
      );
    }

    final isJefeVentas = user.isJefeVentas;
    if (_forceRepartidorMode && isJefeVentas && _selectedRepartidor == null) {
      _selectedRepartidor = 'ALL';
    }

    // Req #2: Sincroniza rol del usuario en pedidosProvider para que la UI
    // muestre/oculte márgenes según corresponda. Se hace de forma defensiva
    // post-frame para no notificar listeners durante el build.
    final currentRole = user.role;
    final currentUserCode = user.code;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(pedidosProvider).setUserRole(currentRole, code: currentUserCode);
    });

    // PERFORMANCE: Use select() to only rebuild when vendedorCodes changes
    final vendedorCodes = ref.watch(
      authProvider.select((state) => state.value?.vendedorCodes ?? []),
    );
    _ensureScopedVendorSelection(user, vendedorCodes);
    final normalizedUserCode = (user.code).replaceFirst(RegExp(r'^0+'), '');
    final isCommercial80 = normalizedUserCode == '80';
    // 80 stays COMERCIAL in nav even if DB has JEFEVENTASSN (avoids Panel index mismatch)
    final navIsJefeVentas = isJefeVentas && !isCommercial80;
    final navItems = _getNavItems(navIsJefeVentas, vendedorCodes);
    final safeIndex = _currentIndex.clamp(0, navItems.length - 1);
    final useBottomNav = Responsive.useBottomNav(context);

    ref.listen(chatbotShellNavigationProvider, (previous, next) {
      if (next == null) return;
      final targetIdx =
          navItems.indexWhere((item) => item.label == next.tabLabel);
      if (targetIdx >= 0) {
        setState(() {
          _currentIndex = targetIdx;
          if (next.clientCode != null && next.clientCode!.isNotEmpty) {
            _pendingClientId = next.clientCode;
          }
        });
      }
      ref.read(chatbotShellNavigationProvider.notifier).clear();
    });

    if (useBottomNav) {
      return _buildPhoneLayout(navItems, safeIndex, user, navIsJefeVentas);
    }
    return _buildTabletLayout(navItems, safeIndex, user, navIsJefeVentas);
  }

  // ---------------------------------------------------------------------------
  // PHONE LAYOUT: Bottom navigation + drawer for avatar/settings
  // ---------------------------------------------------------------------------
  Widget _buildPhoneLayout(
    List<_NavItem> navItems,
    int safeIndex,
    UserModel user,
    bool isJefeVentas,
  ) {
    const maxBottomItems = 5;
    final hasOverflow = navItems.length > maxBottomItems;
    final bottomItems =
        hasOverflow ? navItems.sublist(0, maxBottomItems - 1) : navItems;

    return Scaffold(
      backgroundColor: Colors.transparent,
      drawer: _buildPhoneDrawer(user, isJefeVentas),
      body: DecoratedBox(
        decoration: AppTheme.appBackground(),
        child: SafeArea(
          child: _buildCurrentPage(isJefeVentas),
        ),
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          gradient: AppTheme.commandGradient,
          border: Border(
            top: BorderSide(
              color: AppTheme.activeRing.withValues(alpha: 0.16),
            ),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.42),
              blurRadius: 24,
              offset: const Offset(0, -10),
            ),
            BoxShadow(
              color: AppTheme.activeRing.withValues(alpha: 0.06),
              blurRadius: 28,
            ),
          ],
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                // Hamburger/avatar button to open drawer
                _buildBottomNavDrawerButton(user),
                // Nav items
                ...bottomItems.asMap().entries.map((entry) {
                  final idx = entry.key;
                  return Expanded(
                    child: _buildBottomNavItem(
                      item: entry.value,
                      isSelected: safeIndex == idx,
                      onTap: () => setState(() => _currentIndex = idx),
                    ),
                  );
                }),
                // "More" overflow button
                if (hasOverflow)
                  Expanded(
                    child: _buildBottomNavItem(
                      item: _NavItem(
                        icon: Icons.more_horiz,
                        selectedIcon: Icons.more_horiz,
                        label: 'Más',
                        color: AppTheme.textSecondary,
                      ),
                      isSelected: safeIndex >= maxBottomItems - 1,
                      onTap: () =>
                          _showOverflowMenu(navItems, maxBottomItems - 1),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _compactBottomLabel(String label) {
    switch (label) {
      case 'Expediciones':
        return 'Exped.';
      case 'Liquidacion Diaria':
      case 'Liquidación':
        return 'Liq. día';
      case 'Vencimientos':
        return 'Venc.';
      case 'Comisiones':
        return 'Comis.';
      default:
        return label;
    }
  }

  /// Bottom nav item for phone layout
  Widget _buildBottomNavItem({
    required _NavItem item,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
        margin: const EdgeInsets.symmetric(horizontal: 3, vertical: 5),
        padding: const EdgeInsets.fromLTRB(4, 5, 4, 6),
        decoration: BoxDecoration(
          gradient: isSelected
              ? LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    item.color.withValues(alpha: 0.24),
                    AppTheme.surfaceCommand,
                    item.color.withValues(alpha: 0.08),
                  ],
                  stops: const [0.0, 0.58, 1.0],
                )
              : null,
          color: isSelected ? null : Colors.transparent,
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(
            color: isSelected
                ? item.color.withValues(alpha: 0.48)
                : Colors.transparent,
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: item.color.withValues(alpha: 0.14),
                    blurRadius: 16,
                  ),
                ]
              : null,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 20,
              height: 2,
              decoration: BoxDecoration(
                color: isSelected ? item.color : Colors.transparent,
                boxShadow: isSelected
                    ? [
                        BoxShadow(
                          color: item.color.withValues(alpha: 0.32),
                          blurRadius: 8,
                        ),
                      ]
                    : null,
                borderRadius: BorderRadius.circular(AppTheme.radiusFull),
              ),
            ),
            const SizedBox(height: 5),
            Icon(
              isSelected ? item.selectedIcon : item.icon,
              color: isSelected ? item.color : AppTheme.textSecondary,
              size: 21,
            ),
            const SizedBox(height: 3),
            AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 180),
              style: TextStyle(
                fontSize: 9,
                color:
                    isSelected ? AppTheme.textPrimary : AppTheme.textSecondary,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
              child: Text(
                _compactBottomLabel(item.label),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Small avatar button at the left of the bottom nav to open drawer
  Widget _buildBottomNavDrawerButton(UserModel user) {
    return Builder(
      builder: (ctx) => GestureDetector(
        onTap: () => Scaffold.of(ctx).openDrawer(),
        behavior: HitTestBehavior.opaque,
        child: SizedBox(
          width: 48,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 26,
                height: 26,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppTheme.mutedPanel,
                  border: Border.all(
                    color: AppTheme.borderColor.withValues(alpha: 0.9),
                  ),
                ),
                child: Center(
                  child: Text(
                    user.name.isNotEmpty ? user.name[0].toUpperCase() : 'U',
                    style: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 2),
              const Icon(Icons.menu, color: AppTheme.textSecondary, size: 10),
            ],
          ),
        ),
      ),
    );
  }

  /// Overflow bottom sheet for nav items that don't fit in bottom bar
  void _showOverflowMenu(List<_NavItem> navItems, int startIndex) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.surfaceCommand,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(AppTheme.radiusLg),
        ),
        side: BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.72)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              margin: const EdgeInsets.only(top: 8, bottom: 12),
              width: 32,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.borderColor,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            ...navItems.sublist(startIndex).asMap().entries.map((entry) {
              final actualIndex = startIndex + entry.key;
              final item = entry.value;
              final isSelected = _currentIndex == actualIndex;
              return ListTile(
                selected: isSelected,
                selectedTileColor: AppTheme.softPanel.withValues(alpha: 0.72),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                ),
                leading: Icon(
                  isSelected ? item.selectedIcon : item.icon,
                  color: isSelected ? item.color : AppTheme.textSecondary,
                ),
                title: Text(
                  item.label,
                  style: TextStyle(
                    color: isSelected
                        ? AppTheme.textPrimary
                        : AppTheme.textSecondary,
                    fontWeight:
                        isSelected ? FontWeight.w600 : FontWeight.normal,
                  ),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  setState(() => _currentIndex = actualIndex);
                },
              );
            }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  /// Drawer for phone layout with user info, mode switcher, and actions
  Widget _buildPhoneDrawer(UserModel user, bool isJefeVentas) {
    return Drawer(
      backgroundColor: AppTheme.surfaceCommand,
      width: MediaQuery.of(context).size.width * 0.72,
      child: SafeArea(
        child: Column(
          children: [
            const SizedBox(height: 16),
            _buildUserAvatar(user, isJefeVentas),
            const SizedBox(height: 16),
            // Mode switcher in drawer for Jefe
            if (isJefeVentas) _buildModeSwitcher(),
            // Network settings removed for user restriction
            const Spacer(),
            const Divider(color: AppTheme.borderColor),
            ListTile(
              leading: const Icon(
                Icons.notifications_active_outlined,
                color: AppTheme.info,
                size: 20,
              ),
              title: const Text(
                'Avisos',
                style: TextStyle(color: AppTheme.textPrimary, fontSize: 13),
              ),
              onTap: () {
                Navigator.pop(context);
                _openNotificationSettings();
              },
            ),
            // Logout
            ListTile(
              leading: const Icon(
                Icons.logout_rounded,
                color: AppTheme.error,
                size: 20,
              ),
              title: const Text(
                'Cerrar Sesión',
                style: TextStyle(color: AppTheme.error, fontSize: 13),
              ),
              onTap: () async {
                final authState = ref.read(authProvider).value;
                Navigator.pop(context);
                await Future<void>.delayed(Duration.zero);
                if (!mounted || authState == null) return;
                await _showLogoutConfirmation(authState);
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // TABLET LAYOUT: Sidebar navigation for large screens
  // ---------------------------------------------------------------------------
  Widget _buildTabletLayout(
    List<_NavItem> navItems,
    int safeIndex,
    UserModel user,
    bool isJefeVentas,
  ) {
    final sidebarW = Responsive.sidebarWidth(context);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: DecoratedBox(
        decoration: AppTheme.appBackground(),
        child: SafeArea(
          child: Row(
            children: [
              // Sidebar Navigation
              AnimatedContainer(
                duration: const Duration(milliseconds: 250),
                curve: Curves.easeInOut,
                width: _isNavExpanded ? sidebarW : 0,
                child: _isNavExpanded
                    ? Container(
                        decoration: BoxDecoration(
                          gradient: AppTheme.commandGradient,
                          border: Border(
                            right: BorderSide(
                              color:
                                  AppTheme.activeRing.withValues(alpha: 0.16),
                            ),
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.40),
                              blurRadius: 24,
                              offset: const Offset(10, 0),
                            ),
                            BoxShadow(
                              color:
                                  AppTheme.activeRing.withValues(alpha: 0.05),
                              blurRadius: 28,
                            ),
                          ],
                        ),
                        child: Column(
                          children: [
                            const SizedBox(height: 16),
                            _buildUserAvatar(user, isJefeVentas),
                            const SizedBox(height: 16),

                            // Mode switcher for Jefe
                            if (isJefeVentas)
                              _buildModeSwitcher(compact: sidebarW < 128),

                            const SizedBox(height: 16),

                            Expanded(
                              child: ListView.builder(
                                padding:
                                    const EdgeInsets.symmetric(horizontal: 8),
                                itemCount: navItems.length,
                                itemBuilder: (context, index) {
                                  return Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: _buildNavItem(
                                      item: navItems[index],
                                      isSelected: safeIndex == index,
                                      onTap: () =>
                                          setState(() => _currentIndex = index),
                                    ),
                                  );
                                },
                              ),
                            ),

                            const Divider(
                              height: 1,
                              color: AppTheme.borderColor,
                            ),
                            Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                children: [
                                  _buildNotificationSettingsButton(),
                                  const SizedBox(height: 8),
                                  _buildCollapseButton(),
                                  const SizedBox(height: 8),
                                  _buildLogoutButton(),
                                ],
                              ),
                            ),
                          ],
                        ),
                      )
                    : null,
              ),

              // Expand button when sidebar is collapsed
              if (!_isNavExpanded)
                GestureDetector(
                  onTap: () => setState(() => _isNavExpanded = true),
                  child: Container(
                    width: 24,
                    decoration: BoxDecoration(
                      color: AppTheme.raisedSurface,
                      border: Border(
                        right: BorderSide(
                          color: AppTheme.borderColor.withValues(alpha: 0.72),
                        ),
                      ),
                    ),
                    child: Center(
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          vertical: 20,
                          horizontal: 4,
                        ),
                        decoration: BoxDecoration(
                          color: AppTheme.softPanel,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppTheme.borderColor),
                        ),
                        child: const Icon(
                          Icons.chevron_right_rounded,
                          color: AppTheme.textSecondary,
                          size: 16,
                        ),
                      ),
                    ),
                  ),
                ),

              // Main Content
              Expanded(
                child: _buildCurrentPage(isJefeVentas),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Mode switcher widget (used in both sidebar and drawer)
  Widget _buildModeSwitcher({bool compact = false}) {
    final activeColor = _forceAlmacenMode
        ? AppTheme.accentIndigo
        : _forceRepartidorMode
            ? AppTheme.warning
            : AppTheme.info;
    final modeIcon = _forceAlmacenMode
        ? Icons.warehouse_rounded
        : _forceRepartidorMode
            ? Icons.local_shipping
            : Icons.store;

    return Padding(
      padding: EdgeInsets.symmetric(horizontal: compact ? 0 : 12),
      child: Container(
        width: compact ? 48 : null,
        padding: EdgeInsets.symmetric(
          horizontal: compact ? 0 : 12,
          vertical: compact ? 8 : 4,
        ),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              activeColor.withValues(alpha: 0.22),
              AppTheme.surfaceCommand,
              activeColor.withValues(alpha: 0.06),
            ],
            stops: const [0.0, 0.58, 1.0],
          ),
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(color: activeColor.withValues(alpha: 0.42)),
          boxShadow: [
            BoxShadow(
              color: activeColor.withValues(alpha: 0.10),
              blurRadius: 18,
            ),
          ],
        ),
        child: PopupMenuButton<String>(
          tooltip: 'Cambiar Perfil',
          offset: const Offset(0, 40),
          color: AppTheme.raisedSurface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            side:
                BorderSide(color: AppTheme.borderColor.withValues(alpha: 0.8)),
          ),
          child: compact
              ? Icon(
                  modeIcon,
                  color: activeColor,
                  size: 20,
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      _forceAlmacenMode
                          ? Icons.warehouse_rounded
                          : _forceRepartidorMode
                              ? Icons.local_shipping
                              : Icons.store,
                      color: activeColor,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        _forceAlmacenMode
                            ? 'Almacén'
                            : _forceRepartidorMode
                                ? 'Reparto'
                                : 'Ventas',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: activeColor,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        softWrap: false,
                      ),
                    ),
                    const Icon(
                      Icons.arrow_drop_down,
                      color: AppTheme.textSecondary,
                      size: 18,
                    ),
                  ],
                ),
          itemBuilder: (context) => [
            const PopupMenuItem(
              value: 'VENTAS',
              child: Row(
                children: [
                  Icon(Icons.store, color: AppTheme.info, size: 18),
                  SizedBox(width: 12),
                  Text(
                    'Perfil Ventas',
                    style: TextStyle(color: AppTheme.textPrimary),
                  ),
                ],
              ),
            ),
            const PopupMenuItem(
              value: 'REPARTO',
              child: Row(
                children: [
                  Icon(Icons.local_shipping, color: AppTheme.warning, size: 18),
                  SizedBox(width: 12),
                  Text(
                    'Perfil Reparto',
                    style: TextStyle(color: AppTheme.textPrimary),
                  ),
                ],
              ),
            ),
            const PopupMenuItem(
              value: 'ALMACEN',
              child: Row(
                children: [
                  Icon(
                    Icons.inventory_2,
                    color: AppTheme.accentIndigo,
                    size: 18,
                  ),
                  SizedBox(width: 12),
                  Text(
                    'Perfil Almacén',
                    style: TextStyle(color: AppTheme.textPrimary),
                  ),
                ],
              ),
            ),
          ],
          onSelected: (value) {
            if (value == 'ALMACEN') {
              setState(() {
                _forceAlmacenMode = true;
                _forceRepartidorMode = false;
                _currentIndex = 0;
              });
              return;
            }
            final newMode = value == 'REPARTO';
            setState(() {
              _forceAlmacenMode = false;
              _forceRepartidorMode = newMode;
              _currentIndex = 0;
            });
          },
        ),
      ),
    );
  }

  Widget _buildUserAvatar(UserModel user, bool isJefeVentas) {
    final roleColor = isJefeVentas
        ? AppTheme.info
        : user.isRepartidor
            ? AppTheme.warning
            : AppTheme.success;
    final roleLabel = isJefeVentas
        ? 'JEFE'
        : user.isRepartidor
            ? 'REPARTIDOR'
            : 'COMERCIAL';

    return Column(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                roleColor.withValues(alpha: 0.22),
                AppTheme.surfaceCommand,
                roleColor.withValues(alpha: 0.08),
              ],
            ),
            border: Border.all(color: roleColor.withValues(alpha: 0.52)),
            boxShadow: [
              BoxShadow(
                color: roleColor.withValues(alpha: 0.14),
                blurRadius: 18,
              ),
            ],
          ),
          child: Center(
            child: Text(
              user.name.isNotEmpty ? user.name[0].toUpperCase() : 'U',
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        SizedBox(
          width: 72,
          child: Text(
            user.name.length > 16 ? user.name.substring(0, 16) : user.name,
            style: const TextStyle(
              fontSize: 10,
              color: AppTheme.textSecondary,
              fontWeight: FontWeight.w500,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            softWrap: false,
            textAlign: TextAlign.center,
          ),
        ),
        Container(
          margin: const EdgeInsets.only(top: 5),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.radiusFull),
            gradient: LinearGradient(
              colors: [
                roleColor.withValues(alpha: 0.20),
                roleColor.withValues(alpha: 0.07),
              ],
            ),
            border: Border.all(color: roleColor.withValues(alpha: 0.34)),
          ),
          child: Text(
            roleLabel,
            style: TextStyle(
              fontSize: roleLabel.length > 8 ? 7 : 8,
              color: roleColor,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildNavItem({
    required _NavItem item,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    final isSmall = Responsive.isSmall(context);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
        padding:
            EdgeInsets.symmetric(vertical: isSmall ? 8 : 12, horizontal: 4),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          gradient: isSelected
              ? LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    item.color.withValues(alpha: 0.22),
                    AppTheme.surfaceCommand,
                    item.color.withValues(alpha: 0.06),
                  ],
                  stops: const [0.0, 0.60, 1.0],
                )
              : null,
          color: isSelected ? null : Colors.transparent,
          border: Border.all(
            color: isSelected
                ? item.color.withValues(alpha: 0.48)
                : Colors.transparent,
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: item.color.withValues(alpha: 0.12),
                    blurRadius: 18,
                  ),
                ]
              : null,
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            if (isSelected)
              Positioned(
                left: 0,
                top: 8,
                bottom: 8,
                child: Container(
                  width: 3,
                  decoration: BoxDecoration(
                    color: item.color,
                    boxShadow: [
                      BoxShadow(
                        color: item.color.withValues(alpha: 0.34),
                        blurRadius: 9,
                      ),
                    ],
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  isSelected ? item.selectedIcon : item.icon,
                  color: isSelected ? item.color : AppTheme.textSecondary,
                  size: isSmall ? 20 : 24,
                ),
                const SizedBox(height: 4),
                AnimatedDefaultTextStyle(
                  duration: const Duration(milliseconds: 180),
                  style: TextStyle(
                    fontSize: isSmall ? 8 : 10,
                    color: isSelected
                        ? AppTheme.textPrimary
                        : AppTheme.textSecondary,
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                  ),
                  child: Text(
                    item.label,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLogoutButton() {
    return InkWell(
      onTap: () async {
        final authState = ref.read(authProvider).value;
        if (authState == null) return;
        await _showLogoutConfirmation(authState);
      },
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          color: AppTheme.error.withValues(alpha: 0.08),
          border: Border.all(color: AppTheme.error.withValues(alpha: 0.22)),
        ),
        child: const Column(
          children: [
            Icon(Icons.logout_rounded, color: AppTheme.error, size: 20),
            SizedBox(height: 4),
            Text(
              'Salir',
              style: TextStyle(
                fontSize: 10,
                color: AppTheme.error,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNetworkSettingsButton() {
    return InkWell(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const NetworkSettingsPage()),
      ),
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          color: AppTheme.softPanel,
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: const Column(
          children: [
            Icon(Icons.wifi, color: AppTheme.textSecondary, size: 20),
            SizedBox(height: 4),
            Text(
              'Red',
              style: TextStyle(
                fontSize: 10,
                color: AppTheme.textSecondary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _openNotificationSettings() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const NotificationSettingsPage()),
    );
  }

  Widget _buildNotificationSettingsButton() {
    return InkWell(
      onTap: _openNotificationSettings,
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          color: AppTheme.softPanel,
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: const Column(
          children: [
            Icon(
              Icons.notifications_active_outlined,
              color: AppTheme.info,
              size: 20,
            ),
            SizedBox(height: 4),
            Text(
              'Avisos',
              style: TextStyle(
                fontSize: 10,
                color: AppTheme.textSecondary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCollapseButton() {
    return InkWell(
      onTap: () => setState(() => _isNavExpanded = !_isNavExpanded),
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          color: AppTheme.softPanel,
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Column(
          children: [
            Icon(
              _isNavExpanded
                  ? Icons.chevron_left_rounded
                  : Icons.chevron_right_rounded,
              color: AppTheme.textSecondary,
              size: 20,
            ),
            const SizedBox(height: 4),
            Text(
              _isNavExpanded ? 'Ocultar' : '',
              style: const TextStyle(
                fontSize: 9,
                color: AppTheme.textSecondary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Header Dropdown Widget for Repartidor Mode
  Widget _buildRepartidorHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: Border(
          bottom: BorderSide(
            color: AppTheme.borderColor.withValues(alpha: 0.72),
          ),
        ),
      ),
      child: Row(
        children: [
          const Row(
            children: [
              Icon(Icons.visibility, color: AppTheme.info, size: 16),
              SizedBox(width: 8),
              Text(
                'Ver Como',
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: AppTheme.softPanel,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: _isLoadingRepartidores
                  ? const Center(
                      child: SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppTheme.info,
                        ),
                      ),
                    )
                  : DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: _selectedRepartidor,
                        hint: const Text(
                          'Seleccionar Repartidor',
                          style: TextStyle(color: AppTheme.textSecondary),
                        ),
                        isExpanded: true,
                        dropdownColor: AppTheme.raisedSurface,
                        icon: const Icon(
                          Icons.keyboard_arrow_down,
                          color: AppTheme.info,
                        ),
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 13,
                        ),
                        items: [
                          const DropdownMenuItem(
                            value: 'ALL',
                            child: Text(
                              'Todos los Repartidores',
                              style: TextStyle(fontWeight: FontWeight.bold),
                            ),
                          ),
                          ..._repartidoresOptions.map((r) {
                            return DropdownMenuItem(
                              value: r['code'].toString(),
                              child: Text('${r['code']} - ${r['name']}'),
                            );
                          }),
                        ],
                        onChanged: (val) =>
                            setState(() => _selectedRepartidor = val),
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCurrentPage(bool isJefeVentas) {
    final authState = ref.read(authProvider).value;
    final user = authState?.user;
    final vendedorCodes = authState?.vendedorCodes ?? [];

    // ===============================================
    // ALMACÉN MODE
    // ===============================================
    if (_isAlmacenEffective) {
      return LazyIndexedStack(
        index: _currentIndex,
        children: const [
          WarehouseDashboardPage(),
          VehiclesPage(),
          ArticlesPage(),
          LoadHistoryPage(),
          PersonnelPage(),
        ],
      );
    }

    final isRepartidor = _isRepartidorEffective;

    // ===============================================
    // REPARTIDOR MODE
    // ===============================================
    if (isRepartidor) {
      var effectiveRepartidorId =
          user?.codigoConductor ?? vendedorCodes.join(',');
      final isJefe = user?.isJefeVentas ?? false;

      if (isJefeVentas) {
        if (_selectedRepartidor == null || _selectedRepartidor == 'ALL') {
          if (_repartidoresOptions.isNotEmpty) {
            effectiveRepartidorId =
                _repartidoresOptions.map((e) => e['code']).join(',');
          } else {
            effectiveRepartidorId = vendedorCodes.join(',');
          }
        } else {
          effectiveRepartidorId = _selectedRepartidor!;
        }
      }

      final repNamesMap = <String, String>{
        for (final r in _repartidoresOptions)
          (r['code']?.toString() ?? ''): (r['name']?.toString() ?? ''),
      };

      final navItems = _getNavItems(isJefeVentas, vendedorCodes);

      int? navIndexOf(String label) {
        for (var i = 0; i < navItems.length; i++) {
          if (navItems[i].label == label) return i;
        }
        return null;
      }

      Widget pageForIndex(int idx) {
        final label = idx < navItems.length ? navItems[idx].label : '';

        if (label == 'Panel') {
          return RepartidorPanelPage(repartidorId: effectiveRepartidorId);
        }
        if (label == 'Clientes') {
          final histIdx = navIndexOf('Histórico');
          return RepartidorClientesPage(
            repartidorId: effectiveRepartidorId,
            isJefeMode: isJefe,
            onNavigateToHistory: (clientId, clientName) {
              setState(() {
                _pendingClientId = clientId;
                _pendingClientName = clientName;
                _currentIndex = histIdx ?? idx;
              });
            },
          );
        }
        if (label == 'Rutero') {
          return RepartidorRuteroPage(
            repartidorId: effectiveRepartidorId,
            repartidorNames: repNamesMap,
          );
        }
        if (label == 'Liquidacion Diaria' || label == 'Liquidación') {
          return RepartidorLiquidacionDiariaPage(
            repartidorId: effectiveRepartidorId,
          );
        }
        if (label == 'Vencimientos') {
          return RepartidorVencimientosPage(
            repartidorId: effectiveRepartidorId,
          );
        }
        if (label == 'Evolución') {
          return RepartidorEvolutionPage(
            repartidorId: effectiveRepartidorId,
          );
        }
        if (label == 'Comisiones') {
          return repartidor_finanzas.RepartidorComisionesFinanzasPage(
            repartidorId: effectiveRepartidorId,
          );
        }
        if (label == 'Histórico') {
          return RepartidorHistoricoPage(
            repartidorId: effectiveRepartidorId,
            initialClientId: _pendingClientId,
            initialClientName: _pendingClientName,
          );
        }
        if (label == 'Asistente') {
          return ChatbotPage(vendedorCodes: vendedorCodes);
        }
        return const Center(child: Text('Página no encontrada'));
      }

      final content = LazyIndexedStack(
        index: _currentIndex,
        children: List.generate(navItems.length, (idx) {
          return KeyedSubtree(
            key: ValueKey(
              'rutero_view_${effectiveRepartidorId}_${idx}_${_pendingClientId ?? ""}',
            ),
            child: pageForIndex(idx),
          );
        }),
      );

      if (isJefeVentas) {
        return Column(
          children: [
            _buildRepartidorHeader(),
            Expanded(child: content),
          ],
        );
      }
      return content;
    }

    // ===============================================
    // JEFE MODE
    // ===============================================
    if (isJefeVentas) {
      final vendedorCodes = ref.read(authProvider).value?.vendedorCodes ?? [];
      final employeeCode = vendedorCodes.join(',');
      return LazyIndexedStack(
        index: _currentIndex,
        children: [
          const DashboardContent(),
          SimpleClientListPage(employeeCode: employeeCode, isJefeVentas: true),
          RuteroPage(employeeCode: employeeCode, isJefeVentas: true),
          ObjectivesPage(employeeCode: employeeCode, isJefeVentas: true),
          CommissionsPage(employeeCode: employeeCode, isJefeVentas: true),
          const FacturasPage(),
          PedidosPage(employeeCode: employeeCode, isJefeVentas: true),
          KpiDashboardPage(employeeCode: employeeCode, isJefeVentas: true),
          CobrosPage(employeeCode: employeeCode, isJefeVentas: true),
          ComercialLiquidacionDiariaPage(
            employeeCode: employeeCode,
            isJefeVentas: true,
          ),
          const BolsaPage(),
          ClientEvolutionPage(
            employeeCode: employeeCode,
            isJefeVentas: true,
            forceShowVendorSelector: true,
          ),
          ChatbotPage(vendedorCodes: vendedorCodes),
        ],
      );
    }

    // ===============================================
    // COMERCIAL MODE
    // ===============================================

    // Commercial 80: scoped team from login (auth vendedorCodes), not JEFE_VENTAS
    final normalizedUserCode =
        (user?.code ?? '').replaceFirst(RegExp(r'^0+'), '');
    final isCommercial80 = normalizedUserCode == '80';
    final effectiveVendorCodes = vendedorCodes;

    final hasScopedVendorAccess =
        user != null && _hasScopedVendorAccess(user, effectiveVendorCodes);
    final scopedDefaultCode = hasScopedVendorAccess && user != null
        ? _defaultScopedVendor(user, effectiveVendorCodes)
        : '';
    final selectedScopedVendor =
        hasScopedVendorAccess ? ref.watch(selectedVendorProvider) : null;
    final isTeamAggregateView = isCommercial80 &&
        (selectedScopedVendor == null ||
            selectedScopedVendor.isEmpty ||
            selectedScopedVendor == 'ALL');
    final scopedEmployeeCode = hasScopedVendorAccess
        ? (selectedScopedVendor != null &&
                effectiveVendorCodes.contains(selectedScopedVendor)
            ? selectedScopedVendor
            : scopedDefaultCode)
        : null;
    final empCode = isTeamAggregateView
        ? effectiveVendorCodes.join(',')
        : (scopedEmployeeCode ?? effectiveVendorCodes.join(','));
    final apiAggregateCode = isTeamAggregateView ? 'ALL' : empCode;

    // Nav always COMERCIAL for 80; team aggregate only affects Objetivos/Comisiones API
    final comercialNav = _getNavItems(false, effectiveVendorCodes);

    Widget comercialPageForIndex(int idx) {
      final label = idx < comercialNav.length ? comercialNav[idx].label : '';
      switch (label) {
        case 'Clientes':
          return SimpleClientListPage(
            employeeCode: empCode,
            isJefeVentas: false,
            vendorSelectorCodes:
                hasScopedVendorAccess ? effectiveVendorCodes : null,
            includeAllVendorOption: isCommercial80 || !hasScopedVendorAccess,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Ruta':
          return RuteroPage(
            employeeCode: empCode,
            isJefeVentas: false,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Objetivos':
          return ObjectivesPage(
            employeeCode: apiAggregateCode,
            isJefeVentas: isTeamAggregateView,
            vendorSelectorCodes:
                hasScopedVendorAccess ? effectiveVendorCodes : null,
            includeAllVendorOption: isCommercial80 || !hasScopedVendorAccess,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Comisiones':
          return CommissionsPage(
            employeeCode: apiAggregateCode,
            isJefeVentas: isTeamAggregateView,
            vendorSelectorCodes:
                hasScopedVendorAccess ? effectiveVendorCodes : null,
            includeAllVendorOption: isCommercial80 || !hasScopedVendorAccess,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Facturas':
          return FacturasPage(
            employeeCode: empCode,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Pedidos':
          return PedidosPage(
            employeeCode: empCode,
            isJefeVentas: false,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Alertas':
          return KpiDashboardPage(
            employeeCode: empCode,
            isJefeVentas: false,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Cobros':
          return CobrosPage(
            employeeCode: empCode,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Liquidación':
          return ComercialLiquidacionDiariaPage(
            employeeCode: empCode,
            isJefeVentas: isTeamAggregateView,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Bolsa':
          return BolsaPage(forceShowVendorSelector: isCommercial80);
        case 'Evolución':
          return ClientEvolutionPage(
            employeeCode: apiAggregateCode,
            isJefeVentas: isTeamAggregateView,
            vendorSelectorCodes:
                hasScopedVendorAccess ? effectiveVendorCodes : null,
            includeAllVendorOption: isCommercial80 || !hasScopedVendorAccess,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Asistente':
          return ChatbotPage(vendedorCodes: effectiveVendorCodes);
        default:
          return const Center(child: Text('Página no encontrada'));
      }
    }

    return LazyIndexedStack(
      index: _currentIndex,
      children: List.generate(
        comercialNav.length,
        comercialPageForIndex,
      ),
    );
  }
}

// Helper class for nav items
class _NavItem {
  _NavItem({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.color,
  });
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final Color color;
}

// Logout confirmation dialog
class _LogoutConfirmationDialog extends StatelessWidget {
  const _LogoutConfirmationDialog({required this.userName});
  final String userName;

  @override
  Widget build(BuildContext context) {
    // Responsive dialog sizing
    final dw = Responsive.dialogWidth(context, 340);
    final dp = Responsive.padding(context, small: 20, large: 28);
    final iconDim = Responsive.value(context, phone: 52, desktop: 72);
    final titleFs = Responsive.fontSize(context, small: 18, large: 22);

    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: dw,
        padding: EdgeInsets.all(dp),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          borderRadius: BorderRadius.circular(AppTheme.radiusXl),
          border: Border.all(
            color: AppTheme.borderColor.withValues(alpha: 0.84),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.34),
              blurRadius: 24,
              offset: const Offset(0, 14),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: iconDim,
              height: iconDim,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTheme.error.withValues(alpha: 0.15),
                border:
                    Border.all(color: AppTheme.error.withValues(alpha: 0.3)),
              ),
              child: Icon(
                Icons.logout_rounded,
                color: AppTheme.error,
                size: iconDim * 0.44,
              ),
            ),

            const SizedBox(height: 24),

            // Title (responsive)
            Text(
              '¿Cerrar Sesión?',
              style: TextStyle(
                fontSize: titleFs,
                fontWeight: FontWeight.w600,
                color: AppTheme.textPrimary,
              ),
            ),

            const SizedBox(height: 12),

            // Message
            Text(
              'Estás a punto de salir de tu cuenta, $userName. ¿Estás seguro?',
              style: TextStyle(
                fontSize: 14,
                color: AppTheme.textSecondary.withValues(alpha: 0.8),
                height: 1.5,
              ),
              textAlign: TextAlign.center,
            ),

            const SizedBox(height: 32),

            // Buttons
            Row(
              children: [
                // Cancel Button
                Expanded(
                  child: TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                        side: BorderSide(
                          color: AppTheme.borderColor.withValues(alpha: 0.8),
                        ),
                      ),
                    ),
                    child: const Text(
                      'Cancelar',
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ),

                const SizedBox(width: 12),

                // Confirm Button
                Expanded(
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(14),
                      color: AppTheme.error,
                    ),
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: () => Navigator.pop(context, true),
                        borderRadius: BorderRadius.circular(14),
                        child: const Padding(
                          padding: EdgeInsets.symmetric(vertical: 14),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.logout_rounded,
                                color: Colors.white,
                                size: 18,
                              ),
                              SizedBox(width: 8),
                              Text(
                                'Salir',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w600,
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
          ],
        ),
      ),
    );
  }
}
