/// REPARTIDOR RUTERO PAGE
/// Pestaña principal con ruta del día y cobros integrados
/// Color-coded: verde=cobrado/completado, rojo=pendiente

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../entregas/providers/entregas_provider.dart';
import '../widgets/signature_modal.dart';
import '../widgets/delivery_item_list.dart';

/// Página principal del Rutero para Repartidores
/// Muestra lista de clientes del día con estados de cobro/entrega
class RepartidorRuteroPage extends StatefulWidget {
  final String repartidorId;

  const RepartidorRuteroPage({
    super.key,
    required this.repartidorId,
  });

  @override
  State<RepartidorRuteroPage> createState() => _RepartidorRuteroPageState();
}

class _RepartidorRuteroPageState extends State<RepartidorRuteroPage> {
  final _currencyFormat = NumberFormat.currency(locale: 'es_ES', symbol: '€');
  final TextEditingController _searchController = TextEditingController();
  DateTime _selectedDate = DateTime.now();
  String? _selectedClientId;
  bool _isRefreshing = false;
  
  // Filtros
  String? _statusFilter; // null = todos, 'completed' = completados, 'ctr' = CTR pendiente, 'pending' = pendiente

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() => _isRefreshing = true);
    try {
      final provider = context.read<EntregasProvider>();
      provider.setRepartidor(widget.repartidorId);
      await provider.cargarAlbaranesPendientes();
    } finally {
      if (mounted) {
        setState(() => _isRefreshing = false);
      }
    }
  }

  List<AlbaranEntrega> _filterAlbaranes(List<AlbaranEntrega> albaranes) {
    return albaranes.where((a) {
      // Filtro por búsqueda de texto
      final query = _searchController.text.toLowerCase();
      if (query.isNotEmpty) {
        final matchesSearch = a.nombreCliente.toLowerCase().contains(query) ||
            a.codigoCliente.toLowerCase().contains(query) ||
            a.numeroAlbaran.toString().contains(query);
        if (!matchesSearch) return false;
      }

      // Filtro por estado
      if (_statusFilter != null) {
        final isCompleted = a.estado == EstadoEntrega.entregado;
        final isCTR = a.esCTR && !isCompleted;
        
        switch (_statusFilter) {
          case 'completed':
            if (!isCompleted) return false;
            break;
          case 'ctr':
            if (!isCTR) return false;
            break;
          case 'pending':
            if (isCompleted || isCTR) return false;
            break;
        }
      }
      
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<EntregasProvider>(
      builder: (context, provider, _) {
        return Scaffold(
          backgroundColor: AppTheme.darkBase,
          body: Column(
            children: [
              // Header
              _buildHeader(provider),
              
              // Content
              Expanded(
                child: _selectedClientId != null
                    ? _buildClientDetail(provider)
                    : _buildClientList(provider),
              ),
            ],
          ),
          floatingActionButton: _selectedClientId == null
              ? FloatingActionButton.extended(
                  onPressed: _loadData,
                  icon: Icon(_isRefreshing ? Icons.sync : Icons.refresh),
                  label: Text(_isRefreshing ? 'Actualizando...' : 'Actualizar'),
                  backgroundColor: AppTheme.neonBlue,
                )
              : null,
        );
      },
    );
  }

  Widget _buildHeader(EntregasProvider provider) {
    final totalPendientes = provider.albaranesPendientes.length;
    final totalEntregados = provider.albaranesEntregados.length;
    final importeCTR = provider.importeTotalCTR;

    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppTheme.surfaceColor,
            AppTheme.surfaceColor.withOpacity(0.8),
          ],
        ),
        border: Border(
          bottom: BorderSide(
            color: AppTheme.neonBlue.withOpacity(0.2),
            width: 1,
          ),
        ),
      ),
      child: Column(
        children: [
          // Top bar with back button (if in detail) and title
          Row(
            children: [
              if (_selectedClientId != null) ...[
                IconButton(
                  onPressed: () => setState(() => _selectedClientId = null),
                  icon: const Icon(Icons.arrow_back, color: AppTheme.textPrimary),
                ),
                const SizedBox(width: 8),
              ] else ...[
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        AppTheme.neonBlue.withOpacity(0.2),
                        AppTheme.neonPurple.withOpacity(0.2),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(
                    Icons.route,
                    color: AppTheme.neonBlue,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 12),
              ],
              
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _selectedClientId != null ? 'Detalle Entrega' : 'Rutero del Día',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    Text(
                      DateFormat('EEEE, d MMMM yyyy', 'es').format(_selectedDate),
                      style: TextStyle(
                        fontSize: 12,
                        color: AppTheme.textSecondary.withOpacity(0.8),
                      ),
                    ),
                  ],
                ),
              ),
              
              // Stats badges
              if (_selectedClientId == null) ...[
                _buildStatBadge(
                  icon: Icons.pending_actions,
                  label: 'Pendientes',
                  value: '$totalPendientes',
                  color: Colors.orange,
                ),
                const SizedBox(width: 8),
                _buildStatBadge(
                  icon: Icons.check_circle,
                  label: 'Entregados',
                  value: '$totalEntregados',
                  color: AppTheme.success,
                ),
                const SizedBox(width: 8),
                _buildStatBadge(
                  icon: Icons.euro,
                  label: 'CTR',
                  value: _currencyFormat.format(importeCTR),
                  color: AppTheme.neonPurple,
                  isLarge: true,
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatBadge({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
    bool isLarge = false,
  }) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isLarge ? 14 : 10,
        vertical: 8,
      ),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 6),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(fontSize: 9, color: color.withOpacity(0.8))),
              Text(value, style: TextStyle(
                fontSize: isLarge ? 14 : 12,
                fontWeight: FontWeight.bold,
                color: color,
              )),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildClientList(EntregasProvider provider) {
    if (provider.isLoading) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: AppTheme.neonBlue),
            SizedBox(height: 16),
            Text('Cargando ruta del día...', style: TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    if (provider.error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: AppTheme.error),
            const SizedBox(height: 16),
            Text(provider.error!, style: const TextStyle(color: AppTheme.textSecondary)),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _loadData,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
              style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonBlue),
            ),
          ],
        ),
      );
    }

    final albaranes = _filterAlbaranes(provider.albaranes);
    final totalAlbaranes = provider.albaranes.length;
    
    return Column(
      children: [
        // === SEARCH BAR + FILTER CHIPS ===
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Column(
            children: [
              // Search bar
              TextField(
                controller: _searchController,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: 'Buscar cliente o albarán...',
                  hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
                  prefixIcon: const Icon(Icons.search, color: AppTheme.textSecondary),
                  suffixIcon: _searchController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, color: AppTheme.textSecondary),
                          onPressed: () {
                            _searchController.clear();
                            setState(() {});
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: AppTheme.surfaceColor,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: AppTheme.neonBlue),
                  ),
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                ),
                style: const TextStyle(color: AppTheme.textPrimary),
              ),
              
              const SizedBox(height: 10),
              
              // Filter chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _buildFilterChip(
                      icon: Icons.all_inclusive,
                      label: 'Todos',
                      isActive: _statusFilter == null,
                      color: AppTheme.neonBlue,
                      onTap: () => setState(() => _statusFilter = null),
                    ),
                    const SizedBox(width: 8),
                    _buildFilterChip(
                      icon: Icons.check_circle,
                      label: 'Completados',
                      isActive: _statusFilter == 'completed',
                      color: AppTheme.success,
                      onTap: () => setState(() => _statusFilter = 'completed'),
                    ),
                    const SizedBox(width: 8),
                    _buildFilterChip(
                      icon: Icons.warning,
                      label: 'CTR',
                      isActive: _statusFilter == 'ctr',
                      color: AppTheme.error,
                      onTap: () => setState(() => _statusFilter = 'ctr'),
                    ),
                    const SizedBox(width: 8),
                    _buildFilterChip(
                      icon: Icons.pending,
                      label: 'Pendientes',
                      isActive: _statusFilter == 'pending',
                      color: Colors.orange,
                      onTap: () => setState(() => _statusFilter = 'pending'),
                    ),
                  ],
                ),
              ),
              
              const SizedBox(height: 8),
              
              // Results count
              Row(
                children: [
                  Icon(Icons.filter_list, size: 14, color: AppTheme.textSecondary),
                  const SizedBox(width: 6),
                  Text(
                    '${albaranes.length} de $totalAlbaranes entregas',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                ],
              ),
            ],
          ),
        ),
        
        // Albaranes list
        Expanded(
          child: albaranes.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        _statusFilter != null || _searchController.text.isNotEmpty
                            ? Icons.filter_alt_off
                            : Icons.check_circle_outline,
                        size: 64,
                        color: AppTheme.success.withOpacity(0.5),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        _statusFilter != null || _searchController.text.isNotEmpty
                            ? 'No hay entregas que coincidan'
                            : '¡Sin entregas pendientes!',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (_statusFilter != null || _searchController.text.isNotEmpty)
                        TextButton.icon(
                          onPressed: () {
                            setState(() {
                              _statusFilter = null;
                              _searchController.clear();
                            });
                          },
                          icon: const Icon(Icons.clear, size: 16),
                          label: const Text('Limpiar filtros'),
                          style: TextButton.styleFrom(foregroundColor: AppTheme.neonBlue),
                        )
                      else
                        Text(
                          'No hay albaranes asignados para hoy',
                          style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.7)),
                        ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadData,
                  color: AppTheme.neonBlue,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: albaranes.length,
                    itemBuilder: (context, index) {
                      final albaran = albaranes[index];
                      return _buildClientCard(albaran);
                    },
                  ),
                ),
        ),
      ],
    );
  }

  Widget _buildFilterChip({
    required IconData icon,
    required String label,
    required bool isActive,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          gradient: isActive
              ? LinearGradient(
                  colors: [color.withOpacity(0.2), color.withOpacity(0.1)],
                )
              : null,
          color: isActive ? null : AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isActive ? color.withOpacity(0.5) : Colors.white.withOpacity(0.1),
            width: isActive ? 1.5 : 1,
          ),
          boxShadow: isActive
              ? [
                  BoxShadow(
                    color: color.withOpacity(0.2),
                    blurRadius: 8,
                    spreadRadius: 0,
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 16,
              color: isActive ? color : AppTheme.textSecondary,
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                color: isActive ? color : AppTheme.textSecondary,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildClientCard(AlbaranEntrega albaran) {
    // Color coding: verde si entregado, rojo si CTR pendiente, naranja si pendiente normal
    final bool isCompleted = albaran.estado == EstadoEntrega.entregado;
    final bool isCTRPending = albaran.esCTR && !isCompleted;
    
    final Color cardColor = isCompleted
        ? AppTheme.success
        : (isCTRPending ? AppTheme.error : Colors.orange);

    return GestureDetector(
      onTap: () => setState(() => _selectedClientId = albaran.id),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
            colors: [
              cardColor.withOpacity(0.15),
              AppTheme.surfaceColor,
            ],
          ),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: cardColor.withOpacity(0.3), width: 1.5),
        ),
        child: Row(
          children: [
            // Status indicator
            Container(
              width: 4,
              height: 60,
              decoration: BoxDecoration(
                color: cardColor,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(width: 16),
            
            // Client info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTheme.neonBlue.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          albaran.codigoCliente,
                          style: const TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.neonBlue,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      if (albaran.esCTR)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppTheme.error.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: const Text(
                            'CTR',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.error,
                            ),
                          ),
                        ),
                      const Spacer(),
                      Text(
                        _currencyFormat.format(albaran.importeTotal),
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: cardColor,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    albaran.nombreCliente,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textPrimary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    albaran.direccion.isNotEmpty ? albaran.direccion : 'Sin dirección',
                    style: TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary.withOpacity(0.7),
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            
            // Status icon and arrow
            Column(
              children: [
                Icon(
                  isCompleted ? Icons.check_circle : (isCTRPending ? Icons.warning : Icons.pending),
                  color: cardColor,
                  size: 28,
                ),
                const SizedBox(height: 4),
                Text(
                  isCompleted ? 'Completo' : (isCTRPending ? 'Cobrar' : 'Pendiente'),
                  style: TextStyle(fontSize: 9, color: cardColor),
                ),
              ],
            ),
            const SizedBox(width: 8),
            Icon(Icons.chevron_right, color: AppTheme.textSecondary.withOpacity(0.5)),
          ],
        ),
      ),
    );
  }

  Widget _buildClientDetail(EntregasProvider provider) {
    final albaran = provider.albaranes.firstWhere(
      (a) => a.id == _selectedClientId,
      orElse: () => provider.albaranes.first,
    );

    // Convert EntregaItems to DeliveryItems for the widget
    final deliveryItems = albaran.items.map((item) => DeliveryItem(
      id: item.itemId,
      code: item.codigoArticulo,
      description: item.descripcion,
      quantityOrdered: item.cantidadPedida,
      quantityDelivered: item.cantidadEntregada,
      status: _mapStatus(item.estado),
    )).toList();

    final bool requiresPayment = albaran.esCTR && albaran.estado != EstadoEntrega.entregado;
    final bool allItemsDelivered = deliveryItems.every((i) => i.status == ItemDeliveryStatus.delivered);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Albaran header
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.surfaceColor,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white.withOpacity(0.05)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      'Albarán #${albaran.numeroAlbaran}',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const Spacer(),
                    if (albaran.esCTR)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppTheme.error.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.warning_amber, color: AppTheme.error, size: 14),
                            SizedBox(width: 4),
                            Text('CONTADO', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.error)),
                          ],
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Icon(Icons.store, size: 16, color: AppTheme.textSecondary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        albaran.nombreCliente,
                        style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.w500),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Icon(Icons.location_on, size: 16, color: AppTheme.textSecondary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        albaran.direccion.isNotEmpty ? albaran.direccion : 'Sin dirección',
                        style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.8), fontSize: 13),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppTheme.neonBlue.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Importe Total:', style: TextStyle(color: AppTheme.textSecondary)),
                      Text(
                        _currencyFormat.format(albaran.importeTotal),
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.neonBlue,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          
          const SizedBox(height: 20),
          
          // Items section
          const Text(
            'Artículos a Entregar',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
          ),
          const SizedBox(height: 12),
          
          DeliveryItemList(
            items: deliveryItems,
            onItemChanged: (item, status, observations) {
              // Update the provider with item status change
              // This would call the backend to persist the change
              setState(() {
                final originalItem = albaran.items.firstWhere((i) => i.itemId == item.id);
                originalItem.estado = _mapStatusReverse(status);
                originalItem.cantidadEntregada = item.quantityDelivered;
              });
            },
          ),
          
          const SizedBox(height: 24),
          
          // Payment requirement warning for CTR
          if (requiresPayment)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppTheme.error.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppTheme.error.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber, color: AppTheme.error),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Cobro Obligatorio',
                          style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.error),
                        ),
                        Text(
                          'Este albarán es CTR (Contado). Debe cobrar ${_currencyFormat.format(albaran.importeTotal)} antes de completar.',
                          style: TextStyle(fontSize: 12, color: AppTheme.error.withOpacity(0.8)),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          
          const SizedBox(height: 16),
          
          // Action buttons
          Row(
            children: [
              // Complete and Sign button
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: allItemsDelivered ? () => _showSignatureAndComplete(albaran) : null,
                  icon: const Icon(Icons.edit_note),
                  label: const Text('Firmar y Completar'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: allItemsDelivered ? AppTheme.neonGreen : Colors.grey,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ),
            ],
          ),
          
          if (!allItemsDelivered)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Marque todos los artículos como entregados para continuar',
                style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                textAlign: TextAlign.center,
              ),
            ),
          
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Future<void> _showSignatureAndComplete(AlbaranEntrega albaran) async {
    // Show signature modal
    final signature = await SignatureModal.show(
      context,
      title: 'Firma del Cliente',
      subtitle: '${albaran.nombreCliente} - Albarán #${albaran.numeroAlbaran}',
    );

    if (signature != null && mounted) {
      // Save signature and complete delivery
      final provider = context.read<EntregasProvider>();
      
      final success = await provider.marcarEntregado(
        albaranId: albaran.id,
        firma: signature,
        observaciones: 'Entrega completada con firma digital',
      );

      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white),
                const SizedBox(width: 12),
                Text('Entrega ${albaran.numeroAlbaran} completada'),
              ],
            ),
            backgroundColor: AppTheme.success,
            behavior: SnackBarBehavior.floating,
          ),
        );
        
        // Go back to list
        setState(() => _selectedClientId = null);
      }
    }
  }

  ItemDeliveryStatus _mapStatus(EstadoEntrega estado) {
    switch (estado) {
      case EstadoEntrega.entregado:
        return ItemDeliveryStatus.delivered;
      case EstadoEntrega.noEntregado:
      case EstadoEntrega.rechazado:
        return ItemDeliveryStatus.notDelivered;
      default:
        return ItemDeliveryStatus.pending;
    }
  }

  EstadoEntrega _mapStatusReverse(ItemDeliveryStatus status) {
    switch (status) {
      case ItemDeliveryStatus.delivered:
        return EstadoEntrega.entregado;
      case ItemDeliveryStatus.notDelivered:
        return EstadoEntrega.noEntregado;
      case ItemDeliveryStatus.pending:
        return EstadoEntrega.pendiente;
    }
  }
}
