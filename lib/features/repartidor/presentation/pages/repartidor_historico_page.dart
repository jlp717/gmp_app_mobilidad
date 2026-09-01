/// REPARTIDOR HISTÓRICO PAGE v4.0
/// Full redesign with advanced filters, year selector, search by number,
/// proper deduplication, and working signatures
///
/// Nivel 1: Lista de clientes con búsqueda
/// Nivel 2: Documentos del cliente con filtros avanzados
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/core/widgets/async_operation_modal.dart';
import 'package:gmp_app_mobilidad/core/widgets/offline_state_widget.dart';
import 'package:gmp_app_mobilidad/core/widgets/pdf_preview_screen.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart';
import 'package:gmp_app_mobilidad/core/widgets/whatsapp_form_modal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_receipt_contract.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/zebra_print_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_executive_ui.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

String _sanitizedDocumentActionError(
  Object error, {
  required String fallback,
}) {
  if (error is RepartidorDataException) {
    return switch (error.statusCode) {
      401 => 'La sesión ha caducado. Inicia sesión de nuevo.',
      403 => 'No tienes permiso para realizar esta acción.',
      404 => 'El documento ya no está disponible.',
      409 => 'El documento está cambiando. Actualiza el histórico.',
      503 => 'La acción no está disponible temporalmente.',
      _ => fallback,
    };
  }
  return fallback;
}

typedef RepartidorHistoryClientsLoader = Future<List<HistoryClient>> Function({
  required String repartidorId,
  String? search,
});

/// Paginated client loader used by the production path. [clientsLoader] is
/// kept for legacy callers and tests; it always represents one complete page.
typedef RepartidorHistoryClientsPageLoader = Future<HistoryClientsPage>
    Function({
  required String repartidorId,
  required int limit,
  required int offset,
  required bool forceRefresh,
  String? search,
});

typedef RepartidorHistoryDocumentsLoader = Future<List<HistoryDocument>>
    Function({
  required String clientId,
  required String repartidorId,
  String? dateFrom,
  String? dateTo,
  int? year,
});

typedef RepartidorHistoryDocumentsPageLoader = Future<HistoryDocumentsPage>
    Function({
  required String clientId,
  required String repartidorId,
  required int limit,
  required int offset,
  String? dateFrom,
  String? dateTo,
  int? year,
});

typedef RepartidorHistoryDocumentDownloader = Future<List<int>> Function({
  required int year,
  required String serie,
  required int number,
  required String type,
  required int terminal,
  int? facturaNumber,
  String? serieFactura,
  int? ejercicioFactura,
  int? albaranNumber,
  String? albaranSerie,
  int? albaranTerminal,
  int? albaranYear,
  String? repartidorId,
});

typedef RepartidorHistorySignatureLoader = Future<Map<String, dynamic>?>
    Function({
  required int ejercicio,
  required String serie,
  required int terminal,
  required int numero,
  required String repartidorId,
});

class RepartidorHistoricoPage extends StatefulWidget {
  const RepartidorHistoricoPage({
    required this.repartidorId,
    super.key,
    this.initialClientId,
    this.initialClientName,
    this.initialRepartidorId,
    this.clientsLoader,
    this.clientsPageLoader,
    this.documentsLoader,
    this.documentsPageLoader,
    this.documentDownloader,
    this.signatureLoader,
    this.canEmailDocuments = false,
  });
  final String repartidorId;
  final String? initialClientId;
  final String? initialClientName;
  final String? initialRepartidorId;
  final RepartidorHistoryClientsLoader? clientsLoader;
  final RepartidorHistoryClientsPageLoader? clientsPageLoader;
  final RepartidorHistoryDocumentsLoader? documentsLoader;
  final RepartidorHistoryDocumentsPageLoader? documentsPageLoader;
  final RepartidorHistoryDocumentDownloader? documentDownloader;
  final RepartidorHistorySignatureLoader? signatureLoader;

  /// Must come from an explicit backend capability. Fail closed by default.
  final bool canEmailDocuments;

  @override
  State<RepartidorHistoricoPage> createState() =>
      _RepartidorHistoricoPageState();
}

class _RepartidorHistoricoPageState extends State<RepartidorHistoricoPage> {
  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _docSearchController = TextEditingController();
  bool _isLoading = false;
  bool _isLoadingMoreClients = false;
  String? _clientsError;
  String? _clientsLoadMoreError;
  String? _documentsError;
  bool _isDownloadingDocument = false;
  bool _isSharingDocument = false;
  String? _selectedClientId;
  String? _selectedClientName;
  String? _selectedClientRepartidorId;
  List<_ClientItem> _clients = [];
  List<_DocumentItem> _documents = [];
  bool _hasMoreClients = false;
  bool _hasMoreDocuments = false;
  bool _isLoadingMoreDocuments = false;
  String? _documentsLoadMoreError;
  int _clientRequestGeneration = 0;
  int _clientRowsConsumed = 0;
  int _documentsRequestGeneration = 0;
  String? _clientsQuery;
  Timer? _clientSearchDebounce;
  String _clientSearchInput = '';
  CancelToken? _activeClientSearchCancelToken;

  static const _clientPageSize = 100;
  static const _documentPageSize = 50;
  static const _clientSearchDebounceDuration = Duration(milliseconds: 300);

  // Advanced Filters
  DateTime? _dateFrom;
  DateTime? _dateTo;
  _DocType? _filterDocType;
  _DeliveryStatus? _filterStatus;
  int? _selectedYear; // null = all recent years (last 3)

