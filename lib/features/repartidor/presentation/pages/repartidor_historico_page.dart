/// REPARTIDOR HISTÓRICO PAGE v2.0
/// Pestaña de histórico con búsqueda de clientes, albaranes, facturas y firmas
/// FIX: Eliminados duplicados, firma real, PDF con firma, status real

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'dart:io';
import 'dart:convert';
import 'dart:typed_data';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/smart_sync_header.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../data/repartidor_data_service.dart';

/// Página de histórico para repartidores
/// Búsqueda por cliente, visualización de documentos y firmas
class RepartidorHistoricoPage extends StatefulWidget {
  final String repartidorId;

  const RepartidorHistoricoPage({
    super.key,
    required this.repartidorId,
  });

  @override
  State<RepartidorHistoricoPage> createState() => _RepartidorHistoricoPageState();
}

class _RepartidorHistoricoPageState extends State<RepartidorHistoricoPage> {
  final TextEditingController _searchController = TextEditingController();
  bool _isLoading = false;
  String? _selectedClientId;
  String? _selectedClientName;
  List<ClientSummary> _clients = [];
  List<DocumentHistory> _documents = [];
  List<MonthlyObjective> _objectives = [];

  // === DELIVERY SUMMARY ===
  Map<String, dynamic>? _deliverySummary;

  // === VENTAS DETALLE (jerarquía) ===
  Map<String, dynamic>? _objectivesDetail;
  int _selectedYear = DateTime.now().year;
  final Set<String> _expandedNodes = {};
  bool _isLoadingDetail = false;

  // === FILTROS MODERNOS ===
  DateTime? _dateFrom;
  DateTime? _dateTo;
  DocumentType? _filterDocType; // null = todos
  DeliveryStatus? _filterStatus; // null = todos

  @override
  void initState() {
    super.initState();
    _loadClients();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadClients([String? search]) async {
    setState(() => _isLoading = true);
    
    try {
      debugPrint('[History] Loading clients for Repartidor: ${widget.repartidorId}');
      final clients = await RepartidorDataService.getHistoryClients(
        repartidorId: widget.repartidorId,
        search: search,
      );
      debugPrint('[History] Received ${clients.length} clients');
      
      _clients = clients.map((c) => ClientSummary(
        id: c.id,
        name: c.name,
        address: c.address,
        totalDocuments: c.totalDocuments,
      )).toList();
    } catch (e) {
      debugPrint('[History] ❌ Error loading clients: $e');
      _clients = [];
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error al cargar clientes: $e'), backgroundColor: AppTheme.error),
        );
      }
    }

