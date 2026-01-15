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
          // HEADER
          SmartSyncHeader(
            title: 'Rutero Reparto',
            subtitle: currentName,
            onSync: () => _loadData(),
            isLoading: entregas.isLoading || _isLoadingWeek,
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

          // SEARCH & SORT ROW
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                // Search TextField
                Expanded(
                  child: Container(
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceColor,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Colors.grey.shade700),
                    ),
                    child: TextField(
                      decoration: const InputDecoration(
                        hintText: 'Buscar cliente...',
                        hintStyle: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                        prefixIcon: Icon(Icons.search, color: AppTheme.textSecondary, size: 20),
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(vertical: 10),
                      ),
                      style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
                      onChanged: (value) {
                        Future.delayed(const Duration(milliseconds: 500), () {
                          entregas.setSearchQuery(value);
                        });
                      },
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                // Sort Dropdown
                Container(
                  height: 40,
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

          // PAYMENT TYPE FILTER CHIPS
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                _buildFilterChip('Todos', entregas.filterTipoPago.isEmpty, () => entregas.setFilterTipoPago(''), Colors.grey),
                const SizedBox(width: 6),
                _buildFilterChip('🔴 A Cobrar', entregas.filterDebeCobrar == 'S', () => entregas.setFilterDebeCobrar(entregas.filterDebeCobrar == 'S' ? '' : 'S'), AppTheme.error),
                const SizedBox(width: 6),
                _buildFilterChip('CONTADO', entregas.filterTipoPago == 'CONTADO', () => entregas.setFilterTipoPago(entregas.filterTipoPago == 'CONTADO' ? '' : 'CONTADO'), AppTheme.error),
                const SizedBox(width: 6),
                _buildFilterChip('CRÉDITO', entregas.filterTipoPago == 'CREDITO', () => entregas.setFilterTipoPago(entregas.filterTipoPago == 'CREDITO' ? '' : 'CREDITO'), AppTheme.success),
                const SizedBox(width: 6),
                _buildFilterChip('DOMICILIADO', entregas.filterTipoPago == 'DOMICILIADO', () => entregas.setFilterTipoPago(entregas.filterTipoPago == 'DOMICILIADO' ? '' : 'DOMICILIADO'), AppTheme.success),
                const SizedBox(width: 6),
                _buildFilterChip('TRANSF.', entregas.filterTipoPago == 'TRANSFERENCIA', () => entregas.setFilterTipoPago(entregas.filterTipoPago == 'TRANSFERENCIA' ? '' : 'TRANSFERENCIA'), AppTheme.warning),
              ],
            ),
          ),
          const SizedBox(height: 8),

          // SUMMARY BAR
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 12),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.darkSurface, AppTheme.surfaceColor],
              ),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.grey.shade700),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildSummaryItem('Total', entregas.resumenTotalBruto, AppTheme.textPrimary),
                Container(width: 1, height: 30, color: Colors.grey.shade600),
                _buildSummaryItem('A Cobrar', entregas.resumenTotalACobrar, AppTheme.error),
                Container(width: 1, height: 30, color: Colors.grey.shade600),
                _buildSummaryItem('Opcional', entregas.resumenTotalOpcional, AppTheme.warning),
              ],
            ),
          ),
          const SizedBox(height: 8),

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
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: AppTheme.darkSurface,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Left: Week Navigation
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left, color: AppTheme.textSecondary),
                onPressed: () => _changeWeek(-1),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Text(
                    'Semana $weekNum',
                    style: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                  Text(
                    weekRange,
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right, color: AppTheme.textSecondary),
                onPressed: () => _changeWeek(1),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              ),
            ],
          ),
          
          // Right: Client Count
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: AppTheme.neonBlue.withOpacity(0.1),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.people_alt_outlined, size: 16, color: AppTheme.neonBlue),
                const SizedBox(width: 6),
                Text(
                  '$totalClients Clientes',
                  style: const TextStyle(
                    color: AppTheme.neonBlue,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
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
    return Container(
      height: 85,
      color: AppTheme.surfaceColor, 
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        itemCount: _weekDays.length,
        itemBuilder: (context, index) {
          final dayData = _weekDays[index];
          final date = DateTime.parse(dayData['date']);
          final isSelected = DateUtils.isSameDay(date, _selectedDate);
          final status = dayData['status'];
          final count = dayData['clients'] ?? 0;

          Color bgColor = AppTheme.darkCard;
          Color borderColor = Colors.white.withOpacity(0.1);
          Color textColor = AppTheme.textSecondary;
          
          if (status == 'good') {
            bgColor = AppTheme.success.withOpacity(0.1);
            borderColor = AppTheme.success.withOpacity(0.3);
            textColor = AppTheme.success;
          } else if (status == 'bad') {
            bgColor = AppTheme.error.withOpacity(0.1);
            borderColor = AppTheme.error.withOpacity(0.3);
            textColor = AppTheme.error;
          }

          if (isSelected) {
            bgColor = AppTheme.neonBlue;
            borderColor = AppTheme.neonBlue;
            textColor = AppTheme.darkBase;
          }

          return GestureDetector(
            onTap: () => _onDaySelected(date),
            child: Container(
              width: 55,
              margin: const EdgeInsets.only(right: 6),
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: borderColor, width: 1.5),
                boxShadow: isSelected ? [
                  BoxShadow(color: AppTheme.neonBlue.withOpacity(0.4), blurRadius: 4, offset:const Offset(0, 2))
                ] : null
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    dayData['dayName'] ?? '',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: textColor.withOpacity(isSelected ? 0.9 : 0.7),
                    ),
                  ),
                  Text(
                    '${dayData['day']}',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      color: textColor,
                    ),
                  ),
                  if (count > 0 || status != 'none')
                     Container(
                       margin: const EdgeInsets.only(top: 2),
                       width: 6,
                       height: 6,
                       decoration: BoxDecoration(
                         shape: BoxShape.circle,
                         color: isSelected ? AppTheme.darkBase : (status == 'good' ? AppTheme.success : (status == 'bad' ? AppTheme.error : Colors.grey)),
                       ),
                     )
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildClientList(EntregasProvider provider) {
    if (provider.albaranes.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.assignment_turned_in_outlined, size: 64, color: AppTheme.textSecondary),
            SizedBox(height: 16),
            Text('No hay entregas para este día', style: TextStyle(color: AppTheme.textSecondary, fontSize: 16)),
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


  Widget _buildClientCard(AlbaranEntrega albaran) {
    // "Stapled" visual effect variables
    final bool isPendiente = albaran.estado == EstadoEntrega.pendiente;
    final bool isEntregado = albaran.estado == EstadoEntrega.entregado;
    final Color statusColor = isEntregado ? AppTheme.success : (isPendiente ? AppTheme.error : Colors.orange);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      // Stack for the "Stapled" effect
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // Background "Invoice" Card (The paper behind)
          Positioned(
            top: -4,
            left: 4,
            right: -4,
            bottom: 4,
            child: Container(
              decoration: BoxDecoration(
                color: const Color(0xFFF5F5F5), // Light paper color
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.grey.shade300),
              ),
              child: const Align(
                alignment: Alignment.topRight,
                child: Padding(
                  padding: EdgeInsets.all(8.0),
                  child: Icon(Icons.receipt_long, color: Colors.grey, size: 20),
                ),
              ),
            ),
          ),
          
          // Main "Albaran" Card
          Card(
            margin: EdgeInsets.zero,
            elevation: 4,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            color: AppTheme.darkSurface, // Keep dark theme consistent
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
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Header: ID and Amount
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Left: ID & Label
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppTheme.darkBase,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: Colors.grey.withOpacity(0.3)),
                              ),
                              child: Text(
                                'ALB #${albaran.numeroAlbaran}',
                                style: const TextStyle(
                                  color: AppTheme.textSecondary,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            if (albaran.numeroFactura > 0) ...[
                               const SizedBox(height: 4),
                               Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppTheme.neonBlue.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(4),
                                    border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.receipt, size: 10, color: AppTheme.neonBlue),
                                      const SizedBox(width: 4),
                                      Text(
                                        'FAC: ${albaran.serieFactura}-${albaran.numeroFactura}',
                                        style: const TextStyle(
                                          color: AppTheme.neonBlue,
                                          fontWeight: FontWeight.w600,
                                          fontSize: 10,
                                        ),
                                      ),
                                    ],
                                  )
                               ),
                            ],
                            const SizedBox(height: 4),
                            // Staple Visual (Icon)
                            RotationTransition(
                              turns: const AlwaysStoppedAnimation(-0.1),
                              child: Icon(Icons.attach_file, color: Colors.grey.shade400, size: 18),
                            ),
                          ],
                        ),
                        
                        // Right: Amount (Big & Bold)
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              NumberFormat.currency(symbol: '€', locale: 'es_ES').format(albaran.importeTotal),
                              style: TextStyle(
                                color: statusColor, // Green or Red
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                                letterSpacing: -0.5,
                              ),
                            ),
                            if (isPendiente)
                              Tooltip(
                                message: "Estado basado en gestión interna de DSEDAC",
                                triggerMode: TooltipTriggerMode.tap,
                                child: Row(
                                  children: [
                                    Icon(Icons.info_outline, size: 14, color: AppTheme.textSecondary),
                                    const SizedBox(width: 4),
                                    Text(
                                      "PENDIENTE",
                                      style: TextStyle(
                                        color: AppTheme.textSecondary,
                                        fontSize: 10,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    
                     // Client Info with Code
                    RichText(
                      text: TextSpan(
                        children: [
                          TextSpan(
                            text: '${albaran.codigoCliente} ',
                            style: const TextStyle(
                              fontFamily: 'Outfit',
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.neonBlue,
                            ),
                          ),
                          TextSpan(
                            text: albaran.nombreCliente,
                            style: const TextStyle(
                              fontFamily: 'Outfit',
                              fontSize: 18,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ],
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                         Icon(Icons.location_on_outlined, size: 14, color: AppTheme.textSecondary),
                         const SizedBox(width: 4),
                         Expanded(
                           child: Text(
                             "${albaran.direccion}, ${albaran.poblacion}",
                             style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                             maxLines: 1,
                             overflow: TextOverflow.ellipsis,
                           ),
                         ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    // Payment Condition Badge - colored by backend status
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: _getPaymentColor(albaran.colorEstado).withOpacity(0.15),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: _getPaymentColor(albaran.colorEstado).withOpacity(0.5),
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                albaran.esCTR ? Icons.payments_rounded : 
                                  (albaran.puedeCobrarse ? Icons.account_balance_wallet : Icons.credit_card),
                                size: 16,
                                color: _getPaymentColor(albaran.colorEstado),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                albaran.esCTR ? '💰 COBRAR' : 
                                  (albaran.puedeCobrarse ? 'OPCIONAL' : 'CRÉDITO'),
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: _getPaymentColor(albaran.colorEstado),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        // Payment type description
                        Expanded(
                          child: Text(
                            albaran.formaPagoDesc.isNotEmpty 
                                ? albaran.formaPagoDesc 
                                : albaran.formaPago,
                            style: const TextStyle(
                              fontSize: 11, 
                              color: AppTheme.textSecondary,
                              fontWeight: FontWeight.w500,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
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

  void _showDetailDialog(AlbaranEntrega albaran) {
    final entregasProvider = Provider.of<EntregasProvider>(context, listen: false);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent, // Important for custom border radius
      builder: (context) => ChangeNotifierProvider.value(
        value: entregasProvider,
        child: _DetailSheet(albaran: albaran),
      ),
    );
  }
}

// INLINE DETAIL SHEET
class _DetailSheet extends StatefulWidget {
  final AlbaranEntrega albaran;
  const _DetailSheet({required this.albaran});
  @override
  State<_DetailSheet> createState() => _DetailSheetState();
}

class _DetailSheetState extends State<_DetailSheet> {
  late AlbaranEntrega _details;
  bool _loading = true;
  String _error = '';
  
  // Advanced State
  final Map<String, double> _qtyParams = {};
  final Map<String, String> _obsParams = {};
  
  // Global observation
  final TextEditingController _obsController = TextEditingController();
  
  // SIGNATURE
  final SignatureController _sigController = SignatureController(
    penStrokeWidth: 3,
    penColor: Colors.white,
    exportBackgroundColor: Colors.transparent,
  );
  bool _showSignaturePad = false;

  // DNI and Name for signature
  final TextEditingController _dniController = TextEditingController();
  final TextEditingController _nombreReceptorController = TextEditingController();
  
  // Cobro (Payment)
  final TextEditingController _cobroController = TextEditingController();
  final TextEditingController _cobroObsController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadDetails();
  }

  @override
  void dispose() {
    _obsController.dispose();
    _sigController.dispose();
    _dniController.dispose();
    _nombreReceptorController.dispose();
    _cobroController.dispose();
    _cobroObsController.dispose();
    super.dispose();
  }

  Future<void> _loadDetails() async {
    try {
       final provider = Provider.of<EntregasProvider>(context, listen: false);
       final full = await provider.obtenerDetalleAlbaran(
           widget.albaran.numeroAlbaran, 
           widget.albaran.ejercicio, 
           widget.albaran.serie,
           widget.albaran.terminal
       );
       if (mounted) {
         if (full != null) {
           setState(() {
             _details = full;
             _loading = false;
             // Initialize Inputs
             for(var i in _details.items) {
               _qtyParams[i.codigoArticulo] = i.cantidadPedida; // Default to full delivery
               _obsParams[i.codigoArticulo] = '';
             }
           });
         } else {
           setState(() { _error = 'No se pudo cargar detalles'; _loading = false; });
         }
       }
    } catch(e) {
      if(mounted) setState(() { _error = 'Error: $e'; _loading = false; });
    }
  }

  // Helpers
  bool get _allMatched => _details.items.every((i) => 
      (_qtyParams[i.codigoArticulo] ?? 0) == i.cantidadPedida);
      
  double get _currentTotal {
      if (_loading) return 0;
      double total = 0;
      for (var i in _details.items) {
          double qty = _qtyParams[i.codigoArticulo] ?? 0;
          double price = i.precioUnitario;
          total += (qty * price); 
      }
      return total.abs() > 0 ? total : widget.albaran.importeTotal; // Fallback if price is 0
  }

  void _onConfirmationPressed() {
      // Validation: Check if any discrepancy exists without observation
      for(var i in _details.items) {
          double current = _qtyParams[i.codigoArticulo] ?? 0;
          if (current != i.cantidadPedida) {
              String obs = _obsParams[i.codigoArticulo] ?? '';
              if (obs.trim().isEmpty) {
                   ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                      content: Text('Falta motivo/observación en ${i.descripcion}'),
                      backgroundColor: AppTheme.error,
                   ));
                   return;
              }
          }
      }
      
      _showFinalConfirmationDialog();
  }

  Future<void> _showFinalConfirmationDialog() async {
      final confirm = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (ctx) => AlertDialog(
              backgroundColor: AppTheme.darkSurface,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: const Row(
                  children: [
                      Icon(Icons.warning_amber_rounded, color: AppTheme.warning, size: 28),
                      SizedBox(width: 12),
                      Text('Confirmar Entrega', style: TextStyle(color: AppTheme.textPrimary)),
                  ],
              ),
              content: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                      Text('Albarán: #${widget.albaran.numeroAlbaran}', style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
                      const SizedBox(height: 8),
                      Text('Cliente: ${widget.albaran.nombreCliente}', style: const TextStyle(color: AppTheme.textSecondary)),
                      const SizedBox(height: 12),
                      Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                              color: AppTheme.darkBase,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: AppTheme.borderColor)
                          ),
                          child: Column(
                              children: [
                                  Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                          const Text('Total Original:', style: TextStyle(color: AppTheme.textSecondary)),
                                          Text('${widget.albaran.importeTotal.toStringAsFixed(2)} €', style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.bold)),
                                      ],
                                  ),
                                  const SizedBox(height: 4),
                                  Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                          const Text('Total Final:', style: TextStyle(color: AppTheme.textSecondary)),
                                          Text('${_currentTotal.toStringAsFixed(2)} €', style: const TextStyle(color: AppTheme.neonBlue, fontWeight: FontWeight.bold, fontSize: 16)),
                                      ],
                                  ),
                              ],
                          ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                          '¿Estás seguro de marcar este albarán como ENTREGADO?\nEsta acción es irreversible y afectará los registros de facturación.',
                          style: TextStyle(color: AppTheme.textSecondary, height: 1.5),
                      ),
                  ],
              ),
              actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('Cancelar', style: TextStyle(color: AppTheme.textSecondary)),
                  ),
                  ElevatedButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.success,
                          foregroundColor: Colors.white,
                      ),
                      child: const Text('Confirmar y Firmar'),
                  ),
              ],
          ),
      );

      if (confirm == true) {
          setState(() {
               _showSignaturePad = true;
          });
      }
  }

  Future<void> _submit() async {
     // Validate DNI and Name
     final dni = _dniController.text.trim();
     final nombre = _nombreReceptorController.text.trim();
     
     if (nombre.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('El nombre del receptor es obligatorio'),
          backgroundColor: AppTheme.warning,
        ));
        return;
     }
     
     if (dni.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('El DNI/NIF es obligatorio'),
          backgroundColor: AppTheme.warning,
        ));
        return;
     }

     // Validate Cobro for CTR (mandatory payment)
     if (widget.albaran.esCTR) {
        final cobroText = _cobroController.text.trim();
        final cobroAmount = double.tryParse(cobroText) ?? 0;
        final expectedAmount = _currentTotal;
        
        if (cobroAmount != expectedAmount && _cobroObsController.text.trim().isEmpty) {
           ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
             content: Text('Debe explicar la diferencia en el cobro'),
             backgroundColor: AppTheme.error,
           ));
           return;
        }
     }

     if (_sigController.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('La firma es obligatoria'),
          backgroundColor: AppTheme.warning,
        ));
        return;
     }

     // Process
     try {
       // Get Signature
       final Uint8List? sigBytes = await _sigController.toPngBytes();
       if (sigBytes == null) return;
       final String base64Sig = base64Encode(sigBytes);
       
       // Global Obs + Item Obs
       String globalObs = _obsController.text.trim();
       // Note: Currently backend only accepts one global observation field.
       // We should concatenate item observations if backend doesn't support lines update yet, 
       // OR if we update backend to support lines, we send them.
       // Given user request "Implementa ... backend ... updates en endpoints", I will assume we might need to send a formatted string 
       // or we just send the discrepancies in the global observation for now to be safe until backend schema verification for lines update.
       // Let's construct a detailed observation string for safety.
       
       StringBuffer fullObs = StringBuffer();
       if (globalObs.isNotEmpty) fullObs.writeln("Nota General: $globalObs");
       
       _details.items.forEach((item) {
           double qty = _qtyParams[item.codigoArticulo] ?? 0;
           String itemObs = _obsParams[item.codigoArticulo] ?? '';
           if (qty != item.cantidadPedida || itemObs.isNotEmpty) {
               fullObs.writeln("[${item.codigoArticulo}] Entregado: $qty (Solicitado: ${item.cantidadPedida}). $itemObs");
           }
       });

       final provider = Provider.of<EntregasProvider>(context, listen: false);
       bool success = false;
        
       // Use ALL MATCHED logic for Entregado/Parcial status
       if (_allMatched) {
         success = await provider.marcarEntregado(
           albaranId: widget.albaran.id,
           firma: base64Sig,
           observaciones: fullObs.toString().trim().isNotEmpty ? fullObs.toString() : null,
         );
       } else {
         success = await provider.marcarParcial(
           albaranId: widget.albaran.id,
           observaciones: fullObs.toString(),
           firma: base64Sig,
         );
       }
       
       if (mounted) {
         if (success) {
            Navigator.pop(context);
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text('Entrega registrada correctamente'),
                backgroundColor: AppTheme.success,
            ));
         } else {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                content: Text('Error al guardar: ${provider.error ?? "Desconocido"}'),
                backgroundColor: AppTheme.error,
            ));
         }
       }
     } catch (e) {
       print(e);
       if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text('Error: $e'),
              backgroundColor: AppTheme.error,
          ));
       }
     }
  }

  Widget _buildEditableItemRow(EntregaItem item) {
      final double requested = item.cantidadPedida;
      final double current = _qtyParams[item.codigoArticulo] ?? 0;
      final bool isMatch = current == requested;
      final double price = item.precioUnitario;
      final double subtotal = current * price;
      
      String uom = 'Uds';
      if (item.unit != null && item.unit!.isNotEmpty) {
          uom = item.unit!; 
          if (uom == 'UNIDAD') uom = 'Uds';
      }

      return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
              color: AppTheme.darkBase,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                  color: isMatch ? AppTheme.success.withOpacity(0.3) : AppTheme.error.withOpacity(0.5),
                  width: 1.5
              )
          ),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                  // Row 1: Name
                  Text(
                      item.descripcion.isNotEmpty ? item.descripcion : 'Art. ${item.codigoArticulo}', 
                      style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 16)
                  ),
                  const SizedBox(height: 12),
                  
                  // Row 2: Comparison (Requested vs Delivered)
                  Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                           // Left: Requested
                           Container(
                               padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                               decoration: BoxDecoration(
                                   color: AppTheme.neonBlue.withOpacity(0.1),
                                   borderRadius: BorderRadius.circular(8),
                                   border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3))
                               ),
                               child: Column(
                                   crossAxisAlignment: CrossAxisAlignment.start,
                                   children: [
                                       const Text('PEDIDO', style: TextStyle(color: AppTheme.neonBlue, fontSize: 10, fontWeight: FontWeight.bold)),
                                       Text(
                                           '${requested.toStringAsFixed(0)} $uom', 
                                           style: const TextStyle(color: AppTheme.textPrimary, fontSize: 18, fontWeight: FontWeight.bold)
                                       ),
                                   ],
                               ),
                           ),
                           
                           // Right: Delivered Input
                           Container(
                               decoration: BoxDecoration(
                                   color: AppTheme.darkSurface,
                                   borderRadius: BorderRadius.circular(8),
                                   border: Border.all(color: isMatch ? AppTheme.borderColor : AppTheme.error)
                               ),
                               child: Row(
                                   children: [
                                       // Check Button (Quick verify)
                                       IconButton(
                                           icon: Icon(
                                               isMatch ? Icons.check_circle : Icons.check_circle_outline, 
                                               color: isMatch ? AppTheme.success : AppTheme.textSecondary.withOpacity(0.5)
                                           ),
                                           padding: EdgeInsets.zero,
                                           constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                                           onPressed: () {
                                               setState(() {
                                                   if (!isMatch) {
                                                       // Mark as correct
                                                       _qtyParams[item.codigoArticulo] = requested;
                                                       _obsParams[item.codigoArticulo] = '';
                                                   } else {
                                                       // Toggle off? Or just leave it. 
                                                       // User asked "if line by line goes accepting". So setting to correct is key.
                                                       // Maybe if already match, set to 0? No, that's dangerous.
                                                       // Let's just re-confirm.
                                                   }
                                               });
                                           },
                                       ),
                                       Container(width: 1, height: 30, color: AppTheme.borderColor),
                                       
                                       IconButton(
                                           icon: const Icon(Icons.remove, color: AppTheme.textSecondary),
                                           onPressed: () {
                                               setState(() {
                                                   double val = _qtyParams[item.codigoArticulo] ?? 0;
                                                   if (val > 0) _qtyParams[item.codigoArticulo] = val - 1;
                                               });
                                           },
                                       ),
                                       GestureDetector(
                                           onTap: () => _showQuantityDialog(item, current),
                                           child: Container(
                                               width: 60,
                                               height: 48,
                                               alignment: Alignment.center,
                                               decoration: BoxDecoration(
                                                  color: AppTheme.darkBase,
                                                  borderRadius: BorderRadius.circular(4),
                                                  border: Border.all(color: AppTheme.borderColor.withOpacity(0.3))
                                               ),
                                               child: Text(
                                                   current.toStringAsFixed(0),
                                                   style: TextStyle(
                                                       fontSize: 20, 
                                                       fontWeight: FontWeight.bold,
                                                       color: isMatch ? AppTheme.success : AppTheme.error
                                                   ),
                                               ),
                                           ),
                                       ),
                                       IconButton(
                                           icon: const Icon(Icons.add, color: AppTheme.textSecondary),
                                           onPressed: () {
                                                setState(() {
                                                   double val = _qtyParams[item.codigoArticulo] ?? 0;
                                                   _qtyParams[item.codigoArticulo] = val + 1;
                                                });
                                           },
                                       ),
                                   ],
                               ),
                           )
                      ],
                  ),
                  
                  const SizedBox(height: 8),
                  
                  // Row 3: Price & total
                  Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                          Text('${price.toStringAsFixed(2)} €/ud', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                          const SizedBox(width: 8),
                          const Text('|', style: TextStyle(color: AppTheme.textSecondary)),
                          const SizedBox(width: 8),
                          Text('${subtotal.toStringAsFixed(2)} €', style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 14)),
                      ],
                  ),

                  // Row 4: Observation if mismatch
                  if (!isMatch) ...[
                      const SizedBox(height: 12),
                      TextField(
                          controller: TextEditingController(text: _obsParams[item.codigoArticulo])
                            ..selection = TextSelection.collapsed(offset: (_obsParams[item.codigoArticulo] ?? '').length),
                          onChanged: (val) {
                               _obsParams[item.codigoArticulo] = val;
                          },
                          decoration: InputDecoration(
                              labelText: 'Motivo discrepancia (Obligatorio)',
                              labelStyle: const TextStyle(color: AppTheme.error, fontSize: 12),
                              isDense: true,
                              fillColor: AppTheme.error.withOpacity(0.05),
                              filled: true,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: const BorderSide(color: AppTheme.error)),
                              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: const BorderSide(color: AppTheme.error)),
                          ),
                          style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
                      )
                  ]
              ],
          )
      );
  }

  Future<void> _showQuantityDialog(EntregaItem item, double current) async {
      final TextEditingController _controller = TextEditingController(text: current.toStringAsFixed(0));
      _controller.selection = TextSelection(baseOffset: 0, extentOffset: _controller.text.length);
      
      await showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
              backgroundColor: AppTheme.darkSurface,
              title: Text('Cantidad: ${item.descripcion}', style: const TextStyle(color: AppTheme.textPrimary, fontSize: 16)),
              content: TextField(
                  controller: _controller,
                  keyboardType: TextInputType.number,
                  autofocus: true,
                  style: const TextStyle(color: AppTheme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                  decoration: const InputDecoration(
                      border: UnderlineInputBorder(borderSide: BorderSide(color: AppTheme.neonBlue)),
                      focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: AppTheme.neonBlue)),
                  ),
              ),
              actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancelar', style: TextStyle(color: AppTheme.textSecondary)),
                  ),
                  ElevatedButton(
                      onPressed: () {
                          final double? val = double.tryParse(_controller.text);
                          if (val != null) {
                              setState(() {
                                  _qtyParams[item.codigoArticulo] = val;
                              });
                          }
                          Navigator.pop(ctx);
                      },
                      style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonBlue),
                      child: const Text('Aceptar', style: TextStyle(color: AppTheme.darkBase)),
                  )
              ],
          )
      );
  }

  @override
  Widget build(BuildContext context) {
    // FIX: Using dark decoration to prevent white background
    return Container(
      height: MediaQuery.of(context).size.height * 0.9,
      decoration: const BoxDecoration(
        color: AppTheme.darkSurface, // Dark background
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [BoxShadow(blurRadius: 20, color: Colors.black54)]
      ),
      child: Column(
        children: [
          // Header
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppTheme.borderColor))
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.albaran.nombreCliente, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: AppTheme.textPrimary)),
                      Text('${widget.albaran.direccion}', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                    ],
                  ),
                ),
                IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close, color: AppTheme.textPrimary)),
              ],
            ),
          ),
          
          if (_loading) const Expanded(child: Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))),
          
          if (_error.isNotEmpty) 
             Expanded(child: Center(child: Text(_error, style: const TextStyle(color: AppTheme.error)))),

          if (!_loading && _error.isEmpty)
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Info Card (Total)
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.neonBlue.withOpacity(0.05),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3))
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                         const Text('Importe Total:', style: TextStyle(fontWeight: FontWeight.w500, color: AppTheme.textPrimary)),
                         Text('${_currentTotal.toStringAsFixed(2)} €', 
                           style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue, fontSize: 18)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  
                  const Text('Artículos (Detalle)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.textPrimary)),
                  const SizedBox(height: 12),

                  if (_details.items.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(20),
                      alignment: Alignment.center,
                      child: const Column(
                        children: [
                           Icon(Icons.inbox, color: AppTheme.textTertiary, size: 40),
                           SizedBox(height: 8),
                           Text('No hay artículos listados', style: TextStyle(color: AppTheme.textTertiary)),
                        ],
                      ),
                    ),

                  ..._details.items.map((item) => _buildEditableItemRow(item)).toList(),
                  
                  const SizedBox(height: 20),
                  const Divider(color: AppTheme.borderColor),
                  const SizedBox(height: 10),

                  // Global Observations
                  TextField(
                    controller: _obsController,
                    maxLines: 2,
                    decoration: InputDecoration(
                      labelText: 'Observaciones Generales (Opcional)',
                      hintText: 'Añadir nota general...',
                      hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
                      labelStyle: const TextStyle(color: AppTheme.textSecondary),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppTheme.borderColor)),
                      filled: true,
                      fillColor: AppTheme.darkBase,
                    ),
                    style: const TextStyle(color: AppTheme.textPrimary),
                  ),

                  const SizedBox(height: 20),
                  
                  // SIGNATURE PADDLE & ACTIONS
                  if (_showSignaturePad) ...[
                      // DNI and Name Fields
                      Container(
                        padding: const EdgeInsets.all(12),
                        margin: const EdgeInsets.only(bottom: 16),
                        decoration: BoxDecoration(
                          color: AppTheme.darkBase,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Datos del Receptor', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 14)),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _nombreReceptorController,
                              decoration: InputDecoration(
                                labelText: 'Nombre Completo *',
                                hintText: 'Juan García López',
                                prefixIcon: const Icon(Icons.person, color: AppTheme.neonBlue, size: 20),
                                labelStyle: const TextStyle(color: AppTheme.textSecondary),
                                hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppTheme.borderColor)),
                                filled: true,
                                fillColor: AppTheme.darkSurface,
                                isDense: true,
                              ),
                              style: const TextStyle(color: AppTheme.textPrimary),
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _dniController,
                              decoration: InputDecoration(
                                labelText: 'DNI/NIF *',
                                hintText: '12345678A',
                                prefixIcon: const Icon(Icons.badge, color: AppTheme.neonBlue, size: 20),
                                labelStyle: const TextStyle(color: AppTheme.textSecondary),
                                hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppTheme.borderColor)),
                                filled: true,
                                fillColor: AppTheme.darkSurface,
                                isDense: true,
                              ),
                              style: const TextStyle(color: AppTheme.textPrimary),
                              textCapitalization: TextCapitalization.characters,
                            ),
                          ],
                        ),
                      ),
                      
                      // Cobro Section (CTR = Mandatory, Others = Optional)
                      Container(
                        padding: const EdgeInsets.all(12),
                        margin: const EdgeInsets.only(bottom: 16),
                        decoration: BoxDecoration(
                          color: widget.albaran.esCTR ? AppTheme.error.withOpacity(0.1) : AppTheme.success.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: widget.albaran.esCTR ? AppTheme.error.withOpacity(0.5) : AppTheme.success.withOpacity(0.3)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Icon(
                                  widget.albaran.esCTR ? Icons.warning_amber_rounded : Icons.info_outline,
                                  color: widget.albaran.esCTR ? AppTheme.error : AppTheme.success,
                                  size: 20,
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  widget.albaran.esCTR ? 'COBRO OBLIGATORIO' : 'Cobro Opcional',
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold, 
                                    color: widget.albaran.esCTR ? AppTheme.error : AppTheme.success,
                                    fontSize: 14,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('Debe Cobrar:', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                                      Text(
                                        '${_currentTotal.toStringAsFixed(2)} €',
                                        style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.bold, fontSize: 18),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: TextField(
                                    controller: _cobroController,
                                    keyboardType: TextInputType.numberWithOptions(decimal: true),
                                    decoration: InputDecoration(
                                      labelText: 'Cobrado',
                                      prefixIcon: const Icon(Icons.euro, color: AppTheme.neonBlue, size: 18),
                                      labelStyle: const TextStyle(color: AppTheme.textSecondary),
                                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppTheme.borderColor)),
                                      filled: true,
                                      fillColor: AppTheme.darkSurface,
                                      isDense: true,
                                    ),
                                    style: const TextStyle(color: AppTheme.textPrimary, fontSize: 16, fontWeight: FontWeight.bold),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _cobroObsController,
                              maxLines: 2,
                              decoration: InputDecoration(
                                labelText: widget.albaran.esCTR ? 'Observaciones Cobro (Obligatorio si difiere)' : 'Observaciones Cobro (Opcional)',
                                hintText: 'Ej: Pagó parcial, resto pendiente...',
                                hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
                                labelStyle: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppTheme.borderColor)),
                                filled: true,
                                fillColor: AppTheme.darkSurface,
                                isDense: true,
                              ),
                              style: const TextStyle(color: AppTheme.textPrimary),
                            ),
                          ],
                        ),
                      ),
                      
                      const Text('Firma Obligatoria', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                      const SizedBox(height: 8),
                      Container(
                      height: 200,
                      decoration: BoxDecoration(
                        color: AppTheme.darkBase,
                        border: Border.all(color: AppTheme.neonBlue),
                        borderRadius: BorderRadius.circular(8)
                      ),
                      child: Signature(
                        controller: _sigController,
                        backgroundColor: AppTheme.darkBase,
                        width: MediaQuery.of(context).size.width - 64, 
                        height: 198,
                      ),
                    ),
                    Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                            TextButton(onPressed: () => _sigController.clear(), child: const Text('Borrar Firma', style: TextStyle(color: AppTheme.error))),
                        ],
                    ),
                    const SizedBox(height: 20),
                    ElevatedButton(
                        onPressed: _submit,
                        style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.neonBlue,
                            foregroundColor: AppTheme.darkBase,
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            minimumSize: const Size(double.infinity, 50)
                        ),
                        child: const Text('FINALIZAR ENTREGA', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    )
                  ] else ...[
                     ElevatedButton(
                        onPressed: _onConfirmationPressed,
                        style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.neonBlue,
                            foregroundColor: AppTheme.darkBase,
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            minimumSize: const Size(double.infinity, 50)
                        ),
                        child: const Text('FIRMAR Y CONFIRMAR', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    )
                  ],
                  const SizedBox(height: 40), // Bottom padding
                ],
              ),

            ),


        ],
      ),
    );
  }
}
