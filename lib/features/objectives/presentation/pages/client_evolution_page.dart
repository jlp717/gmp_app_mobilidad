import 'dart:async';

import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/utils/vendor_scope.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart';
import 'package:gmp_app_mobilidad/features/clients/data/clients_service.dart';
import 'package:fl_chart/fl_chart.dart';

/// Client Evolution Page - Allows selection of client and displays sales evolution
class ClientEvolutionPage extends ConsumerStatefulWidget {
  const ClientEvolutionPage({
    required this.employeeCode,
    super.key,
    this.isJefeVentas = false,
    this.vendorSelectorCodes,
    this.includeAllVendorOption = true,
    this.forceShowVendorSelector = false,
  });

  final String employeeCode;
  final bool isJefeVentas;
  final List<String>? vendorSelectorCodes;
  final bool includeAllVendorOption;
  final bool forceShowVendorSelector;

  @override
  ConsumerState<ClientEvolutionPage> createState() =>
      _ClientEvolutionPageState();
}

class _ClientEvolutionPageState extends ConsumerState<ClientEvolutionPage> {
  bool _isLoading = false;
  bool _isLoadingClients = false;
  String? _error;
  List<Map<String, dynamic>> _monthlySales = [];
  List<Map<String, dynamic>> _topProducts = [];
  List<Map<String, dynamic>> _returns = [];
  List<Map<String, dynamic>> _allClients = [];
  String? _selectedClientCode;
  String? _selectedClientName;
  final _clientSearchController = TextEditingController();
  Timer? _clientSearchDebounce;

  ProviderSubscription<String?>? _vendorSubscription;
  int _clientSearchGeneration = 0;
  int _evolutionGeneration = 0;
  CancelToken? _evolutionCancelToken;

  @override
  void initState() {
    super.initState();
    _loadClients();

    _vendorSubscription =
        ref.listenManual<String?>(selectedVendorProvider, (previous, next) {
      if (previous != next) {
        _clientSearchController.clear();
        setState(() {
          _selectedClientCode = null;
          _selectedClientName = null;
          _monthlySales = [];
          _topProducts = [];
          _returns = [];
          _error = null;
        });
        _loadClients();
      }
    });
  }

