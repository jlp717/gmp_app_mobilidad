/// REPARTIDOR HISTÓRICO PAGE v3.0
/// Estructura de 2 niveles: Clientes → Documentos con filtros y acciones PDF/firma
///
/// Nivel 1: Lista de clientes con búsqueda, importe total, última visita
/// Nivel 2: Documentos del cliente con filtros (tipo, estado, fecha) y acciones

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
  List<_ClientItem> _clients = [];
  List<_DocumentItem> _documents = [];

  // Filters
  DateTime? _dateFrom;
  DateTime? _dateTo;
  _DocType? _filterDocType;
  _DeliveryStatus? _filterStatus;

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

  // ==========================================================================
  // DATA LOADING
  // ==========================================================================

  Future<void> _loadClients([String? search]) async {
    setState(() => _isLoading = true);
    try {
      final clients = await RepartidorDataService.getHistoryClients(
        repartidorId: widget.repartidorId,
        search: search,
      );
      _clients = clients.map((c) => _ClientItem(
        id: c.id,
        name: c.name,
        address: c.address,
        totalDocuments: c.totalDocuments,
        totalAmount: c.totalAmount,
        lastVisit: c.lastVisit,
      )).toList();
    } catch (e) {
      _clients = [];
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error al cargar clientes: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
    if (mounted) setState(() => _isLoading = false);
  }

  Future<void> _loadClientDocuments(String clientId, String clientName) async {
    setState(() {
      _isLoading = true;
      _selectedClientId = clientId;
      _selectedClientName = clientName;
    });

    try {
      final dateFromStr = _dateFrom != null
          ? '${_dateFrom!.year}-${_dateFrom!.month.toString().padLeft(2, '0')}-${_dateFrom!.day.toString().padLeft(2, '0')}'
          : null;
      final dateToStr = _dateTo != null
          ? '${_dateTo!.year}-${_dateTo!.month.toString().padLeft(2, '0')}-${_dateTo!.day.toString().padLeft(2, '0')}'
          : null;

      final docs = await RepartidorDataService.getClientDocuments(
        clientId: clientId,
        repartidorId: widget.repartidorId,
        dateFrom: dateFromStr,
        dateTo: dateToStr,
      );

      _documents = docs.map((d) {
        _DeliveryStatus status;
        switch (d.status) {
          case 'delivered':
            status = _DeliveryStatus.delivered;
            break;
          case 'partial':
            status = _DeliveryStatus.partial;
            break;
          case 'en_ruta':
            status = _DeliveryStatus.enRuta;
            break;
          default:
            status = _DeliveryStatus.notDelivered;
        }

        return _DocumentItem(
          id: d.id,
          type: d.type == 'factura' ? _DocType.factura : _DocType.albaran,
          number: d.number,
          serie: d.serie,
          ejercicio: d.ejercicio,
          terminal: d.terminal,
          albaranNumber: d.albaranNumber ?? d.number,
          facturaNumber: d.facturaNumber,
          date: DateTime.tryParse(d.date) ?? DateTime.now(),
          amount: d.amount,
          pending: d.pending,
          status: status,
          hasSignature: d.hasSignature,
          signaturePath: d.signaturePath,
          deliveryDate: d.deliveryDate,
          deliveryObs: d.deliveryObs,
          time: d.time,
          legacySignatureName: d.legacySignatureName,
          hasLegacySignature: d.hasLegacySignature,
          legacyDate: d.legacyDate,
        );
      }).toList();
    } catch (e) {
      _documents = [];
    }
    if (mounted) setState(() => _isLoading = false);
  }

  // ==========================================================================
  // FILTERING
  // ==========================================================================

  List<_DocumentItem> get _filteredDocuments {
    return _documents.where((doc) {
      if (_filterDocType != null && doc.type != _filterDocType) return false;
      if (_filterStatus != null && doc.status != _filterStatus) return false;
      return true;
    }).toList();
  }

  List<_ClientItem> get _filteredClients {
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

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          _buildHeader(),
          Expanded(
            child: _selectedClientId != null
                ? _buildDocumentsView()
                : _buildClientList(),
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // HEADER
  // ==========================================================================

  Widget _buildHeader() {
    if (_selectedClientId != null) {
      return Container(
        padding: const EdgeInsets.fromLTRB(8, 12, 16, 12),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          border: Border(bottom: BorderSide(color: AppTheme.neonPurple.withOpacity(0.2), width: 1)),
        ),
        child: Row(
          children: [
            IconButton(
              onPressed: _goBackToClients,
              icon: const Icon(Icons.arrow_back, color: AppTheme.textPrimary),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _selectedClientName ?? 'Cliente',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    'Cód: $_selectedClientId',
                    style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withOpacity(0.8)),
                  ),
                ],
              ),
            ),
            if (_clients.isNotEmpty) _buildClientQuickSwitch(),
          ],
        ),
      );
    }

    return SmartSyncHeader(
      title: 'Histórico',
      subtitle: 'Documentos repartidos por cliente',
      lastSync: DateTime.now(),
      isLoading: _isLoading,
      onSync: () => _loadClients(_searchController.text.isNotEmpty ? _searchController.text : null),
    );
  }

  void _goBackToClients() {
    setState(() {
      _selectedClientId = null;
      _selectedClientName = null;
      _documents = [];
      _clearFilters();
    });
  }

  Widget _buildClientQuickSwitch() {
    return PopupMenuButton<String>(
      tooltip: 'Cambiar cliente',
      offset: const Offset(0, 48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: AppTheme.surfaceColor,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [AppTheme.neonPurple.withOpacity(0.15), AppTheme.neonBlue.withOpacity(0.15)],
          ),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.swap_horiz, color: AppTheme.neonPurple, size: 16),
            SizedBox(width: 4),
            Text('Cambiar', style: TextStyle(color: AppTheme.neonPurple, fontSize: 11, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
      itemBuilder: (context) => _clients.take(20).map((client) {
        final isSelected = client.id == _selectedClientId;
        return PopupMenuItem<String>(
          value: client.id,
          child: Row(
            children: [
              Container(
                width: 32, height: 32,
                decoration: BoxDecoration(
                  color: isSelected ? AppTheme.neonPurple.withOpacity(0.2) : AppTheme.darkBase,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Center(
                  child: Text(client.name.isNotEmpty ? client.name[0] : '?',
                    style: TextStyle(color: isSelected ? AppTheme.neonPurple : AppTheme.textSecondary, fontWeight: FontWeight.bold, fontSize: 13)),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(client.name,
                  style: TextStyle(color: isSelected ? AppTheme.neonPurple : AppTheme.textPrimary, fontSize: 12),
                  overflow: TextOverflow.ellipsis),
              ),
              if (isSelected) const Icon(Icons.check_circle, color: AppTheme.neonPurple, size: 16),
            ],
          ),
        );
      }).toList(),
      onSelected: (clientId) {
        final client = _clients.firstWhere((c) => c.id == clientId);
        _loadClientDocuments(clientId, client.name);
      },
    );
  }

  // ==========================================================================
  // LEVEL 1: CLIENT LIST
  // ==========================================================================

  Widget _buildClientList() {
    return Column(
      children: [
        // Search bar
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
                      onPressed: () { _searchController.clear(); setState(() {}); },
                    )
                  : null,
              filled: true,
              fillColor: AppTheme.surfaceColor,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppTheme.neonPurple)),
            ),
            style: const TextStyle(color: AppTheme.textPrimary),
          ),
        ),

        // Client count
        if (!_isLoading && _clients.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                const Icon(Icons.people, size: 14, color: AppTheme.textSecondary),
                const SizedBox(width: 6),
                Text(
                  _searchController.text.isNotEmpty
                      ? '${_filteredClients.length} de ${_clients.length} clientes'
                      : '${_clients.length} clientes',
                  style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                ),
              ],
            ),
          ),
        const SizedBox(height: 8),

        // List
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
                          const Text('No se encontraron clientes', style: TextStyle(color: AppTheme.textSecondary)),
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

  Widget _buildClientCard(_ClientItem client) {
    return GestureDetector(
      onTap: () => _loadClientDocuments(client.id, client.name),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withOpacity(0.05)),
        ),
        child: Row(
          children: [
            // Avatar
            Container(
              width: 44, height: 44,
              decoration: BoxDecoration(
                color: AppTheme.neonPurple.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Center(
                child: Text(
                  client.name.isNotEmpty ? client.name[0] : '?',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.neonPurple),
                ),
              ),
            ),
            const SizedBox(width: 12),
            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppTheme.neonBlue.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(client.id,
                          style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.neonBlue)),
                      ),
                      const Spacer(),
                      if (client.lastVisit != null)
                        Text(client.lastVisit!,
                          style: TextStyle(fontSize: 10, color: AppTheme.textSecondary.withOpacity(0.7))),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(client.name,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text('${client.totalDocuments} docs',
                        style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                      const SizedBox(width: 12),
                      Text(CurrencyFormatter.format(client.totalAmount),
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.neonGreen)),
                    ],
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

  // ==========================================================================
  // LEVEL 2: CLIENT DOCUMENTS
  // ==========================================================================

  Widget _buildDocumentsView() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: AppTheme.neonPurple));
    }

    return Column(
      children: [
        // Filter chips
        _buildFilters(),
        // Document list
        Expanded(child: _buildDocumentsList()),
      ],
    );
  }

  Widget _buildFilters() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                // Date range
                _buildChip(
                  icon: Icons.date_range,
                  label: _dateFrom != null || _dateTo != null ? _formatDateRange() : 'Fechas',
                  isActive: _dateFrom != null || _dateTo != null,
                  color: AppTheme.neonBlue,
                  onTap: _showDateRangePicker,
                ),
                const SizedBox(width: 8),
                // Doc type
                _buildChip(
                  icon: _filterDocType == _DocType.factura ? Icons.receipt : Icons.description,
                  label: _filterDocType == null ? 'Tipo'
                      : _filterDocType == _DocType.factura ? 'Facturas' : 'Albaranes',
                  isActive: _filterDocType != null,
                  color: AppTheme.neonPurple,
                  onTap: _cycleDocType,
                ),
                const SizedBox(width: 8),
                // Status
                _buildChip(
                  icon: _statusIcon(_filterStatus),
                  label: _statusLabel(_filterStatus),
                  isActive: _filterStatus != null,
                  color: _statusColor(_filterStatus),
                  onTap: _cycleStatus,
                ),
                if (_hasActiveFilters) ...[
                  const SizedBox(width: 8),
                  _buildChip(
                    icon: Icons.close,
                    label: 'Limpiar',
                    isActive: false,
                    color: AppTheme.error,
                    onTap: () {
                      _clearFilters();
                      // Re-fetch without date filters
                      if (_selectedClientId != null) {
                        _loadClientDocuments(_selectedClientId!, _selectedClientName ?? '');
                      }
                    },
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.filter_list, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 6),
              Text(
                '${_filteredDocuments.length} de ${_documents.length} documentos',
                style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildChip({
    required IconData icon,
    required String label,
    required bool isActive,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          gradient: isActive
              ? LinearGradient(colors: [color.withOpacity(0.2), color.withOpacity(0.1)])
              : null,
          color: isActive ? null : AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isActive ? color.withOpacity(0.5) : Colors.white.withOpacity(0.1),
            width: isActive ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: isActive ? color : AppTheme.textSecondary),
            const SizedBox(width: 5),
            Text(label,
              style: TextStyle(
                fontSize: 12,
                color: isActive ? color : AppTheme.textSecondary,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
              )),
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
              size: 48, color: AppTheme.textSecondary.withOpacity(0.5)),
            const SizedBox(height: 16),
            Text(
              _hasActiveFilters
                  ? 'No hay documentos con estos filtros'
                  : 'Sin documentos',
              style: const TextStyle(color: AppTheme.textSecondary)),
            if (_hasActiveFilters) ...[
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: () {
                  _clearFilters();
                  _loadClientDocuments(_selectedClientId!, _selectedClientName ?? '');
                },
                icon: const Icon(Icons.clear, size: 16),
                label: const Text('Limpiar filtros'),
                style: TextButton.styleFrom(foregroundColor: AppTheme.neonPurple),
              ),
            ],
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => _loadClientDocuments(_selectedClientId!, _selectedClientName ?? ''),
      color: AppTheme.neonPurple,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: docs.length,
        itemBuilder: (context, index) => _buildDocumentCard(docs[index]),
      ),
    );
  }

  Widget _buildDocumentCard(_DocumentItem doc) {
    final Color statusColor;
    final IconData statusIcon;
    final String statusLabel;

    switch (doc.status) {
      case _DeliveryStatus.delivered:
        statusColor = AppTheme.success;
        statusIcon = Icons.check_circle;
        statusLabel = 'Entregado';
        break;
      case _DeliveryStatus.partial:
        statusColor = Colors.orange;
        statusIcon = Icons.pie_chart;
        statusLabel = 'Parcial';
        break;
      case _DeliveryStatus.notDelivered:
        statusColor = AppTheme.error;
        statusIcon = Icons.cancel;
        statusLabel = 'No Entregado';
        break;
      case _DeliveryStatus.enRuta:
        statusColor = AppTheme.neonBlue;
        statusIcon = Icons.local_shipping;
        statusLabel = 'En Ruta';
        break;
    }

    final isFactura = doc.type == _DocType.factura;

    return GestureDetector(
      onTap: () => _showDocumentActions(doc),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: statusColor.withOpacity(0.15)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Row 1: Type badge + number + status
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: isFactura ? Colors.purple.withOpacity(0.2) : AppTheme.neonBlue.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        isFactura ? Icons.receipt_long : Icons.description,
                        size: 13,
                        color: isFactura ? Colors.purpleAccent : AppTheme.neonBlue,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        isFactura ? 'F' : 'A',
                        style: TextStyle(
                          fontSize: 11, fontWeight: FontWeight.bold,
                          color: isFactura ? Colors.purpleAccent : AppTheme.neonBlue,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text('#${doc.number}',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                if (isFactura && doc.albaranNumber != null && doc.albaranNumber != doc.number)
                  Text('  (Alb. ${doc.albaranNumber})',
                    style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withOpacity(0.7))),
                const Spacer(),
                Icon(statusIcon, size: 15, color: statusColor),
                const SizedBox(width: 4),
                Text(statusLabel,
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: statusColor)),
              ],
            ),
            const SizedBox(height: 8),

            // Row 2: Date + signature icon + amount
            Row(
              children: [
                const Icon(Icons.calendar_today, size: 13, color: AppTheme.textSecondary),
                const SizedBox(width: 5),
                Text(DateFormat('dd/MM/yyyy').format(doc.date),
                  style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                if (doc.time != null) ...[
                   const SizedBox(width: 6),
                   Container(
                     padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                     decoration: BoxDecoration(
                       color: AppTheme.textSecondary.withOpacity(0.1),
                       borderRadius: BorderRadius.circular(4),
                     ),
                     child: Text('Prev: ${doc.time!}', 
                       style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
                   ),
                ],
                const SizedBox(width: 12),
                if (doc.hasSignature)
                  Tooltip(
                    message: doc.hasLegacySignature && doc.signaturePath == null ? 'Firma histórica (ERP)' : 'Firma digital',
                    child: Icon(
                      doc.hasLegacySignature && doc.signaturePath == null ? Icons.history_edu : Icons.draw,
                      size: 14,
                      color: AppTheme.neonPurple.withOpacity(0.7),
                    ),
                  ),
                if (doc.pending > 0) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: Colors.orange.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text('Pdte: ${CurrencyFormatter.format(doc.pending)}',
                      style: TextStyle(fontSize: 9, color: Colors.orange.shade300)),
                  ),
                ],
                const Spacer(),
                Text(CurrencyFormatter.format(doc.amount),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.neonGreen)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // DOCUMENT ACTIONS BOTTOM SHEET
  // ==========================================================================

  void _showDocumentActions(_DocumentItem doc) {
    final isFactura = doc.type == _DocType.factura;
    final typeLabel = isFactura ? 'Factura' : 'Albarán';

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: const BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle
            Container(
              margin: const EdgeInsets.only(top: 12),
              width: 40, height: 4,
              decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), borderRadius: BorderRadius.circular(2)),
            ),

            // Header
            Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: isFactura ? Colors.purple.withOpacity(0.2) : AppTheme.neonBlue.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      isFactura ? Icons.receipt_long : Icons.description,
                      color: isFactura ? Colors.purpleAccent : AppTheme.neonBlue, size: 22),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('$typeLabel #${doc.number}',
                          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                        Text('${DateFormat('dd/MM/yyyy').format(doc.date)} · ${CurrencyFormatter.format(doc.amount)}',
                          style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Actions
            _buildActionTile(
              icon: Icons.picture_as_pdf,
              label: 'Ver / Compartir PDF',
              color: AppTheme.error,
              onTap: () {
                Navigator.pop(ctx);
                _shareDocumentPdf(doc);
              },
            ),
            _buildActionTile(
              icon: Icons.email_outlined,
              label: 'Enviar por Email',
              color: AppTheme.neonBlue,
              onTap: () {
                Navigator.pop(ctx);
                _emailDocument(doc);
              },
            ),
            if (doc.hasSignature)
              _buildActionTile(
                icon: Icons.draw,
                label: 'Ver Firma',
                color: AppTheme.neonPurple,
                onTap: () {
                  Navigator.pop(ctx);
                  _showSignatureDialog(doc);
                },
              ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildActionTile({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTheme.darkBase,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withOpacity(0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(width: 14),
            Text(label, style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary)),
            const Spacer(),
            Icon(Icons.chevron_right, color: AppTheme.textSecondary.withOpacity(0.5)),
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // ACTIONS
  // ==========================================================================

  Future<void> _shareDocumentPdf(_DocumentItem doc) async {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Generando PDF...'), duration: Duration(seconds: 2), backgroundColor: AppTheme.info),
    );

    try {
      final bytes = await RepartidorDataService.downloadDocument(
        year: doc.ejercicio > 0 ? doc.ejercicio : doc.date.year,
        serie: doc.serie,
        number: doc.albaranNumber ?? doc.number,
        terminal: doc.terminal,
        type: doc.type == _DocType.factura ? 'factura' : 'albaran',
      );

      final tempDir = await getTemporaryDirectory();
      final typeLabel = doc.type == _DocType.factura ? 'Factura' : 'Albaran';
      final fileName = '${typeLabel}_${doc.serie}_${doc.number}.pdf';
      final file = File('${tempDir.path}/$fileName');
      await file.writeAsBytes(bytes);

      await Share.shareXFiles(
        [XFile(file.path)],
        text: '$typeLabel ${doc.number} - ${DateFormat('dd/MM/yyyy').format(doc.date)}',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error al compartir: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
  }

  Future<void> _emailDocument(_DocumentItem doc) async {
    final email = await _showEmailInputDialog();
    if (email == null || email.isEmpty) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Enviando a $email...'), duration: const Duration(seconds: 2), backgroundColor: AppTheme.info),
    );

    try {
      final bytes = await RepartidorDataService.downloadDocument(
        year: doc.ejercicio > 0 ? doc.ejercicio : doc.date.year,
        serie: doc.serie,
        number: doc.albaranNumber ?? doc.number,
        terminal: doc.terminal,
        type: doc.type == _DocType.factura ? 'factura' : 'albaran',
      );

      final tempDir = await getTemporaryDirectory();
      final typeLabel = doc.type == _DocType.factura ? 'Factura' : 'Albaran';
      final fileName = '${typeLabel}_${doc.serie}_${doc.number}.pdf';
      final file = File('${tempDir.path}/$fileName');
      await file.writeAsBytes(bytes);

      await Share.shareXFiles(
        [XFile(file.path)],
        text: '$typeLabel ${doc.number} - ${DateFormat('dd/MM/yyyy').format(doc.date)}',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
  }

  Future<String?> _showEmailInputDialog() async {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            const Icon(Icons.email, color: AppTheme.neonBlue, size: 22),
            const SizedBox(width: 8),
            const Text('Enviar por Email', style: TextStyle(fontSize: 16, color: AppTheme.textPrimary)),
          ],
        ),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.emailAddress,
          style: const TextStyle(color: AppTheme.textPrimary),
          decoration: InputDecoration(
            hintText: 'email@ejemplo.com',
            hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5)),
            prefixIcon: const Icon(Icons.alternate_email, color: AppTheme.textSecondary),
            filled: true,
            fillColor: AppTheme.darkBase,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Enviar', style: TextStyle(color: AppTheme.neonBlue)),
          ),
        ],
      ),
    );
  }

  void _showSignatureDialog(_DocumentItem doc) {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => _SignatureDialog(
        ejercicio: doc.ejercicio > 0 ? doc.ejercicio : doc.date.year,
        serie: doc.serie,
        terminal: doc.terminal,
        numero: doc.albaranNumber ?? doc.number,
        docLabel: '${doc.type == _DocType.factura ? "Factura" : "Albarán"} #${doc.number}',
        legacySignatureName: doc.legacySignatureName,
        legacyDate: doc.legacyDate,
      ),
    );
  }

  // ==========================================================================
  // FILTER HELPERS
  // ==========================================================================

  String _formatDateRange() {
    final df = DateFormat('dd/MM');
    if (_dateFrom != null && _dateTo != null) return '${df.format(_dateFrom!)} - ${df.format(_dateTo!)}';
    if (_dateFrom != null) return 'Desde ${df.format(_dateFrom!)}';
    if (_dateTo != null) return 'Hasta ${df.format(_dateTo!)}';
    return 'Fechas';
  }

  Future<void> _showDateRangePicker() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
      initialDateRange: _dateFrom != null && _dateTo != null
          ? DateTimeRange(start: _dateFrom!, end: _dateTo!)
          : null,
      builder: (context, child) => Theme(
        data: ThemeData.dark().copyWith(
          colorScheme: const ColorScheme.dark(
            primary: AppTheme.neonPurple,
            onPrimary: Colors.white,
            surface: AppTheme.surfaceColor,
            onSurface: AppTheme.textPrimary,
          ),
        ),
        child: child!,
      ),
    );

    if (picked != null) {
      setState(() {
        _dateFrom = picked.start;
        _dateTo = picked.end;
      });
      // Re-fetch with date range from backend
      if (_selectedClientId != null) {
        _loadClientDocuments(_selectedClientId!, _selectedClientName ?? '');
      }
    }
  }

  void _cycleDocType() {
    setState(() {
      if (_filterDocType == null) {
        _filterDocType = _DocType.albaran;
      } else if (_filterDocType == _DocType.albaran) {
        _filterDocType = _DocType.factura;
      } else {
        _filterDocType = null;
      }
    });
  }

  void _cycleStatus() {
    setState(() {
      if (_filterStatus == null) {
        _filterStatus = _DeliveryStatus.delivered;
      } else if (_filterStatus == _DeliveryStatus.delivered) {
        _filterStatus = _DeliveryStatus.partial;
      } else if (_filterStatus == _DeliveryStatus.partial) {
        _filterStatus = _DeliveryStatus.notDelivered;
      } else {
        _filterStatus = null;
      }
    });
  }

  IconData _statusIcon(_DeliveryStatus? s) {
    switch (s) {
      case _DeliveryStatus.delivered: return Icons.check_circle;
      case _DeliveryStatus.partial: return Icons.pie_chart;
      case _DeliveryStatus.notDelivered: return Icons.cancel;
      case _DeliveryStatus.enRuta: return Icons.local_shipping;
      default: return Icons.filter_alt;
    }
  }

  String _statusLabel(_DeliveryStatus? s) {
    switch (s) {
      case _DeliveryStatus.delivered: return 'Entregado';
      case _DeliveryStatus.partial: return 'Parcial';
      case _DeliveryStatus.notDelivered: return 'No Entreg.';
      case _DeliveryStatus.enRuta: return 'En Ruta';
      default: return 'Estado';
    }
  }

  Color _statusColor(_DeliveryStatus? s) {
    switch (s) {
      case _DeliveryStatus.delivered: return AppTheme.success;
      case _DeliveryStatus.partial: return Colors.orange;
      case _DeliveryStatus.notDelivered: return AppTheme.error;
      case _DeliveryStatus.enRuta: return AppTheme.neonBlue;
      default: return AppTheme.neonGreen;
    }
  }
}

