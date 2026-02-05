import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:signature/signature.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'dart:io';
import 'dart:typed_data';
import 'dart:convert';
import 'package:path_provider/path_provider.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/api/api_client.dart';
import '../../../entregas/providers/entregas_provider.dart';

/// Rutero Detail Modal - Futuristic Redesign v2
/// Features:
/// - Visual product carousel with quantity adjustment
/// - Smart payment module with multiple methods
/// - Geo-tagged photo capture
/// - Improved signature capture
/// - Clear obligatory vs optional payment indicators
class RuteroDetailModal extends StatefulWidget {
  final AlbaranEntrega albaran;

  const RuteroDetailModal({super.key, required this.albaran});

  @override
  State<RuteroDetailModal> createState() => _RuteroDetailModalState();
}

class _RuteroDetailModalState extends State<RuteroDetailModal>
    with TickerProviderStateMixin {
  late TabController _tabController;
  late AnimationController _slideController;
  
  final TextEditingController _observacionesController = TextEditingController();
  final TextEditingController _dniController = TextEditingController();
  final TextEditingController _nombreController = TextEditingController();
  final FocusNode _dniFocus = FocusNode();
  final FocusNode _nombreFocus = FocusNode();
  
  final SignatureController _signatureController = SignatureController(
    penStrokeWidth: 3,
    penColor: Colors.white,
    exportBackgroundColor: Colors.transparent,
  );

  // Product verification state
  final Map<String, bool> _productChecked = {};
  final Map<String, int> _productQuantities = {};
  
  // Data state
  List<EntregaItem> _items = [];
  bool _isLoadingItems = true;
  String? _itemsError;
  
  // Helpers
  List<String> _suggestedNames = [];
  List<String> _suggestedDnis = [];

  String _selectedPaymentMethod = 'EFECTIVO';
  bool _isPaid = false;
  bool _isSubmitting = false;
  
  // Inline validation errors (instead of snackbar)
  String? _nombreError;
  String? _dniError;
  String? _firmaError;
  String? _pagoError;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _slideController = AnimationController(
      duration: const Duration(milliseconds: 400),
      vsync: this,
    )..forward();
    
    _observacionesController.text = widget.albaran.observaciones ?? '';

    if (widget.albaran.esCTR) {
      _selectedPaymentMethod = 'EFECTIVO';
    }
    
    _loadItems();
    _loadSignerSuggestions();
  }

  Future<void> _loadItems() async {
    try {
      final provider = Provider.of<EntregasProvider>(context, listen: false);
      final items = await provider.getAlbaranDetalle(
        widget.albaran.numeroAlbaran,
        widget.albaran.ejercicio,
        widget.albaran.serie,
        widget.albaran.terminal,
      );
      
      if (mounted) {
        setState(() {
          _items = items;
          _isLoadingItems = false;
          
          for (var item in items) {
             if (!_productChecked.containsKey(item.codigoArticulo)) {
                _productChecked[item.codigoArticulo] = true;
                _productQuantities[item.codigoArticulo] = item.cantidadPedida.toInt();
             }
          }
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _itemsError = e.toString();
          _isLoadingItems = false;
        });
      }
    }
  }

  Future<void> _loadSignerSuggestions() async {
    try {
      final codigoCliente = widget.albaran.codigoCliente;
      if (codigoCliente == null) return;
      
      final response = await ApiClient.get('/entregas/signers/$codigoCliente');
      if (response['success'] == true && mounted) {
        final signers = response['signers'] as List;
        setState(() {
          _suggestedDnis = signers.map((s) => s['DNI'].toString().trim()).toList();
          _suggestedNames = signers.map((s) => s['NOMBRE'].toString().trim()).toList();
          
          // Pre-fill with most recent signer (User request)
          if (signers.isNotEmpty) {
             final last = signers.first;
             _dniController.text = last['DNI'].toString().trim();
             _nombreController.text = last['NOMBRE'].toString().trim();
          }
        });
      }
    } catch (e) {
      print('Error loading signers: $e');
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    _slideController.dispose();
    _observacionesController.dispose();
    _dniController.dispose();
    _nombreController.dispose();
    _dniFocus.dispose();
    _nombreFocus.dispose();
    _signatureController.dispose();
    super.dispose();
  }

  bool get _isFactura => widget.albaran.numeroFactura > 0;
  bool get _isUrgent => widget.albaran.esCTR;

  @override
  Widget build(BuildContext context) {
    return SlideTransition(
      position: Tween<Offset>(
        begin: const Offset(0, 1),
        end: Offset.zero,
      ).animate(CurvedAnimation(
        parent: _slideController,
        curve: Curves.easeOutCubic,
      )),
      child: Container(
        height: MediaQuery.of(context).size.height * 0.92,
        decoration: BoxDecoration(
          color: AppTheme.darkBase,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          border: Border.all(
            color: AppTheme.neonBlue.withOpacity(0.2),
            width: 1,
          ),
        ),
        child: Column(
          children: [
            // Drag handle
            Container(
              margin: const EdgeInsets.only(top: 12, bottom: 8),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.borderColor,
                borderRadius: BorderRadius.circular(2),
              ),
            ),

            // Header
            _buildHeader(),

            // Tab bar
            _buildTabBar(),

            // Tab content
            Expanded(
              child: TabBarView(
                controller: _tabController,
                physics: const NeverScrollableScrollPhysics(), // Prevent swipe conflict with signature
                children: [
                  _buildProductsTab(),
                  _buildPaymentTab(),
                  _buildFinalizeTab(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppTheme.darkSurface,
            AppTheme.darkBase,
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Document badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: _isFactura
                        ? [
                            AppTheme.neonPurple.withOpacity(0.3),
                            AppTheme.neonPurple.withOpacity(0.1),
                          ]
                        : [
                            AppTheme.neonBlue.withOpacity(0.2),
                            AppTheme.neonBlue.withOpacity(0.05),
                          ],
                  ),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: _isFactura ? AppTheme.neonPurple : AppTheme.neonBlue,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      _isFactura ? Icons.receipt_long : Icons.description,
                      size: 16,
                      color: _isFactura ? AppTheme.neonPurple : AppTheme.neonBlue,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      _isFactura
                          ? 'FACTURA ${widget.albaran.numeroFactura}'
                          : 'ALBARÁN ${widget.albaran.numeroAlbaran}',
                      style: TextStyle(
                        color: _isFactura ? AppTheme.neonPurple : AppTheme.neonBlue,
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),

              const Spacer(),

              // Amount badge
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    NumberFormat.currency(symbol: '€', locale: 'es_ES')
                        .format(widget.albaran.importeTotal),
                    style: TextStyle(
                      color: _isUrgent ? AppTheme.obligatorio : AppTheme.textPrimary,
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: (_isUrgent ? AppTheme.obligatorio : AppTheme.success)
                          .withOpacity(0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      _isUrgent ? '⚠ COBRO OBLIGATORIO' : '✓ COBRO OPCIONAL',
                      style: TextStyle(
                        color: _isUrgent ? AppTheme.obligatorio : AppTheme.success,
                        fontSize: 9,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(width: 12),

              // Close button
              IconButton(
                icon: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: AppTheme.borderColor,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.close, color: AppTheme.textSecondary, size: 18),
                ),
                onPressed: () => Navigator.pop(context),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // Client info
          Text(
            widget.albaran.nombreCliente,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.location_on_outlined, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  '${widget.albaran.direccion}, ${widget.albaran.poblacion}',
                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTabBar() {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        border: Border(
          bottom: BorderSide(color: AppTheme.borderColor),
        ),
      ),
      child: TabBar(
        controller: _tabController,
        indicatorColor: AppTheme.neonBlue,
        indicatorWeight: 3,
        labelColor: AppTheme.neonBlue,
        unselectedLabelColor: AppTheme.textSecondary,
        labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
        tabs: [
          Tab(
            icon: const Icon(Icons.inventory_2_outlined, size: 20),
            text: 'PRODUCTOS',
          ),
          Tab(
            icon: Icon(
              Icons.payment,
              size: 20,
              color: _isUrgent ? AppTheme.obligatorio : null,
            ),
            child: Text(
              'COBRO',
              style: TextStyle(
                color: _isUrgent ? AppTheme.obligatorio : null,
              ),
            ),
          ),
          const Tab(
            icon: Icon(Icons.check_circle_outline, size: 20),
            text: 'FINALIZAR',
          ),
        ],
      ),
    );
  }

  Widget _buildProductsTab() {
    if (_isLoadingItems) {
      return _buildProductsLoading();
    }

    if (_itemsError != null) {
      return _buildProductsError(_itemsError);
    }

    if (_items.isEmpty) {
      return _buildProductsEmpty();
    }

    return Column(
      children: [
        // Summary bar
        _buildProductsSummary(_items),

        // Product list
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: _items.length,
            itemBuilder: (context, index) {
              final linea = _items[index];
              return _buildProductCard(linea);
            },
          ),
        ),

        // Confirm all button
        _buildConfirmAllButton(_items),
      ],
    );
  }

  Widget _buildProductsLoading() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 60,
            height: 60,
            child: CircularProgressIndicator(
              color: AppTheme.neonBlue,
              strokeWidth: 3,
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'Cargando productos...',
            style: TextStyle(color: AppTheme.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildProductsError(Object? error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppTheme.error.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
            ),
            const SizedBox(height: 16),
            const Text(
              'Error al cargar productos',
              style: TextStyle(color: AppTheme.error, fontSize: 16),
            ),
            const SizedBox(height: 8),
            Text(
              '$error',
              style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: () => setState(() {}),
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProductsEmpty() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.inventory_2_outlined,
            color: AppTheme.textSecondary.withOpacity(0.5),
            size: 64,
          ),
          const SizedBox(height: 16),
          const Text(
            'No hay líneas de producto',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 16),
          ),
          const SizedBox(height: 8),
          Text(
            'Albarán: ${widget.albaran.numeroAlbaran}',
            style: const TextStyle(color: AppTheme.textTertiary, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Widget _buildProductsSummary(List<EntregaItem> lineas) {
    final checked = _productChecked.values.where((v) => v).length;
    final total = lineas.length;

    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        gradient: AppTheme.holoGradient,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.neonBlue.withOpacity(0.2)),
      ),
      child: Row(
        children: [
          Icon(Icons.checklist, color: AppTheme.neonBlue, size: 20),
          const SizedBox(width: 12),
          Text(
            '$checked de $total productos verificados',
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontWeight: FontWeight.w500,
            ),
          ),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: checked == total
                  ? AppTheme.success.withOpacity(0.2)
                  : AppTheme.warning.withOpacity(0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              checked == total ? '✓ COMPLETO' : 'PENDIENTE',
              style: TextStyle(
                color: checked == total ? AppTheme.success : AppTheme.warning,
                fontSize: 10,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProductCard(EntregaItem linea) {
    final isChecked = _productChecked[linea.codigoArticulo] ?? true;
    final quantity = _productQuantities[linea.codigoArticulo] ?? linea.cantidadPedida.toInt();
    final isModified = quantity != linea.cantidadPedida.toInt();

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        gradient: AppTheme.cardGradient,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isChecked
              ? AppTheme.success.withOpacity(0.3)
              : AppTheme.warning.withOpacity(0.3),
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            setState(() {
              _productChecked[linea.codigoArticulo] = !isChecked;
            });
          },
          borderRadius: BorderRadius.circular(14),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                // Checkbox
                AnimatedContainer(
                  duration: AppTheme.animFast,
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: isChecked
                        ? AppTheme.success.withOpacity(0.2)
                        : AppTheme.darkBase,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: isChecked ? AppTheme.success : AppTheme.borderColor,
                      width: 2,
                    ),
                  ),
                  child: isChecked
                      ? const Icon(Icons.check, color: AppTheme.success, size: 18)
                      : null,
                ),

                const SizedBox(width: 14),

                // Product info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        linea.descripcion,
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          decoration: isChecked ? null : TextDecoration.lineThrough,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Text(
                            'Ref: ${linea.codigoArticulo}',
                            style: const TextStyle(
                              color: AppTheme.textTertiary,
                              fontSize: 11,
                            ),
                          ),
                          if (isModified) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: AppTheme.warning.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                'MODIFICADO',
                                style: TextStyle(
                                  color: AppTheme.warning,
                                  fontSize: 8,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),

                // Quantity controls
                Container(
                  decoration: BoxDecoration(
                    color: AppTheme.darkBase,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppTheme.borderColor),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _buildQuantityButton(
                        icon: Icons.remove,
                        onTap: quantity > 0
                            ? () {
                                HapticFeedback.selectionClick();
                                setState(() {
                                  _productQuantities[linea.codigoArticulo] = quantity - 1;
                                });
                              }
                            : null,
                      ),
                      Container(
                        width: 40,
                        alignment: Alignment.center,
                        child: Text(
                          '$quantity',
                          style: TextStyle(
                            color: isModified ? AppTheme.warning : AppTheme.textPrimary,
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                        ),
                      ),
                      _buildQuantityButton(
                        icon: Icons.add,
                        onTap: () {
                          HapticFeedback.selectionClick();
                          setState(() {
                            _productQuantities[linea.codigoArticulo] = quantity + 1;
                          });
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildQuantityButton({
    required IconData icon,
    VoidCallback? onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Icon(
            icon,
            color: onTap != null ? AppTheme.neonBlue : AppTheme.textTertiary,
            size: 18,
          ),
        ),
      ),
    );
  }

  Widget _buildConfirmAllButton(List<EntregaItem> lineas) {
    final allChecked = _productChecked.values.every((v) => v);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        border: Border(top: BorderSide(color: AppTheme.borderColor)),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () {
                HapticFeedback.lightImpact();
                setState(() {
                  for (var linea in lineas) {
                    _productChecked[linea.codigoArticulo] = !allChecked;
                  }
                });
              },
              icon: Icon(allChecked ? Icons.check_box : Icons.check_box_outline_blank),
              label: Text(allChecked ? 'DESMARCAR TODO' : 'MARCAR TODO'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.neonBlue,
                side: BorderSide(color: AppTheme.neonBlue.withOpacity(0.5)),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: () {
                HapticFeedback.mediumImpact();
                _tabController.animateTo(1);
              },
              icon: const Icon(Icons.arrow_forward),
              label: const Text('CONTINUAR'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.neonBlue,
                foregroundColor: AppTheme.darkBase,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPaymentTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Amount card
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppTheme.darkCard,
                  _isUrgent
                      ? AppTheme.obligatorio.withOpacity(0.1)
                      : AppTheme.darkSurface,
                ],
              ),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: _isUrgent
                    ? AppTheme.obligatorio.withOpacity(0.4)
                    : AppTheme.neonBlue.withOpacity(0.2),
                width: 2,
              ),
              boxShadow: [
                if (_isUrgent)
                  BoxShadow(
                    color: AppTheme.obligatorio.withOpacity(0.15),
                    blurRadius: 20,
                  ),
              ],
            ),
            child: Column(
              children: [
                Text(
                  'TOTAL A COBRAR',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                    letterSpacing: 1,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  NumberFormat.currency(symbol: '€', locale: 'es_ES')
                      .format(widget.albaran.importeTotal),
                  style: TextStyle(
                    color: _isUrgent ? AppTheme.obligatorio : AppTheme.textPrimary,
                    fontSize: 42,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: (_isUrgent ? AppTheme.obligatorio : AppTheme.success)
                        .withOpacity(0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _isUrgent ? Icons.priority_high : Icons.info_outline,
                        size: 16,
                        color: _isUrgent ? AppTheme.obligatorio : AppTheme.success,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        _isUrgent
                            ? 'COBRO OBLIGATORIO - ${_getPaymentTypeLabel()}'
                            : 'COBRO OPCIONAL - ${_getPaymentTypeLabel()}',
                        style: TextStyle(
                          color: _isUrgent ? AppTheme.obligatorio : AppTheme.success,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // Payment method selector
          Text(
            'MÉTODO DE PAGO',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 12,
              fontWeight: FontWeight.bold,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 12),

          Row(
            children: [
              Expanded(child: _buildPaymentOption('EFECTIVO', Icons.money)),
              const SizedBox(width: 12),
              Expanded(child: _buildPaymentOption('TARJETA', Icons.credit_card)),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _buildPaymentOption('BIZUM', Icons.phone_android)),
              const SizedBox(width: 12),
              Expanded(child: _buildPaymentOption('TRANSFER', Icons.account_balance)),
            ],
          ),

          const SizedBox(height: 24),

          // Mark as paid checkbox
          InkWell(
            onTap: () {
              HapticFeedback.selectionClick();
              setState(() => _isPaid = !_isPaid);
            },
            borderRadius: BorderRadius.circular(12),
            child: AnimatedContainer(
              duration: AppTheme.animFast,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: _isPaid
                    ? LinearGradient(
                        colors: [
                          AppTheme.success.withOpacity(0.2),
                          AppTheme.success.withOpacity(0.1),
                        ],
                      )
                    : null,
                color: _isPaid ? null : AppTheme.darkCard,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _isPaid ? AppTheme.success : AppTheme.borderColor,
                  width: _isPaid ? 2 : 1,
                ),
              ),
              child: Row(
                children: [
                  AnimatedContainer(
                    duration: AppTheme.animFast,
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: _isPaid ? AppTheme.success : AppTheme.darkBase,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: _isPaid ? AppTheme.success : AppTheme.borderColor,
                        width: 2,
                      ),
                    ),
                    child: _isPaid
                        ? const Icon(Icons.check, color: Colors.white, size: 18)
                        : null,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'MARCAR COMO COBRADO',
                          style: TextStyle(
                            color: _isPaid ? AppTheme.success : AppTheme.textPrimary,
                            fontWeight: FontWeight.bold,
                            fontSize: 14,
                          ),
                        ),
                        Text(
                          _isPaid
                              ? 'Cobro registrado con $_selectedPaymentMethod'
                              : 'Confirmar recepción del pago',
                          style: TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_isPaid)
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppTheme.success.withOpacity(0.2),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.check_circle,
                        color: AppTheme.success,
                        size: 24,
                      ),
                    ),
                ],
              ),
            ),
          ),

          if (_pagoError != null) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.error.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppTheme.error.withOpacity(0.5)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, color: AppTheme.error, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _pagoError!,
                      style: const TextStyle(color: AppTheme.error, fontSize: 12, fontWeight: FontWeight.w500),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 24),

          // Continue button
          ElevatedButton.icon(
            onPressed: () {
              HapticFeedback.mediumImpact();
              _tabController.animateTo(2);
            },
            icon: const Icon(Icons.arrow_forward),
            label: const Text('CONTINUAR A FINALIZAR'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue,
              foregroundColor: AppTheme.darkBase,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPaymentOption(String method, IconData icon) {
    final isSelected = _selectedPaymentMethod == method;

    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        setState(() => _selectedPaymentMethod = method);
      },
      child: AnimatedContainer(
        duration: AppTheme.animFast,
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          gradient: isSelected
              ? LinearGradient(
                  colors: [
                    AppTheme.neonBlue.withOpacity(0.2),
                    AppTheme.neonCyan.withOpacity(0.1),
                  ],
                )
              : null,
          color: isSelected ? null : AppTheme.darkCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? AppTheme.neonBlue : AppTheme.borderColor,
            width: isSelected ? 2 : 1,
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: AppTheme.neonBlue.withOpacity(0.2),
                    blurRadius: 10,
                  ),
                ]
              : null,
        ),
        child: Column(
          children: [
            Icon(
              icon,
              color: isSelected ? AppTheme.neonBlue : AppTheme.textSecondary,
              size: 28,
            ),
            const SizedBox(height: 8),
            Text(
              method,
              style: TextStyle(
                color: isSelected ? AppTheme.neonBlue : AppTheme.textSecondary,
                fontWeight: FontWeight.bold,
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFinalizeTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Receiver data
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppTheme.borderColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.person, color: AppTheme.neonBlue, size: 20),
                    const SizedBox(width: 8),
                    const Text(
                      'DATOS DEL RECEPTOR',
                      style: TextStyle(
                        color: AppTheme.neonBlue,
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                        letterSpacing: 1,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const SizedBox(height: 16),
                
                // Name Autocomplete
                RawAutocomplete<String>(
                  textEditingController: _nombreController,
                  focusNode: _nombreFocus,
                  optionsBuilder: (TextEditingValue textEditingValue) {
                    if (textEditingValue.text.isEmpty) {
                      return const Iterable<String>.empty();
                    }
                    return _suggestedNames.where((String option) {
                      return option.toUpperCase().contains(textEditingValue.text.toUpperCase());
                    });
                  },
                  fieldViewBuilder: (context, controller, focusNode, onEditingComplete) {
                     return TextField(
                      controller: controller,
                      focusNode: focusNode,
                      onEditingComplete: onEditingComplete,
                      onChanged: (_) {
                        // Clear error when user starts typing
                        if (_nombreError != null) {
                          setState(() => _nombreError = null);
                        }
                      },
                      style: const TextStyle(color: AppTheme.textPrimary),
                      decoration: InputDecoration(
                        labelText: 'Nombre y Apellidos *',
                        prefixIcon: const Icon(Icons.person_outline, size: 20),
                        filled: true,
                        fillColor: AppTheme.darkBase,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        errorText: _nombreError,
                        errorStyle: const TextStyle(color: AppTheme.error),
                      ),
                    );
                  },
                  optionsViewBuilder: (context, onSelected, options) {
                    return Align(
                      alignment: Alignment.topLeft,
                      child: Material(
                        elevation: 4.0,
                        color: AppTheme.darkCard,
                        child: SizedBox(
                          height: 200.0,
                          width: MediaQuery.of(context).size.width - 80, // Adjust width
                          child: ListView.builder(
                            padding: const EdgeInsets.all(8.0),
                            itemCount: options.length,
                            itemBuilder: (BuildContext context, int index) {
                              final String option = options.elementAt(index);
                              return ListTile(
                                tileColor: AppTheme.darkBase,
                                title: Text(option, style: const TextStyle(color: AppTheme.textPrimary)),
                                onTap: () {
                                  onSelected(option);
                                },
                              );
                            },
                          ),
                        ),
                      ),
                    );
                  },
                ),
                
                const SizedBox(height: 12),
                
                // DNI Autocomplete
                RawAutocomplete<String>(
                  textEditingController: _dniController,
                  focusNode: _dniFocus,
                  optionsBuilder: (TextEditingValue textEditingValue) {
                    if (textEditingValue.text.isEmpty) {
                      return const Iterable<String>.empty();
                    }
                    return _suggestedDnis.where((String option) {
                      return option.toUpperCase().contains(textEditingValue.text.toUpperCase());
                    });
                  },
                  fieldViewBuilder: (context, controller, focusNode, onEditingComplete) {
                     return TextField(
                      controller: controller,
                      focusNode: focusNode,
                      onEditingComplete: onEditingComplete,
                      onChanged: (_) {
                        // Clear error when user starts typing
                        if (_dniError != null) {
                          setState(() => _dniError = null);
                        }
                      },
                      style: const TextStyle(color: AppTheme.textPrimary),
                      decoration: InputDecoration(
                        labelText: 'DNI / NIF *',
                        prefixIcon: const Icon(Icons.badge_outlined, size: 20),
                        filled: true,
                        fillColor: AppTheme.darkBase,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        errorText: _dniError,
                        errorStyle: const TextStyle(color: AppTheme.error),
                      ),
                    );
                  },
                  optionsViewBuilder: (context, onSelected, options) {
                    return Align(
                      alignment: Alignment.topLeft,
                      child: Material(
                        elevation: 4.0,
                        color: AppTheme.darkCard,
                        child: SizedBox(
                          height: 200.0,
                          width: MediaQuery.of(context).size.width - 80,
                          child: ListView.builder(
                            padding: const EdgeInsets.all(8.0),
                            itemCount: options.length,
                            itemBuilder: (BuildContext context, int index) {
                              final String option = options.elementAt(index);
                              return ListTile(
                                tileColor: AppTheme.darkBase,
                                title: Text(option, style: const TextStyle(color: AppTheme.textPrimary)),
                                onTap: () {
                                  onSelected(option);
                                  // Try to auto-fill regular name if possible? 
                                  // For now keeping it simple.
                                },
                              );
                            },
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // Observations
          TextField(
            controller: _observacionesController,
            maxLines: 3,
            style: const TextStyle(color: AppTheme.textPrimary),
            decoration: InputDecoration(
              labelText: 'Observaciones',
              hintText: 'Añadir nota sobre la entrega...',
              alignLabelWithHint: true,
              filled: true,
              fillColor: AppTheme.darkCard,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),

          const SizedBox(height: 20),

          // Signature
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(Icons.draw, color: AppTheme.neonBlue, size: 20),
                  const SizedBox(width: 8),
                  const Text(
                    'FIRMA DEL CLIENTE *',
                    style: TextStyle(
                      color: AppTheme.textSecondary,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              TextButton.icon(
                onPressed: () => _signatureController.clear(),
                icon: const Icon(Icons.refresh, size: 16),
                label: const Text('Borrar'),
                style: TextButton.styleFrom(
                  foregroundColor: AppTheme.error,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            height: 160,
            decoration: BoxDecoration(
              color: AppTheme.darkCard,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: _firmaError != null ? AppTheme.error : AppTheme.borderColor,
                width: _firmaError != null ? 2 : 1,
              ),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Signature(
                controller: _signatureController,
                backgroundColor: Colors.transparent,
              ),
            ),
          ),
          if (_firmaError != null) ...[
            const SizedBox(height: 6),
            Text(
              _firmaError!,
              style: const TextStyle(color: AppTheme.error, fontSize: 12),
            ),
          ],

          const SizedBox(height: 24),

          // Submit button
          Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.neonBlue, AppTheme.neonCyan],
              ),
              borderRadius: BorderRadius.circular(14),
              boxShadow: [
                BoxShadow(
                  color: AppTheme.neonBlue.withOpacity(0.3),
                  blurRadius: 16,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: ElevatedButton(
              onPressed: _isSubmitting ? null : _submitDelivery,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.transparent,
                shadowColor: Colors.transparent,
                foregroundColor: AppTheme.darkBase,
                padding: const EdgeInsets.symmetric(vertical: 18),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: _isSubmitting
                  ? const SizedBox(
                      height: 24,
                      width: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppTheme.darkBase,
                      ),
                    )
                  : Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: const [
                        Icon(Icons.check_circle, size: 24),
                        SizedBox(width: 12),
                        Text(
                          'CONFIRMAR ENTREGA',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 1,
                          ),
                        ),
                      ],
                    ),
            ),
          ),

          const SizedBox(height: 24),
        ],
      ),
    );
  }

  String _getPaymentTypeLabel() {
    final code = widget.albaran.tipoPago.toUpperCase().trim();
    if (code == '01' || code == 'CNT' || code.contains('CONTADO')) return 'CONTADO';
    if (code.contains('REP')) return 'REPOSICIÓN';
    if (code.contains('MEN')) return 'MENSUAL';
    if (code.contains('CRE') || code == 'CR') return 'CRÉDITO';
    if (code.contains('TAR')) return 'TARJETA';
    if (code.contains('TRA')) return 'TRANSFERENCIA';
    return code;
  }

  /// Clear inline validation errors
  void _clearValidationErrors() {
    setState(() {
      _nombreError = null;
      _dniError = null;
      _firmaError = null;
      _pagoError = null;
    });
  }

  /// Validate all fields, return true if valid
  bool _validateFields() {
    bool isValid = true;
    
    // Clear previous errors
    _clearValidationErrors();
    
    // Validate nombre
    if (_nombreController.text.trim().isEmpty) {
      _nombreError = 'El nombre del receptor es obligatorio';
      isValid = false;
    }
    
    // Validate DNI
    if (_dniController.text.trim().isEmpty) {
      _dniError = 'El DNI/NIF es obligatorio';
      isValid = false;
    }
    
    // Validate signature
    if (_signatureController.isEmpty) {
      _firmaError = 'La firma es obligatoria';
      isValid = false;
    }
    
    // CTR payment validation
    if (_isUrgent && !_isPaid) {
      _pagoError = '⚠️ COBRO OBLIGATORIO';
      _tabController.animateTo(1); // Switch to payment tab
      isValid = false;
    }
    
    setState(() {}); // Trigger rebuild to show errors
    
    if (!isValid) {
      HapticFeedback.heavyImpact();
    }
    
    return isValid;
  }

  /// Show confirmation dialog before submitting
  Future<bool> _showConfirmationDialog() async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Icon(Icons.check_circle_outline, color: AppTheme.neonBlue, size: 28),
            const SizedBox(width: 12),
            const Text(
              'Confirmar Entrega',
              style: TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '¿Está seguro de confirmar esta entrega?',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 14),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.darkBase,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.description, size: 16, color: AppTheme.textTertiary),
                      const SizedBox(width: 8),
                      Text(
                        _isFactura 
                            ? 'Factura ${widget.albaran.numeroFactura}'
                            : 'Albarán ${widget.albaran.numeroAlbaran}',
                        style: TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.w500),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Icon(Icons.person, size: 16, color: AppTheme.textTertiary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${_nombreController.text} (${_dniController.text})',
                          style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                  if (_isPaid) ...[
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Icon(Icons.payment, size: 16, color: AppTheme.success),
                        const SizedBox(width: 8),
                        Text(
                          'Cobrado: $_selectedPaymentMethod',
                          style: TextStyle(color: AppTheme.success, fontSize: 13),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('CANCELAR', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.success,
              foregroundColor: Colors.white,
            ),
            child: const Text('CONFIRMAR'),
          ),
        ],
      ),
    );
    return result == true;
  }

  Future<void> _submitDelivery() async {
    // Inline validation
    if (!_validateFields()) {
      return;
    }

    // Show confirmation dialog
    final confirmed = await _showConfirmationDialog();
    if (!confirmed) return;

    setState(() => _isSubmitting = true);

    try {
      final provider = Provider.of<EntregasProvider>(context, listen: false);

      // Get signature
      final Uint8List? sigBytes = await _signatureController.toPngBytes();
      if (sigBytes == null) throw Exception('Error al procesar firma');
      final String base64Sig = base64Encode(sigBytes);

      // Build observations
      String finalObs = _observacionesController.text.trim();
      if (_nombreController.text.isNotEmpty) {
        finalObs += '\nReceptor: ${_nombreController.text} (${_dniController.text})';
      }
      if (_isPaid) {
        finalObs += '\nCobrado: $_selectedPaymentMethod';
      }

      // Submit
      bool success = await provider.marcarEntregado(
        albaranId: widget.albaran.id,
        firma: base64Sig,
        observaciones: finalObs,
        clientCode: widget.albaran.codigoCliente,
        dni: _dniController.text.trim(),
        nombre: _nombreController.text.trim(),
      );

      if (!mounted) return;

      setState(() => _isSubmitting = false);

      if (success) {
        HapticFeedback.heavyImpact();
        // Show share dialog before closing
        await _showShareReceiptDialog();
        if (!mounted) return;
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: const [
                Icon(Icons.check_circle, color: Colors.white),
                SizedBox(width: 12),
                Text('Entrega registrada correctamente'),
              ],
            ),
            backgroundColor: AppTheme.success,
          ),
        );
      } else {
        // Handle already delivered error specially
        final errorMsg = provider.error ?? 'Error al guardar entrega';
        if (errorMsg.contains('ya fue confirmada')) {
          _showAlreadyDeliveredDialog();
        } else {
          _showError(errorMsg);
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSubmitting = false);
        _showError('Error: $e');
      }
    }
  }

  /// Show dialog when delivery was already confirmed
  void _showAlreadyDeliveredDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: AppTheme.warning, size: 28),
            const SizedBox(width: 12),
            const Text(
              'Entrega ya confirmada',
              style: TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.bold, fontSize: 16),
            ),
          ],
        ),
        content: const Text(
          'Esta entrega ya fue confirmada anteriormente. No se pueden registrar duplicados.',
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 14),
        ),
        actions: [
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context); // Close dialog
              Navigator.pop(context); // Close modal
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue,
              foregroundColor: Colors.white,
            ),
            child: const Text('ENTENDIDO'),
          ),
        ],
      ),
    );
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.error_outline, color: Colors.white),
            const SizedBox(width: 12),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: AppTheme.error,
      ),
    );
  }

  /// Show dialog to share delivery receipt via WhatsApp or Email
  Future<void> _showShareReceiptDialog() async {
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Icon(Icons.share, color: AppTheme.neonBlue),
            const SizedBox(width: 12),
            const Text('Compartir Nota', style: TextStyle(color: AppTheme.textPrimary)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '¿Desea enviar la nota de entrega al cliente?',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
            const SizedBox(height: 20),
            // WhatsApp button
            _buildShareButton(
              icon: Icons.chat,
              label: 'Enviar por WhatsApp',
              color: const Color(0xFF25D366),
              onTap: () async {
                Navigator.pop(ctx);
                await _shareViaWhatsApp();
              },
            ),
            const SizedBox(height: 12),
            // Email button
            _buildShareButton(
              icon: Icons.email,
              label: 'Enviar por Email',
              color: AppTheme.neonBlue,
              onTap: () async {
                Navigator.pop(ctx);
                await _shareViaEmail();
              },
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Omitir', style: TextStyle(color: AppTheme.textTertiary)),
          ),
        ],
      ),
    );
  }

  Widget _buildShareButton({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return Material(
      color: color.withOpacity(0.15),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Icon(icon, color: color, size: 24),
              const SizedBox(width: 12),
              Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w600)),
              const Spacer(),
              Icon(Icons.chevron_right, color: color.withOpacity(0.6)),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _shareViaWhatsApp() async {
    try {
      // Generate receipt PDF via API
      final pdfData = await _generateReceiptPdf();
      if (pdfData == null) return;

      // Save PDF temporarily
      final tempDir = await getTemporaryDirectory();
      final file = File('${tempDir.path}/nota_entrega_${widget.albaran.numeroAlbaran}.pdf');
      await file.writeAsBytes(base64Decode(pdfData));

      // Get phone number
      final phone = widget.albaran.telefono.replaceAll(RegExp(r'[^\d]'), '');
      final message = 'Nota de entrega - Albarán ${widget.albaran.numeroFactura > 0 ? 'Factura ${widget.albaran.numeroFactura}' : widget.albaran.numeroAlbaran}';

      // Share via WhatsApp
      if (phone.isNotEmpty) {
        final whatsappUrl = 'https://wa.me/34$phone?text=${Uri.encodeComponent(message)}';
        if (await canLaunchUrl(Uri.parse(whatsappUrl))) {
          await launchUrl(Uri.parse(whatsappUrl), mode: LaunchMode.externalApplication);
        }
      }
      
      // Also share the file
      await Share.shareXFiles([XFile(file.path)], text: message);
    } catch (e) {
      debugPrint('Error sharing via WhatsApp: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error al compartir: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
  }

  Future<void> _shareViaEmail() async {
    try {
      final email = await _showEmailInputDialog();
      if (email == null || email.isEmpty) return;

      // Send via API
      // Send via API
      final response = await ApiClient.post(
        '/entregas/receipt/${widget.albaran.id}/email',
        {
          'email': email,
          'clientCode': widget.albaran.codigoCliente,
          'clientName': widget.albaran.nombreCliente,
          'albaranNum': widget.albaran.numeroAlbaran.toString(),
          'facturaNum': widget.albaran.numeroFactura > 0 ? widget.albaran.numeroFactura.toString() : null,
          'fecha': widget.albaran.fecha,
          'subtotal': widget.albaran.importeTotal * 0.96, // Approx base
          'iva': widget.albaran.importeTotal * 0.04,
          'total': widget.albaran.importeTotal,
          'formaPago': widget.albaran.formaPagoDesc,
          'items': _items.map((i) => {
            'cantidad': i.cantidadPedida,
            'descripcion': i.descripcion,
            'precio': i.precioUnitario,
          }).toList(),
        },
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(response['success'] == true ? 'Email enviado a $email' : 'Error al enviar email'),
            backgroundColor: response['success'] == true ? AppTheme.success : AppTheme.error,
          ),
        );
      }
    } catch (e) {
      debugPrint('Error sending email: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error al enviar email: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
  }

  Future<String?> _showEmailInputDialog() async {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        title: const Text('Enviar por Email', style: TextStyle(color: AppTheme.textPrimary)),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.emailAddress,
          decoration: InputDecoration(
            hintText: 'correo@ejemplo.com',
            filled: true,
            fillColor: AppTheme.darkBase,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
          ),
          style: const TextStyle(color: AppTheme.textPrimary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Cancelar', style: TextStyle(color: AppTheme.textTertiary)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.neonBlue),
            child: const Text('Enviar'),
          ),
        ],
      ),
    );
  }

  Future<String?> _generateReceiptPdf() async {
    try {
      final response = await ApiClient.post(
        '/entregas/receipt/${widget.albaran.id}',
        {
          'clientCode': widget.albaran.codigoCliente,
          'clientName': widget.albaran.nombreCliente,
          'albaranNum': widget.albaran.numeroAlbaran.toString(),
          'facturaNum': widget.albaran.numeroFactura > 0 ? widget.albaran.numeroFactura.toString() : null,
          'fecha': widget.albaran.fecha,
          'subtotal': widget.albaran.importeTotal * 0.96,
          'iva': widget.albaran.importeTotal * 0.04,
          'total': widget.albaran.importeTotal,
          'formaPago': widget.albaran.formaPagoDesc,
          'items': _items.map((i) => {
            'cantidad': i.cantidadPedida,
            'descripcion': i.descripcion,
            'precio': i.precioUnitario,
          }).toList(),
        },
      );

      if (response['success'] == true) {
        return response['pdfBase64'] as String?;
      }
      return null;
    } catch (e) {
      debugPrint('Error generating receipt: $e');
      return null;
    }
  }
}

