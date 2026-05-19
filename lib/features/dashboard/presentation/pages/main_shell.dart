import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/services/navigation_config_service.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/coming_soon_placeholder.dart';
import 'package:gmp_app_mobilidad/core/widgets/lazy_indexed_stack.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/clients/presentation/pages/simple_client_list_page.dart';
import 'package:gmp_app_mobilidad/features/cobros/presentation/pages/cobros_page.dart';
import 'package:gmp_app_mobilidad/features/commissions/presentation/pages/commissions_page.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/pages/dashboard_content.dart';
import 'package:gmp_app_mobilidad/features/facturas/presentation/pages/facturas_page.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/presentation/pages/kpi_dashboard_page.dart';
import 'package:gmp_app_mobilidad/features/objectives/presentation/pages/objectives_page.dart';
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
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/articles_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/load_history_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/personnel_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/vehicles_page.dart';
import 'package:gmp_app_mobilidad/features/warehouse/presentation/pages/warehouse_dashboard_page.dart';
import 'package:url_launcher/url_launcher.dart';

/// Main app shell with navigation rail for tablet mode
/// Panel de Control (Dashboard) is only visible for Jefe de Ventas
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
    final normalizedCode = (user?.code ?? '').replaceFirst(RegExp(r'^0+'), '');
    if (normalizedCode == '80' && vendorCodes.length > 1) return true;
    return !user.isJefeVentas && vendorCodes.length > 1;
  }

  String _defaultScopedVendor(UserModel user, List<String> vendorCodes) {
    // Commercial 80 (Almeria lead) defaults to ALL team members
    final normalizedCode = (user.code ?? '').replaceFirst(RegExp(r'^0+'), '');
    if (normalizedCode == '80') return 'ALL';
    final ownCode = user.vendedorCode ?? user.code ?? '';
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
              color: Colors.white,
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
                style: const TextStyle(color: Colors.white70),
              ),
              if (isMandatory) ...[
                const SizedBox(height: 16),
                const Text(
                  'Esta actualización es necesaria para garantizar la integridad de los datos y el correcto funcionamiento.',
                  style: TextStyle(
                    color: Colors.orange,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ],
          ),
          backgroundColor: AppTheme.darkCard,
          actions: [
            if (!isMandatory)
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text(
                  'MÁS TARDE',
                  style: TextStyle(color: Colors.white54),
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
                backgroundColor: AppTheme.neonBlue,
                foregroundColor: Colors.black,
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

  // Show futuristic logout confirmation modal
  Future<void> _showLogoutConfirmation(AuthState authState) async {
    final shouldLogout = await showDialog<bool>(
      context: context,
      barrierColor: Colors.black54,
      builder: (context) => _LogoutConfirmationDialog(
        userName: authState.user?.name ?? 'Usuario',
      ),
    );

    if (shouldLogout ?? false) {
      ProviderScope.containerOf(context).read(authProvider.notifier).logout();
    }
  }

  Future<void> _fetchRepartidores() async {
    setState(() => _isLoadingRepartidores = true);
    try {
      debugPrint('[MainShell] _fetchRepartidores: calling API...');
      final res = await ApiClient.getList('/auth/repartidores');
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
    final showCommissions = authState?.user?.showCommissions ?? false;

    final navItems = NavigationConfigService.getNavItems(
      isAlmacen: _isAlmacenEffective,
      isRepartidor: _isRepartidorEffective,
      isJefeVentas: isJefeVentas,
      showCommissions: showCommissions,
    );

    return navItems
        .map(
          (item) => _NavItem(
            icon: item.icon,
            selectedIcon: item.selectedIcon,
            label: item.label,
            color: item.color,
          ),
        )
        .toList();
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
    final navItems = _getNavItems(isJefeVentas, vendedorCodes);
    final safeIndex = _currentIndex.clamp(0, navItems.length - 1);
    final useBottomNav = Responsive.useBottomNav(context);

    if (useBottomNav) {
      return _buildPhoneLayout(navItems, safeIndex, user, isJefeVentas);
    }
    return _buildTabletLayout(navItems, safeIndex, user, isJefeVentas);
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
      body: SafeArea(
        child: _buildCurrentPage(isJefeVentas),
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          border:
              Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.05))),
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

  /// Bottom nav item for phone layout
  Widget _buildBottomNavItem({
    required _NavItem item,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedScale(
              scale: isSelected ? 1.15 : 1.0,
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOutCubic,
              child: Icon(
                isSelected ? item.selectedIcon : item.icon,
                color: isSelected ? item.color : AppTheme.textSecondary,
                size: 22,
              ),
            ),
            const SizedBox(height: 2),
            AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 200),
              style: TextStyle(
                fontSize: 9,
                color: isSelected ? item.color : AppTheme.textSecondary,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
              child: Text(
                item.label,
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
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: [AppTheme.neonBlue, AppTheme.neonPurple],
                  ),
                ),
                child: Center(
                  child: Text(
                    user.name.isNotEmpty ? user.name[0].toUpperCase() : 'U',
                    style: const TextStyle(
                      color: Colors.white,
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
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
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
                color: Colors.white24,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            ...navItems.sublist(startIndex).asMap().entries.map((entry) {
              final actualIndex = startIndex + entry.key;
              final item = entry.value;
              final isSelected = _currentIndex == actualIndex;
              return ListTile(
                leading: Icon(
                  isSelected ? item.selectedIcon : item.icon,
                  color: isSelected ? item.color : AppTheme.textSecondary,
                ),
                title: Text(
                  item.label,
                  style: TextStyle(
                    color: isSelected ? item.color : Colors.white,
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
      backgroundColor: AppTheme.surfaceColor,
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
            const Divider(color: Colors.white10),
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
              onTap: () {
                Navigator.pop(context);
                ref.read(authProvider.notifier).logout();
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // TABLET LAYOUT: Sidebar (original design, identical on large screens)
  // ---------------------------------------------------------------------------
  Widget _buildTabletLayout(
    List<_NavItem> navItems,
    int safeIndex,
    UserModel user,
    bool isJefeVentas,
  ) {
    final sidebarW = Responsive.sidebarWidth(context);

    return Scaffold(
      body: SafeArea(
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
                        color: AppTheme.surfaceColor,
                        border: Border(
                          right: BorderSide(
                            color: Colors.white.withValues(alpha: 0.05),
                          ),
                        ),
                      ),
                      child: Column(
                        children: [
                          const SizedBox(height: 16),
                          _buildUserAvatar(user, isJefeVentas),
                          const SizedBox(height: 16),

                          // Mode switcher for Jefe
                          if (isJefeVentas) _buildModeSwitcher(),

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

                          const Divider(height: 1, color: Colors.white10),
                          Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              children: [
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
                    color: AppTheme.surfaceColor,
                    border: Border(
                      right: BorderSide(
                        color: Colors.white.withValues(alpha: 0.05),
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
                        color: AppTheme.neonBlue.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(
                        Icons.chevron_right_rounded,
                        color: AppTheme.neonBlue,
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
    );
  }

  /// Mode switcher widget (used in both sidebar and drawer)
  Widget _buildModeSwitcher() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(
          color: _forceAlmacenMode
              ? AppTheme.neonPink.withValues(alpha: 0.1)
              : _forceRepartidorMode
                  ? Colors.orange.withValues(alpha: 0.1)
                  : AppTheme.neonBlue.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(
            color: _forceAlmacenMode
                ? AppTheme.neonPink.withValues(alpha: 0.3)
                : _forceRepartidorMode
                    ? Colors.orange.withValues(alpha: 0.3)
                    : AppTheme.neonBlue.withValues(alpha: 0.3),
          ),
        ),
        child: PopupMenuButton<String>(
          tooltip: 'Cambiar Perfil',
          offset: const Offset(0, 40),
          color: AppTheme.surfaceColor,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                _forceAlmacenMode
                    ? Icons.warehouse_rounded
                    : _forceRepartidorMode
                        ? Icons.local_shipping
                        : Icons.store,
                color: _forceAlmacenMode
                    ? AppTheme.neonPink
                    : _forceRepartidorMode
                        ? Colors.orange
                        : AppTheme.neonBlue,
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
                    color: _forceAlmacenMode
                        ? AppTheme.neonPink
                        : _forceRepartidorMode
                            ? Colors.orange
                            : AppTheme.neonBlue,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const Icon(
                Icons.arrow_drop_down,
                color: Colors.white54,
                size: 18,
              ),
            ],
          ),
          itemBuilder: (context) => [
            const PopupMenuItem(
              value: 'VENTAS',
              child: Row(
                children: [
                  Icon(Icons.store, color: AppTheme.neonBlue, size: 18),
                  SizedBox(width: 12),
                  Text('Perfil Ventas', style: TextStyle(color: Colors.white)),
                ],
              ),
            ),
            const PopupMenuItem(
              value: 'REPARTO',
              child: Row(
                children: [
                  Icon(Icons.local_shipping, color: Colors.orange, size: 18),
                  SizedBox(width: 12),
                  Text('Perfil Reparto', style: TextStyle(color: Colors.white)),
                ],
              ),
            ),
            const PopupMenuItem(
              value: 'ALMACEN',
              child: Row(
                children: [
                  Icon(Icons.inventory_2, color: AppTheme.neonPink, size: 18),
                  SizedBox(width: 12),
                  Text('Perfil Almacén', style: TextStyle(color: Colors.white)),
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
              colors: isJefeVentas
                  ? [AppTheme.neonBlue, AppTheme.neonPurple]
                  : [AppTheme.neonGreen, AppTheme.neonBlue],
            ),
            boxShadow: [
              BoxShadow(
                color: (isJefeVentas ? AppTheme.neonBlue : AppTheme.neonGreen)
                    .withValues(alpha: 0.3),
                blurRadius: 12,
                spreadRadius: 2,
              ),
            ],
          ),
          child: Center(
            child: Text(
              user.name.isNotEmpty ? user.name[0].toUpperCase() : 'U',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          user.name.length > 16 ? user.name.substring(0, 16) : user.name,
          style: const TextStyle(fontSize: 9, color: AppTheme.textSecondary),
          maxLines: 1,
          textAlign: TextAlign.center,
        ),
        if (isJefeVentas)
          Container(
            margin: const EdgeInsets.only(top: 4),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              color: AppTheme.neonBlue.withValues(alpha: 0.2),
            ),
            child: const Text(
              'JEFE',
              style: TextStyle(
                fontSize: 8,
                color: AppTheme.neonBlue,
                fontWeight: FontWeight.bold,
              ),
            ),
          )
        else if (user.isRepartidor)
          Container(
            margin: const EdgeInsets.only(top: 4),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              color: Colors.orange.withValues(alpha: 0.2),
            ),
            child: const Text(
              'REPARTIDOR',
              style: TextStyle(
                fontSize: 8,
                color: Colors.orange,
                fontWeight: FontWeight.bold,
              ),
            ),
          )
        else
          Container(
            margin: const EdgeInsets.only(top: 4),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              color: AppTheme.neonGreen.withValues(alpha: 0.2),
            ),
            child: const Text(
              'COMERCIAL',
              style: TextStyle(
                fontSize: 7,
                color: AppTheme.neonGreen,
                fontWeight: FontWeight.bold,
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
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOutCubic,
        padding:
            EdgeInsets.symmetric(vertical: isSmall ? 8 : 12, horizontal: 4),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          color: isSelected ? item.color.withValues(alpha: 0.12) : Colors.transparent,
          border: isSelected
              ? Border.all(color: item.color.withValues(alpha: 0.25))
              : null,
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: item.color.withValues(alpha: 0.08),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ]
              : [],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedScale(
              scale: isSelected ? 1.1 : 1.0,
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOutCubic,
              child: Icon(
                isSelected ? item.selectedIcon : item.icon,
                color: isSelected ? item.color : AppTheme.textSecondary,
                size: isSmall ? 20 : 24,
              ),
            ),
            const SizedBox(height: 4),
            AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 200),
              style: TextStyle(
                fontSize: isSmall ? 8 : 10,
                color: isSelected ? item.color : AppTheme.textSecondary,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
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
      ),
    );
  }

  Widget _buildLogoutButton() {
    return InkWell(
      onTap: () => ref.read(authProvider.notifier).logout(),
      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          color: AppTheme.error.withValues(alpha: 0.08),
          border: Border.all(color: AppTheme.error.withValues(alpha: 0.15)),
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
          color: AppTheme.neonPurple.withValues(alpha: 0.08),
          border: Border.all(color: AppTheme.neonPurple.withValues(alpha: 0.15)),
        ),
        child: const Column(
          children: [
            Icon(Icons.wifi, color: AppTheme.neonPurple, size: 20),
            SizedBox(height: 4),
            Text(
              'Red',
              style: TextStyle(
                fontSize: 10,
                color: AppTheme.neonPurple,
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
          color: AppTheme.neonBlue.withValues(alpha: 0.08),
          border: Border.all(color: AppTheme.neonBlue.withValues(alpha: 0.15)),
        ),
        child: Column(
          children: [
            Icon(
              _isNavExpanded
                  ? Icons.chevron_left_rounded
                  : Icons.chevron_right_rounded,
              color: AppTheme.neonBlue,
              size: 20,
            ),
            const SizedBox(height: 4),
            Text(
              _isNavExpanded ? 'Ocultar' : '',
              style: const TextStyle(
                fontSize: 9,
                color: AppTheme.neonBlue,
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
        color: AppTheme.surfaceColor,
        border:
            Border(bottom: BorderSide(color: Colors.white.withValues(alpha: 0.05))),
      ),
      child: Row(
        children: [
          const Row(
            children: [
              Icon(Icons.visibility, color: AppTheme.neonBlue, size: 16),
              SizedBox(width: 8),
              Text(
                'Ver Como',
                style: TextStyle(
                  color: Colors.white70,
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
                color: Colors.white.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.neonPurple.withValues(alpha: 0.3)),
              ),
              child: _isLoadingRepartidores
                  ? const Center(
                      child: SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppTheme.neonPurple,
                        ),
                      ),
                    )
                  : DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: _selectedRepartidor,
                        hint: const Text(
                          'Seleccionar Repartidor',
                          style: TextStyle(color: Colors.white54),
                        ),
                        isExpanded: true,
                        dropdownColor: AppTheme.surfaceColor,
                        icon: const Icon(
                          Icons.keyboard_arrow_down,
                          color: AppTheme.neonPurple,
                        ),
                        style:
                            const TextStyle(color: Colors.white, fontSize: 13),
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
        if (label == 'Liquidacion Diaria') {
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
        if (label == 'Chat IA') {
          return const ComingSoonPlaceholder(
            title: 'Asistente IA de Reparto',
            subtitle:
                'Tu asistente inteligente para\noptimizar rutas y consultar datos.',
            icon: Icons.smart_toy,
            accentColor: AppTheme.neonPink,
          );
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
          const BolsaPage(),
          const ComingSoonPlaceholder(
            title: 'Nexus AI – Asistente Comercial',
            subtitle:
                'Tu asistente inteligente para\nconsultar márgenes, precios, deudas\ny mucho más.',
            icon: Icons.smart_toy,
            accentColor: AppTheme.neonPink,
          ),
        ],
      );
    }

    // ===============================================
    // COMERCIAL MODE
    // ===============================================

    // Commercial 80 (Almeria lead) gets team view access
    const commercial80TeamCodes = ['72', '73', '80', '81', '83', '86'];
    final normalizedUserCode = (user?.code ?? '').replaceFirst(RegExp(r'^0+'), '');
    final isCommercial80 = normalizedUserCode == '80';

    // For commercial 80: extend vendedorCodes to include team members
    final effectiveVendorCodes = isCommercial80
        ? {...vendedorCodes, ...commercial80TeamCodes}.toList()
        : vendedorCodes;

    final hasScopedVendorAccess =
        user != null && _hasScopedVendorAccess(user, effectiveVendorCodes);
    final scopedDefaultCode = hasScopedVendorAccess && user != null
        ? _defaultScopedVendor(user, effectiveVendorCodes)
        : '';
    final selectedScopedVendor =
        hasScopedVendorAccess ? ref.watch(selectedVendorProvider) : null;
    final scopedEmployeeCode = hasScopedVendorAccess
        ? (selectedScopedVendor != null &&
                effectiveVendorCodes.contains(selectedScopedVendor)
            ? selectedScopedVendor
            : scopedDefaultCode)
        : null;
    final empCode = scopedEmployeeCode ?? effectiveVendorCodes.join(',');

    // For commercial 80: when "ALL" is selected, treat as jefe-like view
    final isCommercial80AllMode = isCommercial80 &&
        (selectedScopedVendor == null ||
            selectedScopedVendor.isEmpty ||
            selectedScopedVendor == 'ALL');
    final comercialNav = _getNavItems(isCommercial80AllMode, effectiveVendorCodes);

    Widget comercialPageForIndex(int idx) {
      final label = idx < comercialNav.length ? comercialNav[idx].label : '';
      switch (label) {
        case 'Clientes':
          return SimpleClientListPage(
            employeeCode: empCode,
            isJefeVentas: isCommercial80AllMode || hasScopedVendorAccess,
            vendorSelectorCodes: (isCommercial80AllMode || hasScopedVendorAccess)
                ? effectiveVendorCodes
                : null,
            includeAllVendorOption: !hasScopedVendorAccess,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Ruta':
          return RuteroPage(
            employeeCode: empCode,
            isJefeVentas: isCommercial80AllMode,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Objetivos':
          return ObjectivesPage(
            employeeCode: empCode,
            isJefeVentas: isCommercial80AllMode || hasScopedVendorAccess,
            vendorSelectorCodes: (isCommercial80AllMode || hasScopedVendorAccess)
                ? effectiveVendorCodes
                : null,
            includeAllVendorOption: !hasScopedVendorAccess,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Comisiones':
          return CommissionsPage(
            employeeCode: empCode,
            isJefeVentas: isCommercial80AllMode || hasScopedVendorAccess,
            vendorSelectorCodes: (isCommercial80AllMode || hasScopedVendorAccess)
                ? effectiveVendorCodes
                : null,
            includeAllVendorOption: !hasScopedVendorAccess,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Facturas':
          return FacturasPage(
            forceShowVendorSelector: isCommercial80,
          );
        case 'Pedidos':
          return PedidosPage(
            employeeCode: empCode,
            isJefeVentas: isCommercial80AllMode,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Glacius':
          return KpiDashboardPage(
            employeeCode: empCode,
            isJefeVentas: isCommercial80AllMode,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Cobros':
          return CobrosPage(
            employeeCode: empCode,
            forceShowVendorSelector: isCommercial80,
          );
        case 'Bolsa':
          return const BolsaPage();
        case 'Chat IA':
          return const ComingSoonPlaceholder(
            title: 'Nexus AI — Asistente Comercial',
            subtitle:
                'Tu asistente inteligente para\nconsultar márgenes, precios, deudas\ny mucho más.',
            icon: Icons.smart_toy,
            accentColor: AppTheme.neonPink,
          );
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

// Futuristic Logout Confirmation Dialog
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
          borderRadius: BorderRadius.circular(24),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppTheme.surfaceColor,
              AppTheme.darkBase.withValues(alpha: 0.95),
            ],
          ),
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.08),
            width: 1.5,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.5),
              blurRadius: 40,
              spreadRadius: 10,
            ),
            BoxShadow(
              color: AppTheme.error.withValues(alpha: 0.1),
              blurRadius: 30,
              spreadRadius: -5,
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Icon with glow effect (responsive)
            Container(
              width: iconDim,
              height: iconDim,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTheme.error.withValues(alpha: 0.15),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.error.withValues(alpha: 0.3),
                    blurRadius: 20,
                    spreadRadius: 2,
                  ),
                ],
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
                        side: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
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
                      gradient: const LinearGradient(
                        colors: [AppTheme.error, Color(0xFFB71C1C)],
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.error.withValues(alpha: 0.4),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ],
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
