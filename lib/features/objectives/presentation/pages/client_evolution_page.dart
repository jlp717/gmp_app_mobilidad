import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
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
  ConsumerState<ClientEvolutionPage> createState() => _ClientEvolutionPageState();
}

class _ClientEvolutionPageState extends ConsumerState<ClientEvolutionPage> {
  bool _isLoading = true;
  String? _error;
  List<Map<String, dynamic>> _monthlySales = [];
  List<Map<String, dynamic>> _topProducts = [];
  List<Map<String, dynamic>> _returns = [];
  List<Map<String, dynamic>> _allClients = [];
  String? _selectedClientCode;
  String? _selectedClientName;

  ProviderSubscription<String?>? _vendorSubscription;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _loadClients();
    
    _vendorSubscription =
        ref.listenManual<String?>(selectedVendorProvider, (previous, next) {
      if (previous != next) {
        _loadClients();
      }
    });
  }

  @override
  void dispose() {
    _vendorSubscription?.close();
    super.dispose();
  }

  Future<void> _loadClients() async {
    try {
      final generation = ++_loadGeneration;
      setState(() {
        _isLoading = true;
        _error = null;
      });

      final currentFilterVendor = ref.read(selectedVendorProvider);
      final queryCode = currentFilterVendor ?? widget.employeeCode;

      final response = await ClientsService.getClientsList(
        vendedorCodes: queryCode,
        limit: 100, // Reasonable limit for dropdown
      );
      final clients = (response as List<dynamic>).cast<Map<String, dynamic>>();

      if (mounted && generation == _loadGeneration) {
        setState(() {
          _allClients = clients;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _allClients = [];
          _error = 'Error cargando clientes: $e';
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _loadEvolutionData(String clientCode) async {
    try {
      setState(() {
        _isLoading = true;
        _error = null;
      });

      // Get vendor codes from provider
      final vendorCodes = ref.read(selectedVendorProvider) ?? widget.employeeCode;

      final response = await ApiClient.dio.get(
        '${ApiConfig.baseUrl}/api/pedidos/client-evolution/$clientCode?vendedorCodes=$vendorCodes',
      );

      if (response.statusCode == 200) {
        final data = response.data;
        if (data['success'] == true) {
          final evolutionData = data['data'] ?? data;
          
          final monthlyData = (evolutionData['monthlySales'] ?? []) is List
              ? (evolutionData['monthlySales'] as List)
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList()
              : <Map<String, dynamic>>[];
          final topProductsData = (evolutionData['topProducts'] ?? []) is List
              ? (evolutionData['topProducts'] as List)
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList()
              : <Map<String, dynamic>>[];
          final returnsData = (evolutionData['returns'] ?? []) is List
              ? (evolutionData['returns'] as List)
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList()
              : <Map<String, dynamic>>[];

          setState(() {
            _monthlySales = monthlyData;
            _topProducts = topProductsData;
            _returns = returnsData;
            _isLoading = false;
          });
        } else {
          setState(() {
            _monthlySales = [];
            _topProducts = [];
            _returns = [];
            _error = data['message'] ?? 'Error desconocido';
            _isLoading = false;
          });
        }
      } else {
        setState(() {
          _monthlySales = [];
          _topProducts = [];
          _returns = [];
          _error = 'Error ${response.statusCode}: ${response.data['message'] ?? 'Falló la carga de datos'}';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Error de conexión: $e';
        _isLoading = false;
      });
    }
  }

  String _formatCurrency(double value) {
    return CurrencyFormatter.formatWhole(value);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        title: const Text('Evolución de Cliente'),
        backgroundColor: AppTheme.darkSurface,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Recargar',
            onPressed: _selectedClientCode != null ? () => _loadEvolutionData(_selectedClientCode!) : null,
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
          
          // Client selection dropdown
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Card(
              color: AppTheme.darkSurface,
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Seleccionar Cliente',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      value: _selectedClientCode,
                      hint: const Text('Seleccione un cliente'),
                      decoration: InputDecoration(
                        hintText: 'Buscar cliente...',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                      items: _allClients.map((client) {
                        return DropdownMenuItem<String>(
                          value: client['CODIGO'],
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${client['NOMBRE']} (${client['CODIGO']})',
                                style: const TextStyle(fontSize: 14),
                              ),
                              if (client['POBLACION'] != null && client['POBLACION'].toString().isNotEmpty)
                                Text(
                                  client['POBLACION'],
                                  style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                                ),
                            ],
                          ),
                        );
                      }).toList(),
                      onChanged: (value) {
                        if (value != null) {
                          final selected = _allClients.firstWhere((c) => c['CODIGO'] == value);
                          setState(() {
                            _selectedClientCode = value;
                            _selectedClientName = selected['NOMBRE'];
                          });
                          _loadEvolutionData(value);
                        }
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
          
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
                  ? const Center(child: ModernLoading(message: 'Cargando evolución...'))
                  : _error != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
                                const SizedBox(height: 16),
                                Text('Error: $_error', style: const TextStyle(color: AppTheme.textSecondary)),
                                const SizedBox(height: 16),
                                ElevatedButton(
                                  onPressed: _selectedClientCode != null 
                                    ? () => _loadEvolutionData(_selectedClientCode!) 
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

  Widget _buildEvolutionContent() {
    if (_selectedClientCode == null) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.people_alt_outlined, size: 48, color: AppTheme.textSecondary),
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
            const Icon(Icons.show_chart_outlined, size: 48, color: AppTheme.textSecondary),
            const SizedBox(height: 16),
            Text(
              'No hay datos de evolución para $_selectedClientName ($_selectedClientCode)',
              style: const TextStyle(color: AppTheme.textSecondary, fontSize: 16),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      padding: EdgeInsets.all(Responsive.padding(context, small: 12, large: 20)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header with client info
          Card(
            color: AppTheme.darkSurface,
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.person, color: AppTheme.neonPurple),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '$_selectedClientName ($_selectedClientCode)',
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
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
              color: AppTheme.darkSurface,
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
                                    '${monthData['month']}/${monthData['year']}'.substring(2),
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
                        topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      ),
                      borderData: FlBorderData(show: true),
                      minX: 0,
                      maxX: _monthlySales.length.toDouble() - 1,
                      minY: 0,
                      maxY: _monthlySales.isNotEmpty
                          ? (_monthlySales.map((e) => (e['sales'] as num?)?.toDouble() ?? 0.0).reduce((a, b) => a > b ? a : b) * 1.2)
                          : 1000,
                      lineBarsData: [
                        LineChartBarData(
                          spots: _monthlySales.asMap().entries.map((entry) {
                            return FlSpot(entry.key.toDouble(), (entry.value['sales'] as num?)?.toDouble() ?? 0.0);
                          }).toList(),
                          isCurved: true,
                          color: AppTheme.neonPurple,
                          barWidth: 2,
                          isStrokeCapRound: true,
                          dotData: const FlDotData(show: true),
                          belowBarData: BarAreaData(
                            show: true,
                            color: AppTheme.neonPurple.withOpacity(0.3),
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
              color: AppTheme.darkSurface,
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