/// Histórico Global de Compras — Widget Tab v2
/// =============================================
/// Tab reutilizable que muestra el histórico global de compras: KPIs,
/// comparativa año anterior, top productos del periodo y tabla scrollable.
///
/// Selector de años: por defecto los últimos 3 años. Dinámico: si el usuario
/// selecciona 1 o 2 años, la UI se adapta mostrando solo esos valores.
///
/// Backend: GET /api/pedidos/purchase-history-global
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';

class ProductsHistoryTab extends StatefulWidget {
  const ProductsHistoryTab({
    required this.isJefeVentas,
    super.key,
    this.vendedorCodes = 'ALL',
    this.initialClientCode,
  });

  final bool isJefeVentas;
  final String vendedorCodes;
  final String? initialClientCode;

  @override
  State<ProductsHistoryTab> createState() => _ProductsHistoryTabState();
}

class _ProductsHistoryTabState extends State<ProductsHistoryTab> {
  bool _loading = true;
  String? _error;

  // Year selector: default last 3 years
  late Set<int> _selectedYears;
  List<int> get _availableYears =>
      List.generate(5, (i) => DateTime.now().year - i);

  DateTime get _from {
    final minY = _selectedYears.isEmpty
        ? DateTime.now().year
        : _selectedYears.reduce((a, b) => a < b ? a : b);
    return DateTime(minY);
  }

  DateTime get _to {
    final maxY = _selectedYears.isEmpty
        ? DateTime.now().year
        : _selectedYears.reduce((a, b) => a > b ? a : b);
    return DateTime(maxY, 12, 31);
  }

  String _clientCode = '';
  String _productCode = '';
  String _familiaFilter = '';
  String _marcaFilter = '';
  late String _vendedorFilter;

  Map<String, dynamic>? _summary;
  List<Map<String, dynamic>> _topProducts = [];
  List<Map<String, dynamic>> _lines = [];
  List<Map<String, dynamic>> _monthlyByYear = [];

