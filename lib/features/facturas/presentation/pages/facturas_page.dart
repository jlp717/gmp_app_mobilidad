/// Facturas Page
/// ==============
/// Invoice listing with filters, search and actions for commercial profile
/// Premium modern UI with smooth animations

import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:intl/intl.dart';

import '../../../../core/providers/auth_provider.dart';
import '../../../../core/widgets/optimized_list.dart';
import '../../../../core/widgets/shimmer_skeleton.dart';
import '../../../../core/providers/filter_provider.dart'; // Import FilterProvider
import '../../data/facturas_service.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';

class FacturasPage extends StatefulWidget {
  const FacturasPage({Key? key}) : super(key: key);

  @override
  State<FacturasPage> createState() => _FacturasPageState();
}

class _FacturasPageState extends State<FacturasPage> with SingleTickerProviderStateMixin {
  // Filters
  int? _selectedYear;
  int? _selectedMonth;
  DateTime? _dateFrom;
  DateTime? _dateTo;
  String _vendedorCodes = '';
  
  // Data
  List<int> _years = [];
  List<Factura> _facturas = [];
  FacturaSummary? _summary;
  bool _isLoading = true;
  String? _error;

  // Search Controllers (Debounce)
  final TextEditingController _clientSearchController = TextEditingController();
  final TextEditingController _facturaSearchController = TextEditingController();
  Timer? _debounceTimer;

  // Animation
  late AnimationController _fadeController;

