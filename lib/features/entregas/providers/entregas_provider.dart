import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/models/estado_entrega.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_receipt_contract.dart';

export '../../../core/models/estado_entrega.dart';

const _deliveryLoadFailureMessage =
    'No se pudieron cargar las entregas. Intentalo de nuevo.';

/// A backend payload did not meet the minimum contract needed to identify a
/// delivery safely.  Keep this error deliberately free of server values: it is
/// shown through generic connection/error surfaces and must not leak data.
class EntregasPayloadException implements Exception {
  const EntregasPayloadException(this.field);

  final String field;

  @override
  String toString() => 'INVALID_DELIVERY_PAYLOAD:$field';
}

String _requiredText(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.trim().isNotEmpty) {
    return value.trim();
  }
  // DB2/ODBC may emit numeric ids (SECUENCIA) as numbers.
  if (value is num && value.isFinite) {
    return value.toString();
  }
  throw EntregasPayloadException(key);
}

/// Recovers client code from canonical delivery id:
/// `ejercicio-serie-terminal-numero-cliente`.
String? clientCodeFromDeliveryId(String? deliveryId) {
  final raw = deliveryId?.trim() ?? '';
  if (raw.isEmpty) return null;
  final parts = raw.split('-');
  if (parts.length < 5) return null;
  final cliente = parts.sublist(4).join('-').trim();
  return cliente.isEmpty ? null : cliente;
}

double _requiredDoubleAlias(Map<String, dynamic> json, List<String> keys) {
  for (final key in keys) {
    final value = json[key];
    if (value is num && value.isFinite) return value.toDouble();
    if (value is String) {
      final parsed = double.tryParse(value.trim());
      if (parsed != null && parsed.isFinite) return parsed;
    }
  }
  throw EntregasPayloadException(keys.first);
}

double _optionalDoubleAlias(
  Map<String, dynamic> json,
  List<String> keys, {
  double defaultValue = 0,
}) {
  for (final key in keys) {
    if (!json.containsKey(key) || json[key] == null) continue;
    return _requiredDoubleAlias(json, <String>[key]);
  }
  return defaultValue;
}

int _requiredIntAlias(Map<String, dynamic> json, List<String> keys) {
  final value = _requiredDoubleAlias(json, keys);
  if (value != value.roundToDouble()) {
    throw EntregasPayloadException(keys.first);
  }
  return value.toInt();
}

int _optionalIntAlias(
  Map<String, dynamic> json,
  List<String> keys, {
  int defaultValue = 0,
}) {
  for (final key in keys) {
    if (!json.containsKey(key) || json[key] == null) continue;
    return _requiredIntAlias(json, <String>[key]);
  }
  return defaultValue;
}

String _requiredDate(Map<String, dynamic> json) {
  final value = _requiredText(json, 'fecha');
  final iso = RegExp(r'^\d{4}-\d{2}-\d{2}(?:[T ].*)?$').firstMatch(value);
  final slash = RegExp(r'^\d{2}/\d{2}/\d{4}$').firstMatch(value);
  if (iso != null) {
    final date = value.substring(0, 10).split('-').map(int.parse).toList();
    final parsed = DateTime(date[0], date[1], date[2]);
    if (parsed.year == date[0] &&
        parsed.month == date[1] &&
        parsed.day == date[2] &&
        DateTime.tryParse(value) != null) {
      return value;
    }
  }
  if (slash != null) {
    final parts = value.split('/').map(int.parse).toList(growable: false);
    final parsed = DateTime(parts[2], parts[1], parts[0]);
    if (parsed.year == parts[2] &&
        parsed.month == parts[1] &&
        parsed.day == parts[0]) {
      return value;
    }
  }
  throw const EntregasPayloadException('fecha');
}

String _safeDeliveryError(Object error, {required bool detail}) {
  if (error is EntregasPayloadException) {
    return detail
        ? 'El detalle recibido no cumple el contrato de reparto.'
        : 'Los datos de entregas recibidos no son validos.';
  }
  return detail
      ? 'No se pudo obtener el detalle del albaran.'
      : _deliveryLoadFailureMessage;
}

