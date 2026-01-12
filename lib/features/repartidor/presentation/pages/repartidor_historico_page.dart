/// REPARTIDOR HISTÓRICO PAGE
/// Pestaña de histórico con búsqueda de clientes, albaranes, facturas y firmas
/// Permite visualizar y reenviar documentos con filtros avanzados

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
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
      final clients = await RepartidorDataService.getHistoryClients(
        repartidorId: widget.repartidorId,
        search: search,
      );
      
      _clients = clients.map((c) => ClientSummary(
        id: c.id,
        name: c.name,
        address: c.address,
        totalDocuments: c.totalDocuments,
      )).toList();
    } catch (e) {
      _clients = [];
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
          date: DateTime.tryParse(d.date) ?? DateTime.now(),
          amount: d.amount,
          status: status,
          hasSignature: d.hasSignature,
          observations: d.pending > 0 ? 'Pendiente: ${CurrencyFormatter.format(d.pending)}' : null,
        );
      }).toList();

      final objectives = await RepartidorDataService.getMonthlyObjectives(
        repartidorId: widget.repartidorId,
        clientId: clientId,
      );
      
      _objectives = objectives.map((o) => MonthlyObjective(
        month: o.month,
        collectable: o.collectable,
        collected: o.collected,
        percentage: o.percentage,
      )).toList();
    } catch (e) {
      _documents = [];
      _objectives = [];
    }

    if (mounted) {
      setState(() => _isLoading = false);
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
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
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
          bottom: BorderSide(color: AppTheme.neonPurple.withOpacity(0.2), width: 1),
        ),
      ),
      child: Row(
        children: [
          if (_selectedClientId != null) ...[
            _buildGlassButton(
              icon: Icons.arrow_back,
              onTap: () => setState(() {
                _selectedClientId = null;
                _selectedClientName = null;
                _documents = [];
                _clearFilters();
              }),
            ),
            const SizedBox(width: 12),
          ] else ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppTheme.neonPurple.withOpacity(0.2),
                    AppTheme.neonBlue.withOpacity(0.2),
                  ],
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.history, color: AppTheme.neonPurple, size: 24),
            ),
            const SizedBox(width: 12),
          ],
          
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _selectedClientId != null
                      ? _selectedClientName ?? 'Cliente'
                      : 'Histórico',
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  _selectedClientId != null
                      ? 'Cód: $_selectedClientId'
                      : 'Buscar cliente para ver historial',
                  style: TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary.withOpacity(0.8),
                  ),
                ),
              ],
            ),
          ),
          
          // Client selector dropdown (when in client view)
          if (_selectedClientId != null && _clients.isNotEmpty)
            _buildClientSelector(),
        ],
      ),
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
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: _filteredClients.length,
                      itemBuilder: (context, index) => _buildClientCard(_filteredClients[index]),
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
      length: 2,
      child: Column(
        children: [
          // Tab bar
          Container(
            margin: const EdgeInsets.all(16),
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
              tabs: const [
                Tab(text: 'Documentos'),
                Tab(text: 'Objetivos 30%'),
              ],
            ),
          ),
          
          Expanded(
            child: TabBarView(
              children: [
                _buildDocumentsTabWithFilters(),
                _buildObjectivesTable(),
              ],
            ),
          ),
        ],
      ),
    );
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
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Progreso Objetivo 30%',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
          ),
          const SizedBox(height: 8),
          Text(
            'Seguimiento del porcentaje cobrado por mes',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 16),
          Container(
            decoration: BoxDecoration(
              color: AppTheme.surfaceColor,
              borderRadius: BorderRadius.circular(12),
            ),
            child: DataTable(
              columnSpacing: 20,
              headingRowColor: WidgetStateProperty.all(AppTheme.darkBase),
              columns: const [
                DataColumn(label: Text('Mes', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11))),
                DataColumn(label: Text('Cobrable', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11))),
                DataColumn(label: Text('Cobrado', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11))),
                DataColumn(label: Text('% Acum.', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11))),
              ],
              rows: _objectives.map((obj) {
                final isThresholdMet = obj.percentage >= 30;
                return DataRow(cells: [
                  DataCell(Text(obj.month, style: const TextStyle(color: AppTheme.textPrimary, fontSize: 12))),
                  DataCell(Text(CurrencyFormatter.format(obj.collectable), style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12))),
                  DataCell(Text(CurrencyFormatter.format(obj.collected), style: const TextStyle(color: AppTheme.neonBlue, fontSize: 12))),
                  DataCell(Row(
                    children: [
                      Icon(
                        isThresholdMet ? Icons.check_circle : Icons.warning,
                        size: 14,
                        color: isThresholdMet ? AppTheme.success : Colors.orange,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '${obj.percentage.toStringAsFixed(1)}%',
                        style: TextStyle(
                          color: isThresholdMet ? AppTheme.success : Colors.orange,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  )),
                ]);
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  void _showSignature(DocumentHistory doc) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            const Icon(Icons.edit_note, color: AppTheme.neonPurple),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Firma - ${doc.type == DocumentType.factura ? 'Factura' : 'Albarán'} #${doc.number}',
                style: const TextStyle(fontSize: 16),
              ),
            ),
          ],
        ),
        content: Container(
          width: 300,
          height: 200,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.gesture, size: 48, color: Colors.grey.shade400),
                const SizedBox(height: 8),
                Text(
                  'Firma digital del cliente',
                  style: TextStyle(color: Colors.grey.shade600),
                ),
                const SizedBox(height: 4),
                Text(
                  DateFormat('dd/MM/yyyy HH:mm').format(doc.date),
                  style: TextStyle(fontSize: 11, color: Colors.grey.shade500),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cerrar'),
          ),
        ],
      ),
    );
  }

  void _shareDocument(DocumentHistory doc) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.share, color: Colors.white),
            const SizedBox(width: 12),
            Text('Compartiendo ${doc.type == DocumentType.factura ? 'Factura' : 'Albarán'} #${doc.number}...'),
          ],
        ),
        backgroundColor: AppTheme.neonBlue,
        behavior: SnackBarBehavior.floating,
      ),
    );
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
  final DateTime date;
  final double amount;
  final DeliveryStatus status;
  final bool hasSignature;
  final String? observations;

  DocumentHistory({
    required this.id,
    required this.type,
    required this.number,
    required this.date,
    required this.amount,
    required this.status,
    required this.hasSignature,
    this.observations,
  });
}

class MonthlyObjective {
  final String month;
  final double collectable;
  final double collected;
  final double percentage;

  MonthlyObjective({
    required this.month,
    required this.collectable,
    required this.collected,
    required this.percentage,
  });
}