  @override
  void initState() {
    super.initState();
    _fadeController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadInitialData();
    });
  }

  @override
  void dispose() {
    _clientSearchController.dispose();
    _facturaSearchController.dispose();
    _debounceTimer?.cancel();
    _fadeController.dispose();
    super.dispose();
  }

  String? _formatDateParam(DateTime? date) {
    if (date == null) return null;
    return DateFormat('yyyy-MM-dd').format(date);
  }

  void _onSearchChanged() {
    if (_debounceTimer?.isActive ?? false) _debounceTimer!.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 600), () {
      _refreshData();
    });
  }

  Future<void> _loadInitialData([bool showLoading = true]) async {
    try {
      if (showLoading) {
        setState(() => _isLoading = true);
      }

      final auth = Provider.of<AuthProvider>(context, listen: false);
      final user = auth.currentUser;
      
      if (user == null) throw Exception('No user logged in');

      // Handle "View As" logic
      final filter = Provider.of<FilterProvider>(context, listen: false);
      
      // Get codes from AuthProvider (List<String>) and join them
      String codes = auth.vendedorCodes.join(',');
      
      // Fallback if empty (shouldn't happen for valid commercial)
      if (codes.isEmpty && user.vendedorCode != null) {
        codes = user.vendedorCode!;
      }

      // SENIOR FIX: Reactive Vendor Selection
      // Always re-read the filter provider to ensure we have the latest selection
      if (user.role == 'director' || user.isJefeVentas) {
        final currentFilter = filter.selectedVendor;
        if (currentFilter != null && currentFilter.isNotEmpty) {
           codes = currentFilter;
        }
      }
      
      setState(() {
        _vendedorCodes = codes;
        if (_selectedYear == null) {
             _selectedYear = DateTime.now().year;
        }
      });

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
          clientSearch: _clientSearchController.text,
          docSearch: _facturaSearchController.text,
          dateFrom: _formatDateParam(_dateFrom),
          dateTo: _formatDateParam(_dateTo),
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

  // Wrapper for Vendor Selector to ensure loading state
  void _onVendorChanged() {
    _loadInitialData(true);
  }
  
  // ... (existing code)

  Future<void> _selectDate(BuildContext context, bool isFrom) async {
    // SENIOR FIX: Clamp date to prevent crash
    final initialDate = isFrom ? (_dateFrom ?? DateTime.now()) : (_dateTo ?? DateTime.now());
    final firstDate = DateTime(2015);
    final lastDate = DateTime(2030);
    
    DateTime clampedInitial = initialDate;
    if (initialDate.isBefore(firstDate)) clampedInitial = firstDate;
    if (initialDate.isAfter(lastDate)) clampedInitial = lastDate;

    final picked = await showDatePicker(
      context: context,
      initialDate: clampedInitial,
      firstDate: firstDate,
      lastDate: lastDate,
      locale: const Locale('es', 'ES'),
      builder: (context, child) {
        return Theme(
          data: ThemeData.dark().copyWith(
            colorScheme: const ColorScheme.dark(
              primary: AppTheme.neonBlue,
              onPrimary: Colors.white,
              surface: Color(0xFF1E2746),
              onSurface: Colors.white,
              secondary: AppTheme.neonBlue,
            ),
            dialogBackgroundColor: const Color(0xFF0F172A), // Lighter than pitch black
            textButtonTheme: TextButtonThemeData(
              style: TextButton.styleFrom(
                foregroundColor: AppTheme.neonBlue,
                textStyle: const TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      setState(() {
        if (isFrom) {
          _dateFrom = picked;
          if (_dateTo == null || _dateTo!.isBefore(picked)) {
            _dateTo = picked;
          }
        } else {
          _dateTo = picked;
        }
        _selectedMonth = null;
        _selectedYear = null; // Clear year when using date range
      });
      _refreshData();
    }
  }



  // ... (existing code)

  Widget _buildFacturaCard(Factura factura) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    // final isPaid = factura.estado.toLowerCase() == 'cobrada'; // Removed as property doesn't exist

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white, // Slighly lighter navy
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.2),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
        border: Border.all(
          color: isDark ? Colors.white.withOpacity(0.1) : Colors.grey.shade200,
        ),
      ),
      child: Stack(
        children: [
          // Color accent bar on the left
          Positioned(
            left: 0,
            top: 20,
            bottom: 20,
            child: Container(
              width: 4,
              decoration: BoxDecoration(
                color: AppTheme.neonBlue,
                borderRadius: const BorderRadius.only(
                  topRight: Radius.circular(4),
                  bottomRight: Radius.circular(4),
                ),
                boxShadow: [
                  BoxShadow(color: AppTheme.neonBlue.withOpacity(0.5), blurRadius: 4),
                ],
              ),
            ),
          ),
          Material(
            color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () {}, // Optional: Show details
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Icon Box
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: const Color(0xFF2D5A87).withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: const Color(0xFF2D5A87).withOpacity(0.3),
                        ),
                      ),
                      child: const Icon(
                        Icons.receipt_long,
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
                            factura.clienteNombre,
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                              color: isDark ? Colors.white : Colors.black87,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Text(
                                '${factura.numeroFormateado}',
                                style: TextStyle(
                                  color: isDark ? Colors.white70 : Colors.grey[700],
                                  fontWeight: FontWeight.w500,
                                  fontSize: 13,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                '•   ${factura.fecha}',
                                style: TextStyle(
                                  color: isDark ? Colors.white38 : Colors.grey[500],
                                  fontSize: 13,
                                ),
                              ),
                            ],
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
                          style: TextStyle(
                            fontWeight: FontWeight.w900,
                            fontSize: 18,
                            color: isDark ? AppTheme.neonGreen : const Color(0xFF2E7D32),
                            letterSpacing: 0.5,
                          ),
                        ),
                        if (factura.base > 0)
                          Text(
                            'Base: ${factura.base.toStringAsFixed(2)}€',
                            style: TextStyle(
                              fontSize: 10,
                              color: isDark ? Colors.white38 : Colors.grey[600],
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
                
                const SizedBox(height: 16),
                Divider(height: 1, color: isDark ? Colors.white10 : Colors.grey.shade100),
                const SizedBox(height: 12),
                
                // Actions
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    _buildActionButton(
                      icon: Icons.share_outlined,
                      label: 'Compartir',
                      onTap: () => _shareFacturaPdf(factura),
                      isPrimary: false,
                    ),
                    const SizedBox(width: 12),
                    _buildActionButton(
                      icon: Icons.download_outlined,
                      label: 'Descargar',
                      onTap: () => _downloadFactura(factura),
                      isPrimary: true,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    ],
  ),
);
}

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    required bool isPrimary,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isPrimary 
              ? const Color(0xFF2D5A87).withOpacity(0.1) 
              : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isPrimary 
                ? const Color(0xFF2D5A87).withOpacity(0.5) 
                : (isDark ? Colors.white24 : Colors.grey.shade300),
          ),
        ),
        child: Row(
          children: [
            Icon(
              icon, 
              size: 16, 
              color: isPrimary 
                  ? (isDark ? AppTheme.neonBlue : const Color(0xFF2D5A87)) 
                  : (isDark ? Colors.white70 : Colors.grey.shade700)
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: isPrimary 
                    ? (isDark ? AppTheme.neonBlue : const Color(0xFF2D5A87)) 
                    : (isDark ? Colors.white70 : Colors.grey.shade700),
              ),
            ),
          ],
        ),
      ),
    );
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
          clientSearch: _clientSearchController.text,
          docSearch: _facturaSearchController.text,
          dateFrom: _formatDateParam(_dateFrom),
          dateTo: _formatDateParam(_dateTo),
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



  Future<void> _downloadFactura(Factura factura) async {
    try {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Row(
            children: [
              SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
              SizedBox(width: 16),
              Text('Descargando factura...'),
            ],
          ),
          duration: Duration(seconds: 3),
        ),
      );
      
      final tempFile = await FacturasService.downloadFacturaPdf(
        factura.serie,
        factura.numero,
        factura.ejercicio,
      );
      
      if (!mounted) return;
      
      // Copy to Downloads folder
      final downloadsDir = Directory('/storage/emulated/0/Download');
      if (!await downloadsDir.exists()) {
        await downloadsDir.create(recursive: true);
      }
      
      final fileName = 'Factura_${factura.serie}_${factura.numero}_${factura.ejercicio}.pdf';
      final savedFile = await tempFile.copy('${downloadsDir.path}/$fileName');
      
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('✓ Guardado en Descargas: $fileName'),
          backgroundColor: Colors.green,
          duration: const Duration(seconds: 3),
          action: SnackBarAction(
            label: 'ABRIR',
            textColor: Colors.white,
            onPressed: () async {
              await Share.shareXFiles([XFile(savedFile.path)]);
            },
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
      );
    }
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
    
    return Column(
      children: [
        // Header (AppBar replacement)
        Container(
           padding: const EdgeInsets.all(16),
           decoration: BoxDecoration(
             color: AppTheme.surfaceColor,
             border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.05))),
             boxShadow: [
               BoxShadow(color: Colors.black12, blurRadius: 4, offset: const Offset(0, 2))
             ]
           ),
           child: Column(
             children: [
               Row(
                 mainAxisAlignment: MainAxisAlignment.spaceBetween,
                 children: [
                   Row(children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(color: Colors.teal.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                        child: const Icon(Icons.receipt_long_outlined, color: Colors.teal),
                      ),
                      const SizedBox(width: 12),
                      Text('Mis Facturas', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
                   ]),
                   // Explicit Refresh Button
                   IconButton(
                     icon: const Icon(Icons.refresh),
                     onPressed: _refreshData,
                     tooltip: 'Recargar datos',
                   )
                 ],
               ),
               if (auth.isDirector) ...[
                 const SizedBox(height: 12),
                 Container(
                   constraints: const BoxConstraints(minHeight: 50),
                   width: double.infinity,
                   child: GlobalVendorSelector(
                     isJefeVentas: true,
                     onChanged: _onVendorChanged,
                   ),
                 ),
               ]
             ],
           ),
        ),

        // Content
        Expanded(
          child: Column(
            children: [
              // Summary Cards
              _buildSummaryCards(),
              
              // Inputs & Filters
              _buildFilters(context),

              Expanded(
                child: _isLoading
                  // OPTIMIZATION: Use SkeletonList for perceived performance
                  ? const SkeletonList(itemCount: 8, itemHeight: 100)
                  : _error != null
                      ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
                      : _facturas.isEmpty
                          ? _buildEmptyState()
                          : RefreshIndicator(
                              onRefresh: _refreshData,
                              // OPTIMIZATION: Use OptimizedListView for smooth scrolling
                              child: OptimizedListView(
                                padding: const EdgeInsets.only(bottom: 80),
                                itemCount: _facturas.length,
                                itemBuilder: (context, index) {
                                  final factura = _facturas[index];
                                  return _buildFacturaCard(factura);
                                },
                              ),
                            ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSummaryCards() {
    if (_summary == null) return const SizedBox.shrink();
    
    return Container(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          _buildSummaryItem(
            icon: Icons.receipt_long,
            label: 'Facturas',
            value: '${_summary!.totalFacturas}',
            color: Colors.blue,
          ),
          const SizedBox(width: 8),
          _buildSummaryItem(
            icon: Icons.euro,
            label: 'Total',
            value: '${_summary!.totalImporte.toStringAsFixed(2)}€',
            color: Colors.green,
          ),
          const SizedBox(width: 8),
          _buildSummaryItem(
            icon: Icons.percent,
            label: 'Impuestos',
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF1E2746) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
          border: Border.all(
            color: isDark ? Colors.white10 : Colors.grey.shade100,
          ),
        ),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(height: 8),
            Text(
              value,
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  color: isDark ? Colors.white.withOpacity(0.9) : Colors.grey.shade700,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
                textAlign: TextAlign.center,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildFilters(BuildContext context) {
    // Replaced with improved date picker theme logic in _selectDate
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        children: [
          // Search Row
          Row(
            children: [
              Expanded(
                child: _buildSearchField(
                  controller: _clientSearchController,
                  hint: 'Buscar cliente...',
                  icon: Icons.person_search,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _buildSearchField(
                  controller: _facturaSearchController,
                  hint: 'Nº Factura...',
                  icon: Icons.receipt,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          
          // Month & Year Row
          Row(
            children: [
              Expanded(
                child: _buildDropdown<int>(
                  value: _selectedMonth,
                  items: [
                    const DropdownMenuItem<int>(
                      value: null,
                      child: Text('Todos los meses'),
                    ),
                    ...List.generate(12, (index) {
                      final monthName = DateFormat('MMMM', 'es_ES').format(DateTime(2024, index + 1));
                      final capitalized = monthName[0].toUpperCase() + monthName.substring(1);
                      return DropdownMenuItem<int>(
                        value: index + 1,
                        child: Text(capitalized),
                      );
                    }),
                  ],
                  onChanged: _onMonthChanged,
                  hint: 'Mes',
                  icon: Icons.calendar_month,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _buildDropdown<int>(
                  value: _selectedYear,
                  items: _years.map((y) => DropdownMenuItem(value: y, child: Text('$y'))).toList(),
                  onChanged: _onYearChanged,
                  hint: 'Año',
                  icon: Icons.calendar_today,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          
          // Date Range Row
          Row(
            children: [
              Expanded(
                child: _buildDateButton(
                  label: _dateFrom == null ? 'Desde' : DateFormat('dd/MM/yyyy').format(_dateFrom!),
                  onTap: () => _selectDate(context, true),
                  isActive: _dateFrom != null,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _buildDateButton(
                  label: _dateTo == null ? 'Hasta' : DateFormat('dd/MM/yyyy').format(_dateTo!),
                  onTap: () => _selectDate(context, false),
                  isActive: _dateTo != null,
                ),
              ),
              if (_dateFrom != null || _dateTo != null)
                IconButton(
                  icon: const Icon(Icons.clear, color: Colors.red),
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
          
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _buildDateButton({
    required String label,
    required VoidCallback onTap,
    required bool isActive,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
        decoration: BoxDecoration(
          color: isActive 
              ? const Color(0xFF2D5A87).withOpacity(0.1)
              : (isDark ? const Color(0xFF1E2746) : Colors.grey.shade100),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isActive 
                ? const Color(0xFF2D5A87) 
                : (isDark ? Colors.white10 : Colors.transparent),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.date_range, 
              size: 18, 
              color: isActive ? const Color(0xFF2D5A87) : Colors.grey,
            ),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(
                color: isActive ? const Color(0xFF2D5A87) : (isDark ? Colors.white : Colors.black87),
                fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchField({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E2746) : Colors.grey.shade100,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: isDark ? Colors.white10 : Colors.transparent),
      ),
      child: TextField(
        controller: controller,
        onChanged: (_) => _onSearchChanged(),
        style: TextStyle(color: isDark ? Colors.white : Colors.black87),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: TextStyle(color: isDark ? Colors.white38 : Colors.grey),
          prefixIcon: Icon(icon, color: Colors.grey, size: 20),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16),
        ),
      ),
    );
  }
  
  Widget _buildDropdown<T>({
    required T? value,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
    required String hint,
    required IconData icon,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      height: 48,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E2746) : Colors.grey.shade100,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: isDark ? Colors.white10 : Colors.transparent),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: value,
          items: items,
          onChanged: onChanged,
          hint: Row(
            children: [
              Icon(icon, size: 18, color: Colors.grey),
              const SizedBox(width: 8),
              Text(hint, style: TextStyle(color: isDark ? Colors.white38 : Colors.grey)),
            ],
          ),
          icon: const Icon(Icons.arrow_drop_down, color: Colors.grey),
          dropdownColor: isDark ? const Color(0xFF1E2746) : Colors.white,
          style: TextStyle(color: isDark ? Colors.white : Colors.black87),
          isExpanded: true,
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return const Center(
      child: Text('No hay facturas'),
    );
  }
}