  @override
  void initState() {
    super.initState();
    if (widget.initialClientId != null) {
      // Navigate directly to client documents – set state immediately to show loading
      _selectedClientId = widget.initialClientId;
      _selectedClientName = widget.initialClientName ?? widget.initialClientId!;
      _selectedClientRepartidorId = resolveRepartoDocumentOwner(
        documentOwner: widget.initialRepartidorId,
        selectedOwner: widget.repartidorId,
      );
      _isLoading = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _loadClientDocuments(
          widget.initialClientId!,
          widget.initialClientName ?? widget.initialClientId!,
          repartidorId: _selectedClientRepartidorId,
        );
      });
      // Load clients list in background (won't conflict since _loadClientDocuments manages _isLoading)
      _loadClients();
    } else {
      _loadClients();
    }
  }

  @override
  void dispose() {
    _clientRequestGeneration++;
    _documentsRequestGeneration++;
    _clientSearchDebounce?.cancel();
    _activeClientSearchCancelToken?.cancel('historico_page_disposed');
    _searchController.dispose();
    _docSearchController.dispose();
    super.dispose();
  }

  // ==========================================================================
  // DATA LOADING
  // ==========================================================================

  Future<void> _loadClients([
    String? search,
    bool loadMore = false,
    bool forceRefresh = false,
  ]) async {
    final normalizedSearch = search?.trim();
    if (loadMore && _isLoadingMoreClients) return;
    final queryChanged = normalizedSearch != _clientsQuery;
    final append = loadMore && !queryChanged && _hasMoreClients;
    if (loadMore && !append) return;
    final requestGeneration = ++_clientRequestGeneration;
    final offset = append ? _clientRowsConsumed : 0;
    // Don't set loading if already viewing documents (would flash empty state)
    final isInDocView = _selectedClientId != null;
    if (append) {
      setState(() {
        _isLoadingMoreClients = true;
        _clientsLoadMoreError = null;
      });
    } else if (!isInDocView) {
      setState(() {
        _isLoading = true;
        _isLoadingMoreClients = false;
        _clientsError = null;
        _clientsLoadMoreError = null;
      });
    } else {
      setState(() {
        _isLoadingMoreClients = false;
        _clientsError = null;
        _clientsLoadMoreError = null;
      });
    }
    try {
      CancelToken? cancelToken;
      if (!append &&
          widget.clientsLoader == null &&
          widget.clientsPageLoader == null) {
        _activeClientSearchCancelToken?.cancel('historico_search_superseded');
        cancelToken = CancelToken();
        _activeClientSearchCancelToken = cancelToken;
      }
      final legacyLoader = widget.clientsLoader;
      final pageLoader = widget.clientsPageLoader;
      final page = legacyLoader != null
          ? (
              clients: await legacyLoader(
                repartidorId: widget.repartidorId,
                search: normalizedSearch,
              ),
              hasMore: false,
            )
          : pageLoader != null
              ? await pageLoader(
                  repartidorId: widget.repartidorId,
                  search: normalizedSearch,
                  limit: _clientPageSize,
                  offset: offset,
                  forceRefresh: forceRefresh,
                )
              : await RepartidorDataService.getHistoryClients(
                  repartidorId: widget.repartidorId,
                  search: normalizedSearch,
                  limit: _clientPageSize,
                  offset: offset,
                  forceRefresh: forceRefresh,
                  cancelToken: cancelToken,
                );
      if (!mounted || requestGeneration != _clientRequestGeneration) return;
      final mappedClients = page.clients
          .map(
            (c) => _ClientItem(
              id: c.id,
              name: c.name,
              address: c.address,
              totalDocuments: c.totalDocuments,
              totalAmount: c.totalAmount,
              lastVisit: c.lastVisit,
              repartidorId: c.repCode,
            ),
          )
          .toList();
      final merged =
          append ? <_ClientItem>[..._clients, ...mappedClients] : mappedClients;
      final byId = <String, _ClientItem>{
        for (final client in merged) client.selectionKey: client,
      };
      final ordered = byId.values.toList()
        ..sort((a, b) {
          final byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
          return byName != 0 ? byName : a.id.compareTo(b.id);
        });
      setState(() {
        _clients = ordered;
        _clientsQuery = normalizedSearch;
        _clientRowsConsumed = offset + page.clients.length;
        _hasMoreClients = page.hasMore;
        _clientsError = null;
        _clientsLoadMoreError = null;
      });
      if (_selectedClientId != null &&
          _selectedClientRepartidorId == null &&
          _documents.isEmpty) {
        final matches = ordered
            .where(
              (client) =>
                  client.id == _selectedClientId &&
                  isValidRepartoOwnerId(client.repartidorId ?? ''),
            )
            .toList(growable: false);
        if (matches.length == 1) {
          final client = matches.single;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            _loadClientDocuments(
              client.id,
              client.name,
              repartidorId: client.repartidorId,
            );
          });
        }
      }
    } catch (_) {
      if (!mounted || requestGeneration != _clientRequestGeneration) return;
      setState(() {
        if (append && _clients.isNotEmpty) {
          _clientsLoadMoreError =
              'No se pudo cargar la siguiente página de clientes';
        } else {
          _clients = [];
          _clientRowsConsumed = 0;
          _hasMoreClients = false;
          _clientsError = 'No se pudo cargar el historial de clientes';
        }
      });
    }
    if (!mounted || requestGeneration != _clientRequestGeneration) return;
    setState(() {
      if (!isInDocView) _isLoading = false;
      _isLoadingMoreClients = false;
    });
  }

  Future<void> _loadClientDocuments(
    String clientId,
    String clientName, {
    String? repartidorId,
    bool loadMore = false,
  }) async {
    if (loadMore && (!_hasMoreDocuments || _isLoadingMoreDocuments)) return;

    final owner = resolveRepartoDocumentOwner(
      documentOwner: repartidorId ?? _selectedClientRepartidorId,
      selectedOwner: widget.repartidorId,
    );
    final requestGeneration =
        loadMore ? _documentsRequestGeneration : ++_documentsRequestGeneration;
    final selectedYear = _selectedYear;
    final dateFrom = _dateFrom;
    final dateTo = _dateTo;
    final offset = loadMore ? _documents.length : 0;

    setState(() {
      if (loadMore) {
        _isLoadingMoreDocuments = true;
        _documentsLoadMoreError = null;
      } else {
        _isLoading = true;
        _documentsError = null;
        _documentsLoadMoreError = null;
        _hasMoreDocuments = false;
        _selectedClientId = clientId;
        _selectedClientName = clientName;
        _selectedClientRepartidorId = owner;
      }
    });

    if (owner == null) {
      if (!loadMore) {
        setState(() {
          _isLoading = false;
          _documents = const [];
          _documentsError = 'Selecciona una ficha con un repartidor concreto.';
        });
      }
      return;
    }

    try {
      final dateFromStr = dateFrom != null
          ? '${dateFrom.year}-${dateFrom.month.toString().padLeft(2, '0')}-${dateFrom.day.toString().padLeft(2, '0')}'
          : null;
      final dateToStr = dateTo != null
          ? '${dateTo.year}-${dateTo.month.toString().padLeft(2, '0')}-${dateTo.day.toString().padLeft(2, '0')}'
          : null;

      final pageLoader = widget.documentsPageLoader;
      late final HistoryDocumentsPage page;
      if (pageLoader != null) {
        page = await pageLoader(
          clientId: clientId,
          repartidorId: owner,
          limit: _documentPageSize,
          offset: offset,
          dateFrom: dateFromStr,
          dateTo: dateToStr,
          year: selectedYear,
        );
      } else if (loadMore) {
        return;
      } else {
        final loader = widget.documentsLoader;
        if (loader != null) {
          final docs = await loader(
            clientId: clientId,
            repartidorId: owner,
            dateFrom: dateFromStr,
            dateTo: dateToStr,
            year: selectedYear,
          );
          page = (documents: docs, hasMore: false);
        } else {
          page = await RepartidorDataService.getClientDocumentsPage(
            clientId: clientId,
            repartidorId: owner,
            dateFrom: dateFromStr,
            dateTo: dateToStr,
            year: selectedYear,
            limit: _documentPageSize,
            offset: offset,
          );
        }
      }

      if (!mounted || requestGeneration != _documentsRequestGeneration) return;

      final mappedDocuments = page.documents.map((d) {
        _DeliveryStatus status;
        switch (d.status) {
          case 'delivered':
            status = _DeliveryStatus.delivered;
          case 'partial':
            status = _DeliveryStatus.partial;
          case 'en_ruta':
            status = _DeliveryStatus.enRuta;
          case 'no_delivered':
          case 'rechazado':
          case 'rejected':
            status = _DeliveryStatus.notDelivered;
          case 'pending':
          default:
            status = _DeliveryStatus.pending;
        }

        final parsedDate = DateTime.tryParse(d.date);
        return _DocumentItem(
          id: d.id,
          type: d.type == 'factura' ? _DocType.factura : _DocType.albaran,
          number: d.number,
          serie: d.serie,
          ejercicio: d.ejercicio,
          terminal: d.terminal,
          albaranNumber: d.albaranNumber ?? d.number,
          facturaNumber: d.facturaNumber,
          serieFactura: d.serieFactura,
          ejercicioFactura: d.ejercicioFactura,
          preparationOrderNumber: d.preparationOrderNumber,
          preparationOrderYear: d.preparationOrderYear,
          date: parsedDate,
          hasValidDate: parsedDate != null,
          amount: d.amount,
          pending: d.pending,
          status: status,
          hasSignature: d.hasSignature,
          signaturePath: d.signaturePath,
          deliveryDate: d.deliveryDate,
          deliveryObs: d.deliveryObs,
          time: d.time,
          legacySignatureName: d.legacySignatureName,
          hasLegacySignature: d.hasLegacySignature,
          legacyDate: d.legacyDate,
          confirmationId: d.confirmationId,
          cobroId: d.cobroId,
          cobrado: d.cobrado,
          importeCobrado: d.importeCobrado,
          importePendienteCobro: d.importePendienteCobro,
          formaPagoCobro: d.formaPagoCobro,
          cobroParcial: d.cobroParcial,
          repartidorId: resolveRepartoDocumentOwner(
            documentOwner: d.deliveryRepartidor,
            selectedOwner: owner,
          ),
        );
      }).toList(growable: false);

      setState(() {
        _documents = loadMore
            ? <_DocumentItem>[..._documents, ...mappedDocuments]
            : mappedDocuments;
        _hasMoreDocuments = page.hasMore;
        _documentsLoadMoreError = null;
        _isLoadingMoreDocuments = false;
        _documentsError = null;
      });
    } catch (e) {
      if (!mounted || requestGeneration != _documentsRequestGeneration) return;
      setState(() {
        if (loadMore) {
          _isLoadingMoreDocuments = false;
          _documentsLoadMoreError = e is RepartidorDataException
              ? e.message
              : 'No se pudo cargar la siguiente página';
        } else {
          _documentsError = e is RepartidorDataException
              ? e.message
              : 'No se pudo cargar el historial de documentos';
          _isLoading = false;
        }
      });
      return;
    }

    if (!mounted || requestGeneration != _documentsRequestGeneration) return;
    if (!loadMore) setState(() => _isLoading = false);
  }

  Future<void> _loadMoreDocuments() async {
    final clientId = _selectedClientId;
    if (clientId == null || !_hasMoreDocuments || _isLoadingMoreDocuments) {
      return;
    }
    await _loadClientDocuments(
      clientId,
      _selectedClientName ?? clientId,
      repartidorId: _selectedClientRepartidorId,
      loadMore: true,
    );
  }

  void _onClientSearchChanged(String value) {
    _clientSearchDebounce?.cancel();
    // Invalidate a request for the previous term before waiting to issue the
    // next one, so stale responses cannot replace the current result set.
    _clientRequestGeneration++;
    setState(() {
      _clientSearchInput = value;
      _clients = const [];
      _clientRowsConsumed = 0;
      _hasMoreClients = false;
      _clientsError = null;
      _clientsLoadMoreError = null;
      if (_selectedClientId == null) _isLoading = true;
    });
    final query = value.trim();
    _clientSearchDebounce = Timer(_clientSearchDebounceDuration, () {
      if (!mounted) return;
      _loadClients(query.isEmpty ? null : query);
    });
  }

  void _clearClientSearch() {
    _searchController.clear();
    _onClientSearchChanged('');
  }

  // ==========================================================================
  // FILTERING
  // ==========================================================================

  String _normalizeFlexibleSearch(String value) {
    var normalized = value.toUpperCase();
    const substitutions = <String, String>{
      'Á': 'A',
      'À': 'A',
      'Ä': 'A',
      'Â': 'A',
      'É': 'E',
      'È': 'E',
      'Ë': 'E',
      'Ê': 'E',
      'Í': 'I',
      'Ì': 'I',
      'Ï': 'I',
      'Î': 'I',
      'Ó': 'O',
      'Ò': 'O',
      'Ö': 'O',
      'Ô': 'O',
      'Ú': 'U',
      'Ù': 'U',
      'Ü': 'U',
      'Û': 'U',
      'Ñ': 'N',
    };
    substitutions.forEach((source, replacement) {
      normalized = normalized.replaceAll(source, replacement);
    });
    return normalized.replaceAll(RegExp('[^A-Z0-9]+'), ' ').trim();
  }

  bool _isOrderedSubsequence(String token, String value) {
    var valueIndex = 0;
    for (final codeUnit in token.codeUnits) {
      valueIndex = value.indexOf(String.fromCharCode(codeUnit), valueIndex);
      if (valueIndex < 0) return false;
      valueIndex++;
    }
    return true;
  }

  bool _matchesFlexibleDocumentSearch(_DocumentItem doc, String query) {
    final tokens = _normalizeFlexibleSearch(query)
        .split(' ')
        .where((token) => token.isNotEmpty)
        .take(6)
        .toList(growable: false);
    if (tokens.isEmpty) return true;
    final values = <String>[
      doc.number.toString(),
      (doc.albaranNumber ?? doc.number).toString(),
      (doc.facturaNumber ?? '').toString(),
      doc.serie,
      doc.ejercicio.toString(),
      doc.terminal.toString(),
      doc.preparationOrderNumber?.toString() ?? '',
      doc.preparationOrderYear?.toString() ?? '',
      if (doc.type == _DocType.factura) 'factura' else 'albaran',
      _statusLabel(doc.status),
      doc.deliveryObs ?? '',
      doc.date?.toIso8601String() ?? '',
      _selectedClientId ?? '',
      _selectedClientName ?? '',
    ].map(_normalizeFlexibleSearch).toList(growable: false);
    return tokens.every(
      (token) => values.any(
        (value) =>
            value.contains(token) ||
            (token.length >= 4 && _isOrderedSubsequence(token, value)),
      ),
    );
  }

  List<_DocumentItem> get _filteredDocuments {
    final searchQuery = _docSearchController.text.trim();
    return _documents.where((doc) {
      if (_filterDocType != null && doc.type != _filterDocType) return false;
      if (_filterStatus != null && doc.status != _filterStatus) return false;
      return _matchesFlexibleDocumentSearch(doc, searchQuery);
    }).toList();
  }

  void _clearFilters() {
    setState(() {
      _dateFrom = null;
      _dateTo = null;
      _filterDocType = null;
      _filterStatus = null;
      _docSearchController.clear();
    });
  }

  bool get _hasActiveFilters =>
      _dateFrom != null ||
      _dateTo != null ||
      _filterDocType != null ||
      _filterStatus != null ||
      _docSearchController.text.isNotEmpty;

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: Column(
        children: [
          _buildHeader(),
          const OfflineBanner(),
          Expanded(
            child: _selectedClientId != null
                ? _buildDocumentsView()
                : _buildClientList(),
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // HEADER
  // ==========================================================================

  Widget _buildHeader() {
    if (_selectedClientId != null) {
      return Container(
        padding: EdgeInsets.fromLTRB(
          8,
          12,
          Responsive.padding(context, small: 10, large: 16),
          8,
        ),
        decoration: BoxDecoration(
          color: AppTheme.raisedSurface,
          border: Border(
            bottom: BorderSide(
              color: AppTheme.borderColor.withValues(alpha: 0.8),
            ),
          ),
        ),
        child: Column(
          children: [
            Row(
              children: [
                IconButton(
                  onPressed: _goBackToClients,
                  icon: const Icon(
                    Icons.arrow_back,
                    color: AppTheme.textPrimary,
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _selectedClientName ?? 'Cliente',
                        style: TextStyle(
                          fontSize: Responsive.fontSize(
                            context,
                            small: 13,
                            large: 16,
                          ),
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textPrimary,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        'Cód: $_selectedClientId',
                        style: TextStyle(
                          fontSize: Responsive.fontSize(
                            context,
                            small: 9,
                            large: 11,
                          ),
                          color: AppTheme.textSecondary.withValues(alpha: 0.8),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_clients.isNotEmpty) _buildClientQuickSwitch(),
              ],
            ),
          ],
        ),
      );
    }

    return SmartSyncHeader(
      title: 'Histórico',
      subtitle: 'Documentos repartidos por cliente',
      lastSync: DateTime.now(),
      isLoading: _isLoading,
      onSync: () => _loadClients(
        _clientSearchInput.isNotEmpty ? _clientSearchInput : null,
      ),
    );
  }

  void _goBackToClients() {
    setState(() {
      _selectedClientId = null;
      _selectedClientName = null;
      _selectedClientRepartidorId = null;
      _documents = [];
      _clearFilters();
      _selectedYear = null;
    });
  }

  Widget _buildClientQuickSwitch() {
    return PopupMenuButton<String>(
      tooltip: 'Cambiar cliente',
      offset: const Offset(0, 48),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
      ),
      color: AppTheme.raisedSurface,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: AppTheme.accentIndigo.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(
            color: AppTheme.accentIndigo.withValues(alpha: 0.32),
          ),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.swap_horiz, color: AppTheme.accentIndigo, size: 16),
            SizedBox(width: 4),
            Text(
              'Cambiar',
              style: TextStyle(
                color: AppTheme.accentIndigo,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
      itemBuilder: (context) => _clients.take(20).map((client) {
        final isSelected = client.id == _selectedClientId &&
            client.repartidorId == _selectedClientRepartidorId;
        return PopupMenuItem<String>(
          value: client.selectionKey,
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: isSelected
                      ? AppTheme.accentIndigo.withValues(alpha: 0.14)
                      : AppTheme.softPanel,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                ),
                child: Center(
                  child: Text(
                    client.name.isNotEmpty ? client.name[0] : '?',
                    style: TextStyle(
                      color: isSelected
                          ? AppTheme.accentIndigo
                          : AppTheme.textSecondary,
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  client.name,
                  style: TextStyle(
                    color: isSelected
                        ? AppTheme.accentIndigo
                        : AppTheme.textPrimary,
                    fontSize: 12,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (isSelected)
                const Icon(
                  Icons.check_circle,
                  color: AppTheme.accentIndigo,
                  size: 16,
                ),
            ],
          ),
        );
      }).toList(),
      onSelected: (selectionKey) {
        final client =
            _clients.firstWhere((c) => c.selectionKey == selectionKey);
        _loadClientDocuments(
          client.id,
          client.name,
          repartidorId: client.repartidorId,
        );
      },
    );
  }

  // ==========================================================================
  // LEVEL 1: CLIENT LIST
  // ==========================================================================

  Widget _buildLoadError(String message, VoidCallback onRetry) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 48, color: AppTheme.error),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppTheme.textSecondary),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildClientList() {
    final clients = _clients;
    return Column(
      children: [
        // Search bar
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            controller: _searchController,
            onChanged: _onClientSearchChanged,
            decoration: InputDecoration(
              hintText:
                  'Nombre, alias, código, DNI, dirección, población o teléfono...',
              hintStyle: TextStyle(
                color: AppTheme.textSecondary.withValues(alpha: 0.5),
              ),
              prefixIcon: const Icon(
                Icons.search,
                color: AppTheme.textSecondary,
              ),
              suffixIcon: _clientSearchInput.isNotEmpty
                  ? IconButton(
                      icon: const Icon(
                        Icons.clear,
                        color: AppTheme.textSecondary,
                      ),
                      onPressed: _clearClientSearch,
                    )
                  : null,
              filled: true,
              fillColor: AppTheme.raisedSurface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: AppTheme.accentIndigo),
              ),
            ),
            style: const TextStyle(color: AppTheme.textPrimary),
          ),
        ),

        // Client count
        if (!_isLoading && _clients.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                const Icon(
                  Icons.people,
                  size: 14,
                  color: AppTheme.textSecondary,
                ),
                const SizedBox(width: 6),
                Text(
                  _clientSearchInput.isNotEmpty
                      ? '${clients.length} clientes encontrados'
                      : '${clients.length} clientes',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 8),

        // List
        Expanded(
          child: _isLoading
              ? const Center(
                  child: CircularProgressIndicator(
                    color: AppTheme.accentIndigo,
                  ),
                )
              : _clientsError != null
                  ? _buildLoadError(
                      _clientsError!,
                      () => _loadClients(
                        _clientSearchInput.isNotEmpty
                            ? _clientSearchInput
                            : null,
                      ),
                    )
                  : clients.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.search_off,
                                size: 48,
                                color: AppTheme.textSecondary
                                    .withValues(alpha: 0.5),
                              ),
                              const SizedBox(height: 16),
                              const Text(
                                'No se encontraron clientes',
                                style: TextStyle(color: AppTheme.textSecondary),
                              ),
                            ],
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: () => _loadClients(
                            _clientSearchInput.isNotEmpty
                                ? _clientSearchInput
                                : null,
                          ),
                          color: AppTheme.accentIndigo,
                          child: ListView.builder(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            itemCount: clients.length +
                                (_hasMoreClients ||
                                        _clientsLoadMoreError != null
                                    ? 1
                                    : 0),
                            itemBuilder: (context, index) {
                              if (index < clients.length) {
                                return _buildClientCard(clients[index]);
                              }
                              return _buildClientsPaginationFooter();
                            },
                          ),
                        ),
        ),
      ],
    );
  }

  Widget _buildClientsPaginationFooter() {
    if (_isLoadingMoreClients) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: Center(
          child: CircularProgressIndicator(color: AppTheme.accentIndigo),
        ),
      );
    }
    if (_clientsLoadMoreError != null) {
      return Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Text(
              _clientsLoadMoreError!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppTheme.textSecondary),
            ),
            TextButton.icon(
              key: const ValueKey('history-clients-load-more-retry'),
              onPressed: () => _loadClients(_clientsQuery, true),
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Center(
        child: OutlinedButton.icon(
          key: const ValueKey('history-clients-load-more'),
          onPressed: () => _loadClients(_clientsQuery, true),
          icon: const Icon(Icons.expand_more),
          label: const Text('Cargar más clientes'),
        ),
      ),
    );
  }

  Widget _buildClientCard(_ClientItem client) {
    return GestureDetector(
      onTap: () => _loadClientDocuments(
        client.id,
        client.name,
        repartidorId: client.repartidorId,
      ),
      child: RepartidorExecutivePanel(
        margin: const EdgeInsets.only(bottom: 10),
        padding: EdgeInsets.all(
          Responsive.padding(context, small: 10, large: 14),
        ),
        accentColor: AppTheme.accentIndigo,
        child: Row(
          children: [
            // Avatar
            Container(
              width: Responsive.value(context, phone: 36, desktop: 44),
              height: Responsive.value(context, phone: 36, desktop: 44),
              decoration: BoxDecoration(
                color: AppTheme.accentIndigo.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Center(
                child: Text(
                  client.name.isNotEmpty ? client.name[0] : '?',
                  style: TextStyle(
                    fontSize: Responsive.fontSize(
                      context,
                      small: 14,
                      large: 18,
                    ),
                    fontWeight: FontWeight.bold,
                    color: AppTheme.accentIndigo,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: AppTheme.info.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          client.id,
                          style: const TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.info,
                          ),
                        ),
                      ),
                      const Spacer(),
                      if (client.lastVisit != null)
                        Text(
                          client.lastVisit!,
                          style: TextStyle(
                            fontSize: 10,
                            color: AppTheme.textSecondary.withValues(
                              alpha: 0.7,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    client.name,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textPrimary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        '${client.totalDocuments} docs',
                        style: const TextStyle(
                          fontSize: 11,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        CurrencyFormatter.format(client.totalAmount),
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.success,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right,
              color: AppTheme.textSecondary.withValues(alpha: 0.5),
            ),
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // LEVEL 2: CLIENT DOCUMENTS
  // ==========================================================================

  Widget _buildDocumentsView() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: AppTheme.accentIndigo),
      );
    }
    if (_documentsError != null && _documents.isEmpty) {
      return _buildLoadError(
        _documentsError!,
        () => _loadClientDocuments(
          _selectedClientId!,
          _selectedClientName ?? _selectedClientId!,
        ),
      );
    }

    return Column(
      children: [
        if (_documentsError != null)
          Container(
            margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.warning.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(12),
            ),
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(
                Icons.warning_amber_rounded,
                color: AppTheme.warning,
              ),
              title: Text(_documentsError!),
              trailing: TextButton(
                onPressed: () => _loadClientDocuments(
                  _selectedClientId!,
                  _selectedClientName ?? _selectedClientId!,
                ),
                child: const Text('Reintentar'),
              ),
            ),
          ),
        if (_clientsError != null)
          Container(
            margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.warning.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                Icons.warning_amber_rounded,
                color: AppTheme.warning,
              ),
              title: Text('Datos parciales'),
              subtitle: Text(
                'Los documentos están disponibles, pero no se pudo cargar la lista de clientes.',
              ),
            ),
          ),
        // Advanced filter bar
        _buildAdvancedFilters(),
        // Stats summary
        _buildDocStats(),
        // Document list
        Expanded(child: _buildDocumentsList()),
      ],
    );
  }

  Widget _buildAdvancedFilters() {
    final currentYear = DateTime.now().year;
    final years = List.generate(5, (i) => currentYear - i);

    return RepartidorExecutivePanel(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      accentColor: AppTheme.accentIndigo,
      padding: const EdgeInsets.all(10),
      child: Column(
        children: [
          // Row 1: Year selector + Document number search
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              // Year dropdown
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  color: AppTheme.raisedSurface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: _selectedYear != null
                        ? AppTheme.info.withValues(alpha: 0.5)
                        : Colors.white.withValues(alpha: 0.1),
                  ),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<int?>(
                    value: _selectedYear,
                    hint: Text(
                      'Últimos 3 años',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppTheme.textSecondary.withValues(alpha: 0.7),
                      ),
                    ),
                    dropdownColor: AppTheme.raisedSurface,
                    icon: const Icon(
                      Icons.calendar_month,
                      size: 16,
                      color: AppTheme.info,
                    ),
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.textPrimary,
                    ),
                    isDense: true,
                    items: [
                      const DropdownMenuItem<int?>(
                        child: Text(
                          'Últimos 3 años',
                          style: TextStyle(fontSize: 12),
                        ),
                      ),
                      ...years.map(
                        (y) => DropdownMenuItem<int?>(
                          value: y,
                          child: Text(
                            '$y',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ),
                    ],
                    onChanged: (val) {
                      setState(() => _selectedYear = val);
                      if (_selectedClientId != null) {
                        _loadClientDocuments(
                          _selectedClientId!,
                          _selectedClientName ?? '',
                        );
                      }
                    },
                  ),
                ),
              ),
              // Number search
              SizedBox(
                height: 38,
                width: Responsive.isPhone(context) ? double.infinity : 200,
                child: TextField(
                  controller: _docSearchController,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: 'Nº, serie, pedido, estado u observaciones...',
                    hintStyle: TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary.withValues(alpha: 0.5),
                    ),
                    prefixIcon: const Icon(
                      Icons.tag,
                      size: 16,
                      color: AppTheme.textSecondary,
                    ),
                    suffixIcon: _docSearchController.text.isNotEmpty
                        ? GestureDetector(
                            onTap: () {
                              _docSearchController.clear();
                              setState(() {});
                            },
                            child: const Icon(
                              Icons.clear,
                              size: 16,
                              color: AppTheme.textSecondary,
                            ),
                          )
                        : null,
                    filled: true,
                    fillColor: AppTheme.raisedSurface,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(
                        color: AppTheme.accentIndigo,
                      ),
                    ),
                  ),
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 12,
                  ),
                  keyboardType: TextInputType.number,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // Row 2: Dropdown filters (redesigned from chips)
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              // Date range button
              SizedBox(
                width: Responsive.isPhone(context)
                    ? (MediaQuery.of(context).size.width - 32)
                    : 120,
                child: _buildFilterDropdown(
                  icon: Icons.date_range,
                  label: _dateFrom != null || _dateTo != null
                      ? _formatDateRange()
                      : 'Fechas',
                  isActive: _dateFrom != null || _dateTo != null,
                  color: AppTheme.info,
                  onTap: _showDateRangePicker,
                ),
              ),
              // Quick "today" filter for same-day deliveries
              SizedBox(
                height: 38,
                child: OutlinedButton.icon(
                  onPressed: _filterTodayDocuments,
                  style: OutlinedButton.styleFrom(
                    foregroundColor:
                        _isTodayFilterActive ? Colors.white : AppTheme.success,
                    backgroundColor: _isTodayFilterActive
                        ? AppTheme.success
                        : AppTheme.success.withValues(alpha: 0.12),
                    side: BorderSide(
                      color: AppTheme.success.withValues(alpha: 0.45),
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  icon: const Icon(Icons.today, size: 16),
                  label: const Text('Hoy', style: TextStyle(fontSize: 12)),
                ),
              ),
              // Doc type dropdown
              Container(
                height: 38,
                width: Responsive.isPhone(context)
                    ? (MediaQuery.of(context).size.width - 44) / 2
                    : 110,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(
                  color: _filterDocType != null
                      ? AppTheme.accentIndigo.withValues(alpha: 0.1)
                      : AppTheme.raisedSurface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: _filterDocType != null
                        ? AppTheme.accentIndigo.withValues(alpha: 0.5)
                        : Colors.white.withValues(alpha: 0.1),
                  ),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<_DocType?>(
                    value: _filterDocType,
                    hint: Row(
                      children: [
                        Icon(
                          Icons.description,
                          size: 14,
                          color: AppTheme.textSecondary.withValues(alpha: 0.6),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          'Tipo',
                          style: TextStyle(
                            fontSize: 11,
                            color: AppTheme.textSecondary.withValues(
                              alpha: 0.6,
                            ),
                          ),
                        ),
                      ],
                    ),
                    isDense: true,
                    isExpanded: true,
                    dropdownColor: AppTheme.raisedSurface,
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.textPrimary,
                    ),
                    items: const [
                      DropdownMenuItem<_DocType?>(
                        child: Row(
                          children: [
                            Icon(
                              Icons.all_inclusive,
                              size: 14,
                              color: AppTheme.textSecondary,
                            ),
                            Text('Todos', style: TextStyle(fontSize: 10)),
                          ],
                        ),
                      ),
                      DropdownMenuItem<_DocType?>(
                        value: _DocType.factura,
                        child: Row(
                          children: [
                            Icon(
                              Icons.receipt,
                              size: 14,
                              color: AppTheme.accentIndigo,
                            ),
                            SizedBox(width: 4),
                            Text('Fact.', style: TextStyle(fontSize: 11)),
                          ],
                        ),
                      ),
                      DropdownMenuItem<_DocType?>(
                        value: _DocType.albaran,
                        child: Row(
                          children: [
                            Icon(
                              Icons.description,
                              size: 14,
                              color: AppTheme.info,
                            ),
                            SizedBox(width: 4),
                            Text('Alb.', style: TextStyle(fontSize: 11)),
                          ],
                        ),
                      ),
                    ],
                    onChanged: (val) => setState(() => _filterDocType = val),
                  ),
                ),
              ),
              // Status dropdown
              Container(
                height: 38,
                width: Responsive.isPhone(context)
                    ? (MediaQuery.of(context).size.width - 44) / 2
                    : 110,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(
                  color: _filterStatus != null
                      ? _statusColor(_filterStatus).withValues(alpha: 0.1)
                      : AppTheme.raisedSurface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: _filterStatus != null
                        ? _statusColor(_filterStatus).withValues(alpha: 0.5)
                        : Colors.white.withValues(alpha: 0.1),
                  ),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<_DeliveryStatus?>(
                    value: _filterStatus,
                    hint: Row(
                      children: [
                        Icon(
                          Icons.local_shipping,
                          size: 14,
                          color: AppTheme.textSecondary.withValues(alpha: 0.6),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          'Est.',
                          style: TextStyle(
                            fontSize: 11,
                            color: AppTheme.textSecondary.withValues(
                              alpha: 0.6,
                            ),
                          ),
                        ),
                      ],
                    ),
                    isDense: true,
                    isExpanded: true,
                    dropdownColor: AppTheme.raisedSurface,
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.textPrimary,
                    ),
                    items: const [
                      DropdownMenuItem<_DeliveryStatus?>(
                        child: Row(
                          children: [
                            Icon(
                              Icons.all_inclusive,
                              size: 14,
                              color: AppTheme.textSecondary,
                            ),
                            Text('Todos', style: TextStyle(fontSize: 10)),
                          ],
                        ),
                      ),
                      DropdownMenuItem<_DeliveryStatus?>(
                        value: _DeliveryStatus.delivered,
                        child: Row(
                          children: [
                            Icon(
                              Icons.check_circle,
                              size: 14,
                              color: AppTheme.success,
                            ),
                            SizedBox(width: 4),
                            Text('Entreg.', style: TextStyle(fontSize: 11)),
                          ],
                        ),
                      ),
                      DropdownMenuItem<_DeliveryStatus?>(
                        value: _DeliveryStatus.enRuta,
                        child: Row(
                          children: [
                            Icon(
                              Icons.local_shipping,
                              size: 14,
                              color: AppTheme.info,
                            ),
                            SizedBox(width: 4),
                            Text('Ruta', style: TextStyle(fontSize: 11)),
                          ],
                        ),
                      ),
                      DropdownMenuItem<_DeliveryStatus?>(
                        value: _DeliveryStatus.partial,
                        child: Row(
                          children: [
                            Icon(
                              Icons.pie_chart,
                              size: 14,
                              color: AppTheme.warning,
                            ),
                            SizedBox(width: 4),
                            Text('Parcial', style: TextStyle(fontSize: 11)),
                          ],
                        ),
                      ),
                      DropdownMenuItem<_DeliveryStatus?>(
                        value: _DeliveryStatus.notDelivered,
                        child: Row(
                          children: [
                            Icon(Icons.cancel, size: 14, color: AppTheme.error),
                            SizedBox(width: 4),
                            Text('Pend.', style: TextStyle(fontSize: 11)),
                          ],
                        ),
                      ),
                    ],
                    onChanged: (val) => setState(() => _filterStatus = val),
                  ),
                ),
              ),
              // Clear button
              if (_hasActiveFilters)
                InkWell(
                  onTap: () {
                    _clearFilters();
                    if (_selectedClientId != null) {
                      _loadClientDocuments(
                        _selectedClientId!,
                        _selectedClientName ?? '',
                      );
                    }
                  },
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    height: 38,
                    width: 38,
                    decoration: BoxDecoration(
                      color: AppTheme.error.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: AppTheme.error.withValues(alpha: 0.3),
                      ),
                    ),
                    child: const Icon(
                      Icons.filter_alt_off,
                      size: 16,
                      color: AppTheme.error,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDocStats() {
    final filtered = _filteredDocuments;
    final totalAmount = filtered.fold<double>(0, (sum, d) => sum + d.amount);
    final delivered =
        filtered.where((d) => d.status == _DeliveryStatus.delivered).length;
    final withSignature =
        filtered.where((d) => d.hasSignature || d.hasLegacySignature).length;

    return RepartidorExecutivePanel(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      accentColor: AppTheme.success,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildStatItem('Docs', '${filtered.length}', AppTheme.info),
          _buildStatDivider(),
          _buildStatItem(
            'Total',
            CurrencyFormatter.formatCompact(totalAmount),
            AppTheme.success,
          ),
          _buildStatDivider(),
          _buildStatItem('Entregados', '$delivered', AppTheme.success),
          _buildStatDivider(),
          _buildStatItem('Firmados', '$withSignature', AppTheme.accentIndigo),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, String value, Color color) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            fontSize: Responsive.fontSize(context, small: 12, large: 14),
            fontWeight: FontWeight.bold,
            color: color,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            fontSize: Responsive.fontSize(context, small: 8, large: 9),
            color: AppTheme.textSecondary.withValues(alpha: 0.7),
          ),
        ),
      ],
    );
  }

  Widget _buildStatDivider() {
    return Container(
      width: 1,
      height: 24,
      color: Colors.white.withValues(alpha: 0.08),
    );
  }

  Widget _buildFilterDropdown({
    required IconData icon,
    required String label,
    required bool isActive,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        height: 38,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          color:
              isActive ? color.withValues(alpha: 0.1) : AppTheme.raisedSurface,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isActive
                ? color.withValues(alpha: 0.5)
                : Colors.white.withValues(alpha: 0.1),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 14,
              color: isActive ? color : AppTheme.textSecondary,
            ),
            const SizedBox(width: 4),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  color: isActive ? color : AppTheme.textSecondary,
                  fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Icon(
              Icons.arrow_drop_down,
              size: 16,
              color: isActive ? color : AppTheme.textSecondary,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildChip({
    required IconData icon,
    required String label,
    required bool isActive,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color:
              isActive ? color.withValues(alpha: 0.12) : AppTheme.raisedSurface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isActive
                ? color.withValues(alpha: 0.5)
                : Colors.white.withValues(alpha: 0.1),
            width: isActive ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 14,
              color: isActive ? color : AppTheme.textSecondary,
            ),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                color: isActive ? color : AppTheme.textSecondary,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDocumentsList() {
    final docs = _filteredDocuments;

    if (docs.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              _hasActiveFilters ? Icons.filter_alt_off : Icons.folder_open,
              size: 48,
              color: AppTheme.textSecondary.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              _hasActiveFilters
                  ? 'No hay documentos con estos filtros'
                  : 'Sin documentos',
              style: const TextStyle(color: AppTheme.textSecondary),
            ),
            if (_hasActiveFilters) ...[
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: () {
                  _clearFilters();
                  _loadClientDocuments(
                    _selectedClientId!,
                    _selectedClientName ?? '',
                  );
                },
                icon: const Icon(Icons.clear, size: 16),
                label: const Text('Limpiar filtros'),
                style: TextButton.styleFrom(
                  foregroundColor: AppTheme.accentIndigo,
                ),
              ),
            ],
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () =>
          _loadClientDocuments(_selectedClientId!, _selectedClientName ?? ''),
      color: AppTheme.accentIndigo,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        itemCount: docs.length + (_hasMoreDocuments ? 1 : 0),
        itemBuilder: (context, index) {
          if (index < docs.length) return _buildDocumentCard(docs[index]);
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: _isLoadingMoreDocuments
                ? const Center(child: CircularProgressIndicator())
                : Column(
                    children: [
                      if (_documentsLoadMoreError != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(
                            _documentsLoadMoreError!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: AppTheme.warning),
                          ),
                        ),
                      OutlinedButton.icon(
                        key: const ValueKey('history-documents-load-more'),
                        onPressed: _loadMoreDocuments,
                        icon: const Icon(Icons.expand_more),
                        label: const Text('Cargar más documentos'),
                      ),
                    ],
                  ),
          );
        },
      ),
    );
  }

  Widget _buildDocumentCard(_DocumentItem doc) {
    final Color statusColor;
    final IconData statusIcon;
    final String statusLabel;

    switch (doc.status) {
      case _DeliveryStatus.delivered:
        statusColor = AppTheme.success;
        statusIcon = Icons.check_circle;
        statusLabel = 'Entregado';
      case _DeliveryStatus.partial:
        statusColor = AppTheme.warning;
        statusIcon = Icons.pie_chart;
        statusLabel = 'Parcial';
      case _DeliveryStatus.notDelivered:
        statusColor = AppTheme.warning;
        statusIcon = Icons.cancel;
        statusLabel = 'No entregado';
      case _DeliveryStatus.pending:
        statusColor = AppTheme.warning;
        statusIcon = Icons.schedule;
        statusLabel = 'Pendiente';
      case _DeliveryStatus.enRuta:
        statusColor = AppTheme.info;
        statusIcon = Icons.local_shipping;
        statusLabel = 'En Ruta';
    }

    final isFactura = doc.type == _DocType.factura;
    final documentColor =
        isFactura ? const Color(0xFFF59E0B) : const Color(0xFF38BDF8);
    final documentIcon =
        isFactura ? Icons.receipt_long : Icons.description_outlined;
    final hasAnySignature = doc.hasSignature || doc.hasLegacySignature;

    return GestureDetector(
      onTap: () => _showDocumentActions(doc),
      child: RepartidorExecutivePanel(
        margin: const EdgeInsets.only(bottom: 8),
        padding: EdgeInsets.all(
          Responsive.padding(context, small: 10, large: 12),
        ),
        accentColor: documentColor,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Row 1: Type badge + number + status
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: documentColor.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(documentIcon, size: 11, color: documentColor),
                      const SizedBox(width: 3),
                      Text(
                        isFactura ? 'FAC' : 'ALB',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0,
                          color: documentColor,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    isFactura &&
                            doc.facturaNumber != null &&
                            doc.facturaNumber! > 0
                        ? 'F-${doc.facturaNumber}'
                        : '${doc.serie}-${doc.terminal}-${doc.albaranNumber ?? doc.number}',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.textPrimary,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (isFactura && doc.albaranNumber != null)
                  Text(
                    '  (Alb: ${doc.serie}-${doc.terminal}-${doc.albaranNumber})',
                    style: TextStyle(
                      fontSize: 9,
                      color: AppTheme.textSecondary.withValues(alpha: 0.6),
                    ),
                  ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(statusIcon, size: 12, color: statusColor),
                      const SizedBox(width: 3),
                      Text(
                        statusLabel,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: statusColor,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (doc.preparationOrderNumber != null) ...[
              const SizedBox(height: 5),
              Row(
                children: [
                  const Icon(
                    Icons.inventory_2_outlined,
                    size: 12,
                    color: AppTheme.textSecondary,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Orden de preparación ${doc.preparationOrderNumber}${doc.preparationOrderYear == null ? '' : ' · ${doc.preparationOrderYear}'}',
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 6),

            // Row 2: Date + time + signature badge + amount
            Row(
              children: [
                Icon(
                  Icons.calendar_today,
                  size: 12,
                  color: AppTheme.textSecondary.withValues(alpha: 0.6),
                ),
                const SizedBox(width: 4),
                Text(
                  doc.hasValidDate
                      ? DateFormat('dd/MM/yyyy').format(doc.date!)
                      : 'Sin fecha',
                  style: TextStyle(
                    fontSize: 11,
                    color: AppTheme.textSecondary.withValues(alpha: 0.8),
                  ),
                ),
                if (doc.time != null) ...[
                  const SizedBox(width: 6),
                  Icon(
                    Icons.access_time,
                    size: 11,
                    color: AppTheme.textSecondary.withValues(alpha: 0.5),
                  ),
                  const SizedBox(width: 2),
                  Text(
                    doc.time!,
                    style: TextStyle(
                      fontSize: 10,
                      color: AppTheme.textSecondary.withValues(alpha: 0.7),
                    ),
                  ),
                ],
                if ((doc.confirmationId ?? '').trim().isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 4,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: AppTheme.success.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.receipt_long,
                          size: 11,
                          color: AppTheme.success,
                        ),
                        SizedBox(width: 2),
                        Text(
                          'Nota',
                          style: TextStyle(
                            fontSize: 9,
                            color: AppTheme.success,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                if (doc.hasAppCobro) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 4,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: AppTheme.success.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(
                        color: AppTheme.success.withValues(alpha: 0.35),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.payments_outlined,
                          size: 11,
                          color: AppTheme.success,
                        ),
                        const SizedBox(width: 2),
                        Text(
                          doc.cobroBadgeLabel ?? 'COBRADO',
                          style: const TextStyle(
                            fontSize: 9,
                            color: AppTheme.success,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                if (hasAnySignature) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 4,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: AppTheme.accentIndigo.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          doc.hasLegacySignature && doc.signaturePath == null
                              ? Icons.history_edu
                              : Icons.draw,
                          size: 11,
                          color: AppTheme.accentIndigo,
                        ),
                        const SizedBox(width: 2),
                        Text(
                          doc.legacySignatureName != null &&
                                  doc.legacySignatureName!.trim().isNotEmpty
                              ? doc.legacySignatureName!.trim()
                              : 'Firma',
                          style: const TextStyle(
                            fontSize: 9,
                            color: AppTheme.accentIndigo,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const Spacer(),
                Text(
                  CurrencyFormatter.format(doc.amount),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.success,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // DOCUMENT ACTIONS BOTTOM SHEET
  // ==========================================================================

  void _showDocumentActions(_DocumentItem doc) {
    final isFactura = doc.type == _DocType.factura;
    final hasAnySignature = doc.hasSignature || doc.hasLegacySignature;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => RepartidorExecutiveSheet(
        accentColor: isFactura ? AppTheme.accentIndigo : AppTheme.info,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: isFactura
                          ? AppTheme.accentIndigo.withValues(alpha: 0.2)
                          : AppTheme.info.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      isFactura ? Icons.receipt_long : Icons.description,
                      color: isFactura ? AppTheme.accentIndigo : AppTheme.info,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isFactura && doc.facturaNumber != null
                              ? 'Factura F-${doc.facturaNumber} (Alb: ${doc.serie}-${doc.terminal}-${doc.albaranNumber ?? doc.number})'
                              : 'Albarán ${doc.serie}-${doc.terminal}-${doc.albaranNumber ?? doc.number}',
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                        Text(
                          doc.hasValidDate
                              ? '${DateFormat('dd/MM/yyyy').format(doc.date!)} · ${CurrencyFormatter.format(doc.amount)}'
                              : 'Sin fecha · ${CurrencyFormatter.format(doc.amount)}',
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                        if (doc.hasAppCobro) ...[
                          const SizedBox(height: 4),
                          Text(
                            [
                              if (doc.cobroParcial)
                                'Cobro parcial'
                              else
                                'Cobrado',
                              CurrencyFormatter.format(doc.importeCobrado!),
                              if ((doc.formaPagoCobro ?? '').trim().isNotEmpty)
                                doc.formaPagoCobro!.trim(),
                              if (doc.importePendienteCobro != null &&
                                  doc.importePendienteCobro! > 0.004)
                                'pend. ${CurrencyFormatter.format(doc.importePendienteCobro!)}',
                            ].join(' · '),
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppTheme.success,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ] else if (doc.status == _DeliveryStatus.delivered ||
                            doc.status == _DeliveryStatus.partial) ...[
                          const SizedBox(height: 4),
                          const Text(
                            'Sin cobro en ruta',
                            style: TextStyle(
                              fontSize: 12,
                              color: AppTheme.textSecondary,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Actions that require a trustworthy document date stay disabled
            // when the backend date cannot be parsed. This prevents silently
            // substituting a synthetic year in document keys.
            if (!doc.hasValidDate)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                child: Text(
                  'Acciones no disponibles: el documento no tiene una fecha válida',
                  key: ValueKey('invalid-document-date-actions-disabled'),
                  style: TextStyle(color: AppTheme.textSecondary),
                  textAlign: TextAlign.center,
                ),
              ),
            if (doc.hasValidDate) ...[
              _buildActionTile(
                icon: Icons.visibility,
                label: isFactura ? 'Ver factura / albarán' : 'Ver albarán',
                color: AppTheme.info,
                onTap: () {
                  Navigator.pop(ctx);
                  _previewDocument(doc);
                },
              ),
              _buildActionTile(
                icon: Icons.receipt_long,
                label: 'Ver nota de entrega',
                color: AppTheme.success,
                onTap: () {
                  Navigator.pop(ctx);
                  _previewDeliveryNote(doc);
                },
              ),
              _buildActionTile(
                icon: Icons.share_outlined,
                label: 'Compartir',
                subtitle: widget.canEmailDocuments
                    ? 'WhatsApp, Email, Guardar'
                    : 'WhatsApp, Guardar',
                color: AppTheme.accentIndigo,
                onTap: () {
                  Navigator.pop(ctx);
                  _showShareOptions(doc);
                },
              ),
              _buildActionTile(
                icon: Icons.print,
                label: 'Imprimir nota de entrega',
                color: AppTheme.success,
                onTap: () {
                  Navigator.pop(ctx);
                  _printDeliveryNote(doc);
                },
              ),
              if (widget.canEmailDocuments) ...[
                _buildActionTile(
                  icon: Icons.email_outlined,
                  label:
                      isFactura ? 'Email factura / albarán' : 'Email albarán',
                  color: AppTheme.info,
                  onTap: () {
                    Navigator.pop(ctx);
                    _emailCommercialDocument(doc);
                  },
                ),
                _buildActionTile(
                  icon: Icons.outgoing_mail,
                  label: 'Email nota de entrega',
                  color: AppTheme.accentIndigo,
                  onTap: () {
                    Navigator.pop(ctx);
                    _emailHistoryDeliveryNote(doc);
                  },
                ),
              ],
              if (hasAnySignature)
                _buildActionTile(
                  icon: Icons.draw,
                  label: 'Ver Firma',
                  subtitle: doc.legacySignatureName != null &&
                          doc.legacySignatureName!.trim().isNotEmpty
                      ? 'Firmado por: ${doc.legacySignatureName!.trim()}'
                      : null,
                  color: AppTheme.accentAmber,
                  onTap: () {
                    Navigator.pop(ctx);
                    _showSignatureDialog(doc);
                  },
                ),
            ],
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  void _showShareOptions(_DocumentItem doc) {
    final isFactura = doc.type == _DocType.factura;
    final commercialLabel =
        isFactura ? 'Factura / albarán ERP' : 'Albarán ERP (con firma)';
    final hasDeliveryNote = (doc.confirmationId?.trim() ?? '').isNotEmpty;
    final noteActionAvailable = _documentOwner(doc) != null;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => RepartidorExecutiveSheet(
        accentColor: AppTheme.accentIndigo,
        child: SafeArea(
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.only(bottom: 12, top: 8),
                  child: Text(
                    'Compartir documentos',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'NOTA DE ENTREGA',
                      style: TextStyle(
                        color: AppTheme.success.withValues(alpha: 0.95),
                        fontWeight: FontWeight.w800,
                        fontSize: 12,
                        letterSpacing: 0.6,
                      ),
                    ),
                  ),
                ),
                ListTile(
                  enabled: noteActionAvailable,
                  leading: CircleAvatar(
                    backgroundColor: noteActionAvailable
                        ? AppColors.whatsappGreen
                        : AppTheme.mutedPanel,
                    child:
                        const Icon(Icons.chat, color: Colors.white, size: 20),
                  ),
                  title: Text(
                    'WhatsApp · nota de entrega',
                    style: TextStyle(
                      color: noteActionAvailable
                          ? Colors.white
                          : AppTheme.textSecondary,
                    ),
                  ),
                  subtitle: Text(
                    hasDeliveryNote
                        ? 'PDF firmado de la entrega'
                        : 'Si no existe, se compartirá el documento comercial',
                  ),
                  onTap: noteActionAvailable
                      ? () {
                          Navigator.pop(context);
                          _shareDeliveryNoteWhatsApp(doc);
                        }
                      : null,
                ),
                if (widget.canEmailDocuments)
                  ListTile(
                    enabled: noteActionAvailable,
                    leading: CircleAvatar(
                      backgroundColor: noteActionAvailable
                          ? AppTheme.info
                          : AppTheme.mutedPanel,
                      child: const Icon(
                        Icons.email_outlined,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                    title: Text(
                      'Email · nota de entrega',
                      style: TextStyle(
                        color: noteActionAvailable
                            ? Colors.white
                            : AppTheme.textSecondary,
                      ),
                    ),
                    onTap: noteActionAvailable
                        ? () {
                            Navigator.pop(context);
                            _emailHistoryDeliveryNote(doc);
                          }
                        : null,
                  ),
                ListTile(
                  enabled: noteActionAvailable,
                  leading: CircleAvatar(
                    backgroundColor: noteActionAvailable
                        ? AppTheme.success
                        : AppTheme.mutedPanel,
                    child: const Icon(
                      Icons.download_rounded,
                      color: Colors.white,
                      size: 20,
                    ),
                  ),
                  title: Text(
                    'Guardar · nota de entrega',
                    style: TextStyle(
                      color: noteActionAvailable
                          ? Colors.white
                          : AppTheme.textSecondary,
                    ),
                  ),
                  onTap: noteActionAvailable
                      ? () {
                          Navigator.pop(context);
                          _downloadDeliveryNote(doc);
                        }
                      : null,
                ),
                const Divider(height: 24),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      commercialLabel.toUpperCase(),
                      style: TextStyle(
                        color: AppTheme.info.withValues(alpha: 0.95),
                        fontWeight: FontWeight.w800,
                        fontSize: 12,
                        letterSpacing: 0.6,
                      ),
                    ),
                  ),
                ),
                ListTile(
                  leading: const CircleAvatar(
                    backgroundColor: AppColors.whatsappGreen,
                    child: Icon(Icons.chat, color: Colors.white, size: 20),
                  ),
                  title: const Text(
                    'WhatsApp · documento comercial',
                    style: TextStyle(color: Colors.white),
                  ),
                  subtitle: const Text('Albarán o factura del ERP'),
                  onTap: () {
                    Navigator.pop(context);
                    _shareCommercialWhatsApp(doc);
                  },
                ),
                if (widget.canEmailDocuments)
                  ListTile(
                    leading: const CircleAvatar(
                      backgroundColor: AppTheme.info,
                      child: Icon(
                        Icons.email_outlined,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                    title: const Text(
                      'Email · documento comercial',
                      style: TextStyle(color: Colors.white),
                    ),
                    onTap: () {
                      Navigator.pop(context);
                      _emailCommercialDocument(doc);
                    },
                  ),
                ListTile(
                  leading: const CircleAvatar(
                    backgroundColor: AppTheme.success,
                    child: Icon(
                      Icons.download_rounded,
                      color: Colors.white,
                      size: 20,
                    ),
                  ),
                  title: const Text(
                    'Guardar · documento comercial',
                    style: TextStyle(color: Colors.white),
                  ),
                  onTap: () {
                    Navigator.pop(context);
                    _downloadCommercialDocument(doc);
                  },
                ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildActionTile({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
    String? subtitle,
  }) {
    return RepartidorExecutivePanel(
      accentColor: color,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      fontSize: 15,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 11,
                        color: AppTheme.textSecondary.withValues(alpha: 0.7),
                      ),
                    ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right,
              color: AppTheme.textSecondary.withValues(alpha: 0.5),
            ),
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // ACTIONS
  // ==========================================================================

  String? _documentOwner(_DocumentItem doc) => resolveRepartoDocumentOwner(
        documentOwner: doc.repartidorId,
        selectedOwner: widget.repartidorId,
      );

  bool _isDeliveryNoteMissing(Object error) =>
      error is RepartoReceiptUnavailableException ||
      RepartidorDataService.isDeliveryNoteNotFound(error);

  void _showDocumentOwnerRequired() {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Selecciona un repartidor concreto para este documento.',
        ),
        backgroundColor: AppTheme.warning,
      ),
    );
  }

  Future<void> _previewDeliveryNote(_DocumentItem doc) async {
    final confirmationId = doc.confirmationId?.trim() ?? '';
    if (confirmationId.isEmpty) {
      await _previewDocument(doc);
      return;
    }
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    final modal = AsyncOperationModal.show(
      context,
      text: 'Cargando nota de entrega...',
    );
    try {
      final bytes = await RepartidorDataService.downloadDeliveryNotePdf(
        confirmationId: confirmationId,
        repartidorId: owner,
      );
      modal.close();
      if (!mounted) return;
      await Future<void>.delayed(const Duration(milliseconds: 150));
      if (!mounted) return;
      final pdfBytes = Uint8List.fromList(bytes);
      final safeClientName =
          _selectedClientName?.replaceAll(RegExp(r'[^\w\s]+'), '') ?? 'Cliente';
      final docRef =
          '${doc.serie}-${doc.terminal}-${doc.albaranNumber ?? doc.number}';
      unawaited(
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PdfPreviewScreen(
              pdfBytes: pdfBytes,
              title: 'Nota de entrega $docRef',
              fileName: 'Nota_entrega_${docRef}_$safeClientName.pdf',
              onEmailTap: widget.canEmailDocuments
                  ? () {
                      Navigator.pop(context);
                      _emailHistoryDeliveryNote(doc);
                    }
                  : null,
            ),
          ),
        ),
      );
    } catch (e) {
      modal.close();
      if (_isDeliveryNoteMissing(e)) {
        await _previewDocument(doc);
        return;
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _sanitizedDocumentActionError(
                e,
                fallback: 'No se pudo cargar la nota de entrega.',
              ),
            ),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _previewDocument(_DocumentItem doc) async {
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    final modal = AsyncOperationModal.show(
      context,
      text: 'Cargando previsualización...',
    );
    try {
      final isFactura = doc.type == _DocType.factura;
      final downloader =
          widget.documentDownloader ?? RepartidorDataService.downloadDocument;
      final bytes = await downloader(
        year: isFactura
            ? (doc.ejercicioFactura ?? doc.ejercicio)
            : (doc.ejercicio > 0 ? doc.ejercicio : doc.date!.year),
        serie: isFactura ? (doc.serieFactura ?? '') : doc.serie,
        number: isFactura
            ? (doc.facturaNumber ?? doc.number)
            : (doc.albaranNumber ?? doc.number),
        terminal: doc.terminal,
        type: isFactura ? 'factura' : 'albaran',
        facturaNumber: doc.facturaNumber,
        serieFactura: doc.serieFactura,
        ejercicioFactura: doc.ejercicioFactura,
        albaranNumber: doc.albaranNumber ?? doc.number,
        albaranSerie: doc.serie,
        albaranTerminal: doc.terminal,
        albaranYear: doc.ejercicio,
        repartidorId: owner,
      );
      modal.close();

      if (!mounted) return;

      // Small delay to ensure modal dialog is fully dismissed before pushing
      await Future<void>.delayed(const Duration(milliseconds: 150));
      if (!mounted) return;

      final pdfBytes = Uint8List.fromList(bytes);
      final typeLabel = isFactura ? 'Factura' : 'Albaran';
      // Use client name in filename if available, otherwise just number
      final safeClientName =
          _selectedClientName?.replaceAll(RegExp(r'[^\w\s]+'), '') ?? 'Cliente';
      final docRef = '${doc.serie}-${doc.terminal}-${doc.number}';
      final fileName = '${typeLabel}_${docRef}_$safeClientName.pdf';

      unawaited(
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PdfPreviewScreen(
              pdfBytes: pdfBytes,
              title: '$typeLabel ${doc.serie}-${doc.terminal}-${doc.number}',
              fileName: fileName,
              onEmailTap: widget.canEmailDocuments
                  ? () {
                      Navigator.pop(context);
                      _emailDocument(doc);
                    }
                  : null,
              onWhatsAppTap: () {
                Navigator.pop(context);
                _shareCommercialWhatsApp(doc);
              },
            ),
          ),
        ),
      );
    } catch (e) {
      modal.error(
        _sanitizedDocumentActionError(
          e,
          fallback: 'No se pudo visualizar el documento.',
        ),
      );
    }
  }

  Future<void> _downloadCommercialDocument(_DocumentItem doc) async {
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    if (_isDownloadingDocument) return;
    _isDownloadingDocument = true;
    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando descarga...',
    );
    try {
      final isFactura = doc.type == _DocType.factura;
      final typeLabel = isFactura ? 'Factura' : 'Albaran';
      final bytes = await _downloadCommercialPdfBytes(
        doc: doc,
        owner: owner,
        downloader: widget.documentDownloader,
      );
      modal.close();

      final tempDir = await getTemporaryDirectory();
      final timestamp = DateTime.now().millisecondsSinceEpoch;
      final docRef = '${doc.serie}-${doc.terminal}-${doc.number}';
      final fileName = '${typeLabel}_${docRef}_$timestamp.pdf';

      final file = File('${tempDir.path}/$fileName');
      await file.writeAsBytes(bytes);

      if (!mounted) return;

      final renderBox = context.findRenderObject() as RenderBox?;
      final origin = renderBox != null
          ? Rect.fromCenter(
              center: Offset(
                renderBox.size.width / 2,
                renderBox.size.height / 2,
              ),
              width: 1,
              height: 1,
            )
          : null;

      // Use Share to "Save to..."
      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        text: 'Guardar $typeLabel ${doc.serie}-${doc.terminal}-${doc.number}',
        sharePositionOrigin: origin,
      );
    } catch (e) {
      modal.close();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_downloadErrorMessage(e)),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    } finally {
      _isDownloadingDocument = false;
    }
  }

  String _downloadErrorMessage(Object error) {
    return _sanitizedDocumentActionError(
      error,
      fallback: 'No se pudo descargar el documento.',
    );
  }

  Future<void> _emailDocument(_DocumentItem doc) async {
    await _emailCommercialDocument(doc);
  }

  Future<String?> _askEmailAddress() async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.raisedSurface,
        title: const Text(
          'Enviar por email',
          style: TextStyle(color: AppTheme.textPrimary),
        ),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.emailAddress,
          autofocus: true,
          style: const TextStyle(color: AppTheme.textPrimary),
          decoration: const InputDecoration(
            labelText: 'Destinatario',
            hintText: 'cliente@empresa.com',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Enviar'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  Future<void> _emailCommercialDocument(
    _DocumentItem doc, {
    String? prefilledEmail,
  }) async {
    if (!mounted) return;
    if (!widget.canEmailDocuments) return;
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    final email = prefilledEmail ?? await _askEmailAddress();
    if (email == null || email.isEmpty || !mounted) return;
    if (!email.contains('@')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Email inválido'),
          backgroundColor: AppTheme.error,
        ),
      );
      return;
    }
    final isFactura = doc.type == _DocType.factura;
    final modal = AsyncOperationModal.show(context, text: 'Enviando email...');
    try {
      await RepartidorDataService.sendEmail(
        year:
            isFactura ? (doc.ejercicioFactura ?? doc.ejercicio) : doc.ejercicio,
        type: isFactura ? 'factura' : 'albaran',
        serie: isFactura ? (doc.serieFactura ?? doc.serie) : doc.serie,
        number: isFactura
            ? (doc.facturaNumber ?? doc.number)
            : (doc.albaranNumber ?? doc.number),
        terminal: doc.terminal,
        destinatario: email,
        repartidorId: owner,
        canEmailDocuments: widget.canEmailDocuments,
        facturaNumber: doc.facturaNumber,
        serieFactura: doc.serieFactura,
        ejercicioFactura: doc.ejercicioFactura,
        albaranNumber: doc.albaranNumber ?? doc.number,
        albaranSerie: doc.serie,
        albaranTerminal: doc.terminal,
        albaranYear: doc.ejercicio,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Email enviado a $email'),
          backgroundColor: AppTheme.success,
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _sanitizedDocumentActionError(
              error,
              fallback: 'No se pudo enviar el documento.',
            ),
          ),
          backgroundColor: AppTheme.error,
        ),
      );
    } finally {
      modal.close();
    }
  }

  Future<void> _emailHistoryDeliveryNote(_DocumentItem doc) async {
    final confirmationId = doc.confirmationId?.trim() ?? '';
    if (confirmationId.isEmpty) {
      await _emailCommercialDocument(doc);
      return;
    }
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    final email = await _askEmailAddress();
    if (email == null || email.isEmpty || !mounted) return;
    if (!isValidRepartoReceiptEmailAddress(email)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Invalid email address.')),
      );
      return;
    }
    final modal = AsyncOperationModal.show(context, text: 'Enviando nota...');
    try {
      await RepartidorDataService.emailDeliveryNote(
        confirmationId: confirmationId,
        repartidorId: owner,
        destinatario: email,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Nota de entrega enviada a $email'),
          backgroundColor: AppTheme.success,
        ),
      );
    } catch (error) {
      if (_isDeliveryNoteMissing(error)) {
        modal.close();
        await _emailCommercialDocument(doc, prefilledEmail: email);
        return;
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _sanitizedDocumentActionError(
              error,
              fallback: 'No se pudo enviar la nota de entrega.',
            ),
          ),
          backgroundColor: AppTheme.error,
        ),
      );
    } finally {
      modal.close();
    }
  }

  Future<void> _printDeliveryNote(_DocumentItem doc) async {
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando nota de entrega...',
    );
    try {
      final confirmationId = doc.confirmationId?.trim() ?? '';
      if (confirmationId.isEmpty) {
        modal.close();
        await _printCommercialDocument(doc, owner);
        return;
      }
      if (confirmationId.isNotEmpty) {
        final bytes = await RepartidorDataService.downloadDeliveryNotePdf(
          confirmationId: confirmationId,
          repartidorId: owner,
        );
        modal.close();
        await Printing.layoutPdf(
          onLayout: (_) async => Uint8List.fromList(bytes),
        );
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Nota de entrega enviada a impresión.'),
              backgroundColor: AppTheme.success,
            ),
          );
        }
        return;
      }
      final loader =
          widget.signatureLoader ?? RepartidorDataService.getSignature;
      final data = await loader(
        ejercicio: doc.ejercicio,
        serie: doc.serie,
        terminal: doc.terminal,
        numero: doc.albaranNumber ?? doc.number,
        repartidorId: owner,
      );
      String? grf;
      final raw = data?['base64']?.toString();
      final layout = await ZebraPrintService.resolveLayout();
      final logo = await ZebraPrintService.loadCompanyLogoGrf(
        maxWidth: layout.logoMaxWidth,
        maxHeight: layout.logoMaxHeight,
      );
      if (raw != null && raw.isNotEmpty) {
        final bytes = base64Decode(raw);
        grf = await ZebraPrintService.convertSignatureToGrf(
          bytes,
          maxWidth: (layout.contentWidth * 0.72).round(),
          maxHeight: 100,
        );
      }
      final isFactura = doc.type == _DocType.factura;
      final title = isFactura && (doc.facturaNumber ?? 0) > 0
          ? 'FACTURA F-${doc.facturaNumber}'
          : 'ALBARAN ${doc.serie}-${doc.terminal}-${doc.albaranNumber ?? doc.number}';
      final zpl = ZebraPrintService.generateHistoryDeliveryZpl(
        title: title,
        clientName: _selectedClientName ?? '',
        dateLabel:
            doc.hasValidDate ? DateFormat('dd/MM/yyyy').format(doc.date!) : '',
        total: doc.amount,
        signatureGrf: grf,
        receptorNombre: data?['nombre']?.toString(),
        receptorApellidos: data?['apellidos']?.toString(),
        receptorDni: data?['dni']?.toString(),
        layout: layout,
        logoGrf: logo,
      );
      final result = await ZebraPrintService.printTicket(zpl: zpl);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.message),
          backgroundColor: result.ok ? AppTheme.success : AppTheme.error,
        ),
      );
    } catch (error) {
      if (_isDeliveryNoteMissing(error)) {
        modal.close();
        await _printCommercialDocument(doc, owner);
        return;
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _sanitizedDocumentActionError(
              error,
              fallback: 'No se pudo imprimir la nota de entrega.',
            ),
          ),
          backgroundColor: AppTheme.error,
        ),
      );
    } finally {
      modal.close();
    }
  }

  Future<void> _printCommercialDocument(_DocumentItem doc, String owner) async {
    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando documento comercial para imprimir...',
    );
    try {
      final bytes = await _downloadCommercialPdfBytes(
        doc: doc,
        owner: owner,
        downloader: widget.documentDownloader,
      );
      modal.close();
      await Printing.layoutPdf(
        onLayout: (_) async => Uint8List.fromList(bytes),
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Documento comercial enviado a impresión.'),
            backgroundColor: AppTheme.success,
          ),
        );
      }
    } catch (error) {
      modal.close();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _sanitizedDocumentActionError(
                error,
                fallback: 'No se pudo imprimir el documento comercial.',
              ),
            ),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _runShareAction(Future<void> Function() action) async {
    if (_isSharingDocument) return;
    _isSharingDocument = true;
    try {
      await action();
    } finally {
      _isSharingDocument = false;
    }
  }

  Future<void> _downloadDeliveryNote(_DocumentItem doc) async {
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    final confirmationId = doc.confirmationId?.trim() ?? '';
    if (confirmationId.isEmpty) {
      await _downloadCommercialDocument(doc);
      return;
    }
    if (_isDownloadingDocument) return;
    _isDownloadingDocument = true;
    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando nota de entrega...',
    );
    try {
      final bytes = await RepartidorDataService.downloadDeliveryNotePdf(
        confirmationId: confirmationId,
        repartidorId: owner,
      );
      modal.close();
      final tempDir = await getTemporaryDirectory();
      final docRef =
          '${doc.serie}-${doc.terminal}-${doc.albaranNumber ?? doc.number}';
      final fileName =
          'Nota_entrega_${docRef}_${DateTime.now().millisecondsSinceEpoch}.pdf';
      final file = File('${tempDir.path}/$fileName');
      await file.writeAsBytes(bytes);
      if (!mounted) return;
      final renderBox = context.findRenderObject() as RenderBox?;
      final origin = renderBox != null
          ? Rect.fromCenter(
              center: Offset(
                renderBox.size.width / 2,
                renderBox.size.height / 2,
              ),
              width: 1,
              height: 1,
            )
          : null;
      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        text: 'Nota de entrega $docRef',
        sharePositionOrigin: origin,
      );
    } catch (e) {
      modal.close();
      if (_isDeliveryNoteMissing(e)) {
        await _downloadCommercialDocument(doc);
        return;
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_downloadErrorMessage(e)),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    } finally {
      _isDownloadingDocument = false;
    }
  }

  Future<List<int>> _downloadCommercialPdfBytes({
    required _DocumentItem doc,
    required String owner,
    RepartidorHistoryDocumentDownloader? downloader,
  }) async {
    final isFactura = doc.type == _DocType.factura;
    final load = downloader ?? RepartidorDataService.downloadDocument;
    return load(
      year: isFactura
          ? (doc.ejercicioFactura ?? doc.ejercicio)
          : (doc.ejercicio > 0 ? doc.ejercicio : doc.date!.year),
      serie: isFactura ? (doc.serieFactura ?? '') : doc.serie,
      number: isFactura
          ? (doc.facturaNumber ?? doc.number)
          : (doc.albaranNumber ?? doc.number),
      terminal: doc.terminal,
      type: isFactura ? 'factura' : 'albaran',
      facturaNumber: doc.facturaNumber,
      serieFactura: doc.serieFactura,
      ejercicioFactura: doc.ejercicioFactura,
      albaranNumber: doc.albaranNumber ?? doc.number,
      albaranSerie: doc.serie,
      albaranTerminal: doc.terminal,
      albaranYear: doc.ejercicio,
      repartidorId: owner,
    );
  }

  Future<void> _shareCommercialWhatsApp(_DocumentItem doc) async {
    await _runShareAction(() => _shareCommercialWhatsAppUnlocked(doc));
  }

  Future<void> _shareDeliveryNoteWhatsApp(_DocumentItem doc) async {
    await _runShareAction(() => _shareDeliveryNoteWhatsAppUnlocked(doc));
  }

  Future<void> _shareCommercialWhatsAppUnlocked(
    _DocumentItem doc, {
    WhatsAppFormResult? prefilled,
  }) async {
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    final isFactura = doc.type == _DocType.factura;
    final typeLabel = isFactura ? 'Factura' : 'Albarán';
    final clientName = _selectedClientName ?? 'Cliente';

    final result = prefilled ??
        await WhatsAppFormModal.show(
          context,
          defaultMessage:
              'Hola $clientName, aquí tiene su documento $typeLabel ${doc.number}.\n\n'
              'Saludos - Granja Mari Pepa',
        );

    if (result == null || !mounted) return;

    final modal = AsyncOperationModal.show(
      context,
      text: 'Enviando documento por WhatsApp...',
    );
    try {
      // The backend validates owner and, when Cloud API is enabled, sends
      // message + PDF from the corporate WhatsApp number.
      final localShare = await RepartidorDataService.shareWhatsApp(
        year: isFactura
            ? (doc.ejercicioFactura ?? doc.ejercicio)
            : (doc.ejercicio > 0 ? doc.ejercicio : doc.date!.year),
        serie: isFactura ? (doc.serieFactura ?? '') : doc.serie,
        number: isFactura
            ? (doc.facturaNumber ?? doc.number)
            : (doc.albaranNumber ?? doc.number),
        terminal: doc.terminal,
        type: isFactura ? 'factura' : 'albaran',
        telefono: result.phone,
        repartidorId: owner,
        clienteNombre: clientName,
        mensaje: result.message,
        facturaNumber: doc.facturaNumber,
        serieFactura: doc.serieFactura,
        ejercicioFactura: doc.ejercicioFactura,
        albaranNumber: doc.albaranNumber ?? doc.number,
        albaranSerie: doc.serie,
        albaranTerminal: doc.terminal,
        albaranYear: doc.ejercicio,
      );

      if (localShare.deliveredByBot) {
        modal.close();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '$typeLabel enviado por el WhatsApp corporativo (mensaje + PDF).',
            ),
            backgroundColor: AppTheme.success,
          ),
        );
        return;
      }

      if (!localShare.localShare || localShare.sent) {
        throw const RepartidorDataException(
          'No se pudo preparar el envío por WhatsApp.',
        );
      }

      final bytes = await _downloadCommercialPdfBytes(
        doc: doc,
        owner: owner,
        downloader: widget.documentDownloader,
      );
      final tempDir = await getTemporaryDirectory();
      final fileName = '${typeLabel}_${doc.number}.pdf';
      final file = File('${tempDir.path}/$fileName');
      await file.writeAsBytes(bytes);

      modal.close();
      if (!mounted) return;

      // Fallback: PDF handed to the platform and WhatsApp chat opens.
      final renderBox = context.findRenderObject() as RenderBox?;
      final origin = renderBox != null
          ? Rect.fromCenter(
              center: Offset(
                renderBox.size.width / 2,
                renderBox.size.height / 2,
              ),
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
      final url = localShare.whatsappUrl;
      if (url != null && url.isNotEmpty) {
        final uri = Uri.tryParse(url);
        if (uri != null && await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      }
    } catch (e) {
      modal.close();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _sanitizedDocumentActionError(
                e,
                fallback: 'No se pudo compartir el documento.',
              ),
            ),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _shareDeliveryNoteWhatsAppUnlocked(_DocumentItem doc) async {
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    final confirmationId = doc.confirmationId?.trim() ?? '';
    if (confirmationId.isEmpty) {
      await _shareCommercialWhatsAppUnlocked(doc);
      return;
    }
    final clientName = _selectedClientName ?? 'Cliente';
    final docRef =
        '${doc.serie}-${doc.terminal}-${doc.albaranNumber ?? doc.number}';
    final result = await WhatsAppFormModal.show(
      context,
      defaultMessage:
          'Hola $clientName, adjunto la nota de entrega $docRef.\n\n'
          'Saludos - Granja Mari Pepa',
    );
    if (result == null || !mounted) return;

    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando nota de entrega...',
    );
    try {
      final whatsapp = await RepartidorDataService.shareDeliveryNoteViaWhatsApp(
        confirmationId: confirmationId,
        telefono: result.phone,
        repartidorId: owner,
        clienteNombre: clientName,
        mensaje: result.message,
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

      final bytes = await RepartidorDataService.downloadDeliveryNotePdf(
        confirmationId: confirmationId,
        repartidorId: owner,
      );
      final tempDir = await getTemporaryDirectory();
      final file = File('${tempDir.path}/Nota_entrega_$docRef.pdf');
      await file.writeAsBytes(bytes);
      modal.close();
      if (!mounted) return;

      final renderBox = context.findRenderObject() as RenderBox?;
      final origin = renderBox != null
          ? Rect.fromCenter(
              center: Offset(
                renderBox.size.width / 2,
                renderBox.size.height / 2,
              ),
              width: 1,
              height: 1,
            )
          : null;

      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        text: result.message,
        subject: 'Nota de entrega $docRef',
        sharePositionOrigin: origin,
      );
      final url = whatsapp.whatsappUrl;
      if (url != null && url.isNotEmpty) {
        final uri = Uri.tryParse(url);
        if (uri != null && await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      }
    } catch (e) {
      modal.close();
      if (_isDeliveryNoteMissing(e)) {
        await _shareCommercialWhatsAppUnlocked(doc, prefilled: result);
        return;
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _sanitizedDocumentActionError(
                e,
                fallback: 'No se pudo compartir la nota de entrega.',
              ),
            ),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _shareSystemDocument(_DocumentItem doc) async {
    await _runShareAction(() => _shareSystemDocumentUnlocked(doc));
  }

  Future<void> _shareSystemDocumentUnlocked(_DocumentItem doc) async {
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    final modal = AsyncOperationModal.show(
      context,
      text: 'Preparando documento...',
    );
    try {
      final isFactura = doc.type == _DocType.factura;
      final bytes = await _downloadCommercialPdfBytes(
        doc: doc,
        owner: owner,
        downloader: widget.documentDownloader,
      );
      modal.close();

      final tempDir = await getTemporaryDirectory();
      final typeLabel = isFactura ? 'Factura' : 'Albaran';
      final timestamp = DateTime.now().millisecondsSinceEpoch;
      final docRef = '${doc.serie}-${doc.terminal}-${doc.number}';
      final fileName = '${typeLabel}_${docRef}_$timestamp.pdf';
      final file = File('${tempDir.path}/$fileName');
      await file.writeAsBytes(bytes);

      if (!mounted) return;

      final renderBox = context.findRenderObject() as RenderBox?;
      final origin = renderBox != null
          ? Rect.fromCenter(
              center: Offset(
                renderBox.size.width / 2,
                renderBox.size.height / 2,
              ),
              width: 1,
              height: 1,
            )
          : null;

      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/pdf')],
        text: '$typeLabel ${doc.number} - GMP',
        sharePositionOrigin: origin,
      );
    } catch (e) {
      modal.error(
        _sanitizedDocumentActionError(
          e,
          fallback: 'No se pudo compartir el documento.',
        ),
      );
    }
  }

  void _showSignatureDialog(_DocumentItem doc) {
    final owner = _documentOwner(doc);
    if (owner == null) {
      _showDocumentOwnerRequired();
      return;
    }
    showDialog(
      context: context,
      builder: (ctx) => _SignatureDialog(
        ejercicio: doc.ejercicio > 0 ? doc.ejercicio : doc.date!.year,
        serie: doc.serie,
        terminal: doc.terminal,
        numero: doc.albaranNumber ?? doc.number,
        repartidorId: owner,
        docLabel:
            '${doc.type == _DocType.factura ? "Factura" : "Albarán"} #${doc.number}',
        legacySignatureName: doc.legacySignatureName,
        legacyDate: doc.legacyDate,
        signatureLoader: widget.signatureLoader,
      ),
    );
  }

  // ==========================================================================
  // FILTER HELPERS
  // ==========================================================================

  String _formatDateRange() {
    final df = DateFormat('dd/MM');
    if (_dateFrom != null && _dateTo != null) {
      return '${df.format(_dateFrom!)} - ${df.format(_dateTo!)}';
    }
    if (_dateFrom != null) return 'Desde ${df.format(_dateFrom!)}';
    if (_dateTo != null) return 'Hasta ${df.format(_dateTo!)}';
    return 'Fechas';
  }

  Future<void> _showDateRangePicker() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
      initialDateRange: _dateFrom != null && _dateTo != null
          ? DateTimeRange(start: _dateFrom!, end: _dateTo!)
          : null,
      builder: (context, child) => Theme(
        data: ThemeData.dark().copyWith(
          colorScheme: const ColorScheme.dark(
            onPrimary: Colors.white,
            surface: AppTheme.raisedSurface,
          ),
        ),
        child: child!,
      ),
    );

    if (picked != null) {
      setState(() {
        _dateFrom = picked.start;
        _dateTo = picked.end;
      });
      // Re-fetch with date range from backend
      if (_selectedClientId != null) {
        unawaited(
          _loadClientDocuments(_selectedClientId!, _selectedClientName ?? ''),
        );
      }
    }
  }

  bool get _isTodayFilterActive {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return _dateFrom != null &&
        _dateTo != null &&
        _dateFrom!.year == today.year &&
        _dateFrom!.month == today.month &&
        _dateFrom!.day == today.day &&
        _dateTo!.year == today.year &&
        _dateTo!.month == today.month &&
        _dateTo!.day == today.day;
  }

  void _filterTodayDocuments() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    setState(() {
      _dateFrom = today;
      _dateTo = today;
    });
    if (_selectedClientId != null) {
      _loadClientDocuments(_selectedClientId!, _selectedClientName ?? '');
    }
  }

  void _cycleDocType() {
    setState(() {
      if (_filterDocType == null) {
        _filterDocType = _DocType.albaran;
      } else if (_filterDocType == _DocType.albaran) {
        _filterDocType = _DocType.factura;
      } else {
        _filterDocType = null;
      }
    });
  }

  void _cycleStatus() {
    setState(() {
      if (_filterStatus == null) {
        _filterStatus = _DeliveryStatus.delivered;
      } else if (_filterStatus == _DeliveryStatus.delivered) {
        _filterStatus = _DeliveryStatus.partial;
      } else if (_filterStatus == _DeliveryStatus.partial) {
        _filterStatus = _DeliveryStatus.notDelivered;
      } else if (_filterStatus == _DeliveryStatus.notDelivered) {
        _filterStatus = _DeliveryStatus.pending;
      } else if (_filterStatus == _DeliveryStatus.pending) {
        _filterStatus = _DeliveryStatus.enRuta;
      } else {
        _filterStatus = null;
      }
    });
  }

  IconData _statusIcon(_DeliveryStatus? s) {
    switch (s) {
      case _DeliveryStatus.delivered:
        return Icons.check_circle;
      case _DeliveryStatus.partial:
        return Icons.pie_chart;
      case _DeliveryStatus.notDelivered:
        return Icons.cancel;
      case _DeliveryStatus.pending:
        return Icons.schedule;
      case _DeliveryStatus.enRuta:
        return Icons.local_shipping;
      default:
        return Icons.filter_alt;
    }
  }

  String _statusLabel(_DeliveryStatus? s) {
    switch (s) {
      case _DeliveryStatus.delivered:
        return 'Entregado';
      case _DeliveryStatus.partial:
        return 'Parcial';
      case _DeliveryStatus.notDelivered:
        return 'No entregado';
      case _DeliveryStatus.pending:
        return 'Pendiente';
      case _DeliveryStatus.enRuta:
        return 'En Ruta';
      default:
        return 'Estado';
    }
  }

  Color _statusColor(_DeliveryStatus? s) {
    switch (s) {
      case _DeliveryStatus.delivered:
        return AppTheme.success;
      case _DeliveryStatus.partial:
        return AppTheme.warning;
      case _DeliveryStatus.notDelivered:
        return AppTheme.warning;
      case _DeliveryStatus.pending:
        return AppTheme.warning;
      case _DeliveryStatus.enRuta:
        return AppTheme.info;
      default:
        return AppTheme.success;
    }
  }
}

