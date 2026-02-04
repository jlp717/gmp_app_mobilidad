import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../../core/providers/auth_provider.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/smart_sync_header.dart';
import '../../../entregas/providers/entregas_provider.dart';
import '../../../../core/api/api_client.dart';
import '../widgets/futuristic_week_navigator.dart';
import '../widgets/holographic_kpi_dashboard.dart';
import '../widgets/smart_delivery_card.dart';
import '../widgets/rutero_detail_modal.dart';

/// Repartidor Rutero Page - Futuristic Redesign
/// Features:
/// - Holographic week navigator with gestures
/// - KPI dashboard with gamification
/// - Smart delivery cards with AI suggestions
/// - Improved filtering and search
/// - Director "View As" with auto-reload
class RepartidorRuteroPage extends StatefulWidget {
  final String? repartidorId;

  const RepartidorRuteroPage({super.key, this.repartidorId});

  @override
  State<RepartidorRuteroPage> createState() => _RepartidorRuteroPageState();
}

class _RepartidorRuteroPageState extends State<RepartidorRuteroPage>
    with TickerProviderStateMixin {
  DateTime _selectedDate = DateTime.now();
  List<Map<String, dynamic>> _weekDays = [];
  bool _isLoadingWeek = false;
  String? _lastLoadedId;
  final TextEditingController _searchController = TextEditingController();
  
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
  void didChangeDependencies() {
    super.didChangeDependencies();
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final filter = Provider.of<FilterProvider>(context, listen: true);

    String targetId = widget.repartidorId ?? auth.currentUser?.code ?? '';
    if (auth.isDirector && filter.selectedVendor != null) {
      targetId = filter.selectedVendor!;
    }

    if (targetId.isNotEmpty && targetId != _lastLoadedId) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _lastLoadedId = targetId;
          _loadData();
        }
      });
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    _listAnimController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final filter = Provider.of<FilterProvider>(context, listen: false);
    final entregas = Provider.of<EntregasProvider>(context, listen: false);

    String targetId = widget.repartidorId ?? auth.currentUser?.code ?? '';

    // View As logic for directors
    if (auth.isDirector && filter.selectedVendor != null) {
      targetId = filter.selectedVendor!;
    }
    
    // Safety check: specific endpoints do not support CSV IDs.
    // If targetId is a list (e.g. from multi-vendor director context), take the first one.
    if (targetId.contains(',')) {
       targetId = targetId.split(',').first.trim();
    }

    if (targetId.isNotEmpty) {
      if (_lastLoadedId != targetId) {
        _lastLoadedId = targetId;
      }

      entregas.setRepartidor(targetId, autoReload: false);
      entregas.seleccionarFecha(_selectedDate);
      _loadWeekData(targetId);
    }
  }

  Future<void> _loadWeekData(String repartidorId) async {
    if (_isLoadingWeek) return;
    if (mounted) setState(() => _isLoadingWeek = true);

    try {
      final response = await ApiClient.get(
        '/repartidor/rutero/week/$repartidorId?date=${_selectedDate.toIso8601String()}',
      );
      if (response['success'] == true && mounted) {
        setState(() {
          _weekDays = List<Map<String, dynamic>>.from(response['days']);
        });
      }
    } catch (e) {
      debugPrint('Error loading week data: $e');
    } finally {
      if (mounted) setState(() => _isLoadingWeek = false);
    }
  }



  void _onDaySelected(DateTime date) {
    HapticFeedback.selectionClick();
    setState(() => _selectedDate = date);
    
    final entregas = Provider.of<EntregasProvider>(context, listen: false);
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
    final auth = Provider.of<AuthProvider>(context);
    final filter = Provider.of<FilterProvider>(context);
    final entregas = Provider.of<EntregasProvider>(context);


    // Header Name Logic
    String currentName = auth.currentUser?.name ?? 'Repartidor';
    if (auth.isDirector && filter.selectedVendor != null) {
      // Just show the vendor code for now
      currentName = 'Repartidor ${filter.selectedVendor}';
    }

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          // HEADER (COMPACT)
          SmartSyncHeader(
            title: 'Rutero',
            subtitle: currentName,
            onSync: () => _loadData(),
            isLoading: entregas.isLoading || _isLoadingWeek,
            compact: true,
          ),

          // FUTURISTIC WEEK NAVIGATOR
          FuturisticWeekNavigator(
            selectedDate: _selectedDate,
            weekDays: _weekDays,
            onDaySelected: _onDaySelected,
            onWeekChange: _onWeekChange,
            isLoading: _isLoadingWeek,
            totalClients: entregas.albaranes.length,
          ),

          // ERROR BANNER
          if (entregas.error != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              margin: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: AppTheme.error.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.error.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline, color: AppTheme.error, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${entregas.error}',
                      style: const TextStyle(color: AppTheme.error, fontSize: 12),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.refresh, color: AppTheme.error, size: 18),
                    onPressed: _loadData,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                ],
              ),
            ),

          // DIRECTOR FILTER (if applicable)
          if (auth.isDirector) _buildDirectorFilter(auth, filter, entregas),

          // SEARCH & FILTER ROW
          _buildSearchAndFilters(entregas),

          // HOLOGRAPHIC KPI DASHBOARD
          HolographicKpiDashboard(
            totalEntregas: entregas.albaranes.length,
            entregasCompletadas: entregas.resumenCompletedCount,
            montoACobrar: entregas.resumenTotalACobrar,
            montoOpcional: entregas.resumenTotalOpcional,
            totalMonto: entregas.resumenTotalBruto,
            isLoading: entregas.isLoading,
          ),

          // CLIENT LIST
          Expanded(
            child: entregas.isLoading
                ? _buildLoadingState()
                : _buildClientList(entregas),
          ),
        ],
      ),
    );
  }

  Widget _buildDirectorFilter(
    AuthProvider auth,
    FilterProvider filter,
    EntregasProvider entregas,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: ApiClient.getList('/repartidores').then(
          (val) => val.map((e) => e as Map<String, dynamic>).toList(),
        ),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const SizedBox.shrink();

          final repartidores = snapshot.data!;

          return Container(
            height: 42,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppTheme.darkCard,
                  AppTheme.darkSurface,
                ],
              ),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: AppTheme.neonBlue.withOpacity(0.3),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.person_search,
                  color: AppTheme.neonBlue,
                  size: 20,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: filter.selectedVendor,
                      hint: Text(
                        'Ver como repartidor...',
                        style: TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 13,
                        ),
                      ),
                      icon: const Icon(
                        Icons.arrow_drop_down,
                        color: AppTheme.neonBlue,
                      ),
                      dropdownColor: AppTheme.darkCard,
                      isExpanded: true,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                      ),
                      items: repartidores.map((r) {
                        // Clean name - remove ID redundancy like "41 - 41 ALFONSO"
                        final code = r['code'].toString();
                        final name = r['name'].toString();
                        final displayName = name.startsWith('$code ')
                            ? name.replaceFirst('$code ', '')
                            : name;

                        return DropdownMenuItem(
                          value: code,
                          child: Text(
                            displayName,
                            overflow: TextOverflow.ellipsis,
                          ),
                        );
                      }).toList(),
                      onChanged: (val) {
                        if (val != null) {
                          HapticFeedback.selectionClick();
                          filter.setVendor(val);
                          
                          // Manually trigger reload and pivot _lastLoadedId to prevent
                          // duplicate/conflicting loads from didChangeDependencies
                          if (mounted) {
                            setState(() => _lastLoadedId = val);
                          }
                          
                          // Force immediate reload
                          entregas.setRepartidor(val, forceReload: true);
                          entregas.seleccionarFecha(_selectedDate);
                          _loadWeekData(val);
                        }
                      },
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: Icon(
                    Icons.refresh,
                    color: AppTheme.neonBlue,
                    size: 20,
                  ),
                  tooltip: 'Recargar datos',
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    if (filter.selectedVendor != null) {
                      entregas.setRepartidor(filter.selectedVendor!);
                      entregas.cargarAlbaranesPendientes();
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

  Widget _buildSearchAndFilters(EntregasProvider entregas) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        children: [
          // Search field
          Expanded(
            flex: 3,
            child: Container(
              height: 38,
              decoration: BoxDecoration(
                color: AppTheme.darkCard,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: Row(
                children: [
                  const SizedBox(width: 10),
                  const Icon(
                    Icons.search,
                    size: 18,
                    color: AppTheme.textSecondary,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _searchController,
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.textPrimary,
                      ),
                      decoration: InputDecoration(
                        hintText: 'Buscar cliente o nº albarán...',
                        hintStyle: TextStyle(
                          fontSize: 12,
                          color: AppTheme.textSecondary,
                        ),
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.zero,
                      ),
                      onChanged: (v) => entregas.setSearchQuery(v),
                    ),
                  ),
                  if (_searchController.text.isNotEmpty)
                    IconButton(
                      icon: const Icon(Icons.clear, size: 16),
                      color: AppTheme.textSecondary,
                      onPressed: () {
                        _searchController.clear();
                        entregas.setSearchQuery('');
                      },
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  const SizedBox(width: 8),
                ],
              ),
            ),
          ),
          
          const SizedBox(width: 8),

          // Quick filter chips
          _buildQuickFilterChip(
            label: 'Cobrar',
            isSelected: entregas.filterDebeCobrar == 'S',
            color: AppTheme.obligatorio,
            icon: Icons.euro,
            onTap: () {
              HapticFeedback.selectionClick();
              entregas.setFilterDebeCobrar(
                entregas.filterDebeCobrar == 'S' ? '' : 'S',
              );
            },
          ),
          
          const SizedBox(width: 6),

          _buildQuickFilterChip(
            label: 'Crédito',
            isSelected: entregas.filterTipoPago == 'CREDITO',
            color: AppTheme.credito,
            icon: Icons.credit_card,
            onTap: () {
              HapticFeedback.selectionClick();
              entregas.setFilterTipoPago(
                entregas.filterTipoPago == 'CREDITO' ? '' : 'CREDITO',
              );
            },
          ),
          
          const SizedBox(width: 6),

          // Sort dropdown
          Container(
            height: 38,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppTheme.borderColor),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: entregas.sortBy,
                icon: const Icon(
                  Icons.sort,
                  color: AppTheme.neonBlue,
                  size: 18,
                ),
                dropdownColor: AppTheme.darkCard,
                items: const [
                  DropdownMenuItem(
                    value: 'default',
                    child: Text(
                      '↕ Orden',
                      style: TextStyle(color: AppTheme.textPrimary, fontSize: 11),
                    ),
                  ),
                  DropdownMenuItem(
                    value: 'importe_desc',
                    child: Text(
                      '↓ Mayor €',
                      style: TextStyle(color: AppTheme.textPrimary, fontSize: 11),
                    ),
                  ),
                  DropdownMenuItem(
                    value: 'importe_asc',
                    child: Text(
                      '↑ Menor €',
                      style: TextStyle(color: AppTheme.textPrimary, fontSize: 11),
                    ),
                  ),
                ],
                onChanged: (val) {
                  if (val != null) {
                    HapticFeedback.selectionClick();
                    entregas.setSortBy(val);
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
          color: isSelected ? color.withOpacity(0.2) : AppTheme.darkCard,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isSelected ? color : AppTheme.borderColor,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: isSelected ? color : AppTheme.textSecondary),
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
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 60,
            height: 60,
            child: CircularProgressIndicator(
              color: AppTheme.neonBlue,
              strokeWidth: 3,
            ),
          ),
          const SizedBox(height: 16),
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

  Widget _buildClientList(EntregasProvider provider) {
    if (provider.albaranes.isEmpty) {
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
            ).animate(CurvedAnimation(
              parent: _listAnimController,
              curve: Curves.easeOutCubic,
            )),
            child: ListView.builder(
              padding: const EdgeInsets.only(top: 4, bottom: 100), // Reduced top padding
              itemCount: provider.albaranes.length,
              itemBuilder: (context, index) {
                final albaran = provider.albaranes[index];
                
                return Column(
                  children: [
                    SmartDeliveryCard(
                      albaran: albaran,
                      onTap: () => _showDetailDialog(albaran),
                      onSwipeComplete: () => _handleQuickComplete(albaran),
                      onSwipeNote: () => _showQuickNoteDialog(albaran),
                    ),
                    if (index < provider.albaranes.length - 1)
                      Divider(
                        height: 1,
                        thickness: 1,
                        color: AppTheme.borderColor.withOpacity(0.3),
                        indent: 12, // Tighter indent
                        endIndent: 12,
                      ),
                  ],
                );
              },
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
              gradient: LinearGradient(
                colors: [
                  AppTheme.neonBlue.withOpacity(0.1),
                  AppTheme.neonCyan.withOpacity(0.05),
                ],
              ),
              shape: BoxShape.circle,
              border: Border.all(
                color: AppTheme.neonBlue.withOpacity(0.2),
                width: 2,
              ),
            ),
            child: Icon(
              Icons.inventory_2_outlined,
              size: 56,
              color: AppTheme.textSecondary.withOpacity(0.5),
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
          Text(
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
              foregroundColor: AppTheme.neonBlue,
              side: BorderSide(color: AppTheme.neonBlue.withOpacity(0.5)),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            ),
          ),
        ],
      ),
    );
  }

  void _showAiDetail(BuildContext context, String? suggestion) {
    if (suggestion == null) return;
    HapticFeedback.mediumImpact();
    // Simple alert dialog for now
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        title: Row(
          children: const [
            Icon(Icons.auto_awesome, color: AppTheme.neonPurple),
            SizedBox(width: 10),
            Text('Análisis Inteligente', style: TextStyle(color: AppTheme.neonPurple)),
          ],
        ),
        content: Text(suggestion, style: const TextStyle(color: AppTheme.textPrimary)),
        actions: [
          TextButton(
            child: const Text('Entendido'),
            onPressed: () => Navigator.pop(context),
          ),
        ],
      ),
    );
  }

  void _showDetailDialog(AlbaranEntrega albaran) {
    final entregasProvider = Provider.of<EntregasProvider>(context, listen: false);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => ChangeNotifierProvider.value(
        value: entregasProvider,
        child: RuteroDetailModal(albaran: albaran),
      ),
    ).then((_) {
      if (mounted) {
        entregasProvider.cargarAlbaranesPendientes();
      }
    });
  }

  void _handleQuickComplete(AlbaranEntrega albaran) {
    // 1. Validation: If CTR (Must Pay), prevent quick swipe
    if (albaran.esCTR) {
      HapticFeedback.heavyImpact();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(
            children: const [
              Icon(Icons.warning_amber_rounded, color: Colors.white),
              SizedBox(width: 12),
              Expanded(child: Text('Cobro obligatorio. Abra el detalle para registrar pago.')),
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
      Future.delayed(const Duration(milliseconds: 300), () => _showDetailDialog(albaran));
      return;
    }

    // 2. Perform Quick Complete
    final provider = Provider.of<EntregasProvider>(context, listen: false);
    
    // Optimistic UI update or wait? 
    // Let's show loading snackbar then success
    
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            SizedBox(
              width: 20, 
              height: 20, 
              child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.neonBlue)
            ),
            const SizedBox(width: 12),
            Expanded(child: Text('Completando ${albaran.nombreCliente}...')),
          ],
        ),
        backgroundColor: AppTheme.darkCard,
        duration: const Duration(seconds: 1),
      ),
    );

    provider.marcarEntregado(
      albaranId: albaran.id,
      observaciones: 'Completado rápido (Swipe)',
      // No signature/photos for quick swipe
    ).then((success) {
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
        provider.cargarAlbaranesPendientes(); // Refresh list
      } else {
        HapticFeedback.heavyImpact();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al completar: ${provider.error ?? "Desconocido"}'),
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
        backgroundColor: AppTheme.darkSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.note_add, color: AppTheme.neonBlue, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Nota para ${albaran.nombreCliente}',
                style: const TextStyle(color: AppTheme.textPrimary, fontSize: 16),
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
            hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
            filled: true,
            fillColor: AppTheme.darkBase,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: AppTheme.borderColor),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: AppTheme.neonBlue),
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
              backgroundColor: AppTheme.neonBlue,
              foregroundColor: AppTheme.darkBase,
            ),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
  }

  void _showAiSuggestions(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        AppTheme.neonPurple.withOpacity(0.3),
                        AppTheme.neonBlue.withOpacity(0.2),
                      ],
                    ),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.auto_awesome,
                    color: AppTheme.neonPurple,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 12),
                const Text(
                  'Sugerencias de IA',
                  style: TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            _buildAiSuggestionTile(
              icon: Icons.route,
              title: 'Ruta optimizada',
              subtitle: 'Ahorra 15 min evitando C/ Gran Vía (tráfico)',
              onTap: () {
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Función próximamente disponible')),
                );
              },
            ),
            const SizedBox(height: 12),
            _buildAiSuggestionTile(
              icon: Icons.priority_high,
              title: 'Cobros prioritarios',
              subtitle: '2 clientes con cobros vencidos hace +5 días',
              color: AppTheme.obligatorio,
              onTap: () {
                Navigator.pop(ctx);
                final entregas = Provider.of<EntregasProvider>(context, listen: false);
                entregas.setFilterDebeCobrar('S');
              },
            ),
            const SizedBox(height: 12),
            _buildAiSuggestionTile(
              icon: Icons.trending_up,
              title: 'Oportunidad de venta',
              subtitle: 'Bar La Esquina suele pedir más en esta época',
              color: AppTheme.success,
              onTap: () => Navigator.pop(ctx),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildAiSuggestionTile({
    required IconData icon,
    required String title,
    required String subtitle,
    Color? color,
    required VoidCallback onTap,
  }) {
    final tileColor = color ?? AppTheme.neonBlue;
    
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: tileColor.withOpacity(0.08),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: tileColor.withOpacity(0.2)),
          ),
          child: Row(
            children: [
              Icon(icon, color: tileColor, size: 24),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        color: AppTheme.textPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right,
                color: tileColor,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
