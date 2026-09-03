/// Facturas Page
/// ==============
/// Invoice listing with filters, search and actions for commercial profile
/// Premium modern UI with smooth animations
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/utils/vendor_scope.dart';
import 'package:gmp_app_mobilidad/core/widgets/async_operation_modal.dart';
import 'package:gmp_app_mobilidad/core/widgets/email_form_modal.dart';
import 'package:gmp_app_mobilidad/core/widgets/global_vendor_selector.dart';
import 'package:gmp_app_mobilidad/core/widgets/optimized_list.dart';
import 'package:gmp_app_mobilidad/core/widgets/pdf_preview_screen.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';
import 'package:gmp_app_mobilidad/core/widgets/whatsapp_form_modal.dart';
import 'package:gmp_app_mobilidad/features/facturas/data/facturas_service.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

class FacturasPage extends ConsumerStatefulWidget {
  const FacturasPage({
    super.key,
    this.employeeCode,
    this.forceShowVendorSelector = false,
  });
  final String? employeeCode;
  final bool forceShowVendorSelector;

  @override
  ConsumerState<FacturasPage> createState() => _FacturasPageState();
}

class _FacturasPageState extends ConsumerState<FacturasPage>
    with SingleTickerProviderStateMixin {
  // Filters
  int? _selectedYear;
  int? _selectedMonth;
  FacturaDocumentType? _selectedDocumentType;
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
  final TextEditingController _facturaSearchController =
      TextEditingController();
  Timer? _debounceTimer;

  // Animation
  late AnimationController _fadeController;
  bool _isInitialized = false;
  ProviderSubscription<String?>? _vendorSubscription;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _fadeController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _isInitialized = true;
      _loadInitialData();
    });

    _vendorSubscription =
        ref.listenManual<String?>(selectedVendorProvider, (previous, next) {
      if (_isInitialized && previous != next) {
        _loadInitialData(false);
      }
    });
  }

  @override
  void dispose() {
    _vendorSubscription?.close();
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

  String _formatMoney(double value, {int decimals = 2}) {
    return '${value.toStringAsFixed(decimals)} \u20ac';
  }

  void _onSearchChanged() {
    if (_debounceTimer?.isActive ?? false) _debounceTimer!.cancel();
    _debounceTimer = Timer(
      const Duration(milliseconds: 250),
      _refreshData,
    );
  }

  Future<void> _loadInitialData([
    bool showLoading = true,
    bool forceRefresh = false,
  ]) async {
    final generation = ++_loadGeneration;
    try {
      if (showLoading) {
        setState(() => _isLoading = true);
      }

      final authState =
          ProviderScope.containerOf(context).read(authProvider).value;
      final user = authState?.user;

      if (user == null) throw Exception('No user logged in');

      // Handle "View As" logic
      final selectedVendor = ref.read(selectedVendorProvider);

      // Get codes from AuthState (List<String>) and join them
      var codes = authState!.vendedorCodes.join(',');

      // Fallback if empty (shouldn't happen for valid commercial)
      if (codes.isEmpty && user.vendedorCode != null) {
        codes = user.vendedorCode!;
      }

      // SENIOR FIX: Reactive Vendor Selection
      // Always re-read the filter provider to ensure we have the latest selection
      if (hasScopedVendorAccess(
        userCode: user.code,
        vendorCodes: authState.vendedorCodes,
      )) {
        codes = resolveScopedVendorCodes(
          userCode: user.code,
          authVendorCodes: authState.vendedorCodes,
          selectedVendor: selectedVendor,
          fallbackVendorCodes: widget.employeeCode ?? codes,
        );
      } else if (user.role == 'director' || user.isJefeVentas) {
        if (selectedVendor != null && selectedVendor.isNotEmpty) {
          codes = selectedVendor;
        }
      }

      setState(() {
        _vendedorCodes = codes;
        _selectedYear ??= DateTime.now().year;
      });

      debugPrint(
        '[FACTURAS] Loading data. Codes: $codes. Year: $_selectedYear. DateFrom: $_dateFrom. DateTo: $_dateTo',
      );

      final results = await Future.wait([
        FacturasService.getAvailableYears(
          codes,
          forceRefresh: forceRefresh,
        ),
        FacturasService.getFacturas(
          vendedorCodes: codes,
          year: _selectedYear,
          month: _selectedMonth,
          clientSearch: _clientSearchController.text.trim(),
          docSearch: _facturaSearchController.text.trim(),
          documentType: _selectedDocumentType,
          dateFrom: _formatDateParam(_dateFrom),
          dateTo: _formatDateParam(_dateTo),
          forceRefresh: forceRefresh,
        ),
        FacturasService.getSummary(
          vendedorCodes: codes,
          year: _selectedYear,
          month: _selectedMonth,
          clientSearch: _clientSearchController.text.trim(),
          docSearch: _facturaSearchController.text.trim(),
          documentType: _selectedDocumentType,
          dateFrom: _formatDateParam(_dateFrom),
          dateTo: _formatDateParam(_dateTo),
          forceRefresh: forceRefresh,
        ),
      ]);

      if (!mounted || generation != _loadGeneration) return;

      setState(() {
        _years = results[0]! as List<int>;
        _facturas = results[1]! as List<Factura>;
        _summary = results[2] as FacturaSummary?;
        _error = null;
        _isLoading = false;
      });

      unawaited(_fadeController.forward());
    } catch (e) {
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _error =
            'No se pudieron cargar los documentos. Comprueba la conexión e inténtalo de nuevo.';
        _isLoading = false;
      });
    }
  }

  // Wrapper for Vendor Selector to ensure loading state
  void _onVendorChanged() {
    _loadInitialData();
  }

  // ... (existing code)

  Future<void> _selectDate(BuildContext context, bool isFrom) async {
    // 1. Determine initial date
    final initialDate =
        isFrom ? (_dateFrom ?? DateTime.now()) : (_dateTo ?? DateTime.now());

    // 2. Safe clamping to prevent crashes with out-of-bounds dates
    final firstDate = DateTime(2020); // Restricted to reasonable business range
    final lastDate = DateTime(2030);

    var clampedInitial = initialDate;
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
        // Debounce date selection to prevent rapid API calls
        _onSearchChanged();
      }
    } catch (e) {
      debugPrint('[FACTURAS] DatePicker Error: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Error abriendo calendario: $e'),
          backgroundColor: AppTheme.error,
        ),
      );
    }
  }

  // ... (existing code)

  Widget _buildFacturaCard(Factura factura) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final documentColor = factura.isAlbaran ? AppTheme.warning : AppTheme.info;
    final documentIcon =
        factura.isAlbaran ? Icons.article_outlined : Icons.receipt_long_rounded;
    // final isPaid = factura.estado.toLowerCase() == 'cobrada'; // Removed as property doesn't exist

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        gradient: isDark
            ? LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppTheme.raisedSurface,
                  AppTheme.softPanel.withValues(alpha: 0.92),
                  documentColor.withValues(alpha: 0.045),
                ],
              )
            : null,
        color: isDark ? null : AppColors.themedWhite,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: AppColors.systemBlack.withValues(alpha: 0.2),
            blurRadius: 16,
            offset: const Offset(0, 7),
          ),
          BoxShadow(
            color: documentColor.withValues(alpha: 0.06),
            blurRadius: 18,
          ),
        ],
        border: Border.all(
          color: isDark
              ? documentColor.withValues(alpha: 0.22)
              : AppColors.systemGrey200,
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
                color: documentColor,
                borderRadius: const BorderRadius.only(
                  topRight: Radius.circular(4),
                  bottomRight: Radius.circular(4),
                ),
                boxShadow: [
                  BoxShadow(
                    color: documentColor.withValues(alpha: 0.5),
                    blurRadius: 4,
                  ),
                ],
              ),
            ),
          ),
          Material(
            color: AppColors.transparent,
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
                            color: documentColor.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: documentColor.withValues(alpha: 0.5),
                            ),
                          ),
                          child: Icon(
                            documentIcon,
                            color: documentColor,
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
                                factura.nombreComercial ??
                                    factura.clienteNombre,
                                style: TextStyle(
                                  fontWeight: FontWeight.w900,
                                  fontSize:
                                      Responsive.isSmall(context) ? 16 : 19,
                                  color: documentColor,
                                  letterSpacing: 0,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              if (factura.nombreFiscal != null &&
                                  factura.nombreFiscal!.isNotEmpty &&
                                  factura.nombreFiscal!.toUpperCase() !=
                                      (factura.nombreComercial ??
                                              factura.clienteNombre)
                                          .toUpperCase())
                                Padding(
                                  padding: const EdgeInsets.only(top: 2),
                                  child: Text(
                                    factura.nombreFiscal!,
                                    style: TextStyle(
                                      fontWeight: FontWeight.w400,
                                      fontSize: 11,
                                      color: isDark
                                          ? AppColors.systemGrey400
                                          : AppColors.systemGrey600,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              const SizedBox(height: 6),
                              Wrap(
                                crossAxisAlignment: WrapCrossAlignment.center,
                                spacing: 8,
                                runSpacing: 6,
                                children: [
                                  _buildDocumentTypeChip(
                                    factura: factura,
                                    color: documentColor,
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 10,
                                      vertical: 4,
                                    ),
                                    decoration: BoxDecoration(
                                      color: isDark
                                          ? AppColors.themedWhite
                                              .withValues(alpha: 0.12)
                                          : AppColors.systemGrey200,
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(
                                        color: isDark
                                            ? AppColors.themedWhite24
                                            : AppColors.systemGrey400,
                                      ),
                                    ),
                                    child: Text(
                                      factura.numeroFormateado, // ALBARAN
                                      style: TextStyle(
                                        color: isDark
                                            ? AppColors.themedWhite
                                            : AppColors.systemBlack87,
                                        fontWeight: FontWeight.w900, // Heavy
                                        fontSize: Responsive.isSmall(context)
                                            ? 14
                                            : 16,
                                      ),
                                    ),
                                  ),
                                  Text(
                                    factura.fecha,
                                    style: TextStyle(
                                      color: isDark
                                          ? AppColors.themedWhite70
                                          : AppColors.systemGrey800,
                                      fontSize:
                                          Responsive.isSmall(context) ? 12 : 14,
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
                                    fontSize:
                                        Responsive.isSmall(context) ? 18 : 22,
                                    color: isDark
                                        ? AppTheme.success
                                        : AppTheme.success, // Green
                                  ),
                                  textAlign: TextAlign.right,
                                ),
                              ),
                              const SizedBox(height: 4),
                              _buildAmountBreakdown(
                                label: 'Base',
                                value: factura.base,
                                isDark: isDark,
                              ),
                              _buildAmountBreakdown(
                                label: 'IVA',
                                value: factura.iva,
                                isDark: isDark,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 16),
                    Divider(
                      height: 1,
                      color: isDark
                          ? AppColors.themedWhite10
                          : AppColors.systemGrey100,
                    ),
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

  Widget _buildAmountBreakdown({
    required String label,
    required double value,
    required bool isDark,
  }) {
    return FittedBox(
      fit: BoxFit.scaleDown,
      alignment: Alignment.centerRight,
      child: Text(
        '$label ${_formatMoney(value)}',
        style: TextStyle(
          color: isDark ? AppColors.themedWhite60 : AppColors.systemGrey700,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
        textAlign: TextAlign.right,
      ),
    );
  }

  Widget _buildDocumentTypeChip({
    required Factura factura,
    required Color color,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: isDark ? 0.18 : 0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        factura.tipoLabel.toUpperCase(),
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w900,
          letterSpacing: 0,
        ),
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
              ? AppTheme.info.withValues(alpha: 0.1)
              : AppColors.transparent,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isPrimary
                ? AppTheme.info.withValues(alpha: 0.5)
                : (isDark ? AppColors.themedWhite24 : AppColors.systemGrey300),
          ),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              size: 16,
              color: isPrimary
                  ? (isDark ? AppTheme.info : AppTheme.info)
                  : (isDark
                      ? AppColors.themedWhite70
                      : AppColors.systemGrey700),
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: isPrimary
                    ? (isDark ? AppTheme.info : AppTheme.info)
                    : (isDark
                        ? AppColors.themedWhite70
                        : AppColors.systemGrey700),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _refreshData({bool forceRefresh = false}) async {
    if (!mounted) return;
    // Prevent redundant calls if already loading
    if (_isLoading) return;

    try {
      final generation = ++_loadGeneration;
      final codes = _vendedorCodes;
      final clientSearch = _clientSearchController.text.trim();
      final docSearch = _facturaSearchController.text.trim();

      debugPrint(
        '[FACTURAS] Refreshing. Codes: $codes. Year: $_selectedYear. Month: $_selectedMonth. Range: ${_formatDateParam(_dateFrom)} - ${_formatDateParam(_dateTo)}',
      );

      final results = await Future.wait([
        FacturasService.getFacturas(
          vendedorCodes: codes,
          year: _selectedYear,
          month: _selectedMonth,
          clientSearch: clientSearch,
          docSearch: docSearch,
          documentType: _selectedDocumentType,
          dateFrom: _formatDateParam(_dateFrom),
          dateTo: _formatDateParam(_dateTo),
          forceRefresh: forceRefresh,
        ),
        FacturasService.getSummary(
          vendedorCodes: codes,
          year: _selectedYear,
          month: _selectedMonth,
          clientSearch: clientSearch,
          docSearch: docSearch,
          documentType: _selectedDocumentType,
          dateFrom: _formatDateParam(_dateFrom),
          dateTo: _formatDateParam(_dateTo),
          forceRefresh: forceRefresh,
        ),
      ]);

      debugPrint(
        '[FACTURAS] Refresh complete. Found ${(results[0]! as List).length} documentos.',
      );

      if (!mounted || generation != _loadGeneration) return;

      setState(() {
        _facturas = results[0]! as List<Factura>;
        _summary = results[1] as FacturaSummary?;
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e'), backgroundColor: AppTheme.error),
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
      // Debounce year change to prevent rapid API calls
      _onSearchChanged();
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
      // Debounce month change to prevent rapid API calls
      _onSearchChanged();
    }
  }

  void _onDocumentTypeChanged(FacturaDocumentType? type) {
    if (type != _selectedDocumentType) {
      setState(() => _selectedDocumentType = type);
      _onSearchChanged();
    }
  }

  // ============================================================================
  // PDF ACTIONS (with AsyncOperationModal + PdfPreviewScreen)
  // ============================================================================

  Future<void> _previewFactura(Factura factura) async {
    final modal =
        AsyncOperationModal.show(context, text: 'Cargando previsualización...');
    try {
      final bytes = await FacturasService.downloadDocumentoPdfBytes(factura);

      // FIX: Validate PDF buffer is not empty/corrupted before navigating to preview
      // A valid PDF is at minimum ~100 bytes (%PDF-1.x header + trailer)
      debugPrint('[FACTURAS] PDF bytes received: ${bytes.length}');
      if (bytes.length < 100) {
        modal.close();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Error: PDF vacío o corrupto (${bytes.length} bytes). Intenta de nuevo.',
            ),
            backgroundColor: AppTheme.error,
          ),
        );
        return;
      }
      modal.close();

      if (!mounted) return;

      final pdfBytes = Uint8List.fromList(bytes);
      final fileName =
          '${factura.pdfFilePrefix}_${factura.serie}_${factura.numero}_${factura.ejercicio}.pdf';

      unawaited(
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PdfPreviewScreen(
              pdfBytes: pdfBytes,
              title: '${factura.tipoLabel} ${factura.numeroFormateado}',
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
        ),
      );
    } catch (e) {
      modal.error(
        'Error al previsualizar: $e',
        onRetry: () => _previewFactura(factura),
      );
    }
  }

  Future<void> _downloadFactura(Factura factura) async {
    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando ${factura.tipoLabel.toLowerCase()}...',
    );
    try {
      final file = await FacturasService.downloadDocumentoPdf(factura);

      modal.close();
      if (!mounted) return;

      final result = await OpenFilex.open(file.path);
      if (result.type != ResultType.done && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('No se pudo abrir el PDF: ${result.message}'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        modal.error(
          'Error al descargar: $e',
          onRetry: () => _downloadFactura(factura),
        );
      }
    }
  }

  Future<void> _shareFacturaPdf(Factura factura) async {
    final modal = AsyncOperationModal.show(context, text: 'Preparando PDF...');
    try {
      final file = await FacturasService.downloadDocumentoPdf(factura);
      modal.close();

      if (!mounted) return;

      final text =
          'Adjunto: ${factura.tipoLabel} ${factura.numeroFormateado} - '
          '${factura.total.toStringAsFixed(2)} € - Granja Mari Pepa';

      final renderBox = context.findRenderObject()! as RenderBox;
      final size = renderBox.size;
      final origin = Rect.fromCenter(
        center: Offset(size.width / 2, size.height / 2),
        width: 1,
        height: 1,
      );

      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        text: text,
        subject:
            '${factura.tipoLabel} ${factura.numeroFormateado} - Granja Mari Pepa',
        sharePositionOrigin: origin,
      );
    } catch (e) {
      modal.error(
        'Error al compartir: $e',
        onRetry: () => _shareFacturaPdf(factura),
      );
    }
  }

  // ============================================================================
  // SHARE ACTIONS MODAL
  // ============================================================================

  void _showShareOptions(BuildContext context, Factura factura) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.transparent,
      builder: (sheetContext) {
        AppColors.syncWithTheme(sheetContext);
        final scheme = Theme.of(sheetContext).colorScheme;
        final onSurface = scheme.onSurface;
        return Container(
          decoration: BoxDecoration(
            color: scheme.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            border: Border(
              top: BorderSide(color: scheme.outlineVariant),
            ),
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
                    color: scheme.outline,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(bottom: 20),
                  child: Text(
                    'Compartir ${factura.tipoLabel}',
                    style:
                        Theme.of(sheetContext).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                              color: onSurface,
                            ),
                  ),
                ),
                ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AppColors.whatsappGreen,
                    child:
                        Icon(Icons.chat, color: AppColors.onAccent, size: 20),
                  ),
                  title: Text(
                    'WhatsApp',
                    style: TextStyle(color: onSurface),
                  ),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    _whatsAppFactura(factura);
                  },
                ),
                ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AppTheme.info,
                    child: Icon(
                      Icons.email_outlined,
                      color: AppColors.onAccent,
                      size: 20,
                    ),
                  ),
                  title: Text(
                    'Email',
                    style: TextStyle(color: onSurface),
                  ),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    _emailFactura(factura);
                  },
                ),
                ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AppColors.systemGrey,
                    child: Icon(
                      Icons.share_outlined,
                      color: AppColors.onAccent,
                      size: 20,
                    ),
                  ),
                  title: Text(
                    'Sistema',
                    style: TextStyle(color: onSurface),
                  ),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    _shareFacturaPdf(factura);
                  },
                ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _emailFactura(Factura factura) async {
    final documentLabel = factura.isAlbaran ? 'Albarán' : 'Factura';
    final result = await EmailFormModal.show(
      context,
      defaultSubject:
          '$documentLabel ${factura.numeroFormateado} - ${factura.clienteNombre}',
      defaultBody: 'Hola ${factura.clienteNombre},\n\n'
          'Adjunto le remitimos su ${documentLabel.toLowerCase()} ${factura.numeroFormateado} '
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
        documentType: factura.isAlbaran ? 'albaran' : 'factura',
        terminal: factura.isAlbaran ? factura.terminal : null,
      );
      modal.success('✓ Email enviado a ${result.email}');
    } catch (e) {
      modal.error(
        'Error enviando email: $e',
        onRetry: () => _emailFactura(factura),
      );
    }
  }

  Future<void> _whatsAppFactura(Factura factura) async {
    final documentLabel = factura.isAlbaran ? 'albarán' : 'factura';
    final result = await WhatsAppFormModal.show(
      context,
      defaultMessage:
          'Hola ${factura.clienteNombre}, le adjunto su $documentLabel '
          '${factura.numeroFormateado} (${factura.total.toStringAsFixed(2)} €). \n\n'
          'Gracias por su confianza - Granja Mari Pepa',
    );

    if (result == null || !mounted) return;

    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando documento...',
    );
    try {
      // Download PDF
      final file = await FacturasService.downloadDocumentoPdf(factura);

      // Get WhatsApp URL from backend
      final whatsappUrl = await FacturasService.shareWhatsApp(
        serie: factura.serie,
        numero: factura.numero,
        ejercicio: factura.ejercicio,
        telefono: result.phone,
        clienteNombre: factura.clienteNombre,
        documentType: factura.isAlbaran ? 'albaran' : 'factura',
        terminal: factura.isAlbaran ? factura.terminal : null,
      );

      modal.close();
      if (!mounted) return;

      // Share PDF with WhatsApp - this opens system share with PDF ready to attach
      final renderBox = context.findRenderObject() as RenderBox?;
      final origin = renderBox != null
          ? Rect.fromCenter(
              center:
                  Offset(renderBox.size.width / 2, renderBox.size.height / 2),
              width: 1,
              height: 1,
            )
          : null;

      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        text: result.message,
        subject: result.message,
        sharePositionOrigin: origin,
      );

      // If WhatsApp URL available, also open WhatsApp chat
      if (whatsappUrl != null && whatsappUrl.isNotEmpty) {
        final uri = Uri.parse(whatsappUrl);
        if (await canLaunchUrl(uri)) {
          await launchUrl(
            uri,
            mode: LaunchMode.externalApplication,
          );
        }
      }
    } catch (e) {
      modal.close();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al compartir: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Consumer(
      builder: (context, ref, _) {
        // select(): the whole-page Consumer used to watch the full auth
        // AsyncValue, so every auth emission rebuilt header, summary,
        // filters and list. Only the jefe flag drives the vendor selector.
        final showVendorSelector = ref.watch(
              authProvider.select((s) => s.value?.user?.isJefeVentas ?? false),
            ) ||
            widget.forceShowVendorSelector;
        return Column(
          children: [
            // Header (AppBar replacement)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppTheme.raisedSurface,
                border: Border(
                  bottom: BorderSide(
                      color: AppColors.themedWhite.withValues(alpha: 0.05)),
                ),
                boxShadow: const [
                  BoxShadow(
                    color: AppColors.systemBlack12,
                    blurRadius: 4,
                    offset: Offset(0, 2),
                  ),
                ],
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: AppTheme.accentMint.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: const Icon(
                              Icons.receipt_long_outlined,
                              color: AppTheme.accentMint,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Text(
                            'Facturas y albaranes',
                            style: Theme.of(context)
                                .textTheme
                                .headlineSmall
                                ?.copyWith(fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                      // Explicit Refresh Button
                      IconButton(
                        icon: const Icon(Icons.refresh),
                        onPressed: () => _refreshData(forceRefresh: true),
                        tooltip: 'Recargar datos',
                      ),
                    ],
                  ),
                  if (showVendorSelector) ...[
                    const SizedBox(height: 12),
                    Container(
                      constraints: const BoxConstraints(minHeight: 50),
                      width: double.infinity,
                      child: GlobalVendorSelector(
                        isJefeVentas: true,
                        forceShow: widget.forceShowVendorSelector,
                      ),
                    ),
                  ],
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
                    child: _isLoading && _facturas.isEmpty
                        // OPTIMIZATION: Use SkeletonList for perceived performance
                        ? const SkeletonList(itemCount: 8, itemHeight: 100)
                        : _error != null
                            ? Center(
                                child: Text(
                                  _error!,
                                  style: const TextStyle(color: AppTheme.error),
                                ),
                              )
                            : _facturas.isEmpty
                                ? _buildEmptyState()
                                : RefreshIndicator(
                                    onRefresh: () =>
                                        _refreshData(forceRefresh: true),
                                    // OPTIMIZATION: Use OptimizedListView for smooth scrolling
                                    child: OptimizedListView(
                                      padding:
                                          const EdgeInsets.only(bottom: 80),
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
      },
    );
  }

  Widget _buildSummaryCards() {
    if (_summary == null) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Row(
        children: [
          Expanded(
            child: _buildSummaryItem(
              icon: Icons.receipt_long,
              label: 'Docs',
              value: '${_summary!.totalDocumentos}',
              color: AppTheme.info,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _buildSummaryItem(
              icon: Icons.calculate_outlined,
              label: 'Base',
              value: _formatMoney(_summary!.totalBase, decimals: 0),
              color: AppTheme.info,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _buildSummaryItem(
              icon: Icons.euro,
              label: 'Total',
              value: '${_summary!.totalImporte.toStringAsFixed(0)}€',
              color: AppTheme.success,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _buildSummaryItem(
              icon: Icons.percent,
              label: 'IVA',
              value: '${_summary!.totalIva.toStringAsFixed(0)}€',
              color: AppTheme.warning,
            ),
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

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
      decoration: BoxDecoration(
        gradient: isDark
            ? LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppTheme.raisedSurface,
                  AppTheme.softPanel.withValues(alpha: 0.90),
                  color.withValues(alpha: 0.045),
                ],
              )
            : null,
        color: isDark ? null : AppColors.themedWhite,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color:
              isDark ? color.withValues(alpha: 0.20) : AppColors.systemGrey100,
        ),
        boxShadow: isDark ? AppTheme.elevation1 : null,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(5),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 15),
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  value,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                    color: isDark
                        ? AppColors.themedWhite
                        : AppColors.systemBlack87,
                  ),
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              color: isDark
                  ? AppColors.themedWhite.withValues(alpha: 0.7)
                  : AppColors.systemGrey600,
              fontSize: 10,
              fontWeight: FontWeight.w500,
            ),
            textAlign: TextAlign.center,
            maxLines: 1,
          ),
        ],
      ),
    );
  }

  Widget _buildFilters(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: isDark
            ? LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppTheme.raisedSurface,
                  AppTheme.softPanel.withValues(alpha: 0.92),
                  AppTheme.accentMint.withValues(alpha: 0.04),
                ],
              )
            : null,
        color: isDark ? null : AppColors.systemGrey50,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark
              ? AppTheme.accentMint.withValues(alpha: 0.18)
              : AppColors.systemGrey200,
        ),
        boxShadow: isDark ? AppTheme.elevation1 : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section label
          Row(
            children: [
              Icon(
                Icons.filter_list,
                size: 16,
                color:
                    isDark ? AppColors.themedWhite38 : AppColors.systemGrey500,
              ),
              const SizedBox(width: 6),
              Text(
                'Filtros',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: isDark
                      ? AppColors.themedWhite38
                      : AppColors.systemGrey500,
                  letterSpacing: 0,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Search Row - full width fields
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
                  hint: 'Nº documento...',
                  icon: Icons.receipt_long_outlined,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          _buildDocumentTypeDropdown(),
          const SizedBox(height: 12),

          // Date Controls Grid - 2x2 layout
          Row(
            children: [
              Expanded(
                child: _buildDropdown<int>(
                  value: _selectedMonth,
                  items: [
                    const DropdownMenuItem<int>(
                      child: Text('Todos'),
                    ),
                    ...List.generate(12, (index) {
                      final monthName = DateFormat('MMMM', 'es_ES')
                          .format(DateTime(2024, index + 1));
                      final capitalized =
                          monthName[0].toUpperCase() + monthName.substring(1);
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
              const SizedBox(width: 10),
              Expanded(
                child: _buildDropdown<int>(
                  value: _selectedYear,
                  items: _years
                      .map((y) => DropdownMenuItem(value: y, child: Text('$y')))
                      .toList(),
                  onChanged: _onYearChanged,
                  hint: 'Año',
                  icon: Icons.calendar_today,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Date Range Row
          Row(
            children: [
              Expanded(
                child: _buildDateButton(
                  label: _dateFrom == null
                      ? 'Desde'
                      : DateFormat('dd/MM/yyyy').format(_dateFrom!),
                  onTap: () => _selectDate(context, true),
                  isActive: _dateFrom != null,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildDateButton(
                  label: _dateTo == null
                      ? 'Hasta'
                      : DateFormat('dd/MM/yyyy').format(_dateTo!),
                  onTap: () => _selectDate(context, false),
                  isActive: _dateTo != null,
                ),
              ),
              if (_dateFrom != null || _dateTo != null)
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: InkWell(
                    onTap: () {
                      setState(() {
                        _dateFrom = null;
                        _dateTo = null;
                      });
                      _refreshData();
                    },
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppTheme.error.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(
                        Icons.close,
                        size: 18,
                        color: AppTheme.error,
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

  Widget _buildDateButton({
    required String label,
    required VoidCallback onTap,
    required bool isActive,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    const accentColor = AppTheme.info;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        height: 44,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: isActive
              ? accentColor.withValues(alpha: 0.08)
              : (isDark
                  ? AppTheme.inkSurface.withValues(alpha: 0.34)
                  : AppColors.themedWhite),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isActive
                ? accentColor.withValues(alpha: 0.4)
                : (isDark
                    ? AppColors.themedWhite.withValues(alpha: 0.08)
                    : AppColors.systemGrey200),
            width: isActive ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.date_range_rounded,
              size: 16,
              color: isActive
                  ? accentColor
                  : (isDark
                      ? AppColors.themedWhite38
                      : AppColors.systemGrey400),
            ),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(
                color: isActive
                    ? accentColor
                    : (isDark
                        ? AppColors.themedWhite.withValues(alpha: 0.7)
                        : AppColors.systemBlack87),
                fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDocumentTypeDropdown() {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: isDark
            ? AppTheme.inkSurface.withValues(alpha: 0.34)
            : AppColors.themedWhite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isDark
              ? AppColors.themedWhite.withValues(alpha: 0.08)
              : AppColors.systemGrey200,
        ),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<FacturaDocumentType?>(
          value: _selectedDocumentType,
          items: const [
            DropdownMenuItem<FacturaDocumentType?>(
              child: Text('Todos'),
            ),
            DropdownMenuItem<FacturaDocumentType?>(
              value: FacturaDocumentType.factura,
              child: Text('Factura'),
            ),
            DropdownMenuItem<FacturaDocumentType?>(
              value: FacturaDocumentType.albaran,
              child: Text('Albaran'),
            ),
          ],
          onChanged: _onDocumentTypeChanged,
          hint: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.description_outlined,
                size: 16,
                color:
                    isDark ? AppColors.themedWhite38 : AppColors.systemGrey400,
              ),
              const SizedBox(width: 8),
              Text(
                'Todos',
                style: TextStyle(
                  color: isDark
                      ? AppColors.themedWhite.withValues(alpha: 0.7)
                      : AppColors.systemBlack87,
                  fontSize: 13,
                ),
              ),
            ],
          ),
          icon: Icon(
            Icons.arrow_drop_down,
            color: isDark ? AppColors.themedWhite38 : AppColors.systemGrey400,
          ),
          dropdownColor:
              isDark ? AppTheme.raisedSurface : AppColors.themedWhite,
          style: TextStyle(
            color: isDark ? AppColors.themedWhite : AppColors.systemBlack87,
            fontSize: 14,
          ),
          isExpanded: true,
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
      height: 44,
      decoration: BoxDecoration(
        color: isDark
            ? AppTheme.inkSurface.withValues(alpha: 0.34)
            : AppColors.themedWhite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isDark
              ? AppColors.themedWhite.withValues(alpha: 0.08)
              : AppColors.systemGrey200,
        ),
      ),
      child: TextField(
        controller: controller,
        onChanged: (_) => _onSearchChanged(),
        style: TextStyle(
          color: isDark ? AppColors.themedWhite : AppColors.systemBlack87,
          fontSize: 14,
        ),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: TextStyle(
            color: isDark
                ? AppColors.themedWhite.withValues(alpha: 0.3)
                : AppColors.systemGrey400,
            fontSize: 13,
          ),
          prefixIcon: Icon(
            icon,
            color: isDark ? AppColors.themedWhite38 : AppColors.systemGrey400,
            size: 18,
          ),
          prefixIconConstraints: const BoxConstraints(minWidth: 40),
          border: InputBorder.none,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
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
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: isDark
            ? AppTheme.inkSurface.withValues(alpha: 0.34)
            : AppColors.themedWhite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isDark
              ? AppColors.themedWhite.withValues(alpha: 0.08)
              : AppColors.systemGrey200,
        ),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: value,
          items: items,
          onChanged: onChanged,
          hint: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                icon,
                size: 16,
                color:
                    isDark ? AppColors.themedWhite38 : AppColors.systemGrey400,
              ),
              const SizedBox(width: 8),
              Text(
                hint,
                style: TextStyle(
                  color: isDark
                      ? AppColors.themedWhite.withValues(alpha: 0.3)
                      : AppColors.systemGrey400,
                  fontSize: 13,
                ),
              ),
            ],
          ),
          icon: Icon(
            Icons.arrow_drop_down,
            color: isDark ? AppColors.themedWhite38 : AppColors.systemGrey400,
          ),
          dropdownColor:
              isDark ? AppTheme.raisedSurface : AppColors.themedWhite,
          style: TextStyle(
            color: isDark ? AppColors.themedWhite : AppColors.systemBlack87,
            fontSize: 14,
          ),
          isExpanded: true,
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    final hasFilters = _selectedMonth != null ||
        _selectedDocumentType != null ||
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
              hasFilters
                  ? Icons.search_off_rounded
                  : Icons.receipt_long_outlined,
              size: 56,
              color: AppColors.themedWhite24,
            ),
            const SizedBox(height: 16),
            Text(
              hasFilters
                  ? 'No se han encontrado documentos para los filtros seleccionados'
                  : 'No hay documentos disponibles',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.themedWhite54,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              hasFilters
                  ? 'Prueba a seleccionar otro comercial, ampliar el rango de fechas o modificar la búsqueda.'
                  : 'Los documentos apareceran aqui cuando esten disponibles.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.themedWhite38, fontSize: 13),
            ),
            if (hasFilters) ...[
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: () {
                  setState(() {
                    _selectedMonth = null;
                    _selectedDocumentType = null;
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
                  foregroundColor: AppColors.themedWhite54,
                  side: BorderSide(color: AppColors.themedWhite24),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
