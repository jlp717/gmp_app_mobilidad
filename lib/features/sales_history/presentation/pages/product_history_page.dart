import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../providers/sales_history_provider.dart';
import '../../../../core/providers/auth_provider.dart';
import 'package:intl/intl.dart';

class ProductHistoryPage extends StatefulWidget {
  final String? initialClientCode;

  const ProductHistoryPage({super.key, this.initialClientCode});

  @override
  State<ProductHistoryPage> createState() => _ProductHistoryPageState();
}

class _ProductHistoryPageState extends State<ProductHistoryPage> {
  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _clientController = TextEditingController();
  DateTimeRange? _selectedDateRange;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final history = Provider.of<SalesHistoryProvider>(context, listen: false);
      
      history.setVendedorCodes(auth.vendedorCodes.join(','));
      
      if (widget.initialClientCode != null) {
        _clientController.text = widget.initialClientCode!;
        history.setClientCode(widget.initialClientCode);
      } else {
        history.loadHistory(reset: true);
      }
    });

    _clientController.addListener(_onClientChanged);
  }
  
  @override
  void dispose() {
    _searchController.dispose();
    _clientController.removeListener(_onClientChanged);
    _clientController.dispose();
    super.dispose();
  }

  void _onClientChanged() {
     // Optional: handle manual client code entry debounce
     // For now relying on Search button or separate action
  }
  
  void _onSearchSubmit(String val) {
    Provider.of<SalesHistoryProvider>(context, listen: false)
      ..setProductSearch(val)
      ..loadHistory(reset: true);
  }

  Future<void> _pickDateRange() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2023),
      lastDate: DateTime.now(),
      initialDateRange: _selectedDateRange,
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: ColorScheme.dark(
              primary: AppColors.primary,
              onPrimary: Colors.white,
              surface: AppColors.cardColor,
              onSurface: Colors.white,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      setState(() => _selectedDateRange = picked);
      final start = DateFormat('yyyy-MM-dd').format(picked.start);
      final end = DateFormat('yyyy-MM-dd').format(picked.end);
      
      Provider.of<SalesHistoryProvider>(context, listen: false).setDateRange(start, end);
    }
  }
  
  void _clearFilters() {
    _searchController.clear();
    _clientController.clear();
    setState(() => _selectedDateRange = null);
    
    final p = Provider.of<SalesHistoryProvider>(context, listen: false);
    p.setClientCode(null);
    p.setProductSearch('');
    p.setDateRange(null, null); // Will trigger load
  }

  @override
  Widget build(BuildContext context) {
    final history = Provider.of<SalesHistoryProvider>(context);

    return Scaffold(
      backgroundColor: AppColors.backgroundColor,
      appBar: AppBar(
        title: const Text('Histórico de Ventas'),
        backgroundColor: AppColors.cardColor,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => history.loadHistory(reset: true),
          ),
        ],
      ),
      body: Column(
        children: [
          // Filters
          Container(
            padding: const EdgeInsets.all(16),
            color: AppColors.cardColor,
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: _clientController,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: 'Cód. Cliente (Opcional)',
                          hintStyle: TextStyle(color: Colors.white54),
                          filled: true,
                          fillColor: AppColors.backgroundColor,
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                          prefixIcon: const Icon(Icons.person, color: Colors.white54),
                        ),
                        onSubmitted: (val) => history.setClientCode(val.isEmpty ? null : val),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      flex: 3,
                      child: TextField(
                        controller: _searchController,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          hintText: 'Buscar Producto / Ref / Lote',
                          hintStyle: TextStyle(color: Colors.white54),
                          filled: true,
                          fillColor: AppColors.backgroundColor,
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                          prefixIcon: const Icon(Icons.search, color: Colors.white54),
                        ),
                        onSubmitted: _onSearchSubmit,
                      ),
                    ),
                    const SizedBox(width: 16),
                    IconButton(
                      icon: const Icon(Icons.calendar_month, color: AppColors.primary),
                      onPressed: _pickDateRange,
                      tooltip: 'Filtrar Fechas',
                    ),
                     if (_selectedDateRange != null || _clientController.text.isNotEmpty || _searchController.text.isNotEmpty)
                      TextButton.icon(
                        icon: const Icon(Icons.clear, color: Colors.redAccent),
                        label: const Text('Limpiar', style: TextStyle(color: Colors.redAccent)),
                        onPressed: _clearFilters,
                      ),
                  ],
                ),
              ],
            ),
          ),
          
          // Results
          Expanded(
            child: history.isLoading
                ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
                : history.error != null
                    ? Center(child: Text('Error: ${history.error}', style: const TextStyle(color: Colors.redAccent)))
                    : history.items.isEmpty
                        ? const Center(child: Text('No hay datos', style: TextStyle(color: Colors.white54)))
                        : SingleChildScrollView(
                            scrollDirection: Axis.vertical,
                            child: SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: DataTable(
                                headingRowColor: MaterialStateProperty.all(AppColors.cardColor),
                                dataRowColor: MaterialStateProperty.all(AppColors.backgroundColor),
                                columns: const [
                                  DataColumn(label: Text('Fecha', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                                  DataColumn(label: Text('Cliente', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                                  DataColumn(label: Text('Factura', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                                  DataColumn(label: Text('Producto', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                                  DataColumn(label: Text('Lote', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                                  DataColumn(label: Text('Cant', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                                  DataColumn(label: Text('Precio', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                                  DataColumn(label: Text('Total', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                                ],
                                rows: history.items.map((item) {
                                  return DataRow(cells: [
                                    DataCell(Text(item.date, style: const TextStyle(color: Colors.white70))),
                                    DataCell(Text('${item.clientCode}', style: const TextStyle(color: Colors.white70))),
                                    DataCell(Text(item.invoice, style: const TextStyle(color: AppColors.neonBlue))),
                                    DataCell(Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      mainAxisAlignment: MainAxisAlignment.center,
                                      children: [
                                        Text(item.productName, style: const TextStyle(color: Colors.white), overflow: TextOverflow.ellipsis),
                                        Text(item.productCode, style: const TextStyle(color: Colors.white30, fontSize: 10)),
                                      ],
                                    )),
                                    DataCell(Text(item.lote + (item.ref.isNotEmpty ? ' / ${item.ref}' : ''), style: const TextStyle(color: Colors.white70))),
                                    DataCell(Text(item.quantity.toStringAsFixed(0), style: const TextStyle(color: AppColors.primary))),
                                    DataCell(Text(item.price, style: const TextStyle(color: Colors.white70))),
                                    DataCell(Text(item.total, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                                  ]);
                                }).toList(),
                              ),
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}
