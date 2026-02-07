/// Facturas Page
/// ==============
/// Invoice listing with filters, search and actions for commercial profile
/// Premium modern UI with smooth animations

import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../../../core/providers/auth_provider.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../data/facturas_service.dart';

class FacturasPage extends StatefulWidget {
  const FacturasPage({super.key});

  @override
  State<FacturasPage> createState() => _FacturasPageState();
}

class _FacturasPageState extends State<FacturasPage> with TickerProviderStateMixin {
  List<Factura> _facturas = [];
  List<int> _years = [];
  FacturaSummary? _summary;
  bool _isLoading = true;
  String _error = '';
  
  // Date Filters
  int _selectedYear = DateTime.now().year;
  int? _selectedMonth;
  DateTime? _dateFrom;
  DateTime? _dateTo;
  
  // Search controllers
  final TextEditingController _clientSearchController = TextEditingController();
  final TextEditingController _facturaSearchController = TextEditingController();
  Timer? _debounce;
  
  late AnimationController _fadeController;
  
  @override
  void initState() {
    super.initState();
    _fadeController = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadInitialData();
    });
  }
  
  @override
  void dispose() {
    _clientSearchController.dispose();
    _facturaSearchController.dispose();
    _debounce?.cancel();
    _fadeController.dispose();
    super.dispose();
  }
  
  String get _vendedorCodes {
    final auth = context.read<AuthProvider>();
    final filter = context.read<FilterProvider>();
    if (auth.isDirector && filter.selectedVendor != null) {
      return filter.selectedVendor!;
    }
    return auth.vendorCodes.join(',');
  }
  
  // Helper to format date
  String? _formatDateParam(DateTime? date) {
    if (date == null) return null;
    return "${date.year}-${date.month.toString().padLeft(2,'0')}-${date.day.toString().padLeft(2,'0')}";
  }
  
  Future<void> _loadInitialData() async {
    if (!mounted) return;
    setState(() {
      _isLoading = true;
      _error = '';
    });
    
    try {
      final codes = _vendedorCodes;
      if (codes.isEmpty) {
        setState(() {
          _error = 'No hay códigos de vendedor configurados';
          _isLoading = false;
        });
        return;
      }
      
      final results = await Future.wait([
        FacturasService.getAvailableYears(codes),
        FacturasService.getFacturas(
          vendedorCodes: codes,
          year: _selectedYear,
          month: _selectedMonth,
          clientSearch: _clientSearchController.text,
          docSearch: _facturaSearchController.text,
          dateFrom: _formatDateParam(_dateFrom),
          dateTo: _formatDateParam(_dateTo),
        ),
        FacturasService.getSummary(
          vendedorCodes: codes,
          year: _selectedYear,
          month: _selectedMonth,
        ),
      ]);
      
      if (!mounted) return;

      setState(() {
        _years = results[0] as List<int>;
        _facturas = results[1] as List<Factura>;
        _summary = results[2] as FacturaSummary?;
        _isLoading = false;
      });
      
      _fadeController.forward();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Error cargando facturas: $e';
        _isLoading = false;
      });
    }
  }
  
  Future<void> _refreshData() async {
    if (!mounted) return;
    try {
      final codes = _vendedorCodes;
      
      final results = await Future.wait([
        FacturasService.getFacturas(
          vendedorCodes: codes,
          year: _selectedYear,
          month: _selectedMonth,
          clientSearch: _clientSearchController.text,
          docSearch: _facturaSearchController.text,
          dateFrom: _formatDateParam(_dateFrom),
          dateTo: _formatDateParam(_dateTo),
        ),
        FacturasService.getSummary(
          vendedorCodes: codes,
          year: _selectedYear,
          month: _selectedMonth,
        ),
      ]);
      
      if (!mounted) return;

      setState(() {
        _facturas = results[0] as List<Factura>;
        _summary = results[1] as FacturaSummary?;
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
      );
    }
  }
  
  void _onYearChanged(int? year) {
    if (year != null && year != _selectedYear) {
      setState(() {
        _selectedYear = year;
        // Clear specific dates if year changed
        _dateFrom = null;
        _dateTo = null;
      });
      _refreshData();
    }
  }
  
  void _onMonthChanged(int? month) {
    if (month != _selectedMonth) {
      setState(() {
        _selectedMonth = month;
        // Clear specific dates if month changed
        _dateFrom = null;
        _dateTo = null;
      });
      _refreshData();
    }
  }

  Future<void> _selectDate(BuildContext context, bool isFrom) async {
    final initialDate = isFrom ? (_dateFrom ?? DateTime.now()) : (_dateTo ?? DateTime.now());
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
      locale: const Locale('es', 'ES'),
    );

    if (picked != null) {
      setState(() {
        if (isFrom) {
          _dateFrom = picked;
          // If To is null or before From, set To = From
          if (_dateTo == null || _dateTo!.isBefore(picked)) {
            _dateTo = picked; // auto-set logic or just leave it?
          }
        } else {
          _dateTo = picked;
        }
        // If we select dates, we might want to clear Month filter visually? 
        // Logic will handle it, but for UI clarity:
        _selectedMonth = null; 
      });
      _refreshData();
    }
  }
  
  void _onSearchChanged() {
    if (_debounce?.isActive ?? false) _debounce!.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), () {
      _refreshData();
    });
  }
  
  void _showFacturaDetail(Factura factura) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _FacturaDetailSheet(
        factura: factura,
        onShare: _shareFacturaPdf,
      ),
    );
  }
  
  Future<void> _shareFacturaPdf(Factura factura) async {
    try {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Row(
            children: [
              SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
              SizedBox(width: 16),
              Text('Generando y descargando PDF...'),
            ],
          ),
          duration: Duration(seconds: 2),
        ),
      );

      final file = await FacturasService.downloadFacturaPdf(
        factura.serie,
        factura.numero,
        factura.ejercicio,
      );

      if (!mounted) return;
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      
      final text = '''
Estimado cliente,

Adjunto le remitimos la factura ${factura.numeroFormateado} correspondiente a su pedido.

Importe total: ${factura.total.toStringAsFixed(2)} €

Gracias por su confianza.
Equipo Granja Mari Pepa''';

      final result = await Share.shareXFiles(
        [XFile(file.path)],
        text: text,
        subject: 'Factura ${factura.numeroFormateado} - Granja Mari Pepa',
      );
      
      // On Android, result status is not always reliable for "success", 
      // but if we get here without error, we can show a confirmation.
      if (result.status == ShareResultStatus.success) {
         if (!mounted) return;
         _showSuccessDialog();
      }
      
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).hideCurrentSnackBar();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error compartiendo PDF: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _showSuccessDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: const [
            Icon(Icons.check_circle, color: Colors.green),
            SizedBox(width: 8),
            Text('Enviado'),
          ],
        ),
        content: const Text('La factura se ha compartido correctamente.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('ACEPTAR'),
          ),
        ],
      ),
    );
  }
  
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final auth = context.watch<AuthProvider>();
    
    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0D1117) : const Color(0xFFF8FAFC),
      body: SafeArea(
        child: Column(
          children: [
            if (auth.isDirector)
              GlobalVendorSelector(
                isJefeVentas: true,
                onChanged: _loadInitialData,
              ),

            _buildHeader(theme, isDark),
            _buildFiltersSection(theme, isDark),
            _buildSearchFilters(theme, isDark),
            
            if (_summary != null) _buildSummary(theme, isDark),
            
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : _error.isNotEmpty
                      ? Center(child: Text(_error, style: TextStyle(color: Colors.red)))
                      : _facturas.isEmpty
                          ? const Center(child: Text('No hay facturas'))
                          : RefreshIndicator(
                              onRefresh: _refreshData,
                              child: FadeTransition(
                                opacity: _fadeController,
                                child: ListView.builder(
                                  padding: const EdgeInsets.symmetric(horizontal: 16),
                                  itemCount: _facturas.length,
                                  itemBuilder: (ctx, i) => _buildFacturaCard(_facturas[i], theme, isDark),
                                ),
                              ),
                            ),
            ),
          ],
        ),
      ),
    );
  }
  
  Widget _buildHeader(ThemeData theme, bool isDark) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isDark
              ? [const Color(0xFF1E3A5F), const Color(0xFF0D1117)]
              : [const Color(0xFF2D5A87), const Color(0xFF1E3A5F)],
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.receipt_long, color: Colors.white, size: 28),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Text(
              'Facturas',
              style: TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          IconButton(
            onPressed: () {
               _clientSearchController.clear();
               _facturaSearchController.clear();
               setState(() {
                 _dateFrom = null;
                 _dateTo = null;
               });
               _loadInitialData();
            },
            icon: const Icon(Icons.refresh, color: Colors.white),
          ),
        ],
      ),
    );
  }
  
  Widget _buildFiltersSection(ThemeData theme, bool isDark) {
    final months = [
      'Todos', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Month / Year Row
          Row(
            children: [
              // Year
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF21262D) : Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.05),
                      blurRadius: 4,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<int>(
                    value: _selectedYear,
                    items: _years.map((y) => DropdownMenuItem(
                      value: y,
                      child: Text('$y'),
                    )).toList(),
                    onChanged: _onYearChanged,
                    icon: const Icon(Icons.keyboard_arrow_down),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // Month
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF21262D) : Colors.white,
                    borderRadius: BorderRadius.circular(10),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.05),
                        blurRadius: 4,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<int?>(
                      value: _selectedMonth,
                      isExpanded: true,
                      items: [
                        const DropdownMenuItem(value: null, child: Text('Todos los meses')),
                        ...List.generate(12, (i) => DropdownMenuItem(
                          value: i + 1,
                          child: Text(months[i + 1]),
                        )),
                      ],
                      onChanged: _onMonthChanged,
                      icon: const Icon(Icons.keyboard_arrow_down),
                    ),
                  ),
                ),
              ),
            ],
          ),
          
          const SizedBox(height: 12),
          
          // Date Range Header
          const Text(
            'Rango de fechas (opcional)',
            style: TextStyle(
              fontSize: 12, 
              fontWeight: FontWeight.bold, 
              color: Colors.blue
            ),
          ),
          const SizedBox(height: 8),
          
          // Date Range Pickers
          Row(
            children: [
              // From
              Expanded(
                child: InkWell(
                  onTap: () => _selectDate(context, true),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF21262D) : Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: _dateFrom != null ? Colors.blue.withOpacity(0.5) : Colors.transparent
                      ),
                      boxShadow: [
                        BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 4),
                      ],
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          _dateFrom != null 
                              ? "${_dateFrom!.day}/${_dateFrom!.month}/${_dateFrom!.year}"
                              : 'Desde',
                          style: TextStyle(
                            color: _dateFrom != null ? (isDark ? Colors.white : Colors.black) : Colors.grey,
                          ),
                        ),
                        const Icon(Icons.calendar_today, size: 16, color: Colors.grey),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // To
              Expanded(
                child: InkWell(
                  onTap: () => _selectDate(context, false),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF21262D) : Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: _dateTo != null ? Colors.blue.withOpacity(0.5) : Colors.transparent
                      ),
                      boxShadow: [
                         BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 4),
                      ],
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          _dateTo != null 
                              ? "${_dateTo!.day}/${_dateTo!.month}/${_dateTo!.year}"
                              : 'Hasta',
                          style: TextStyle(
                            color: _dateTo != null ? (isDark ? Colors.white : Colors.black) : Colors.grey,
                          ),
                        ),
                        const Icon(Icons.calendar_today, size: 16, color: Colors.grey),
                      ],
                    ),
                  ),
                ),
              ),
              if (_dateFrom != null || _dateTo != null)
                IconButton(
                  icon: const Icon(Icons.clear, size: 18),
                  onPressed: () {
                    setState(() {
                      _dateFrom = null;
                      _dateTo = null;
                    });
                    _refreshData();
                  },
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSearchFilters(ThemeData theme, bool isDark) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Row(
        children: [
          // Client Search
          Expanded(
            flex: 3,
            child: Container(
              height: 48,
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF21262D) : Colors.white,
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 4),
                ],
              ),
              child: TextField(
                controller: _clientSearchController,
                decoration: const InputDecoration(
                  hintText: 'Cliente...',
                  prefixIcon: Icon(Icons.person_search, size: 20),
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                ),
                onChanged: (_) => _onSearchChanged(),
              ),
            ),
          ),
          const SizedBox(width: 8),
          // Factura Search
          Expanded(
            flex: 2,
            child: Container(
              height: 48,
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF21262D) : Colors.white,
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 4),
                ],
              ),
              child: TextField(
                controller: _facturaSearchController,
                keyboardType: TextInputType.text,
                decoration: const InputDecoration(
                  hintText: 'Factura #',
                  prefixIcon: Icon(Icons.numbers, size: 20),
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                ),
                onChanged: (_) => _onSearchChanged(),
              ),
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildSummary(ThemeData theme, bool isDark) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isDark
              ? [const Color(0xFF21262D), const Color(0xFF161B22)]
              : [Colors.white, const Color(0xFFF8FAFC)],
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildSummaryItem(
            icon: Icons.receipt,
            label: 'Facturas',
            value: '${_summary!.totalFacturas}',
            color: Colors.blue,
          ),
          Container(height: 40, width: 1, color: Colors.grey.withOpacity(0.3)),
          _buildSummaryItem(
            icon: Icons.euro,
            label: 'Total',
            value: '${_summary!.totalImporte.toStringAsFixed(2)}€',
            color: Colors.green,
          ),
          Container(height: 40, width: 1, color: Colors.grey.withOpacity(0.3)),
          _buildSummaryItem(
            icon: Icons.percent,
            label: 'IVA',
            value: '${_summary!.totalIva.toStringAsFixed(2)}€',
            color: Colors.orange,
          ),
        ],
      ),
    );
  }
  
  Widget _buildSummaryItem({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            fontSize: 11,
            color: Colors.grey[600],
          ),
        ),
      ],
    );
  }
  
  Widget _buildFacturaCard(Factura factura, ThemeData theme, bool isDark) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF21262D) : Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => _showFacturaDetail(factura),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                // Icon
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                  color: const Color(0xFF2D5A87).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    Icons.description,
                    color: Color(0xFF2D5A87),
                    size: 24,
                  ),
                ),
                const SizedBox(width: 12),
                // Info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        factura.numeroFormateado,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        factura.clienteNombre,
                        style: TextStyle(
                          color: Colors.grey[600],
                          fontSize: 13,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        factura.fecha,
                        style: TextStyle(
                          color: Colors.grey[500],
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                // Amount
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '${factura.total.toStringAsFixed(2)} €',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                        color: Color(0xFF059669),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.share, size: 20),
                      color: Colors.blue[600],
                      onPressed: () => _shareFacturaPdf(factura),
                      tooltip: 'Compartir PDF',
                      constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                      padding: EdgeInsets.zero,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Detail sheet for a factura
class _FacturaDetailSheet extends StatefulWidget {
  final Factura factura;
  final Function(Factura) onShare;

  const _FacturaDetailSheet({
    required this.factura,
    required this.onShare,
  });

  @override
  State<_FacturaDetailSheet> createState() => _FacturaDetailSheetState();
}

class _FacturaDetailSheetState extends State<_FacturaDetailSheet> {
  FacturaDetail? _detail;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    final detail = await FacturasService.getDetail(
      widget.factura.serie,
      widget.factura.numero,
      widget.factura.ejercicio,
    );
    if (mounted) {
      setState(() {
        _detail = detail;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    
    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      minChildSize: 0.5,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF161B22) : Colors.white,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            children: [
              // Handle
              Container(
                margin: const EdgeInsets.only(top: 12, bottom: 8),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey[400],
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              // Header
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [const Color(0xFF1E3A5F), const Color(0xFF2D5A87)],
                  ),
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.receipt_long, color: Colors.white, size: 32),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Factura ${widget.factura.numeroFormateado}',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          Text(
                            widget.factura.fecha,
                            style: TextStyle(color: Colors.white.withOpacity(0.8)),
                          ),
                        ],
                      ),
                    ),
                    Text(
                      '${widget.factura.total.toStringAsFixed(2)} €',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              // Content
              Expanded(
                child: _isLoading
                    ? const Center(child: CircularProgressIndicator())
                    : _detail == null
                        ? const Center(child: Text('Error cargando detalle'))
                        : ListView(
                            controller: scrollController,
                            padding: const EdgeInsets.all(16),
                            children: [
                              // Client info
                              _buildInfoCard(
                                title: 'Cliente',
                                children: [
                                  _buildInfoRow('Nombre', _detail!.header.clienteNombre),
                                  _buildInfoRow('NIF', _detail!.header.clienteNif),
                                  _buildInfoRow('Dirección', _detail!.header.clienteDireccion),
                                  _buildInfoRow('Población', _detail!.header.clientePoblacion),
                                ],
                                isDark: isDark,
                              ),
                              const SizedBox(height: 16),
                              // Lines
                              _buildInfoCard(
                                title: 'Líneas (${_detail!.lines.length})',
                                children: _detail!.lines.map((l) => Container(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: isDark ? Colors.black12 : Colors.grey[50],
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              l.descripcion,
                                              style: const TextStyle(fontWeight: FontWeight.w500),
                                            ),
                                            Text(
                                              '${l.cantidad} x ${l.precio.toStringAsFixed(2)} €',
                                              style: TextStyle(color: Colors.grey[600], fontSize: 13),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Text(
                                        '${l.importe.toStringAsFixed(2)} €',
                                        style: const TextStyle(fontWeight: FontWeight.bold),
                                      ),
                                    ],
                                  ),
                                )).toList(),
                                isDark: isDark,
                              ),
                              const SizedBox(height: 16),
                              // Totals
                              _buildInfoCard(
                                title: 'Totales',
                                children: [
                                  ..._detail!.header.bases.map((b) => 
                                    _buildInfoRow('Base ${b.pct.toStringAsFixed(0)}%', '${b.base.toStringAsFixed(2)} € + ${b.iva.toStringAsFixed(2)} € IVA'),
                                  ),
                                  const Divider(),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      const Text('TOTAL', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                                      Text(
                                        '${_detail!.header.total.toStringAsFixed(2)} €',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 20,
                                          color: Color(0xFF059669),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                                isDark: isDark,
                              ),
                              const SizedBox(height: 24),
                              // Actions
                              SizedBox(
                                width: double.infinity,
                                child: ElevatedButton.icon(
                                  onPressed: () {
                                    Navigator.pop(context);
                                    widget.onShare(widget.factura);
                                  },
                                  icon: const Icon(Icons.share),
                                  label: const Text('Compartir PDF (WhatsApp/Email)'),
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: const Color(0xFF2D5A87),
                                    foregroundColor: Colors.white,
                                    padding: const EdgeInsets.symmetric(vertical: 14),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildInfoCard({
    required String title,
    required List<Widget> children,
    required bool isDark,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF21262D) : Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 14,
              color: Color(0xFF2D5A87),
            ),
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    if (value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              label,
              style: TextStyle(color: Colors.grey[600], fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(fontSize: 14)),
          ),
        ],
      ),
    );
  }
}
