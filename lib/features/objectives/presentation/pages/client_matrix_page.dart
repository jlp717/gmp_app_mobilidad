import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../../../core/api/api_config.dart';

class ClientMatrixPage extends StatefulWidget {
  final String clientCode;
  final String clientName;

  const ClientMatrixPage({
    super.key,
    required this.clientCode,
    required this.clientName,
  });

  @override
  State<ClientMatrixPage> createState() => _ClientMatrixPageState();
}

class _ClientMatrixPageState extends State<ClientMatrixPage> {
  bool _isLoading = true;
  String? _error;
  int _selectedYear = DateTime.now().year;
  List<Map<String, dynamic>> _matrixRows = [];
  Map<String, Map<int, Map<String, double>>> _pivotedData = {};
  
  // Pivot keys
  List<String> _uniqueProducts = [];
  Map<String, Map<String, dynamic>> _productDetails = {};

  final _currencyFormat = NumberFormat.currency(symbol: '€', decimalDigits: 2);
  final _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final response = await ApiClient.get(
        ApiConfig.clientMatrix,
        queryParameters: {
          'clientCode': widget.clientCode,
          'year': _selectedYear.toString(),
        },
      );

      final rows = List<Map<String, dynamic>>.from((response['rows'] as List?) ?? []);
      _processData(rows);

      setState(() {
        _matrixRows = rows;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  void _processData(List<Map<String, dynamic>> rows) {
    _pivotedData.clear();
    _productDetails.clear();
    final Set<String> keys = {};

    for (var row in rows) {
      final code = row['code'] ?? '';
      final lote = row['lote'] ?? '';
      final ref = row['ref'] ?? '';
      final price = (row['price'] as num?)?.toDouble() ?? 0.0;
      
      // key for grouping: Code + Lote + Price (to separate different prices)
      final key = '$code|$lote|$price';
      keys.add(key);

      if (!_productDetails.containsKey(key)) {
        _productDetails[key] = {
          'code': code,
          'name': row['name'] ?? '',
          'lote': lote,
          'ref': ref,
          'price': price,
        };
      }

      final month = (row['month'] as num).toInt();
      if (!_pivotedData.containsKey(key)) {
        _pivotedData[key] = {};
      }
      if (!_pivotedData[key]!.containsKey(month)) {
        _pivotedData[key]![month] = {'sales': 0, 'units': 0};
      }

      _pivotedData[key]![month]!['sales'] = (_pivotedData[key]![month]!['sales'] ?? 0) + ((row['sales'] as num?)?.toDouble() ?? 0);
      _pivotedData[key]![month]!['units'] = (_pivotedData[key]![month]!['units'] ?? 0) + ((row['units'] as num?)?.toDouble() ?? 0);
    }

    _uniqueProducts = keys.toList();
    _uniqueProducts.sort((a, b) {
       // Sort by Total Sales Desc
       final salesA = _getTotalSales(a);
       final salesB = _getTotalSales(b);
       return salesB.compareTo(salesA);
    });
  }

  double _getTotalSales(String key) {
    if (!_pivotedData.containsKey(key)) return 0;
    return _pivotedData[key]!.values.fold(0, (sum, monthData) => sum + (monthData['sales'] ?? 0));
  }

  @override
  Widget build(BuildContext context) {
    final filteredKeys = _uniqueProducts.where((key) {
      if (_searchQuery.isEmpty) return true;
      final details = _productDetails[key]!;
      final search = _searchQuery.toLowerCase();
      return details['code'].toString().toLowerCase().contains(search) ||
             details['name'].toString().toLowerCase().contains(search) ||
             details['lote'].toString().toLowerCase().contains(search) || 
             details['ref'].toString().toLowerCase().contains(search);
    }).toList();

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: AppTheme.surfaceColor,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.clientName, style: const TextStyle(fontSize: 16)),
            Text('Matriz ${_selectedYear}', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.calendar_today),
            onPressed: () async {
              // Simple year picker dialog could go here
               final year = await showDialog<int>(
                context: context,
                builder: (ctx) => SimpleDialog(
                  title: const Text('Seleccionar Año'),
                  children: ApiConfig.availableYears.map((y) => SimpleDialogOption(
                    onPressed: () => Navigator.pop(ctx, y),
                    child: Text(y.toString()),
                  )).toList(),
                ),
              );
              if (year != null && year != _selectedYear) {
                setState(() => _selectedYear = year);
                _loadData();
              }
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Buscar producto, lote, ref...',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: AppTheme.surfaceColor,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
              onChanged: (val) {
                setState(() => _searchQuery = val);
              },
            ),
          ),

          // Matrix Table
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(child: Text('Error: $_error')) 
                    : filteredKeys.isEmpty 
                      ? const Center(child: Text('No hay datos'))
                      : SingleChildScrollView(
                          scrollDirection: Axis.vertical,
                          child: SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Theme(
                              data: Theme.of(context).copyWith(dividerColor: Colors.grey[800]),
                              child: DataTable(
                                headingRowColor: MaterialStateProperty.all(AppTheme.surfaceColor),
                                dataRowColor: MaterialStateProperty.all(AppTheme.darkBase),
                                columnSpacing: 20,
                                columns: [
                                  const DataColumn(label: Text('Producto', style: TextStyle(fontWeight: FontWeight.bold))),
                                  const DataColumn(label: Text('Lote/Ref', style: TextStyle(fontWeight: FontWeight.bold))),
                                  const DataColumn(label: Text('Precio', style: TextStyle(fontWeight: FontWeight.bold))),
                                  const DataColumn(label: Text('Total', style: TextStyle(fontWeight: FontWeight.bold))),
                                  for (var m = 1; m <= 12; m++) ...[
                                     DataColumn(label: Text('${_monthShort(m)}\n€', textAlign: TextAlign.center, style: TextStyle(fontSize: 11))),
                                     DataColumn(label: Text('${_monthShort(m)}\nUds', textAlign: TextAlign.center, style: TextStyle(fontSize: 11))),
                                  ]
                                ],
                                rows: filteredKeys.map((key) {
                                  final details = _productDetails[key]!;
                                  final totalSales = _getTotalSales(key);
                                  
                                  return DataRow(
                                    cells: [
                                      DataCell(Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          Text(details['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w500)),
                                          Text(details['code'].toString(), style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                                        ],
                                      )),
                                      DataCell(Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          if (details['lote'].toString().isNotEmpty)
                                            Text(details['lote'].toString(), style: const TextStyle(fontSize: 11)),
                                          if (details['ref'].toString().isNotEmpty)
                                            Text(details['ref'].toString(), style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
                                        ],
                                      )),
                                      DataCell(Text(_currencyFormat.format(details['price']))),
                                      DataCell(Text(_currencyFormat.format(totalSales), style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.neonBlue))),
                                      for (var m = 1; m <= 12; m++) ...[
                                        DataCell(Text(
                                          _pivotedData[key]?[m]?['sales'] != null 
                                            ? _currencyFormat.format(_pivotedData[key]![m]!['sales'])
                                            : '-',
                                          style: const TextStyle(fontSize: 11),
                                        )),
                                         DataCell(Text(
                                          _pivotedData[key]?[m]?['units'] != null 
                                            ? _pivotedData[key]![m]!['units']!.toStringAsFixed(0)
                                            : '-',
                                          style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                                        )),
                                      ]
                                    ],
                                  );
                                }).toList(),
                              ),
                            ),
                          ),
                        ),
          ),
        ],
      ),
    );
  }

  String _monthShort(int m) {
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return months[m - 1];
  }
}