// =============================================================================
// MODELS (private)
// =============================================================================

class _ClientItem {
  final String id;
  final String name;
  final String address;
  final int totalDocuments;
  final double totalAmount;
  final String? lastVisit;

  _ClientItem({
    required this.id,
    required this.name,
    required this.address,
    required this.totalDocuments,
    this.totalAmount = 0,
    this.lastVisit,
  });
}

enum _DocType { albaran, factura }
enum _DeliveryStatus { delivered, partial, notDelivered, enRuta }

class _DocumentItem {
  final String id;
  final _DocType type;
  final int number;
  final String serie;
  final int ejercicio;
  final int terminal;
  final int? albaranNumber;
  final int? facturaNumber;
  final DateTime date;
  final double amount;
  final double pending;
  final _DeliveryStatus status;
  final bool hasSignature;
  final String? signaturePath;
  final String? deliveryDate;
  final String? deliveryObs;
  final String? time;
  // Legacy signature fields (from CACFIRMAS)
  final String? legacySignatureName;
  final bool hasLegacySignature;
  final String? legacyDate;

  _DocumentItem({
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
    this.pending = 0,
    required this.status,
    required this.hasSignature,
    this.signaturePath,
    this.deliveryDate,
    this.deliveryObs,
    this.time,
    this.legacySignatureName,
    this.hasLegacySignature = false,
    this.legacyDate,
  });
}