// ── Models (kept from original) ──────────────────────────────────────────────

class EntregaItem {
  EntregaItem({
    required this.itemId,
    required this.codigoArticulo,
    required this.descripcion,
    required this.cantidadPedida,
    this.bultos = 0,
    this.unit,
    this.precioUnitario = 0,
    this.cantidadEntregada,
    this.confirmationState = 'NOT_CONFIRMED',
    this.estado = EstadoEntrega.pendiente,
    this.observacion,
  });

  factory EntregaItem.fromJson(Map<String, dynamic> json) {
    return EntregaItem(
      itemId: _requiredText(json, 'itemId'),
      codigoArticulo: _requiredText(json, 'codigoArticulo'),
      descripcion: json['descripcion']?.toString() ?? '',
      cantidadPedida: _requiredDoubleAlias(
        json,
        const <String>['cantidadPedida', 'cantidadUnidades', 'QTY'],
      ),
      bultos: _optionalDoubleAlias(
        json,
        const <String>['bultos', 'cantidadEnvases'],
      ),
      unit: json['unidad']?.toString() ??
          json['UNIT']?.toString() ??
          json['unit']?.toString(),
      precioUnitario: _optionalDoubleAlias(
        json,
        const <String>['precioUnitario', 'PRICE'],
      ),
      cantidadEntregada: json['cantidadEntregada'] == null
          ? null
          : _requiredDoubleAlias(json, const <String>['cantidadEntregada']),
      confirmationState:
          json['confirmationState']?.toString() ?? 'NOT_CONFIRMED',
      estado: EstadoEntrega.fromString(
        (json['estado'] ?? 'PENDIENTE') as String,
      ),
      observacion: json['observacion'] as String?,
    );
  }
  final String itemId;
  final String codigoArticulo;
  final String descripcion;
  final double cantidadPedida;
  final double bultos;
  final String? unit;
  final double precioUnitario;
  double? cantidadEntregada;
  final String confirmationState;
  EstadoEntrega estado;
  String? observacion;

  bool get entregadoCompleto =>
      cantidadEntregada != null && cantidadEntregada! >= cantidadPedida;
}

class IvaBreakdownItem {
  IvaBreakdownItem({required this.base, required this.pct, required this.iva});

  factory IvaBreakdownItem.fromJson(Map<String, dynamic> json) {
    return IvaBreakdownItem(
      base: ((json['base'] ?? 0) as num).toDouble(),
      pct: ((json['pct'] ?? 0) as num).toDouble(),
      iva: ((json['iva'] ?? 0) as num).toDouble(),
    );
  }
  final double base;
  final double pct;
  final double iva;
}

class AlbaranEntrega {
  AlbaranEntrega({
    required this.id,
    required this.numeroAlbaran,
    required this.ejercicio,
    required this.codigoCliente,
    required this.nombreCliente,
    this.nombreComercial,
    this.nombreFiscal,
    required this.fecha,
    required this.importeTotal,
    this.serie = '',
    this.terminal = 0,
    this.numeroFactura = 0,
    this.serieFactura = '',
    this.direccion = '',
    this.poblacion = '',
    this.telefono = '',
    this.telefono2 = '',
    this.emailCliente = '',
    this.importeBruto = 0,
    this.importeNeto = 0,
    this.importeIva = 0,
    this.ivaBreakdown = const [],
    this.checksum,
    this.formaPago = '',
    this.formaPagoDesc = '',
    this.tipoPago = '',
    this.diasPago = 0,
    this.esCTR = false,
    this.puedeCobrarse = false,
    this.colorEstado = 'green',
    this.ruta = '',
    this.codigoVendedor = '',
    this.nombreVendedor = '',
    this.codigoRepartidor = '',
    this.nombreRepartidor = '',
    this.ordenPreparacion,
    this.discrepancy = false,
    this.lineSum = 0,
    this.estado = EstadoEntrega.pendiente,
    this.items = const [],
    this.observaciones,
    this.fotos = const [],
    this.firma,
    this.horaEntrega,
    this.horaPrevista,
  });

