import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_pdfview/flutter_pdfview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/async_operation_modal.dart';
import 'package:gmp_app_mobilidad/core/widgets/email_form_modal.dart';
import 'package:gmp_app_mobilidad/core/widgets/pdf_preview_screen.dart';
import 'package:gmp_app_mobilidad/core/widgets/whatsapp_form_modal.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_product_image.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/zebra_print_service.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:signature/signature.dart';
import 'package:url_launcher/url_launcher.dart';

import 'rutero_detail_header.dart';
import 'rutero_detail_products.dart';
import 'rutero_detail_signature.dart';
import 'rutero_detail_payment.dart';
import 'rutero_detail_finalize.dart';
import 'rutero_detail_completed.dart';
import 'rutero_printer_config.dart';
import 'rutero_detail_tab_bar.dart';

bool _isValidDniNie(String value) {
  final cleaned = value.trim().toUpperCase();
  final regex = RegExp(r'^([XYZ]\d{7}|\d{8})[A-Z]$');
  if (!regex.hasMatch(cleaned)) return false;
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  var numStr = cleaned.substring(0, cleaned.length - 1);
  numStr = numStr
      .replaceFirst('X', '0')
      .replaceFirst('Y', '1')
      .replaceFirst('Z', '2');
  final num = int.tryParse(numStr);
  if (num == null) return false;
  return cleaned[cleaned.length - 1] == letters[num % 23];
}

class RuteroDetailModal extends StatefulWidget {
  const RuteroDetailModal(
      {required this.albaran, required this.ref, super.key});
  final AlbaranEntrega albaran;
  final WidgetRef ref;

  @override
  State<RuteroDetailModal> createState() => _RuteroDetailModalState();
}

