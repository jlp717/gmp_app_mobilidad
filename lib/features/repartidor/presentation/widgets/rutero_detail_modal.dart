import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_pdfview/flutter_pdfview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_sync_notifier.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/async_operation_modal.dart';
import 'package:gmp_app_mobilidad/core/widgets/fullscreen_image_viewer.dart';
import 'package:gmp_app_mobilidad/core/widgets/pdf_preview_screen.dart';
import 'package:gmp_app_mobilidad/core/widgets/whatsapp_form_modal.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_offline.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_upload_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_receipt_contract.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/zebra_print_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_delivery_validation.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_operation_safety.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_completed.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_header.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_payment.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_products.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_tab_bar.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_print_preview_dialog.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_printer_config.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/providers/repartidor_finanzas_providers.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';
import 'package:signature/signature.dart';
import 'package:url_launcher/url_launcher.dart';

enum RepartoConfirmationErrorDisposition {
  alreadyConfirmed,
  manualReview,
  retryable,
}

@visibleForTesting
Future<void> runRuteroPostConfirmationEffects({
  required bool shouldPrint,
  required Future<void> Function() printTicket,
  required Future<void> Function() shareReceipt,
}) async {
  if (shouldPrint) {
    unawaited(Future<void>.sync(printTicket).catchError((Object _) {}));
  }
  await shareReceipt();
}

/// Starts non-critical read invalidation after the server has durably accepted
/// a delivery. This must never delay the terminal confirmation outcome: the
/// journal acknowledgement is already persisted before it is called.
@visibleForTesting
void scheduleRuteroAcknowledgedRefresh({
  required Future<void> Function() invalidateCaches,
  required Future<void> Function() refreshProviders,
}) {
  unawaited(
    Future<void>(() async {
      try {
        await invalidateCaches();
        await refreshProviders();
      } catch (_) {
        // A later resume or pull-to-refresh retries reads without replaying ACK.
      }
    }),
  );
}

RepartoConfirmationErrorDisposition repartoConfirmationErrorDisposition({
  required Object error,
  required bool acknowledged,
}) {
  if (error is RepartoAlreadyAcknowledgedException) {
    return RepartoConfirmationErrorDisposition.alreadyConfirmed;
  }
  if (error is RepartoReceiptUnavailableException ||
      error is RepartoConfirmationConflictException ||
      error is RepartoJournalCorruptionException) {
    return RepartoConfirmationErrorDisposition.manualReview;
  }
  if (error is ApiException) {
    if (acknowledged &&
        error.statusCode == 409 &&
        error.code == 'DELIVERY_ALREADY_CONFIRMED') {
      return RepartoConfirmationErrorDisposition.alreadyConfirmed;
    }
    final code = error.code ?? '';
    final status = error.statusCode ?? 0;
    // Payment / capability failures are actionable: show the real message and
    // allow retry after the driver adjusts amount/method or connectivity.
    if (status == 422 ||
        status == 503 ||
        code == 'INVALID_PAYMENT_AMOUNT' ||
        code == 'PAYMENT_DOCUMENT_UNAVAILABLE' ||
        code == 'REPARTO_COBROS_CAPABILITY_UNAVAILABLE' ||
        code == 'REPARTO_COBRO_COMMERCIAL_CONFLICT' ||
        code == 'REPARTO_INVALID_PAYMENT') {
      return RepartoConfirmationErrorDisposition.retryable;
    }
    if (status >= 400 && status < 500 && status != 409) {
      return RepartoConfirmationErrorDisposition.retryable;
    }
    return RepartoConfirmationErrorDisposition.manualReview;
  }
  return RepartoConfirmationErrorDisposition.retryable;
}

class RepartoConfirmationErrorPresentation {
  const RepartoConfirmationErrorPresentation({
    required this.message,
    required this.canRetry,
  });

  final String message;
  final bool canRetry;
}

RepartoConfirmationErrorPresentation repartoConfirmationErrorPresentation({
  required Object error,
  required bool acknowledged,
}) {
  final disposition = repartoConfirmationErrorDisposition(
    error: error,
    acknowledged: acknowledged,
  );
  switch (disposition) {
    case RepartoConfirmationErrorDisposition.alreadyConfirmed:
      return const RepartoConfirmationErrorPresentation(
        message: 'Esta entrega ya fue confirmada.',
        canRetry: false,
      );
    case RepartoConfirmationErrorDisposition.manualReview:
      if (error is ApiException) {
        final detail = error.message.trim();
        if (detail.isNotEmpty) {
          return RepartoConfirmationErrorPresentation(
            message: detail,
            canRetry: false,
          );
        }
      }
      return const RepartoConfirmationErrorPresentation(
        message: 'El resultado de la confirmación no es concluyente. '
            'La operación requiere revisión manual.',
        canRetry: false,
      );
    case RepartoConfirmationErrorDisposition.retryable:
      if (error is RepartoEvidenceUploadException) {
        return RepartoConfirmationErrorPresentation(
          message: repartoEvidenceErrorMessage(error),
          canRetry: true,
        );
      }
      if (error is ApiException) {
        final mapped = _paymentConfirmationErrorMessage(error);
        if (mapped != null) {
          return RepartoConfirmationErrorPresentation(
            message: mapped,
            canRetry: true,
          );
        }
        final detail = error.message.trim();
        if (detail.isNotEmpty) {
          return RepartoConfirmationErrorPresentation(
            message: detail,
            canRetry: true,
          );
        }
      }
      return const RepartoConfirmationErrorPresentation(
        message: 'No se pudo registrar la entrega. Reinténtalo.',
        canRetry: true,
      );
  }
}

String? _paymentConfirmationErrorMessage(ApiException error) {
  switch (error.code) {
    case 'INVALID_PAYMENT_AMOUNT':
      return 'El importe cobrado supera lo pendiente de esta entrega. '
          'Ajusta la cantidad e inténtalo de nuevo.';
    case 'PAYMENT_DOCUMENT_UNAVAILABLE':
      return 'No hay saldo cobrable para este documento. '
          'Puedes entregar sin marcar cobro.';
    case 'REPARTO_COBROS_CAPABILITY_UNAVAILABLE':
      return 'El cobro no está disponible ahora mismo. '
          'Entrega sin cobro o reinténtalo más tarde.';
    case 'REPARTO_COBRO_COMMERCIAL_CONFLICT':
      return 'Este documento ya tiene cobros en el ERP. '
          'No se puede registrar otro cobro desde el rutero.';
    default:
      return null;
  }
}

SnackBar repartoConfirmationErrorSnackBar({
  required RepartoConfirmationErrorPresentation presentation,
  VoidCallback? onRetry,
}) {
  final retryAction = presentation.canRetry ? onRetry : null;
  return SnackBar(
    content: Row(
      children: <Widget>[
        const Icon(Icons.error_outline, color: Colors.white),
        const SizedBox(width: 12),
        Expanded(child: Text(presentation.message)),
      ],
    ),
    action: retryAction == null
        ? null
        : SnackBarAction(
            label: 'Reintentar',
            onPressed: retryAction,
          ),
    backgroundColor: AppTheme.error,
  );
}

class RuteroDetailModal extends StatefulWidget {
  const RuteroDetailModal({
    required this.albaran,
    required this.ref,
    this.confirmationJournalStore,
    super.key,
  });
  final AlbaranEntrega albaran;
  final WidgetRef ref;
  final RepartoConfirmationJournalStore? confirmationJournalStore;

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
  final TextEditingController _apellidosController = TextEditingController();
  final TextEditingController _incidenciaMotivoController =
      TextEditingController();
  final TextEditingController _importeCobradoController =
      TextEditingController();
  final FocusNode _nombreFocusNode = FocusNode();
  final FocusNode _apellidosFocusNode = FocusNode();
  final FocusNode _dniFocusNode = FocusNode();
  final FocusNode _observacionesFocusNode = FocusNode();
  final FocusNode _importeFocusNode = FocusNode();
  final _nombreFieldKey = GlobalKey();
  final _apellidosFieldKey = GlobalKey();
  final _dniFieldKey = GlobalKey();
  final _observacionesFieldKey = GlobalKey();
  final _firmaFieldKey = GlobalKey();
  final _importeFieldKey = GlobalKey();
  final _productsErrorKey = GlobalKey();
  final _paymentErrorKey = GlobalKey();
  final _productsScrollController = ScrollController();
  final _paymentScrollController = ScrollController();
  final _finalizeScrollController = ScrollController();

  final SignatureController _signatureController = SignatureController(
    exportBackgroundColor: Colors.white,
  );

  final Map<String, bool> _productChecked = {};
  final Map<String, double> _productQuantities = {};

  List<EntregaItem> _items = [];
  bool _isLoadingItems = true;
  String? _itemsError;

  String _selectedPaymentMethod = 'EFECTIVO';
  bool _isPaid = false;
  bool _isSubmitting = false;
  bool _allowProgrammaticDismiss = false;
  late final RepartoConfirmationJournal _confirmationJournal;
  late final RepartoPersistentConfirmationOperation _confirmationOperation;
  late final RepartoEvidenceConfirmationCoordinator _evidenceCoordinator;
  final ImagePicker _imagePicker = ImagePicker();
  final List<XFile> _evidencePhotos = <XFile>[];
  bool _hasPersistedSignature = false;
  bool _isAcknowledgedTombstone = false;
  bool _isJournalBlocked = false;
  bool _isRestoringJournal = false;
  bool _lastConfirmWasQueued = false;
  RepartoDeliveryStatus _deliveryStatus = RepartoDeliveryStatus.entregado;
  RepartoDifferenceReason _differenceReason = RepartoDifferenceReason.otro;
  RepartoIncidentType _incidentType = RepartoIncidentType.otro;

  bool _tieneImpresora = false;
  String? _printerName;
  String? _printerAddress;
  String? _printerProtocol;
  bool _isTestingConnection = false;
  bool? _lastConnectionResult;

  String? _nombreError;
  String? _apellidosError;
  String? _dniError;
  String? _firmaError;
  String? _pagoError;
  String? _importeCobradoError;
  String? _observacionesError;
  String? _productsStatusError;
  List<RuteroFieldIssue> _validationIssues = const [];
  String? _spotlightField;

  String? _cachedPdfBase64;
  late AlbaranEntrega _albaran;

  @override
  void initState() {
    super.initState();
    _albaran = widget.albaran;
    _confirmationJournal = RepartoConfirmationJournal(
      widget.confirmationJournalStore ?? HiveRepartoConfirmationJournalStore(),
    );
    _confirmationOperation =
        RepartoPersistentConfirmationOperation(_confirmationJournal);
    _evidenceCoordinator = RepartoEvidenceConfirmationCoordinator(
      RepartoEvidenceUploadService(),
      _confirmationJournal,
    );
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(_onDeliveryTabChanged);
    _slideController = AnimationController(
      duration: const Duration(milliseconds: 400),
      vsync: this,
    )..forward();

    _observacionesController.text = _albaran.observaciones ?? '';
    _importeCobradoController.text =
        _albaran.importeTotal.toStringAsFixed(2).replaceAll('.', ',');

    if (widget.albaran.esCTR) {
      _selectedPaymentMethod = 'EFECTIVO';
    }

    _loadItems();
    _loadPrinterConfig();
    unawaited(
      _restorePendingEvidence().timeout(
        const Duration(seconds: 3),
        onTimeout: () {
          debugPrint('[RUTERO] journal restore timed out, allowing confirm');
          if (mounted) {
            setState(() {
              _isJournalBlocked = false;
              _isRestoringJournal = false;
            });
          }
        },
      ),
    );
  }