  factory AlbaranEntrega.fromJson(Map<String, dynamic> json) {
    return AlbaranEntrega(
      id: _requiredText(json, 'id'),
      numeroAlbaran:
          _requiredIntAlias(json, const <String>['numeroAlbaran', 'numero']),
      ejercicio: _requiredIntAlias(json, const <String>['ejercicio']),
      serie: json['serie']?.toString() ?? '',
      terminal: _optionalIntAlias(json, const <String>['terminal']),
      numeroFactura: _optionalIntAlias(json, const <String>['numeroFactura']),
      serieFactura: json['serieFactura']?.toString() ?? '',
      codigoCliente: _requiredText(json, 'codigoCliente'),
      nombreCliente: _requiredText(json, 'nombreCliente'),
      nombreComercial: json['nombreComercial']?.toString(),
      nombreFiscal: json['nombreFiscal']?.toString(),
      direccion: json['direccion']?.toString() ?? '',
      poblacion: json['poblacion']?.toString() ?? '',
      telefono: json['telefono']?.toString() ?? '',
      telefono2: json['telefono2']?.toString() ?? '',
      emailCliente:
          json['emailCliente']?.toString() ?? json['email']?.toString() ?? '',
      fecha: _requiredDate(json),
      importeTotal:
          _requiredDoubleAlias(json, const <String>['importe', 'importeTotal']),
      importeBruto: _optionalDoubleAlias(json, const <String>['importeBruto']),
      importeNeto: _optionalDoubleAlias(json, const <String>['netoSum']),
      importeIva: _optionalDoubleAlias(json, const <String>['ivaSum']),
      ivaBreakdown: (json['ivaBreakdown'] as List<dynamic>?)
              ?.map(
                (e) => IvaBreakdownItem.fromJson(e as Map<String, dynamic>),
              )
              .toList() ??
          [],
      checksum: json['checksum']?.toString(),
      formaPago: json['formaPago']?.toString() ?? '',
      formaPagoDesc: json['formaPagoDesc']?.toString() ?? '',
      tipoPago: json['tipoPago']?.toString() ?? '',
      diasPago: _optionalIntAlias(json, const <String>['diasPago']),
      esCTR: json['esCTR'] == true,
      puedeCobrarse: json['puedeCobrarse'] == true,
      colorEstado: json['colorEstado']?.toString() ?? 'green',
      ruta: json['ruta']?.toString() ?? '',
      codigoVendedor: json['codigoVendedor']?.toString() ?? '',
      nombreVendedor: json['nombreVendedor']?.toString() ?? '',
      codigoRepartidor: json['codigoRepartidor']?.toString() ?? '',
      nombreRepartidor: json['nombreRepartidor']?.toString() ?? '',
      ordenPreparacion: json['ordenPreparacion'] == null
          ? null
          : _requiredIntAlias(json, const <String>['ordenPreparacion']),
      discrepancy: json['discrepancy'] == true,
      lineSum: _optionalDoubleAlias(json, const <String>['lineSum']),
      estado: EstadoEntrega.fromString(
        (json['estado'] ?? 'PENDIENTE') as String,
      ),
      items: (json['items'] as List<dynamic>?)
              ?.map((e) => EntregaItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      observaciones: json['observaciones'] as String?,
      fotos: (json['fotos'] as List<dynamic>?)?.cast<String>() ?? [],
      firma: json['firma'] as String?,
      horaPrevista: _parseHoraPrevista(json['HORALLEGADA']),
    );
  }
  final String id;
  final int numeroAlbaran;
  final int ejercicio;
  final String serie;
  final int terminal;
  final int numeroFactura;
  final String serieFactura;
  final String codigoCliente;
  final String nombreCliente;
  final String? nombreComercial;
  final String? nombreFiscal;
  final String direccion;
  final String poblacion;
  final String telefono;
  final String telefono2;
  final String emailCliente;
  final String fecha;
  final double importeTotal;
  final double importeBruto;
  final double importeNeto;
  final double importeIva;
  final List<IvaBreakdownItem> ivaBreakdown;
  final String? checksum;
  final String formaPago;
  final String formaPagoDesc;
  final String tipoPago;
  final int diasPago;
  final bool esCTR;
  final bool puedeCobrarse;
  final String colorEstado;
  final String ruta;
  final String codigoVendedor;
  final String nombreVendedor;
  final String codigoRepartidor;
  final String nombreRepartidor;
  final int? ordenPreparacion;
  final bool discrepancy;
  final double lineSum;
  EstadoEntrega estado;
  List<EntregaItem> items;
  String? observaciones;
  List<String> fotos;
  String? firma;
  DateTime? horaEntrega;
  final String? horaPrevista;

  static String? _parseHoraPrevista(dynamic val) {
    if (val == null) return null;
    final s = val.toString().padLeft(6, '0');
    if (s.length >= 4) {
      return '${s.substring(0, 2)}:${s.substring(2, 4)}';
    }
    return null;
  }

  int get totalItems => items.length;
  int get itemsEntregados =>
      items.where((i) => i.estado == EstadoEntrega.entregado).length;
  double get progreso => totalItems > 0 ? itemsEntregados / totalItems : 0;
  bool get requiereCobro => esCTR && estado != EstadoEntrega.entregado;
}

// ── Riverpod State ────────────────────────────────────────────────────────────

class EntregasState {
  EntregasState({
    this.albaranes = const [],
    this.albaranSeleccionado,
    this.isLoading = false,
    this.error,
    this.repartidorId = '',
    DateTime? fechaSeleccionada,
    this.searchQuery = '',
    this.searchClient = '',
    this.searchAlbaran = '',
    this.sortBy = 'default',
    this.filterTipoPago = '',
    this.filterDebeCobrar = '',
    this.filterDocTipo = '',
    this.resumenTotalBruto = 0,
    this.resumenTotalACobrar = 0,
    this.resumenTotalOpcional = 0,
    this.nextOffset = 0,
    this.resumenCompletedCount = 0,
    this.hasMore = false,
    this.total,
  }) : fechaSeleccionada = fechaSeleccionada ?? DateTime.now();
  final List<AlbaranEntrega> albaranes;
  final AlbaranEntrega? albaranSeleccionado;
  final bool isLoading;
  final String? error;
  final String repartidorId;
  final DateTime fechaSeleccionada;
  final String searchQuery;
  final String searchClient;
  final String searchAlbaran;
  final String sortBy;
  final String filterTipoPago;
  final String filterDebeCobrar;
  final String filterDocTipo;
  final double resumenTotalBruto;
  final double resumenTotalACobrar;
  final double resumenTotalOpcional;
  final int resumenCompletedCount;
  final int nextOffset;
  final bool hasMore;
  final int? total;

