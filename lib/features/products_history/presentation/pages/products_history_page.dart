/// Histórico Global de Compras
/// ============================
/// Página que muestra todas las compras (líneas de albarán) en un rango de
/// fechas, con filtros, resumen agregado, top productos y comparativa con
/// año anterior. Inspirada en el comparador de semanas del rutero.
///
/// Fuente backend: GET /api/pedidos/purchase-history-global
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class ProductsHistoryPage extends StatefulWidget {
  const ProductsHistoryPage({super.key, this.initialVendedorCode});

  /// Vendor por defecto: ALL para JEFE, código propio para COMERCIAL.
  final String? initialVendedorCode;

  @override
  State<ProductsHistoryPage> createState() => _ProductsHistoryPageState();
}

class _ProductsHistoryPageState extends State<ProductsHistoryPage> {
  bool _loading = true;
  String? _error;
  DateTime _from = DateTime(DateTime.now().year, 1, 1);
  DateTime _to = DateTime.now();
  String _clientCode = '';
  String _productCode = '';

  Map<String, dynamic>? _summary;
  List<Map<String, dynamic>> _topProducts = [];
  List<Map<String, dynamic>> _lines = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final response = await ApiClient.get(
        '/pedidos/purchase-history-global',
        queryParameters: <String, String>{
          'from': _from.toIso8601String().substring(0, 10),
          'to': _to.toIso8601String().substring(0, 10),
          'vendedorCode': widget.initialVendedorCode ?? 'ALL',
          if (_clientCode.isNotEmpty) 'clientCode': _clientCode,
          if (_productCode.isNotEmpty) 'productCode': _productCode,
          'limit': '300',
        },
      );
      if (response['success'] == true) {
        setState(() {
          _summary = response['summary'] as Map<String, dynamic>?;
          _topProducts = List<Map<String, dynamic>>.from(response['topProducts'] ?? []);
          _lines = List<Map<String, dynamic>>.from(response['lines'] ?? []);
        });
      } else {
        setState(() => _error = response['error']?.toString() ?? 'Error desconocido');
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickDateRange() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
      initialDateRange: DateTimeRange(start: _from, end: _to),
    );
    if (picked != null) {
      setState(() {
        _from = picked.start;
        _to = picked.end;
      });
      await _load();
    }
  }

  String _fmtMoney(num? v) {
    final value = (v ?? 0).toDouble();
    return '${value.toStringAsFixed(2).replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]}.',
    )}€';
  }

  String _fmtPct(num? v) {
    if (v == null) return '-';
    return '${v.toDouble().toStringAsFixed(1)}%';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkSurface,
      appBar: AppBar(
        title: const Text('Histórico de compras'),
        backgroundColor: AppTheme.darkSurface,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : _load,
            tooltip: 'Recargar',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.error_outline, size: 48, color: Colors.redAccent),
                        const SizedBox(height: 12),
                        Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
                        const SizedBox(height: 12),
                        ElevatedButton(onPressed: _load, child: const Text('Reintentar')),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      _buildFilters(),
                      const SizedBox(height: 12),
                      _buildSummaryCards(),
                      const SizedBox(height: 12),
                      _buildComparativaCard(),
                      const SizedBox(height: 12),
                      _buildTopProductsCard(),
                      const SizedBox(height: 12),
                      _buildLinesTable(),
                    ],
                  ),
                ),
    );
  }

  Widget _buildFilters() {
    return Card(
      color: AppTheme.darkCard,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _pickDateRange,
                    icon: const Icon(Icons.date_range),
                    label: Text(
                      '${_from.toIso8601String().substring(0, 10)}  →  ${_to.toIso8601String().substring(0, 10)}',
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    decoration: const InputDecoration(
                      labelText: 'Filtrar cliente (código)',
                      isDense: true,
                    ),
                    onSubmitted: (v) {
                      setState(() => _clientCode = v.trim());
                      _load();
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    decoration: const InputDecoration(
                      labelText: 'Filtrar producto (código)',
                      isDense: true,
                    ),
                    onSubmitted: (v) {
                      setState(() => _productCode = v.trim());
                      _load();
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryCards() {
    final s = _summary ?? const <String, dynamic>{};
    Widget kpi(String label, String value, IconData icon, Color color) {
      return Expanded(
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppTheme.darkCard,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: color.withValues(alpha: 0.2)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(height: 6),
              Text(label, style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 11)),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
      );
    }
    return Row(
      children: [
        kpi('Vendido', _fmtMoney(s['totalVendido']), Icons.euro, AppTheme.neonGreen),
        const SizedBox(width: 8),
        kpi('Sin dto', _fmtMoney(s['totalSinDescuento']), Icons.attach_money, AppTheme.neonBlue),
        const SizedBox(width: 8),
        kpi('Descuento', _fmtMoney(s['totalDescuento']), Icons.discount, Colors.orangeAccent),
        const SizedBox(width: 8),
        kpi('Líneas', '${s['numLineas'] ?? 0}', Icons.list_alt, Colors.white70),
      ],
    );
  }

  Widget _buildComparativaCard() {
    final comp = (_summary ?? const <String, dynamic>{})['comparativaAnoAnterior'] as Map<String, dynamic>?;
    if (comp == null) return const SizedBox.shrink();
    final variacion = comp['variacionPct'] as num?;
    final color = variacion == null
        ? Colors.white70
        : variacion >= 0
            ? AppTheme.neonGreen
            : Colors.redAccent;
    return Card(
      color: AppTheme.darkCard,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Icon(Icons.compare_arrows, color: Colors.white54),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Comparativa mismo periodo año anterior',
                      style: TextStyle(color: Colors.white70, fontSize: 12)),
                  const SizedBox(height: 4),
                  Text('Año anterior: ${_fmtMoney(comp['totalAnoAnterior'])}',
                      style: const TextStyle(color: Colors.white, fontSize: 14)),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                variacion == null ? 'N/A' : '${variacion >= 0 ? '+' : ''}${_fmtPct(variacion)}',
                style: TextStyle(color: color, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTopProductsCard() {
    if (_topProducts.isEmpty) return const SizedBox.shrink();
    return Card(
      color: AppTheme.darkCard,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Top 10 productos del periodo',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            ..._topProducts.map((p) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Expanded(
                        flex: 4,
                        child: Text(
                          '${p['code']} · ${p['name']}',
                          style: const TextStyle(color: Colors.white70, fontSize: 12),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Expanded(
                        flex: 1,
                        child: Text('${(p['unidades'] as num?)?.toStringAsFixed(0) ?? '0'} ud',
                            textAlign: TextAlign.right,
                            style: const TextStyle(color: Colors.white54, fontSize: 12)),
                      ),
                      Expanded(
                        flex: 1,
                        child: Text(_fmtMoney(p['importe']),
                            textAlign: TextAlign.right,
                            style: const TextStyle(color: AppTheme.neonGreen, fontWeight: FontWeight.w700, fontSize: 12)),
                      ),
                    ],
                  ),
                )),
          ],
        ),
      ),
    );
  }

  Widget _buildLinesTable() {
    if (_lines.isEmpty) {
      return Card(
        color: AppTheme.darkCard,
        child: const Padding(
          padding: EdgeInsets.all(24),
          child: Center(
            child: Text('Sin lineas para los filtros aplicados',
                style: TextStyle(color: Colors.white54)),
          ),
        ),
      );
    }
    return Card(
      color: AppTheme.darkCard,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Líneas (${_lines.length})',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                headingTextStyle: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w600, fontSize: 12),
                dataTextStyle: const TextStyle(color: Colors.white, fontSize: 12),
                columnSpacing: 16,
                horizontalMargin: 8,
                columns: const [
                  DataColumn(label: Text('Fecha')),
                  DataColumn(label: Text('Cliente')),
                  DataColumn(label: Text('Producto')),
                  DataColumn(label: Text('Cant.'), numeric: true),
                  DataColumn(label: Text('Precio'), numeric: true),
                  DataColumn(label: Text('Dto%'), numeric: true),
                  DataColumn(label: Text('Sin dto'), numeric: true),
                  DataColumn(label: Text('Importe'), numeric: true),
                  DataColumn(label: Text('Vendedor')),
                  DataColumn(label: Text('Albarán')),
                ],
                rows: _lines.map((l) => DataRow(cells: [
                      DataCell(Text(l['fecha']?.toString() ?? '')),
                      DataCell(Text(
                        '${l['clienteCode']} · ${l['clienteName']}',
                        overflow: TextOverflow.ellipsis,
                      )),
                      DataCell(Text(
                        '${l['productCode']} · ${l['productName']}',
                        overflow: TextOverflow.ellipsis,
                      )),
                      DataCell(Text((l['cantidad'] as num?)?.toStringAsFixed(2) ?? '0')),
                      DataCell(Text(_fmtMoney(l['precio']))),
                      DataCell(Text(_fmtPct(l['descuentoPct']))),
                      DataCell(Text(_fmtMoney(l['importeSinDescuento']))),
                      DataCell(Text(_fmtMoney(l['importe']))),
                      DataCell(Text(l['vendedorCode']?.toString() ?? '')),
                      DataCell(Text(l['albaran']?.toString() ?? '')),
                    ])).toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