class _RuteroDetailModalState extends State<RuteroDetailModal>
    with TickerProviderStateMixin {
  late TabController _tabController;
  late AnimationController _slideController;

  final TextEditingController _observacionesController =
      TextEditingController();
  final TextEditingController _dniController = TextEditingController();
  final TextEditingController _nombreController = TextEditingController();

  final SignatureController _signatureController = SignatureController(
    exportBackgroundColor: Colors.white,
  );

  final Map<String, bool> _productChecked = {};
  final Map<String, int> _productQuantities = {};

  List<EntregaItem> _items = [];
  bool _isLoadingItems = true;
  String? _itemsError;

  List<String> _suggestedNames = [];
  List<String> _suggestedDnis = [];

  String _selectedPaymentMethod = 'EFECTIVO';
  bool _isPaid = false;
  bool _isSubmitting = false;

  bool _tieneImpresora = false;
  String? _printerName;
  String? _printerAddress;
  bool _isTestingConnection = false;
  bool? _lastConnectionResult;

  String? _nombreError;
  String? _dniError;
  String? _firmaError;
  String? _pagoError;
  String? _observacionesError;

  String? _cachedPdfBase64;

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
    _loadPrinterConfig();
  }

  Future<void> _loadPrinterConfig() async {
    final has = await ZebraPrintService.tieneImpresora();
    final name = await ZebraPrintService.getSavedPrinterName();
    final addr = await ZebraPrintService.getSavedPrinterAddress();
    if (mounted) {
      setState(() {
        _tieneImpresora = has;
        _printerName = name;
        _printerAddress = addr;
      });
    }
  }

  Future<void> _testPrinterConnection() async {
    setState(() {
      _isTestingConnection = true;
      _lastConnectionResult = null;
    });
    final ok = await ZebraPrintService.testConnection();
    if (mounted) {
      setState(() {
        _isTestingConnection = false;
        _lastConnectionResult = ok;
      });
    }
  }

  Future<void> _selectAndSavePrinter() async {
    final device = await ZebraPrintService.selectPrinter(context);
    if (device != null && mounted) {
      final displayName =
          device.name ?? ZebraPrintService.maskAddress(device.address);
      await ZebraPrintService.savePrinter(
        device.address,
        displayName,
      );
      setState(() {
        _printerName = displayName;
        _printerAddress = device.address;
        _lastConnectionResult = null;
      });
    }
  }

  Widget _buildPrinterConfigSection() {
    return RuteroPrinterConfig(
      tieneImpresora: _tieneImpresora,
      printerName: _printerName,
      printerAddress: _printerAddress,
      isTestingConnection: _isTestingConnection,
      lastConnectionResult: _lastConnectionResult,
      onToggle: (val) async {
        if (val == true && _printerAddress == null) {
          await _selectAndSavePrinter();
          if (_printerAddress == null) return;
        }
        await ZebraPrintService.setTieneImpresora(val);
        setState(() {
          _tieneImpresora = val;
          _lastConnectionResult = null;
        });
      },
      onSelectPrinter: _selectAndSavePrinter,
      onTestConnection: _testPrinterConnection,
    );
  }

  Future<void> _loadItems() async {
    try {
      List<EntregaItem> items;
      if (widget.albaran.items.isNotEmpty) {
        items = widget.albaran.items;
      } else {
        final notifier = widget.ref.read(entregasProvider.notifier);
        final albaranDetalle = await notifier.obtenerDetalleAlbaran(
          widget.albaran.numeroAlbaran,
          widget.albaran.ejercicio,
          widget.albaran.serie,
          widget.albaran.terminal,
        );
        if (albaranDetalle == null) {
          if (mounted) {
            setState(() {
              _itemsError = 'No se pudo cargar el detalle del albaran';
              _isLoadingItems = false;
            });
          }
          return;
        }
        items = albaranDetalle.items;
      }

      final filtered = items.where((item) {
        final code = item.codigoArticulo.trim();
        final desc = item.descripcion.trim();
        if (code.isEmpty) return false;
        if (desc.toLowerCase().startsWith('pedido:')) return false;
        if (RegExp(r'^0+$').hasMatch(code)) return false;
        return true;
      }).toList();

      if (mounted) {
        setState(() {
          _items = filtered;
          _isLoadingItems = false;

          for (final item in filtered) {
            if (!_productChecked.containsKey(item.codigoArticulo)) {
              _productChecked[item.codigoArticulo] = true;
              _productQuantities[item.codigoArticulo] =
                  item.cantidadPedida.toInt();
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
          _suggestedDnis =
              signers.map((s) => s['DNI'].toString().trim()).toList();
          _suggestedNames =
              signers.map((s) => s['NOMBRE'].toString().trim()).toList();

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
    _signatureController.dispose();
    super.dispose();
  }

  bool get _isFactura => widget.albaran.numeroFactura > 0;
  bool get _isUrgent => widget.albaran.esCTR;
  bool get _isCompleted => widget.albaran.estado == EstadoEntrega.entregado;

  bool get _hasDiscrepancy {
    final anyQtyModified = _items.any((item) =>
        (_productQuantities[item.codigoArticulo] ??
            item.cantidadPedida.toInt()) !=
        item.cantidadPedida.toInt());
    final anyUnchecked =
        _items.any((item) => !(_productChecked[item.codigoArticulo] ?? true));
    return anyQtyModified || anyUnchecked;
  }

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
        height: Responsive.modalHeight(
          context,
          portraitFraction: _isCompleted ? 0.70 : 0.92,
          landscapeFraction: _isCompleted ? 0.80 : 0.95,
        ),
        decoration: BoxDecoration(
          color: AppTheme.darkBase,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          border: Border.all(
            color: _isCompleted
                ? AppTheme.success.withOpacity(0.3)
                : AppTheme.neonBlue.withOpacity(0.2),
          ),
        ),
        child: Column(
          children: [
            Container(
              margin: const EdgeInsets.only(top: 12, bottom: 8),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.borderColor,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            RuteroDetailHeader(
              albaran: widget.albaran,
              isCompleted: _isCompleted,
            ),
            if (_isCompleted)
              Expanded(child: _buildCompletedView())
            else ...[
              RuteroDetailTabBar(
                tabController: _tabController,
                isUrgent: _isUrgent,
              ),
              Expanded(
                child: TabBarView(
                  controller: _tabController,
                  physics: const NeverScrollableScrollPhysics(),
                  children: [
                    _buildProductsTab(),
                    _buildPaymentTab(),
                    _buildFinalizeTab(),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildCompletedView() {
    return RuteroDetailCompleted(
      albaran: widget.albaran,
      onPreviewReceiptPdf: _previewReceiptPdf,
      onDownloadReceiptPdf: _downloadReceiptPdf,
      onShareViaWhatsApp: _shareViaWhatsApp,
      onShareViaEmail: _shareViaEmail,
      buildPrinterConfigSection: _buildPrinterConfigSection,
      tieneImpresora: _tieneImpresora,
      items: _items,
      onShowZebraPrintPreview: _showZebraPrintPreview,
    );
  }

  Widget _buildProductsTab() {
    return RuteroDetailProducts(
      items: _items,
      isLoadingItems: _isLoadingItems,
      itemsError: _itemsError,
      productChecked: _productChecked,
      productQuantities: _productQuantities,
      ordenPreparacion: widget.albaran.ordenPreparacion?.toString(),
      onProductCheckedChanged: (code, value) {
        setState(() {
          _productChecked[code] = value;
        });
      },
      onQuantityChanged: (code, value) {
        setState(() {
          _productQuantities[code] = value;
          _cachedPdfBase64 = null;
        });
      },
      onShowQuantityEditDialog: _showQuantityEditDialog,
      onConfirmAll: () {
        HapticFeedback.lightImpact();
        final allChecked = _productChecked.values.every((v) => v);
        setState(() {
          for (final linea in _items) {
            _productChecked[linea.codigoArticulo] = !allChecked;
          }
        });
      },
      onContinueToPayment: () {
        HapticFeedback.mediumImpact();
        _tabController.animateTo(1);
      },
      onOpenFicha: _openFichaTecnica,
      onShowFullscreenImage: _showFullscreenImage,
    );
  }

  Widget _buildPaymentTab() {
    return RuteroDetailPayment(
      albaran: widget.albaran,
      selectedPaymentMethod: _selectedPaymentMethod,
      isPaid: _isPaid,
      pagoError: _pagoError,
      onPaymentMethodChanged: (method) {
        setState(() => _selectedPaymentMethod = method);
      },
      onPaidChanged: () {
        setState(() => _isPaid = !_isPaid);
      },
      onContinueToFinalize: () {
        HapticFeedback.mediumImpact();
        _tabController.animateTo(2);
      },
      getPaymentTypeLabel: _getPaymentTypeLabel,
    );
  }

  Widget _buildFinalizeTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildReceiverData(),
          const SizedBox(height: 16),
          if (_hasDiscrepancy) ...[
            _buildDiscrepancyWarning(),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _observacionesController,
            maxLines: 3,
            onChanged: (_) {
              if (_observacionesError != null) {
                setState(() => _observacionesError = null);
              }
            },
            style: const TextStyle(color: AppTheme.textPrimary),
            decoration: InputDecoration(
              labelText: 'Observaciones',
              hintText: 'Añadir nota sobre la entrega...',
              alignLabelWithHint: true,
              errorText: _observacionesError,
              filled: true,
              fillColor: AppTheme.darkCard,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
          const SizedBox(height: 12),
          _buildPrinterConfigSection(),
          const SizedBox(height: 20),
          _buildSignatureSection(),
          const SizedBox(height: 24),
          _buildSubmitButton(),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildReceiverData() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.darkCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.person, color: AppTheme.neonBlue, size: 20),
              SizedBox(width: 8),
              Text(
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
          RawAutocomplete<String>(
            textEditingController: _nombreController,
            focusNode: FocusNode(),
            optionsBuilder: (TextEditingValue textEditingValue) {
              if (textEditingValue.text.isEmpty) {
                return const Iterable<String>.empty();
              }
              return _suggestedNames.where((String option) {
                return option
                    .toUpperCase()
                    .contains(textEditingValue.text.toUpperCase());
              });
            },
            fieldViewBuilder:
                (context, controller, focusNode, onEditingComplete) {
              return TextField(
                controller: controller,
                focusNode: focusNode,
                onEditingComplete: onEditingComplete,
                onChanged: (_) {
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
                  elevation: 4,
                  color: AppTheme.darkCard,
                  child: SizedBox(
                    height: 200,
                    width: MediaQuery.of(context).size.width -
                        Responsive.value(context, phone: 40, desktop: 80),
                    child: ListView.builder(
                      padding: const EdgeInsets.all(8),
                      itemCount: options.length,
                      itemBuilder: (BuildContext context, int index) {
                        final option = options.elementAt(index);
                        return ListTile(
                          tileColor: AppTheme.darkBase,
                          title: Text(option,
                              style:
                                  const TextStyle(color: AppTheme.textPrimary)),
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
          RawAutocomplete<String>(
            textEditingController: _dniController,
            focusNode: FocusNode(),
            optionsBuilder: (TextEditingValue textEditingValue) {
              if (textEditingValue.text.isEmpty) {
                return const Iterable<String>.empty();
              }
              return _suggestedDnis.where((String option) {
                return option
                    .toUpperCase()
                    .contains(textEditingValue.text.toUpperCase());
              });
            },
            fieldViewBuilder:
                (context, controller, focusNode, onEditingComplete) {
              return TextField(
                controller: controller,
                focusNode: focusNode,
                onEditingComplete: onEditingComplete,
                onChanged: (_) {
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
                  elevation: 4,
                  color: AppTheme.darkCard,
                  child: SizedBox(
                    height: 200,
                    width: MediaQuery.of(context).size.width -
                        Responsive.value(context, phone: 40, desktop: 80),
                    child: ListView.builder(
                      padding: const EdgeInsets.all(8),
                      itemCount: options.length,
                      itemBuilder: (BuildContext context, int index) {
                        final option = options.elementAt(index);
                        return ListTile(
                          tileColor: AppTheme.darkBase,
                          title: Text(option,
                              style:
                                  const TextStyle(color: AppTheme.textPrimary)),
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
        ],
      ),
    );
  }

  Widget _buildDiscrepancyWarning() {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.orange.withOpacity(0.15),
        border: Border.all(color: Colors.orange),
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Text(
        'ATENCIÓN: Si marca en verde sin modificar cantidades, '
        'la entrega está OK. Si modifica o quita cantidades, la '
        'entrega NO coincide — debe añadir observaciones en la '
        "pestaña 'Observaciones' antes de confirmar.",
        style: TextStyle(
          color: Colors.orange,
          fontSize: 13,
        ),
      ),
    );
  }

  Widget _buildSignatureSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Row(
              children: [
                Icon(Icons.draw, color: AppTheme.neonBlue, size: 20),
                SizedBox(width: 8),
                Text(
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
              onPressed: _signatureController.clear,
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
          height: Responsive.isLandscape(context)
              ? 120.0
              : Responsive.value(context, phone: 120, desktop: 160),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color:
                  _firmaError != null ? AppTheme.error : AppTheme.borderColor,
              width: _firmaError != null ? 2 : 1,
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Signature(
              controller: _signatureController,
              backgroundColor: Colors.white,
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
      ],
    );
  }

  Widget _buildSubmitButton() {
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
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
            : const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
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
    );
  }

  Future<void> _showQuantityEditDialog(EntregaItem linea, int current) async {
    final controller = TextEditingController(text: '$current');
    final result = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        title: Row(
          children: [
            const Icon(Icons.edit, color: AppTheme.neonBlue, size: 22),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                linea.descripcion,
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 14,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Cantidad original: ${linea.cantidadPedida.toInt()}',
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              autofocus: true,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
              decoration: InputDecoration(
                labelText: 'Nueva cantidad',
                filled: true,
                fillColor: AppTheme.darkBase,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
              ],
              onSubmitted: (val) {
                final n = int.tryParse(val);
                if (n != null && n >= 0) Navigator.pop(ctx, n);
              },
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text(
              'CANCELAR',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
          ),
          ElevatedButton(
            onPressed: () {
              final n = int.tryParse(controller.text);
              if (n != null && n >= 0) Navigator.pop(ctx, n);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.neonBlue,
            ),
            child: const Text('ACEPTAR'),
          ),
        ],
      ),
    );
    if (result != null && mounted) {
      HapticFeedback.selectionClick();
      setState(() {
        _productQuantities[linea.codigoArticulo] = result;
        _cachedPdfBase64 = null;
      });
    }
  }

  void _showFullscreenImage(String imageUrl, String name) {
    Navigator.of(context).push<void>(
      PageRouteBuilder<void>(
        opaque: false,
        barrierColor: Colors.black87,
        barrierDismissible: true,
        pageBuilder: (ctx, anim, secondAnim) {
          return Scaffold(
            backgroundColor: Colors.black,
            appBar: AppBar(
              backgroundColor: Colors.black,
              elevation: 0,
              title: Text(
                name,
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 14,
                ),
                overflow: TextOverflow.ellipsis,
              ),
              leading: IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                onPressed: () => Navigator.of(ctx).pop(),
              ),
            ),
            body: Center(
              child: InteractiveViewer(
                minScale: 0.5,
                maxScale: 5,
                child: SmartProductImage(
                  imageUrl: imageUrl,
                  productCode: '',
                  productName: name,
                  fit: BoxFit.contain,
                  headers: {
                    'Accept': 'image/*',
                    if (ApiClient.dio.options.headers['Authorization'] != null)
                      'Authorization': ApiClient
                          .dio.options.headers['Authorization'] as String,
                  },
                ),
              ),
            ),
          );
        },
        transitionsBuilder: (ctx, anim, secondAnim, child) {
          return FadeTransition(opacity: anim, child: child);
        },
      ),
    );
  }

  Future<void> _openFichaTecnica(EntregaItem linea) async {
    final navigator = Navigator.of(context);
    final url =
        '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(linea.codigoArticulo.trim())}/ficha';
    final filePath =
        '${(await getTemporaryDirectory()).path}/${linea.codigoArticulo.trim()}_ficha.pdf';

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        content: Row(
          children: [
            const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppTheme.neonBlue,
              ),
            ),
            const SizedBox(width: 16),
            Text(
              'Descargando ficha técnica...',
              style: TextStyle(color: Colors.grey[300]),
            ),
          ],
        ),
      ),
    );

    try {
      await ApiClient.dio.download(url, filePath);

      if (!navigator.canPop()) {
        Navigator.of(context).pop();
      }

      if (!File(filePath).existsSync()) {
        if (navigator.canPop()) navigator.pop();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No se encontró la ficha técnica'),
          ),
        );
        return;
      }

      await navigator.push<void>(
        MaterialPageRoute<void>(
          builder: (_) => Scaffold(
            backgroundColor: Colors.white,
            appBar: AppBar(
              title: Text(
                'Ficha - ${linea.codigoArticulo.trim()}',
                style: const TextStyle(fontSize: 14),
              ),
              backgroundColor: AppTheme.darkSurface,
              elevation: 0,
            ),
            body: PDFView(
              filePath: filePath,
              onError: (error) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Error al abrir PDF: $error')),
                );
              },
            ),
          ),
        ),
      );
    } catch (e) {
      if (navigator.canPop()) navigator.pop();
      final msg = e.toString().contains('404')
          ? 'No hay ficha técnica para este producto'
          : 'Error al descargar: $e';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg)),
      );
    }
  }

  String _getPaymentTypeLabel() {
    final code = widget.albaran.tipoPago.toUpperCase().trim();
    if (code == '01' || code == 'CNT' || code.contains('CONTADO')) {
      return 'CONTADO';
    }
    if (code.contains('REP')) return 'REPOSICIÓN';
    if (code.contains('MEN')) return 'MENSUAL';
    if (code.contains('CRE') || code == 'CR') return 'CRÉDITO';
    if (code.contains('TAR')) return 'TARJETA';
    if (code.contains('TRA')) return 'TRANSFERENCIA';
    return code;
  }

  String _sanitizeTokenPart(Object? value) {
    final raw = value?.toString().trim() ?? '';
    if (raw.isEmpty) return 'NA';
    return raw.replaceAll(RegExp('[^A-Za-z0-9_.:-]'), '_');
  }

  String _ruteroCobroIdempotencyToken() {
    final serie = widget.albaran.serie.trim().isEmpty
        ? 'SIN_SERIE'
        : widget.albaran.serie.trim();
    final parts = [
      'RUTERO',
      'COBRO',
      'GMP',
      widget.albaran.ejercicio,
      'B',
      serie,
      widget.albaran.terminal,
      widget.albaran.numeroAlbaran,
      1,
      widget.albaran.codigoCliente,
    ];
    return parts.map(_sanitizeTokenPart).join(':');
  }

  String _codigoRepartidorCobro() {
    final fromAlbaran = widget.albaran.codigoRepartidor.trim();
    if (fromAlbaran.isNotEmpty) return fromAlbaran;

    final repartidorState =
        widget.ref.read(entregasProvider).repartidorId.trim();
    if (repartidorState.contains(',')) {
      return repartidorState.split(',').first.trim();
    }
    return repartidorState;
  }

  Map<String, dynamic> _cobroRuteroPayload() {
    final codigoCliente = widget.albaran.codigoCliente.trim();
    final codigoRepartidor = _codigoRepartidorCobro();
    if (codigoCliente.isEmpty) {
      throw Exception('Falta el codigo de cliente para registrar el cobro');
    }
    if (codigoRepartidor.isEmpty) {
      throw Exception('Falta el codigo de repartidor para registrar el cobro');
    }

    final importeCobrado =
        double.parse(widget.albaran.importeTotal.toStringAsFixed(2));
    return {
      'entregaId': widget.albaran.id,
      'codigoCliente': codigoCliente,
      'nombreCliente': widget.albaran.nombreCliente,
      'codigoRepartidor': codigoRepartidor,
      'tipoDocumento': 'ALBARAN',
      'origenDocumento': 'B',
      // TODO(repartidor): usar subempresa del albaran cuando el modelo
      // la exponga.
      'subempresaDocumento': 'GMP',
      'ejercicioDocumento': widget.albaran.ejercicio,
      'serieDocumento': widget.albaran.serie,
      'terminalDocumento': widget.albaran.terminal,
      'numeroDocumento': widget.albaran.numeroAlbaran,
      'xdeDocumento': 1,
      'importeCobrado': importeCobrado,
      'importePendiente': 0,
      'formaPago': _selectedPaymentMethod,
      'pantallaOrigen': 'RUTERO',
      'idempotencyToken': _ruteroCobroIdempotencyToken(),
      'notas': 'Cobro registrado desde Rutero al confirmar entrega',
    };
  }

  Future<bool> _confirmarEntregaConCobroRutero({
    required String firmaBase64,
    required String observaciones,
  }) async {
    String? firmaPath;
    final signatureResponse =
        await ApiClient.post('/entregas/uploads/signature', {
      'entregaId': widget.albaran.id,
      'firma': firmaBase64,
      'clientCode': widget.albaran.codigoCliente,
      'dni': _dniController.text.trim(),
      'nombre': _nombreController.text.trim(),
    });

    if (signatureResponse['success'] == true) {
      firmaPath = signatureResponse['path'] as String?;
    }

    final response = await ApiClient.post(
      '/repartidor-finanzas/rutero/confirm-delivery-cobro',
      {
        'delivery': {
          'itemId': widget.albaran.id,
          'status': 'ENTREGADO',
          'repartidorId': _codigoRepartidorCobro(),
          'observaciones': observaciones,
          'firma': firmaPath,
        },
        'cobro': _cobroRuteroPayload(),
      },
    );

    if (response['success'] != true) {
      throw Exception(
        response['error']?.toString() ?? 'No se pudo registrar entrega y cobro',
      );
    }

    widget.albaran.firma = firmaPath;
    widget.albaran.estado = EstadoEntrega.entregado;
    await widget.ref
        .read(entregasProvider.notifier)
        .cargarAlbaranesPendientes();
    return true;
  }

  void _clearValidationErrors() {
    setState(() {
      _nombreError = null;
      _dniError = null;
      _firmaError = null;
      _pagoError = null;
      _observacionesError = null;
    });
  }

  bool _validateFields() {
    var isValid = true;
    _clearValidationErrors();

    if (_nombreController.text.trim().isEmpty) {
      _nombreError = 'El nombre del receptor es obligatorio';
      isValid = false;
    }

    final dniText = _dniController.text.trim();
    if (dniText.isEmpty) {
      _dniError = 'El DNI/NIF es obligatorio';
      isValid = false;
    } else if (!_isValidDniNie(dniText)) {
      _dniError = 'Formato no válido (ej: 12345678A o X1234567B)';
      isValid = false;
    }

    final anyQtyModified = _items.any((item) =>
        (_productQuantities[item.codigoArticulo] ??
            item.cantidadPedida.toInt()) !=
        item.cantidadPedida.toInt());
    final anyUnchecked =
        _items.any((item) => !(_productChecked[item.codigoArticulo] ?? true));
    final hasDiscrepancy = anyQtyModified || anyUnchecked;
    if (hasDiscrepancy && _observacionesController.text.trim().isEmpty) {
      _observacionesError = anyUnchecked
          ? 'Obligatorio: hay productos sin marcar como entregados'
          : 'Obligatorio cuando se modifican cantidades';
      isValid = false;
      _tabController.animateTo(2);
    }

    if (_signatureController.isEmpty) {
      _firmaError = anyQtyModified
          ? 'FIRMA OBLIGATORIA: las cantidades no coinciden con el pedido'
          : 'La firma es obligatoria';
      _tabController.animateTo(2);
      isValid = false;
    }

    if (_isUrgent && !_isPaid) {
      _pagoError = '⚠️ COBRO OBLIGATORIO';
      _tabController.animateTo(1);
      isValid = false;
    }

    setState(() {});

    if (!isValid) {
      HapticFeedback.heavyImpact();
    }

    return isValid;
  }

  Future<bool> _showConfirmationDialog() async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.check_circle_outline,
                color: AppTheme.neonBlue, size: 28),
            SizedBox(width: 12),
            Text(
              'Confirmar Entrega',
              style: TextStyle(
                  color: AppTheme.textPrimary, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
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
                      const Icon(Icons.description,
                          size: 16, color: AppTheme.textTertiary),
                      const SizedBox(width: 8),
                      Text(
                        _isFactura
                            ? 'Factura ${widget.albaran.numeroFactura}'
                            : 'Albarán ${widget.albaran.numeroAlbaran}',
                        style: const TextStyle(
                            color: AppTheme.textPrimary,
                            fontWeight: FontWeight.w500),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.person,
                          size: 16, color: AppTheme.textTertiary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${_nombreController.text} (${_dniController.text})',
                          style: const TextStyle(
                              color: AppTheme.textSecondary, fontSize: 13),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                  if (_isPaid) ...[
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(Icons.payment,
                            size: 16, color: AppTheme.success),
                        const SizedBox(width: 8),
                        Text(
                          'Cobrado: $_selectedPaymentMethod',
                          style: const TextStyle(
                              color: AppTheme.success, fontSize: 13),
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
            child: const Text('CANCELAR',
                style: TextStyle(color: AppTheme.textSecondary)),
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
    return result ?? false;
  }

  Future<void> _submitDelivery() async {
    if (!_validateFields()) {
      return;
    }

    final confirmed = await _showConfirmationDialog();
    if (!confirmed) return;

    setState(() => _isSubmitting = true);

    try {
      final notifier = widget.ref.read(entregasProvider.notifier);

      final sigBytes = await _signatureController.toPngBytes();
      if (sigBytes == null) throw Exception('Error al procesar firma');
      final base64Sig = base64Encode(sigBytes);

      var finalObs = _observacionesController.text.trim();
      final qtyChanges = <String>[];
      for (final item in _items) {
        final orig = item.cantidadPedida.toInt();
        final actual = _productQuantities[item.codigoArticulo] ?? orig;
        if (actual != orig) {
          qtyChanges.add(
            '${item.descripcion}: $orig -> $actual',
          );
        }
      }
      if (qtyChanges.isNotEmpty) {
        finalObs += '\n--- Cambios de cantidad ---\n${qtyChanges.join('\n')}';
      }
      if (_nombreController.text.isNotEmpty) {
        finalObs +=
            '\nReceptor: ${_nombreController.text} (${_dniController.text})';
      }
      final bool success;
      if (_isPaid) {
        finalObs += '\nCobrado: $_selectedPaymentMethod';
        success = await _confirmarEntregaConCobroRutero(
          firmaBase64: base64Sig,
          observaciones: finalObs,
        );
      } else {
        success = await notifier.marcarEntregado(
          albaranId: widget.albaran.id,
          firma: base64Sig,
          observaciones: finalObs,
          clientCode: widget.albaran.codigoCliente,
          dni: _dniController.text.trim(),
          nombre: _nombreController.text.trim(),
        );
      }

      if (!mounted) return;

      setState(() => _isSubmitting = false);

      if (success) {
        HapticFeedback.heavyImpact();
        final state = widget.ref.read(entregasProvider);
        final updated = state.albaranes.firstWhere(
          (a) => a.id == widget.albaran.id,
          orElse: () => widget.albaran,
        );
        widget.albaran.firma = updated.firma;
        widget.albaran.estado = EstadoEntrega.entregado;
        if (_tieneImpresora) {
          await _showZebraPrintPreview();
        }
        await _showShareReceiptDialog();
        if (!mounted) return;
        final messenger = ScaffoldMessenger.of(context);
        Navigator.pop(context);
        messenger.showSnackBar(
          const SnackBar(
            content: Row(children: [
              Icon(Icons.check_circle, color: Colors.white),
              SizedBox(width: 12),
              Text('Entrega registrada correctamente'),
            ]),
            backgroundColor: Colors.green,
            duration: Duration(seconds: 2),
          ),
        );
      } else {
        final state = widget.ref.read(entregasProvider);
        final errorMsg = state.error ?? 'Error al guardar entrega';
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

  void _showAlreadyDeliveredDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded,
                color: AppTheme.warning, size: 28),
            SizedBox(width: 12),
            Text(
              'Entrega ya confirmada',
              style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontWeight: FontWeight.bold,
                  fontSize: 16),
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
              Navigator.pop(context);
              Navigator.pop(context);
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

  Future<void> _showZebraPrintPreview() async {
    final obsController = TextEditingController(
      text: _observacionesController.text.trim(),
    );
    var isPrinting = false;
    final parentMessenger = ScaffoldMessenger.of(context);

    String? signatureGrf;
    if (_signatureController.isNotEmpty) {
      try {
        final sigPng = await _signatureController.toPngBytes();
        if (sigPng != null) {
          signatureGrf = await ZebraPrintService.convertSignatureToGrf(sigPng);
        }
      } catch (e) {
        debugPrint('[ZEBRA] Error converting signature to GRF: $e');
      }
    }

    if (!mounted) return;

    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          final zpl = ZebraPrintService.generateDeliveryZpl(
            albaran: widget.albaran,
            items: _items,
            observaciones: obsController.text.trim(),
            receptorNombre: _nombreController.text.trim(),
            receptorDni: _dniController.text.trim(),
            signatureGrf: signatureGrf,
            fechaFirma: DateTime.now(),
          );

          return AlertDialog(
            backgroundColor: AppTheme.darkCard,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            title: const Row(
              children: [
                Icon(Icons.print, color: AppTheme.neonCyan),
                SizedBox(width: 12),
                Text('Imprimir Ticket',
                    style: TextStyle(color: AppTheme.textPrimary)),
              ],
            ),
            content: SizedBox(
              width: double.maxFinite,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.darkBase,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Granja Mari Pepa S.L.',
                              style: TextStyle(
                                  color: AppTheme.textPrimary,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 16)),
                          const SizedBox(height: 4),
                          Text(
                            widget.albaran.numeroFactura > 0
                                ? 'Factura: ${widget.albaran.serieFactura}/${widget.albaran.numeroFactura}'
                                : 'Albarán: ${widget.albaran.serie}/${widget.albaran.numeroAlbaran}',
                            style: const TextStyle(
                                color: AppTheme.neonCyan, fontSize: 14),
                          ),
                          Text('Fecha: ${widget.albaran.fecha}',
                              style: const TextStyle(
                                  color: AppTheme.textSecondary, fontSize: 13)),
                          const Divider(color: AppTheme.textTertiary),
                          Text('Cliente: ${widget.albaran.nombreCliente}',
                              style: const TextStyle(
                                  color: AppTheme.textPrimary, fontSize: 13)),
                          const SizedBox(height: 8),
                          ...(_items.take(5).map((item) => Padding(
                                padding: const EdgeInsets.only(bottom: 2),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Text(item.descripcion,
                                          style: const TextStyle(
                                              color: AppTheme.textSecondary,
                                              fontSize: 12),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis),
                                    ),
                                    Text(
                                      'x${item.cantidadPedida.toStringAsFixed(0)}  ${(item.cantidadPedida * item.precioUnitario).toStringAsFixed(2)}€',
                                      style: const TextStyle(
                                          color: AppTheme.textSecondary,
                                          fontSize: 12),
                                    ),
                                  ],
                                ),
                              ))),
                          if (_items.length > 5)
                            Text('... +${_items.length - 5} más',
                                style: const TextStyle(
                                    color: AppTheme.textTertiary,
                                    fontSize: 11)),
                          const Divider(color: AppTheme.textTertiary),
                          Text(
                              'TOTAL: ${widget.albaran.importeTotal.toStringAsFixed(2)} €',
                              style: const TextStyle(
                                  color: AppTheme.textPrimary,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 16)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Text('Observaciones (editable):',
                        style: TextStyle(
                            color: AppTheme.textSecondary, fontSize: 13)),
                    const SizedBox(height: 8),
                    TextField(
                      controller: obsController,
                      maxLines: 3,
                      decoration: InputDecoration(
                        hintText: 'Añadir observaciones para el ticket...',
                        hintStyle:
                            const TextStyle(color: AppTheme.textTertiary),
                        filled: true,
                        fillColor: AppTheme.darkBase,
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: BorderSide.none),
                        focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide:
                                const BorderSide(color: AppTheme.neonCyan)),
                      ),
                      style: const TextStyle(
                          color: AppTheme.textPrimary, fontSize: 14),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: isPrinting ? null : () => Navigator.pop(ctx),
                child: const Text('Omitir',
                    style: TextStyle(color: AppTheme.textTertiary)),
              ),
              ElevatedButton.icon(
                onPressed: isPrinting
                    ? null
                    : () async {
                        setDialogState(() => isPrinting = true);
                        final success = await ZebraPrintService.printZpl(zpl);
                        if (!ctx.mounted) return;
                        setDialogState(() => isPrinting = false);
                        if (success) {
                          Navigator.pop(ctx);
                          parentMessenger.showSnackBar(
                            const SnackBar(
                              content: Row(children: [
                                Icon(Icons.check_circle, color: Colors.white),
                                SizedBox(width: 12),
                                Text('Ticket enviado a impresora'),
                              ]),
                              backgroundColor: Colors.green,
                            ),
                          );
                        } else {
                          parentMessenger.showSnackBar(
                            const SnackBar(
                              content: Row(children: [
                                Icon(Icons.error_outline, color: Colors.white),
                                SizedBox(width: 12),
                                Expanded(
                                    child: Text(
                                        'Error al imprimir. Verifica que la Zebra está encendida y vinculada.')),
                              ]),
                              backgroundColor: AppTheme.error,
                            ),
                          );
                        }
                      },
                icon: isPrinting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.print),
                label:
                    Text(isPrinting ? 'Imprimiendo...' : 'Imprimir en Zebra'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.neonCyan,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8)),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _showShareReceiptDialog() async {
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.darkCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.share, color: AppTheme.neonBlue),
            SizedBox(width: 12),
            Text('Compartir Nota',
                style: TextStyle(color: AppTheme.textPrimary)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              '¿Desea enviar la nota de entrega al cliente?',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
            const SizedBox(height: 20),
            _buildShareButton(
              icon: Icons.visibility,
              label: 'Ver PDF',
              color: AppTheme.neonPurple,
              onTap: () async {
                Navigator.pop(ctx);
                await _previewReceiptPdf();
              },
            ),
            const SizedBox(height: 12),
            _buildShareButton(
              icon: Icons.download,
              label: 'Descargar PDF',
              color: AppTheme.neonCyan,
              onTap: () async {
                Navigator.pop(ctx);
                await _downloadReceiptPdf();
              },
            ),
            const SizedBox(height: 12),
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
            child: const Text('Omitir',
                style: TextStyle(color: AppTheme.textTertiary)),
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
              Text(label,
                  style: TextStyle(color: color, fontWeight: FontWeight.w600)),
              const Spacer(),
              Icon(Icons.chevron_right, color: color.withOpacity(0.6)),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _previewReceiptPdf() async {
    final modal =
        AsyncOperationModal.show(context, text: 'Generando vista previa...');
    try {
      final pdfData = _cachedPdfBase64 ?? await _generateReceiptPdf();
      if (pdfData == null) throw Exception('No se pudo generar el PDF');
      _cachedPdfBase64 = pdfData;

      modal.close();
      if (!mounted) return;

      final pdfBytes = base64Decode(pdfData);
      final docLabel = widget.albaran.numeroFactura > 0
          ? 'Factura ${widget.albaran.numeroFactura}'
          : 'Albarán ${widget.albaran.numeroAlbaran}';
      final fileName =
          'Nota_Entrega_${widget.albaran.numeroFactura > 0 ? "F${widget.albaran.numeroFactura}" : "A${widget.albaran.numeroAlbaran}"}.pdf';

      if (!mounted) return;
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => PdfPreviewScreen(
            pdfBytes: pdfBytes,
            title: docLabel,
            fileName: fileName,
            onEmailTap: () {
              Navigator.pop(context);
              _shareViaEmail();
            },
            onWhatsAppTap: () {
              Navigator.pop(context);
              _shareViaWhatsApp();
            },
          ),
        ),
      );
    } catch (e) {
      modal.error('Error al visualizar: $e', onRetry: _previewReceiptPdf);
    }
  }

  Future<void> _downloadReceiptPdf() async {
    final modal = AsyncOperationModal.show(context, text: 'Preparando PDF...');
    try {
      final pdfData = _cachedPdfBase64 ?? await _generateReceiptPdf();
      if (pdfData == null) {
        throw Exception('Error al generar el PDF');
      }
      _cachedPdfBase64 = pdfData;

      final tempDir = await getTemporaryDirectory();
      final docLabel = widget.albaran.numeroFactura > 0
          ? 'Factura_${widget.albaran.numeroFactura}'
          : 'Albaran_${widget.albaran.numeroAlbaran}';
      final dlTs = DateTime.now().millisecondsSinceEpoch;
      final file = File('${tempDir.path}/Nota_Entrega_${docLabel}_$dlTs.pdf');
      await file.writeAsBytes(base64Decode(pdfData));

      modal.close();
      if (!mounted) return;

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
        text: 'Guardar $docLabel',
        subject: docLabel,
        sharePositionOrigin: origin,
      );
    } catch (e) {
      modal.close();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al descargar PDF: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _shareViaWhatsApp() async {
    final result = await WhatsAppFormModal.show(
      context,
      defaultMessage:
          'Nota de entrega - Albarán ${widget.albaran.numeroFactura > 0 ? 'Factura ${widget.albaran.numeroFactura}' : widget.albaran.numeroAlbaran}',
    );
    if (result == null || !mounted) return;

    final modal =
        AsyncOperationModal.show(context, text: 'Preparando documento...');
    try {
      final pdfData = _cachedPdfBase64 ?? await _generateReceiptPdf();
      if (pdfData == null) throw Exception('Error generando PDF');
      _cachedPdfBase64 = pdfData;

      final tempDir = await getTemporaryDirectory();
      final ts = DateTime.now().millisecondsSinceEpoch;
      final file = File(
        '${tempDir.path}/nota_entrega_${widget.albaran.numeroAlbaran}_$ts.pdf',
      );
      await file.writeAsBytes(base64Decode(pdfData));

      final response = await ApiClient.post(
        '/entregas/receipt/${widget.albaran.id}/whatsapp',
        {
          'telefono': result.phone,
          'clienteNombre': widget.albaran.nombreCliente,
        },
      );

      modal.close();
      if (!mounted) return;

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

      if (response['success'] == true && response['whatsappUrl'] != null) {
        final whatsappUrl = response['whatsappUrl'] as String;
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

  Future<void> _shareViaEmail() async {
    final result = await EmailFormModal.show(
      context,
      defaultSubject: 'Nota de entrega - ${widget.albaran.nombreCliente}',
      defaultBody:
          'Adjunto le remitimos la nota de entrega correspondiente.\n\nSaludos,\nGranja Mari Pepa',
    );
    if (result == null || !mounted) return;

    final modal = AsyncOperationModal.show(context, text: 'Enviando email...');
    try {
      final response = await ApiClient.post(
        '/entregas/receipt/${widget.albaran.id}/email',
        {
          'email': result.email,
          'subject': result.subject,
          'body': result.body,
          'signaturePath': widget.albaran.firma,
          'clientCode': widget.albaran.codigoCliente,
          'clientName': widget.albaran.nombreCliente,
          'albaranNum':
              '${widget.albaran.serie}-${widget.albaran.terminal}-${widget.albaran.numeroAlbaran}',
          'facturaNum': widget.albaran.numeroFactura > 0
              ? widget.albaran.numeroFactura.toString()
              : null,
          'fecha': widget.albaran.fecha,
          'subtotal': widget.albaran.importeTotal,
          'iva': 0,
          'total': widget.albaran.importeTotal,
          'formaPago': widget.albaran.formaPagoDesc,
          'ordenPreparacion': widget.albaran.ordenPreparacion,
          'firmante': _nombreController.text.trim(),
          'firmanteDni': _dniController.text.trim(),
          'repartidor': widget.albaran.nombreRepartidor.isNotEmpty
              ? widget.albaran.nombreRepartidor
              : widget.albaran.codigoRepartidor,
          'items': _items
              .map((i) => {
                    'cantidad': _productQuantities[i.codigoArticulo] ??
                        i.cantidadPedida.toInt(),
                    'descripcion': i.descripcion,
                    'precio': i.precioUnitario,
                  })
              .toList(),
        },
      );

      if (response['success'] == true) {
        modal.success('Email enviado a ${result.email}');
      } else {
        modal.error((response['error'] as String?) ?? 'Error al enviar email');
      }
    } catch (e) {
      modal.error('Error al enviar email: $e');
    }
  }

  Future<String?> _generateReceiptPdf() async {
    try {
      final response = await ApiClient.post(
        '/entregas/receipt/${widget.albaran.id}',
        {
          'signaturePath': widget.albaran.firma,
          'clientCode': widget.albaran.codigoCliente,
          'clientName': widget.albaran.nombreCliente,
          'albaranNum':
              '${widget.albaran.serie}-${widget.albaran.terminal}-${widget.albaran.numeroAlbaran}',
          'facturaNum': widget.albaran.numeroFactura > 0
              ? widget.albaran.numeroFactura.toString()
              : null,
          'fecha': widget.albaran.fecha,
          'subtotal': widget.albaran.importeTotal,
          'iva': 0,
          'total': widget.albaran.importeTotal,
          'formaPago': widget.albaran.formaPagoDesc,
          'ordenPreparacion': widget.albaran.ordenPreparacion,
          'firmante': _nombreController.text.trim(),
          'firmanteDni': _dniController.text.trim(),
          'repartidor': widget.albaran.nombreRepartidor.isNotEmpty
              ? widget.albaran.nombreRepartidor
              : widget.albaran.codigoRepartidor,
          'items': _items
              .map((i) => {
                    'cantidad': _productQuantities[i.codigoArticulo] ??
                        i.cantidadPedida.toInt(),
                    'descripcion': i.descripcion,
                    'precio': i.precioUnitario,
                  })
              .toList(),
        },
      );

      if (response['success'] == true) {
        return response['pdfBase64'] as String?;
      }
      debugPrint('[RECEIPT] API error: ${response['error']}');
      return null;
    } catch (e) {
      debugPrint('[RECEIPT] Error generating receipt: $e');
      return null;
    }
  }
}