  EntregasState copyWith({
    List<AlbaranEntrega>? albaranes,
    Object? albaranSeleccionado = _sentinel,
    bool? isLoading,
    Object? error = _sentinel,
    String? repartidorId,
    DateTime? fechaSeleccionada,
    String? searchQuery,
    String? searchClient,
    String? searchAlbaran,
    String? sortBy,
    String? filterTipoPago,
    String? filterDebeCobrar,
    String? filterDocTipo,
    double? resumenTotalBruto,
    double? resumenTotalACobrar,
    double? resumenTotalOpcional,
    int? nextOffset,
    int? resumenCompletedCount,
    bool? hasMore,
    Object? total = _sentinel,
  }) {
    return EntregasState(
      albaranes: albaranes ?? this.albaranes,
      albaranSeleccionado: albaranSeleccionado == _sentinel
          ? this.albaranSeleccionado
          : albaranSeleccionado as AlbaranEntrega?,
      isLoading: isLoading ?? this.isLoading,
      error: error == _sentinel ? this.error : error as String?,
      repartidorId: repartidorId ?? this.repartidorId,
      fechaSeleccionada: fechaSeleccionada ?? this.fechaSeleccionada,
      searchQuery: searchQuery ?? this.searchQuery,
      searchClient: searchClient ?? this.searchClient,
      searchAlbaran: searchAlbaran ?? this.searchAlbaran,
      sortBy: sortBy ?? this.sortBy,
      filterTipoPago: filterTipoPago ?? this.filterTipoPago,
      filterDebeCobrar: filterDebeCobrar ?? this.filterDebeCobrar,
      filterDocTipo: filterDocTipo ?? this.filterDocTipo,
      resumenTotalBruto: resumenTotalBruto ?? this.resumenTotalBruto,
      resumenTotalACobrar: resumenTotalACobrar ?? this.resumenTotalACobrar,
      resumenTotalOpcional: resumenTotalOpcional ?? this.resumenTotalOpcional,
      nextOffset: nextOffset ?? this.nextOffset,
      resumenCompletedCount:
          resumenCompletedCount ?? this.resumenCompletedCount,
      hasMore: hasMore ?? this.hasMore,
      total: total == _sentinel ? this.total : total as int?,
    );
  }

