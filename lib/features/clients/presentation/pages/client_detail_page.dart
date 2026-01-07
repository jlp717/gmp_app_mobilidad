import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/modern_loading.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';
import '../../sales_history/presentation/widgets/sales_summary_header.dart';

/// Client Detail Page - Shows comprehensive client information from DB2
class ClientDetailPage extends StatefulWidget {
  final String clientCode;
  final String vendedorCodes;

  const ClientDetailPage({
    super.key,
    required this.clientCode,
    required this.vendedorCodes,
  });

  @override
  State<ClientDetailPage> createState() => _ClientDetailPageState();
}

class _ClientDetailPageState extends State<ClientDetailPage> with SingleTickerProviderStateMixin {
  Map<String, dynamic>? _clientData;
  Map<String, dynamic>? _salesSummary;
  bool _isLoading = true;
  String? _error;
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController = TabController(length: 3, vsync: this);
    _loadClientDetail();
    _loadSalesSummary();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadClientDetail() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final response = await ApiClient.get(
        '${ApiConfig.clientDetail}/${widget.clientCode}',
        queryParameters: {'vendedorCodes': widget.vendedorCodes},
      );
      setState(() {
        _clientData = response;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_clientData?['client']?['name'] ?? 'Detalle Cliente'),
        backgroundColor: AppTheme.surfaceColor,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadClientDetail,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: ModernLoading(message: 'Cargando cliente...'));
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 64, color: AppTheme.error),
            const SizedBox(height: 16),
            Text('Error: $_error'),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _loadClientDetail,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    if (_clientData == null) {
      return const Center(child: Text('No se encontró información del cliente'));
    }

    final client = _clientData!['client'] as Map<String, dynamic>? ?? {};
    final summary = _clientData!['summary'] as Map<String, dynamic>? ?? {};
    final payments = _clientData!['payments'] as Map<String, dynamic>? ?? {};
    final rawMonthlyTrend = _clientData!['monthlyTrend'] ?? [];
    final monthlyTrend = (rawMonthlyTrend as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
    final rawTopProducts = _clientData!['topProducts'] ?? [];
    final topProducts = (rawTopProducts as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();

    return Column(
      children: [
        // Client Header Card
        _buildClientHeader(client, summary, payments),
        
        // Tab Bar
        Container(
          color: AppTheme.surfaceColor,
          child: TabBar(
            controller: _tabController,
            indicatorColor: AppTheme.neonBlue,
            labelColor: AppTheme.neonBlue,
            unselectedLabelColor: AppTheme.textSecondary,
            tabs: const [
              Tab(text: 'Resumen', icon: Icon(Icons.dashboard, size: 18)),
              Tab(text: 'Productos', icon: Icon(Icons.inventory_2, size: 18)),
              Tab(text: 'Historial', icon: Icon(Icons.history, size: 18)),
            ],
          ),
        ),
        
        // Tab Content
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              _buildSummaryTab(summary, payments, monthlyTrend),
              _buildProductsTab(topProducts),
              _buildHistoryTab(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildClientHeader(Map<String, dynamic> client, Map<String, dynamic> summary, Map<String, dynamic> payments) {
    final name = client['name'] ?? 'Sin nombre';
    final code = client['code'] ?? '';
    final address = client['address'] ?? '';
    final city = client['city'] ?? '';
    final phone = client['phone'] ?? '';
    final nif = client['nif'] ?? '';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: AppTheme.surfaceColor,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: AppTheme.neonGreen.withOpacity(0.2),
                child: Text(
                  name.isNotEmpty ? name[0].toUpperCase() : 'C',
                  style: const TextStyle(color: AppTheme.neonGreen, fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name, 
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                      maxLines: 1, 
                      overflow: TextOverflow.ellipsis
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Cód: $code ${nif.isNotEmpty ? ' • NIF: $nif' : ''}', 
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)
                    ),
                  ],
                ),
              ),
              if (phone.isNotEmpty)
                IconButton(
                  icon: const Icon(Icons.phone, size: 20, color: AppTheme.success),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: () => _launchPhone(phone),
                ),
            ],
          ),
          if (address.isNotEmpty || city.isNotEmpty) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                const SizedBox(width: 52), // Align with text start (20*2 + 12)
                Expanded(
                  child: Text(
                    [address, city].where((s) => s.isNotEmpty).join(', '),
                    style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                    maxLines: 1, 
                    overflow: TextOverflow.ellipsis
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildSummaryTab(Map<String, dynamic> summary, Map<String, dynamic> payments, List<Map<String, dynamic>> monthlyTrend) {
    final totalSales = (summary['totalSales'] as num?)?.toDouble() ?? 0;
    final totalMargin = (summary['totalMargin'] as num?)?.toDouble() ?? 0;
    final marginPercent = (summary['marginPercent'] as num?)?.toDouble() ?? 0;
    final totalBoxes = summary['totalBoxes'] ?? 0;
    final numOrders = summary['numOrders'] ?? 0;
    final avgOrderValue = (summary['avgOrderValue'] as num?)?.toDouble() ?? 0;

    final paid = (payments['paid'] as num?)?.toDouble() ?? 0;
    final pending = (payments['pending'] as num?)?.toDouble() ?? 0;
    final pendingCount = payments['pendingCount'] ?? 0;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Summary Cards Row
          Row(
            children: [
              Expanded(child: _SummaryCard(
                title: 'Ventas Totales',
                value: _formatCurrency(totalSales),
                icon: Icons.euro,
                color: AppTheme.neonBlue,
              )),
              const SizedBox(width: 8),
              Expanded(child: _SummaryCard(
                title: 'Margen',
                value: '${marginPercent.toStringAsFixed(1)}%',
                subtitle: _formatCurrency(totalMargin),
                icon: Icons.trending_up,
                color: AppTheme.success,
              )),
              const SizedBox(width: 8),
              Expanded(child: _SummaryCard(
                title: 'Pedidos',
                value: '$numOrders',
                subtitle: '$totalBoxes cajas',
                icon: Icons.shopping_cart,
                color: AppTheme.neonGreen,
              )),
            ],
          ),
          const SizedBox(height: 16),

          // Payment Status
          Container(
            padding: const EdgeInsets.all(16),
            decoration: AppTheme.glassMorphism(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Estado de Pagos', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                    Icon(pendingCount > 0 ? Icons.warning_amber : Icons.check_circle, 
                         color: pendingCount > 0 ? AppTheme.warning : AppTheme.success),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Pagado', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                          Text(_formatCurrency(paid), style: const TextStyle(color: AppTheme.success, fontWeight: FontWeight.bold, fontSize: 18)),
                        ],
                      ),
                    ),
                    Container(width: 1, height: 40, color: AppTheme.textSecondary.withOpacity(0.3)),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text('Pendiente ($pendingCount)', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                          Text(_formatCurrency(pending), style: TextStyle(color: pending > 0 ? AppTheme.warning : AppTheme.textSecondary, fontWeight: FontWeight.bold, fontSize: 18)),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Monthly Trend Chart
          if (monthlyTrend.isNotEmpty) ...[
            Text('Evolución Ventas (12 meses)', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Container(
              height: 200,
              padding: const EdgeInsets.all(16),
              decoration: AppTheme.glassMorphism(),
              child: _buildTrendChart(monthlyTrend),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildTrendChart(List<Map<String, dynamic>> data) {
    if (data.isEmpty) return const SizedBox.shrink();

    final maxSales = data.map((e) => (e['sales'] as num?)?.toDouble() ?? 0).reduce((a, b) => a > b ? a : b);
    final spots = data.asMap().entries.map((entry) {
      return FlSpot(entry.key.toDouble(), (entry.value['sales'] as num?)?.toDouble() ?? 0);
    }).toList();

    return LineChart(
      LineChartData(
        gridData: FlGridData(show: true, drawVerticalLine: false),
        titlesData: FlTitlesData(
          leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              interval: 2,
              getTitlesWidget: (value, meta) {
                final idx = value.toInt();
                if (idx < 0 || idx >= data.length) return const SizedBox.shrink();
                final period = data[idx]['period'] as String? ?? '';
                return Text(period.length >= 7 ? period.substring(5) : period, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary));
              },
            ),
          ),
        ),
        borderData: FlBorderData(show: false),
        lineBarsData: [
          LineChartBarData(
            spots: spots,
            isCurved: true,
            color: AppTheme.neonBlue,
            barWidth: 2,
            dotData: FlDotData(show: true),
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                colors: [AppTheme.neonBlue.withOpacity(0.3), AppTheme.neonBlue.withOpacity(0.0)],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProductsTab(List<Map<String, dynamic>> topProducts) {
    if (topProducts.isEmpty) {
      return const Center(child: Text('No hay productos registrados'));
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: topProducts.length,
      itemBuilder: (context, index) {
        final product = topProducts[index];
        final name = product['name'] ?? 'Producto desconocido';
        final code = product['code'] ?? '';
        final totalSales = (product['totalSales'] as num?)?.toDouble() ?? 0;
        final totalBoxes = product['totalBoxes'] ?? 0;
        final timesOrdered = product['timesOrdered'] ?? 0;

        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          color: AppTheme.surfaceColor,
          child: ListTile(
            leading: Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: AppTheme.neonPurple.withOpacity(0.2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Center(
                child: Text('${index + 1}', style: const TextStyle(color: AppTheme.neonPurple, fontWeight: FontWeight.bold, fontSize: 16)),
              ),
            ),
            title: Text(name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14)),
            subtitle: Text('Cód: $code • $timesOrdered ped. • $totalBoxes cj', style: const TextStyle(fontSize: 11)),
            trailing: Text(_formatCurrency(totalSales), style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonGreen, fontSize: 13)),
          ),
        );
      },
    );
  }

  Widget _buildHistoryTab() {
    return Column(
      children: [
      children: [
        if (_salesSummary != null)
           SalesSummaryHeader(summary: _salesSummary!),
        Padding(
          padding: const EdgeInsets.all(16.0),
          child: ElevatedButton.icon(
            icon: const Icon(Icons.manage_search),
            label: const Text('Explorador Histórico Avanzado (Trazabilidad)'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue.withOpacity(0.2),
              foregroundColor: AppTheme.neonBlue,
              minimumSize: const Size(double.infinity, 45),
            ),
            onPressed: () {
              context.push('/sales-history', extra: widget.clientCode);
            },
          ),
        ),
        Expanded(
          child: FutureBuilder(
            future: _loadSalesHistory(),
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Padding(
                  padding: EdgeInsets.all(20.0),
                  child: Center(child: ModernLoading(message: 'Cargando historial...')),
                );
              }

              final history = snapshot.data ?? [];
              if (history.isEmpty) {
                return const Center(child: Text('No hay historial reciente'));
              }

              return ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: history.length,
                itemBuilder: (context, index) {
                  final sale = history[index];
                  final date = sale['date'] ?? '';
                  final productName = sale['productName'] ?? 'Producto';
                  final amount = (sale['amount'] as num?)?.toDouble() ?? 0;
                  final boxes = sale['boxes'] ?? 0;

                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    color: AppTheme.surfaceColor,
                    child: ListTile(
                      dense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 0),
                      leading: Text(
                        date.length >= 10 ? date.substring(5) : date,
                        style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                      ),
                      title: Text(productName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('$boxes cj', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                          const SizedBox(width: 8),
                          Text(_formatCurrency(amount), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                        ],
                      ),
                    ),
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }

  Future<List<Map<String, dynamic>>> _loadSalesHistory() async {
    try {
      final response = await ApiClient.get(
        '${ApiConfig.clientDetail}/${widget.clientCode}/sales-history',
        queryParameters: {'vendedorCodes': widget.vendedorCodes, 'limit': '50'},
      );
      final rawList = response['history'] ?? [];
      return (rawList as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
    } catch (e) {
      debugPrint('Error loading history: $e');
      return [];
    }
  }

  Future<void> _loadSalesSummary() async {
      try {
        // Defaults to This Year if no dates provided, matching the History Page logic
        final response = await ApiClient.get(
          '/sales-history/summary',
          queryParameters: {
            'clientCode': widget.clientCode,
            'vendedorCodes': widget.vendedorCodes
          },
        );
        if (mounted) {
           setState(() {
             _salesSummary = response;
           });
        }
      } catch (e) {
         debugPrint('Error loading sales summary: $e');
      }
  }

  void _launchPhone(String phone) async {
    final uri = Uri.parse('tel:$phone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  String _formatCurrency(double value) {
    return NumberFormat.currency(locale: 'es_ES', symbol: '€', decimalDigits: 0).format(value);
  }
}

class _SummaryCard extends StatelessWidget {
  final String title;
  final String value;
  final String? subtitle;
  final IconData icon;
  final Color color;

  const _SummaryCard({
    required this.title,
    required this.value,
    this.subtitle,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: AppTheme.glassMorphism(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title, style: TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
              Icon(icon, color: color, size: 16),
            ],
          ),
          const SizedBox(height: 6),
          Text(value, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 15)),
          if (subtitle != null)
            Text(subtitle!, style: TextStyle(color: AppTheme.textSecondary, fontSize: 10)),
        ],
      ),
    );
  }
}