    if (mounted) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _loadClientHistory(String clientId, String clientName) async {
    setState(() {
      _isLoading = true;
      _selectedClientId = clientId;
      _selectedClientName = clientName;
    });

    try {
      final docs = await RepartidorDataService.getClientDocuments(
        clientId: clientId,
        repartidorId: widget.repartidorId,
      );
      
      _documents = docs.map((d) {
        DeliveryStatus status;
        switch (d.status) {
          case 'delivered':
            status = DeliveryStatus.delivered;
            break;
          case 'partial':
            status = DeliveryStatus.partial;
            break;
          default:
            status = DeliveryStatus.notDelivered;
        }
        
        return DocumentHistory(
          id: d.id,
          type: d.type == 'factura' ? DocumentType.factura : DocumentType.albaran,
          number: d.number,
          serie: d.serie,
          ejercicio: d.ejercicio,
          terminal: d.terminal,
          albaranNumber: d.albaranNumber ?? d.number,
          facturaNumber: d.facturaNumber,
          date: DateTime.tryParse(d.date) ?? DateTime.now(),
          amount: d.amount,
          status: status,
          hasSignature: d.hasSignature,
          signaturePath: d.signaturePath,
          deliveryDate: d.deliveryDate,
          deliveryObs: d.deliveryObs,
          observations: d.pending > 0 ? 'Pendiente: ${CurrencyFormatter.format(d.pending)}' : null,
        );
      }).toList();

      final objectives = await RepartidorDataService.getMonthlyObjectives(
        repartidorId: widget.repartidorId,
        clientId: clientId,
      );

      _objectives = objectives;

      // Load delivery summary
      _loadDeliverySummary();

      // Cargar desglose jerárquico
      _loadObjectivesDetail(clientId);
    } catch (e) {
      _documents = [];
      _objectives = [];
    }

    if (mounted) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _loadDeliverySummary() async {
    try {
      final data = await RepartidorDataService.getDeliverySummary(
        repartidorId: widget.repartidorId,
        year: DateTime.now().year,
        month: DateTime.now().month,
      );
      if (mounted) setState(() => _deliverySummary = data);
    } catch (_) {}
  }

  Future<void> _loadObjectivesDetail([String? clientId]) async {
    setState(() => _isLoadingDetail = true);
    try {
      final data = await RepartidorDataService.getObjectivesDetail(
        repartidorId: widget.repartidorId,
        year: _selectedYear,
        clientId: clientId ?? _selectedClientId,
      );
      if (mounted) {
        setState(() {
          _objectivesDetail = data;
          _isLoadingDetail = false;
        });
      }
    } catch (e) {
      debugPrint('[History] Error loading objectives detail: $e');
      if (mounted) setState(() => _isLoadingDetail = false);
    }
  }

  // === FILTRADO AVANZADO ===
  List<DocumentHistory> get _filteredDocuments {
    return _documents.where((doc) {
      // Filtro por tipo de documento
      if (_filterDocType != null && doc.type != _filterDocType) return false;
      
      // Filtro por estado
      if (_filterStatus != null && doc.status != _filterStatus) return false;
      
      // Filtro por fecha desde
      if (_dateFrom != null && doc.date.isBefore(_dateFrom!)) return false;
      
      // Filtro por fecha hasta
      if (_dateTo != null && doc.date.isAfter(_dateTo!.add(const Duration(days: 1)))) return false;
      
      return true;
    }).toList();
  }

  List<ClientSummary> get _filteredClients {
    final query = _searchController.text.toLowerCase();
    if (query.isEmpty) return _clients;
    return _clients.where((c) =>
      c.name.toLowerCase().contains(query) ||
      c.id.toLowerCase().contains(query)
    ).toList();
  }

  void _clearFilters() {
    setState(() {
      _dateFrom = null;
      _dateTo = null;
      _filterDocType = null;
      _filterStatus = null;
    });
  }

  bool get _hasActiveFilters =>
      _dateFrom != null || _dateTo != null || _filterDocType != null || _filterStatus != null;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          _buildHeader(),
          Expanded(
            child: _selectedClientId != null
                ? _buildClientHistory()
                : _buildClientSearch(),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    // If we are viewing a specific client, we show a detail header
    if (_selectedClientId != null) {
       return Container(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          border: Border(bottom: BorderSide(color: AppTheme.neonPurple.withOpacity(0.2), width: 1)),
        ),
        child: Row(
          children: [
            IconButton(
              onPressed: () => setState(() {
                  _selectedClientId = null;
                  _selectedClientName = null;
                  _documents = [];
                  _objectives = [];
                  _objectivesDetail = null;
                  _expandedNodes.clear();
                  _clearFilters();
              }),
              icon: const Icon(Icons.arrow_back, color: AppTheme.textPrimary),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                   Text(
                        _selectedClientName ?? 'Cliente',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                        overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                        'Cód: $_selectedClientId',
                        style: TextStyle(fontSize: 12, color: AppTheme.textSecondary.withOpacity(0.8)),
                    ),
                ],
              ),
            ),
             // Client selector dropdown (when in client view)
            if (_clients.isNotEmpty)
              _buildClientSelector(),
          ],
        ),
       );
    }
    
    // Main Header using SmartSyncHeader
    return SmartSyncHeader(
      title: 'Histórico',
      subtitle: 'Búsqueda de clientes y documentos',
      lastSync: DateTime.now(), // Real app would track this
      isLoading: _isLoading,
      onSync: () => _loadClients(_searchController.text),
    );
  }

  /// Selector moderno de cliente tipo dropdown
  Widget _buildClientSelector() {
    return PopupMenuButton<String>(
      tooltip: 'Cambiar cliente',
      offset: const Offset(0, 48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: AppTheme.surfaceColor,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              AppTheme.neonPurple.withOpacity(0.15),
              AppTheme.neonBlue.withOpacity(0.15),
            ],
          ),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.swap_horiz, color: AppTheme.neonPurple, size: 18),
            const SizedBox(width: 6),
            const Text(
              'Cliente',
              style: TextStyle(color: AppTheme.neonPurple, fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
      itemBuilder: (context) => _clients.map((client) {
        final isSelected = client.id == _selectedClientId;
        return PopupMenuItem<String>(
          value: client.id,
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: isSelected
                        ? AppTheme.neonPurple.withOpacity(0.2)
                        : AppTheme.darkBase,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Center(
                    child: Text(
                      client.name[0],
                      style: TextStyle(
                        color: isSelected ? AppTheme.neonPurple : AppTheme.textSecondary,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        client.name,
                        style: TextStyle(
                          color: isSelected ? AppTheme.neonPurple : AppTheme.textPrimary,
                          fontSize: 13,
                          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        'Cód: ${client.id}',
                        style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                if (isSelected)
                  const Icon(Icons.check_circle, color: AppTheme.neonPurple, size: 18),
              ],
            ),
          ),
        );
      }).toList(),
      onSelected: (clientId) {
        final client = _clients.firstWhere((c) => c.id == clientId);
        _loadClientHistory(clientId, client.name);
      },
    );
  }

  Widget _buildGlassButton({required IconData icon, required VoidCallback onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.05),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.white.withOpacity(0.1)),
        ),
        child: Icon(icon, color: AppTheme.textPrimary, size: 22),
      ),
    );
  }

  Widget _buildClientSearch() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            controller: _searchController,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: 'Buscar cliente por código o nombre...',
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
                borderSide: const BorderSide(color: AppTheme.neonPurple),
              ),
            ),
            style: const TextStyle(color: AppTheme.textPrimary),
          ),
        ),
        
        // Contador de clientes
        if (!_isLoading && _clients.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Icon(Icons.people, size: 14, color: AppTheme.textSecondary),
                const SizedBox(width: 6),
                Text(
                  _searchController.text.isNotEmpty
                      ? '${_filteredClients.length} de ${_clients.length} clientes'
                      : '${_clients.length} clientes',
                  style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                ),
              ],
            ),
          ),
        const SizedBox(height: 8),
        Expanded(
          child: _isLoading
              ? const Center(child: CircularProgressIndicator(color: AppTheme.neonPurple))
              : _filteredClients.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.search_off, size: 48, color: AppTheme.textSecondary.withOpacity(0.5)),
                          const SizedBox(height: 16),
                          Text('No se encontraron clientes', style: TextStyle(color: AppTheme.textSecondary)),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: () => _loadClients(_searchController.text.isNotEmpty ? _searchController.text : null),
                      color: AppTheme.neonPurple,
                      child: ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        itemCount: _filteredClients.length,
                        itemBuilder: (context, index) => _buildClientCard(_filteredClients[index]),
                      ),
                    ),
        ),
      ],
    );
  }

  Widget _buildClientCard(ClientSummary client) {
    return GestureDetector(
      onTap: () => _loadClientHistory(client.id, client.name),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withOpacity(0.05)),
        ),
        child: Row(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: AppTheme.neonPurple.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Center(
                child: Text(
                  client.name[0],
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.neonPurple,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
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
                          client.id,
                          style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.neonBlue),
                        ),
                      ),
                      const Spacer(),
                      Text(
                        '${client.totalDocuments} docs',
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    client.name,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                  ),
                  Text(
                    client.address,
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary.withOpacity(0.7)),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: AppTheme.textSecondary.withOpacity(0.5)),
          ],
        ),
      ),
    );
  }

  Widget _buildClientHistory() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: AppTheme.neonPurple));
    }

    return DefaultTabController(
      length: 3,
      child: Column(
        children: [
          // === DELIVERY SUMMARY KPI HEADER ===
          if (_deliverySummary != null && _deliverySummary!['summary'] != null)
            _buildDeliverySummaryHeader(),
          
          // Tab bar
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: AppTheme.surfaceColor,
              borderRadius: BorderRadius.circular(10),
            ),
            child: TabBar(
              labelColor: AppTheme.neonPurple,
              unselectedLabelColor: AppTheme.textSecondary,
              indicator: BoxDecoration(
                color: AppTheme.neonPurple.withOpacity(0.2),
                borderRadius: BorderRadius.circular(10),
              ),
              dividerHeight: 0,
              labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
              tabs: const [
                Tab(text: 'Documentos'),
                Tab(text: 'Entregas'),
                Tab(text: 'Objetivos'),
              ],
            ),
          ),
          
          Expanded(
            child: TabBarView(
              children: [
                _buildDocumentsTabWithFilters(),
                _buildEntregasTab(),
                _buildObjectivesTable(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDeliverySummaryHeader() {
    final summary = _deliverySummary!['summary'] as Map<String, dynamic>? ?? {};
    final total = summary['totalAlbaranes'] ?? 0;
    final entregados = summary['entregados'] ?? 0;
    final pendientes = summary['pendientes'] ?? 0;
    final noEntregados = summary['noEntregados'] ?? 0;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [AppTheme.neonPurple.withOpacity(0.15), AppTheme.neonBlue.withOpacity(0.1)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.neonPurple.withOpacity(0.2)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildKpiItem(Icons.inventory_2, '$total', 'Total', AppTheme.neonBlue),
          _buildKpiItem(Icons.check_circle, '$entregados', 'Entregados', AppTheme.success),
          _buildKpiItem(Icons.schedule, '$pendientes', 'Pendientes', Colors.orange),
          _buildKpiItem(Icons.cancel, '$noEntregados', 'No Entregados', AppTheme.error),
        ],
      ),
    );
  }

  Widget _buildKpiItem(IconData icon, String value, String label, Color color) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 20, color: color),
        const SizedBox(height: 4),
        Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: color)),
        Text(label, style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
      ],
    );
  }

  /// Tab de Entregas: daily delivery breakdown
  Widget _buildEntregasTab() {
    final dailyList = (_deliverySummary?['daily'] as List?)?.cast<Map<String, dynamic>>() ?? [];

    if (dailyList.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.local_shipping_outlined, size: 48, color: Colors.grey.shade600),
            const SizedBox(height: 12),
            Text('No hay datos de entregas este mes', style: TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: dailyList.length,
      itemBuilder: (context, index) {
        final day = dailyList[index];
        final date = day['date'] ?? '';
        final total = day['total'] ?? 0;
        final delivered = day['delivered'] ?? 0;
        final notDelivered = day['notDelivered'] ?? 0;
        final partial = day['partial'] ?? 0;
        final amount = (day['amount'] ?? 0).toDouble();
        final pct = total > 0 ? (delivered / total * 100).toStringAsFixed(0) : '0';

        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppTheme.surfaceColor,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white.withOpacity(0.05)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.calendar_today, size: 14, color: AppTheme.neonPurple),
                  const SizedBox(width: 6),
                  Text(
                    _formatDayDate(date),
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.neonPurple.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text('$pct%', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.neonPurple)),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  _buildMiniStat(Icons.inventory, '$total', 'Total', AppTheme.neonBlue),
                  _buildMiniStat(Icons.check_circle, '$delivered', 'OK', AppTheme.success),
                  _buildMiniStat(Icons.cancel, '$notDelivered', 'No', AppTheme.error),
                  if (partial > 0) _buildMiniStat(Icons.timelapse, '$partial', 'Parcial', Colors.orange),
                  const Spacer(),
                  Text(CurrencyFormatter.format(amount), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildMiniStat(IconData icon, String value, String label, Color color) {
    return Padding(
      padding: const EdgeInsets.only(right: 16),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 3),
          Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: color)),
          const SizedBox(width: 2),
          Text(label, style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }

  String _formatDayDate(String dateStr) {
    try {
      final dt = DateTime.parse(dateStr);
      final dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      return '${dayNames[dt.weekday - 1]} ${dt.day}/${dt.month}';
    } catch (_) {
      return dateStr;
    }
  }

  /// Tab de documentos con filtros modernos
  Widget _buildDocumentsTabWithFilters() {
    return Column(
      children: [
        // === FILTROS FUTURISTAS ===
        _buildModernFilters(),
        
        // Lista filtrada
        Expanded(
          child: _buildDocumentsList(),
        ),
      ],
    );
  }

  /// Panel de filtros moderno con glassmorphism
  Widget _buildModernFilters() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        children: [
          // Row 1: Filter chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                // Date range filter
                _buildFilterChip(
                  icon: Icons.date_range,
                  label: _dateFrom != null || _dateTo != null
                      ? _formatDateRange()
                      : 'Fechas',
                  isActive: _dateFrom != null || _dateTo != null,
                  color: AppTheme.neonBlue,
                  onTap: _showDateRangePicker,
                ),
                const SizedBox(width: 8),
                
                // Document type filter
                _buildFilterChip(
                  icon: _filterDocType == DocumentType.factura ? Icons.receipt : Icons.description,
                  label: _filterDocType == null
                      ? 'Tipo'
                      : _filterDocType == DocumentType.factura
                          ? 'Facturas'
                          : 'Albaranes',
                  isActive: _filterDocType != null,
                  color: AppTheme.neonPurple,
                  onTap: _showDocTypeSelector,
                ),
                const SizedBox(width: 8),
                
                // Status filter
                _buildFilterChip(
                  icon: _getStatusIcon(),
                  label: _filterStatus == null
                      ? 'Estado'
                      : _filterStatus == DeliveryStatus.delivered
                          ? 'Entregado'
                          : _filterStatus == DeliveryStatus.partial
                              ? 'Parcial'
                              : 'No Entregado',
                  isActive: _filterStatus != null,
                  color: _getStatusColor(),
                  onTap: _showStatusSelector,
                ),
                
                // Clear filters button
                if (_hasActiveFilters) ...[
                  const SizedBox(width: 8),
                  _buildFilterChip(
                    icon: Icons.close,
                    label: 'Limpiar',
                    isActive: false,
                    color: AppTheme.error,
                    onTap: _clearFilters,
                  ),
                ],
              ],
            ),
          ),
          
          const SizedBox(height: 12),
          
          // Results count
          Row(
            children: [
              Icon(Icons.filter_list, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 6),
              Text(
                '${_filteredDocuments.length} de ${_documents.length} documentos',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
            ],
          ),
          
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  /// Chip de filtro moderno con efecto glassmorphism
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
            if (isActive) ...[
              const SizedBox(width: 4),
              Icon(Icons.check, size: 14, color: color),
            ],
          ],
        ),
      ),
    );
  }

  String _formatDateRange() {
    final df = DateFormat('dd/MM');
    if (_dateFrom != null && _dateTo != null) {
      return '${df.format(_dateFrom!)} - ${df.format(_dateTo!)}';
    } else if (_dateFrom != null) {
      return 'Desde ${df.format(_dateFrom!)}';
    } else if (_dateTo != null) {
      return 'Hasta ${df.format(_dateTo!)}';
    }
    return 'Fechas';
  }

  IconData _getStatusIcon() {
    switch (_filterStatus) {
      case DeliveryStatus.delivered:
        return Icons.check_circle;
      case DeliveryStatus.partial:
        return Icons.pie_chart;
      case DeliveryStatus.notDelivered:
        return Icons.cancel;
      default:
        return Icons.filter_alt;
    }
  }

  Color _getStatusColor() {
    switch (_filterStatus) {
      case DeliveryStatus.delivered:
        return AppTheme.success;
      case DeliveryStatus.partial:
        return Colors.orange;
      case DeliveryStatus.notDelivered:
        return AppTheme.error;
      default:
        return AppTheme.neonGreen;
    }
  }

  Future<void> _showDateRangePicker() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
      initialDateRange: _dateFrom != null && _dateTo != null
          ? DateTimeRange(start: _dateFrom!, end: _dateTo!)
          : null,
      builder: (context, child) {
        return Theme(
          data: ThemeData.dark().copyWith(
            colorScheme: const ColorScheme.dark(
              primary: AppTheme.neonPurple,
              onPrimary: Colors.white,
              surface: AppTheme.surfaceColor,
              onSurface: AppTheme.textPrimary,
            ),
          ),
          child: child!,
        );
      },
    );
    
    if (picked != null) {
      setState(() {
        _dateFrom = picked.start;
        _dateTo = picked.end;
      });
    }
  }

  void _showDocTypeSelector() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _buildModernBottomSheet(
        title: 'Tipo de Documento',
        options: [
          _BottomSheetOption(
            icon: Icons.all_inclusive,
            label: 'Todos',
            isSelected: _filterDocType == null,
            color: AppTheme.neonPurple,
            onTap: () {
              setState(() => _filterDocType = null);
              Navigator.pop(ctx);
            },
          ),
          _BottomSheetOption(
            icon: Icons.description,
            label: 'Albaranes',
            isSelected: _filterDocType == DocumentType.albaran,
            color: AppTheme.neonBlue,
            onTap: () {
              setState(() => _filterDocType = DocumentType.albaran);
              Navigator.pop(ctx);
            },
          ),
          _BottomSheetOption(
            icon: Icons.receipt,
            label: 'Facturas',
            isSelected: _filterDocType == DocumentType.factura,
            color: Colors.purpleAccent,
            onTap: () {
              setState(() => _filterDocType = DocumentType.factura);
              Navigator.pop(ctx);
            },
          ),
        ],
      ),
    );
  }

  void _showStatusSelector() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _buildModernBottomSheet(
        title: 'Estado de Entrega',
        options: [
          _BottomSheetOption(
            icon: Icons.all_inclusive,
            label: 'Todos',
            isSelected: _filterStatus == null,
            color: AppTheme.neonGreen,
            onTap: () {
              setState(() => _filterStatus = null);
              Navigator.pop(ctx);
            },
          ),
          _BottomSheetOption(
            icon: Icons.check_circle,
            label: 'Entregado',
            isSelected: _filterStatus == DeliveryStatus.delivered,
            color: AppTheme.success,
            onTap: () {
              setState(() => _filterStatus = DeliveryStatus.delivered);
              Navigator.pop(ctx);
            },
          ),
          _BottomSheetOption(
            icon: Icons.pie_chart,
            label: 'Parcial',
            isSelected: _filterStatus == DeliveryStatus.partial,
            color: Colors.orange,
            onTap: () {
              setState(() => _filterStatus = DeliveryStatus.partial);
              Navigator.pop(ctx);
            },
          ),
          _BottomSheetOption(
            icon: Icons.cancel,
            label: 'No Entregado',
            isSelected: _filterStatus == DeliveryStatus.notDelivered,
            color: AppTheme.error,
            onTap: () {
              setState(() => _filterStatus = DeliveryStatus.notDelivered);
              Navigator.pop(ctx);
            },
          ),
        ],
      ),
    );
  }

  Widget _buildModernBottomSheet({
    required String title,
    required List<_BottomSheetOption> options,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.3),
            blurRadius: 20,
            offset: const Offset(0, -5),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle
          Container(
            margin: const EdgeInsets.only(top: 12),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          
          // Title
          Padding(
            padding: const EdgeInsets.all(20),
            child: Text(
              title,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: AppTheme.textPrimary,
              ),
            ),
          ),
          
          // Options
          ...options.map((opt) => _buildOptionTile(opt)),
          
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  Widget _buildOptionTile(_BottomSheetOption option) {
    return GestureDetector(
      onTap: option.onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: option.isSelected
              ? LinearGradient(
                  colors: [
                    option.color.withOpacity(0.2),
                    option.color.withOpacity(0.05),
                  ],
                )
              : null,
          color: option.isSelected ? null : AppTheme.darkBase,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: option.isSelected ? option.color.withOpacity(0.5) : Colors.transparent,
          ),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: option.color.withOpacity(0.2),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(option.icon, color: option.color, size: 20),
            ),
            const SizedBox(width: 16),
            Text(
              option.label,
              style: TextStyle(
                fontSize: 16,
                color: option.isSelected ? option.color : AppTheme.textPrimary,
                fontWeight: option.isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
            const Spacer(),
            if (option.isSelected)
              Icon(Icons.check_circle, color: option.color, size: 22),
          ],
        ),
      ),
    );
  }

  Widget _buildDocumentsList() {
    final docs = _filteredDocuments;
    
    if (docs.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              _hasActiveFilters ? Icons.filter_alt_off : Icons.folder_open, 
              size: 48, 
              color: AppTheme.textSecondary.withOpacity(0.5),
            ),
            const SizedBox(height: 16),
            Text(
              _hasActiveFilters
                  ? 'No hay documentos que coincidan con los filtros'
                  : 'Sin documentos históricos',
              style: TextStyle(color: AppTheme.textSecondary),
              textAlign: TextAlign.center,
            ),
            if (_hasActiveFilters) ...[
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: _clearFilters,
                icon: const Icon(Icons.clear, size: 16),
                label: const Text('Limpiar filtros'),
                style: TextButton.styleFrom(foregroundColor: AppTheme.neonPurple),
              ),
            ],
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: docs.length,
      itemBuilder: (context, index) => _buildDocumentCard(docs[index]),
    );
  }

  Widget _buildDocumentCard(DocumentHistory doc) {
    final Color statusColor;
    final IconData statusIcon;
    
    switch (doc.status) {
      case DeliveryStatus.delivered:
        statusColor = AppTheme.success;
        statusIcon = Icons.check_circle;
        break;
      case DeliveryStatus.partial:
        statusColor = Colors.orange;
        statusIcon = Icons.pie_chart;
        break;
      case DeliveryStatus.notDelivered:
        statusColor = AppTheme.error;
        statusIcon = Icons.cancel;
        break;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: statusColor.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: doc.type == DocumentType.factura
                      ? Colors.purple.withOpacity(0.2)
                      : AppTheme.neonBlue.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      doc.type == DocumentType.factura ? Icons.receipt : Icons.description,
                      size: 14,
                      color: doc.type == DocumentType.factura ? Colors.purpleAccent : AppTheme.neonBlue,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      doc.type == DocumentType.factura ? 'Factura' : 'Albarán',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: doc.type == DocumentType.factura ? Colors.purpleAccent : AppTheme.neonBlue,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '#${doc.number}',
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
              ),
              const Spacer(),
              Row(
                children: [
                  Icon(statusIcon, size: 16, color: statusColor),
                  const SizedBox(width: 4),
                  Text(
                    doc.status == DeliveryStatus.delivered
                        ? 'Entregado'
                        : doc.status == DeliveryStatus.partial
                            ? 'Parcial'
                            : 'No Entregado',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: statusColor),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Icon(Icons.calendar_today, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 6),
              Text(
                DateFormat('dd/MM/yyyy').format(doc.date),
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
              const Spacer(),
              Text(
                CurrencyFormatter.format(doc.amount),
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.neonGreen),
              ),
            ],
          ),
          
          if (doc.observations != null) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.orange.withOpacity(0.1),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Row(
                children: [
                  Icon(Icons.note_alt, size: 14, color: Colors.orange.withOpacity(0.7)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      doc.observations!,
                      style: TextStyle(fontSize: 11, color: Colors.orange.shade300, fontStyle: FontStyle.italic),
                    ),
                  ),
                ],
              ),
            ),
          ],
          
          const SizedBox(height: 10),
          
          Row(
            children: [
              if (doc.hasSignature)
                OutlinedButton.icon(
                  onPressed: () => _showSignature(doc),
                  icon: const Icon(Icons.edit_note, size: 16),
                  label: const Text('Ver Firma'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.neonPurple,
                    side: BorderSide(color: AppTheme.neonPurple.withOpacity(0.5)),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  ),
                )
              else
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.grey.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.edit_off, size: 14, color: Colors.grey),
                      const SizedBox(width: 4),
                      Text('Sin firma', style: TextStyle(fontSize: 11, color: Colors.grey)),
                    ],
                  ),
                ),
              const Spacer(),
              IconButton(
                onPressed: () => _shareDocument(doc),
                icon: const Icon(Icons.share),
                color: AppTheme.neonBlue,
                tooltip: 'Compartir',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildObjectivesTable() {
    return Column(
      children: [
        // Selector de año
        Container(
          margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Row(
            children: [
              const Text('Desglose de ventas', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceColor,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<int>(
                    value: _selectedYear,
                    isDense: true,
                    dropdownColor: AppTheme.surfaceColor,
                    style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary),
                    items: List.generate(5, (i) => DateTime.now().year - i)
                        .map((y) => DropdownMenuItem(value: y, child: Text('$y')))
                        .toList(),
                    onChanged: (y) {
                      if (y != null && y != _selectedYear) {
                        setState(() { _selectedYear = y; _expandedNodes.clear(); });
                        _loadObjectivesDetail();
                      }
                    },
                  ),
                ),
              ),
            ],
          ),
        ),

        // Contenido jerárquico
        Expanded(
          child: _isLoadingDetail
              ? const Center(child: CircularProgressIndicator(color: AppTheme.neonPurple))
              : _buildHierarchyContent(),
        ),
      ],
    );
  }

  Widget _buildHierarchyContent() {
    final clients = (_objectivesDetail?['clients'] as List?) ?? [];
    final grandTotal = _objectivesDetail?['grandTotal'] as Map<String, dynamic>?;

    if (clients.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.bar_chart, size: 48, color: AppTheme.textSecondary.withOpacity(0.5)),
            const SizedBox(height: 16),
            Text('Sin datos de ventas para $_selectedYear', style: TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: clients.length + (grandTotal != null ? 1 : 0),
      itemBuilder: (ctx, index) {
        // Cabecera de totales
        if (grandTotal != null && index == 0) {
          final sales = (grandTotal['sales'] as num?)?.toDouble() ?? 0;
          final margin = (grandTotal['margin'] as num?)?.toDouble() ?? 0;
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: [AppTheme.neonPurple.withOpacity(0.15), AppTheme.neonBlue.withOpacity(0.1)]),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
            ),
            child: Row(
              children: [
                const Icon(Icons.summarize, color: AppTheme.neonPurple, size: 20),
                const SizedBox(width: 10),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Total $_selectedYear', style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                    Text(CurrencyFormatter.format(sales), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.neonGreen)),
                  ],
                ),
                const Spacer(),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Margen', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                    Text('${margin.toStringAsFixed(1)}%', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: margin >= 20 ? AppTheme.success : Colors.orange)),
                  ],
                ),
                const SizedBox(width: 12),
                Text('${clients.length} clientes', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
              ],
            ),
          );
        }

        final clientIdx = grandTotal != null ? index - 1 : index;
        final client = Map<String, dynamic>.from(clients[clientIdx] as Map);
        return _buildClientNode(client);
      },
    );
  }

  Widget _buildClientNode(Map<String, dynamic> client) {
    final code = client['code'] as String? ?? '';
    final name = client['name'] as String? ?? code;
    final sales = (client['totalSales'] as num?)?.toDouble() ?? 0;
    final margin = (client['margin'] as num?)?.toDouble() ?? 0;
    final productCount = client['productCount'] ?? 0;
    final nodeKey = 'client_$code';
    final expanded = _expandedNodes.contains(nodeKey);
    final families = (client['families'] as List?) ?? [];

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: expanded ? AppTheme.neonPurple.withOpacity(0.4) : Colors.white.withOpacity(0.05)),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: families.isNotEmpty ? () => setState(() {
              if (expanded) _expandedNodes.remove(nodeKey); else _expandedNodes.add(nodeKey);
            }) : null,
            borderRadius: BorderRadius.circular(10),
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Row(
                children: [
                  if (families.isNotEmpty)
                    Icon(expanded ? Icons.keyboard_arrow_down : Icons.keyboard_arrow_right, color: AppTheme.neonPurple, size: 20)
                  else
                    const SizedBox(width: 20),
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                    decoration: BoxDecoration(color: AppTheme.neonBlue.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                    child: Text(code, style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.neonBlue)),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textPrimary), maxLines: 1, overflow: TextOverflow.ellipsis),
                        Text('$productCount productos', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(CurrencyFormatter.format(sales), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.neonGreen)),
                      Text('${margin.toStringAsFixed(1)}%', style: TextStyle(fontSize: 10, color: margin >= 20 ? AppTheme.success : Colors.orange)),
                    ],
                  ),
                ],
              ),
            ),
          ),
          if (expanded && families.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 16, right: 4, bottom: 6),
              child: Column(children: families.map((fi1) => _buildFiNode(Map<String, dynamic>.from(fi1 as Map), 1, 'client_$code')).toList()),
            ),
        ],
      ),
    );
  }

  Widget _buildFiNode(Map<String, dynamic> node, int level, String parentKey) {
    final code = node['code'] as String? ?? '';
    final name = node['name'] as String? ?? code;
    final sales = (node['totalSales'] as num?)?.toDouble() ?? 0;
    final nodeKey = '${parentKey}_fi${level}_$code';
    final expanded = _expandedNodes.contains(nodeKey);

    final children = (node['children'] as List?) ?? [];
    final products = (node['products'] as List?) ?? [];
    final hasChildren = children.isNotEmpty || products.isNotEmpty;

    // Colores por nivel
    final colors = [AppTheme.neonPurple, AppTheme.neonBlue, Colors.teal, Colors.amber];
    final levelColor = colors[(level - 1) % colors.length];
    final levelLabels = ['FI1', 'FI2', 'FI3', 'FI4'];
    final levelLabel = level <= 4 ? levelLabels[level - 1] : 'FI';

    return Container(
      margin: const EdgeInsets.only(bottom: 3),
      decoration: BoxDecoration(
        color: levelColor.withOpacity(0.05),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: levelColor.withOpacity(expanded ? 0.3 : 0.1)),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: hasChildren ? () => setState(() {
              if (expanded) _expandedNodes.remove(nodeKey); else _expandedNodes.add(nodeKey);
            }) : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                children: [
                  if (hasChildren)
                    Icon(expanded ? Icons.keyboard_arrow_down : Icons.keyboard_arrow_right, color: levelColor, size: 18)
                  else
                    const SizedBox(width: 18),
                  const SizedBox(width: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: BoxDecoration(color: levelColor.withOpacity(0.2), borderRadius: BorderRadius.circular(3)),
                    child: Text(levelLabel, style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: levelColor)),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(name, style: const TextStyle(fontSize: 11, color: AppTheme.textPrimary), maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
                  Text(CurrencyFormatter.format(sales), style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: levelColor)),
                ],
              ),
            ),
          ),
          if (expanded && hasChildren)
            Padding(
              padding: const EdgeInsets.only(left: 14, right: 2, bottom: 4),
              child: Column(
                children: [
                  ...children.map((child) => _buildFiNode(Map<String, dynamic>.from(child as Map), level + 1, nodeKey)),
                  ...products.map((p) => _buildProductRow(Map<String, dynamic>.from(p as Map))),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildProductRow(Map<String, dynamic> product) {
    final code = product['code'] as String? ?? '';
    final name = product['name'] as String? ?? code;
    final sales = (product['totalSales'] as num?)?.toDouble() ?? 0;
    final units = (product['totalUnits'] as num?)?.toDouble() ?? 0;
    final unitType = product['unitType'] as String? ?? 'UDS';

    return Container(
      margin: const EdgeInsets.only(bottom: 2),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: AppTheme.darkBase.withOpacity(0.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          const SizedBox(width: 22),
          Icon(Icons.inventory_2, size: 12, color: AppTheme.textSecondary.withOpacity(0.5)),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: const TextStyle(fontSize: 10, color: AppTheme.textPrimary), maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(code, style: TextStyle(fontSize: 8, color: AppTheme.textSecondary.withOpacity(0.7))),
              ],
            ),
          ),
          Text('${units.toStringAsFixed(units == units.roundToDouble() ? 0 : 1)} $unitType', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
          const SizedBox(width: 10),
          Text(CurrencyFormatter.format(sales), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppTheme.neonGreen)),
        ],
      ),
    );
  }

  void _showSignature(DocumentHistory doc) {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => _SignatureDialog(doc: doc),
    );
  }

  Future<void> _shareDocument(DocumentHistory doc) async {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Generando PDF...'),
        duration: Duration(seconds: 2),
        backgroundColor: AppTheme.info,
      ),
    );

    try {
      final bytes = await RepartidorDataService.downloadDocument(
        year: doc.ejercicio > 0 ? doc.ejercicio : doc.date.year,
        serie: doc.serie,
        number: doc.albaranNumber ?? doc.number,
        terminal: doc.terminal,
        type: doc.type == DocumentType.factura ? 'factura' : 'albaran',
      );

      final tempDir = await getTemporaryDirectory();
      final typeLabel = doc.type == DocumentType.factura ? 'Factura' : 'Albaran';
      final fileName = '${typeLabel}_${doc.serie}_${doc.number}.pdf';
      final file = File('${tempDir.path}/$fileName');
      await file.writeAsBytes(bytes);

      await Share.shareXFiles(
        [XFile(file.path)], 
        text: '$typeLabel ${doc.number} - ${DateFormat('dd/MM/yyyy').format(doc.date)}'
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al compartir: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }
}