  Future<void> _restorePendingEvidence() async {
    try {
      if (!_isCompleted) {
        await _confirmationJournal
            .clearStaleAcknowledgedIfOpen(widget.albaran.id);
      }
      var entry = await _confirmationJournal.loadOrCreate(widget.albaran.id);
      debugPrint(
        '[RUTERO] journal state=${entry.state.name} '
        'completed=$_isCompleted printer=$_tieneImpresora '
        'id=${widget.albaran.id}',
      );
      if (entry.state == RepartoOperationState.acknowledged) {
        if (!_isCompleted) {
          await _confirmationJournal
              .clearStaleAcknowledgedIfOpen(widget.albaran.id);
          entry = await _confirmationJournal.loadOrCreate(widget.albaran.id);
        }
        if (entry.state == RepartoOperationState.acknowledged && _isCompleted) {
          if (mounted) {
            setState(() {
              _isAcknowledgedTombstone = true;
              _isRestoringJournal = false;
            });
          }
          return;
        }
      }
      if (entry.state == RepartoOperationState.manualReview) {
        try {
          await _confirmationJournal.resetIfNotAcknowledged(widget.albaran.id);
          entry = await _confirmationJournal.loadOrCreate(widget.albaran.id);
        } on RepartoAlreadyAcknowledgedException {
          if (_isCompleted && mounted) {
            setState(() {
              _isAcknowledgedTombstone = true;
              _isRestoringJournal = false;
            });
            return;
          }
          debugPrint('[RUTERO] stale acknowledged during reset, unlocking');
        }
      }
      final signatureId = entry.evidences['signature']?.evidenceId;
      if (mounted) {
        setState(() {
          _isJournalBlocked = false;
          _isAcknowledgedTombstone = false;
          _hasPersistedSignature = signatureId != null &&
              RepartoEvidenceUploadService.isValidEvidenceId(signatureId);
          _isRestoringJournal = false;
        });
      }
    } catch (e) {
      debugPrint('[RUTERO] journal restore failed, allowing confirm: $e');
      try {
        await _confirmationJournal.resetIfNotAcknowledged(widget.albaran.id);
      } catch (_) {}
      if (mounted) {
        setState(() {
          _isJournalBlocked = false;
          _isRestoringJournal = false;
        });
      }
    }
  }

