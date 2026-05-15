import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_config.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/widgets/modern_loading.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

class ClientEvolutionTab extends StatefulWidget {
  final String clientCode;
  final String vendedorCodes;

  const ClientEvolutionTab({
    Key? key,
    required this.clientCode,
    required this.vendedorCodes,
  }) : super(key: key);

  @override
  State<ClientEvolutionTab> createState() => _ClientEvolutionTabState();
}

class _ClientEvolutionTabState extends State<ClientEvolutionTab> {
  bool _isLoading = true;
  String? _error;
  List<Map<String, dynamic>> _monthlySales = [];
  List<Map<String, dynamic>> _topProducts = [];
  List<Map<String, dynamic>> _returns = [];

  @override
  void initState() {
    super.initState();
    _loadEvolutionData();
  }

  Future<void> _loadEvolutionData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final baseUrl = ApiConfig.baseUrl;
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token') ?? '';

      // Req #12: usar el endpoint específico /api/pedidos/client-evolution/{code}
      // que devuelve {monthlySales, topProducts, returns}. Se hace un fallback
      // al endpoint legacy /api/evolution/monthly si el nuevo no responde, para
      // mantener compatibilidad durante el rollout.
      Uri uri = Uri.parse(
        '$baseUrl/api/pedidos/client-evolution/${widget.clientCode}',
      );
      var response = await http.get(
        uri,
        headers: {'Authorization': 'Bearer $token'},
      );
      if (response.statusCode != 200) {
        uri = Uri.parse(
          '$baseUrl/api/evolution/monthly?clientCode=${widget.clientCode}&vendedorCodes=${widget.vendedorCodes}',
        );
        response = await http.get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        );
      }

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true) {
          // The monthly endpoint returns: { monthly, summary }
          // The client-evolution endpoint returns: { monthlySales, topProducts, returns }
          // Map fields flexibly to support both response shapes
          final monthlyData = (data['monthly'] ?? data['monthlySales'] ?? []) is List
              ? ((data['monthly'] ?? data['monthlySales'] ?? []) as List)
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList()
              : [];
          final topProductsData = (data['products'] ?? data['topProducts'] ?? []) is List
              ? ((data['products'] ?? data['topProducts'] ?? []) as List)
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList()
              : [];
          final returnsData = (data['returns'] is List)
              ? (data['returns'] as List)
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList()
              : [];
          
          setState(() {
            _monthlySales = monthlyData;
            _topProducts = topProductsData;
            _returns = returnsData;
            _isLoading = false;
          });
          return;
        }
      }
      throw Exception('Failed to load evolution data');
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(child: ModernLoading(message: 'Cargando evoluci³n...'));
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 48, color: AppTheme.error),
            const SizedBox(height: 16),
            Text('Error: $_error'),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _loadEvolutionData, child: const Text('Reintentar')),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Evoluci³n Mensual (3 A±os)', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (_monthlySales.isNotEmpty)
            Container(
              height: 250,
              padding: const EdgeInsets.all(16),
              decoration: AppTheme.glassMorphism(),
              child: _buildEvolutionChart(),
            )
          else
            const Center(child: Text('No hay datos de evoluci³n mensual')),
            
          const SizedBox(height: 24),
          
          Text('Productos M¡s Comprados', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (_topProducts.isNotEmpty)
            _buildTopProductsList()
          else
                      const SizedBox(height: 24),
          Text('Historial de Devoluciones', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (_returns.isNotEmpty)
            _buildReturnsList()
          else
            const Center(child: Text('No hay historial de devoluciones reciente')),
        ],
      ),
    );
  }

  Widget _buildEvolutionChart() {
    if (_monthlySales.isEmpty) return const SizedBox.shrink();

    // Prepare data
    final spots = _monthlySales.asMap().entries.map((entry) {
      final sales = (entry.value['totalSales'] as num?)?.toDouble() ?? 0;
      return FlSpot(entry.key.toDouble(), sales);
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
              interval: 3,
              getTitlesWidget: (value, meta) {
                final idx = value.toInt();
                if (idx < 0 || idx >= _monthlySales.length) return const SizedBox.shrink();
                final row = _monthlySales[idx];
                final year = row['year']?.toString() ?? '';
                final month = row['month']?.toString().padLeft(2, '0') ?? '';
                return Text('$year-$month', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary));
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
            barWidth: 3,
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                colors: [AppTheme.neonBlue.withValues(alpha: 0.3), AppTheme.neonBlue.withValues(alpha: 0)],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildTopProductsList() {
    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _topProducts.length > 10 ? 10 : _topProducts.length,
      itemBuilder: (context, index) {
        final product = _topProducts[index];
        final name = product['name'] ?? 'Producto';
        final code = product['code'] ?? '';
        final sales = (product['totalSales'] as num?)?.toDouble() ?? 0;
        final units = (product['totalUnits'] as num?)?.toInt() ?? 0;
        
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          color: AppTheme.surfaceColor,
          child: ListTile(
            dense: true,
            leading: CircleAvatar(
              backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.2),
              child: Text('${index + 1}', style: TextStyle(color: AppTheme.neonBlue, fontSize: 12)),
            ),
            title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
            subtitle: Text('C³d: $code Å¡ $units uds', style: const TextStyle(fontSize: 11)),
            trailing: Text(CurrencyFormatter.formatWhole(sales), style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.success, fontSize: 13)),
          ),
        );
      },
    );
  }

  Widget _buildReturnsList() {
    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _returns.length > 10 ? 10 : _returns.length,
      itemBuilder: (context, index) {
        final ret = _returns[index];
        final name = ret['productName'] ?? 'Producto';
        final code = ret['productCode'] ?? '';
        final amount = (ret['amount'] as num?)?.toDouble() ?? 0;
        final units = (ret['units'] as num?)?.toInt() ?? 0;
        final year = ret['year'];
        final month = ret['month']?.toString().padLeft(2, '0');
        
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          color: AppTheme.error.withValues(alpha: 0.1),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
            side: BorderSide(color: AppTheme.error.withValues(alpha: 0.3)),
          ),
          child: ListTile(
            dense: true,
            leading: const Icon(Icons.assignment_return, color: AppTheme.error),
            title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
            subtitle: Text('C\u00f3d: $code \u2022 $units uds \u2022 ${CurrencyFormatter.formatWhole(amount)}', style: const TextStyle(fontSize: 11)),
            trailing: Text(CurrencyFormatter.formatWhole(amount), style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.error, fontSize: 13)),
          ),
        );
      },
    );
  }
}