// Helper class for bottom sheet options
class _BottomSheetOption {
  final IconData icon;
  final String label;
  final bool isSelected;
  final Color color;
  final VoidCallback onTap;

  _BottomSheetOption({
    required this.icon,
    required this.label,
    required this.isSelected,
    required this.color,
    required this.onTap,
  });
}

// Models
class ClientSummary {
  final String id;
  final String name;
  final String address;
  final int totalDocuments;

  ClientSummary({
    required this.id,
    required this.name,
    required this.address,
    required this.totalDocuments,
  });
}

enum DocumentType { albaran, factura }
enum DeliveryStatus { delivered, partial, notDelivered }

class DocumentHistory {
  final String id;
  final DocumentType type;
  final int number;
  final String serie;
  final int ejercicio;
  final int terminal;
  final int? albaranNumber;
  final int? facturaNumber;
  final DateTime date;
  final double amount;
  final DeliveryStatus status;
  final bool hasSignature;
  final String? signaturePath;
  final String? deliveryDate;
  final String? deliveryObs;
  final String? observations;

  DocumentHistory({
    required this.id,
    required this.type,
    required this.number,
    this.serie = 'A',
    this.ejercicio = 0,
    this.terminal = 0,
    this.albaranNumber,
    this.facturaNumber,
    required this.date,
    required this.amount,
    required this.status,
    required this.hasSignature,
    this.signaturePath,
    this.deliveryDate,
    this.deliveryObs,
    this.observations,
  });
}

