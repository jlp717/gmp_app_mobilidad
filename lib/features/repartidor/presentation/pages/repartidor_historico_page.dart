/// REPARTIDOR HISTÓRICO PAGE
/// Pestaña de histórico con búsqueda de clientes, albaranes, facturas y firmas
/// Permite visualizar y reenviar documentos

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/currency_formatter.dart';

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
  List<ClientSummary> _clients = [];
  List<DocumentHistory> _documents = [];
  List<MonthlyObjective> _objectives = [];

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

  Future<void> _loadClients() async {
    setState(() => _isLoading = true);
    
    // Mock data - in production, fetch from backend
    await Future.delayed(const Duration(milliseconds: 500));
    
    _clients = [
      ClientSummary(id: '9900', name: 'BAR EL RINCÓN', address: 'C/ Mayor, 15', totalDocuments: 12),
      ClientSummary(id: '8801', name: 'RESTAURANTE LA PLAZA', address: 'Plaza España, 3', totalDocuments: 8),
      ClientSummary(id: '7755', name: 'CAFETERÍA CENTRAL', address: 'Av. Libertad, 42', totalDocuments: 15),
      ClientSummary(id: '6644', name: 'HOSTAL LOS PINOS', address: 'Ctra. Nacional, km 5', totalDocuments: 6),
      ClientSummary(id: '5533', name: 'BAR DEPORTIVO', address: 'C/ Estadio, 8', totalDocuments: 9),
    ];

    if (mounted) {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _loadClientHistory(String clientId) async {
    setState(() {
      _isLoading = true;
      _selectedClientId = clientId;
    });

    // Mock data
    await Future.delayed(const Duration(milliseconds: 400));

    _documents = [
      DocumentHistory(
        id: 'ALB-2026-1234',
        type: DocumentType.albaran,
        number: 1234,
        date: DateTime.now().subtract(const Duration(days: 1)),
        amount: 245.80,
        status: DeliveryStatus.delivered,
        hasSignature: true,
        observations: null,
      ),
      DocumentHistory(
        id: 'ALB-2026-1210',
        type: DocumentType.albaran,
        number: 1210,
        date: DateTime.now().subtract(const Duration(days: 5)),
        amount: 189.50,
        status: DeliveryStatus.delivered,
        hasSignature: true,
        observations: null,
      ),
      DocumentHistory(
        id: 'ALB-2026-1180',
        type: DocumentType.albaran,
        number: 1180,
        date: DateTime.now().subtract(const Duration(days: 12)),
        amount: 320.00,
        status: DeliveryStatus.partial,
        hasSignature: true,
        observations: 'Faltaron 2 cajas de refrescos - sin stock',
      ),
      DocumentHistory(
        id: 'FAC-2026-0456',
        type: DocumentType.factura,
        number: 456,
        date: DateTime.now().subtract(const Duration(days: 15)),
        amount: 756.30,
        status: DeliveryStatus.delivered,
        hasSignature: true,
        observations: null,
      ),
      DocumentHistory(
        id: 'ALB-2026-1100',
        type: DocumentType.albaran,
        number: 1100,
        date: DateTime.now().subtract(const Duration(days: 20)),
        amount: 98.20,
        status: DeliveryStatus.notDelivered,
        hasSignature: false,
        observations: 'Cliente cerrado - vacaciones',
      ),
    ];

    _objectives = [
      MonthlyObjective(month: 'Enero 2026', collectable: 2500, collected: 1800, percentage: 72),
      MonthlyObjective(month: 'Diciembre 2025', collectable: 2200, collected: 1950, percentage: 88.6),
      MonthlyObjective(month: 'Noviembre 2025', collectable: 2100, collected: 2100, percentage: 100),
    ];

    if (mounted) {
      setState(() => _isLoading = false);
    }
  }

  List<ClientSummary> get _filteredClients {
    final query = _searchController.text.toLowerCase();
    if (query.isEmpty) return _clients;
    return _clients.where((c) =>
      c.name.toLowerCase().contains(query) ||
      c.id.toLowerCase().contains(query)
    ).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          // Header
          _buildHeader(),
          
          // Content
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
            IconButton(
              onPressed: () => setState(() {
                _selectedClientId = null;
                _documents = [];
              }),
              icon: const Icon(Icons.arrow_back, color: AppTheme.textPrimary),
            ),
            const SizedBox(width: 8),
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
                      ? _clients.firstWhere((c) => c.id == _selectedClientId, orElse: () => _clients.first).name
                      : 'Histórico',
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
                Text(
                  _selectedClientId != null
                      ? 'Albaranes, facturas y firmas'
                      : 'Buscar cliente para ver historial',
                  style: TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary.withOpacity(0.8),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildClientSearch() {
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
        
        // Client list
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
      onTap: () => _loadClientHistory(client.id),
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
                _buildDocumentsList(),
                _buildObjectivesTable(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDocumentsList() {
    if (_documents.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.folder_open, size: 48, color: AppTheme.textSecondary.withOpacity(0.5)),
            const SizedBox(height: 16),
            Text('Sin documentos históricos', style: TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: _documents.length,
      itemBuilder: (context, index) => _buildDocumentCard(_documents[index]),
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
              // Type badge
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
              // Status
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
          
          // Action buttons
          Row(
            children: [
              // Signature button
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
              // Share button
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
            Text('Firma - ${doc.type == DocumentType.factura ? 'Factura' : 'Albarán'} #${doc.number}'),
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
    // TODO: Implement actual sharing with share_plus package
  }
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