  static const _sentinel = Object();

  List<AlbaranEntrega> get albaranesPendientes =>
      albaranes.where((a) => a.estado == EstadoEntrega.pendiente).toList();

  List<AlbaranEntrega> get albaranesEnRuta =>
      albaranes.where((a) => a.estado == EstadoEntrega.enRuta).toList();

  List<AlbaranEntrega> get albaranesEntregados => albaranes
      .where(
        (a) =>
            a.estado == EstadoEntrega.entregado ||
            a.estado == EstadoEntrega.parcial,
      )
      .toList();

  int get totalPendientes => albaranesPendientes.length;
  int get totalEntregados => albaranesEntregados.length;
  double get progresoTotal =>
      albaranes.isNotEmpty ? totalEntregados / albaranes.length : 0;

  double get importeTotalCTR => albaranes
      .where((a) => a.esCTR && a.estado != EstadoEntrega.entregado)
      .fold(0, (sum, a) => sum + a.importeTotal);
}

// ── Notifier ─────────────────────────────────────────────────────────────────

class EntregasNotifier extends Notifier<EntregasState> {
  Timer? _debounceTimer;
  bool _initialLoadDone = false;
  int _pendingLoadGeneration = 0;

  @override
  EntregasState build() {
    ref.onDispose(() {
      _debounceTimer?.cancel();
    });
    return EntregasState();
  }

