import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';
import 'package:gmp_app_mobilidad/features/clients/data/clients_service.dart';
import 'package:gmp_app_mobilidad/features/kpi_alerts/presentation/widgets/client_alerts_widget.dart';
import 'package:gmp_app_mobilidad/features/sales_history/presentation/widgets/sales_summary_header.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

/// Client Detail Page - Shows comprehensive client information from DB2
class ClientDetailPage extends StatefulWidget {
  const ClientDetailPage({
    required this.clientCode,
    required this.vendedorCodes,
    super.key,
  });
  final String clientCode;
  final String vendedorCodes;

  @override
  State<ClientDetailPage> createState() => _ClientDetailPageState();
}

class _ClientDetailPageState extends State<ClientDetailPage>
    with SingleTickerProviderStateMixin {
  Map<String, dynamic>? _clientData;
  Map<String, dynamic>? _salesSummary;
  bool _isLoading = true;
  String? _error;
  late TabController _tabController;
  late Future<List<Map<String, dynamic>>> _salesHistoryFuture;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _salesHistoryFuture = _loadSalesHistory();
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
      final response = await ClientsService.getClientDetail(
        clientCode: widget.clientCode,
        vendedorCodes: widget.vendedorCodes,
      );
      if (!mounted) return;
      setState(() {
        _clientData = response;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _refreshClientData() async {
    setState(() {
      _salesHistoryFuture = _loadSalesHistory();
    });
    await Future.wait([
      _loadClientDetail(),
      _loadSalesSummary(),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
            (_clientData?['client']?['name'] as String?) ?? 'Detalle Cliente'),
        backgroundColor: AppTheme.surfaceColor,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _refreshClientData,
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
      return const Center(
          child: Text('No se encontr³ informaci³n del cliente'));
    }

    final client = _clientData!['client'] as Map<String, dynamic>? ?? {};
    final summary = _clientData!['summary'] as Map<String, dynamic>? ?? {};
    final payments = _clientData!['payments'] as Map<String, dynamic>? ?? {};
    final rawMonthlyTrend = _clientData!['monthlyTrend'] ?? [];
    final monthlyTrend = (rawMonthlyTrend as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final rawTopProducts = _clientData!['topProducts'] ?? [];
    final topProducts = (rawTopProducts as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();

    return Column(
      children: [
        // Client Header Card
        _buildClientHeader(client, summary, payments),

        // KPI Alerts
        ClientAlertsWidget(clientId: widget.clientCode),

        // Tab Bar
        ColoredBox(
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

  Widget _buildClientHeader(Map<String, dynamic> client,
      Map<String, dynamic> summary, Map<String, dynamic> payments) {
    final name = (client['name'] as String?) ?? 'Sin nombre';
    final code = (client['code'] as String?) ?? '';
    final address = (client['address'] as String?) ?? '';
    final city = (client['city'] as String?) ?? '';
    final phone = (client['phone'] as String?) ?? '';
    final nif = (client['nif'] as String?) ?? '';
    final editableNotes = client['editableNotes'] as Map<String, dynamic>?;
    final phones = (client['phones'] as List?)
            ?.map((p) => Map<String, dynamic>.from(p as Map))
            .toList() ??
        [];

    return Container(
      padding: EdgeInsets.symmetric(
          horizontal: Responsive.padding(context, small: 12, large: 16),
          vertical: Responsive.padding(context, small: 6, large: 8)),
      color: AppTheme.surfaceColor,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Editable Notes Banner (if exists)
          // Editable Notes Banner (if exists and not compact landscape)
          if (!Responsive.isLandscapeCompact(context)) ...[
            if (editableNotes != null &&
                editableNotes['text'] != null &&
                (editableNotes['text'] as String).isNotEmpty) ...[
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.warning.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: AppTheme.warning.withValues(alpha: 0.5)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.warning_amber_rounded,
                        color: AppTheme.warning, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            editableNotes['text'] as String,
                            style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontWeight: FontWeight.w500),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Por: ${editableNotes['modifiedBy'] ?? 'Desconocido'}',
                            style: const TextStyle(
                                color: AppTheme.textSecondary, fontSize: 10),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.edit,
                          size: 18, color: AppTheme.warning),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                      onPressed: () => _showEditNotesDialog(
                          code, editableNotes['text'] as String?),
                    ),
                  ],
                ),
              ),
            ] else ...[
              // Show add notes button if no notes
              InkWell(
                onTap: () => _showEditNotesDialog(code, null),
                child: Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 8),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.neonBlue.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                        color: AppTheme.neonBlue.withValues(alpha: 0.3)),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.note_add, size: 16, color: AppTheme.neonBlue),
                      SizedBox(width: 6),
                      Text('A±adir observaciones',
                          style: TextStyle(
                              color: AppTheme.neonBlue, fontSize: 12)),
                    ],
                  ),
                ),
              ),
            ],
          ],

          Row(
            children: [
              CircleAvatar(
                radius: Responsive.value(context, phone: 16, desktop: 20),
                backgroundColor: AppTheme.neonGreen.withValues(alpha: 0.2),
                child: Text(
                  name.isNotEmpty ? name[0].toUpperCase() : 'C',
                  style: TextStyle(
                      color: AppTheme.neonGreen,
                      fontSize:
                          Responsive.fontSize(context, small: 14, large: 18),
                      fontWeight: FontWeight.bold),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 16),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    if (!Responsive.isLandscapeCompact(context))
                      Text(
                        'C³d: $code ${nif.isNotEmpty ? '  NIF: $nif' : ''}',
                        style: const TextStyle(
                            fontSize: 12, color: AppTheme.textSecondary),
                      )
                    else
                      Text('C³d: $code',
                          style: const TextStyle(
                              fontSize: 11, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              // WhatsApp Button
              if (phones.isNotEmpty)
                IconButton(
                  icon: Icon(Icons.chat,
                      size:
                          Responsive.iconSize(context, phone: 18, desktop: 20),
                      color: const Color(0xFF25D366)), // WhatsApp green
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: () => _showWhatsAppDialog(phones),
                  tooltip: 'WhatsApp',
                ),
              const SizedBox(width: 8),
              if (phone.isNotEmpty)
                IconButton(
                  icon: Icon(Icons.phone,
                      size:
                          Responsive.iconSize(context, phone: 18, desktop: 20),
                      color: AppTheme.success),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: () => _launchPhone(phone),
                ),
            ],
          ),
          if (!Responsive.isLandscapeCompact(context) &&
              (address.isNotEmpty || city.isNotEmpty)) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                const SizedBox(width: 52), // Align with text start (20*2 + 12)
                Expanded(
                  child: Text(
                    [address, city].where((s) => s.isNotEmpty).join(', '),
                    style: const TextStyle(
                        color: AppTheme.textSecondary, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
          // Route and Days Section
          const SizedBox(height: 8),
          _buildRouteDaysRow(client),
        ],
      ),
    );
  }

  Widget _buildRouteDaysRow(Map<String, dynamic> client) {
    final route = (client['route'] as String?) ?? '';
    final routeDesc = (client['routeDescription'] as String?) ?? '';
    final visitDays = (client['visitDaysShort'] as String?) ?? '';
    final deliveryDays = (client['deliveryDaysShort'] as String?) ?? '';

    if (route.isEmpty && visitDays.isEmpty && deliveryDays.isEmpty) {
      return const SizedBox.shrink();
    }

    return Row(
      children: [
        SizedBox(
            width: Responsive.value(context,
                phone: 44, desktop: 52)), // Align with avatar
        // Route Badge
        if (route.isNotEmpty) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppTheme.neonPurple.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.route, size: 12, color: AppTheme.neonPurple),
                const SizedBox(width: 4),
                Text(
                  routeDesc.isNotEmpty ? routeDesc : 'Ruta $route',
                  style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.neonPurple,
                      fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
        ],
        // Visit Days Badge
        if (visitDays.isNotEmpty) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppTheme.neonBlue.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.calendar_today,
                    size: 12, color: AppTheme.neonBlue),
                const SizedBox(width: 4),
                Text(
                  'Visita: $visitDays',
                  style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.neonBlue,
                      fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
        ],
        // Delivery Days Badge
        if (deliveryDays.isNotEmpty) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppTheme.neonGreen.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.local_shipping,
                    size: 12, color: AppTheme.neonGreen),
                const SizedBox(width: 4),
                Text(
                  'Reparto: $deliveryDays',
                  style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.neonGreen,
                      fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  void _showEditNotesDialog(String clientCode, String? currentNotes) {
    final controller = TextEditingController(text: currentNotes ?? '');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceColor,
        title: const Text('Observaciones del Cliente'),
        content: TextField(
          controller: controller,
          maxLines: 4,
          maxLength: 500,
          decoration: const InputDecoration(
            hintText: 'Ej: Cliente de vacaciones hasta el 15/01',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              try {
                await ClientsService.updateClientNotes(
                  clientCode: clientCode,
                  notes: controller.text,
                  vendorCode: widget.vendedorCodes,
                );
                _refreshClientData();
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                        content: Text('Error guardando: $e'),
                        backgroundColor: AppTheme.error),
                  );
                }
              }
            },
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
  }

  void _showWhatsAppDialog(List<Map<String, dynamic>> phones) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surfaceColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Enviar WhatsApp',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 8),
            const Text('Selecciona el nºmero:',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
            const SizedBox(height: 12),
            ...phones.map(
              (p) => ListTile(
                leading:
                    const Icon(Icons.phone_android, color: Color(0xFF25D366)),
                title: Text((p['number'] as String?) ?? ''),
                subtitle: Text((p['type'] as String?) ?? 'Tel©fono'),
                onTap: () {
                  Navigator.pop(ctx);
                  _openWhatsApp((p['number'] as String?) ?? '');
                },
              ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _openWhatsApp(String phone) async {
    // Clean phone number
    var cleanPhone = phone.replaceAll(RegExp('[^0-9+]'), '');
    if (!cleanPhone.startsWith('+') && !cleanPhone.startsWith('34')) {
      cleanPhone = '34$cleanPhone'; // Default to Spain
    }
    if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }

    // Build personalized message
    final message = Uri.encodeComponent('Hola, soy tu comercial de Mari Pepa. '
        'Me gustar­a saber c³mo va todo y recordarte que ma±ana es d­a de visita. '
        '¿Est¡ todo en orden? ¿Necesitas algo en particular?');

    final uri = Uri.parse('https://wa.me/$cleanPhone?text=$message');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Widget _buildSummaryTab(Map<String, dynamic> summary,
      Map<String, dynamic> payments, List<Map<String, dynamic>> monthlyTrend) {
    final totalSales = (summary['totalSales'] as num?)?.toDouble() ?? 0;
    final totalMargin = (summary['totalMargin'] as num?)?.toDouble() ?? 0;
    final marginPercent = (summary['marginPercent'] as num?)?.toDouble() ?? 0;
    final totalBoxes = summary['totalBoxes'] ?? 0;
    final numOrders = summary['numOrders'] ?? 0;
    final avgOrderValue = (summary['avgOrderValue'] as num?)?.toDouble() ?? 0;

    final paid = (payments['paid'] as num?)?.toDouble() ?? 0;
    final pending = (payments['pending'] as num?)?.toDouble() ?? 0;
    final pendingCount = (payments['pendingCount'] as num?)?.toInt() ?? 0;

    return SingleChildScrollView(
      padding:
          EdgeInsets.all(Responsive.padding(context, small: 12, large: 16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Summary Cards Row
          Row(
            children: [
              Expanded(
                child: _SummaryCard(
                  title: 'Ventas Totales',
                  value: CurrencyFormatter.formatWhole(totalSales),
                  icon: Icons.euro,
                  color: AppTheme.neonBlue,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _SummaryCard(
                  title: 'Margen',
                  value: '${marginPercent.toStringAsFixed(1)}%',
                  subtitle: CurrencyFormatter.formatWhole(totalMargin),
                  icon: Icons.trending_up,
                  color: AppTheme.success,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _SummaryCard(
                  title: 'Pedidos',
                  value: '$numOrders',
                  subtitle: '$totalBoxes cajas',
                  icon: Icons.shopping_cart,
                  color: AppTheme.neonGreen,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Payment Status
          Container(
            padding: EdgeInsets.all(
                Responsive.padding(context, small: 12, large: 16)),
            decoration: AppTheme.glassMorphism(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Estado de Pagos',
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.bold)),
                    Icon(
                      pendingCount > 0
                          ? Icons.warning_amber
                          : Icons.check_circle,
                      color: pendingCount > 0
                          ? AppTheme.warning
                          : AppTheme.success,
                      size:
                          Responsive.iconSize(context, phone: 20, desktop: 24),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Pagado',
                              style: TextStyle(
                                  color: AppTheme.textSecondary, fontSize: 12)),
                          Text(CurrencyFormatter.formatWhole(paid),
                              style: const TextStyle(
                                  color: AppTheme.success,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 18)),
                        ],
                      ),
                    ),
                    Container(
                        width: 1,
                        height: 40,
                        color: AppTheme.textSecondary.withValues(alpha: 0.3)),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text('Pendiente ($pendingCount)',
                              style: const TextStyle(
                                  color: AppTheme.textSecondary, fontSize: 12)),
                          Text(CurrencyFormatter.formatWhole(pending),
                              style: TextStyle(
                                  color: pending > 0
                                      ? AppTheme.warning
                                      : AppTheme.textSecondary,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 18)),
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
            Text('Evoluci³n Ventas (12 meses)',
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Container(
              height: Responsive.value(context, phone: 150, desktop: 200),
              padding: EdgeInsets.all(
                  Responsive.padding(context, small: 12, large: 16)),
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

    final maxSales = data
        .map((e) => (e['sales'] as num?)?.toDouble() ?? 0)
        .reduce((a, b) => a > b ? a : b);
    final spots = data.asMap().entries.map((entry) {
      return FlSpot(entry.key.toDouble(),
          (entry.value['sales'] as num?)?.toDouble() ?? 0);
    }).toList();

    return LineChart(
      LineChartData(
        gridData: const FlGridData(drawVerticalLine: false),
        titlesData: FlTitlesData(
          leftTitles: const AxisTitles(),
          rightTitles: const AxisTitles(),
          topTitles: const AxisTitles(),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              interval: 2,
              getTitlesWidget: (value, meta) {
                final idx = value.toInt();
                if (idx < 0 || idx >= data.length)
                  return const SizedBox.shrink();
                final period = data[idx]['period'] as String? ?? '';
                return Text(period.length >= 7 ? period.substring(5) : period,
                    style: const TextStyle(
                        fontSize: 10, color: AppTheme.textSecondary));
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
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                colors: [
                  AppTheme.neonBlue.withValues(alpha: 0.3),
                  AppTheme.neonBlue.withValues(alpha: 0)
                ],
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
      padding:
          EdgeInsets.all(Responsive.padding(context, small: 12, large: 16)),
      itemCount: topProducts.length,
      itemBuilder: (context, index) {
        final product = topProducts[index];
        final name = (product['name'] as String?) ?? 'Producto desconocido';
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
                color: AppTheme.neonPurple.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Center(
                child: Text('${index + 1}',
                    style: const TextStyle(
                        color: AppTheme.neonPurple,
                        fontWeight: FontWeight.bold,
                        fontSize: 16)),
              ),
            ),
            title: Text(name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14)),
            subtitle: Text('C³d: $code  $timesOrdered ped.  $totalBoxes cj',
                style: const TextStyle(fontSize: 11)),
            trailing: Text(CurrencyFormatter.formatWhole(totalSales),
                style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppTheme.neonGreen,
                    fontSize: 13)),
          ),
        );
      },
    );
  }

  Widget _buildHistoryTab() {
    return Column(
      children: [
        if (_salesSummary != null)
          SalesSummaryHeader(
              summary: _salesSummary!, showMargin: false, isJefeVentas: false),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  icon: const Icon(Icons.manage_search),
                  label: const Text('Explorador Avanzado'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.2),
                    foregroundColor: AppTheme.neonBlue,
                    minimumSize: const Size(double.infinity, 45),
                  ),
                  onPressed: () {
                    context.push('/sales-history', extra: widget.clientCode);
                  },
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: FutureBuilder(
            future: _salesHistoryFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Padding(
                  padding: EdgeInsets.all(20),
                  child: Center(
                      child: ModernLoading(message: 'Cargando historial...')),
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
                  final date = (sale['date'] as String?) ?? '';
                  final productName =
                      (sale['productName'] as String?) ?? 'Producto';
                  final amount = (sale['amount'] as num?)?.toDouble() ?? 0;
                  final boxes = sale['boxes'] ?? 0;

                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    color: AppTheme.surfaceColor,
                    child: ListTile(
                      dense: true,
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 12),
                      leading: Text(
                        date.length >= 10 ? date.substring(5) : date,
                        style: const TextStyle(
                            color: AppTheme.textSecondary, fontSize: 12),
                      ),
                      title: Text(
                        productName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13),
                      ),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('$boxes cj',
                              style: const TextStyle(
                                  color: AppTheme.textSecondary, fontSize: 11)),
                          const SizedBox(width: 8),
                          Text(CurrencyFormatter.formatWhole(amount),
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 13)),
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
      return await ClientsService.getClientSalesHistory(
        clientCode: widget.clientCode,
        vendedorCodes: widget.vendedorCodes,
      );
    } catch (e) {
      debugPrint('Error loading history: $e');
      return [];
    }
  }

  Future<void> _loadSalesSummary() async {
    try {
      // Defaults to This Year if no dates provided, matching the History Page logic
      final response = await ClientsService.getSalesSummary(
        clientCode: widget.clientCode,
        vendedorCodes: widget.vendedorCodes,
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

  Future<void> _launchPhone(String phone) async {
    final uri = Uri.parse('tel:$phone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
    this.subtitle,
  });
  final String title;
  final String value;
  final String? subtitle;
  final IconData icon;
  final Color color;

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
              Text(title,
                  style: const TextStyle(
                      color: AppTheme.textSecondary, fontSize: 11)),
              Icon(icon, color: color, size: 16),
            ],
          ),
          const SizedBox(height: 6),
          Text(value,
              style: TextStyle(
                  color: color, fontWeight: FontWeight.bold, fontSize: 15)),
          if (subtitle != null)
            Text(subtitle!,
                style: const TextStyle(
                    color: AppTheme.textSecondary, fontSize: 10)),
        ],
      ),
    );
  }
}