// =============================================================================
// MODELS (private)
// =============================================================================

class _ClientItem {
  _ClientItem({
    required this.id,
    required this.name,
    required this.address,
    required this.totalDocuments,
    this.totalAmount = 0,
    this.lastVisit,
    this.repartidorId,
  });
  String get selectionKey => '${repartidorId ?? ''}:$id';
  final String id;
  final String name;
  final String address;
  final int totalDocuments;
  final double totalAmount;
  final String? lastVisit;
  final String? repartidorId;
}

enum _DocType { albaran, factura }

enum _DeliveryStatus { delivered, partial, notDelivered, pending, enRuta }

class _DocumentItem {
  _DocumentItem({
    required this.hasValidDate,
    required this.id,
    required this.type,
    required this.number,
    required this.date,
    required this.amount,
    required this.status,
    required this.hasSignature,
    this.serie = 'A',
    this.ejercicio = 0,
    this.terminal = 0,
    this.albaranNumber,
    this.facturaNumber,
    this.serieFactura,
    this.ejercicioFactura,
    this.preparationOrderNumber,
    this.preparationOrderYear,
    this.pending = 0,
    this.signaturePath,
    this.deliveryDate,
    this.deliveryObs,
    this.time,
    this.legacySignatureName,
    this.hasLegacySignature = false,
    this.legacyDate,
    this.confirmationId,
    this.cobroId,
    this.cobrado = false,
    this.importeCobrado,
    this.importePendienteCobro,
    this.formaPagoCobro,
    this.cobroParcial = false,
    this.repartidorId,
  });
  final String id;
  final bool hasValidDate;
  final _DocType type;
  final int number;
  final String serie;
  final int ejercicio;
  final int terminal;
  final int? albaranNumber;
  final int? facturaNumber;
  final String? serieFactura;
  final int? ejercicioFactura;
  final int? preparationOrderNumber;
  final int? preparationOrderYear;
  final DateTime? date;
  final double amount;
  final double pending;
  final _DeliveryStatus status;
  final bool hasSignature;
  final String? signaturePath;
  final String? deliveryDate;
  final String? deliveryObs;
  final String? time;
  // Legacy signature fields (from CACFIRMAS)
  final String? legacySignatureName;
  final bool hasLegacySignature;
  final String? legacyDate;
  final String? confirmationId;
  final String? cobroId;
  final bool cobrado;
  final double? importeCobrado;
  final double? importePendienteCobro;
  final String? formaPagoCobro;
  final bool cobroParcial;
  final String? repartidorId;

