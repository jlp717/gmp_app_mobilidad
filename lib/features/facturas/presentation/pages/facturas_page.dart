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

  Future<void> _loadInitialData() async {
    try {
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

      if (user.role == 'director' && filter.selectedVendor != null) {
        codes = filter.selectedVendor!;
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

  Future<void> _selectDate(BuildContext context, bool isFrom) async {
    final initialDate = isFrom ? (_dateFrom ?? DateTime.now()) : (_dateTo ?? DateTime.now());

    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
      locale: const Locale('es', 'ES'),
      builder: (context, child) {
        // Force Light Theme for maximum readability per user request
        return Theme(
          data: ThemeData.light().copyWith(
            primaryColor: const Color(0xFF1565C0), // Professional Blue
            colorScheme: const ColorScheme.light(
              primary: Color(0xFF1565C0), // Header background
              onPrimary: Colors.white, // Header text
              surface: Colors.white, // Dialog background
              onSurface: Colors.black, // Body text
            ),
            dialogBackgroundColor: Colors.white,
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
      });
      _refreshData();
    }
  }

  Future<void> _downloadFactura(Factura factura) async {
    try {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Descargando factura...'), duration: Duration(seconds: 1)),
      );
      
      final file = await FacturasService.downloadFacturaPdf(
        factura.serie,
        factura.numero,
        factura.ejercicio,
      );
      
      if (!mounted) return;
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      
      await Share.shareXFiles([XFile(file.path)], text: 'Factura ${factura.numeroFormateado}');
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error descargando PDF: $e'), backgroundColor: Colors.red),
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
    
    // Modern Gradient Background for Header
    final headerGradient = LinearGradient(
      colors: isDark 
          ? [const Color(0xFF1A1F3A), const Color(0xFF252B48)] 
          : [const Color(0xFF1565C0), const Color(0xFF1976D2)],
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
    );

    return Column(
      children: [
        // 1. Vibrant Header Section
        Container(
          padding: const EdgeInsets.only(top: 16, left: 16, right: 16, bottom: 24),
          decoration: BoxDecoration(
            gradient: headerGradient,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 8,
                offset: const Offset(0, 4),
              )
            ],
            borderRadius: const BorderRadius.only(
              bottomLeft: Radius.circular(24),
              bottomRight: Radius.circular(24),
            ),
          ),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Icon(Icons.receipt_long, color: Colors.white, size: 24),
                      ),
                      const SizedBox(width: 14),
                      const Text(
                        'Mis Facturas',
                        style: TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              if (auth.isDirector) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: GlobalVendorSelector(
                    isJefeVentas: true,
                    onChanged: _loadInitialData,
                  ),
                ),
              ]
            ],
          ),
        ),

        // 2. Content Body
        Expanded(
          child: Container(
            color: isDark ? const Color(0xFF0A0E27) : const Color(0xFFF5F7FA), // Clean Background
            child: Column(
              children: [
                // Summary Cards (Overlapping effect could be cool, but let's keep it simple first)
                Transform.translate(
                  offset: const Offset(0, -20), // Slight overlap with header
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: _buildSummaryCards(),
                  ),
                ),
                
                // Filters
                _buildFilters(context),

                // List
                Expanded(
                  child: _isLoading
                    ? const Center(child: CircularProgressIndicator())
                    : _error != null
                        ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
                        : _facturas.isEmpty
                            ? _buildEmptyState()
                            : RefreshIndicator(
                                onRefresh: _refreshData,
                                child: ListView.separated(
                                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 80),
                                  itemCount: _facturas.length,
                                  separatorBuilder: (ctx, i) => const SizedBox(height: 12),
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
        ),
      ],
    );
  }

  Widget _buildSummaryCards() {
    if (_summary == null) return const SizedBox.shrink();
    
    return Row(
      children: [
        _buildSummaryCard(
          title: 'Total',
          value: '${_summary!.totalImporte.toStringAsFixed(2)}€',
          icon: Icons.euro,
          gradient: const LinearGradient(colors: [Color(0xFF43A047), Color(0xFF66BB6A)]), // Green
        ),
        const SizedBox(width: 12),
        _buildSummaryCard(
          title: 'Facturas',
          value: '${_summary!.totalFacturas}',
          icon: Icons.receipt,
          gradient: const LinearGradient(colors: [Color(0xFF1976D2), Color(0xFF42A5F5)]), // Blue
        ),
      ],
    );
  }

  Widget _buildSummaryCard({
    required String title,
    required String value,
    required IconData icon,
    required Gradient gradient,
  }) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: gradient,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.15),
              blurRadius: 8,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Icon(icon, color: Colors.white.withOpacity(0.9), size: 24),
                Text(
                  title,
                  style: const TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.bold,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFilters(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _buildSearchField(
                  controller: _clientSearchController,
                  hint: 'Buscar cliente...',
                  icon: Icons.person_search_outlined,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildSearchField(
                  controller: _facturaSearchController,
                  hint: 'Nº Factura',
                  icon: Icons.numbers,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          
          // Date Controls
          Row(
            children: [
               // Month Dropdown (Mini)
               Expanded(
                 flex: 2,
                 child: Container(
                    height: 45,
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF1E2746) : Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.grey.withOpacity(0.3)),
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<int>(
                        value: _selectedMonth,
                        isExpanded: true,
                        hint: Text('Mes', style: TextStyle(color: isDark ? Colors.white70 : Colors.grey[600])),
                        icon: const Icon(Icons.calendar_view_month, size: 20),
                        items: [
                          const DropdownMenuItem<int>(value: null, child: Text('Todos')),
                           ...List.generate(12, (index) {
                            final monthName = DateFormat('MMM', 'es_ES').format(DateTime(2024, index + 1));
                            return DropdownMenuItem<int>(
                              value: index + 1,
                              child: Text(monthName.toUpperCase()),
                            );
                          }),
                        ],
                        onChanged: _onMonthChanged,
                      ),
                    ),
                 ),
               ),
               const SizedBox(width: 8),
               // Year
               Expanded(
                 flex: 2,
                 child: Container(
                    height: 45,
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF1E2746) : Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.grey.withOpacity(0.3)),
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<int>(
                         value: _selectedYear,
                         isExpanded: true,
                         hint: const Text('Año'),
                         icon: const Icon(Icons.calendar_today, size: 20),
                         items: _years.map((y) => DropdownMenuItem(value: y, child: Text('$y'))).toList(),
                         onChanged: _onYearChanged,
                      ),
                    ),
                 ),
               ),
               const SizedBox(width: 8),
               // Date Range Button (Combined)
               Expanded(
                 flex: 3,
                 child: InkWell(
                   onTap: () => _showDateRangePicker(context), // New method
                   borderRadius: BorderRadius.circular(12),
                   child: Container(
                     height: 45,
                     decoration: BoxDecoration(
                        color: (_dateFrom != null || _dateTo != null) 
                            ? AppTheme.neonBlue.withOpacity(0.1) 
                            : (isDark ? const Color(0xFF1E2746) : Colors.white),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: (_dateFrom != null || _dateTo != null) 
                             ? AppTheme.neonBlue 
                             : Colors.grey.withOpacity(0.3)
                        ),
                     ),
                     child: Center(
                       child: Row(
                         mainAxisAlignment: MainAxisAlignment.center,
                         children: [
                           Icon(Icons.date_range, 
                             size: 18, 
                             color: (_dateFrom != null || _dateTo != null) ? AppTheme.neonBlue : Colors.grey
                           ),
                           const SizedBox(width: 4),
                           Text(
                             (_dateFrom != null) ? 'Filtrado' : 'Fechas',
                             style: TextStyle(
                               fontWeight: FontWeight.w600,
                               color: (_dateFrom != null || _dateTo != null) ? AppTheme.neonBlue : Colors.grey[700]
                             ),
                           ),
                         ],
                       ),
                     ),
                   ),
                 ),
               ),
            ],
          ),
        ],
      ),
    );
  }
  
  // Replaces separate date buttons
  Future<void> _showDateRangePicker(BuildContext context) async {
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(2020),
        lastDate: DateTime(2030),
        initialDateRange: (_dateFrom != null && _dateTo != null) ? DateTimeRange(start: _dateFrom!, end: _dateTo!) : null,
        locale: const Locale('es', 'ES'),
        builder: (context, child) {
          return Theme(
            data: ThemeData.light().copyWith(
              primaryColor: const Color(0xFF1565C0),
              colorScheme: const ColorScheme.light(
                primary: Color(0xFF1565C0),
                onPrimary: Colors.white,
                surface: Colors.white,
                onSurface: Colors.black,
              ),
              dialogBackgroundColor: Colors.white,
            ),
            child: child!,
          );
        },
      );
      
      if (picked != null) {
        setState(() {
          _dateFrom = picked.start;
          _dateTo = picked.end;
          _selectedMonth = null;
        });
        _refreshData();
      }
  }

  Widget _buildSearchField({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Container(
      height: 45,
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E2746) : Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.withOpacity(0.3)), // Subtle border
        boxShadow: [
          if (!isDark)
            BoxShadow(
              color: Colors.grey.withOpacity(0.1),
              blurRadius: 4,
              offset: const Offset(0, 2),
            ),
        ],
      ),
      child: TextField(
        controller: controller,
        onChanged: (_) => _onSearchChanged(),
        textAlignVertical: TextAlignVertical.center,
        style: TextStyle(color: isDark ? Colors.white : Colors.black87),
        decoration: InputDecoration(
          isDense: true,
          hintText: hint,
          hintStyle: TextStyle(color: Colors.grey[500], fontSize: 14),
          prefixIcon: Icon(icon, color: Colors.grey[600], size: 20),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 10),
        ),
      ),
    );
  }

  Widget _buildFacturaCard(Factura factura) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    // Status Logic for Color accent
    // Assuming if total > 200, it's 'High Value' or pending check (since we don't have explicit status yet)
    // For now, let's use a nice accent color based on index or hash, or static blue
    final accentColor = const Color(0xFF1976D2); // Professional Blue

    return Container(
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E2746) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isDark ? Colors.white10 : Colors.grey.shade200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 8,
            offset: const Offset(0, 2),
            spreadRadius: 1,
          ),
        ],
      ),
      child: Column(
        children: [
          // Card Header with Color Strip
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: accentColor.withOpacity(0.05),
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
              border: Border(bottom: BorderSide(color: accentColor.withOpacity(0.1))),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.insert_drive_file_outlined, size: 18, color: accentColor),
                    const SizedBox(width: 8),
                    Text(
                      factura.numeroFormateado,
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: accentColor,
                        fontSize: 15,
                      ),
                    ),
                  ],
                ),
                Text(
                  DateFormat('dd MMM yyyy', 'es_ES').format(DateTime.parse(factura.fecha)),
                  style: TextStyle(
                    color: isDark ? Colors.white60 : Colors.grey[700],
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          
          // Card Body
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                 // Client Info
                 Expanded(
                   child: Column(
                     crossAxisAlignment: CrossAxisAlignment.start,
                     children: [
                       Text(
                         factura.clienteNombre,
                         style: TextStyle(
                           fontWeight: FontWeight.bold,
                           fontSize: 16,
                           color: isDark ? Colors.white : const Color(0xFF2C3E50),
                         ),
                         maxLines: 2,
                         overflow: TextOverflow.ellipsis,
                       ),
                       const SizedBox(height: 4),
                       Row(
                         children: [
                           Icon(Icons.store, size: 14, color: Colors.grey[500]),
                           const SizedBox(width: 4),
                           Text(
                             'Cliente: ${factura.clienteId}',
                             style: TextStyle(color: Colors.grey[500], fontSize: 13),
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
                         fontSize: 20,
                         color: isDark ? Colors.white : const Color(0xFF263238),
                       ),
                     ),
                     Text(
                       'Importe Total',
                       style: TextStyle(color: Colors.grey[500], fontSize: 11),
                     ),
                   ],
                 ),
              ],
            ),
          ),
          
          // Actions Footer
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _downloadFactura(factura),
                    icon: const Icon(Icons.download_rounded, size: 18),
                    label: const Text('Descargar'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: isDark ? Colors.white70 : Colors.grey[800],
                      side: BorderSide(color: Colors.grey.withOpacity(0.3)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () => _shareFacturaPdf(factura),
                    icon: const Icon(Icons.share, size: 18),
                    label: const Text('Compartir'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: accentColor,
                      foregroundColor: Colors.white,
                      elevation: 2,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return const Center(
      child: Text('No hay facturas'),
    );
  }
}