/// Dialog that fetches and displays the real signature with zoom
class _SignatureDialog extends StatefulWidget {
  final DocumentHistory doc;
  const _SignatureDialog({required this.doc});

  @override
  State<_SignatureDialog> createState() => _SignatureDialogState();
}

class _SignatureDialogState extends State<_SignatureDialog> {
  Uint8List? _signatureBytes;
  String? _firmante;
  String? _fecha;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchSignature();
  }

  Future<void> _fetchSignature() async {
    try {
      final data = await RepartidorDataService.getSignature(
        ejercicio: widget.doc.ejercicio > 0 ? widget.doc.ejercicio : widget.doc.date.year,
        serie: widget.doc.serie,
        terminal: widget.doc.terminal,
        numero: widget.doc.albaranNumber ?? widget.doc.number,
      );

      if (data != null && data['base64'] != null) {
        setState(() {
          _signatureBytes = base64Decode(data['base64'] as String);
          _firmante = data['firmante'] as String?;
          _fecha = data['fecha'] as String?;
          _loading = false;
        });
      } else {
        setState(() {
          _loading = false;
          _error = 'No se encontró firma para este documento';
        });
      }
    } catch (e) {
      setState(() {
        _loading = false;
        _error = 'Error al cargar firma: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final doc = widget.doc;
    final typeLabel = doc.type == DocumentType.factura ? 'Factura' : 'Albarán';

    return AlertDialog(
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: [
          const Icon(Icons.draw, color: AppTheme.neonPurple),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Firma - $typeLabel #${doc.number}',
              style: const TextStyle(fontSize: 16, color: AppTheme.textPrimary),
            ),
          ),
        ],
      ),
      content: SizedBox(
        width: 320,
        height: 280,
        child: _loading
            ? const Center(child: CircularProgressIndicator(color: AppTheme.neonPurple))
            : _error != null
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.gesture, size: 48, color: Colors.grey.shade400),
                        const SizedBox(height: 12),
                        Text(_error!, style: TextStyle(color: Colors.grey.shade400, fontSize: 13), textAlign: TextAlign.center),
                      ],
                    ),
                  )
                : Column(
                    children: [
                      Expanded(
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: InteractiveViewer(
                              minScale: 0.5,
                              maxScale: 4.0,
                              child: _signatureBytes != null
                                  ? Image.memory(_signatureBytes!, fit: BoxFit.contain)
                                  : const Center(child: Icon(Icons.gesture, size: 48)),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      if (_firmante != null)
                        Text('Firmante: $_firmante', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                      if (_fecha != null)
                        Text('Fecha: $_fecha', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withOpacity(0.8))),
                      const SizedBox(height: 4),
                      Text('Pellizca para hacer zoom', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary.withOpacity(0.5), fontStyle: FontStyle.italic)),
                    ],
                  ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cerrar'),
        ),
      ],
    );
  }
}
