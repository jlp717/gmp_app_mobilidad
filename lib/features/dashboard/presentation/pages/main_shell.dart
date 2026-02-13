import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/providers/auth_provider.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/providers/dashboard_provider.dart';
import '../../../clients/presentation/pages/simple_client_list_page.dart';
import '../../../rutero/presentation/pages/rutero_page.dart';
import '../../../objectives/presentation/pages/objectives_page.dart';
import '../../../chatbot/presentation/pages/chatbot_page.dart';
import '../../../commissions/presentation/pages/commissions_page.dart';
import '../../../cobros/presentation/pages/cobros_page.dart';
import '../../../settings/presentation/pages/network_settings_page.dart';
import '../../../entregas/presentation/pages/entregas_page.dart';
import '../../../entregas/providers/entregas_provider.dart';
import '../../../repartidor/presentation/pages/repartidor_rutero_page.dart';
import '../../../repartidor/presentation/pages/repartidor_comisiones_page.dart';
import '../../../repartidor/presentation/pages/repartidor_historico_page.dart';
import '../../../facturas/presentation/pages/facturas_page.dart';
import 'dashboard_content.dart';

/// Main app shell with navigation rail for tablet mode
/// Panel de Control (Dashboard) is only visible for Jefe de Ventas
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _currentIndex = 0;
  DashboardProvider? _dashboardProvider;
  bool _isNavExpanded = true; 
  
  // State for Jefe Repartidor View
  String? _selectedRepartidor = 'ALL';
  List<Map<String, dynamic>> _repartidoresOptions = [];
  bool _isLoadingRepartidores = false;
  
  // Toggle state
  bool _forceRepartidorMode = false;

  @override
  void initState() {
    super.initState();
    // Verify connection on startup
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkConnection();
      _checkForUpdates();
      
      // Init mode based on real user role
      final auth = context.read<AuthProvider>();
      if (auth.currentUser?.isRepartidor == true) {
         _forceRepartidorMode = true;
      }
    });
  }

  // Helper to determine effective mode
  bool get _isRepartidorEffective {
     final authProvider = Provider.of<AuthProvider>(context, listen: false);
     final user = authProvider.currentUser;
     if (user?.isRepartidor == true) return true; // Always true for real drivers
     return _forceRepartidorMode; // Toggleable for Jefe
  }

  void _checkForUpdates() {
    final auth = context.read<AuthProvider>();
    if (!auth.updateAvailable) return;

    final bool isMandatory = auth.isMandatoryUpdate;

    showDialog(
      context: context,
      barrierDismissible: !isMandatory,
      builder: (context) => WillPopScope(
        onWillPop: () async => !isMandatory,
        child: AlertDialog(
          title: Text(
            isMandatory ? 'Actualización Obligatoria' : 'Actualización Disponible',
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 20),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                auth.updateMessage.isNotEmpty ? auth.updateMessage : 'Hay una nueva versión de la app con mejoras críticas.',
                style: const TextStyle(color: Colors.white70),
              ),
              if (isMandatory) ...[
                const SizedBox(height: 16),
                const Text(
                  'Esta actualización es necesaria para garantizar la integridad de los datos y el correcto funcionamiento.',
                  style: TextStyle(color: Colors.orange, fontSize: 12, fontWeight: FontWeight.bold),
                ),
              ],
            ],
          ),
          backgroundColor: AppTheme.darkCard,
          actions: [
            if (!isMandatory)
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('MÁS TARDE', style: TextStyle(color: Colors.white54)),
              )
            else
              TextButton(
                onPressed: () => SystemNavigator.pop(),
                child: const Text('CERRAR APP', style: TextStyle(color: AppTheme.error)),
              ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.neonBlue,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              onPressed: () {
                launchUrl(
                  Uri.parse(auth.playStoreUrl),
                  mode: LaunchMode.externalApplication,
                );
              },
              child: const Text('ACTUALIZAR AHORA', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _checkConnection() async {
    final authProvider = context.read<AuthProvider>();
      if (authProvider.currentUser != null) {
        final now = DateTime.now();
        
        // Only create dashboard provider for Jefe de Ventas
        if (authProvider.currentUser!.isJefeVentas) {
          setState(() {
            _dashboardProvider = DashboardProvider(
              authProvider.vendedorCodes,
              isJefeVentas: true,
              year: now.year,
              month: now.month,
            );
            _dashboardProvider!.fetchDashboardData();
          });
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
  Future<void> _showLogoutConfirmation(AuthProvider authProvider) async {
    final shouldLogout = await showDialog<bool>(
      context: context,
      barrierColor: Colors.black54,
      builder: (context) => _LogoutConfirmationDialog(
        userName: authProvider.currentUser?.name ?? 'Usuario',
      ),
    );
    
    if (shouldLogout == true) {
      authProvider.logout();
    }
  }

  Future<void> _fetchRepartidores() async {
      setState(() => _isLoadingRepartidores = true);
      try {
        final res = await ApiClient.getList('/auth/repartidores');
        if (!mounted) return;
        setState(() {
           // Helper to safely get value regardless of case
           String? getValue(Map m, String key) {
             if (m.containsKey(key)) return m[key]?.toString();
             if (m.containsKey(key.toUpperCase())) return m[key.toUpperCase()]?.toString();
             if (m.containsKey(key.toLowerCase())) return m[key.toLowerCase()]?.toString();
             return null;
           }

           _repartidoresOptions = res.map((item) {
              final m = item as Map;
              return {
                 'code': getValue(m, 'code') ?? getValue(m, 'CODIGOVENDEDOR') ?? '',
                 'name': getValue(m, 'name') ?? getValue(m, 'NOMBREVENDEDOR') ?? 'Desconocido',
              };
           }).where((item) => item['code'] != null && item['code'].toString().isNotEmpty).toList();
           
           // Sort by code ascending
           _repartidoresOptions.sort((a, b) => 
             (a['code']?.toString() ?? '').compareTo(b['code']?.toString() ?? ''));
           
           _isLoadingRepartidores = false;
        });
      } catch (e) {
        debugPrint('Error fetching repartidores: $e');
        if (mounted) setState(() => _isLoadingRepartidores = false);
      }
  }

  // Get navigation destinations based on user role
  List<_NavItem> _getNavItems(bool isJefeVentas, List<String> vendorCodes) {
    final items = <_NavItem>[];
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    final user = authProvider.currentUser;
    
    // Check EFFECTIVE role
    final isRepartidor = _isRepartidorEffective;
    
    // ===============================================
    // REPARTIDOR MODE
    // ===============================================
    if (isRepartidor) {
      items.add(_NavItem(
        icon: Icons.route_outlined,
        selectedIcon: Icons.route,
        label: 'Rutero',
        color: AppTheme.neonBlue,
      ));
      items.add(_NavItem(
        icon: Icons.euro_outlined,
        selectedIcon: Icons.euro,
        label: 'Comisiones',
        color: AppTheme.neonGreen,
      ));
      items.add(_NavItem(
        icon: Icons.history_outlined,
        selectedIcon: Icons.history,
        label: 'Histórico',
        color: AppTheme.neonPurple,
      ));
      items.add(_NavItem(
        icon: Icons.smart_toy_outlined,
        selectedIcon: Icons.smart_toy,
        label: 'Chat IA',
        color: AppTheme.neonPink,
      ));
      return items;
    }
    
    // ===============================================
    // SALES MODE (Jefe / Comercial)
    // ===============================================
    if (isJefeVentas) {
      items.add(_NavItem(
        icon: Icons.dashboard_outlined,
        selectedIcon: Icons.dashboard,
        label: 'Panel',
        color: AppTheme.neonBlue,
      ));
    }
    items.add(_NavItem(
      icon: Icons.people_outline,
      selectedIcon: Icons.people,
      label: 'Clientes',
      color: AppTheme.neonGreen,
    ));
    items.add(_NavItem(
      icon: Icons.route_outlined,
      selectedIcon: Icons.route,
      label: 'Ruta',
      color: AppTheme.neonPurple,
    ));
    items.add(_NavItem(
      icon: Icons.track_changes_outlined,
      selectedIcon: Icons.track_changes,
      label: 'Objetivos',
      color: Colors.orange,
    ));
    
    // Comisiones tab always visible for all sales roles (Jefe + Comercial)
    items.add(_NavItem(
      icon: Icons.euro_outlined,
      selectedIcon: Icons.euro,
      label: 'Comisiones',
      color: AppTheme.neonGreen,
    ));
    
    items.add(_NavItem(
      icon: Icons.receipt_long_outlined,
      selectedIcon: Icons.receipt_long,
      label: 'Facturas',
      color: Colors.teal,
    ));
    
    items.add(_NavItem(
      icon: Icons.smart_toy_outlined,
      selectedIcon: Icons.smart_toy,
      label: 'Chat IA',
      color: AppTheme.neonPink,
    ));
    
    return items;
  }

  List<Map<String, String>> _getRepartidores(List<String> codes) {
     return [
       {'code': 'ALL', 'name': 'Todos los Repartidores'},
       ...codes.map((c) => {'code': c, 'name': 'Repartidor $c'}),
     ];
  }


  @override
  Widget build(BuildContext context) {
    final authProvider = context.watch<AuthProvider>();
    final user = authProvider.currentUser;

    if (user == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final isJefeVentas = user.isJefeVentas; 
    // Init default selection for Jefe in Repartidor Mode
    if (_forceRepartidorMode && isJefeVentas && _selectedRepartidor == null) {
       _selectedRepartidor = 'ALL';
    }

    final navItems = _getNavItems(isJefeVentas, authProvider.vendedorCodes);
    final safeIndex = _currentIndex.clamp(0, navItems.length - 1);

    return Scaffold(
      body: SafeArea(
        child: Row(
          children: [
            // Custom Sidebar Navigation
            AnimatedContainer(
              duration: const Duration(milliseconds: 250),
              curve: Curves.easeInOut,
              width: _isNavExpanded ? 90 : 0, 
              child: _isNavExpanded ? Container(
                decoration: BoxDecoration(
                  color: AppTheme.surfaceColor,
                  border: Border(
                    right: BorderSide(color: Colors.white.withOpacity(0.05), width: 1),
                  ),
                ),
                child: Column(
                  children: [
                    const SizedBox(height: 16),
                    _buildUserAvatar(user, isJefeVentas),
                    const SizedBox(height: 16),

                    // MODE SWITCHER FOR JEFE
                    if (isJefeVentas)
                         Padding(
                           padding: const EdgeInsets.symmetric(horizontal: 12),
                           child: InkWell(
                             onTap: () {
                               setState(() {
                                 _forceRepartidorMode = !_forceRepartidorMode;
                                 _currentIndex = 0; // Reset tab
                               });
                             },
                             borderRadius: BorderRadius.circular(12),
                             child: Container(
                               padding: const EdgeInsets.symmetric(vertical: 8),
                               decoration: BoxDecoration(
                                 color: _forceRepartidorMode ? Colors.orange.withOpacity(0.2) : AppTheme.neonBlue.withOpacity(0.2),
                                 borderRadius: BorderRadius.circular(12),
                                 border: Border.all(
                                   color: _forceRepartidorMode ? Colors.orange : AppTheme.neonBlue,
                                   width: 1
                                 )
                               ),
                               child: Column(
                                 children: [
                                   Icon(
                                     _forceRepartidorMode ? Icons.local_shipping : Icons.store,
                                     color: _forceRepartidorMode ? Colors.orange : AppTheme.neonBlue,
                                     size: 20
                                   ),
                                   const SizedBox(height: 4),
                                   Text(
                                     _forceRepartidorMode ? 'Reparto' : 'Ventas',
                                     style: TextStyle(
                                       fontSize: 9,
                                       fontWeight: FontWeight.bold,
                                       color: _forceRepartidorMode ? Colors.orange : AppTheme.neonBlue,
                                     ),
                                   )
                                 ],
                               ),
                             ),
                           ),
                         ),
                    
                    const SizedBox(height: 16),
                    
                    Expanded(
                      child: ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        itemCount: navItems.length,
                        itemBuilder: (context, index) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: _buildNavItem(
                              item: navItems[index],
                              isSelected: safeIndex == index,
                              onTap: () => setState(() => _currentIndex = index),
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
                          _buildLogoutButton(authProvider),
                        ],
                      ),
                    ),
                  ],
                ),
              ) : null,
            ),
            
            // Expand button
            if (!_isNavExpanded)
              GestureDetector(
                onTap: () => setState(() => _isNavExpanded = true),
                child: Container(
                  width: 24,
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceColor,
                    border: Border(right: BorderSide(color: Colors.white.withOpacity(0.05), width: 1)),
                  ),
                  child: Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 4),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(Icons.chevron_right_rounded, color: AppTheme.neonBlue, size: 16),
                    ),
                  ),
                ),
              ),
            
            // Main Content
            Expanded(
              child: _buildCurrentPage(authProvider.vendedorCodes, isJefeVentas),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildUserAvatar(user, bool isJefeVentas) {
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
                color: (isJefeVentas ? AppTheme.neonBlue : AppTheme.neonGreen).withOpacity(0.3),
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
          user.name.length > 16 ? '${user.name.substring(0, 16)}' : user.name,
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
              color: AppTheme.neonBlue.withOpacity(0.2),
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
              color: Colors.orange.withOpacity(0.2),
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
              color: AppTheme.neonGreen.withOpacity(0.2),
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
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          color: isSelected 
            ? item.color.withOpacity(0.15) 
            : Colors.transparent,
          border: isSelected
            ? Border.all(color: item.color.withOpacity(0.3), width: 1)
            : null,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isSelected ? item.selectedIcon : item.icon,
              color: isSelected ? item.color : AppTheme.textSecondary,
              size: 24,
            ),
            const SizedBox(height: 4),
            Text(
              item.label,
              style: TextStyle(
                fontSize: 10,
                color: isSelected ? item.color : AppTheme.textSecondary,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
              textAlign: TextAlign.center,
              maxLines: 1,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLogoutButton(AuthProvider authProvider) {
    return InkWell(
      onTap: () => _showLogoutConfirmation(authProvider),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          color: AppTheme.error.withOpacity(0.1),
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
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          color: AppTheme.neonPurple.withOpacity(0.1),
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
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          color: AppTheme.neonBlue.withOpacity(0.1),
        ),
        child: Column(
          children: [
            Icon(
              _isNavExpanded ? Icons.chevron_left_rounded : Icons.chevron_right_rounded,
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
        border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.05))),
      ),
      child: Row(
        children: [
           const Row(
             children: [
               Icon(Icons.visibility, color: AppTheme.neonBlue, size: 16),
               SizedBox(width: 8),
               Text('Ver Como', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, fontSize: 12)),
             ],
           ),
           const SizedBox(width: 16),
           Expanded(
             child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
                ),
                child: _isLoadingRepartidores
                  ? const Center(child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.neonPurple)))
                  : DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: _selectedRepartidor,
                    hint: const Text('Seleccionar Repartidor', style: TextStyle(color: Colors.white54)),
                    isExpanded: true,
                    dropdownColor: AppTheme.surfaceColor,
                    icon: const Icon(Icons.keyboard_arrow_down, color: AppTheme.neonPurple),
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    items: [
                      const DropdownMenuItem(
                          value: 'ALL', 
                          child: Text('Todos los Repartidores', style: TextStyle(fontWeight: FontWeight.bold))
                      ),
                      ..._repartidoresOptions.map((r) {
                        return DropdownMenuItem(
                          value: r['code'].toString(),
                          child: Text('${r['code']} - ${r['name']}'),
                        );
                      }),
                    ],
                    onChanged: (val) => setState(() => _selectedRepartidor = val),
                  ),
                ),
             ),
           ),
        ],
      ),
    );
  }

  Widget _buildCurrentPage(List<String> vendedorCodes, bool isJefeVentas) {
    // Obtener el rol del usuario
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    final user = authProvider.currentUser;
    final isRepartidor = _isRepartidorEffective; 
    
    // ===============================================
    // REPARTIDOR: 0=Rutero, 1=Comisiones, 2=Histórico, 3=Chat IA
    // ===============================================
    if (isRepartidor) {
      // Determine effective repartidor ID
      String effectiveRepartidorId = user?.codigoConductor ?? vendedorCodes.join(','); // Default for real repartidor
      
      // If Jefe, override with selection
      if (isJefeVentas) {
          if (_selectedRepartidor == null || _selectedRepartidor == 'ALL') {
             if (_repartidoresOptions.isNotEmpty) {
                effectiveRepartidorId = _repartidoresOptions.map((e) => e['code']).join(',');
             } else {
                effectiveRepartidorId = vendedorCodes.join(','); 
             }
          } else {
             effectiveRepartidorId = _selectedRepartidor!;
          }
      }

      // Use KeyedSubtree to force complete widget tree rebuild when ID changes
      final content = KeyedSubtree(
        key: ValueKey('rutero_view_$effectiveRepartidorId'),
        child: Builder(builder: (_) {
          switch (_currentIndex) {
            case 0:
              return ChangeNotifierProvider(
                create: (_) => EntregasProvider()..setRepartidor(effectiveRepartidorId),
                child: RepartidorRuteroPage(repartidorId: effectiveRepartidorId),
              );
            case 1:
              return RepartidorComisionesPage(repartidorId: effectiveRepartidorId);
            case 2:
              return RepartidorHistoricoPage(repartidorId: effectiveRepartidorId);
            case 3:
              return ChatbotPage(vendedorCodes: [effectiveRepartidorId]);
            default:
              return const Center(child: Text('Página no encontrada'));
          }
        }),
      );

      // Wrap in Column with Header only if Jefe
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
    // JEFE: 0=Panel, 1=Clientes, 2=Ruta, 3=Obj, 4=Comisiones, 5=Chat
    // (Cobros removido - ahora exclusivo de Repartidor)
    // ===============================================
    if (isJefeVentas) {
      switch (_currentIndex) {
        case 0:
          // Panel de Control (Dashboard)
          if (_dashboardProvider == null) {
            return const Center(child: CircularProgressIndicator());
          }
          return ChangeNotifierProvider.value(
            value: _dashboardProvider!,
            child: const DashboardContent(),
          );
        case 1:
          return SimpleClientListPage(employeeCode: vendedorCodes.join(','), isJefeVentas: true);
        case 2:
          return RuteroPage(employeeCode: vendedorCodes.join(','), isJefeVentas: true);
        case 3:
          return ObjectivesPage(employeeCode: vendedorCodes.join(','), isJefeVentas: true);
        case 4:
          return CommissionsPage(employeeCode: vendedorCodes.join(','), isJefeVentas: true);
        case 5:
          return const FacturasPage();
        case 6:
          return ChatbotPage(vendedorCodes: vendedorCodes);
        default:
          return const Center(child: Text('Página no encontrada'));
      }
    }
    
    // ===============================================
    // COMERCIAL: 0=Clientes, 1=Ruta, 2=Obj, 3=Comisiones, 4=Facturas, 5=Chat
    // ===============================================
    switch (_currentIndex) {
      case 0:
        return SimpleClientListPage(employeeCode: vendedorCodes.join(','), isJefeVentas: false);
      case 1:
        return RuteroPage(employeeCode: vendedorCodes.join(','), isJefeVentas: false);
      case 2:
        return ObjectivesPage(employeeCode: vendedorCodes.join(','), isJefeVentas: false);
      case 3:
        return CommissionsPage(employeeCode: vendedorCodes.join(','), isJefeVentas: false);
      case 4:
        return const FacturasPage();
      case 5:
        return ChatbotPage(vendedorCodes: vendedorCodes);
      default:
        return const Center(child: Text('Página no encontrada'));
    }
  }
}

// Helper class for nav items
class _NavItem {
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final Color color;

  _NavItem({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.color,
  });
}

// Futuristic Logout Confirmation Dialog
class _LogoutConfirmationDialog extends StatelessWidget {
  final String userName;

  const _LogoutConfirmationDialog({required this.userName});

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: 340,
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppTheme.surfaceColor,
              AppTheme.darkBase.withOpacity(0.95),
            ],
          ),
          border: Border.all(
            color: Colors.white.withOpacity(0.08),
            width: 1.5,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.5),
              blurRadius: 40,
              spreadRadius: 10,
            ),
            BoxShadow(
              color: AppTheme.error.withOpacity(0.1),
              blurRadius: 30,
              spreadRadius: -5,
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Icon with glow effect
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppTheme.error.withOpacity(0.15),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.error.withOpacity(0.3),
                    blurRadius: 20,
                    spreadRadius: 2,
                  ),
                ],
              ),
              child: const Icon(
                Icons.logout_rounded,
                color: AppTheme.error,
                size: 32,
              ),
            ),
            
            const SizedBox(height: 24),
            
            // Title
            const Text(
              '¿Cerrar Sesión?',
              style: TextStyle(
                fontSize: 22,
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
                color: AppTheme.textSecondary.withOpacity(0.8),
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
                        side: BorderSide(color: Colors.white.withOpacity(0.1)),
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
                    decoration: BoxDecoration (
                      borderRadius: BorderRadius.circular(14),
                      gradient: const LinearGradient(
                        colors: [AppTheme.error, Color(0xFFB71C1C)],
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.error.withOpacity(0.4),
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
                              Icon(Icons.logout_rounded, color: Colors.white, size: 18),
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
