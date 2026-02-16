/// REPARTIDOR HISTÓRICO PAGE v4.0
/// Full redesign with advanced filters, year selector, search by number,
/// proper deduplication, and working signatures
///
/// Nivel 1: Lista de clientes con búsqueda
/// Nivel 2: Documentos del cliente con filtros avanzados

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
  final String? initialClientId;
  final String? initialClientName;

  const RepartidorHistoricoPage({
    super.key,
    required this.repartidorId,
    this.initialClientId,
    this.initialClientName,
  });

  @override
  State<RepartidorHistoricoPage> createState() => _RepartidorHistoricoPageState();
}

class _RepartidorHistoricoPageState extends State<RepartidorHistoricoPage> {
  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _docSearchController = TextEditingController();
  bool _isLoading = false;
  String? _selectedClientId;
  String? _selectedClientName;
  List<_ClientItem> _clients = [];
  List<_DocumentItem> _documents = [];

  // Advanced Filters
  DateTime? _dateFrom;
  DateTime? _dateTo;
  _DocType? _filterDocType;
  _DeliveryStatus? _filterStatus;
  int? _selectedYear; // null = all recent years (last 3)

  @override
  void initState() {
    super.initState();
    if (widget.initialClientId != null) {
      // Navigate directly to client documents — set state immediately to show loading
      _selectedClientId = widget.initialClientId;
      _selectedClientName = widget.initialClientName ?? widget.initialClientId!;
      _isLoading = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _loadClientDocuments(widget.initialClientId!, widget.initialClientName ?? widget.initialClientId!);
      });
      // Load clients list in background (won't conflict since _loadClientDocuments manages _isLoading)
      _loadClients();
    } else {
      _loadClients();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    _docSearchController.dispose();
    super.dispose();
  }

  // ==========================================================================
  // DATA LOADING
  // ==========================================================================

  Future<void> _loadClients([String? search]) async {
    // Don't set loading if already viewing documents (would flash empty state)
    final isInDocView = _selectedClientId != null;
    if (!isInDocView) setState(() => _isLoading = true);
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
      if (mounted && !isInDocView) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error al cargar clientes: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
    if (mounted && !isInDocView) setState(() => _isLoading = false);
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
        year: _selectedYear,
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
          serieFactura: d.serieFactura,
          ejercicioFactura: d.ejercicioFactura,
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
    final searchQuery = _docSearchController.text.trim().toLowerCase();
    return _documents.where((doc) {
      if (_filterDocType != null && doc.type != _filterDocType) return false;
      if (_filterStatus != null && doc.status != _filterStatus) return false;
      // Search by number
      if (searchQuery.isNotEmpty) {
        final numStr = doc.number.toString();
        final albStr = (doc.albaranNumber ?? doc.number).toString();
        final factStr = (doc.facturaNumber ?? 0).toString();
        if (!numStr.contains(searchQuery) && !albStr.contains(searchQuery) && !factStr.contains(searchQuery)) {
          return false;
        }
      }
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
      _docSearchController.clear();
    });
  }

  bool get _hasActiveFilters =>
      _dateFrom != null || _dateTo != null || _filterDocType != null ||
      _filterStatus != null || _docSearchController.text.isNotEmpty;

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
        padding: const EdgeInsets.fromLTRB(8, 12, 16, 8),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          border: Border(bottom: BorderSide(color: AppTheme.neonPurple.withOpacity(0.2), width: 1)),
        ),
        child: Column(
          children: [
            Row(
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
      _selectedYear = null;
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
        // Advanced filter bar
        _buildAdvancedFilters(),
        // Stats summary
        _buildDocStats(),
        // Document list
        Expanded(child: _buildDocumentsList()),
      ],
    );
  }

  Widget _buildAdvancedFilters() {
    final currentYear = DateTime.now().year;
    final years = List.generate(5, (i) => currentYear - i);

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Column(
        children: [
          // Row 1: Year selector + Document number search
          Row(
            children: [
              // Year dropdown
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceColor,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: _selectedYear != null ? AppTheme.neonBlue.withOpacity(0.5) : Colors.white.withOpacity(0.1),
                  ),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<int?>(
                    value: _selectedYear,
                    hint: Text('Últimos 3 años', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary.withOpacity(0.7))),
                    dropdownColor: AppTheme.surfaceColor,
                    icon: const Icon(Icons.calendar_month, size: 16, color: AppTheme.neonBlue),
                    style: const TextStyle(fontSize: 12, color: AppTheme.textPrimary),
                    isDense: true,
                    items: [
                      const DropdownMenuItem<int?>(
                        value: null,
                        child: Text('Últimos 3 años', style: TextStyle(fontSize: 12)),
                      ),
                      ...years.map((y) => DropdownMenuItem<int?>(
                        value: y,
                        child: Text('$y', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      )),
                    ],
                    onChanged: (val) {
                      setState(() => _selectedYear = val);
                      if (_selectedClientId != null) {
                        _loadClientDocuments(_selectedClientId!, _selectedClientName ?? '');
                      }
                    },
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // Number search
              Expanded(
                child: SizedBox(
                  height: 38,
                  child: TextField(
                    controller: _docSearchController,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: 'Buscar nº documento...',
                      hintStyle: TextStyle(fontSize: 12, color: AppTheme.textSecondary.withOpacity(0.5)),
                      prefixIcon: const Icon(Icons.tag, size: 16, color: AppTheme.textSecondary),
                      suffixIcon: _docSearchController.text.isNotEmpty
                          ? GestureDetector(
                              onTap: () { _docSearchController.clear(); setState(() {}); },
                              child: const Icon(Icons.clear, size: 16, color: AppTheme.textSecondary))
                          : null,
                      filled: true,
                      fillColor: AppTheme.surfaceColor,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 0),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: const BorderSide(color: AppTheme.neonPurple, width: 1),
                      ),
                    ),
                    style: const TextStyle(color: AppTheme.textPrimary, fontSize: 12),
                    keyboardType: TextInputType.number,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // Row 2: Dropdown filters (redesigned from chips)
          Row(
            children: [
              // Date range button
              Expanded(
                child: _buildFilterDropdown(
                  icon: Icons.date_range,
                  label: _dateFrom != null || _dateTo != null ? _formatDateRange() : 'Fechas',
                  isActive: _dateFrom != null || _dateTo != null,
                  color: AppTheme.neonBlue,
                  onTap: _showDateRangePicker,
                ),
              ),
              const SizedBox(width: 6),
              // Doc type dropdown
              Expanded(
                child: Container(
                  height: 38,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  decoration: BoxDecoration(
                    color: _filterDocType != null ? AppTheme.neonPurple.withOpacity(0.1) : AppTheme.surfaceColor,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: _filterDocType != null ? AppTheme.neonPurple.withOpacity(0.5) : Colors.white.withOpacity(0.1),
                    ),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<_DocType?>(
                      value: _filterDocType,
                      hint: Row(
                        children: [
                          Icon(Icons.description, size: 14, color: AppTheme.textSecondary.withOpacity(0.6)),
                          const SizedBox(width: 4),
                          Text('Tipo Doc', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withOpacity(0.6))),
                        ],
                      ),
                      isDense: true,
                      isExpanded: true,
                      dropdownColor: AppTheme.surfaceColor,
                      style: const TextStyle(fontSize: 11, color: AppTheme.textPrimary),
                      items: [
                        DropdownMenuItem<_DocType?>(
                          value: null,
                          child: Row(children: [
                            Icon(Icons.all_inclusive, size: 14, color: AppTheme.textSecondary),
                            const SizedBox(width: 4),
                            const Text('Todos', style: TextStyle(fontSize: 11)),
                          ]),
                        ),
                        DropdownMenuItem<_DocType?>(
                          value: _DocType.factura,
                          child: Row(children: [
                            const Icon(Icons.receipt, size: 14, color: AppTheme.neonPurple),
                            const SizedBox(width: 4),
                            const Text('Facturas', style: TextStyle(fontSize: 11)),
                          ]),
                        ),
                        DropdownMenuItem<_DocType?>(
                          value: _DocType.albaran,
                          child: Row(children: [
                            const Icon(Icons.description, size: 14, color: AppTheme.neonBlue),
                            const SizedBox(width: 4),
                            const Text('Albaranes', style: TextStyle(fontSize: 11)),
                          ]),
                        ),
                      ],
                      onChanged: (val) => setState(() => _filterDocType = val),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              // Status dropdown
              Expanded(
                child: Container(
                  height: 38,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  decoration: BoxDecoration(
                    color: _filterStatus != null ? _statusColor(_filterStatus).withOpacity(0.1) : AppTheme.surfaceColor,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: _filterStatus != null ? _statusColor(_filterStatus).withOpacity(0.5) : Colors.white.withOpacity(0.1),
                    ),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<_DeliveryStatus?>(
                      value: _filterStatus,
                      hint: Row(
                        children: [
                          Icon(Icons.local_shipping, size: 14, color: AppTheme.textSecondary.withOpacity(0.6)),
                          const SizedBox(width: 4),
                          Text('Estado', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withOpacity(0.6))),
                        ],
                      ),
                      isDense: true,
                      isExpanded: true,
                      dropdownColor: AppTheme.surfaceColor,
                      style: const TextStyle(fontSize: 11, color: AppTheme.textPrimary),
                      items: [
                        DropdownMenuItem<_DeliveryStatus?>(
                          value: null,
                          child: Row(children: [
                            Icon(Icons.all_inclusive, size: 14, color: AppTheme.textSecondary),
                            const SizedBox(width: 4),
                            const Text('Todos', style: TextStyle(fontSize: 11)),
                          ]),
                        ),
                        DropdownMenuItem<_DeliveryStatus?>(
                          value: _DeliveryStatus.delivered,
                          child: Row(children: [
                            const Icon(Icons.check_circle, size: 14, color: Color(0xFF4CAF50)),
                            const SizedBox(width: 4),
                            const Text('Entregado', style: TextStyle(fontSize: 11)),
                          ]),
                        ),
                        DropdownMenuItem<_DeliveryStatus?>(
                          value: _DeliveryStatus.enRuta,
                          child: Row(children: [
                            Icon(Icons.local_shipping, size: 14, color: AppTheme.neonBlue),
                            const SizedBox(width: 4),
                            const Text('En Ruta', style: TextStyle(fontSize: 11)),
                          ]),
                        ),
                        DropdownMenuItem<_DeliveryStatus?>(
                          value: _DeliveryStatus.partial,
                          child: Row(children: [
                            const Icon(Icons.pie_chart, size: 14, color: Colors.orange),
                            const SizedBox(width: 4),
                            const Text('Parcial', style: TextStyle(fontSize: 11)),
                          ]),
                        ),
                        DropdownMenuItem<_DeliveryStatus?>(
                          value: _DeliveryStatus.notDelivered,
                          child: Row(children: [
                            Icon(Icons.cancel, size: 14, color: AppTheme.error),
                            const SizedBox(width: 4),
                            const Text('Pendiente', style: TextStyle(fontSize: 11)),
                          ]),
                        ),
                      ],
                      onChanged: (val) => setState(() => _filterStatus = val),
                    ),
                  ),
                ),
              ),
              // Clear button
              if (_hasActiveFilters) ...[
                const SizedBox(width: 6),
                InkWell(
                  onTap: () {
                    _clearFilters();
                    if (_selectedClientId != null) {
                      _loadClientDocuments(_selectedClientId!, _selectedClientName ?? '');
                    }
                  },
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    height: 38,
                    width: 38,
                    decoration: BoxDecoration(
                      color: AppTheme.error.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppTheme.error.withOpacity(0.3)),
                    ),
                    child: Icon(Icons.filter_alt_off, size: 16, color: AppTheme.error),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDocStats() {
    final filtered = _filteredDocuments;
    final totalAmount = filtered.fold<double>(0, (sum, d) => sum + d.amount);
    final delivered = filtered.where((d) => d.status == _DeliveryStatus.delivered).length;
    final withSignature = filtered.where((d) => d.hasSignature || d.hasLegacySignature).length;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [AppTheme.surfaceColor, AppTheme.surfaceColor.withOpacity(0.7)],
        ),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildStatItem('Docs', '${filtered.length}', AppTheme.neonBlue),
          _buildStatDivider(),
          _buildStatItem('Total', CurrencyFormatter.formatCompact(totalAmount), AppTheme.neonGreen),
          _buildStatDivider(),
          _buildStatItem('Entregados', '$delivered', AppTheme.success),
          _buildStatDivider(),
          _buildStatItem('Firmados', '$withSignature', AppTheme.neonPurple),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: color)),
        Text(label, style: TextStyle(fontSize: 9, color: AppTheme.textSecondary.withOpacity(0.7))),
      ],
    );
  }

  Widget _buildStatDivider() {
    return Container(width: 1, height: 24, color: Colors.white.withOpacity(0.08));
  }

  Widget _buildFilterDropdown({
    required IconData icon,
    required String label,
    required bool isActive,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        height: 38,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          color: isActive ? color.withOpacity(0.1) : AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isActive ? color.withOpacity(0.5) : Colors.white.withOpacity(0.1),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 14, color: isActive ? color : AppTheme.textSecondary),
            const SizedBox(width: 4),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  color: isActive ? color : AppTheme.textSecondary,
                  fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Icon(Icons.arrow_drop_down, size: 16, color: isActive ? color : AppTheme.textSecondary),
          ],
        ),
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
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
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
            Icon(icon, size: 14, color: isActive ? color : AppTheme.textSecondary),
            const SizedBox(width: 4),
            Text(label,
              style: TextStyle(
                fontSize: 11,
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
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
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
        statusLabel = 'Pendiente';
        break;
      case _DeliveryStatus.enRuta:
        statusColor = AppTheme.neonBlue;
        statusIcon = Icons.local_shipping;
        statusLabel = 'En Ruta';
        break;
    }

    final isFactura = doc.type == _DocType.factura;
    final hasAnySignature = doc.hasSignature || doc.hasLegacySignature;

    return GestureDetector(
      onTap: () => _showDocumentActions(doc),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(12),
          border: Border(
            left: BorderSide(color: statusColor, width: 3),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Row 1: Type badge + number + status
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: isFactura ? Colors.purple.withOpacity(0.2) : AppTheme.neonBlue.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    isFactura ? 'FAC' : 'ALB',
                    style: TextStyle(
                      fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 0.5,
                      color: isFactura ? Colors.purpleAccent : AppTheme.neonBlue,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  isFactura && doc.facturaNumber != null && doc.facturaNumber! > 0
                    ? '${doc.serieFactura ?? doc.serie}-${doc.facturaNumber}'
                    : '${doc.serie}-${doc.number}',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                if (isFactura && doc.albaranNumber != null && doc.albaranNumber != doc.number)
                  Text('  (Alb ${doc.albaranNumber})',
                    style: TextStyle(fontSize: 10, color: AppTheme.textSecondary.withOpacity(0.6))),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(statusIcon, size: 12, color: statusColor),
                      const SizedBox(width: 3),
                      Text(statusLabel,
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: statusColor)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),

            // Row 2: Date + time + signature badge + amount
            Row(
              children: [
                Icon(Icons.calendar_today, size: 12, color: AppTheme.textSecondary.withOpacity(0.6)),
                const SizedBox(width: 4),
                Text(DateFormat('dd/MM/yyyy').format(doc.date),
                  style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withOpacity(0.8))),
                if (doc.time != null) ...[
                  const SizedBox(width: 6),
                  Icon(Icons.access_time, size: 11, color: AppTheme.textSecondary.withOpacity(0.5)),
                  const SizedBox(width: 2),
                  Text(doc.time!, style: TextStyle(fontSize: 10, color: AppTheme.textSecondary.withOpacity(0.7))),
                ],
                if (hasAnySignature) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppTheme.neonPurple.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          doc.hasLegacySignature && doc.signaturePath == null ? Icons.history_edu : Icons.draw,
                          size: 11, color: AppTheme.neonPurple),
                        const SizedBox(width: 2),
                        Text(
                          doc.legacySignatureName != null && doc.legacySignatureName!.trim().isNotEmpty
                            ? doc.legacySignatureName!.trim()
                            : 'Firma',
                          style: const TextStyle(fontSize: 9, color: AppTheme.neonPurple, fontWeight: FontWeight.w500),
                        ),
                      ],
                    ),
                  ),
                ],
                if (doc.pending > 0) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: BoxDecoration(
                      color: Colors.orange.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text('Pdte ${CurrencyFormatter.format(doc.pending)}',
                      style: TextStyle(fontSize: 9, color: Colors.orange.shade300)),
                  ),
                ],
                const Spacer(),
                Text(CurrencyFormatter.format(doc.amount),
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.neonGreen)),
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
    final hasAnySignature = doc.hasSignature || doc.hasLegacySignature;

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
            if (hasAnySignature)
              _buildActionTile(
                icon: Icons.draw,
                label: 'Ver Firma',
                subtitle: doc.legacySignatureName != null && doc.legacySignatureName!.trim().isNotEmpty
                    ? 'Firmado por: ${doc.legacySignatureName!.trim()}'
                    : null,
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
    String? subtitle,
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
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary)),
                  if (subtitle != null)
                    Text(subtitle, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withOpacity(0.7))),
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
  // ACTIONS
  // ==========================================================================

  Future<void> _shareDocumentPdf(_DocumentItem doc) async {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Generando PDF...'), duration: Duration(seconds: 2), backgroundColor: AppTheme.info),
    );

    try {
      final isFactura = doc.type == _DocType.factura;
      final bytes = await RepartidorDataService.downloadDocument(
        year: doc.ejercicio > 0 ? doc.ejercicio : doc.date.year,
        serie: doc.serie,
        number: isFactura ? (doc.facturaNumber ?? doc.number) : (doc.albaranNumber ?? doc.number),
        terminal: doc.terminal,
        type: isFactura ? 'factura' : 'albaran',
        facturaNumber: doc.facturaNumber,
        serieFactura: doc.serieFactura,
        ejercicioFactura: doc.ejercicioFactura,
        albaranNumber: doc.albaranNumber ?? doc.number,
        albaranSerie: doc.serie,
        albaranTerminal: doc.terminal,
        albaranYear: doc.ejercicio,
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
      final isFactura = doc.type == _DocType.factura;
      final bytes = await RepartidorDataService.downloadDocument(
        year: doc.ejercicio > 0 ? doc.ejercicio : doc.date.year,
        serie: doc.serie,
        number: isFactura ? (doc.facturaNumber ?? doc.number) : (doc.albaranNumber ?? doc.number),
        terminal: doc.terminal,
        type: isFactura ? 'factura' : 'albaran',
        facturaNumber: doc.facturaNumber,
        serieFactura: doc.serieFactura,
        ejercicioFactura: doc.ejercicioFactura,
        albaranNumber: doc.albaranNumber ?? doc.number,
        albaranSerie: doc.serie,
        albaranTerminal: doc.terminal,
        albaranYear: doc.ejercicio,
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
      } else if (_filterStatus == _DeliveryStatus.notDelivered) {
        _filterStatus = _DeliveryStatus.enRuta;
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
      case _DeliveryStatus.notDelivered: return 'Pendiente';
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
  final String? serieFactura;
  final int? ejercicioFactura;
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
    this.serieFactura,
    this.ejercicioFactura,
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
  String? _source;
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

      if (data != null) {
        final source = data['source'] as String?;
        _source = source;

        if (data['base64'] != null) {
          // We have actual image data
          setState(() {
            _signatureBytes = base64Decode(data['base64'] as String);
            _firmante = data['firmante'] as String?;
            _fecha = data['fecha'] as String?;
            _loading = false;
          });
        } else if (source == 'CACFIRMAS_NAME_ONLY' || (data['firmante'] != null && (data['firmante'] as String).isNotEmpty)) {
          // Name-only signature from CACFIRMAS (no image, but record exists)
          setState(() {
            _firmante = data['firmante'] as String?;
            _fecha = data['fecha'] as String?;
            _loading = false;
            _error = null;
          });
        } else {
          _handleNoSignature();
        }
      } else {
        _handleNoSignature();
      }
    } catch (e) {
      setState(() { _loading = false; _error = 'Error al cargar firma: $e'; });
    }
  }

  void _handleNoSignature() {
    String? info;
    if (widget.legacySignatureName != null && widget.legacySignatureName!.trim().isNotEmpty) {
      info = 'Firma registrada por: ${widget.legacySignatureName!.trim()}';
      if (widget.legacyDate != null) {
        info += '\nFecha: ${widget.legacyDate}';
      }
      info += '\n\n(Imagen no disponible en registros históricos)';
    }
    setState(() {
      _loading = false;
      _error = info ?? 'No se encontró firma para este documento';
    });
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
        width: 320, height: 280,
        child: _loading
            ? const Center(child: CircularProgressIndicator(color: AppTheme.neonPurple))
            : _signatureBytes != null
                // Has image
                ? Column(
                    children: [
                      Expanded(
                        child: Container(
                          decoration: BoxDecoration(
                            // Use dark background so both white (legacy) and black (new) signatures are visible
                            color: const Color(0xFF2A2D35),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppTheme.neonPurple.withOpacity(0.3)),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: InteractiveViewer(
                              minScale: 0.5, maxScale: 4.0,
                              child: Image.memory(_signatureBytes!, fit: BoxFit.contain),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (_firmante != null && _firmante!.isNotEmpty)
                        Text('Firmante: $_firmante', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                      if (_fecha != null)
                        Text('Fecha: $_fecha', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary.withOpacity(0.8))),
                    ],
                  )
                // Name-only signature (no image)
                : _firmante != null && _firmante!.isNotEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: AppTheme.neonPurple.withOpacity(0.1),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.check_circle, size: 48, color: AppTheme.neonPurple),
                            ),
                            const SizedBox(height: 16),
                            const Text('Documento firmado',
                              style: TextStyle(color: AppTheme.neonPurple, fontSize: 16, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 8),
                            Text('Firmante: $_firmante',
                              style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14)),
                            if (_fecha != null) ...[
                              const SizedBox(height: 4),
                              Text('Fecha: $_fecha',
                                style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.8), fontSize: 12)),
                            ],
                            const SizedBox(height: 12),
                            Text(
                              '(Imagen no disponible - solo registro de firma)',
                              style: TextStyle(color: AppTheme.textSecondary.withOpacity(0.5), fontSize: 10),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      )
                    // Error / not found
                    : Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.gesture, size: 48, color: Colors.grey.shade400),
                            const SizedBox(height: 12),
                            Text(_error ?? 'No se encontró firma',
                              style: TextStyle(color: Colors.grey.shade400, fontSize: 13), textAlign: TextAlign.center),
                          ],
                        ),
                      ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cerrar')),
      ],
    );
  }
}