  bool get hasAppCobro =>
      cobrado && (importeCobrado != null && importeCobrado! > 0.004);

  String? get cobroBadgeLabel {
    if (!hasAppCobro) return null;
    final method = (formaPagoCobro ?? '').trim();
    final kind = cobroParcial ? 'PARCIAL' : 'COBRADO';
    if (method.isEmpty) return kind;
    return '$kind · $method';
  }
}

// =============================================================================
// SIGNATURE DIALOG
// =============================================================================

class _SignatureDialog extends StatefulWidget {
  const _SignatureDialog({
    required this.ejercicio,
    required this.serie,
    required this.terminal,
    required this.numero,
    required this.repartidorId,
    required this.docLabel,
    this.legacySignatureName,
    this.legacyDate,
    this.signatureLoader,
  });
  final int ejercicio;
  final String serie;
  final int terminal;
  final int numero;
  final String repartidorId;
  final String docLabel;
  final String? legacySignatureName;
  final String? legacyDate;
  final RepartidorHistorySignatureLoader? signatureLoader;

  @override
  State<_SignatureDialog> createState() => _SignatureDialogState();
}

class _SignatureDialogState extends State<_SignatureDialog> {
  Uint8List? _signatureBytes;
  String? _firmante;
  String? _nombre;
  String? _apellidos;
  String? _dni;
  String? _fecha;
  String? _source;
  bool _loading = true;
  String? _error;
  int _requestGeneration = 0;