// =============================================================================
// SIGNATURE DIALOG
// =============================================================================

class _SignatureDialog extends StatefulWidget {
  final int ejercicio;
  final String serie;
  final int terminal;
  final int numero;
  final String docLabel;
  final String? legacySignatureName;
  final String? legacyDate;

  const _SignatureDialog({
    required this.ejercicio,
    required this.serie,
    required this.terminal,
    required this.numero,
    required this.docLabel,
    this.legacySignatureName,
    this.legacyDate,
  });

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
        ejercicio: widget.ejercicio,
        serie: widget.serie,
        terminal: widget.terminal,
        numero: widget.numero,
      );

      if (data != null && data['base64'] != null) {
        setState(() {
          _signatureBytes = base64Decode(data['base64'] as String);
          _firmante = data['firmante'] as String?;
          _fecha = data['fecha'] as String?;
          _loading = false;
        });
      } else {
        // No base64 from main endpoint — show legacy info if available
        String errorMsg = 'No se encontró firma para este documento';
        if (widget.legacySignatureName != null && widget.legacySignatureName!.trim().isNotEmpty) {
          errorMsg = 'Firma registrada por: ${widget.legacySignatureName!.trim()}';
          if (widget.legacyDate != null) {
            errorMsg += '\nFecha: ${widget.legacyDate}';
          }
          errorMsg += '\n\n(Imagen no disponible para firmas antiguas)';
        }
        setState(() { _loading = false; _error = errorMsg; });
      }
    } catch (e) {
      setState(() { _loading = false; _error = 'Error al cargar firma: $e'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: [
          const Icon(Icons.draw, color: AppTheme.neonPurple),
          const SizedBox(width: 8),
          Expanded(
            child: Text('Firma - ${widget.docLabel}',
              style: const TextStyle(fontSize: 16, color: AppTheme.textPrimary)),
          ),
        ],
      ),
      content: SizedBox(
        width: 320, height: 260,
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
                              minScale: 0.5, maxScale: 4.0,
                              child: _signatureBytes != null
                                  ? Image.memory(_signatureBytes!, fit: BoxFit.contain)
                                  : const Center(child: Icon(Icons.gesture, size: 48)),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (_firmante != null)
                        Text('Firmante: $_firmante', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                      if (_fecha != null)
                        Text('Fecha: $_fecha', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withOpacity(0.8))),
                    ],
                  ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cerrar')),
      ],
    );
  }
}