  void _debouncedLoad({bool forceRefresh = false}) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 300), () {
      cargarAlbaranesPendientes(forceRefresh: forceRefresh);
    });
  }

  void _immediateLoad({bool forceRefresh = false}) {
    _debounceTimer?.cancel();
    _initialLoadDone = true;
    cargarAlbaranesPendientes(forceRefresh: forceRefresh);
  }

  void _cancelDebouncedLoad() {
    _debounceTimer?.cancel();
  }

  void setRepartidor(
    String repartidorId, {
    bool autoReload = true,
    bool forceReload = false,
  }) {
    final wasChanged = state.repartidorId != repartidorId;
    if (wasChanged) {
      // A response belonging to the previous driver must never repopulate the
      // new driver's screen.  Clear every delivery-derived value before the
      // next request is scheduled, including when callers opt out of reload.
      _pendingLoadGeneration++;
      state = state.copyWith(
        repartidorId: repartidorId,
        albaranes: const <AlbaranEntrega>[],
        albaranSeleccionado: null,
        isLoading: false,
        error: null,
        resumenTotalBruto: 0,
        resumenTotalACobrar: 0,
        resumenTotalOpcional: 0,
        resumenCompletedCount: 0,
        nextOffset: 0,
        hasMore: false,
        total: null,
      );
    }
    if (autoReload && (wasChanged || forceReload)) {
      if (!wasChanged) state = state.copyWith(repartidorId: repartidorId);
      if (_initialLoadDone) {
        _debouncedLoad(forceRefresh: forceReload);
      } else {
        _immediateLoad(forceRefresh: forceReload);
      }
    } else if (!wasChanged) {
      state = state.copyWith(repartidorId: repartidorId);
    }
  }

  void seleccionarFecha(
    DateTime fecha, {
    bool forceRefresh = false,
    bool autoReload = true,
  }) {
    state = state.copyWith(fechaSeleccionada: fecha);
    if (!autoReload) return;

    if (_initialLoadDone) {
      _debouncedLoad(forceRefresh: forceRefresh);
    } else {
      _immediateLoad(forceRefresh: forceRefresh);
    }
  }

  void setSearchQuery(String query) {
    state = state.copyWith(searchQuery: query);
    _debouncedLoad();
  }

  void setSearchClient(String query) {
    state = state.copyWith(searchClient: query);
    _debouncedLoad();
  }

  void setSearchAlbaran(String query) {
    state = state.copyWith(searchAlbaran: query);
    _debouncedLoad();
  }

  void setSortBy(String sort) {
    state = state.copyWith(sortBy: sort);
    _debouncedLoad();
  }

  void setFilterTipoPago(String tipo) {
    state = state.copyWith(filterTipoPago: tipo);
    _debouncedLoad();
  }

  void setFilterDebeCobrar(String debeCobrar) {
    state = state.copyWith(filterDebeCobrar: debeCobrar);
    _debouncedLoad();
  }

  void setFilterDocTipo(String docTipo) {
    state = state.copyWith(filterDocTipo: docTipo);
    _debouncedLoad();
  }

  Future<void> cargarAlbaranesPendientes({
    bool forceRefresh = false,
    bool append = false,
  }) async {
    if (append && (!state.hasMore || state.isLoading)) return;
    if (state.repartidorId.isEmpty) return;

    final generation = ++_pendingLoadGeneration;
    final requestState = state;
    final formattedDate =
        '${requestState.fechaSeleccionada.year}-${requestState.fechaSeleccionada.month.toString().padLeft(2, '0')}-${requestState.fechaSeleccionada.day.toString().padLeft(2, '0')}';
    final pageOffset = append ? requestState.nextOffset : 0;
    state = state.copyWith(isLoading: true, error: null);

    try {
      var url =
          '/entregas/pendientes/${requestState.repartidorId}?date=$formattedDate&limit=100&offset=$pageOffset';

      if (requestState.searchQuery.isNotEmpty) {
        url += '&search=${Uri.encodeComponent(requestState.searchQuery)}';
      }
      if (requestState.searchClient.isNotEmpty) {
        url +=
            '&searchClient=${Uri.encodeComponent(requestState.searchClient)}';
      }
      if (requestState.searchAlbaran.isNotEmpty) {
        url +=
            '&searchAlbaran=${Uri.encodeComponent(requestState.searchAlbaran)}';
      }
      if (requestState.sortBy != 'default') {
        url += '&sortBy=${requestState.sortBy}';
      }
      if (requestState.filterTipoPago.isNotEmpty) {
        url += '&tipoPago=${requestState.filterTipoPago}';
      }
      if (requestState.filterDebeCobrar.isNotEmpty) {
        url += '&debeCobrar=${requestState.filterDebeCobrar}';
      }
      if (requestState.filterDocTipo.isNotEmpty) {
        url += '&docTipo=${requestState.filterDocTipo}';
      }

      final response = await ApiClient.get(
        url,
        cacheKey: [
          'entregas:pendientes',
          requestState.repartidorId,
          formattedDate,
          requestState.searchQuery,
          requestState.searchClient,
          requestState.searchAlbaran,
          requestState.sortBy,
          requestState.filterTipoPago,
          requestState.filterDebeCobrar,
          pageOffset,
          requestState.filterDocTipo,
        ].join(':'),
        cacheTTL: const Duration(minutes: 2),
        forceRefresh: forceRefresh,
      );

      if (generation != _pendingLoadGeneration) return;

      if (response['success'] == true) {
        final lista = response['albaranes'] as List<dynamic>? ?? [];
        final page = lista
            .map((e) => AlbaranEntrega.fromJson(e as Map<String, dynamic>))
            .toList();
        final byId = <String, AlbaranEntrega>{
          if (append)
            for (final albaran in requestState.albaranes) albaran.id: albaran,
        };
        for (final albaran in page) {
          byId[albaran.id] = albaran;
        }
        final albaranes = byId.values.toList(growable: false);
        final pagination =
            response['pagination'] as Map<String, dynamic>? ?? response;
        final nextOffset = (pagination['nextOffset'] as num?)?.toInt() ??
            pageOffset + page.length;

        final resumen = response['resumen'] as Map<String, dynamic>? ?? {};
        state = state.copyWith(
          albaranes: albaranes,
          isLoading: false,
          hasMore: pagination['hasMore'] == true,
          nextOffset: nextOffset,
          total: pagination['total'] is num
              ? (pagination['total'] as num).toInt()
              : null,
          resumenTotalBruto: (append ? requestState.resumenTotalBruto : 0) +
              ((resumen['totalBruto'] ?? 0) as num).toDouble(),
          resumenTotalACobrar: (append ? requestState.resumenTotalACobrar : 0) +
              ((resumen['totalACobrar'] ?? 0) as num).toDouble(),
          resumenTotalOpcional:
              (append ? requestState.resumenTotalOpcional : 0) +
                  ((resumen['totalOpcional'] ?? 0) as num).toDouble(),
          resumenCompletedCount:
              (append ? requestState.resumenCompletedCount : 0) +
                  ((resumen['completedCount'] ?? 0) as num).toInt(),
        );
      } else {
        state = state.copyWith(
          isLoading: false,
          // A semantic failure body is untrusted backend input. Never surface
          // error/details/code because they may contain SQL, paths or PII.
          error: _deliveryLoadFailureMessage,
        );
      }
    } catch (error) {
      if (generation == _pendingLoadGeneration) {
        state = state.copyWith(
          isLoading: false,
          error: _safeDeliveryError(error, detail: false),
        );
      }
    }
  }

  Future<void> cargarMasAlbaranes() {
    return cargarAlbaranesPendientes(append: true);
  }

  Future<AlbaranEntrega?> obtenerDetalleAlbaran(
    int numero,
    int ejercicio,
    String serie,
    int terminal,
    String codigoCliente, {
    String? deliveryId,
  }) async {
    final resolvedCliente = codigoCliente.trim().isNotEmpty
        ? codigoCliente.trim()
        : (clientCodeFromDeliveryId(deliveryId) ?? '');
    if (resolvedCliente.isEmpty) {
      state = state.copyWith(
        error: 'Falta el codigo de cliente para cargar el detalle.',
      );
      return null;
    }

    try {
      // Prefer Dio queryParameters — embedding `?` in the path is fragile with
      // baseUrl resolution and has caused CLIENT_REQUIRED 400s in production.
      final response = await ApiClient.get(
        '/entregas/albaran/$numero/$ejercicio',
        queryParameters: <String, dynamic>{
          'serie': serie,
          'terminal': terminal,
          'cliente': resolvedCliente,
        },
        cacheKey:
            'entregas:albaran:$numero:$ejercicio:$serie:$terminal:$resolvedCliente',
        cacheTTL: const Duration(minutes: 2),
        forceRefresh: true,
        allowStale: false,
      );

      if (response['success'] == true && response['albaran'] != null) {
        final albaran = AlbaranEntrega.fromJson(
            response['albaran'] as Map<String, dynamic>);
        state = state.copyWith(albaranSeleccionado: albaran);
        return albaran;
      }
    } catch (error) {
      state = state.copyWith(error: _safeDeliveryError(error, detail: true));
    }
    return null;
  }

  Future<bool> marcarEntregado({
    required String albaranId,
    String? observaciones,
    String? firma,
    List<String>? fotos,
    double? latitud,
    double? longitud,
    String? clientCode,
    String? dni,
    String? nombre,
  }) async {
    state = state.copyWith(
      error: 'Confirma la entrega desde el flujo canonico del rutero.',
    );
    return false;
  }

  Future<Map<String, dynamic>?> generateReceipt({
    AlbaranEntrega? albaran,
    String? confirmationId,
  }) async {
    final canonicalReceiptId = confirmationId?.trim();
    if (canonicalReceiptId == null ||
        !isValidRepartoServerId(canonicalReceiptId)) {
      state = state.copyWith(
        error: 'El recibo requiere una confirmacion sincronizada.',
      );
      return null;
    }
    try {
      final response = await ApiClient.get(
        RepartoCanonicalReceiptRequest(canonicalReceiptId).endpoint,
        forceRefresh: true,
        allowStale: false,
      );
      final pdf = RepartoReceiptPdf.fromResponse(response);
      return <String, dynamic>{
        'success': true,
        'pdfBase64': pdf.base64,
        'confirmationId': canonicalReceiptId,
      };
    } on RepartoReceiptUnavailableException {
      state = state.copyWith(
        error: 'El recibo confirmado no contiene un PDF valido.',
      );
      return null;
    } on ApiException catch (error) {
      state = state.copyWith(
        error: 'No se pudo recuperar el recibo: ${error.message}',
      );
      return null;
    } catch (_) {
      state = state.copyWith(
        error: 'No se pudo recuperar el recibo confirmado.',
      );
      return null;
    }
  }

  /// Remote email is intentionally unavailable until it has a server-owned
  /// recipient contract. Never reconstruct or POST receipt data from here.
  Future<bool> sendReceiptByEmail({
    AlbaranEntrega? albaran,
    String? confirmationId,
    required String email,
  }) async {
    state = state.copyWith(
      error: 'El envio por email no esta habilitado para recibos de reparto.',
    );
    return false;
  }

  Future<bool> marcarParcial({
    required String albaranId,
    required String observaciones,
    String? firma,
    List<String>? fotos,
  }) async {
    return _actualizarEstado(
      itemId: albaranId,
      estado: EstadoEntrega.parcial,
      observaciones: observaciones,
      firma: firma,
      fotos: fotos,
    );
  }

  Future<bool> marcarNoEntregado({
    required String albaranId,
    required String observaciones,
    List<String>? fotos,
  }) async {
    return _actualizarEstado(
      itemId: albaranId,
      estado: EstadoEntrega.noEntregado,
      observaciones: observaciones,
      fotos: fotos,
    );
  }

  Future<bool> _actualizarEstado({
    required String itemId,
    required EstadoEntrega estado,
    String? observaciones,
    String? firma,
    List<String>? fotos,
    double? latitud,
    double? longitud,
    bool forceUpdate = false,
  }) async {
    state = state.copyWith(
      error: 'Confirma la entrega desde el flujo canonico del rutero.',
    );
    return false;
  }

  void limpiarSeleccion() {
    state = state.copyWith(albaranSeleccionado: null);
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

final entregasProvider =
    NotifierProvider<EntregasNotifier, EntregasState>(EntregasNotifier.new);

// ── Selectors ────────────────────────────────────────────────────────────────

final entregasPendientesProvider = Provider<List<AlbaranEntrega>>((ref) {
  return ref.watch(entregasProvider).albaranesPendientes;
});

final entregasLoadingProvider = Provider<bool>((ref) {
  return ref.watch(entregasProvider).isLoading;
});
