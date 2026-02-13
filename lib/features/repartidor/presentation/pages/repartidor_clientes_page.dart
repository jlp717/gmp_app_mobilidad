/// REPARTIDOR CLIENTES PAGE v1.0
/// Lista de clientes adaptada para reparto con historial de entregas
/// Equivalente a SimpleClientListPage de ventas pero enfocado a repartidor

import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../data/repartidor_data_service.dart';
import 'repartidor_historico_page.dart';

class RepartidorClientesPage extends StatefulWidget {
  final String repartidorId;

  const RepartidorClientesPage({super.key, required this.repartidorId});

  @override
  State<RepartidorClientesPage> createState() => _RepartidorClientesPageState();
}

class _RepartidorClientesPageState extends State<RepartidorClientesPage> {
  final TextEditingController _searchController = TextEditingController();
  List<HistoryClient> _clients = [];
  bool _isLoading = true;
  String? _error;
  String _searchQuery = '';

  // Sort options
  _SortBy _sortBy = _SortBy.lastVisit;
  bool _sortAsc = false;

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
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final clients = await RepartidorDataService.getHistoryClients(
        repartidorId: widget.repartidorId,
        search: search,
      );
      if (mounted) {
        setState(() {
          _clients = clients;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  List<HistoryClient> get _filteredClients {
    var list = _clients;

    // Local text filter
    if (_searchQuery.length > 1) {
      final q = _searchQuery.toUpperCase();
      list = list.where((c) =>
          c.name.toUpperCase().contains(q) ||
          c.id.toUpperCase().contains(q) ||
          c.address.toUpperCase().contains(q)
      ).toList();
    }

    // Sort
    list.sort((a, b) {
      int cmp;
      switch (_sortBy) {
        case _SortBy.name:
          cmp = a.name.compareTo(b.name);
          break;
        case _SortBy.totalDocs:
          cmp = a.totalDocuments.compareTo(b.totalDocuments);
          break;
        case _SortBy.totalAmount:
          cmp = a.totalAmount.compareTo(b.totalAmount);
          break;
        case _SortBy.lastVisit:
          cmp = (a.lastVisit ?? '').compareTo(b.lastVisit ?? '');
          break;
      }
      return _sortAsc ? cmp : -cmp;
    });

    return list;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          _buildHeader(),
          _buildSearchBar(),
          _buildSortBar(),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
                            const SizedBox(height: 12),
                            Text('Error: $_error', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
                            const SizedBox(height: 12),
                            ElevatedButton(onPressed: _loadClients, child: const Text('Reintentar')),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: () => _loadClients(),
                        child: _filteredClients.isEmpty
                            ? ListView(
                                children: const [
                                  SizedBox(height: 100),
                                  Center(child: Icon(Icons.people_outline, color: AppTheme.textSecondary, size: 64)),
                                  SizedBox(height: 12),
                                  Center(child: Text('No se encontraron clientes', style: TextStyle(color: AppTheme.textSecondary))),
                                ],
                              )
                            : ListView.builder(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                itemCount: _filteredClients.length,
                                itemBuilder: (context, index) => _buildClientCard(_filteredClients[index]),
                              ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.05))),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: [AppTheme.neonGreen.withOpacity(0.3), AppTheme.neonBlue.withOpacity(0.2)]),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.people, color: AppTheme.neonGreen, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Clientes de Reparto', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                Text('${_clients.length} clientes', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          // Refresh
          IconButton(
            icon: const Icon(Icons.refresh, color: AppTheme.neonBlue, size: 22),
            onPressed: _loadClients,
            tooltip: 'Actualizar',
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      color: AppTheme.surfaceColor,
      child: TextField(
        controller: _searchController,
        style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
        decoration: InputDecoration(
          hintText: 'Buscar por nombre, código o dirección...',
          hintStyle: TextStyle(color: AppTheme.textSecondary.withOpacity(0.6), fontSize: 13),
          prefixIcon: const Icon(Icons.search, color: AppTheme.textSecondary, size: 20),
          suffixIcon: _searchQuery.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.clear, color: AppTheme.textSecondary, size: 18),
                  onPressed: () {
                    _searchController.clear();
                    setState(() => _searchQuery = '');
                  },
                )
              : null,
          filled: true,
          fillColor: AppTheme.darkBase,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
        ),
        onChanged: (v) {
          setState(() => _searchQuery = v);
          // Server-side search for longer queries
          if (v.length > 3) _loadClients(v);
        },
      ),
    );
  }

  Widget _buildSortBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      color: AppTheme.surfaceColor,
      child: Row(
        children: [
          Text('${_filteredClients.length} resultados', style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
          const Spacer(),
          const Text('Ordenar: ', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
          _sortChip('Visita', _SortBy.lastVisit),
          _sortChip('Nombre', _SortBy.name),
          _sortChip('Docs', _SortBy.totalDocs),
          _sortChip('Importe', _SortBy.totalAmount),
        ],
      ),
    );
  }

  Widget _sortChip(String label, _SortBy sort) {
    final selected = _sortBy == sort;
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: InkWell(
        onTap: () {
          setState(() {
            if (_sortBy == sort) {
              _sortAsc = !_sortAsc;
            } else {
              _sortBy = sort;
              _sortAsc = false;
            }
          });
        },
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: selected ? AppTheme.neonBlue.withOpacity(0.15) : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: selected ? AppTheme.neonBlue.withOpacity(0.4) : Colors.white.withOpacity(0.1)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label, style: TextStyle(fontSize: 10, color: selected ? AppTheme.neonBlue : AppTheme.textSecondary, fontWeight: selected ? FontWeight.bold : FontWeight.normal)),
              if (selected)
                Icon(_sortAsc ? Icons.arrow_upward : Icons.arrow_downward, size: 10, color: AppTheme.neonBlue),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildClientCard(HistoryClient client) {
    return Card(
      color: AppTheme.surfaceColor,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: () => _navigateToHistory(client),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              // Avatar
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  gradient: LinearGradient(
                    colors: [AppTheme.neonGreen.withOpacity(0.3), AppTheme.neonBlue.withOpacity(0.2)],
                  ),
                ),
                child: Center(
                  child: Text(
                    client.name.isNotEmpty ? client.name[0].toUpperCase() : '?',
                    style: const TextStyle(color: AppTheme.neonGreen, fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // Info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      client.name,
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${client.id} · ${client.address}',
                      style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        _clientStat(Icons.receipt, '${client.totalDocuments} docs', AppTheme.neonBlue),
                        const SizedBox(width: 12),
                        _clientStat(Icons.euro, CurrencyFormatter.format(client.totalAmount), AppTheme.neonGreen),
                        if (client.lastVisit != null) ...[
                          const SizedBox(width: 12),
                          _clientStat(Icons.calendar_today, client.lastVisit!, AppTheme.textSecondary),
                        ],
                        if (client.repCode != null && client.repCode!.isNotEmpty) ...[
                          const SizedBox(width: 12),
                          _clientStat(Icons.local_shipping, 'Rep ${client.repCode!}', AppTheme.neonPurple),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: AppTheme.textSecondary, size: 20),
            ],
          ),
        ),
      ),
    );
  }

  Widget _clientStat(IconData icon, String text, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: color),
        const SizedBox(width: 3),
        Text(text, style: TextStyle(fontSize: 10, color: color)),
      ],
    );
  }

  void _navigateToHistory(HistoryClient client) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => RepartidorHistoricoPage(
          repartidorId: widget.repartidorId,
          initialClientId: client.id,
          initialClientName: client.name,
        ),
      ),
    );
  }
}

enum _SortBy { name, totalDocs, totalAmount, lastVisit }