  @override
  void initState() {
    super.initState();
    _vendedorFilter = widget.vendedorCodes;
    if (widget.initialClientCode != null) {
      _clientCode = widget.initialClientCode!;
    }
    final now = DateTime.now().year;
    _selectedYears = {now, now - 1, now - 2};
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
          'vendedorCode': _vendedorFilter,
          if (_clientCode.isNotEmpty) 'clientCode': _clientCode,
          if (_productCode.isNotEmpty) 'productCode': _productCode,
          if (_familiaFilter.isNotEmpty) 'familia': _familiaFilter,
          if (_marcaFilter.isNotEmpty) 'marca': _marcaFilter,
          'limit': '300',
        },
      );
      if (response['success'] == true) {
        setState(() {
          _summary = response['summary'] as Map<String, dynamic>?;
          _topProducts =
              List<Map<String, dynamic>>.from(response['topProducts'] ?? []);
          _lines = List<Map<String, dynamic>>.from(response['lines'] ?? []);
          _monthlyByYear =
              List<Map<String, dynamic>>.from(response['monthlyByYear'] ?? []);
        });
      } else {
        setState(
          () => _error = response['error']?.toString() ?? 'Error desconocido',
        );
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _toggleYear(int year) {
    setState(() {
      if (_selectedYears.contains(year)) {
        if (_selectedYears.length > 1) {
          _selectedYears.remove(year);
        }
      } else {
        _selectedYears.add(year);
      }
    });
    _load();
  }

  String _fmtMoney(num? v) {
    final value = (v ?? 0).toDouble();
    return '${value.toStringAsFixed(2).replaceAllMapped(
          RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
          (m) => '${m[1]}.',
        )}€';
  }

  String _fmtMoneyCompact(num? v) {
    final value = (v ?? 0).toDouble();
    if (value >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M€';
    if (value >= 1000) return '${(value / 1000).toStringAsFixed(1)}K€';
    return '${value.toStringAsFixed(2)}€';
  }

  String _fmtPct(num? v) =>
      v == null ? '-' : '${v.toDouble().toStringAsFixed(1)}%';

  Color _yearColor(int index) {
    const colors = [
      AppTheme.neonGreen,
      AppTheme.neonBlue,
      Colors.orangeAccent,
      Colors.purpleAccent,
      Colors.pinkAccent,
    ];
    return colors[index % colors.length];
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.error_outline,
                size: 48,
                color: Colors.redAccent,
              ),
              const SizedBox(height: 12),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 12),
              ElevatedButton(
                onPressed: _load,
                child: const Text('Reintentar'),
              ),
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
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
          _buildMonthlyBarsCard(),
          const SizedBox(height: 12),
          _buildTopProductsCard(),
          const SizedBox(height: 12),
          _buildLinesTable(),
        ],
      ),
    );
  }

  Widget _buildFilters() {
    final sortedYears = _availableYears.toList()
      ..sort((a, b) => b.compareTo(a));

    return Card(
      color: AppTheme.darkCard,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            // Year selector chips
            Row(
              children: [
                const Icon(
                  Icons.calendar_today,
                  size: 16,
                  color: Colors.white54,
                ),
                const SizedBox(width: 8),
                const Text(
                  'Años:',
                  style: TextStyle(color: Colors.white70, fontSize: 12),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: sortedYears.map((year) {
                      final isSelected = _selectedYears.contains(year);
                      return GestureDetector(
                        onTap: () => _toggleYear(year),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: isSelected
                                ? AppTheme.neonPurple.withValues(alpha: 0.2)
                                : Colors.white.withValues(alpha: 0.05),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: isSelected
                                  ? AppTheme.neonPurple.withValues(alpha: 0.5)
                                  : Colors.white.withValues(alpha: 0.1),
                            ),
                          ),
                          child: Text(
                            '$year',
                            style: TextStyle(
                              color: isSelected
                                  ? AppTheme.neonPurple
                                  : Colors.white54,
                              fontWeight: isSelected
                                  ? FontWeight.w700
                                  : FontWeight.normal,
                              fontSize: 12,
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  tooltip: 'Recargar',
                  icon: const Icon(Icons.refresh, color: Colors.white70),
                  onPressed: _load,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                if (widget.initialClientCode == null) ...[
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
                ],
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
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    decoration: const InputDecoration(
                      labelText: 'Familia (código)',
                      isDense: true,
                    ),
                    onSubmitted: (v) {
                      setState(() => _familiaFilter = v.trim());
                      _load();
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    decoration: const InputDecoration(
                      labelText: 'Marca (código)',
                      isDense: true,
                    ),
                    onSubmitted: (v) {
                      setState(() => _marcaFilter = v.trim());
                      _load();
                    },
                  ),
                ),
              ],
            ),
            if (widget.isJefeVentas) ...[
              const SizedBox(height: 8),
              TextField(
                decoration: InputDecoration(
                  labelText: 'Filtrar vendedor (códigos coma o ALL)',
                  isDense: true,
                  hintText: _vendedorFilter,
                ),
                onSubmitted: (v) {
                  setState(
                    () => _vendedorFilter = v.trim().isEmpty ? 'ALL' : v.trim(),
                  );
                  _load();
                },
              ),
            ],
            if (_clientCode.isNotEmpty ||
                _productCode.isNotEmpty ||
                _familiaFilter.isNotEmpty ||
                _marcaFilter.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  if (_clientCode.isNotEmpty)
                    _activeFilterChip(
                      'Cliente: $_clientCode',
                      () => setState(() {
                        _clientCode = '';
                        _load();
                      }),
                    ),
                  if (_productCode.isNotEmpty)
                    _activeFilterChip(
                      'Producto: $_productCode',
                      () => setState(() {
                        _productCode = '';
                        _load();
                      }),
                    ),
                  if (_familiaFilter.isNotEmpty)
                    _activeFilterChip(
                      'Familia: $_familiaFilter',
                      () => setState(() {
                        _familiaFilter = '';
                        _load();
                      }),
                    ),
                  if (_marcaFilter.isNotEmpty)
                    _activeFilterChip(
                      'Marca: $_marcaFilter',
                      () => setState(() {
                        _marcaFilter = '';
                        _load();
                      }),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _activeFilterChip(String label, VoidCallback onClear) {
    return Chip(
      label: Text(label, style: const TextStyle(fontSize: 11)),
      backgroundColor: AppTheme.neonBlue.withValues(alpha: 0.15),
      side: BorderSide(color: AppTheme.neonBlue.withValues(alpha: 0.4)),
      deleteIcon: const Icon(Icons.close, size: 14),
      onDeleted: onClear,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
    );
  }

  Widget _buildSummaryCards() {
    final s = _summary ?? const <String, dynamic>{};
    final sortedYears = _selectedYears.toList()..sort((a, b) => b.compareTo(a));

    return Card(
      color: AppTheme.darkCard,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Resumen por año',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 8),
            // Header row
            Row(
              children: [
                const Expanded(
                    flex: 2, child: Text('', style: TextStyle(fontSize: 10))),
                ...sortedYears.asMap().entries.map(
                      (e) => Expanded(
                        child: Text(
                          '${e.value}',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: _yearColor(e.key),
                            fontWeight: FontWeight.w700,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ),
              ],
            ),
            const Divider(color: Colors.white12, height: 8),
            // Vendido
            _buildSummaryRow(
              'Vendido',
              Icons.euro,
              AppTheme.neonGreen,
              sortedYears,
              (year) {
                final yearData = _monthlyByYear
                    .where((m) => m['year'] == year)
                    .fold<double>(
                        0,
                        (sum, m) =>
                            sum +
                            ((m['totalVendido'] as num?)?.toDouble() ?? 0));
                return _fmtMoney(yearData);
              },
            ),
            // Sin dto
            _buildSummaryRow(
              'Sin dto',
              Icons.attach_money,
              AppTheme.neonBlue,
              sortedYears,
              (year) {
                final yearData = _monthlyByYear
                    .where((m) => m['year'] == year)
                    .fold<double>(
                        0,
                        (sum, m) =>
                            sum +
                            ((m['totalSinDescuento'] as num?)?.toDouble() ??
                                0));
                return _fmtMoney(yearData);
              },
            ),
            // Descuento
            _buildSummaryRow(
              'Descuento',
              Icons.discount,
              Colors.orangeAccent,
              sortedYears,
              (year) {
                final yearData = _monthlyByYear
                    .where((m) => m['year'] == year)
                    .fold<double>(
                        0,
                        (sum, m) =>
                            sum +
                            ((m['totalDescuento'] as num?)?.toDouble() ?? 0));
                return _fmtMoney(yearData);
              },
            ),
            // Unidades
            _buildSummaryRow(
              'Unidades',
              Icons.inventory_2,
              Colors.purpleAccent,
              sortedYears,
              (year) {
                final yearData = _monthlyByYear
                    .where((m) => m['year'] == year)
                    .fold<double>(
                        0,
                        (sum, m) =>
                            sum +
                            ((m['totalUnidades'] as num?)?.toDouble() ?? 0));
                return yearData.toStringAsFixed(0);
              },
            ),
            // Líneas
            _buildSummaryRow(
              'Líneas',
              Icons.list_alt,
              Colors.white70,
              sortedYears,
              (year) {
                final yearData = _monthlyByYear
                    .where((m) => m['year'] == year)
                    .fold<int>(
                        0,
                        (sum, m) =>
                            sum + ((m['numLineas'] as num?)?.toInt() ?? 0));
                return '$yearData';
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryRow(
    String label,
    IconData icon,
    Color color,
    List<int> years,
    String Function(int year) valueFn,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: Row(
              children: [
                Icon(icon, size: 14, color: color),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.6),
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          ...years.map(
            (year) => Expanded(
              child: Text(
                valueFn(year),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildComparativaCard() {
    final sortedYears = _selectedYears.toList()..sort((a, b) => b.compareTo(a));
    if (sortedYears.length < 2) return const SizedBox.shrink();

    // Compute total per year from monthlyByYear data
    double totalForYear(int year) {
      return _monthlyByYear.where((m) => m['year'] == year).fold<double>(
            0,
            (sum, m) => sum + ((m['totalVendido'] as num?)?.toDouble() ?? 0),
          );
    }

    return Card(
      color: AppTheme.darkCard,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.compare_arrows, color: Colors.white54, size: 18),
                SizedBox(width: 8),
                Text(
                  'Comparativa interanual',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            // Header
            Row(
              children: [
                const Expanded(
                  flex: 2,
                  child: Text(
                    'Comparación',
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize: 10,
                    ),
                  ),
                ),
                ...sortedYears.map(
                  (y) => Expanded(
                    child: Text(
                      _fmtMoney(totalForYear(y)),
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: _yearColor(sortedYears.indexOf(y)),
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ),
                const Expanded(
                  child: Text(
                    'Var.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize: 10,
                    ),
                  ),
                ),
              ],
            ),
            const Divider(color: Colors.white12, height: 8),
            // Year-over-year rows
            ...List.generate(sortedYears.length - 1, (i) {
              final newerYear = sortedYears[i];
              final olderYear = sortedYears[i + 1];
              final nueva = totalForYear(newerYear);
              final antigua = totalForYear(olderYear);
              final variacion =
                  antigua > 0 ? ((nueva - antigua) / antigua) * 100 : null;
              final color = variacion == null
                  ? Colors.white54
                  : variacion >= 0
                      ? AppTheme.neonGreen
                      : Colors.redAccent;

              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: Text(
                        '$newerYear vs $olderYear',
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        _fmtMoney(nueva),
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: _yearColor(i),
                          fontWeight: FontWeight.w600,
                          fontSize: 11,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        _fmtMoney(antigua),
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: _yearColor(i + 1),
                          fontWeight: FontWeight.w600,
                          fontSize: 11,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          variacion == null
                              ? 'N/A'
                              : '${variacion >= 0 ? '+' : ''}${_fmtPct(variacion)}',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: color,
                            fontWeight: FontWeight.w700,
                            fontSize: 11,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildMonthlyBarsCard() {
    if (_monthlyByYear.isEmpty) return const SizedBox.shrink();

    const labels = [
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic'
    ];
    final sortedYears = _selectedYears.toList()..sort((a, b) => a.compareTo(b));
    final numYears = sortedYears.length;

    // Build map: year -> month -> value
    final dataByYearMonth = <int, Map<int, double>>{};
    for (final y in sortedYears) {
      dataByYearMonth[y] = {};
    }
    for (final entry in _monthlyByYear) {
      final year = entry['year'] as int;
      final month = entry['month'] as int;
      final value = (entry['totalVendido'] as num?)?.toDouble() ?? 0;
      if (dataByYearMonth.containsKey(year)) {
        dataByYearMonth[year]![month] = value;
      }
    }

    // Find max value across all years/months for scaling
    double maxVal = 0;
    for (final y in sortedYears) {
      for (final v in dataByYearMonth[y]!.values) {
        if (v > maxVal) maxVal = v;
      }
    }
    if (maxVal == 0) return const SizedBox.shrink();

    const barGroupWidth = 1.0;
    final barWidth = 1.0 / numYears;

    return Card(
      color: AppTheme.darkCard,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Ventas por mes',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
            // Legend
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              children: sortedYears.asMap().entries.map((e) {
                return Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        color: _yearColor(e.key),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '${e.value}',
                      style: TextStyle(
                        color: _yearColor(e.key),
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 160,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: List.generate(12, (monthIdx) {
                  final month = monthIdx + 1;
                  final isCurrent = month == DateTime.now().month;

                  return Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 1),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          // Bars
                          SizedBox(
                            height: 120,
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: sortedYears.asMap().entries.map((ye) {
                                final year = ye.value;
                                final value =
                                    dataByYearMonth[year]?[month] ?? 0;
                                final h =
                                    maxVal > 0 ? (value / maxVal) * 110 : 0;
                                final color = _yearColor(ye.key);

                                return Expanded(
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 0.5),
                                    child: Container(
                                      height: h < 2 ? (value > 0 ? 2 : 0) : h,
                                      decoration: BoxDecoration(
                                        color: color.withValues(
                                            alpha: value > 0 ? 0.8 : 0),
                                        borderRadius:
                                            const BorderRadius.vertical(
                                          top: Radius.circular(2),
                                        ),
                                      ),
                                    ),
                                  ),
                                );
                              }).toList(),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            labels[monthIdx],
                            style: TextStyle(
                              color: isCurrent
                                  ? AppTheme.neonGreen
                                  : Colors.white.withValues(alpha: 0.55),
                              fontSize: 9,
                              fontWeight: isCurrent
                                  ? FontWeight.w700
                                  : FontWeight.normal,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }),
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
            const Text(
              'Top 10 productos del periodo',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            ..._topProducts.map(
              (p) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      flex: 4,
                      child: Text(
                        '${p['code']} · ${p['name']}',
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Expanded(
                      child: Text(
                        '${(p['unidades'] as num?)?.toStringAsFixed(0) ?? '0'} ud',
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          color: Colors.white54,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        _fmtMoney(p['importe']),
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          color: AppTheme.neonGreen,
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLinesTable() {
    if (_lines.isEmpty) {
      return const Card(
        color: AppTheme.darkCard,
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Center(
            child: Text(
              'Sin lineas para los filtros aplicados',
              style: TextStyle(color: Colors.white54),
            ),
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
            Text(
              'Líneas (${_lines.length})',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                headingTextStyle: const TextStyle(
                  color: Colors.white70,
                  fontWeight: FontWeight.w600,
                  fontSize: 12,
                ),
                dataTextStyle:
                    const TextStyle(color: Colors.white, fontSize: 12),
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
                  DataColumn(label: Text('Vend.')),
                  DataColumn(label: Text('Albarán')),
                ],
                rows: _lines
                    .map(
                      (l) => DataRow(
                        cells: [
                          DataCell(Text(l['fecha']?.toString() ?? '')),
                          DataCell(
                            Text(
                              '${l['clienteCode']} · ${l['clienteName']}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          DataCell(
                            Text(
                              '${l['productCode']} · ${l['productName']}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          DataCell(
                            Text(
                              (l['cantidad'] as num?)?.toStringAsFixed(2) ??
                                  '0',
                            ),
                          ),
                          DataCell(Text(_fmtMoney(l['precio']))),
                          DataCell(Text(_fmtPct(l['descuentoPct']))),
                          DataCell(Text(_fmtMoney(l['importeSinDescuento']))),
                          DataCell(Text(_fmtMoney(l['importe']))),
                          DataCell(
                            Text(l['vendedorCode']?.toString() ?? ''),
                          ),
                          DataCell(Text(l['albaran']?.toString() ?? '')),
                        ],
                      ),
                    )
                    .toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