  @override
  void initState() {
    super.initState();
    _fetchSignature();
  }

  @override
  void dispose() {
    _requestGeneration++;
    super.dispose();
  }

  Future<void> _fetchSignature() async {
    final requestGeneration = ++_requestGeneration;
    try {
      final loader =
          widget.signatureLoader ?? RepartidorDataService.getSignature;
      final data = await loader(
        ejercicio: widget.ejercicio,
        serie: widget.serie,
        terminal: widget.terminal,
        numero: widget.numero,
        repartidorId: widget.repartidorId,
      );
      if (!mounted || requestGeneration != _requestGeneration) return;

      if (data != null) {
        final source = data['source'] as String?;

        if (data['base64'] != null) {
          // We have actual image data
          final signatureBytes = base64Decode(data['base64'] as String);
          if (!mounted || requestGeneration != _requestGeneration) return;
          setState(() {
            _source = source;
            _signatureBytes = signatureBytes;
            _firmante = data['firmante'] as String?;
            _nombre = data['nombre'] as String?;
            _apellidos = data['apellidos'] as String?;
            _dni = data['dni'] as String?;
            _fecha = data['fecha'] as String?;
            _loading = false;
          });
        } else if (source == 'CACFIRMAS_NAME_ONLY' ||
            (data['firmante'] != null &&
                (data['firmante'] as String).isNotEmpty) ||
            (data['nombre'] != null && (data['nombre'] as String).isNotEmpty) ||
            (data['dni'] != null && (data['dni'] as String).isNotEmpty)) {
          // Name-only signature from CACFIRMAS (no image, but record exists)
          if (!mounted || requestGeneration != _requestGeneration) return;
          setState(() {
            _source = source;
            _firmante = data['firmante'] as String?;
            _nombre = data['nombre'] as String?;
            _apellidos = data['apellidos'] as String?;
            _dni = data['dni'] as String?;
            _fecha = data['fecha'] as String?;
            _loading = false;
            _error = null;
          });
        } else {
          _handleNoSignature(requestGeneration);
        }
      } else {
        _handleNoSignature(requestGeneration);
      }
    } catch (e) {
      if (!mounted || requestGeneration != _requestGeneration) return;
      setState(() {
        _loading = false;
        _error = _sanitizedDocumentActionError(
          e,
          fallback: 'No se pudo cargar la firma.',
        );
      });
    }
  }

