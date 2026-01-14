import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

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
  bool _isNavExpanded = true; // Estado del navbar colapsable
  
  // State for Jefe Repartidor View
  String? _selectedRepartidor;
  List<Map<String, dynamic>> _repartidoresOptions = [];
  bool _isLoadingRepartidores = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
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
    });
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
      try {
        final res = await ApiClient.get('/auth/repartidores');
        if (res is List) {
          setState(() {
             _repartidoresOptions = List<Map<String, dynamic>>.from(res);
          });
        }
      } catch (e) {
        debugPrint('Error fetching repartidores: $e');
      }
  }

  // Get navigation destinations based on user role
  // JEFE: Panel, Clientes, Ruta, Objetivos, Comisiones, Chat
  // COMERCIAL: Clientes, Ruta, Objetivos, Comisiones, Chat
  // REPARTIDOR: Rutero, Comisiones, Histórico, Chat IA (4 tabs exclusivos)
  List<_NavItem> _getNavItems(bool isJefeVentas, List<String> vendorCodes) {
    final items = <_NavItem>[];
    
    // Obtener el rol del usuario
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    final user = authProvider.currentUser;
    final isRepartidor = user?.isRepartidor ?? false;
    
    // ===============================================
    // REPARTIDOR: 4 pestañas exclusivas
    // 0=Rutero, 1=Comisiones, 2=Histórico, 3=Chat IA
    // ===============================================
    if (isRepartidor) {
      // Tab 1: Rutero (Ruta del día con cobros integrados)
      items.add(_NavItem(
        icon: Icons.route_outlined,
        selectedIcon: Icons.route,
        label: 'Rutero',
        color: AppTheme.neonBlue,
      ));
      
      // Tab 2: Comisiones (con umbral 30%)
      items.add(_NavItem(
        icon: Icons.euro_outlined,
        selectedIcon: Icons.euro,
        label: 'Comisiones',
        color: AppTheme.neonGreen,
      ));

      // Tab 3: Histórico (albaranes, facturas, firmas)
      items.add(_NavItem(
        icon: Icons.history_outlined,
        selectedIcon: Icons.history,
        label: 'Histórico',
        color: AppTheme.neonPurple,
      ));
      
      // Tab 4: Chat IA
      items.add(_NavItem(
        icon: Icons.smart_toy_outlined,
        selectedIcon: Icons.smart_toy,
        label: 'Chat IA',
        color: AppTheme.neonPink,
      ));
      
      return items;
    }
    
    // ===============================================
    // JEFE y COMERCIAL
    // ===============================================
    
    // Panel de Control - ONLY for Jefe de Ventas
    if (isJefeVentas) {
      items.add(_NavItem(
        icon: Icons.dashboard_outlined,
        selectedIcon: Icons.dashboard,
        label: 'Panel',
        color: AppTheme.neonBlue,
      ));
    }
    
    // Clientes - visible for Jefe y Comercial
    items.add(_NavItem(
      icon: Icons.people_outline,
      selectedIcon: Icons.people,
      label: 'Clientes',
      color: AppTheme.neonGreen,
    ));
    
    // Ruta - visible for Jefe y Comercial
    items.add(_NavItem(
      icon: Icons.route_outlined,
      selectedIcon: Icons.route,
      label: 'Ruta',
      color: AppTheme.neonPurple,
    ));
    
    // Objetivos - visible for Jefe y Comercial
    items.add(_NavItem(
      icon: Icons.track_changes_outlined,
      selectedIcon: Icons.track_changes,
      label: 'Objetivos',
      color: Colors.orange,
    ));
    
    // Comisiones - visible for all EXCEPT specific commercials (80, 13, 3)
    final restrictedCodes = ['80', '13', '3'];
    final shouldHideCommissions = !isJefeVentas && vendorCodes.any((c) => restrictedCodes.contains(c.trim()));
    
    if (!shouldHideCommissions) {
      items.add(_NavItem(
        icon: Icons.euro_outlined,
        selectedIcon: Icons.euro,
        label: 'Comisiones',
        color: AppTheme.neonGreen,
      ));
    }
    
    // COBROS REMOVIDO DE COMERCIAL - Ahora es exclusivo de Repartidor
    // Los comerciales ya no ven la pestaña de Cobros
    
    // Chat IA - visible for Jefe y Comercial
    items.add(_NavItem(
      icon: Icons.smart_toy_outlined,
      selectedIcon: Icons.smart_toy,
      label: 'Chat IA',
      color: AppTheme.neonPink,
    ));
    
    return items;
  }

  // Helper to get available repartidores (mocked or from auth)
  // For now, if Jefe, we assume he can see all. We need a list of repartidores.
  // We can filter `authProvider.vendedorCodes` or hardcode known drivers/fetch them.
  // For simplicity, we'll use a hardcoded list + "TODOS" or filter known drivers.
  List<Map<String, String>> _getRepartidores(List<String> codes) {
     // Return a list of {code, name}
     // Ideally this comes from a provider. For now, we mock or use codes.
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

    final isJefeVentas = user.isJefeVentas; // The user capability
    final isRepartidorMode = user.isRepartidor; // The active mode
    
    // Initialize selected if null
    if (isJefeVentas && isRepartidorMode && _selectedRepartidor == null) {
       _selectedRepartidor = 'ALL';
    }

    final navItems = _getNavItems(isJefeVentas, authProvider.vendedorCodes);
    final safeIndex = _currentIndex.clamp(0, navItems.length - 1);

    return Scaffold(
      body: SafeArea(
        child: Row(
          children: [
            // Custom Sidebar Navigation - Colapsable
            AnimatedContainer(
              duration: const Duration(milliseconds: 250),
              curve: Curves.easeInOut,
              width: _isNavExpanded ? 90 : 0, // REVERTED TO 90
              child: _isNavExpanded ? Container(
                decoration: BoxDecoration(
                  color: AppTheme.surfaceColor,
                  border: Border(
                    right: BorderSide(
                      color: Colors.white.withOpacity(0.05),
                      width: 1,
                    ),
                  ),
                ),
                child: Column(
                  children: [
                    const SizedBox(height: 16),
                    
                    // User Avatar
                    _buildUserAvatar(user, isJefeVentas),
                    
                    const SizedBox(height: 24),
                    
                    // Navigation Items - Take available space
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
                    
                    // Bottom Section - Collapse button and Logout
                    const Divider(height: 1, color: Colors.white10),
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        children: [
                          // Collapse button
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
            
            // Expand button cuando está colapsado
            if (!_isNavExpanded)
              GestureDetector(
                onTap: () => setState(() => _isNavExpanded = true),
                child: Container(
                  width: 24,
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceColor,
                    border: Border(
                      right: BorderSide(color: Colors.white.withOpacity(0.05), width: 1),
                    ),
                  ),
                  child: Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 4),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(
                        Icons.chevron_right_rounded,
                        color: AppTheme.neonBlue,
                        size: 16,
                      ),
                    ),
                  ),
                ),
              ),
            
            // Main Content Area
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
           const Text('VISTA DE REPARTO', style: TextStyle(color: AppTheme.neonPurple, fontWeight: FontWeight.bold, fontSize: 12)),
           const SizedBox(width: 16),
           Expanded(
             child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.05),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
                ),
                child: DropdownButtonHideUnderline(
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
    final isRepartidor = user?.isRepartidor ?? false;
    
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

      final content = Builder(builder: (_) {
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
      });

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
          return ChatbotPage(vendedorCodes: vendedorCodes);
        default:
          return const Center(child: Text('Página no encontrada'));
      }
    }
    
    // ===============================================
    // COMERCIAL: 0=Clientes, 1=Ruta, 2=Obj, 3=Comisiones, 4=Chat
    // (Cobros removido - ahora exclusivo de Repartidor)
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
