import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../../objectives/presentation/pages/enhanced_client_matrix_page.dart';

/// Simple Clients List Page with debounced search
class SimpleClientListPage extends StatefulWidget {
  final String employeeCode;
  final bool isJefeVentas;
  
  const SimpleClientListPage({super.key, required this.employeeCode, this.isJefeVentas = false});

  @override
  State<SimpleClientListPage> createState() => _SimpleClientListPageState();
}

class _SimpleClientListPageState extends State<SimpleClientListPage> {
  List<Map<String, dynamic>> _clients = [];
  bool _isLoading = true;
  String? _error;
  String _searchQuery = '';
  final _currencyFormat = NumberFormat.currency(symbol: '€', decimalDigits: 0);
  Timer? _debounceTimer;
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadClients();
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _searchQuery = value;
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 400), () {
      if (value.length > 2 || value.isEmpty) {
        _loadClients(query: value);
      }
    });
  }

  Future<void> _loadClients({String? query}) async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final params = {
        'vendedorCodes': widget.employeeCode,
        'limit': '100',
      };
      if (query != null && query.isNotEmpty) {
        params['search'] = query;
      }

      final response = await ApiClient.get(
        ApiConfig.clientsList,
        queryParameters: params,
      );

      setState(() {
        _clients = List<Map<String, dynamic>>.from(response['clients'] ?? []);
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  void _navigateToClientMatrix(Map<String, dynamic> client) {
    final code = client['code'] as String? ?? '';
    final name = client['name'] as String? ?? 'Cliente';
    if (code.isNotEmpty) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (context) => EnhancedClientMatrixPage(
            clientCode: code,
            clientName: name,
            isJefeVentas: widget.isJefeVentas,
          ),
        ),
      );
    }
  }


  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Header
        Container(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              const Icon(Icons.people, color: AppTheme.neonGreen, size: 28),
              const SizedBox(width: 12),
              Text('Clientes', style: Theme.of(context).textTheme.headlineMedium),
              const Spacer(),
              Text(
                '${_clients.length} clientes',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppTheme.textSecondary,
                ),
              ),
            ],
          ),
        ),

        // Search Bar
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16.0),
          child: TextField(
            decoration: InputDecoration(
              hintText: 'Buscar cliente, NIF...',
              prefixIcon: const Icon(Icons.search),
              filled: true,
              fillColor: AppTheme.surfaceColor,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
            ),
            controller: _searchController,
            onChanged: _onSearchChanged,
          ),
        ),

        const SizedBox(height: 16),

        // Content
        Expanded(
          child: _buildContent(),
        ),
      ],
    );
  }

  Widget _buildContent() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 64, color: AppTheme.error),
            const SizedBox(height: 16),
            Text('Error: $_error'),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => _loadClients(),
              child: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    if (_clients.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.people_outline, size: 64, color: AppTheme.textSecondary),
            const SizedBox(height: 16),
            const Text('No se encontraron clientes'),
            const SizedBox(height: 8),
            Text(
              'Vendedor: ${widget.employeeCode}',
              style: const TextStyle(color: AppTheme.textSecondary),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => _loadClients(query: _searchQuery),
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: _clients.length,
        itemBuilder: (context, index) {
          final client = _clients[index];
          return _ClientCard(
            client: client,
            currencyFormat: _currencyFormat,
            onTap: () => _navigateToClientMatrix(client),
          );
        },
      ),
    );
  }
}

class _ClientCard extends StatelessWidget {
  final Map<String, dynamic> client;
  final NumberFormat currencyFormat;
  final VoidCallback? onTap;

  const _ClientCard({required this.client, required this.currencyFormat, this.onTap});

  @override
  Widget build(BuildContext context) {
    final name = client['name'] ?? 'Sin nombre';
    final code = client['code'] ?? '';
    final city = client['city'] ?? '';
    final phone = client['phone'] ?? '';
    final route = client['route'] ?? '';
    final totalPurchases = (client['totalPurchases'] as num?)?.toDouble() ?? 0;
    final numOrders = client['numOrders'] ?? 0;
    final lastPurchase = client['lastPurchase'] ?? '';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: AppTheme.surfaceColor,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Row(
            children: [
              // Avatar
              CircleAvatar(
                radius: 28,
                backgroundColor: AppTheme.neonGreen.withOpacity(0.2),
                child: Text(
                  name.isNotEmpty ? name[0].toUpperCase() : 'C',
                  style: const TextStyle(
                    color: AppTheme.neonGreen,
                    fontWeight: FontWeight.bold,
                    fontSize: 20,
                  ),
                ),
              ),
              const SizedBox(width: 16),

              // Info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(Icons.location_on, size: 14, color: AppTheme.textSecondary),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            city.isNotEmpty ? city : 'Sin ciudad',
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: AppTheme.textSecondary,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    if (phone.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Icon(Icons.phone, size: 14, color: AppTheme.textSecondary),
                          const SizedBox(width: 4),
                          Text(
                            phone,
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: AppTheme.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),

              // Stats
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    currencyFormat.format(totalPurchases),
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: AppTheme.success,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '$numOrders pedidos',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: AppTheme.textSecondary,
                    ),
                  ),
                  if (lastPurchase.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      'Última: $lastPurchase',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: AppTheme.textTertiary,
                      ),
                    ),
                  ],
                ],
              ),

              // Route badge
              if (route.isNotEmpty) ...[
                const SizedBox(width: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.neonPurple.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    route,
                    style: const TextStyle(
                      color: AppTheme.neonPurple,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
