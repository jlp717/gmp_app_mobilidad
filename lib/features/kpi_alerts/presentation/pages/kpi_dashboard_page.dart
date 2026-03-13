// kpi_dashboard_page.dart: Panel resumen Glacius/Nestle
// JEFE_VENTAS ve todos los clientes, COMERCIAL solo los suyos

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

/// Panel resumen KPI Glacius para Jefe de Ventas y Comerciales.
class KpiDashboardPage extends StatefulWidget {
  /// Creates a KPI Dashboard page.
  const KpiDashboardPage({super.key});

  @override
  State<KpiDashboardPage> createState() => _KpiDashboardPageState();
}

class _KpiDashboardPageState extends State<KpiDashboardPage> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDashboard();
  }

  Future<void> _loadDashboard() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final auth = context.read<AuthProvider>();
      final vendorCode =
          auth.role == 'JEFE_VENTAS' ? null : auth.vendorCode;

      String url = ApiConfig.kpiDashboard;
      if (vendorCode != null && vendorCode != 'ALL') {
        url += '?vendorCode=$vendorCode';
      }

      final data = await ApiClient.get(url);
      if (data != null && data['success'] == true) {
        setState(() {
          _data = data;
          _loading = false;
        });
      } else {
        setState(() {
          _error = 'Sin datos disponibles';
          _loading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        title: const Text('KPI Glacius / Nestle'),
        backgroundColor: AppTheme.darkSurface,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadDashboard,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError()
              : _buildContent(),
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cloud_off, size: 48, color: Colors.grey[600]),
          const SizedBox(height: 12),
          Text(
            _error!,
            style: TextStyle(color: Colors.grey[500]),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _loadDashboard,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Reintentar'),
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    final totals = _data!['totals'] as Map<String, dynamic>;
    final byType = _data!['byType'] as List<dynamic>;
    final topClients = _data!['topClients'] as List<dynamic>;
    final lastLoad = _data!['lastLoad'] as Map<String, dynamic>?;

    return RefreshIndicator(
      onRefresh: _loadDashboard,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Ultima carga
          if (lastLoad != null) _buildLastLoadBanner(lastLoad),
          const SizedBox(height: 16),

          // Cards de resumen
          _buildSummaryCards(totals),
          const SizedBox(height: 20),

          // Desglose por tipo
          _buildTypeBreakdown(byType),
          const SizedBox(height: 20),

          // Top clientes
          _buildTopClients(topClients),
        ],
      ),
    );
  }

  Widget _buildLastLoadBanner(Map<String, dynamic> load) {
    final loadId = load['loadId'] ?? '';
    final completedAt = load['completedAt']?.toString() ?? '';
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 16,
        vertical: 10,
      ),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: Colors.blueGrey.withValues(alpha: 0.3),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.check_circle,
            color: Colors.greenAccent[400],
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Carga $loadId — $completedAt',
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryCards(Map<String, dynamic> totals) {
    return Row(
      children: [
        _buildCard(
          'Criticas',
          totals['critical']?.toString() ?? '0',
          Colors.redAccent,
          Icons.error,
        ),
        const SizedBox(width: 10),
        _buildCard(
          'Warning',
          totals['warning']?.toString() ?? '0',
          Colors.orangeAccent,
          Icons.warning_amber,
        ),
        const SizedBox(width: 10),
        _buildCard(
          'Info',
          totals['info']?.toString() ?? '0',
          Colors.cyanAccent,
          Icons.info_outline,
        ),
        const SizedBox(width: 10),
        _buildCard(
          'Clientes',
          totals['clients']?.toString() ?? '0',
          Colors.blueAccent,
          Icons.people,
        ),
      ],
    );
  }

  Widget _buildCard(
    String label,
    String value,
    Color color,
    IconData icon,
  ) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(
          vertical: 16,
          horizontal: 8,
        ),
        decoration: BoxDecoration(
          color: AppTheme.darkSurface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: color.withValues(alpha: 0.3),
          ),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 24),
            const SizedBox(height: 6),
            Text(
              value,
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                color: Colors.grey[500],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTypeBreakdown(List<dynamic> byType) {
    // Agrupar por tipo
    final Map<String, Map<String, int>> grouped = {};
    for (final item in byType) {
      final type = item['type']?.toString() ?? '';
      final sev = item['severity']?.toString() ?? '';
      final count = (item['count'] as num?)?.toInt() ?? 0;
      grouped.putIfAbsent(type, () => {});
      grouped[type]![sev] = count;
    }

    const typeLabels = {
      'DESVIACION_VENTAS': 'Desviacion Ventas',
      'CUOTA_SIN_COMPRA': 'Sin Compras',
      'DESVIACION_REFERENCIACION': 'Referenciacion',
      'PROMOCION': 'Promociones',
      'ALTA_CLIENTE': 'Clientes Nuevos',
      'AVISO': 'Avisos',
      'MEDIOS_CLIENTE': 'Equipamiento',
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Desglose por tipo',
          style: TextStyle(
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        ...grouped.entries.map((e) {
          final label = typeLabels[e.key] ?? e.key;
          final crit = e.value['critical'] ?? 0;
          final warn = e.value['warning'] ?? 0;
          final info = e.value['info'] ?? 0;
          final total = crit + warn + info;

          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 10,
            ),
            decoration: BoxDecoration(
              color: AppTheme.darkSurface,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: Text(
                    label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                if (crit > 0)
                  _buildBadge(crit, Colors.redAccent),
                if (warn > 0)
                  _buildBadge(warn, Colors.orangeAccent),
                if (info > 0)
                  _buildBadge(info, Colors.cyanAccent),
                const SizedBox(width: 8),
                SizedBox(
                  width: 36,
                  child: Text(
                    '$total',
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }

  Widget _buildBadge(int count, Color color) {
    return Container(
      margin: const EdgeInsets.only(left: 4),
      padding: const EdgeInsets.symmetric(
        horizontal: 8,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        '$count',
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _buildTopClients(List<dynamic> clients) {
    if (clients.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Top clientes con alertas (${clients.length})',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        ...clients.take(20).map((c) {
          final code = c['clientCode']?.toString() ?? '';
          final name = c['clientName']?.toString() ?? '';
          final crit = (c['critical'] as num?)?.toInt() ?? 0;
          final warn = (c['warning'] as num?)?.toInt() ?? 0;
          final total = (c['totalAlerts'] as num?)?.toInt() ?? 0;

          return Container(
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 10,
            ),
            decoration: BoxDecoration(
              color: AppTheme.darkSurface,
              borderRadius: BorderRadius.circular(8),
              border: crit > 0
                  ? Border.all(
                      color: Colors.redAccent
                          .withValues(alpha: 0.3),
                    )
                  : null,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children: [
                      Text(
                        name.isNotEmpty ? name : code,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (name.isNotEmpty)
                        Text(
                          code,
                          style: TextStyle(
                            color: Colors.grey[600],
                            fontSize: 11,
                          ),
                        ),
                    ],
                  ),
                ),
                if (crit > 0)
                  _buildBadge(crit, Colors.redAccent),
                if (warn > 0)
                  _buildBadge(warn, Colors.orangeAccent),
                const SizedBox(width: 6),
                Text(
                  '$total',
                  style: const TextStyle(
                    color: Colors.white54,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          );
        }),
      ],
    );
  }
}
