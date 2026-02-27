/// Facturas Page
/// ==============
/// Invoice listing with filters, search and actions for commercial profile
/// Premium modern UI with smooth animations

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';

import '../../../../core/providers/auth_provider.dart';
import '../../../../core/widgets/optimized_list.dart';
import '../../../../core/widgets/shimmer_skeleton.dart';
import '../../../../core/widgets/async_operation_modal.dart';
import '../../../../core/widgets/pdf_preview_screen.dart';
import '../../../../core/widgets/email_form_modal.dart';
import '../../../../core/widgets/whatsapp_form_modal.dart';
import '../../../../core/providers/filter_provider.dart';
import '../../data/facturas_service.dart';
import '../../../../core/widgets/global_vendor_selector.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/responsive.dart';

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

      debugPrint('[FACTURAS] Loading data. Codes: $codes. Year: $_selectedYear. DateFrom: $_dateFrom. DateTo: $_dateTo');

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
    // 1. Determine initial date
    final initialDate = isFrom 
        ? (_dateFrom ?? DateTime.now()) 
        : (_dateTo ?? DateTime.now());
    
    // 2. Safe clamping to prevent crashes with out-of-bounds dates
    final firstDate = DateTime(2020); // Restricted to reasonable business range
    final lastDate = DateTime(2030);
    
    DateTime clampedInitial = initialDate;
    if (clampedInitial.isBefore(firstDate)) clampedInitial = firstDate;
    if (clampedInitial.isAfter(lastDate)) clampedInitial = lastDate;

    // Show Date Picker with dark theme
    try {
      final picked = await showDatePicker(
        context: context,
        initialDate: clampedInitial,
        firstDate: firstDate,
        lastDate: lastDate,
        locale: const Locale('es', 'ES'),
      );
      
      if (picked != null) {
        debugPrint('[FACTURAS] Date picked: $picked. IsFrom: $isFrom');
        setState(() {
          if (isFrom) {
            _dateFrom = picked;
            if (_dateTo == null || _dateTo!.isBefore(picked)) {
               _dateTo = picked; 
            }
          } else {
            _dateTo = picked;
            if (_dateFrom == null || _dateFrom!.isAfter(picked)) {
               _dateFrom = picked; 
            }
          }
          
          _selectedMonth = null;
          _selectedYear = null; 
        });
        _refreshData();
      }
    } catch (e) {
      debugPrint('[FACTURAS] DatePicker Error: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error abriendo calendario: $e'), backgroundColor: Colors.red),
      );
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
                      width: 48, // Slightly larger
                      height: 48,
                      decoration: BoxDecoration(
                        color: const Color(0xFF2D5A87).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: const Color(0xFF2D5A87).withOpacity(0.5),
                        ),
                      ),
                      child: const Icon(
                        Icons.receipt_long_rounded, // Rounded
                        color: Color(0xFF1976D2), // Brighter blue
                        size: 26,
                      ),
                    ),
                    const SizedBox(width: 14),
                    
                    // Info
                    Expanded(
                      flex: 4, // Give more space to Client Name
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            factura.clienteNombre,
                            style: TextStyle(
                              fontWeight: FontWeight.w900, // MAX weight
                              fontSize: Responsive.isSmall(context) ? 16 : 19, 
                              color: isDark ? const Color(0xFF90CAF9) : const Color(0xFF0D47A1), // Lighter blue in dark mode, Deep blue in light
                              letterSpacing: 0.3,
                            ),
                            maxLines: 2, // Allow 2 lines for long names
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: isDark ? Colors.white.withOpacity(0.12) : Colors.grey.shade200,
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(color: isDark ? Colors.white24 : Colors.grey.shade400),
                                ),
                                child: Text(
                                  factura.numeroFormateado, // ALBARAN
                                  style: TextStyle(
                                    color: isDark ? Colors.white : Colors.black87,
                                    fontWeight: FontWeight.w900, // Heavy
                                    fontSize: Responsive.isSmall(context) ? 14 : 16,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Text(
                                factura.fecha,
                                style: TextStyle(
                                  color: isDark ? Colors.white70 : Colors.grey[800],
                                  fontSize: Responsive.isSmall(context) ? 12 : 14,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    
                    const SizedBox(width: 8),

                    // Amount (Right Aligned)
                    Expanded(
                      flex: 2,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Text(
                              '${factura.total.toStringAsFixed(2)} €',
                              style: TextStyle(
                                fontWeight: FontWeight.w900, 
                                fontSize: Responsive.isSmall(context) ? 18 : 22, 
                                color: isDark ? AppTheme.neonGreen : const Color(0xFF2E7D32), // Green
                              ),
                              textAlign: TextAlign.right,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                
                const SizedBox(height: 16),
                Divider(height: 1, color: isDark ? Colors.white10 : Colors.grey.shade100),
                const SizedBox(height: 12),
                
                // Actions
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      _buildActionButton(
                        icon: Icons.visibility,
                        label: 'Ver',
                        onTap: () => _previewFactura(factura),
                        isPrimary: false, 
                      ),
                      _buildActionButton(
                        icon: Icons.share_outlined,
                        label: 'Compartir',
                        onTap: () => _showShareOptions(context, factura),
                        isPrimary: false,
                      ),
                      const SizedBox(width: 8),
                      _buildActionButton(
                        icon: Icons.download_outlined,
                        label: 'Descargar',
                        onTap: () => _downloadFactura(factura),
                        isPrimary: true,
                      ),
                    ],
                  ),
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
      
      debugPrint('[FACTURAS] Refreshing. Codes: $codes. Year: $_selectedYear. Month: $_selectedMonth. Range: ${_formatDateParam(_dateFrom)} - ${_formatDateParam(_dateTo)}');
      
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
      
      debugPrint('[FACTURAS] Refresh complete. Found ${(results[0] as List).length} facturas.');
      
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



  // ============================================================================
  // PDF ACTIONS (with AsyncOperationModal + PdfPreviewScreen)
  // ============================================================================

  Future<void> _previewFactura(Factura factura) async {
    final modal = AsyncOperationModal.show(context, text: 'Cargando previsualización...');
    try {
      final bytes = await FacturasService.downloadFacturaPdfBytes(
        factura.serie, factura.numero, factura.ejercicio,
      );
      
      // FIX: Validate PDF buffer is not empty/corrupted before navigating to preview
      // A valid PDF is at minimum ~100 bytes (%PDF-1.x header + trailer)
      debugPrint('[FACTURAS] PDF bytes received: ${bytes.length}');
      if (bytes.length < 100) {
        modal.close();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: PDF vacío o corrupto (${bytes.length} bytes). Intenta de nuevo.'),
              backgroundColor: Colors.red),
        );
        return;
      }
      modal.close();

      if (!mounted) return;

      final pdfBytes = Uint8List.fromList(bytes);
      final fileName = 'Factura_${factura.serie}_${factura.numero}_${factura.ejercicio}.pdf';

      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => PdfPreviewScreen(
            pdfBytes: pdfBytes,
            title: 'Factura ${factura.numeroFormateado}',
            fileName: fileName,
            onEmailTap: () {
              Navigator.pop(context);
              _emailFactura(factura);
            },
            onWhatsAppTap: () {
              Navigator.pop(context);
              _whatsAppFactura(factura);
            },
          ),
        ),
      );
    } catch (e) {
      modal.error('Error al previsualizar: $e', onRetry: () => _previewFactura(factura));
    }
  }

  Future<void> _downloadFactura(Factura factura) async {
    final modal = AsyncOperationModal.show(context, text: 'Descargando factura...');
    try {
      final tempFile = await FacturasService.downloadFacturaPdf(
        factura.serie, factura.numero, factura.ejercicio,
      );

      final downloadsDir = Directory('/storage/emulated/0/Download');
      if (!await downloadsDir.exists()) {
        await downloadsDir.create(recursive: true);
      }

      final fileName = 'Factura_${factura.serie}_${factura.numero}_${factura.ejercicio}.pdf';
      final savedFile = await tempFile.copy('${downloadsDir.path}/$fileName');

      modal.success('✓ Guardado en Descargas: $fileName');
    } catch (e) {
      modal.error('Error al descargar: $e', onRetry: () => _downloadFactura(factura));
    }
  }

  Future<void> _shareFacturaPdf(Factura factura) async {
    final modal = AsyncOperationModal.show(context, text: 'Preparando PDF...');
    try {
      final file = await FacturasService.downloadFacturaPdf(
        factura.serie, factura.numero, factura.ejercicio,
      );
      modal.close();

      if (!mounted) return;

      final text = 'Adjunto: Factura ${factura.numeroFormateado} - '
          '${factura.total.toStringAsFixed(2)} € - Granja Mari Pepa';

      await Share.shareXFiles(
        [XFile(file.path)],
        text: text,
        subject: 'Factura ${factura.numeroFormateado} - Granja Mari Pepa',
      );
    } catch (e) {
      modal.error('Error al compartir: $e', onRetry: () => _shareFacturaPdf(factura));
    }
  }

  // ============================================================================
  // SHARE ACTIONS MODAL
  // ============================================================================

  void _showShareOptions(BuildContext context, Factura factura) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        decoration: BoxDecoration(
          color: AppTheme.darkSurface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border(top: BorderSide(color: Colors.white.withOpacity(0.1))),
        ),
        child: SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                margin: const EdgeInsets.symmetric(vertical: 12),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(bottom: 20),
                child: Text(
                  'Compartir Factura',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Color(0xFF25D366),
                  child: Icon(Icons.chat, color: Colors.white, size: 20),
                ),
                title: const Text('WhatsApp', style: TextStyle(color: Colors.white)),
                onTap: () {
                  Navigator.pop(context);
                  _whatsAppFactura(factura);
                },
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: AppTheme.neonBlue,
                  child: Icon(Icons.email_outlined, color: Colors.white, size: 20),
                ),
                title: const Text('Email', style: TextStyle(color: Colors.white)),
                onTap: () {
                  Navigator.pop(context);
                  _emailFactura(factura);
                },
              ),
              ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Colors.grey,
                  child: Icon(Icons.share_outlined, color: Colors.white, size: 20),
                ),
                title: const Text('Sistema', style: TextStyle(color: Colors.white)),
                onTap: () {
                  Navigator.pop(context);
                  _shareFacturaPdf(factura);
                },
              ),
              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _emailFactura(Factura factura) async {
    final result = await EmailFormModal.show(
      context,
      defaultSubject: 'Factura ${factura.numeroFormateado} - ${factura.clienteNombre}',
      defaultBody: 'Hola ${factura.clienteNombre},\n\n'
          'Adjunto le remitimos su factura ${factura.numeroFormateado} '
          'por importe de ${factura.total.toStringAsFixed(2)} €.\n\n'
          'Muchas gracias por su confianza.\n\n'
          'Atentamente,\n'
          'El equipo de Granja Mari Pepa',
    );

    if (result == null || !mounted) return;

    final modal = AsyncOperationModal.show(context, text: 'Enviando email...');
    try {
      await FacturasService.sendEmailServerSide(
        serie: factura.serie,
        numero: factura.numero,
        ejercicio: factura.ejercicio,
        destinatario: result.email,
        asunto: result.subject,
        cuerpo: result.body,
        clienteNombre: factura.clienteNombre,
      );
      modal.success('✓ Email enviado a ${result.email}');
    } catch (e) {
      modal.error('Error enviando email: $e', onRetry: () => _emailFactura(factura));
    }
  }

  Future<void> _whatsAppFactura(Factura factura) async {
    final result = await WhatsAppFormModal.show(
      context,
      defaultMessage: 'Hola ${factura.clienteNombre}, le adjunto su factura '
          '${factura.numeroFormateado} (${factura.total.toStringAsFixed(2)} €). 📄\n\n'
          'Gracias por su confianza - Granja Mari Pepa',
    );

    if (result == null || !mounted) return;

    final modal = AsyncOperationModal.show(context, text: 'Preparando PDF para WhatsApp...');
    try {
      final file = await FacturasService.downloadFacturaPdf(
        factura.serie, factura.numero, factura.ejercicio,
      );
      modal.close();

      if (!mounted) return;

      await Share.shareXFiles(
        [XFile(file.path)],
        text: result.message,
      );
    } catch (e) {
      modal.error('Error al compartir: $e', onRetry: () => _whatsAppFactura(factura));
    }
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
               if (auth.currentUser?.isJefeVentas ?? false) ...[
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
              if (!Responsive.isLandscapeCompact(context))
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
      child: LayoutBuilder(
        builder: (context, constraints) {
          // Responsive: 2 columns on very narrow screens, 3 on wider
          final columns = constraints.maxWidth < 400 ? 2 : 3;
          final itemWidth = (constraints.maxWidth - (columns - 1) * 8) / columns;
          return Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _buildSummaryItem(
                icon: Icons.receipt_long,
                label: 'Facturas',
                value: '${_summary!.totalFacturas}',
                color: Colors.blue,
                width: itemWidth,
              ),
              _buildSummaryItem(
                icon: Icons.euro,
                label: 'Total',
                value: '${_summary!.totalImporte.toStringAsFixed(0)}€',
                color: Colors.green,
                width: itemWidth,
              ),
              _buildSummaryItem(
                icon: Icons.percent,
                label: 'IVA',
                value: '${_summary!.totalIva.toStringAsFixed(0)}€',
                color: Colors.orange,
                width: itemWidth,
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildSummaryItem({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
    double? width,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final small = Responsive.isSmall(context);
    
    return Container(
      width: width,
      padding: EdgeInsets.symmetric(vertical: small ? 8 : 12, horizontal: 8),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E2746) : Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isDark ? Colors.white10 : Colors.grey.shade100,
        ),
      ),
      child: Column(
        children: [
          Container(
            padding: EdgeInsets.all(small ? 6 : 8),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: small ? 16 : 20),
          ),
          const SizedBox(height: 8),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: small ? 14 : 16,
              ),
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              label,
              style: TextStyle(
                color: isDark ? Colors.white.withOpacity(0.9) : Colors.grey.shade700,
                fontSize: small ? 10 : 12,
                fontWeight: FontWeight.w500,
              ),
              textAlign: TextAlign.center,
            ),
          ),
        ],
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

    // Responsive search field height
    final fieldH = Responsive.value(context, phone: 40, desktop: 48);
    return Container(
      height: fieldH,
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

    // Responsive dropdown height
    return Container(
      height: Responsive.value(context, phone: 40, desktop: 48),
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
    final hasFilters = _selectedMonth != null ||
                       _dateFrom != null ||
                       _dateTo != null ||
                       _clientSearchController.text.isNotEmpty ||
                       _facturaSearchController.text.isNotEmpty;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              hasFilters ? Icons.search_off_rounded : Icons.receipt_long_outlined,
              size: 56,
              color: Colors.white24,
            ),
            const SizedBox(height: 16),
            Text(
              hasFilters
                  ? 'No se han encontrado facturas para los filtros seleccionados'
                  : 'No hay facturas disponibles',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white54,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              hasFilters
                  ? 'Prueba a seleccionar otro comercial, ampliar el rango de fechas o modificar la búsqueda.'
                  : 'Las facturas aparecerán aquí cuando estén disponibles.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white38, fontSize: 13),
            ),
            if (hasFilters) ...[
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: () {
                  setState(() {
                    _selectedMonth = null;
                    _dateFrom = null;
                    _dateTo = null;
                    _clientSearchController.clear();
                    _facturaSearchController.clear();
                  });
                  _refreshData();
                },
                icon: const Icon(Icons.filter_alt_off, size: 18),
                label: const Text('Limpiar filtros'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white54,
                  side: const BorderSide(color: Colors.white24),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