  Future<void> _loadPrinterConfig() async {
    final has = await ZebraPrintService.tieneImpresora();
    final name = await ZebraPrintService.getSavedPrinterName();
    final addr = await ZebraPrintService.getSavedPrinterAddress();
    final protocol = await ZebraPrintService.getPrinterProtocol();
    if (mounted) {
      setState(() {
        _tieneImpresora = has;
        _printerName = name;
        _printerAddress = addr;
        _printerProtocol = protocol;
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
      final chosen = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Protocolo de impresión'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                title: const Text('Zebra / ZPL'),
                onTap: () => Navigator.pop(ctx, 'zpl'),
              ),
              ListTile(
                title: const Text('Impresora Bluetooth genérica (ESC/POS)'),
                onTap: () => Navigator.pop(ctx, 'escpos'),
              ),
            ],
          ),
        ),
      );
      if (chosen == null || !mounted) return;
      await ZebraPrintService.savePrinter(
        device.address,
        displayName,
        protocol: chosen,
      );
      setState(() {
        _printerName = displayName;
        _printerAddress = device.address;
        _printerProtocol = chosen;
        _lastConnectionResult = null;
      });
    }
  }

  Widget _buildPrinterConfigSection() {
    return RuteroPrinterConfig(
      tieneImpresora: _tieneImpresora,
      printerName: _printerName,
      printerAddress: _printerAddress,
      printerProtocol: _printerProtocol,
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
      final notifier = widget.ref.read(entregasProvider.notifier);
      final albaranDetalle = await notifier.obtenerDetalleAlbaran(
        widget.albaran.numeroAlbaran,
        widget.albaran.ejercicio,
        widget.albaran.serie,
        widget.albaran.terminal,
        widget.albaran.codigoCliente,
        deliveryId: widget.albaran.id,
        repartidorId: widget.albaran.codigoRepartidor,
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

      final sourceItems = albaranDetalle.items.isNotEmpty
          ? albaranDetalle.items
          : widget.albaran.items;
      final filtered = sourceItems.where((item) {
        final desc = item.descripcion.trim();
        if (desc.toLowerCase().startsWith('pedido:')) return false;
        if (item.cantidadPedida <= 0 && item.bultos <= 0) return false;
        return true;
      }).toList();

      final identityError = validateRuteroLineIdentities(filtered);
      if (mounted) {
        setState(() {
          _albaran = widget.albaran.copyWith(
            importeTotal: albaranDetalle.importeTotal,
            importeBruto: albaranDetalle.importeBruto,
            importeNeto: albaranDetalle.importeNeto,
            importeIva: albaranDetalle.importeIva,
            ivaBreakdown: albaranDetalle.ivaBreakdown,
            checksum: albaranDetalle.checksum,
            discrepancy: albaranDetalle.discrepancy,
            lineSum: albaranDetalle.lineSum,
            pricingState: albaranDetalle.pricingState,
            amountSource: albaranDetalle.amountSource,
            items: filtered,
          );
          if (!_isPaid) {
            _importeCobradoController.text =
                _albaran.importeTotal.toStringAsFixed(2).replaceAll('.', ',');
          }
          _itemsError = identityError;
          _items = filtered;
          _isLoadingItems = false;
          _productChecked.clear();
          _productQuantities.clear();

          if (identityError == null) {
            for (final item in filtered) {
              final lineId = ruteroLineKey(item);
              _productChecked[lineId] = true;
              _productQuantities[lineId] = item.cantidadPedida;
            }
          }
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _itemsError =
              'No se pudieron cargar las líneas. Recarga el reparto e inténtalo de nuevo.';
          _isLoadingItems = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _tabController.removeListener(_onDeliveryTabChanged);
    _tabController.dispose();
    _slideController.dispose();
    _observacionesController.dispose();
    _dniController.dispose();
    _nombreController.dispose();
    _apellidosController.dispose();
    _incidenciaMotivoController.dispose();
    _importeCobradoController.dispose();
    _nombreFocusNode.dispose();
    _apellidosFocusNode.dispose();
    _dniFocusNode.dispose();
    _observacionesFocusNode.dispose();
    _importeFocusNode.dispose();
    _productsScrollController.dispose();
    _paymentScrollController.dispose();
    _finalizeScrollController.dispose();
    _signatureController.dispose();
    super.dispose();
  }

  void _onDeliveryTabChanged() {
    if (!mounted || _tabController.indexIsChanging) return;
    setState(() {});
  }

  static double _normalizeQuantity(num value) =>
      double.parse(value.toDouble().toStringAsFixed(3));

  static bool _quantityDiffers(num left, num right) =>
      (left.toDouble() - right.toDouble()).abs() > 0.0001;

  static String _formatQuantity(num value) {
    final fixed = _normalizeQuantity(value).toStringAsFixed(3);
    return fixed.replaceFirst(RegExp(r'\.?0+$'), '');
  }

  double _boundedQuantity(String lineId, num value) {
    final ordered = _items
        .firstWhere((item) => ruteroLineKey(item) == lineId)
        .cantidadPedida;
    return _normalizeQuantity(value.clamp(0.0, ordered));
  }

  bool get _isFactura => widget.albaran.numeroFactura > 0;
  bool get _isUrgent => widget.albaran.esCTR;

  /// Canonical terminal outcomes are read-only. A no-delivery is final too;
  /// reopening it as an editable confirmation risks an inconsistent replay.
  bool get _isCompleted => switch (widget.albaran.estado) {
        EstadoEntrega.entregado ||
        EstadoEntrega.parcial ||
        EstadoEntrega.noEntregado ||
        EstadoEntrega.rechazado =>
          true,
        _ => false,
      };

  Color get _terminalAccentColor => switch (widget.albaran.estado) {
        EstadoEntrega.entregado => AppTheme.success,
        EstadoEntrega.parcial || EstadoEntrega.noEntregado => AppTheme.warning,
        EstadoEntrega.rechazado => AppTheme.error,
        _ => AppTheme.info,
      };

  bool get _hasDiscrepancy {
    final anyQtyModified = _items.any(
      (item) => _quantityDiffers(
        _productQuantities[ruteroLineKey(item)] ?? item.cantidadPedida,
        item.cantidadPedida,
      ),
    );
    final anyUnchecked =
        _items.any((item) => !(_productChecked[ruteroLineKey(item)] ?? false));
    return anyQtyModified || anyUnchecked;
  }

  @override
  Widget build(BuildContext context) {
    // PopScope also vetoes barrier taps and drag-driven route pops while the
    // evidence transaction is active. Only the success path opts back in.
    return PopScope(
      canPop: !_isSubmitting || _allowProgrammaticDismiss,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 1),
          end: Offset.zero,
        ).animate(
          CurvedAnimation(
            parent: _slideController,
            curve: Curves.easeOutCubic,
          ),
        ),
        child: RepartidorExecutiveSheet(
          height: Responsive.modalHeight(
            context,
            portraitFraction: _isCompleted ? 0.70 : 0.92,
            landscapeFraction: _isCompleted ? 0.80 : 0.95,
          ),
          accentColor: _isCompleted
              ? _terminalAccentColor
              : _isUrgent
                  ? AppTheme.obligatorio
                  : AppTheme.info,
          child: Column(
            children: [
              RuteroDetailHeader(
                albaran: _albaran,
                isCompleted: _isCompleted,
              ),
              if (_isCompleted)
                Expanded(child: _buildCompletedView())
              else ...[
                RuteroDetailTabBar(
                  tabController: _tabController,
                  isUrgent: _isUrgent,
                  productErrorCount: _countIssues(RuteroDeliveryTab.products),
                  paymentErrorCount: _countIssues(RuteroDeliveryTab.payment),
                  finalizeErrorCount: _countIssues(RuteroDeliveryTab.finalize),
                ),
                RuteroValidationBanner(
                  issues: _validationIssues,
                  onIssueTap: _focusValidationIssue,
                ),
                Expanded(
                  child: IndexedStack(
                    index: _tabController.index,
                    children: [
                      SizedBox.expand(child: _buildProductsTab()),
                      SizedBox.expand(child: _buildPaymentTab()),
                      SizedBox.expand(child: _buildFinalizeTab()),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCompletedView() {
    return RuteroDetailCompleted(
      albaran: _albaran,
      onPreviewDeliveryNotePdf: _previewReceiptPdf,
      onShareDeliveryNotePdf: _shareDeliveryNoteLocally,
      onShareDeliveryNoteWhatsApp: _shareDeliveryNoteViaWhatsApp,
      onPreviewCommercialPdf: _previewCommercialPdf,
      onShareCommercialPdf: _shareCommercialLocally,
      onShareCommercialWhatsApp: _shareCommercialViaWhatsApp,
      onEmailDeliveryNote: _emailReceipt,
      onPrintDeliveryNotePdf: _printCanonicalDeliveryNote,
      buildPrinterConfigSection: _buildPrinterConfigSection,
      tieneImpresora: _tieneImpresora,
      items: _items,
      onShowZebraPrintPreview: _showZebraPrintPreview,
    );
  }

  Widget _buildProductsTab() {
    final productsBanner = _productsStatusError ??
        (_validationIssues.any((issue) => issue.field == 'items')
            ? _itemsError
            : null);
    return Column(
      children: [
        if (productsBanner != null)
          Padding(
            key: _productsErrorKey,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: RuteroErrorSpotlight(
              active: _spotlightField == 'productsStatus' ||
                  _spotlightField == 'items',
              message: productsBanner,
              child: const SizedBox.shrink(),
            ),
          ),
        Expanded(
          child: RuteroDetailProducts(
            items: _items,
            isLoadingItems: _isLoadingItems,
            itemsError: _itemsError,
            productChecked: _productChecked,
            productQuantities: _productQuantities,
            ordenPreparacion: widget.albaran.ordenPreparacion?.toString(),
            onProductCheckedChanged: (lineId, value) {
              setState(() {
                _productChecked[lineId] = value;
                _cachedPdfBase64 = null;
                if (_productsStatusError != null) {
                  _productsStatusError = null;
                  _removeIssue('productsStatus');
                }
              });
            },
            onQuantityChanged: (lineId, value) {
              setState(() {
                _productQuantities[lineId] = _boundedQuantity(lineId, value);
                _cachedPdfBase64 = null;
                if (_productsStatusError != null) {
                  _productsStatusError = null;
                  _removeIssue('productsStatus');
                }
              });
            },
            onShowQuantityEditDialog: _showQuantityEditDialog,
            onRetryItems: _loadItems,
            onConfirmAll: () {
              HapticFeedback.lightImpact();
              final allChecked = _items.isNotEmpty &&
                  _items.every(
                    (item) => _productChecked[ruteroLineKey(item)] ?? false,
                  );
              setState(() {
                for (final linea in _items) {
                  _productChecked[ruteroLineKey(linea)] = !allChecked;
                }
              });
            },
            onContinueToPayment: () {
              HapticFeedback.mediumImpact();
              _tabController.animateTo(1);
            },
            onOpenFicha: _openFichaTecnica,
            onShowFullscreenImage: _showFullscreenImage,
            scrollController: _productsScrollController,
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: OutlinedButton.icon(
              onPressed: _isSubmitting ? null : _activateNoEntregaMode,
              icon: const Icon(Icons.storefront_outlined),
              label: const Text('NO ENTREGA (cerrado / no disponible)'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.warning,
                side: const BorderSide(color: AppTheme.warning),
                padding: const EdgeInsets.symmetric(vertical: 14),
                minimumSize: const Size.fromHeight(48),
              ),
            ),
          ),
        ),
      ],
    );
  }

  void _activateNoEntregaMode() {
    HapticFeedback.mediumImpact();
    setState(() {
      _deliveryStatus = RepartoDeliveryStatus.noEntregado;
      _isPaid = false;
      _pagoError = null;
      _importeCobradoError = null;
      _firmaError = null;
      _nombreError = null;
      _apellidosError = null;
      _dniError = null;
      _incidentType = RepartoIncidentType.clienteAusente;
      _differenceReason = RepartoDifferenceReason.clienteAusente;
      if (_incidenciaMotivoController.text.trim().isEmpty) {
        _incidenciaMotivoController.text =
            'Establecimiento cerrado o no disponible';
      }
    });
    _tabController.animateTo(2);
  }

  Widget _buildPaymentTab() {
    return RuteroDetailPayment(
      albaran: _albaran,
      selectedPaymentMethod: _selectedPaymentMethod,
      isPaid: _isPaid,
      pagoError: _pagoError,
      importeCobradoController: _importeCobradoController,
      importeCobradoError: _importeCobradoError,
      importeFieldKey: _importeFieldKey,
      errorBannerKey: _paymentErrorKey,
      highlightPayment:
          _spotlightField == 'pago' || _spotlightField == 'importe',
      scrollController: _paymentScrollController,
      importeFocusNode: _importeFocusNode,
      onPaymentMethodChanged: (method) {
        setState(() => _selectedPaymentMethod = method);
      },
      onPaidChanged: () {
        setState(() {
          _isPaid = !_isPaid;
          if (_isPaid) {
            _pagoError = null;
            _importeCobradoError = null;
            _removeIssue('pago');
            _removeIssue('importe');
            if (_importeCobradoController.text.trim().isEmpty) {
              _importeCobradoController.text =
                  _albaran.importeTotal.toStringAsFixed(2).replaceAll('.', ',');
            }
          }
        });
      },
      onContinueToFinalize: () {
        HapticFeedback.mediumImpact();
        _tabController.animateTo(2);
      },
      getPaymentTypeLabel: _getPaymentTypeLabel,
    );
  }

  List<String> get _finalizeGaps {
    if (_deliveryStatus == RepartoDeliveryStatus.noEntregado) {
      return const <String>[];
    }
    final gaps = <String>[];
    if (_nombreController.text.trim().isEmpty) gaps.add('Nombre');
    if (_apellidosController.text.trim().isEmpty) gaps.add('Apellidos');
    if (_dniController.text.trim().isEmpty) gaps.add('DNI');
    if (_signatureController.isEmpty && !_hasPersistedSignature) {
      gaps.add('Firma');
    }
    return gaps;
  }

  Widget _buildFinalizeTab() {
    final noEntrega = _deliveryStatus == RepartoDeliveryStatus.noEntregado;
    final gaps = _finalizeGaps;
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            controller: _finalizeScrollController,
            padding: EdgeInsets.fromLTRB(
              20,
              20,
              20,
              16 + MediaQuery.of(context).viewInsets.bottom,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (noEntrega) ...[
                  const RepartidorExecutivePanel(
                    accentColor: AppTheme.warning,
                    padding: EdgeInsets.all(14),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.info_outline,
                          color: AppTheme.warning,
                          size: 22,
                        ),
                        SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'No entrega: no hace falta firma, DNI ni cobro. '
                            'Indica el motivo y confirma.',
                            style: TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 13,
                              height: 1.35,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                _buildDeliveryStatusSection(),
                const SizedBox(height: 16),
                if (_hasDiscrepancy) ...[
                  _buildDiscrepancyWarning(),
                  const SizedBox(height: 12),
                ],
                RuteroErrorSpotlight(
                  key: _observacionesFieldKey,
                  active: _spotlightField == 'observaciones',
                  message: _observacionesError,
                  child: TextField(
                    controller: _observacionesController,
                    focusNode: _observacionesFocusNode,
                    maxLines: 3,
                    onChanged: (_) {
                      if (_observacionesError != null) {
                        setState(() {
                          _observacionesError = null;
                          _removeIssue('observaciones');
                        });
                      }
                    },
                    style: const TextStyle(color: AppTheme.textPrimary),
                    decoration: ruteroErrorInputDecoration(
                      label: noEntrega
                          ? 'Observaciones / motivo de no entrega *'
                          : 'Observaciones',
                      hintText: noEntrega
                          ? 'Ej: cerrado, no hay nadie, vuelvo más tarde...'
                          : 'Añadir nota sobre la entrega...',
                      errorText: _observacionesError,
                      alignLabelWithHint: true,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                _buildEvidencePhotosSection(),
                if (!noEntrega) ...[
                  const SizedBox(height: 12),
                  _buildPrinterConfigSection(),
                  const SizedBox(height: 20),
                  _buildSignatureSection(),
                  const SizedBox(height: 16),
                  _buildReceiverData(),
                ],
                const SizedBox(height: 12),
              ],
            ),
          ),
        ),
        if (gaps.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text(
              'Falta: ${gaps.join(', ')}. Está justo encima del botón.',
              style: const TextStyle(
                color: AppTheme.warning,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: _buildSubmitButton(),
        ),
      ],
    );
  }

  Widget _buildDeliveryStatusSection() {
    final noDelivery = _deliveryStatus == RepartoDeliveryStatus.noEntregado;
    final rejected = _deliveryStatus == RepartoDeliveryStatus.rechazado;
    final hasIncident = noDelivery || rejected;
    return RepartidorExecutivePanel(
      accentColor: hasIncident ? AppTheme.warning : AppTheme.info,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownButtonFormField<RepartoDeliveryStatus>(
            initialValue: _deliveryStatus,
            decoration:
                const InputDecoration(labelText: 'Resultado de la entrega'),
            items: RepartoDeliveryStatus.values
                .map(
                  (status) => DropdownMenuItem(
                    value: status,
                    child: Text(status.apiValue.replaceAll('_', ' ')),
                  ),
                )
                .toList(growable: false),
            onChanged: _isSubmitting
                ? null
                : (status) {
                    if (status == null) return;
                    setState(() {
                      _deliveryStatus = status;
                      if (status == RepartoDeliveryStatus.noEntregado ||
                          status == RepartoDeliveryStatus.rechazado) {
                        _isPaid = false;
                      }
                      if (status == RepartoDeliveryStatus.noEntregado) {
                        _pagoError = null;
                        _importeCobradoError = null;
                        _firmaError = null;
                        _nombreError = null;
                        _apellidosError = null;
                        _dniError = null;
                        _incidentType = RepartoIncidentType.clienteAusente;
                        _differenceReason =
                            RepartoDifferenceReason.clienteAusente;
                        if (_incidenciaMotivoController.text.trim().isEmpty) {
                          _incidenciaMotivoController.text =
                              'Establecimiento cerrado o no disponible';
                        }
                      }
                    });
                  },
          ),
          if (!noDelivery) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<RepartoDifferenceReason>(
              initialValue: _differenceReason,
              decoration:
                  const InputDecoration(labelText: 'Motivo de la diferencia'),
              items: RepartoDifferenceReason.values
                  .map(
                    (reason) => DropdownMenuItem(
                      value: reason,
                      child: Text(reason.apiValue.replaceAll('_', ' ')),
                    ),
                  )
                  .toList(growable: false),
              onChanged: _isSubmitting
                  ? null
                  : (reason) => setState(() {
                        if (reason != null) _differenceReason = reason;
                      }),
            ),
          ],
          if (hasIncident) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<RepartoIncidentType>(
              initialValue: _incidentType,
              decoration:
                  const InputDecoration(labelText: 'Tipo de incidencia *'),
              items: RepartoIncidentType.values
                  .map(
                    (type) => DropdownMenuItem(
                      value: type,
                      child: Text(type.apiValue.replaceAll('_', ' ')),
                    ),
                  )
                  .toList(growable: false),
              onChanged: _isSubmitting
                  ? null
                  : (type) => setState(() {
                        if (type != null) _incidentType = type;
                      }),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _incidenciaMotivoController,
              enabled: !_isSubmitting,
              decoration:
                  const InputDecoration(labelText: 'Motivo de la incidencia *'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildEvidencePhotosSection() {
    final canAdd = !_isSubmitting &&
        _evidencePhotos.length < RepartoEvidenceUploadService.maxPhotos;
    return RepartidorExecutivePanel(
      accentColor: AppTheme.info,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const RepartidorExecutiveIcon(
                icon: Icons.photo_camera,
                color: AppTheme.info,
                size: 20,
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'EVIDENCIAS FOTOGRÁFICAS',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ),
              Text(
                '${_evidencePhotos.length}/${RepartoEvidenceUploadService.maxPhotos}',
                style: const TextStyle(color: AppTheme.textSecondary),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_evidencePhotos.isNotEmpty)
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: List<Widget>.generate(_evidencePhotos.length, (index) {
                final photo = _evidencePhotos[index];
                return SizedBox(
                  width: 104,
                  height: 104,
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: Semantics(
                          button: true,
                          image: true,
                          label: 'Previsualizar foto ${index + 1}',
                          child: InkWell(
                            onTap: () => _previewEvidencePhoto(photo, index),
                            borderRadius:
                                BorderRadius.circular(AppTheme.radiusMd),
                            child: ClipRRect(
                              borderRadius:
                                  BorderRadius.circular(AppTheme.radiusMd),
                              child: Image.file(
                                File(photo.path),
                                fit: BoxFit.cover,
                                width: 104,
                                height: 104,
                                errorBuilder: (_, __, ___) => const ColoredBox(
                                  color: AppTheme.softPanel,
                                  child: Icon(
                                    Icons.broken_image_outlined,
                                    color: AppTheme.textTertiary,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      Positioned(
                        right: 0,
                        top: 0,
                        child: IconButton.filled(
                          tooltip: 'Quitar foto ${index + 1}',
                          onPressed: _isSubmitting
                              ? null
                              : () => setState(
                                    () => _evidencePhotos.removeAt(index),
                                  ),
                          icon: const Icon(Icons.close, size: 18),
                          style: IconButton.styleFrom(
                            backgroundColor: AppTheme.error,
                            foregroundColor: Colors.white,
                            minimumSize: const Size(48, 48),
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ),
          if (_evidencePhotos.isNotEmpty) const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: canAdd ? _takeEvidencePhoto : null,
            icon: const Icon(Icons.add_a_photo_outlined),
            label: Text(
              canAdd ? 'Hacer foto' : 'Máximo de 3 fotos alcanzado',
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Las fotos se previsualizan aquí y se suben al confirmar.',
            style: TextStyle(color: AppTheme.textTertiary, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Future<void> _takeEvidencePhoto() async {
    if (_isSubmitting ||
        _evidencePhotos.length >= RepartoEvidenceUploadService.maxPhotos) {
      return;
    }
    try {
      final photo = await _imagePicker.pickImage(
        source: ImageSource.camera,
        imageQuality: 85,
        maxWidth: 1920,
      );
      if (photo == null || !mounted) return;
      setState(() => _evidencePhotos.add(photo));
    } catch (_) {
      if (mounted) {
        _showError('No se pudo abrir la cámara. Revisa sus permisos.');
      }
    }
  }

  Future<void> _previewEvidencePhoto(XFile photo, int index) {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        title: Text('Foto ${index + 1}'),
        content: Semantics(
          image: true,
          label: 'Vista previa de la foto ${index + 1}',
          child: InteractiveViewer(
            child: Image.file(
              File(photo.path),
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => const SizedBox(
                height: 180,
                child: Center(child: Text('No se pudo mostrar la foto')),
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('CERRAR'),
          ),
        ],
      ),
    );
  }

  Widget _buildReceiverData() {
    return RepartidorExecutivePanel(
      accentColor: AppTheme.info,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              RepartidorExecutiveIcon(
                icon: Icons.person,
                color: AppTheme.info,
                size: 20,
              ),
              SizedBox(width: 8),
              Text(
                'DATOS DEL RECEPTOR',
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          RuteroErrorSpotlight(
            key: _nombreFieldKey,
            active: _spotlightField == 'nombre',
            message: _nombreError,
            child: TextField(
              controller: _nombreController,
              focusNode: _nombreFocusNode,
              enabled: !_isSubmitting,
              onChanged: (_) {
                if (_nombreError != null) {
                  setState(() {
                    _nombreError = null;
                    _removeIssue('nombre');
                  });
                }
              },
              style: const TextStyle(color: AppTheme.textPrimary),
              decoration: ruteroErrorInputDecoration(
                label: 'Nombre *',
                prefixIcon: const Icon(Icons.person_outline, size: 20),
                errorText: _nombreError,
              ),
            ),
          ),
          const SizedBox(height: 12),
          RuteroErrorSpotlight(
            key: _apellidosFieldKey,
            active: _spotlightField == 'apellidos',
            message: _apellidosError,
            child: TextField(
              controller: _apellidosController,
              focusNode: _apellidosFocusNode,
              enabled: !_isSubmitting,
              onChanged: (_) {
                if (_apellidosError != null) {
                  setState(() {
                    _apellidosError = null;
                    _removeIssue('apellidos');
                  });
                }
              },
              style: const TextStyle(color: AppTheme.textPrimary),
              decoration: ruteroErrorInputDecoration(
                label: 'Apellidos *',
                prefixIcon: const Icon(Icons.person_outline, size: 20),
                errorText: _apellidosError,
              ),
            ),
          ),
          const SizedBox(height: 12),
          RuteroErrorSpotlight(
            key: _dniFieldKey,
            active: _spotlightField == 'dni',
            message: _dniError,
            child: TextField(
              controller: _dniController,
              focusNode: _dniFocusNode,
              enabled: !_isSubmitting,
              onChanged: (_) {
                if (_dniError != null) {
                  setState(() {
                    _dniError = null;
                    _removeIssue('dni');
                  });
                }
              },
              style: const TextStyle(color: AppTheme.textPrimary),
              decoration: ruteroErrorInputDecoration(
                label: 'DNI / NIF *',
                prefixIcon: const Icon(Icons.badge_outlined, size: 20),
                errorText: _dniError,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDiscrepancyWarning() {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppTheme.warning.withValues(alpha: 0.14),
        border: Border.all(color: AppTheme.warning.withValues(alpha: 0.36)),
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      ),
      child: const Text(
        'ATENCIÓN: Si marca en verde sin modificar cantidades, '
        'la entrega está OK. Si modifica o quita cantidades, la '
        'entrega NO coincide – debe añadir observaciones en la '
        "pestaña 'Observaciones' antes de confirmar.",
        style: TextStyle(
          color: AppTheme.warning,
          fontSize: 13,
        ),
      ),
    );
  }

  Widget _buildSignatureSection() {
    return RuteroErrorSpotlight(
      key: _firmaFieldKey,
      active: _spotlightField == 'firma',
      message: _firmaError,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  RepartidorExecutiveIcon(
                    icon: Icons.draw,
                    color: AppTheme.info,
                    size: 20,
                  ),
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
          RepartidorExecutivePanel(
            accentColor: _firmaError != null ? AppTheme.error : AppTheme.info,
            padding: EdgeInsets.zero,
            child: SizedBox(
              height: Responsive.isLandscape(context)
                  ? 120.0
                  : Responsive.value(context, phone: 120, desktop: 160),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.radiusLg),
                child: Signature(
                  controller: _signatureController,
                  backgroundColor: Colors.white,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSubmitButton() {
    final noEntrega = _deliveryStatus == RepartoDeliveryStatus.noEntregado;
    if (_isAcknowledgedTombstone && !_isCompleted) {
      debugPrint('[RUTERO] ignoring stale tombstone, confirm stays enabled');
    }
    return ElevatedButton(
      onPressed: _isSubmitting ? null : _submitDelivery,
      style: ElevatedButton.styleFrom(
        backgroundColor: noEntrega ? AppTheme.warning : AppTheme.success,
        foregroundColor: Colors.white,
        disabledBackgroundColor:
            noEntrega ? AppTheme.warning : AppTheme.success,
        disabledForegroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 18),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        ),
      ),
      child: _isSubmitting
          ? const SizedBox(
              height: 24,
              width: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white,
              ),
            )
          : Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  noEntrega ? Icons.cancel_outlined : Icons.check_circle,
                  size: 24,
                ),
                const SizedBox(width: 12),
                Text(
                  noEntrega ? 'REGISTRAR NO ENTREGA' : 'CONFIRMAR ENTREGA',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
    );
  }

  Future<void> _showQuantityEditDialog(
    EntregaItem linea,
    double current,
  ) async {
    final controller = TextEditingController(text: _formatQuantity(current));
    double? parseQuantity(String raw) {
      final parsed = double.tryParse(raw.trim().replaceAll(',', '.'));
      if (parsed == null ||
          parsed.isNaN ||
          parsed.isInfinite ||
          parsed < 0 ||
          parsed - linea.cantidadPedida > 0.0001) {
        return null;
      }
      return _normalizeQuantity(parsed);
    }

    final result = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          side: BorderSide(color: AppTheme.info.withValues(alpha: 0.28)),
        ),
        title: Row(
          children: [
            const RepartidorExecutiveIcon(
              icon: Icons.edit,
              color: AppTheme.info,
              size: 22,
            ),
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
              'Cantidad original: ${_formatQuantity(linea.cantidadPedida)}'
              '${(linea.unit ?? '').trim().isEmpty ? '' : ' ${linea.unit}'}',
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              autofocus: true,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
              decoration: InputDecoration(
                labelText: (linea.unit ?? '').trim().isEmpty
                    ? 'Nueva cantidad'
                    : 'Nueva cantidad (${linea.unit})',
                hintText: 'Ej: 2,30',
                filled: true,
                fillColor: AppTheme.softPanel,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(
                  RegExp(r'^\d{0,8}([\.,]\d{0,3})?$'),
                ),
              ],
              onSubmitted: (val) {
                final quantity = parseQuantity(val);
                if (quantity != null) Navigator.pop(ctx, quantity);
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
              final quantity = parseQuantity(controller.text);
              if (quantity != null) Navigator.pop(ctx, quantity);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.info,
              foregroundColor: Colors.white,
            ),
            child: const Text('ACEPTAR'),
          ),
        ],
      ),
    );
    if (result != null && mounted) {
      unawaited(HapticFeedback.selectionClick());
      setState(() {
        _productQuantities[ruteroLineKey(linea)] = result;
        _cachedPdfBase64 = null;
      });
    }
  }

  void _showFullscreenImage(String imageUrl, String name) {
    FullscreenImageViewer.show(
      context,
      imageUrl: imageUrl,
      productName: name,
      headers: repartidorProtectedImageHeaders(imageUrl),
    );
  }

  Future<void> _openFichaTecnica(EntregaItem linea) async {
    final navigator = Navigator.of(context);
    final url =
        '${ApiConfig.baseUrl}/products/${Uri.encodeComponent(linea.codigoArticulo.trim())}/ficha';
    final filePath =
        '${(await getTemporaryDirectory()).path}/${linea.codigoArticulo.trim()}_ficha.pdf';
    if (!mounted) return;

    unawaited(
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (_) => const AlertDialog(
          backgroundColor: AppTheme.raisedSurface,
          content: Row(
            children: [
              SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppTheme.info,
                ),
              ),
              SizedBox(width: 16),
              Text(
                'Descargando ficha técnica...',
                style: TextStyle(color: AppTheme.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );

    try {
      await ApiClient.download(url, filePath);

      if (navigator.canPop()) navigator.pop();

      if (!File(filePath).existsSync()) {
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
              backgroundColor: AppTheme.raisedSurface,
              elevation: 0,
            ),
            body: PDFView(
              filePath: filePath,
              onError: (error) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                      repartidorSafeOperationMessage(
                        error: error is Object
                            ? error
                            : StateError('PDF viewer returned an empty error'),
                        operation: 'technicalSheet',
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      );
    } catch (error) {
      if (navigator.canPop()) navigator.pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            repartidorSafeOperationMessage(
              error: error,
              operation: 'technicalSheet',
            ),
          ),
        ),
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

  List<String> _repartidorIdsParaInvalidar() {
    final fromAlbaran = widget.albaran.codigoRepartidor.trim();
    if (fromAlbaran.isNotEmpty) return [fromAlbaran];

    return widget.ref
        .read(entregasProvider)
        .repartidorId
        .split(',')
        .map((id) => id.trim())
        .where((id) => id.isNotEmpty)
        .toSet()
        .toList();
  }

  Future<void> _invalidateFinanceForDelivery() async {
    final service = widget.ref.read(repartidorFinanzasServiceProvider);
    for (final codigoRepartidor in _repartidorIdsParaInvalidar()) {
      await service.invalidateAllForRepartidor(codigoRepartidor);
    }
    widget.ref
      ..invalidate(repartidorDailySummaryProvider)
      ..invalidate(repartidorVencimientosProvider)
      ..invalidate(repartidorCommissionSummaryProvider);
  }

  void _refreshAfterAcknowledgedDelivery() {
    // The acknowledgement is durable at this point. Cache and provider reads
    // are best effort, so DB2 latency cannot keep the confirmation spinner on.
    scheduleRuteroAcknowledgedRefresh(
      invalidateCaches: RepartidorDataService.invalidateDeliveryReadCaches,
      refreshProviders: () async {
        await widget.ref
            .read(entregasProvider.notifier)
            .cargarAlbaranesPendientes(forceRefresh: true);
        await _invalidateFinanceForDelivery();
      },
    );
  }

  double? _parseMoney(String value) {
    final trimmed = value.trim();
    final normalized = trimmed.contains(',')
        ? trimmed.replaceAll('.', '').replaceAll(',', '.')
        : trimmed;
    if (normalized.isEmpty) return null;
    final parsed = double.tryParse(normalized);
    if (parsed == null || parsed.isNaN || parsed.isInfinite) return null;
    return double.parse(parsed.toStringAsFixed(2));
  }

  Future<bool> _confirmarEntregaCanonica({
    required String? firmaId,
    required List<String> evidenceIds,
    required String observaciones,
  }) async {
    final request = RepartoConfirmationRequest(
      itemId: widget.albaran.id,
      status: _deliveryStatus,
      occurredAt: DateTime.now().toUtc(),
      repartidorId: _repartidorIdsParaInvalidar().isEmpty
          ? null
          : _repartidorIdsParaInvalidar().first,
      lineas: _buildCanonicalLines(),
      allowEmptyLineas: _albaran.isZeroEmpty && _items.isEmpty,
      receiver: _deliveryStatus == RepartoDeliveryStatus.noEntregado
          ? null
          : RepartoReceiver(
              nombre: _nombreController.text,
              apellidos: _apellidosController.text,
              dni: _dniController.text,
            ),
      firma:
          _deliveryStatus == RepartoDeliveryStatus.noEntregado ? null : firmaId,
      evidencias: evidenceIds,
      observaciones: observaciones,
      incidencia: _deliveryStatus == RepartoDeliveryStatus.noEntregado ||
              _deliveryStatus == RepartoDeliveryStatus.rechazado
          ? RepartoIncident(
              tipo: _incidentType,
              motivo: _incidenciaMotivoController.text,
              observaciones: observaciones,
            )
          : null,
      cobro: _isPaid ? _buildCanonicalPayment() : null,
    );
    final prepared = await _confirmationOperation.prepare(request);
    Map<String, dynamic> response;
    try {
      await _confirmationOperation.markSubmitting(widget.albaran.id);
      response = await OfflineAwareApi.post(
        '/repartidor-finanzas/rutero/confirm-delivery-cobro',
        prepared.toJson(),
        headers: prepared.headers,
        idempotent: true,
        syncType: 'confirm_delivery',
        queueExtras: <String, dynamic>{
          '_journalFingerprint': prepared.fingerprint,
          '_journalIdempotencyKey': prepared.idempotencyKey,
        },
        // Idempotency token is stable in the journal, so a transient response
        // loss can be retried without creating a second delivery/cobro.
        receiveTimeout: const Duration(seconds: 30),
        maxRetries: 1,
      );
      if (response['queued'] == true) {
        SyncQueueService.confirmDeliveryReconciler ??=
            defaultConfirmDeliveryReconciler;
        _lastConfirmWasQueued = true;
        if (mounted) {
          OfflineSyncNotifier.deliveryQueued();
        }
        return true;
      }
      _lastConfirmWasQueued = false;
    } on ApiException catch (error) {
      final reconciled = await _confirmationOperation.reconcileConflict(
        deliveryId: widget.albaran.id,
        statusCode: error.statusCode,
        code: error.code,
        prepared: prepared,
        confirmationId: error.confirmationId,
      );
      if (reconciled) {
        _refreshAfterAcknowledgedDelivery();
        if (mounted) setState(() => _isAcknowledgedTombstone = true);
      }
      rethrow;
    } catch (_) {
      await _confirmationOperation.markManualReview(widget.albaran.id);
      rethrow;
    }
    if (response['success'] != true) {
      final code = response['code']?.toString();
      await _confirmationOperation.markManualReview(widget.albaran.id);
      throw ApiException(
        response['error']?.toString() ?? 'No se pudo registrar la entrega',
        statusCode: 200,
        code: code,
      );
    }
    await _confirmationOperation.acknowledgeResponse(
      deliveryId: widget.albaran.id,
      prepared: prepared,
      response: response,
    );
    _refreshAfterAcknowledgedDelivery();
    return true;
  }

  List<RepartoDeliveryLine> _buildCanonicalLines() {
    final identityError = validateRuteroLineIdentities(_items);
    if (identityError != null) {
      throw RepartoConfirmationValidationException(identityError);
    }
    return _items.map((item) {
      final lineId = ruteroLineKey(item);
      final ordered = item.cantidadPedida;
      final checked = _productChecked[lineId] ?? false;
      final selected = _normalizeQuantity(
        (_productQuantities[lineId] ?? ordered).clamp(0.0, ordered),
      );
      final delivered = _deliveryStatus == RepartoDeliveryStatus.entregado
          ? ordered
          : _deliveryStatus == RepartoDeliveryStatus.parcial && checked
              ? selected
              : 0.0;
      final rejected =
          _deliveryStatus == RepartoDeliveryStatus.rechazado ? ordered : 0.0;
      final pending = _normalizeQuantity(ordered - delivered - rejected);
      return RepartoDeliveryLine(
        lineaId: lineId,
        codigoArticulo: item.codigoArticulo,
        cantidadPedida: ordered,
        cantidadEntregada: delivered,
        cantidadRechazada: rejected,
        cantidadPendiente: pending,
        motivoDiferencia:
            pending > 0 || rejected > 0 ? _differenceReason : null,
      );
    }).toList(growable: false);
  }

  RepartoPayment _buildCanonicalPayment() => RepartoPayment(
        importeCobrado: _parseMoney(_importeCobradoController.text)!,
        formaPago: _selectedPaymentMethod,
        entregaId: widget.albaran.id,
      );

  void _clearValidationErrors() {
    setState(() {
      _nombreError = null;
      _apellidosError = null;
      _dniError = null;
      _firmaError = null;
      _pagoError = null;
      _importeCobradoError = null;
      _observacionesError = null;
      _productsStatusError = null;
      _validationIssues = const [];
      _spotlightField = null;
    });
  }

  int _countIssues(RuteroDeliveryTab tab) =>
      _validationIssues.where((issue) => issue.tab == tab).length;

  void _removeIssue(String field) {
    _validationIssues =
        _validationIssues.where((issue) => issue.field != field).toList();
    if (field == 'productsStatus') {
      _productsStatusError = null;
    }
    if (_spotlightField == field) {
      _spotlightField =
          _validationIssues.isEmpty ? null : _validationIssues.first.field;
    }
  }

  GlobalKey? _keyForField(String field) {
    switch (field) {
      case 'nombre':
        return _nombreFieldKey;
      case 'apellidos':
        return _apellidosFieldKey;
      case 'dni':
        return _dniFieldKey;
      case 'observaciones':
        return _observacionesFieldKey;
      case 'firma':
        return _firmaFieldKey;
      case 'importe':
        return _importeFieldKey;
      case 'pago':
        return _paymentErrorKey;
      case 'productsStatus':
      case 'items':
        return _productsErrorKey;
      default:
        return null;
    }
  }

  void _focusValidationIssue(RuteroFieldIssue issue) {
    unawaited(_revealValidationIssue(issue));
  }

  Future<void> _revealValidationIssue(RuteroFieldIssue issue) async {
    FocusManager.instance.primaryFocus?.unfocus();
    if (!mounted) return;
    setState(() => _spotlightField = issue.field);
    if (_tabController.index != issue.tabIndex) {
      _tabController.animateTo(issue.tabIndex);
    }
    final deadline = DateTime.now().add(const Duration(milliseconds: 900));
    while (mounted && DateTime.now().isBefore(deadline)) {
      if (_tabController.index == issue.tabIndex &&
          !_tabController.indexIsChanging &&
          _keyForField(issue.field)?.currentContext != null) {
        break;
      }
      await Future<void>.delayed(const Duration(milliseconds: 40));
    }
    if (!mounted) return;
    await WidgetsBinding.instance.endOfFrame;
    _ensureFieldVisible(issue.field);
    _requestFieldFocus(issue.field);
    await Future<void>.delayed(const Duration(milliseconds: 280));
    if (!mounted) return;
    _ensureFieldVisible(issue.field);
    await Future<void>.delayed(const Duration(milliseconds: 220));
    if (!mounted) return;
    _ensureFieldVisible(issue.field);
  }

  void _requestFieldFocus(String field) {
    switch (field) {
      case 'nombre':
        _nombreFocusNode.requestFocus();
        return;
      case 'apellidos':
        _apellidosFocusNode.requestFocus();
        return;
      case 'dni':
        _dniFocusNode.requestFocus();
        return;
      case 'observaciones':
        _observacionesFocusNode.requestFocus();
        return;
      case 'importe':
        _importeFocusNode.requestFocus();
        return;
    }
  }

  ScrollController _scrollControllerForField(String field) {
    switch (ruteroScrollPaneForField(field)) {
      case RuteroScrollPane.products:
        return _productsScrollController;
      case RuteroScrollPane.payment:
        return _paymentScrollController;
      case RuteroScrollPane.finalize:
        return _finalizeScrollController;
    }
  }

  void _ensureFieldVisible(String field) {
    final paneController = _scrollControllerForField(field);
    if (ruteroScrollPaneForField(field) == RuteroScrollPane.products &&
        paneController.hasClients) {
      paneController.animateTo(
        paneController.position.minScrollExtent,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      );
    }
    final key = _keyForField(field);
    final ctx = key?.currentContext;
    if (ctx == null) return;
    final renderObject = ctx.findRenderObject();
    if (renderObject == null) return;
    final nearest = Scrollable.maybeOf(ctx);
    if (nearest != null) {
      nearest.position.ensureVisible(
        renderObject,
        alignment: 0.12,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
      return;
    }
    if (paneController.hasClients) {
      final viewport = RenderAbstractViewport.maybeOf(renderObject);
      if (viewport != null) {
        final reveal = viewport.getOffsetToReveal(renderObject, 0.08);
        final position = paneController.position;
        final target = reveal.offset.clamp(
          position.minScrollExtent,
          position.maxScrollExtent,
        );
        paneController.animateTo(
          target,
          duration: const Duration(milliseconds: 320),
          curve: Curves.easeOutCubic,
        );
        return;
      }
    }
    Scrollable.ensureVisible(
      ctx,
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutCubic,
      alignment: 0.08,
      alignmentPolicy: ScrollPositionAlignmentPolicy.explicit,
    );
  }

  bool _validateFields() {
    if (_isAcknowledgedTombstone && _isCompleted) {
      _showError('Esta entrega ya fue confirmada.');
      return false;
    }

    final linesError = validateRuteroLoadedDeliveryLines(
      items: _items,
      isLoading: _isLoadingItems,
      loadError: _itemsError,
      allowEmpty: _albaran.isZeroEmpty,
    );
    final anyQtyModified = _items.any(
      (item) => _quantityDiffers(
        _productQuantities[ruteroLineKey(item)] ?? item.cantidadPedida,
        item.cantidadPedida,
      ),
    );
    final anyUnchecked =
        _items.any((item) => !(_productChecked[ruteroLineKey(item)] ?? false));

    if (_albaran.isPendingPrice) {
      _showError(
        'Importe pendiente de precio/pesaje en ERP. No se puede confirmar a 0,00 €.',
      );
      return false;
    }

    final result = validateRuteroDeliveryForm(
      RuteroDeliveryValidationInput(
        isLoadingItems: _isLoadingItems,
        loadError: linesError,
        hasItems: _items.isNotEmpty,
        anyQtyModified: anyQtyModified,
        anyUnchecked: anyUnchecked,
        status: _deliveryStatus,
        nombre: _nombreController.text,
        apellidos: _apellidosController.text,
        dni: _dniController.text,
        observaciones: _observacionesController.text,
        incidenciaMotivo: _incidenciaMotivoController.text,
        isUrgent: _isUrgent,
        isPaid: _isPaid,
        signatureEmpty: _signatureController.isEmpty,
        hasPersistedSignature: _hasPersistedSignature,
        importeCobradoText: _importeCobradoController.text,
        importeTotal: _albaran.importeTotal,
      ),
    );

    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _validationIssues = result.issues;
      _spotlightField = result.isValid ? null : result.issues.first.field;
      _itemsError = result.messageFor('items') ?? _itemsError;
      _productsStatusError = result.messageFor('productsStatus');
      _pagoError = result.messageFor('pago');
      _importeCobradoError = result.messageFor('importe');
      _nombreError = result.messageFor('nombre');
      _apellidosError = result.messageFor('apellidos');
      _dniError = result.messageFor('dni');
      _observacionesError = result.messageFor('observaciones');
      _firmaError = result.messageFor('firma');
    });

    if (!result.isValid) {
      HapticFeedback.heavyImpact();
      final target = result.issues.firstWhere(
        (issue) => issue.tabIndex == result.firstTabIndex,
        orElse: () => result.issues.first,
      );
      unawaited(_revealValidationIssue(target));
    }

    return result.isValid;
  }

  Future<bool> _showConfirmationDialog() async {
    final noEntrega = _deliveryStatus == RepartoDeliveryStatus.noEntregado;
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Icon(
              noEntrega ? Icons.cancel_outlined : Icons.check_circle_outline,
              color: noEntrega ? AppTheme.warning : AppTheme.success,
              size: 28,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                noEntrega ? 'Registrar no entrega' : 'Confirmar Entrega',
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              noEntrega
                  ? 'Se registrará como no entregado sin cobro ni firma.'
                  : '¿Está seguro de confirmar esta entrega?',
              style:
                  const TextStyle(color: AppTheme.textSecondary, fontSize: 14),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.softPanel,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.description,
                        size: 16,
                        color: AppTheme.textTertiary,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        _isFactura
                            ? 'Factura ${widget.albaran.numeroFactura}'
                            : 'Albarán ${widget.albaran.numeroAlbaran}',
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                  if (noEntrega) ...[
                    const SizedBox(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.notes,
                          size: 16,
                          color: AppTheme.textTertiary,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _observacionesController.text.trim().isEmpty
                                ? _incidenciaMotivoController.text.trim()
                                : _observacionesController.text.trim(),
                            style: const TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ] else ...[
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(
                          Icons.person,
                          size: 16,
                          color: AppTheme.textTertiary,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            '${_nombreController.text} (${_dniController.text})',
                            style: const TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 13,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    if (_isPaid) ...[
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          const Icon(
                            Icons.payment,
                            size: 16,
                            color: AppTheme.success,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            'Cobrado: $_selectedPaymentMethod',
                            style: const TextStyle(
                              color: AppTheme.success,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text(
              'CANCELAR',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: noEntrega ? AppTheme.warning : AppTheme.success,
              foregroundColor: Colors.white,
            ),
            child: Text(noEntrega ? 'REGISTRAR' : 'CONFIRMAR'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  EstadoEntrega _localDeliveryStatus() {
    switch (_deliveryStatus) {
      case RepartoDeliveryStatus.entregado:
        return EstadoEntrega.entregado;
      case RepartoDeliveryStatus.parcial:
        return EstadoEntrega.parcial;
      case RepartoDeliveryStatus.noEntregado:
        return EstadoEntrega.noEntregado;
      case RepartoDeliveryStatus.rechazado:
        return EstadoEntrega.rechazado;
    }
  }

  Future<void> _submitDelivery() async {
    if (_isSubmitting) return;
    if (_isJournalBlocked) {
      try {
        await _confirmationJournal.resetIfNotAcknowledged(widget.albaran.id);
        if (mounted) setState(() => _isJournalBlocked = false);
      } on RepartoAlreadyAcknowledgedException {
        if (mounted) {
          setState(() => _isAcknowledgedTombstone = true);
        }
        _showError('Esta entrega ya fue confirmada.');
        return;
      }
    }
    if (!_validateFields()) return;
    if (!_confirmationOperation.beginSubmit()) return;

    setState(() => _isSubmitting = true);

    try {
      final confirmed = await _showConfirmationDialog();
      if (!confirmed || !mounted) return;

      final signaturePng =
          _deliveryStatus == RepartoDeliveryStatus.noEntregado ||
                  (_hasPersistedSignature && _signatureController.isEmpty)
              ? null
              : await _signatureController.toPngBytes() ??
                  (throw Exception('Error al procesar firma'));

      var finalObs = _observacionesController.text.trim();
      final qtyChanges = <String>[];
      for (final item in _items) {
        final orig = item.cantidadPedida;
        final actual = _productQuantities[ruteroLineKey(item)] ?? orig;
        if (_quantityDiffers(actual, orig)) {
          qtyChanges.add(
            '${item.descripcion}: ${_formatQuantity(orig)} -> '
            '${_formatQuantity(actual)}',
          );
        }
      }
      if (qtyChanges.isNotEmpty) {
        finalObs += '\n--- Cambios de cantidad ---\n${qtyChanges.join('\n')}';
      }
      if (finalObs.length > 1000) {
        setState(() {
          _observacionesError =
              'Observaciones y cambios no pueden superar 1000 caracteres';
        });
        _tabController.animateTo(2);
        return;
      }
      final success = await _evidenceCoordinator.uploadThenConfirm<bool>(
        entregaId: widget.albaran.id,
        signaturePngBytes: signaturePng,
        photos: List<XFile>.unmodifiable(_evidencePhotos),
        repartidorId: _repartidorIdsParaInvalidar().isEmpty
            ? null
            : _repartidorIdsParaInvalidar().first,
        confirm: (evidence) => _confirmarEntregaCanonica(
          firmaId: evidence.signatureId,
          evidenceIds: evidence.photoIds,
          observaciones: finalObs,
        ),
      );

      if (!mounted) return;
      if (!success) {
        _showError('No se pudo registrar la entrega');
        return;
      }

      // Queued writes are deliberately not presented as completed work. The
      // current list stays authoritative until SyncQueue receives a valid
      // server acknowledgement and triggers its refresh revision.
      if (_lastConfirmWasQueued) {
        await HapticFeedback.lightImpact();
        if (!mounted) return;
        setState(() => _allowProgrammaticDismiss = true);
        final messenger = ScaffoldMessenger.of(context);
        Navigator.pop(context);
        messenger.showSnackBar(
          SnackBar(
            content: const Row(
              children: <Widget>[
                Icon(Icons.cloud_upload_outlined, color: Colors.white),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Entrega pendiente de sincronizar. No aparecerá como entregada hasta que el servidor confirme.',
                  ),
                ),
              ],
            ),
            backgroundColor: Colors.orange.shade700,
            duration: const Duration(seconds: 5),
          ),
        );
        return;
      }

      await HapticFeedback.heavyImpact();
      final state = widget.ref.read(entregasProvider);
      final updated = state.albaranes.firstWhere(
        (albaran) => albaran.id == widget.albaran.id,
        orElse: () => widget.albaran,
      );
      widget.albaran
        ..firma = updated.firma
        ..estado = _localDeliveryStatus();

      try {
        await runRuteroPostConfirmationEffects(
          shouldPrint: _tieneImpresora &&
              _deliveryStatus != RepartoDeliveryStatus.noEntregado,
          printTicket: _tryPrintTicketAfterConfirm,
          shareReceipt: _showShareReceiptDialog,
        );
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Entrega guardada; el comprobante no está disponible ahora',
              ),
              backgroundColor: AppTheme.warning,
            ),
          );
        }
      }

      if (!mounted) return;
      setState(() => _allowProgrammaticDismiss = true);
      final messenger = ScaffoldMessenger.of(context);
      final noEntregaSnack =
          _deliveryStatus == RepartoDeliveryStatus.noEntregado;
      final exceptionSnack = noEntregaSnack ||
          _deliveryStatus == RepartoDeliveryStatus.parcial ||
          _deliveryStatus == RepartoDeliveryStatus.rechazado;
      final snackMessage = switch (_deliveryStatus) {
        RepartoDeliveryStatus.noEntregado =>
          'No entrega registrada. No computa como entrega realizada.',
        RepartoDeliveryStatus.parcial =>
          'Entrega parcial registrada. La diferencia queda avisada para seguimiento.',
        RepartoDeliveryStatus.rechazado =>
          'Entrega rechazada registrada. No computa como entrega realizada.',
        RepartoDeliveryStatus.entregado =>
          'Entrega registrada. Ya puedes ver la nota y el albarán/factura.',
      };
      // Stay on completed view so today's stop keeps both document actions.
      messenger.showSnackBar(
        SnackBar(
          content: Row(
            children: [
              Icon(
                exceptionSnack
                    ? Icons.warning_amber_rounded
                    : Icons.check_circle,
                color: Colors.white,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(snackMessage),
              ),
            ],
          ),
          backgroundColor: exceptionSnack ? AppTheme.warning : AppTheme.success,
          duration: const Duration(seconds: 3),
        ),
      );
    } catch (error) {
      if (mounted) {
        final disposition = repartoConfirmationErrorDisposition(
          error: error,
          acknowledged: _isAcknowledgedTombstone,
        );
        final presentation = repartoConfirmationErrorPresentation(
          error: error,
          acknowledged: _isAcknowledgedTombstone,
        );
        switch (disposition) {
          case RepartoConfirmationErrorDisposition.alreadyConfirmed:
            _showAlreadyDeliveredDialog();
          case RepartoConfirmationErrorDisposition.manualReview:
            _showConfirmationError(presentation);
          case RepartoConfirmationErrorDisposition.retryable:
            _showConfirmationError(presentation);
        }
      }
    } finally {
      _confirmationOperation.endSubmit();
      if (mounted && _isSubmitting) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  void _showAlreadyDeliveredDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(
              Icons.warning_amber_rounded,
              color: AppTheme.warning,
              size: 28,
            ),
            SizedBox(width: 12),
            Text(
              'Entrega ya confirmada',
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
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
              backgroundColor: AppTheme.info,
              foregroundColor: Colors.white,
            ),
            child: const Text('ENTENDIDO'),
          ),
        ],
      ),
    );
  }

  void _showConfirmationError(
    RepartoConfirmationErrorPresentation presentation,
  ) {
    ScaffoldMessenger.of(context).showSnackBar(
      repartoConfirmationErrorSnackBar(
        presentation: presentation,
        onRetry: presentation.canRetry ? _submitDelivery : null,
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

  Future<void> _printCanonicalDeliveryNote() async {
    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando nota de entrega...',
    );
    try {
      final pdfData = _cachedPdfBase64 ?? await _generateReceiptPdf();
      if (pdfData == null || pdfData.isEmpty) {
        throw const RepartoReceiptUnavailableException();
      }
      _cachedPdfBase64 = pdfData;
      modal.close();
      await Printing.layoutPdf(
        onLayout: (_) async => Uint8List.fromList(base64Decode(pdfData)),
      );
    } on RepartoReceiptUnavailableException {
      modal.close();
      if (mounted) {
        _showError('La nota firmada todavía no está disponible para imprimir.');
      }
    } catch (error) {
      modal.close();
      if (mounted) {
        _showError(
          repartidorSafeOperationMessage(
            error: error,
            operation: 'receiptPrint',
          ),
        );
      }
    }
  }

  Future<void> _tryPrintTicketAfterConfirm() async {
    try {
      await _showZebraPrintPreview().timeout(const Duration(seconds: 12));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Entrega guardada. El ticket Bluetooth no se pudo enviar; imprímelo luego.',
          ),
          backgroundColor: AppTheme.warning,
        ),
      );
    }
  }

  Future<void> _showZebraPrintPreview() async {
    if (!mounted) return;
    await showRuteroPrintPreviewDialog(
      context: context,
      albaran: widget.albaran,
      items: _items,
      observaciones: _observacionesController.text.trim(),
      receptorNombre: _nombreController.text.trim(),
      receptorDni: _dniController.text.trim(),
      signatureController: _signatureController,
      printerName: _printerName,
      printerProtocol: _printerProtocol,
      onEnsurePrinter: () async {
        final addr = await ZebraPrintService.getSavedPrinterAddress();
        if (addr != null && addr.isNotEmpty) return true;
        await _selectAndSavePrinter();
        final saved = await ZebraPrintService.getSavedPrinterAddress();
        return saved != null && saved.isNotEmpty;
      },
      onPrinted: () {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Ticket enviado a la impresora'),
            backgroundColor: AppTheme.success,
          ),
        );
      },
    );
  }

  Future<void> _showShareReceiptDialog() async {
    final isFactura = widget.albaran.numeroFactura > 0;
    final commercialLabel = isFactura ? 'factura' : 'albarán';
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          side: BorderSide(color: AppTheme.info.withValues(alpha: 0.28)),
        ),
        title: const Row(
          children: [
            RepartidorExecutiveIcon(
              icon: Icons.folder_shared_outlined,
              color: AppTheme.info,
            ),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                'Documentos de la entrega',
                style: TextStyle(color: AppTheme.textPrimary),
              ),
            ),
          ],
        ),
        content: SizedBox(
          width: double.maxFinite,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Elige qué documento quieres ver o enviar. Son dos cosas distintas.',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
                const SizedBox(height: 16),
                const Text(
                  'NOTA DE ENTREGA',
                  style: TextStyle(
                    color: AppTheme.textTertiary,
                    fontWeight: FontWeight.bold,
                    fontSize: 11,
                    letterSpacing: 0.4,
                  ),
                ),
                const SizedBox(height: 8),
                _buildShareButton(
                  icon: Icons.receipt_long,
                  label: 'Ver nota de entrega',
                  color: AppTheme.accentIndigo,
                  onTap: () async {
                    Navigator.pop(ctx);
                    await _previewReceiptPdf();
                  },
                ),
                const SizedBox(height: 8),
                _buildShareButton(
                  icon: Icons.share,
                  label: 'Compartir nota',
                  color: AppTheme.success,
                  onTap: () async {
                    Navigator.pop(ctx);
                    await _shareDeliveryNoteLocally();
                  },
                ),
                const SizedBox(height: 8),
                _buildShareButton(
                  icon: Icons.chat,
                  label: 'Nota por WhatsApp',
                  color: const Color(0xFF25D366),
                  onTap: () async {
                    Navigator.pop(ctx);
                    await _shareDeliveryNoteViaWhatsApp();
                  },
                ),
                const SizedBox(height: 8),
                _buildShareButton(
                  icon: Icons.email,
                  label: 'Email nota de entrega',
                  color: AppTheme.accentIndigo,
                  onTap: () async {
                    Navigator.pop(ctx);
                    await _emailReceipt();
                  },
                ),
                const SizedBox(height: 8),
                _buildShareButton(
                  icon: Icons.print,
                  label: 'Imprimir nota (PDF)',
                  color: AppTheme.warning,
                  onTap: () async {
                    Navigator.pop(ctx);
                    await _printCanonicalDeliveryNote();
                  },
                ),
                const SizedBox(height: 18),
                Text(
                  isFactura ? 'FACTURA (CON FIRMA)' : 'ALBARÁN (CON FIRMA)',
                  style: const TextStyle(
                    color: AppTheme.textTertiary,
                    fontWeight: FontWeight.bold,
                    fontSize: 11,
                    letterSpacing: 0.4,
                  ),
                ),
                const SizedBox(height: 8),
                _buildShareButton(
                  icon: Icons.picture_as_pdf,
                  label: 'Ver $commercialLabel',
                  color: AppTheme.info,
                  onTap: () async {
                    Navigator.pop(ctx);
                    await _previewCommercialPdf();
                  },
                ),
                const SizedBox(height: 8),
                _buildShareButton(
                  icon: Icons.ios_share,
                  label: 'Compartir $commercialLabel',
                  color: AppTheme.success,
                  onTap: () async {
                    Navigator.pop(ctx);
                    await _shareCommercialLocally();
                  },
                ),
                const SizedBox(height: 8),
                _buildShareButton(
                  icon: Icons.chat,
                  label:
                      '${commercialLabel[0].toUpperCase()}${commercialLabel.substring(1)} por WhatsApp',
                  color: const Color(0xFF25D366),
                  onTap: () async {
                    Navigator.pop(ctx);
                    await _shareCommercialViaWhatsApp();
                  },
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text(
              'Seguir en la entrega',
              style: TextStyle(color: AppTheme.textTertiary),
            ),
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
      color: AppTheme.raisedSurface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        side: BorderSide(color: color.withValues(alpha: 0.28)),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Icon(icon, color: color, size: 24),
              const SizedBox(width: 12),
              Text(
                label,
                style: TextStyle(color: color, fontWeight: FontWeight.w600),
              ),
              const Spacer(),
              Icon(Icons.chevron_right, color: color.withValues(alpha: 0.6)),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _previewCommercialPdf() async {
    final alb = widget.albaran;
    final isFactura = alb.numeroFactura > 0;
    final modal = AsyncOperationModal.show(
      context,
      text: isFactura ? 'Cargando factura...' : 'Cargando albarán...',
    );
    try {
      final bytes = await _downloadCommercialPdfBytes();
      modal.close();
      if (!mounted) return;
      final title = isFactura
          ? 'Factura ${alb.serieFactura}/${alb.numeroFactura}'
          : 'Albarán ${alb.serie}/${alb.numeroAlbaran}';
      final fileName = isFactura
          ? 'Factura_${alb.ejercicio}_${alb.serieFactura}_${alb.numeroFactura}.pdf'
          : 'Albaran_${alb.ejercicio}_${alb.serie}_${alb.numeroAlbaran}.pdf';
      unawaited(
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PdfPreviewScreen(
              pdfBytes: Uint8List.fromList(bytes),
              title: title,
              fileName: fileName,
            ),
          ),
        ),
      );
    } catch (error) {
      modal.close();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            repartidorSafeOperationMessage(
              error: error,
              operation: 'pdfPreview',
            ),
          ),
        ),
      );
    }
  }

  /// ERP albarán PDF (legacy name kept for fallbacks).
  Future<void> _previewAlbaranPdf() => _previewCommercialPdf();

  Future<List<int>> _downloadCommercialPdfBytes() async {
    final alb = widget.albaran;
    final isFactura = alb.numeroFactura > 0;
    if (isFactura) {
      return RepartidorDataService.downloadDocument(
        year: alb.ejercicio,
        serie: alb.serieFactura.isNotEmpty ? alb.serieFactura : alb.serie,
        number: alb.numeroFactura,
        type: 'factura',
        terminal: alb.terminal,
        facturaNumber: alb.numeroFactura,
        serieFactura:
            alb.serieFactura.isNotEmpty ? alb.serieFactura : alb.serie,
        ejercicioFactura: alb.ejercicio,
        albaranNumber: alb.numeroAlbaran,
        albaranSerie: alb.serie,
        albaranTerminal: alb.terminal,
        albaranYear: alb.ejercicio,
        repartidorId: alb.codigoRepartidor,
      );
    }
    return RepartidorDataService.downloadDocument(
      year: alb.ejercicio,
      serie: alb.serie,
      number: alb.numeroAlbaran,
      type: 'albaran',
      terminal: alb.terminal,
      repartidorId: alb.codigoRepartidor,
    );
  }

  Future<File> _prepareCommercialPdfFile() async {
    final alb = widget.albaran;
    final bytes = await _downloadCommercialPdfBytes();
    final tempDir = await getTemporaryDirectory();
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final isFactura = alb.numeroFactura > 0;
    final file = File(
      isFactura
          ? '${tempDir.path}/factura_${alb.ejercicio}_${alb.serieFactura}_${alb.numeroFactura}_$timestamp.pdf'
          : '${tempDir.path}/albaran_${alb.ejercicio}_${alb.serie}_${alb.numeroAlbaran}_$timestamp.pdf',
    );
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  Future<File> _prepareDeliveryNotePdfFile() async {
    final alb = widget.albaran;
    final confirmationId = await _resolveReceiptConfirmationId();
    final bytes = await RepartidorDataService.downloadDeliveryNotePdf(
      confirmationId: confirmationId,
      repartidorId: alb.codigoRepartidor,
    );
    final tempDir = await getTemporaryDirectory();
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final label = alb.numeroFactura > 0
        ? 'F${alb.numeroFactura}'
        : 'A${alb.numeroAlbaran}';
    final file = File('${tempDir.path}/nota_entrega_${label}_$timestamp.pdf');
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  Future<File> _prepareAlbaranPdfFile() => _prepareCommercialPdfFile();

  Rect? _shareOrigin() {
    final renderBox = context.findRenderObject() as RenderBox?;
    if (renderBox == null) return null;
    return Rect.fromCenter(
      center: Offset(renderBox.size.width / 2, renderBox.size.height / 2),
      width: 1,
      height: 1,
    );
  }

  Future<void> _previewReceiptPdf() async {
    final modal =
        AsyncOperationModal.show(context, text: 'Generando nota de entrega...');
    try {
      final pdfData = _cachedPdfBase64 ?? await _generateReceiptPdf();
      if (pdfData == null) throw Exception('No se pudo generar el PDF');
      _cachedPdfBase64 = pdfData;

      modal.close();
      if (!mounted) return;

      final pdfBytes = base64Decode(pdfData);
      const title = 'Nota de entrega';
      final fileName =
          'Nota_Entrega_${widget.albaran.numeroFactura > 0 ? "F${widget.albaran.numeroFactura}" : "A${widget.albaran.numeroAlbaran}"}.pdf';

      if (!mounted) return;
      unawaited(
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PdfPreviewScreen(
              pdfBytes: pdfBytes,
              title: title,
              fileName: fileName,
              onEmailTap: () {
                Navigator.pop(context);
                _emailReceipt();
              },
              onWhatsAppTap: () {
                Navigator.pop(context);
                unawaited(_shareDeliveryNoteViaWhatsApp());
              },
            ),
          ),
        ),
      );
    } on RepartoReceiptUnavailableException {
      modal.close();
      if (!mounted) return;
      _showConfirmationError(
        repartoConfirmationErrorPresentation(
          error: const RepartoReceiptUnavailableException(),
          acknowledged: _isAcknowledgedTombstone,
        ),
      );
    } catch (error) {
      modal.error(
        repartidorSafeOperationMessage(error: error, operation: 'pdfPreview'),
        onRetry: _previewReceiptPdf,
      );
    }
  }

  Future<void> _downloadReceiptPdf() async {
    await _shareDeliveryNoteLocally();
  }

  Future<void> _shareDeliveryNoteLocally() async {
    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando nota de entrega...',
    );
    try {
      final file = await _prepareDeliveryNotePdfFile();
      modal.close();
      if (!mounted) return;
      await Share.shareXFiles(
        <XFile>[XFile(file.path, mimeType: 'application/pdf')],
        text:
            'Nota de entrega ${widget.albaran.serie}-${widget.albaran.numeroAlbaran}',
        subject: 'Nota de entrega',
        sharePositionOrigin: _shareOrigin(),
      );
    } on RepartoReceiptUnavailableException {
      modal.close();
      if (!mounted) return;
      _showConfirmationError(
        repartoConfirmationErrorPresentation(
          error: const RepartoReceiptUnavailableException(),
          acknowledged: _isAcknowledgedTombstone,
        ),
      );
    } catch (_) {
      modal.close();
      if (mounted) {
        _showError('No se pudo preparar la nota de entrega.');
      }
    }
  }

  Future<void> _shareCommercialLocally() async {
    final isFactura = widget.albaran.numeroFactura > 0;
    final label = isFactura ? 'factura' : 'albarán';
    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando $label...',
    );
    try {
      final file = await _prepareCommercialPdfFile();
      modal.close();
      if (!mounted) return;
      final subject = isFactura
          ? 'Factura ${widget.albaran.numeroFactura}'
          : 'Albarán ${widget.albaran.serie}-${widget.albaran.numeroAlbaran}';
      await Share.shareXFiles(
        <XFile>[XFile(file.path, mimeType: 'application/pdf')],
        text: subject,
        subject: subject,
        sharePositionOrigin: _shareOrigin(),
      );
    } catch (_) {
      modal.close();
      if (mounted) {
        _showError('No se pudo preparar el $label.');
      }
    }
  }

  Future<void> _shareDeliveryNoteViaWhatsApp() async {
    final owner = widget.albaran.codigoRepartidor.trim();
    if (!isValidRepartoOwnerId(owner)) {
      _showError('Selecciona un repartidor concreto para compartir.');
      return;
    }
    final form = await WhatsAppFormModal.show(
      context,
      defaultMessage:
          'Nota de entrega ${widget.albaran.serie}-${widget.albaran.numeroAlbaran}. '
          'Gracias por su confianza.',
    );
    if (!mounted || form == null) return;

    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando nota de entrega para WhatsApp...',
    );
    try {
      final confirmationId = await _resolveReceiptConfirmationId();
      final whatsapp = await RepartidorDataService.shareDeliveryNoteViaWhatsApp(
        confirmationId: confirmationId,
        telefono: form.phone,
        repartidorId: owner,
        clienteNombre: widget.albaran.nombreCliente,
        mensaje: form.message,
      );
      if (whatsapp.deliveredByBot) {
        modal.close();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Nota de entrega enviada por WhatsApp con su PDF.'),
            backgroundColor: AppTheme.success,
          ),
        );
        return;
      }

      final file = await _prepareDeliveryNotePdfFile();
      modal.close();
      if (!mounted) return;
      await Share.shareXFiles(
        <XFile>[XFile(file.path, mimeType: 'application/pdf')],
        text: form.message,
        subject: 'Nota de entrega',
        sharePositionOrigin: _shareOrigin(),
      );
      final url = whatsapp.whatsappUrl;
      if (url != null && url.isNotEmpty) {
        final uri = Uri.tryParse(url);
        if (uri != null && await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      }
    } on RepartoReceiptUnavailableException {
      modal.close();
      if (!mounted) return;
      _showConfirmationError(
        repartoConfirmationErrorPresentation(
          error: const RepartoReceiptUnavailableException(),
          acknowledged: _isAcknowledgedTombstone,
        ),
      );
    } catch (error) {
      modal.close();
      if (mounted) {
        _showError(
          repartidorSafeOperationMessage(
            error: error,
            operation: 'receiptWhatsApp',
          ),
        );
      }
    }
  }

  Future<void> _shareCommercialViaWhatsApp({
    WhatsAppFormResult? prefilled,
  }) async {
    final owner = widget.albaran.codigoRepartidor.trim();
    if (!isValidRepartoOwnerId(owner)) {
      _showError('Selecciona un repartidor concreto para compartir.');
      return;
    }
    final isFactura = widget.albaran.numeroFactura > 0;
    final docLabel = isFactura ? 'Factura' : 'Albarán';
    final form = prefilled ??
        await WhatsAppFormModal.show(
          context,
          defaultMessage:
              '$docLabel ${isFactura ? widget.albaran.numeroFactura : '${widget.albaran.serie}-${widget.albaran.numeroAlbaran}'}. '
              'Gracias por su confianza.',
        );
    if (!mounted || form == null) return;

    final modal = AsyncOperationModal.show(
      context,
      text: 'Enviando $docLabel por WhatsApp...',
    );
    try {
      final whatsapp = await RepartidorDataService.shareWhatsApp(
        year: widget.albaran.ejercicio,
        serie: isFactura && widget.albaran.serieFactura.isNotEmpty
            ? widget.albaran.serieFactura
            : widget.albaran.serie,
        number: isFactura
            ? widget.albaran.numeroFactura
            : widget.albaran.numeroAlbaran,
        type: isFactura ? 'factura' : 'albaran',
        telefono: form.phone,
        repartidorId: owner,
        clienteNombre: widget.albaran.nombreCliente,
        mensaje: form.message,
        terminal: widget.albaran.terminal,
        albaranNumber: widget.albaran.numeroAlbaran,
        albaranSerie: widget.albaran.serie,
        albaranTerminal: widget.albaran.terminal,
        albaranYear: widget.albaran.ejercicio,
      );

      if (whatsapp.deliveredByBot) {
        modal.close();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '$docLabel enviado por el WhatsApp corporativo (mensaje + PDF).',
            ),
            backgroundColor: AppTheme.success,
          ),
        );
        return;
      }

      if (!whatsapp.localShare || whatsapp.sent) {
        throw const RepartidorDataException(
          'No se pudo preparar el envío por WhatsApp.',
        );
      }

      final file = await _prepareCommercialPdfFile();
      modal.close();
      if (!mounted) return;
      await Share.shareXFiles(
        <XFile>[XFile(file.path, mimeType: 'application/pdf')],
        text: form.message,
        subject: docLabel,
        sharePositionOrigin: _shareOrigin(),
      );
      final url = whatsapp.whatsappUrl;
      if (url != null && url.isNotEmpty) {
        final uri = Uri.tryParse(url);
        if (uri != null && await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      }
    } catch (_) {
      modal.close();
      if (mounted) {
        _showError('No se pudo preparar el $docLabel para WhatsApp.');
      }
    }
  }

  Future<void> _shareReceiptViaWhatsApp() => _shareDeliveryNoteViaWhatsApp();

  Future<void> _sharePdfLocally() => _shareDeliveryNoteLocally();

  Future<void> _showEmailUnavailable() async {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Email no disponible hasta habilitar destinatarios canónicos.',
        ),
        backgroundColor: AppTheme.warning,
      ),
    );
  }

  Future<void> _emailReceipt() async {
    if (!mounted) return;
    final controller = TextEditingController(text: widget.albaran.emailCliente);
    final email = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Enviar recibo por email'),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () =>
                Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Enviar'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (!mounted || email == null) return;
    final owner = widget.albaran.codigoRepartidor.trim();
    if (!isValidRepartoReceiptEmailAddress(email) ||
        !isValidRepartoOwnerId(owner)) {
      _showError('Selecciona un email y un repartidor válidos.');
      return;
    }
    final modal = AsyncOperationModal.show(context, text: 'Enviando recibo...');
    try {
      final confirmationId = await _resolveReceiptConfirmationId();
      await RepartidorDataService.emailDeliveryNote(
        confirmationId: confirmationId,
        destinatario: email,
        repartidorId: owner,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Receipt sent to ${email.trim()}')),
        );
      }
    } on RepartoReceiptUnavailableException catch (error) {
      if (mounted) {
        _showConfirmationError(
          repartoConfirmationErrorPresentation(
            error: error,
            acknowledged: _isAcknowledgedTombstone,
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        _showError(
          repartidorSafeOperationMessage(
            error: error,
            operation: 'receiptEmail',
          ),
        );
      }
    } finally {
      modal.close();
    }
  }

  Future<String> _resolveReceiptConfirmationId() async {
    try {
      return await _confirmationJournal
          .receiptConfirmationId(widget.albaran.id);
    } on RepartoReceiptUnavailableException {
      final fromList = widget.albaran.confirmationId?.trim() ?? '';
      if (fromList.isNotEmpty && isValidRepartoServerId(fromList)) {
        return fromList;
      }
      throw const RepartoReceiptUnavailableException();
    }
  }

  Future<String?> _generateReceiptPdf() async {
    try {
      final confirmationId = await _resolveReceiptConfirmationId();
      final response = await ApiClient.get(
        RepartoCanonicalReceiptRequest(
          confirmationId,
          repartidorId: widget.albaran.codigoRepartidor,
        ).endpoint,
        forceRefresh: true,
        allowStale: false,
        receiveTimeout: const Duration(seconds: 20),
      );
      return RepartoReceiptPdf.fromResponse(response).base64;
    } on RepartoReceiptUnavailableException {
      rethrow;
    } catch (_) {
      throw const RepartoReceiptUnavailableException();
    }
  }
}
