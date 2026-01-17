import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:signature/signature.dart';
import 'dart:convert';
import 'dart:typed_data';
import '../../../../core/providers/auth_provider.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/smart_sync_header.dart';
import '../../../entregas/providers/entregas_provider.dart';
import '../../../../core/api/api_client.dart';
import '../widgets/rutero_kpi_dashboard.dart';
import '../widgets/swipe_action_card.dart';
import '../widgets/rutero_detail_modal.dart';

// Imports cleaned up
class RepartidorRuteroPage extends StatefulWidget {
  final String? repartidorId;

  const RepartidorRuteroPage({super.key, this.repartidorId});

  @override
  State<RepartidorRuteroPage> createState() => _RepartidorRuteroPageState();
}

class _RepartidorRuteroPageState extends State<RepartidorRuteroPage> {
  DateTime _selectedDate = DateTime.now();
  List<Map<String, dynamic>> _weekDays = [];
  bool _isLoadingWeek = false;
  String? _lastLoadedId;
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
    });
  }

  // Removing didChangeDependencies manual check in favor of Consumer in build or listener
  // Actually, keeping strict listener is good, but let's make it robust.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // We rely on the build method's Consumer/Watch to trigger updates if we structure it right,
    // but here we need to trigger a FETCH.
    final auth = Provider.of<AuthProvider>(context, listen: false); // Role doesn't change often
    final filter = Provider.of<FilterProvider>(context, listen: true); // Listen to filter!
    
    String targetId = widget.repartidorId ?? auth.currentUser?.code ?? '';
    if (auth.isDirector && filter.selectedVendor != null) {
      targetId = filter.selectedVendor!;
    }

    if (targetId.isNotEmpty && targetId != _lastLoadedId) {
       // Debounce or immediate? Immediate is fine.
       // We must defer state change/async call
       WidgetsBinding.instance.addPostFrameCallback((_) {
         if (mounted) {
           _lastLoadedId = targetId; 
           _loadData(); // This will use the new targetId
         }
       });
    }
  }

  Future<void> _loadData() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final filter = Provider.of<FilterProvider>(context, listen: false);
    final entregas = Provider.of<EntregasProvider>(context, listen: false);

    String targetId = widget.repartidorId ?? auth.currentUser?.code ?? '';
    
    // View As logic
    if (auth.isDirector && filter.selectedVendor != null) {
      targetId = filter.selectedVendor!;
    }

    if (targetId.isNotEmpty) {
      // Update local state to match effective target
      if (_lastLoadedId != targetId) {
        _lastLoadedId = targetId;
      }
      
      entregas.setRepartidor(targetId);
      entregas.seleccionarFecha(_selectedDate); 
      _loadWeekData(targetId);
    }
  }

  Future<void> _loadWeekData(String repartidorId) async {
    if (_isLoadingWeek) return;
    if (mounted) setState(() => _isLoadingWeek = true);

    try {
      final response = await ApiClient.get('/repartidor/rutero/week/$repartidorId?date=${_selectedDate.toIso8601String()}');
      if (response['success'] == true && mounted) {
        setState(() {
          _weekDays = List<Map<String, dynamic>>.from(response['days']);
        });
      }
    } catch (e) {
      print('Error loading week data: $e');
    } finally {
      if (mounted) setState(() => _isLoadingWeek = false);
    }
  }

  void _onDaySelected(DateTime date) {
    setState(() {
      _selectedDate = date;
    });
    final entregas = Provider.of<EntregasProvider>(context, listen: false);
    entregas.seleccionarFecha(date);
  }

  @override
  Widget build(BuildContext context) {
    // Listen to Providers to trigger rebuilds
    final auth = Provider.of<AuthProvider>(context); 
    final filter = Provider.of<FilterProvider>(context);
    final entregas = Provider.of<EntregasProvider>(context);

    // Header Name Logic
    String currentName = auth.currentUser?.name ?? 'Repartidor';
    if (auth.isDirector && filter.selectedVendor != null) {
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

          // WEEK NAVIGATION ROW
          if (_weekDays.isNotEmpty) _buildWeekNavigation(entregas),

          // WEEKLY STRIP
          if (_weekDays.isNotEmpty) _buildWeeklyStrip(),

          // ERROR
          if (entregas.error != null)
             Container(
               padding: const EdgeInsets.all(8),
               color: AppTheme.error.withOpacity(0.1),
               width: double.infinity,
               child: Text(
                 '${entregas.error}', 
                 style: const TextStyle(color: AppTheme.error, fontSize: 12),
                 textAlign: TextAlign.center,
                ),
             ),

          // DIRECTOR FILTER (Collapsed/Compact)
          if (auth.isDirector)
            _buildDirectorFilter(auth, filter, entregas),

          // SEARCH & SORT ROW
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                // Search TextField
                Expanded(
                  child: Container(
                    height: 36, // Reduced height
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceColor,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Colors.grey.shade700),
                    ),
                    child: TextField(
                      decoration: const InputDecoration(
                        hintText: 'Buscar cliente...',
                        hintStyle: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                        prefixIcon: Icon(Icons.search, color: AppTheme.textSecondary, size: 18),
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(vertical: 8), // Adjusted
                      ),
                      style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                      onChanged: (value) {
                         entregas.setSearchQuery(value);
                      },
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                // Sort Dropdown
                Container(
                  height: 36, // Reduced
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceColor,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.grey.shade700),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: entregas.sortBy,
                      icon: const Icon(Icons.sort, color: AppTheme.neonBlue, size: 18),
                      dropdownColor: AppTheme.surfaceColor,
                      items: const [
                        DropdownMenuItem(value: 'default', child: Text('Orden', style: TextStyle(color: AppTheme.textPrimary, fontSize: 12))),
                        DropdownMenuItem(value: 'importe_desc', child: Text('Mayor €', style: TextStyle(color: AppTheme.textPrimary, fontSize: 12))),
                        DropdownMenuItem(value: 'importe_asc', child: Text('Menor €', style: TextStyle(color: AppTheme.textPrimary, fontSize: 12))),
                      ],
                      onChanged: (val) {
                        if (val != null) entregas.setSortBy(val);
                      },
                    ),
                  ),
                ),
              ],
            ),
          ),

          // SEARCH BY ALBARAN/FACTURA NUMBER
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: Row(
              children: [
                // Albaran number search
                Expanded(
                  child: Container(
                    height: 32,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    decoration: BoxDecoration(
                      color: AppTheme.darkBase,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppTheme.borderColor),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.search, size: 16, color: AppTheme.textSecondary),
                        const SizedBox(width: 6),
                        Expanded(
                          child: TextField(
                            controller: _searchController,
                            style: const TextStyle(fontSize: 12, color: AppTheme.textPrimary),
                            decoration: const InputDecoration(
                              hintText: 'Buscar nº albarán/factura...',
                              hintStyle: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                              border: InputBorder.none,
                              isDense: true,
                              contentPadding: EdgeInsets.zero,
                            ),
                            onChanged: (v) => entregas.setSearchQuery(v),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                // Quick filters
                _buildMiniChip('Cobrar', entregas.filterDebeCobrar == 'S', () => entregas.setFilterDebeCobrar(entregas.filterDebeCobrar == 'S' ? '' : 'S'), AppTheme.error),
                const SizedBox(width: 4),
                _buildMiniChip('Cred', entregas.filterTipoPago == 'CREDITO', () => entregas.setFilterTipoPago(entregas.filterTipoPago == 'CREDITO' ? '' : 'CREDITO'), AppTheme.success),
              ],
            ),
          ),
          const SizedBox(height: 2),

          // KPI DASHBOARD
          RuteroKpiDashboard(
            totalEntregas: entregas.albaranes.length,
            entregasCompletadas: entregas.albaranes.where((a) => a.estado == EstadoEntrega.entregado).length,
            montoACobrar: entregas.resumenTotalACobrar,
            montoOpcional: entregas.resumenTotalOpcional,
            totalMonto: entregas.albaranes.fold(0.0, (sum, item) => sum + item.importeTotal), // Calculated Total
            montoCobrado: 0, 
            isLoading: entregas.isLoading,
          ),
          const SizedBox(height: 6),

          // LIST
          Expanded(
            child: entregas.isLoading 
                ? const Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))
                : _buildClientList(entregas),
          ),
        ],
      ),
    );
  }

  // Calculate week number
  int _getWeekNumber(DateTime date) {
    final firstDayOfYear = DateTime(date.year, 1, 1);
    final days = date.difference(firstDayOfYear).inDays;
    return ((days + firstDayOfYear.weekday) / 7).ceil();
  }

  void _changeWeek(int delta) {
    setState(() {
      _selectedDate = _selectedDate.add(Duration(days: 7 * delta));
    });
    _loadData();
  }

  Widget _buildWeekNavigation(EntregasProvider entregas) {
    final weekNum = _getWeekNumber(_selectedDate);
    final totalClients = entregas.albaranes.length;
    
    // Calculate week date range
    final weekStart = _selectedDate.subtract(Duration(days: _selectedDate.weekday - 1));
    final weekEnd = weekStart.add(const Duration(days: 6));
    final dateFormat = DateFormat('d MMM', 'es_ES');
    final weekRange = '${dateFormat.format(weekStart)} - ${dateFormat.format(weekEnd)}';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4), // Reduced padding
      color: AppTheme.darkSurface,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Left: Week Navigation
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left, color: AppTheme.textSecondary, size: 20),
                onPressed: () => _changeWeek(-1),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Text(
                    'S$weekNum',
                    style: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                  Text(
                    weekRange,
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right, color: AppTheme.textSecondary, size: 20),
                onPressed: () => _changeWeek(1),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
              ),
            ],
          ),
          
          // Right: Client Count
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: AppTheme.neonBlue.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.people_alt_outlined, size: 14, color: AppTheme.neonBlue),
                const SizedBox(width: 6),
                Text(
                  '$totalClients clientes',
                  style: const TextStyle(
                    color: AppTheme.neonBlue,
                    fontWeight: FontWeight.bold,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWeeklyStrip() {
    // Calculate selected index for mini chart
    final selectedIndex = _weekDays.indexWhere((day) {
      final date = DateTime.parse(day['date']);
      return DateUtils.isSameDay(date, _selectedDate);
    });
    
    // Get daily counts for mini chart
    final dailyCounts = _weekDays.map<int>((day) => (day['clients'] ?? 0) as int).toList();
    
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Day selector strip
        Container(
          height: 52,
          decoration: BoxDecoration(
            color: AppTheme.surfaceColor,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 4,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            itemCount: _weekDays.length,
            itemBuilder: (context, index) {
              final dayData = _weekDays[index];
              final date = DateTime.parse(dayData['date']);
              final isSelected = DateUtils.isSameDay(date, _selectedDate);
              final count = dayData['clients'] ?? 0;
              final status = dayData['status'] ?? 'none'; // 'good', 'bad', 'none'

              // Color based on status
              Color statusColor = AppTheme.textSecondary;
              if (status == 'good') statusColor = AppTheme.success;
              if (status == 'bad') statusColor = AppTheme.error;
              if (count > 0 && status == 'none') statusColor = AppTheme.neonBlue;

              return GestureDetector(
                onTap: () => _onDaySelected(date),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  width: 44,
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  decoration: BoxDecoration(
                    gradient: isSelected
                        ? LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [AppTheme.neonBlue, AppTheme.neonBlue.withOpacity(0.7)],
                          )
                        : null,
                    color: isSelected ? null : (count > 0 ? AppTheme.darkCard : AppTheme.darkBase),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: isSelected 
                          ? AppTheme.neonBlue 
                          : (count > 0 ? statusColor.withOpacity(0.4) : Colors.white.withOpacity(0.05)),
                      width: isSelected ? 2 : 1,
                    ),
                    boxShadow: isSelected
                        ? [BoxShadow(color: AppTheme.neonBlue.withOpacity(0.4), blurRadius: 8)]
                        : null,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Day letter
                      Text(
                        (dayData['dayName'] ?? '').toString().substring(0, 1).toUpperCase(),
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: isSelected ? AppTheme.darkBase : AppTheme.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      // Count with animation
                      AnimatedDefaultTextStyle(
                        duration: const Duration(milliseconds: 200),
                        style: TextStyle(
                          fontSize: isSelected ? 14 : 13,
                          fontWeight: FontWeight.w900,
                          color: isSelected 
                              ? AppTheme.darkBase 
                              : (count > 0 ? statusColor : AppTheme.textTertiary),
                        ),
                        child: Text('$count'),
                      ),
                      // Status indicator dot
                      if (count > 0 && !isSelected)
                        Container(
                          margin: const EdgeInsets.only(top: 2),
                          width: 4,
                          height: 4,
                          decoration: BoxDecoration(
                            color: statusColor,
                            shape: BoxShape.circle,
                          ),
                        ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        // Mini bar chart
        if (dailyCounts.any((c) => c > 0))
          Container(
            color: AppTheme.darkSurface,
            padding: const EdgeInsets.only(bottom: 6),
            child: WeeklyMiniChart(
              dailyCounts: dailyCounts,
              selectedIndex: selectedIndex,
              onDayTap: (index) {
                if (index >= 0 && index < _weekDays.length) {
                  final date = DateTime.parse(_weekDays[index]['date']);
                  _onDaySelected(date);
                }
              },
            ),
          ),
      ],
    );
  }

  Widget _buildClientList(EntregasProvider provider) {
    if (provider.albaranes.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withOpacity(0.05),
                shape: BoxShape.circle,
                border: Border.all(color: AppTheme.neonBlue.withOpacity(0.1), width: 2),
              ),
              child: Icon(Icons.inventory_2_outlined, size: 64, color: AppTheme.textSecondary.withOpacity(0.5)),
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
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: provider.albaranes.length,
      itemBuilder: (context, index) {
        final albaran = provider.albaranes[index];
        return _buildClientCard(albaran);
      },
    );
  }

  /// Helper to map colorEstado from backend to Flutter Color
  Color _getPaymentColor(String colorEstado) {
    switch (colorEstado.toLowerCase()) {
      case 'red':
        return AppTheme.error;
      case 'orange':
        return AppTheme.warning;
      case 'green':
      default:
        return AppTheme.success;
    }
  }

  /// Build filter chip for payment types
  Widget _buildFilterChip(String label, bool isSelected, VoidCallback onTap, Color color) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? color.withOpacity(0.2) : AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected ? color : Colors.grey.shade600,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? color : AppTheme.textSecondary,
            fontSize: 11,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }

  /// Build summary item for totals bar
  Widget _buildSummaryItem(String label, double amount, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 10,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          '${amount.toStringAsFixed(0)}€',
          style: TextStyle(
            color: color,
            fontSize: 14,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }

  /// Build mini chip for inline filters
  Widget _buildMiniChip(String label, bool isSelected, VoidCallback onTap, Color color) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: isSelected ? color.withOpacity(0.2) : AppTheme.darkBase,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isSelected ? color : AppTheme.borderColor, width: 1),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? color : AppTheme.textSecondary,
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  Widget _buildClientCard(AlbaranEntrega albaran) {
    final bool isEntregado = albaran.estado == EstadoEntrega.entregado;
    final bool isPendiente = albaran.estado == EstadoEntrega.pendiente;
    final Color statusColor = isEntregado ? AppTheme.success : (isPendiente ? AppTheme.error : Colors.orange);
    
    // Determine border color based on payment status
    final Color borderColor = albaran.esCTR 
        ? AppTheme.error // Must collect - red border
        : (albaran.colorEstado == 'green' ? AppTheme.success : AppTheme.warning);
    
    final cardContent = Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.darkSurface,
            AppTheme.darkCard.withOpacity(0.7),
          ],
        ),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: borderColor.withOpacity(0.4),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: borderColor.withOpacity(0.15),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            if (isEntregado) {
              _showEditConfirmation(albaran);
            } else {
              _showDetailDialog(albaran);
            }
          },
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.all(12.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Row 1: Document badge + Amount + Status indicator
                Row(
                  children: [
                    // Document badge (Albaran/Factura)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: albaran.numeroFactura > 0 
                              ? [AppTheme.neonPurple.withOpacity(0.2), AppTheme.neonPurple.withOpacity(0.1)]
                              : [AppTheme.darkBase, AppTheme.darkBase.withOpacity(0.8)],
                        ),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(
                          color: albaran.numeroFactura > 0 
                              ? AppTheme.neonPurple.withOpacity(0.5) 
                              : Colors.grey.withOpacity(0.3),
                        ),
                      ),
                      child: Text(
                        albaran.numeroFactura > 0 ? 'F-${albaran.numeroFactura}' : 'A-${albaran.numeroAlbaran}',
                        style: TextStyle(
                          color: albaran.numeroFactura > 0 ? AppTheme.neonPurple : AppTheme.textSecondary,
                          fontWeight: FontWeight.bold,
                          fontSize: 11,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Status dot
                    if (isEntregado)
                      Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: AppTheme.success.withOpacity(0.2),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.check, color: AppTheme.success, size: 12),
                      ),
                    const Spacer(),
                    // Amount
                    Text(
                      NumberFormat.currency(symbol: '€', locale: 'es_ES').format(albaran.importeTotal),
                      style: TextStyle(
                        color: statusColor,
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        letterSpacing: -0.5,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                // Row 2: Client info
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.neonBlue.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        albaran.codigoCliente.length > 6 
                            ? albaran.codigoCliente.substring(albaran.codigoCliente.length - 4) 
                            : albaran.codigoCliente,
                        style: const TextStyle(
                          color: AppTheme.neonBlue, 
                          fontWeight: FontWeight.bold, 
                          fontSize: 10,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        albaran.nombreCliente,
                        style: const TextStyle(
                          color: AppTheme.textPrimary, 
                          fontWeight: FontWeight.w600, 
                          fontSize: 14,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                // Row 3: Address + Payment Badge
                Row(
                  children: [
                    const Icon(Icons.location_on_outlined, size: 12, color: AppTheme.textTertiary),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        '${albaran.direccion}, ${albaran.poblacion}',
                        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Payment badge with tooltip
                    Tooltip(
                      message: albaran.esCTR 
                          ? 'Cobro obligatorio (${albaran.tipoPago})' 
                          : 'Forma de pago: ${albaran.tipoPago}',
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              _getPaymentColor(albaran.colorEstado).withOpacity(0.2),
                              _getPaymentColor(albaran.colorEstado).withOpacity(0.1),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(
                            color: _getPaymentColor(albaran.colorEstado).withOpacity(0.5),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (albaran.esCTR) 
                              Icon(Icons.euro, size: 10, color: _getPaymentColor(albaran.colorEstado)),
                            if (albaran.esCTR) const SizedBox(width: 2),
                            Text(
                              _mapPaymentType(albaran.tipoPago), // Use helper for name
                              style: TextStyle(
                                color: _getPaymentColor(albaran.colorEstado),
                                fontSize: 9,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );

    // Wrap with SwipeActionCard for pending items
    if (!isEntregado) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: SwipeActionCard(
          onSwipeLeft: () {
            // Quick mark as collected
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Cobrado: ${albaran.nombreCliente}'),
                backgroundColor: AppTheme.success,
                duration: const Duration(seconds: 2),
              ),
            );
          },
          onSwipeRight: () {
            // Add note
            _showQuickNoteDialog(albaran);
          },
          leftLabel: 'Cobrado',
          rightLabel: 'Nota',
          leftIcon: Icons.check_circle_outline,
          rightIcon: Icons.note_add_outlined,
          leftColor: AppTheme.success,
          rightColor: AppTheme.neonBlue,
          child: cardContent,
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: cardContent,
    );
  }

  String _mapPaymentType(String code) {
    if (code == null) return 'UNK'; 
    final c = code.toUpperCase().trim();
    if (c == '01' || c == 'CNT' || c == 'CONTADO') return 'CONTADO';
    if (c.contains('REP')) return 'REPOSICIÓN';
    if (c.contains('MEN')) return 'MENSUAL';
    if (c.contains('CRE') || c == 'CR') return 'CRÉDITO';
    if (c.contains('TAR')) return 'TARJETA';
    if (c.contains('CHE')) return 'CHEQUE';
    if (c.contains('PAG')) return 'PAGARÉ';
    if (c.contains('TRA')) return 'TRANSF.';
    return c;
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
            const Icon(Icons.note_add, color: AppTheme.neonBlue, size: 24),
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
            child: const Text('Cancelar', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () {
              // Save note logic here
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


  void _showEditConfirmation(AlbaranEntrega albaran) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkSurface,
        title: const Text('⚠️ Albarán ya entregado', style: TextStyle(color: AppTheme.textPrimary)),
        content: const Text(
          'Este albarán ya ha sido confirmado y firmado.\n¿Estás seguro de que quieres editarlo? Esto podría afectar a los registros.',
          style: TextStyle(color: AppTheme.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _showDetailDialog(albaran);
            },
            child: const Text('Sí, Editar', style: TextStyle(color: AppTheme.error)),
          ),
        ],
      ),
    );
  }

  Widget _buildDirectorFilter(AuthProvider auth, FilterProvider filter, EntregasProvider entregas) {
    if (!auth.isDirector) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: ApiClient.getList('/repartidores').then((val) => val.map((e) => e as Map<String, dynamic>).toList()),
              builder: (context, snapshot) {
                if (!snapshot.hasData) return const SizedBox.shrink();

                return Container(
                   height: 36, 
                   padding: const EdgeInsets.symmetric(horizontal: 12),
                   decoration: BoxDecoration(
                     color: AppTheme.darkCard,
                     borderRadius: BorderRadius.circular(12),
                     border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
                   ),
                   child: DropdownButtonHideUnderline(
                     child: DropdownButton<String>(
                       value: filter.selectedVendor,
                       hint: const Text('Ver como...', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                       icon: const Icon(Icons.arrow_drop_down, color: AppTheme.neonBlue),
                       dropdownColor: AppTheme.darkCard,
                       isExpanded: true,
                       style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
                       items: snapshot.data!.map((r) => DropdownMenuItem(
                         value: r['code'].toString(),
                         child: Text('${r['code']} - ${r['name']}', overflow: TextOverflow.ellipsis),
                       )).toList(),
                       onChanged: (val) {
                         if (val != null) {
                           filter.setVendor(val);
                           entregas.setRepartidor(val);
                           entregas.cargarAlbaranesPendientes();
                         }
                       },
                     ),
                   ),
                );
              }
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.refresh, color: AppTheme.neonBlue),
            tooltip: 'Recargar datos',
            onPressed: () {
               // Force reload logic
               if (filter.selectedVendor != null) {
                 entregas.setRepartidor(filter.selectedVendor!);
                 entregas.cargarAlbaranesPendientes();
               }
            },
          ),
        ],
      ),
    );
  }

  void _showDetailDialog(AlbaranEntrega albaran) {
    showModalBottomSheet(
      context: context, 
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => RuteroDetailModal(albaran: albaran),
    ).then((_) {
      // Refresh list to reflect changes (e.g. status update)
      if (mounted) {
         final provider = Provider.of<EntregasProvider>(context, listen: false);
         provider.cargarAlbaranesPendientes();
      }
    });
  }
}