  @override
  void dispose() {
    _vendorSubscription?.close();
    _clientSearchDebounce?.cancel();
    _evolutionCancelToken?.cancel('client evolution page disposed');
    _clientSearchController.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant ClientEvolutionPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.employeeCode != widget.employeeCode ||
        oldWidget.isJefeVentas != widget.isJefeVentas ||
        oldWidget.forceShowVendorSelector != widget.forceShowVendorSelector) {
      _loadClients();
      if (_selectedClientCode != null) {
        _loadEvolutionData(_selectedClientCode!);
      }
    }
  }

  String _resolvedVendorCodes() {
    final selectedVendor = ref.read(selectedVendorProvider);
    final authState = ref.read(authProvider).value;
    final authVendorCodes = authState?.vendedorCodes ?? const <String>[];

    if (hasCommercial80VendorScope(
      userCode: authState?.user?.code,
      vendorCodes: authVendorCodes,
    )) {
      return resolveScopedVendorCodes(
        userCode: authState?.user?.code,
        authVendorCodes: authVendorCodes,
        selectedVendor: selectedVendor,
        fallbackVendorCodes: widget.employeeCode,
      );
    }

    if (selectedVendor != null && selectedVendor.isNotEmpty) {
      return selectedVendor;
    }
    return widget.employeeCode;
  }

  Future<void> _loadClients({String? search}) async {
    final generation = ++_clientSearchGeneration;
    try {
      setState(() {
        _isLoadingClients = true;
        _error = null;
      });

      final queryCode = _resolvedVendorCodes();
      final normalizedSearch = search?.trim();

      final response = await ClientsService.getClientsList(
        vendedorCodes: queryCode,
        search: normalizedSearch,
        limit: normalizedSearch == null || normalizedSearch.isEmpty ? 80 : 120,
      );
      final clients = (response as List<dynamic>).cast<Map<String, dynamic>>();

      if (mounted && generation == _clientSearchGeneration) {
        setState(() {
          _allClients = clients;
          _isLoadingClients = false;
        });
      }
    } catch (e) {
      if (mounted && generation == _clientSearchGeneration) {
        setState(() {
          _allClients = [];
          _error = 'Error cargando clientes: $e';
          _isLoadingClients = false;
        });
      }
    }
  }

  Future<void> _loadEvolutionData(String clientCode) async {
    final generation = ++_evolutionGeneration;
    _evolutionCancelToken?.cancel('client evolution superseded');
    final cancelToken = CancelToken();
    _evolutionCancelToken = cancelToken;

    try {
      setState(() {
        _isLoading = true;
        _error = null;
      });

      final vendorCodes = _resolvedVendorCodes();
      final data = await ApiClient.get(
        '/pedidos/client-evolution/${Uri.encodeComponent(clientCode)}',
        queryParameters: {'vendedorCodes': vendorCodes},
        cacheKey: 'clients:evolution:$clientCode:$vendorCodes',
        cacheTTL: const Duration(minutes: 15),
        cancelToken: cancelToken,
      );

      if (!mounted || generation != _evolutionGeneration) return;
      if (data['success'] == true) {
        final evolutionData = data['data'] is Map
            ? Map<String, dynamic>.from(data['data'] as Map)
            : data;
        setState(() {
          _monthlySales = _mapList(evolutionData['monthlySales']);
          _topProducts = _mapList(evolutionData['topProducts']);
          _returns = _mapList(evolutionData['returns']);
          _isLoading = false;
        });
      } else {
        setState(() {
          _monthlySales = [];
          _topProducts = [];
          _returns = [];
          _error = data['message']?.toString() ?? 'Error desconocido';
          _isLoading = false;
        });
      }
    } catch (e) {
      if (!mounted || generation != _evolutionGeneration) return;
      setState(() {
        _error = 'Error de conexion: $e';
        _isLoading = false;
      });
    }
  }

  List<Map<String, dynamic>> _mapList(Object? value) {
    if (value is! List) return <Map<String, dynamic>>[];
    return value
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
  }

  void _onClientSearchChanged(String value) {
    _clientSearchDebounce?.cancel();
    _clientSearchDebounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      _loadClients(search: value);
    });
  }

  String _clientField(Map<String, dynamic> client, List<String> keys) {
    for (final key in keys) {
      final value = client[key] ?? client[key.toLowerCase()];
      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString().trim();
      }
    }
    return '';
  }

  String _clientCode(Map<String, dynamic> client) => _clientField(
      client, ['code', 'CODIGO', 'codigoCliente', 'CODIGOCLIENTE']);

  String _clientName(Map<String, dynamic> client) =>
      _clientField(client, ['name', 'NOMBRE', 'nombre', 'clienteNombre']);

  String _clientTown(Map<String, dynamic> client) =>
      _clientField(client, ['town', 'POBLACION', 'poblacion', 'city']);

  void _selectClient(Map<String, dynamic> client) {
    final code = _clientCode(client);
    if (code.isEmpty) return;
    final name = _clientName(client);
    setState(() {
      _selectedClientCode = code;
      _selectedClientName = name.isEmpty ? code : name;
      _clientSearchController.text = _selectedClientName!;
      _clientSearchController.selection = TextSelection.collapsed(
        offset: _clientSearchController.text.length,
      );
    });
    _loadEvolutionData(code);
  }

  String _formatCurrency(double value) {
    return CurrencyFormatter.formatWhole(value);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      appBar: AppBar(
        title: const Text('Evolución de Cliente'),
        backgroundColor: AppTheme.raisedSurface,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Recargar',
            onPressed: _selectedClientCode != null
                ? () => _loadEvolutionData(_selectedClientCode!)
                : null,
          ),
        ],
      ),
      body: Column(
        children: [
          // Vendor selector for jefe de ventas
          if (widget.isJefeVentas)
            GlobalVendorSelector(
              isJefeVentas: widget.isJefeVentas,
              forceShow: widget.forceShowVendorSelector,
            ),

          _buildClientSearchPanel(),

          // Evolution data display
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                if (_selectedClientCode != null) {
                  await _loadEvolutionData(_selectedClientCode!);
                } else {
                  await _loadClients();
                }
              },
              child: _isLoading
                  ? const Center(
                      child: ModernLoading(message: 'Cargando evolución...'))
                  : _error != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(Icons.error_outline,
                                    color: AppTheme.error, size: 48),
                                const SizedBox(height: 16),
                                Text('Error: $_error',
                                    style: const TextStyle(
                                        color: AppTheme.textSecondary)),
                                const SizedBox(height: 16),
                                ElevatedButton(
                                  onPressed: _selectedClientCode != null
                                      ? () => _loadEvolutionData(
                                          _selectedClientCode!)
                                      : _loadClients,
                                  child: const Text('Reintentar'),
                                ),
                              ],
                            ),
                          ),
                        )
                      : _buildEvolutionContent(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildClientSearchPanel() {
    final visibleClients = _allClients
        .where((client) => _clientCode(client).isNotEmpty)
        .take(8)
        .toList(growable: false);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Card(
        color: AppTheme.raisedSurface,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Seleccionar Cliente',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _clientSearchController,
                onChanged: _onClientSearchChanged,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  hintText: 'Buscar cliente, código, NIF o población...',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _isLoadingClients
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : _clientSearchController.text.isEmpty
                          ? null
                          : IconButton(
                              icon: const Icon(Icons.clear),
                              onPressed: () {
                                _clientSearchDebounce?.cancel();
                                _clientSearchController.clear();
                                _loadClients();
                                setState(() {});
                              },
                            ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
              if (_selectedClientCode != null) ...[
                const SizedBox(height: 8),
                Text(
                  '$_selectedClientName ($_selectedClientCode)',
                  style: const TextStyle(
                    color: AppTheme.info,
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              if (visibleClients.isNotEmpty) ...[
                const SizedBox(height: 8),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 230),
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: visibleClients.length,
                    separatorBuilder: (_, __) =>
                        const Divider(height: 1, color: Colors.white12),
                    itemBuilder: (context, index) {
                      final client = visibleClients[index];
                      final code = _clientCode(client);
                      final name = _clientName(client);
                      final town = _clientTown(client);
                      final selected = code == _selectedClientCode;
                      return ListTile(
                        dense: true,
                        selected: selected,
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          name.isEmpty ? code : name,
                          style: const TextStyle(color: Colors.white),
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(
                          town.isEmpty ? code : '$code · $town',
                          style: const TextStyle(color: AppTheme.textSecondary),
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: selected
                            ? const Icon(Icons.check, color: AppTheme.info)
                            : null,
                        onTap: () => _selectClient(client),
                      );
                    },
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEvolutionContent() {
    if (_selectedClientCode == null) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.people_alt_outlined,
                size: 48, color: AppTheme.textSecondary),
            SizedBox(height: 16),
            Text(
              'Seleccione un cliente para ver su evolución',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 16),
            ),
          ],
        ),
      );
    }

    if (_monthlySales.isEmpty && _topProducts.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.show_chart_outlined,
                size: 48, color: AppTheme.textSecondary),
            const SizedBox(height: 16),
            Text(
              'No hay datos de evolución para $_selectedClientName ($_selectedClientCode)',
              style:
                  const TextStyle(color: AppTheme.textSecondary, fontSize: 16),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      padding:
          EdgeInsets.all(Responsive.padding(context, small: 12, large: 20)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header with client info
          Card(
            color: AppTheme.raisedSurface,
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.person, color: AppTheme.accentIndigo),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '$_selectedClientName ($_selectedClientCode)',
                          style: const TextStyle(
                              fontSize: 18, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Evolution chart
          if (_monthlySales.isNotEmpty) ...[
            Text(
              'Evolución Mensual',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
            ),
            const SizedBox(height: 12),
            Card(
              color: AppTheme.raisedSurface,
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: SizedBox(
                  height: 300,
                  child: LineChart(
                    LineChartData(
                      gridData: const FlGridData(show: true),
                      titlesData: FlTitlesData(
                        bottomTitles: AxisTitles(
                          sideTitles: SideTitles(
                            showTitles: true,
                            reservedSize: 30,
                            interval: 2,
                            getTitlesWidget: (value, meta) {
                              if (value < _monthlySales.length) {
                                final monthData = _monthlySales[value.toInt()];
                                return SideTitleWidget(
                                  axisSide: meta.axisSide,
                                  space: 4,
                                  child: Text(
                                    '${monthData['month']}/${monthData['year']}'
                                        .substring(2),
                                    style: const TextStyle(fontSize: 8),
                                  ),
                                );
                              }
                              return const Text('');
                            },
                          ),
                        ),
                        leftTitles: AxisTitles(
                          sideTitles: SideTitles(
                            showTitles: true,
                            reservedSize: 40,
                            interval: 1000,
                            getTitlesWidget: (value, meta) {
                              return SideTitleWidget(
                                axisSide: meta.axisSide,
                                space: 4,
                                child: Text(
                                  _formatCurrency(value),
                                  style: const TextStyle(fontSize: 10),
                                ),
                              );
                            },
                          ),
                        ),
                        topTitles: const AxisTitles(
                            sideTitles: SideTitles(showTitles: false)),
                        rightTitles: const AxisTitles(
                            sideTitles: SideTitles(showTitles: false)),
                      ),
                      borderData: FlBorderData(show: true),
                      minX: 0,
                      maxX: _monthlySales.length.toDouble() - 1,
                      minY: 0,
                      maxY: _monthlySales.isNotEmpty
                          ? (_monthlySales
                                  .map((e) =>
                                      (e['sales'] as num?)?.toDouble() ?? 0.0)
                                  .reduce((a, b) => a > b ? a : b) *
                              1.2)
                          : 1000,
                      lineBarsData: [
                        LineChartBarData(
                          spots: _monthlySales.asMap().entries.map((entry) {
                            return FlSpot(
                                entry.key.toDouble(),
                                (entry.value['sales'] as num?)?.toDouble() ??
                                    0.0);
                          }).toList(),
                          isCurved: true,
                          color: AppTheme.accentIndigo,
                          barWidth: 2,
                          isStrokeCapRound: true,
                          dotData: const FlDotData(show: true),
                          belowBarData: BarAreaData(
                            show: true,
                            color: AppTheme.accentIndigo.withOpacity(0.3),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
          ],

          // Top products
          if (_topProducts.isNotEmpty) ...[
            Text(
              'Productos Top',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
            ),
            const SizedBox(height: 12),
            Card(
              color: AppTheme.raisedSurface,
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  children: _topProducts.take(10).map((product) {
                    return ListTile(
                      title: Text(product['name'] ?? 'Producto desconocido'),
                      subtitle: Text('Código: ${product['code']}'),
                      trailing: Text(
                        _formatCurrency(product['sales'] ?? 0),
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                    );
                  }).toList(),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
