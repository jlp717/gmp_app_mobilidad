/// REPARTIDOR CLIENTES PAGE v1.0
/// Lista de clientes adaptada para reparto con historial de entregas
/// Equivalente a SimpleClientListPage de ventas pero enfocado a repartidor
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/error_state_widget.dart';
import 'package:gmp_app_mobilidad/core/widgets/optimized_list.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_historico_page.dart';

class RepartidorClientesPage extends StatefulWidget {
  const RepartidorClientesPage(
      {required this.repartidorId,
      super.key,
      this.isJefeMode = false,
      this.onNavigateToHistory});
  final String repartidorId;
  final bool isJefeMode;
  final void Function(String clientId, String clientName)? onNavigateToHistory;

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
      debugPrint('[RepartidorClientesPage] Error cargando clientes: $e');
      if (mounted) {
        setState(() {
          _error =
              'No se pudieron cargar los clientes. Revisa la conexión y vuelve a intentarlo.';
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
      list = list
          .where(
            (c) =>
                c.name.toUpperCase().contains(q) ||
                c.id.toUpperCase().contains(q) ||
                c.address.toUpperCase().contains(q),
          )
          .toList();
    }

    // Sort
    list.sort((a, b) {
      int cmp;
      switch (_sortBy) {
        case _SortBy.name:
          cmp = a.name.compareTo(b.name);
        case _SortBy.totalDocs:
          cmp = a.totalDocuments.compareTo(b.totalDocuments);
        case _SortBy.totalAmount:
          cmp = a.totalAmount.compareTo(b.totalAmount);
        case _SortBy.lastVisit:
          cmp = (a.lastVisit ?? '').compareTo(b.lastVisit ?? '');
      }
      return _sortAsc ? cmp : -cmp;
    });

    return list;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      body: Column(
        children: [
          _buildHeader(),
          _buildSearchBar(),
          _buildSortBar(),
          Expanded(
            child: _isLoading
                ? const SkeletonList(itemCount: 6, itemHeight: 80)
                : _error != null
                    ? ErrorStateWidget(
                        message: _error!,
                        onRetry: _loadClients,
                      )
                    : RefreshIndicator(
                        onRefresh: _loadClients,
                        child: _filteredClients.isEmpty
                            ? ListView(
                                children: const [
                                  SizedBox(height: 100),
                                  Center(
                                      child: Icon(Icons.people_outline,
                                          color: AppTheme.textSecondary,
                                          size: 64)),
                                  SizedBox(height: 12),
                                  Center(
                                      child: Text('No se encontraron clientes',
                                          style: TextStyle(
                                              color: AppTheme.textSecondary))),
                                ],
                              )
                            : OptimizedListView(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 8),
                                itemCount: _filteredClients.length,
                                itemBuilder: (context, index) =>
                                    _buildClientCard(_filteredClients[index]),
                              ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: EdgeInsets.fromLTRB(
          Responsive.padding(context, small: 12, large: 20),
          16,
          Responsive.padding(context, small: 12, large: 20),
          12),
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        border: const Border(
          bottom: BorderSide(color: AppTheme.borderColor),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(
                Responsive.padding(context, small: 8, large: 10)),
            decoration: BoxDecoration(
              color: AppTheme.success.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: AppTheme.success.withValues(alpha: 0.28),
              ),
            ),
            child: Icon(Icons.people,
                color: AppTheme.success,
                size: Responsive.iconSize(context, phone: 20, desktop: 24)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Clientes de Reparto',
                    style: TextStyle(
                        fontSize:
                            Responsive.fontSize(context, small: 14, large: 18),
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary)),
                Text('${_clients.length} clientes',
                    style: TextStyle(
                        fontSize:
                            Responsive.fontSize(context, small: 10, large: 12),
                        color: AppTheme.textSecondary)),
              ],
            ),
          ),
          // Refresh
          IconButton(
            icon: const Icon(Icons.refresh, color: AppTheme.info, size: 22),
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
      color: AppTheme.raisedSurface,
      child: TextField(
        controller: _searchController,
        style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14),
        decoration: InputDecoration(
          hintText: 'Buscar por nombre, código o dirección...',
          hintStyle: TextStyle(
              color: AppTheme.textSecondary.withValues(alpha: 0.6),
              fontSize: 13),
          prefixIcon:
              const Icon(Icons.search, color: AppTheme.textSecondary, size: 20),
          suffixIcon: _searchQuery.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.clear,
                      color: AppTheme.textSecondary, size: 18),
                  onPressed: () {
                    _searchController.clear();
                    setState(() => _searchQuery = '');
                  },
                )
              : null,
          filled: true,
          fillColor: AppTheme.softPanel,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none),
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
      color: AppTheme.raisedSurface,
      child: Row(
        children: [
          Text('${_filteredClients.length} resultados',
              style:
                  const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
          const Spacer(),
          const Text('Ordenar: ',
              style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
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
            color: selected
                ? AppTheme.info.withValues(alpha: 0.14)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
                color: selected
                    ? AppTheme.info.withValues(alpha: 0.34)
                    : AppTheme.borderColor),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label,
                  style: TextStyle(
                      fontSize: 10,
                      color: selected ? AppTheme.info : AppTheme.textSecondary,
                      fontWeight:
                          selected ? FontWeight.bold : FontWeight.normal)),
              if (selected)
                Icon(_sortAsc ? Icons.arrow_upward : Icons.arrow_downward,
                    size: 10, color: AppTheme.info),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildClientCard(HistoryClient client) {
    return Card(
      color: AppTheme.raisedSurface,
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        side: const BorderSide(color: AppTheme.borderColor),
      ),
      child: InkWell(
        onTap: () => _navigateToHistory(client),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding:
              EdgeInsets.all(Responsive.padding(context, small: 10, large: 14)),
          child: Row(
            children: [
              // Avatar
              Container(
                width: Responsive.value(context, phone: 36, desktop: 44),
                height: Responsive.value(context, phone: 36, desktop: 44),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  color: AppTheme.success.withValues(alpha: 0.14),
                  border: Border.all(
                    color: AppTheme.success.withValues(alpha: 0.28),
                  ),
                ),
                child: Center(
                  child: Text(
                    client.name.isNotEmpty ? client.name[0].toUpperCase() : '?',
                    style: TextStyle(
                        color: AppTheme.success,
                        fontSize:
                            Responsive.fontSize(context, small: 14, large: 18),
                        fontWeight: FontWeight.bold),
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
                      style: TextStyle(
                          fontSize: Responsive.fontSize(context,
                              small: 12, large: 14),
                          fontWeight: FontWeight.w600,
                          color: AppTheme.textPrimary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${client.id} · ${client.address}',
                      style: TextStyle(
                          fontSize:
                              Responsive.fontSize(context, small: 9, large: 11),
                          color: AppTheme.textSecondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 12,
                      runSpacing: 4,
                      children: [
                        _clientStat(Icons.receipt,
                            '${client.totalDocuments} docs', AppTheme.info),
                        _clientStat(
                            Icons.euro,
                            CurrencyFormatter.format(client.totalAmount),
                            AppTheme.success),
                        if (client.lastVisit != null)
                          _clientStat(Icons.calendar_today, client.lastVisit!,
                              AppTheme.textSecondary),
                        if (widget.isJefeMode &&
                            client.repCode != null &&
                            client.repCode!.isNotEmpty)
                          _clientStat(
                            Icons.local_shipping,
                            client.repName != null && client.repName!.isNotEmpty
                                ? 'Rep ${client.repCode!} – ${client.repName!}'
                                : 'Rep ${client.repCode!}',
                            AppTheme.accentIndigo,
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right,
                  color: AppTheme.textSecondary, size: 20),
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
    if (widget.onNavigateToHistory != null) {
      // Use callback to navigate within MainShell (keeps sidebar)
      widget.onNavigateToHistory!(client.id, client.name);
    } else {
      // Fallback: push full-screen
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
}

enum _SortBy { name, totalDocs, totalAmount, lastVisit }