  void _handleNoSignature(int requestGeneration) {
    if (!mounted || requestGeneration != _requestGeneration) return;
    String? info;
    if (widget.legacySignatureName != null &&
        widget.legacySignatureName!.trim().isNotEmpty) {
      info = 'Firma registrada por: ${widget.legacySignatureName!.trim()}';
      if (widget.legacyDate != null) {
        info += '\nFecha: ${widget.legacyDate}';
      }
      info += '\n\n(Imagen no disponible en registros históricos)';
    }
    if (!mounted || requestGeneration != _requestGeneration) return;
    setState(() {
      _loading = false;
      _error = info ?? 'No se encontró firma para este documento';
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.raisedSurface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        side: BorderSide(color: AppTheme.accentIndigo.withValues(alpha: 0.28)),
      ),
      title: Row(
        children: [
          const RepartidorExecutiveIcon(
            icon: Icons.draw,
            color: AppTheme.accentIndigo,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Firma - ${widget.docLabel}',
              style: const TextStyle(fontSize: 16, color: AppTheme.textPrimary),
            ),
          ),
        ],
      ),
      content: SizedBox(
        width: Responsive.clampWidth(context, 320),
        height: Responsive.clampHeight(context, 280),
        child: _loading
            ? const Center(
                child: CircularProgressIndicator(color: AppTheme.accentIndigo),
              )
            : _signatureBytes != null
                // Has image
                ? Column(
                    children: [
                      Expanded(
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color:
                                  AppTheme.accentIndigo.withValues(alpha: 0.3),
                            ),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: InteractiveViewer(
                              minScale: 0.5,
                              maxScale: 4,
                              child: Image.memory(
                                _signatureBytes!,
                                fit: BoxFit.contain,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      if ((_nombre != null && _nombre!.isNotEmpty) ||
                          (_apellidos != null && _apellidos!.isNotEmpty))
                        Text(
                          [
                            _nombre,
                            _apellidos,
                          ]
                              .where((part) => part != null && part.isNotEmpty)
                              .join(' '),
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppTheme.textPrimary,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      if (_dni != null && _dni!.isNotEmpty)
                        Text(
                          'DNI: $_dni',
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                      if (_firmante != null && _firmante!.isNotEmpty)
                        Text(
                          'Firmante: $_firmante',
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                      if (_fecha != null)
                        Text(
                          'Fecha: $_fecha',
                          style: TextStyle(
                            fontSize: 11,
                            color:
                                AppTheme.textSecondary.withValues(alpha: 0.8),
                          ),
                        ),
                    ],
                  )
                // Name-only signature (no image)
                : _firmante != null && _firmante!.isNotEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: AppTheme.accentIndigo
                                    .withValues(alpha: 0.1),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.check_circle,
                                size: 48,
                                color: AppTheme.accentIndigo,
                              ),
                            ),
                            const SizedBox(height: 16),
                            const Text(
                              'Documento firmado',
                              style: TextStyle(
                                color: AppTheme.accentIndigo,
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Firmante: $_firmante',
                              style: const TextStyle(
                                color: AppTheme.textPrimary,
                                fontSize: 14,
                              ),
                            ),
                            if (_dni != null && _dni!.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(
                                'DNI: $_dni',
                                style: const TextStyle(
                                  color: AppTheme.textPrimary,
                                  fontSize: 14,
                                ),
                              ),
                            ],
                            if (_fecha != null) ...[
                              const SizedBox(height: 4),
                              Text(
                                'Fecha: $_fecha',
                                style: TextStyle(
                                  color: AppTheme.textSecondary
                                      .withValues(alpha: 0.8),
                                  fontSize: 12,
                                ),
                              ),
                            ],
                            const SizedBox(height: 12),
                            Text(
                              '(Imagen no disponible - solo registro de firma)',
                              style: TextStyle(
                                color: AppTheme.textSecondary
                                    .withValues(alpha: 0.5),
                                fontSize: 10,
                              ),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      )
                    // Error / not found
                    : Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(
                              Icons.gesture,
                              size: 48,
                              color: AppTheme.textSecondary,
                            ),
                            const SizedBox(height: 12),
                            Text(
                              _error ?? 'No se encontró firma',
                              style: const TextStyle(
                                color: AppTheme.textSecondary,
                                fontSize: 13,
                              ),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cerrar'),
        ),
      ],
    );
  }
}
