/// COBROS PROVIDER — 100% Riverpod (NotifierProvider.family.autoDispose)
///
/// State management for cobros/entregas module.
/// Uses family pattern to parameterize by employeeCode + isRepartidor.
/// No overrideWithValue, no UnimplementedError, no null checks.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';

/// Builds a backend-safe idempotency token for one commercial payment attempt.
String buildCobroIdempotencyToken({
  required String employeeCode,
  required String codigoCliente,
  required String referencia,
  DateTime? now,
}) {
  String clean(String value, {int max = 32}) {
    final sanitized = value.trim().replaceAll(RegExp('[^A-Za-z0-9_.:-]'), '-');
    if (sanitized.length <= max) return sanitized;
    return sanitized.substring(0, max);
  }

  final timestamp = (now ?? DateTime.now()).microsecondsSinceEpoch;
  return 'cobro:${clean(employeeCode, max: 12)}:'
      '${clean(codigoCliente, max: 24)}:'
      '${clean(referencia)}:$timestamp';
}

String estadoFromPendingSummaryEntry(Map<String, dynamic>? data) {
  if (data == null) return 'SIN_DATOS';
  final estado = (data['estado'] as String?)?.toUpperCase();
  if (estado != null && estado.isNotEmpty) return estado;
  final vencido = (data['vencido'] as num?)?.toDouble() ?? 0;
  final total = (data['total'] as num?)?.toDouble() ?? 0;
  if (vencido > 0) return 'VENCIDO';
  if (total > 0) return 'PENDIENTE';
  return 'AL_DIA';
}

String _queryString(Map<String, String> params) {
  if (params.isEmpty) return '';
  return params.entries
      .map(
        (e) =>
            '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}',
      )
      .join('&');
}

String _endpointWithQuery(String endpoint, Map<String, String> params) {
  final query = _queryString(params);
  return query.isEmpty ? endpoint : '$endpoint?$query';
}

String _stableQueryKey(Map<String, String> params) {
  final stable = Map<String, String>.from(params)..remove('_ts');
  if (stable.isEmpty) return 'default';
  final entries = stable.entries.toList()
    ..sort((a, b) => a.key.compareTo(b.key));
  return entries.map((e) => '${e.key}=${e.value}').join(':');
}

void _addNonBlankParam(
  Map<String, String> params,
  String key,
  String? value,
) {
  final trimmed = value?.trim() ?? '';
  if (trimmed.isNotEmpty) params[key] = trimmed;
}

void _addForceRefreshParam(Map<String, String> params, bool forceRefresh) {
  if (forceRefresh) {
    params['_ts'] = DateTime.now().millisecondsSinceEpoch.toString();
  }
}

// ============================================================
// Immutable State
// ============================================================

class CobrosState {
  const CobrosState({
    this.employeeCode = '',
    this.isRepartidor = false,
    this.isLoading = false,
    this.error,
    this.albaranesPendientes = const <Albaran>[],
    this.albaranActual,
    this.cobrosPendientes = const <CobroPendiente>[],
    this.historicoCobros = const <CobroHistorico>[],
    this.resumenCobros,
    this.estadoClienteActual,
    this.pendingSummary = const <String, Map<String, dynamic>>{},
    this.lastSummaryVendorCode,
    this.lastSummaryVendorCodes,
    this.lastSummaryTipoDocumento,
    this.lastSummaryFechaDesde,
    this.lastSummaryFechaHasta,
    this.grandTotal = 0,
    this.grandTotalVencido = 0,
    this.cvcGrandTotal = 0,
    this.cvcGrandTotalVencido = 0,
    this.appAdjustmentsTotal = 0,
    this.appOrdersTotal = 0,
    this.portfolioClientCount = 0,
    this.portfolioVencidoClientCount = 0,
    this.summarySource = '',
    this.filtroEstado = 'todos',
    this.filtroCliente = '',
    this.filtroFecha,
  });

  final String employeeCode;
  final bool isRepartidor;
  final bool isLoading;
  final String? error;
  final List<Albaran> albaranesPendientes;
  final Albaran? albaranActual;
  final List<CobroPendiente> cobrosPendientes;
  final List<CobroHistorico> historicoCobros;
  final ResumenCobros? resumenCobros;
  final EstadoCliente? estadoClienteActual;
  final Map<String, Map<String, dynamic>> pendingSummary;
  final String? lastSummaryVendorCode;
  final List<String>? lastSummaryVendorCodes;
  final String? lastSummaryTipoDocumento;
  final String? lastSummaryFechaDesde;
  final String? lastSummaryFechaHasta;
  final double grandTotal;
  final double grandTotalVencido;
  final double cvcGrandTotal;
  final double cvcGrandTotalVencido;
  final double appAdjustmentsTotal;
  final double appOrdersTotal;
  final int portfolioClientCount;
  final int portfolioVencidoClientCount;
  final String summarySource;
  final String filtroEstado;
  final String filtroCliente;
  final DateTime? filtroFecha;

  static const _sentinel = Object();

  CobrosState copyWith({
    String? employeeCode,
    bool? isRepartidor,
    bool? isLoading,
    Object? error = _sentinel,
    List<Albaran>? albaranesPendientes,
    Object? albaranActual = _sentinel,
    List<CobroPendiente>? cobrosPendientes,
    List<CobroHistorico>? historicoCobros,
    Object? resumenCobros = _sentinel,
    Object? estadoClienteActual = _sentinel,
    Map<String, Map<String, dynamic>>? pendingSummary,
    Object? lastSummaryVendorCode = _sentinel,
    Object? lastSummaryVendorCodes = _sentinel,
    Object? lastSummaryTipoDocumento = _sentinel,
    Object? lastSummaryFechaDesde = _sentinel,
    Object? lastSummaryFechaHasta = _sentinel,
    double? grandTotal,
    double? grandTotalVencido,
    double? cvcGrandTotal,
    double? cvcGrandTotalVencido,
    double? appAdjustmentsTotal,
    double? appOrdersTotal,
    int? portfolioClientCount,
    int? portfolioVencidoClientCount,
    String? summarySource,
    String? filtroEstado,
    String? filtroCliente,
    Object? filtroFecha = _sentinel,
  }) {
    return CobrosState(
      employeeCode: employeeCode ?? this.employeeCode,
      isRepartidor: isRepartidor ?? this.isRepartidor,
      isLoading: isLoading ?? this.isLoading,
      error: error == _sentinel ? this.error : error as String?,
      albaranesPendientes: albaranesPendientes ?? this.albaranesPendientes,
      albaranActual: albaranActual == _sentinel
          ? this.albaranActual
          : albaranActual as Albaran?,
      cobrosPendientes: cobrosPendientes ?? this.cobrosPendientes,
      historicoCobros: historicoCobros ?? this.historicoCobros,
      resumenCobros: resumenCobros == _sentinel
          ? this.resumenCobros
          : resumenCobros as ResumenCobros?,
      estadoClienteActual: estadoClienteActual == _sentinel
          ? this.estadoClienteActual
          : estadoClienteActual as EstadoCliente?,
      pendingSummary: pendingSummary ?? this.pendingSummary,
      lastSummaryVendorCode: lastSummaryVendorCode == _sentinel
          ? this.lastSummaryVendorCode
          : lastSummaryVendorCode as String?,
      lastSummaryVendorCodes: lastSummaryVendorCodes == _sentinel
          ? this.lastSummaryVendorCodes
          : lastSummaryVendorCodes as List<String>?,
      lastSummaryTipoDocumento: lastSummaryTipoDocumento == _sentinel
          ? this.lastSummaryTipoDocumento
          : lastSummaryTipoDocumento as String?,
      lastSummaryFechaDesde: lastSummaryFechaDesde == _sentinel
          ? this.lastSummaryFechaDesde
          : lastSummaryFechaDesde as String?,
      lastSummaryFechaHasta: lastSummaryFechaHasta == _sentinel
          ? this.lastSummaryFechaHasta
          : lastSummaryFechaHasta as String?,
      grandTotal: grandTotal ?? this.grandTotal,
      grandTotalVencido: grandTotalVencido ?? this.grandTotalVencido,
      cvcGrandTotal: cvcGrandTotal ?? this.cvcGrandTotal,
      cvcGrandTotalVencido: cvcGrandTotalVencido ?? this.cvcGrandTotalVencido,
      appAdjustmentsTotal: appAdjustmentsTotal ?? this.appAdjustmentsTotal,
      appOrdersTotal: appOrdersTotal ?? this.appOrdersTotal,
      portfolioClientCount: portfolioClientCount ?? this.portfolioClientCount,
      portfolioVencidoClientCount:
          portfolioVencidoClientCount ?? this.portfolioVencidoClientCount,
      summarySource: summarySource ?? this.summarySource,
      filtroEstado: filtroEstado ?? this.filtroEstado,
      filtroCliente: filtroCliente ?? this.filtroCliente,
      filtroFecha: filtroFecha == _sentinel
          ? this.filtroFecha
          : filtroFecha as DateTime?,
    );
  }

  /// Numero de clientes con cualquier importe pendiente (>0).
  int get clientsWithDebt => pendingSummary.values
      .where((v) => ((v['total'] as num?)?.toDouble() ?? 0) > 0)
      .length;

  /// Numero de clientes con importe vencido (>0).
  int get clientsWithVencido => pendingSummary.values
      .where((v) => ((v['vencido'] as num?)?.toDouble() ?? 0) > 0)
      .length;

  int get totalEntregasPendientes => albaranesPendientes
      .where((a) => a.estado == EstadoEntrega.pendiente)
      .length;
  int get totalEntregasCompletadas => albaranesPendientes
      .where((a) => a.estado == EstadoEntrega.entregado)
      .length;
  double get totalImportePendiente => albaranesPendientes
      .where((a) => a.estado != EstadoEntrega.entregado)
      .fold(0, (sum, a) => sum + a.importeTotal);
  int get totalCTRPendientes => albaranesPendientes
      .where((a) => a.esCTR && a.estado != EstadoEntrega.entregado)
      .length;

  List<Albaran> get albaranesFiltrados {
    var resultado = albaranesPendientes;
    if (filtroEstado != 'todos') {
      final estado = EstadoEntrega.fromString(filtroEstado);
      resultado = resultado.where((a) => a.estado == estado).toList();
    }
    if (filtroCliente.isNotEmpty) {
      resultado = resultado
          .where(
            (a) =>
                a.nombreCliente
                    .toLowerCase()
                    .contains(filtroCliente.toLowerCase()) ||
                a.codigoCliente.contains(filtroCliente),
          )
          .toList();
    }
    return resultado;
  }

  double pendingForClient(String code) {
    final entry = pendingSummary[code.trim()];
    return (entry?['total'] as num?)?.toDouble() ?? 0;
  }

  bool hasPendingSummaryForClient(String code) {
    return pendingSummary.containsKey(code.trim());
  }

  /// Req #15: importe vencido por cliente (subset de pending).
  double vencidoForClient(String code) {
    final entry = pendingSummary[code.trim()];
    return (entry?['vencido'] as num?)?.toDouble() ?? 0;
  }

  /// Req #15: estado consolidado por cliente — VENCIDO | PENDIENTE | AL_DIA.
  String estadoForClient(String code) {
    final entry = pendingSummary[code.trim()];
    return estadoFromPendingSummaryEntry(entry);
  }

  /// Solo documentos cobrables por el comercial (excluye responsabilidad repartidor).
  List<CobroPendiente> cobrosPendientesComercial() {
    return cobrosPendientes.where((c) {
      if (c.cobradoPorRepartidor || c.documentoNoDisponible) return false;
      return c.estado != EstadoCobro.alDia && c.importePendiente > 0.0001;
    }).toList(growable: false);
  }
}

// ============================================================
// Notifier (family by CobrosParams)
// ============================================================

class CobrosNotifier extends FamilyNotifier<CobrosState, CobrosParams> {
  final Map<String, String> _pendingCobroIdempotencyTokens = {};

  /// Exposed for tests/diagnostics: number of in-flight idempotency tokens.
  int get pendingIdempotencyTokenCount =>
      _pendingCobroIdempotencyTokens.length;

  @override
  CobrosState build(CobrosParams arg) {
    ref.onDispose(_pendingCobroIdempotencyTokens.clear);
    return CobrosState(
      employeeCode: arg.employeeCode,
      isRepartidor: arg.isRepartidor,
    );
  }

  // ── Read-through getters (compat for callers migrating to State) ──
  String get employeeCode => state.employeeCode;
  bool get isRepartidor => state.isRepartidor;
  bool get isLoading => state.isLoading;
  String? get error => state.error;
  List<Albaran> get albaranesPendientes => state.albaranesPendientes;
  Albaran? get albaranActual => state.albaranActual;
  List<CobroPendiente> get cobrosPendientes => state.cobrosPendientes;
  List<CobroHistorico> get historicoCobros => state.historicoCobros;
  ResumenCobros? get resumenCobros => state.resumenCobros;
  EstadoCliente? get estadoClienteActual => state.estadoClienteActual;
  String get filtroEstado => state.filtroEstado;
  String get filtroCliente => state.filtroCliente;
  Map<String, Map<String, dynamic>> get pendingSummary => state.pendingSummary;
  double get grandTotal => state.grandTotal;
  double get grandTotalVencido => state.grandTotalVencido;
  double get cvcGrandTotal => state.cvcGrandTotal;
  double get cvcGrandTotalVencido => state.cvcGrandTotalVencido;
  double get appAdjustmentsTotal => state.appAdjustmentsTotal;
  double get appOrdersTotal => state.appOrdersTotal;
  int get portfolioClientCount => state.portfolioClientCount;
  int get portfolioVencidoClientCount => state.portfolioVencidoClientCount;
  String get summarySource => state.summarySource;
  int get clientsWithDebt => state.clientsWithDebt;
  int get clientsWithVencido => state.clientsWithVencido;
  int get totalEntregasPendientes => state.totalEntregasPendientes;
  int get totalEntregasCompletadas => state.totalEntregasCompletadas;
  double get totalImportePendiente => state.totalImportePendiente;
  int get totalCTRPendientes => state.totalCTRPendientes;
  List<Albaran> get albaranesFiltrados => state.albaranesFiltrados;

  double pendingForClient(String code) => state.pendingForClient(code);
  bool hasPendingSummaryForClient(String code) =>
      state.hasPendingSummaryForClient(code);
  double vencidoForClient(String code) => state.vencidoForClient(code);
  String estadoForClient(String code) => state.estadoForClient(code);
  List<CobroPendiente> cobrosPendientesComercial() =>
      state.cobrosPendientesComercial();

  void setFiltroEstado(String estado) {
    state = state.copyWith(filtroEstado: estado);
  }

  void setFiltroCliente(String cliente) {
    state = state.copyWith(filtroCliente: cliente);
  }

  void limpiarFiltros() {
    state = state.copyWith(
      filtroEstado: 'todos',
      filtroCliente: '',
      filtroFecha: null,
    );
  }

  Future<void> cargarAlbaranesPendientes() async {
    // REQ-32: el perfil comercial sin modo reparto no llama a entregas
    // (el backend exige rol reparto, 403). Usa cobrosPendientesComercial.
    if (!state.isRepartidor) {
      if (!ref.mounted) return;
      state = state.copyWith(
        error: 'Disponible solo en modo reparto. Usa tus cobros pendientes.',
      );
      return;
    }
    state = state.copyWith(isLoading: true, error: null);
    try {
      final response = await ApiClient.get(
        '/entregas/pendientes/${state.employeeCode}',
        cacheKey: 'entregas:pendientes:${state.employeeCode}:default',
        cacheTTL: const Duration(minutes: 2),
      );
      if (!ref.mounted) return;
      if (response['success'] == true) {
        final items = (response['albaranes'] as List<dynamic>?)
                ?.map((e) => Albaran.fromJson(e as Map<String, dynamic>))
                .toList() ??
            [];
        state = state.copyWith(albaranesPendientes: items);
      } else {
        state = state.copyWith(
          error: (response['error'] as String?) ?? 'Error cargando albaranes',
        );
      }
    } catch (e) {
      if (!ref.mounted) return;
      state = state.copyWith(error: 'Error de conexión: $e');
    } finally {
      if (!ref.mounted) return;
      state = state.copyWith(isLoading: false);
    }
  }

  Future<void> cargarDetalleAlbaran(int numeroAlbaran, int ejercicio) async {
    // REQ-32: comercial sin modo reparto no llama a entregas/albaran.
    if (!state.isRepartidor) {
      if (!ref.mounted) return;
      state = state.copyWith(
        error: 'Disponible solo en modo reparto. Usa tus cobros pendientes.',
      );
      return;
    }
    state = state.copyWith(isLoading: true);
    try {
      final response = await ApiClient.get(
        '/entregas/albaran/$numeroAlbaran/$ejercicio',
        cacheKey: 'entregas:albaran:$numeroAlbaran:$ejercicio',
        cacheTTL: const Duration(minutes: 2),
      );
      if (!ref.mounted) return;
      if (response['success'] == true && response['albaran'] != null) {
        state = state.copyWith(
          albaranActual:
              Albaran.fromJson(response['albaran'] as Map<String, dynamic>),
        );
      }
    } catch (e) {
      if (!ref.mounted) return;
      state = state.copyWith(error: 'Error cargando albarán: $e');
    } finally {
      if (!ref.mounted) return;
      state = state.copyWith(isLoading: false);
    }
  }

  Future<bool> actualizarEstadoEntrega({
    required String itemId,
    required EstadoEntrega estado,
    int? cantidadEntregada,
    String? observaciones,
    double? latitud,
    double? longitud,
  }) async {
    if (!ref.mounted) return false;
    state = state.copyWith(
      error:
          'Endpoint retirado (410). Usa el flujo canónico de confirmación de entrega.',
    );
    return false;
  }

  Future<bool> registrarFirma(String entregaId, String base64Firma) async {
    if (!ref.mounted) return false;
    state = state.copyWith(
      error:
          'Endpoint retirado (410). La firma se sube por el flujo canónico de evidencias.',
    );
    return false;
  }

  String _buildEntregaCompletionIdempotencyKey(String albaranId) {
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final safeEmployee = state.employeeCode
        .trim()
        .replaceAll(RegExp('[^A-Za-z0-9_.:-]'), '-')
        .replaceFirst(RegExp(r'^$'), 'sin-repartidor');
    final safeAlbaran = albaranId
        .trim()
        .replaceAll(RegExp('[^A-Za-z0-9_.:-]'), '-')
        .replaceFirst(RegExp(r'^$'), 'sin-albaran');
    return 'entrega:$safeEmployee:$safeAlbaran:$timestamp';
  }

  Future<bool> completarEntrega(
    String albaranId, {
    String? observaciones,
  }) async {
    if (!ref.mounted) return false;
    state = state.copyWith(
      error:
          'Endpoint retirado (410). Completa la entrega desde el detalle canónico del rutero.',
    );
    return false;
  }

  Future<void> cargarPendingSummary(
    String? vendedorCode, {
    List<String>? vendedorCodes,
    int limit = 2000,
    int page = 1,
    int offset = 0,
    bool forceRefresh = false,
    String? tipoDocumento,
    String? fechaDesde,
    String? fechaHasta,
  }) async {
    if (!ref.mounted) return;
    state = state.copyWith(isLoading: true, error: null);
    try {
      String baseEndpoint;
      String? nextVendorCode;
      List<String>? nextVendorCodes;
      if (vendedorCodes != null && vendedorCodes.isNotEmpty) {
        nextVendorCode = null;
        nextVendorCodes = List<String>.from(vendedorCodes);
        baseEndpoint = '/cobros/pending-summary/${vendedorCodes.join(',')}';
      } else if (vendedorCode != null && vendedorCode.isNotEmpty) {
        nextVendorCode = vendedorCode;
        nextVendorCodes = null;
        baseEndpoint = '/cobros/pending-summary/$vendedorCode';
      } else {
        nextVendorCode = null;
        nextVendorCodes = null;
        baseEndpoint = '/cobros/pending-summary/ALL';
      }
      final safeLimit = limit < 1 ? 1 : (limit > 2000 ? 2000 : limit);
      final safeOffset = offset < 0 ? 0 : offset;
      final safePage = page < 1 ? 1 : page;
      final params = <String, String>{
        'limit': '$safeLimit',
        'page': '$safePage',
        'offset': '$safeOffset',
      };
      _addNonBlankParam(params, 'tipoDocumento', tipoDocumento);
      _addNonBlankParam(params, 'fechaDesde', fechaDesde);
      _addNonBlankParam(params, 'fechaHasta', fechaHasta);
      _addForceRefreshParam(params, forceRefresh);
      final endpoint = _endpointWithQuery(baseEndpoint, params);
      final response = await ApiClient.get(
        endpoint,
        cacheKey:
            'cobros:pending-summary:$baseEndpoint:${_stableQueryKey(params)}',
        cacheTTL: const Duration(minutes: 2),
        forceRefresh: forceRefresh,
        allowStale: false,
      );
      if (!ref.mounted) return;
      if (response['success'] == true) {
        final raw = response['summary'] as Map<String, dynamic>? ?? {};
        final summary =
            raw.map((k, v) => MapEntry(k, Map<String, dynamic>.from(v as Map)));
        final grandTotal =
            (response['grandTotal'] as num?)?.toDouble() ?? 0;
        final grandTotalVencido =
            (response['grandTotalVencido'] as num?)?.toDouble() ?? 0;
        final cvcGrandTotal =
            (response['cvcGrandTotal'] as num?)?.toDouble() ?? 0;
        final cvcGrandTotalVencido =
            (response['cvcGrandTotalVencido'] as num?)?.toDouble() ?? 0;
        final appAdjustmentsTotal =
            (response['appAdjustmentsTotal'] as num?)?.toDouble() ?? 0;
        final appOrdersTotal =
            (response['appOrdersTotal'] as num?)?.toDouble() ?? 0;
        final nextState = state.copyWith(
          lastSummaryVendorCode: nextVendorCode,
          lastSummaryVendorCodes: nextVendorCodes,
          lastSummaryTipoDocumento: tipoDocumento?.trim(),
          lastSummaryFechaDesde: fechaDesde?.trim(),
          lastSummaryFechaHasta: fechaHasta?.trim(),
        );
        final vencidos = summary.values
            .where((v) => ((v['vencido'] as num?)?.toDouble() ?? 0) > 0)
            .length;
        state = nextState.copyWith(
          pendingSummary: summary,
          grandTotal: grandTotal,
          grandTotalVencido: grandTotalVencido,
          cvcGrandTotal: cvcGrandTotal,
          cvcGrandTotalVencido: cvcGrandTotalVencido,
          appAdjustmentsTotal: appAdjustmentsTotal,
          appOrdersTotal: appOrdersTotal,
          portfolioClientCount: (response['clientCount'] as num?)?.toInt() ??
              summary.length,
          portfolioVencidoClientCount:
              (response['vencidoClientCount'] as num?)?.toInt() ?? vencidos,
          summarySource: (response['source'] as String?) ?? '',
          error: null,
        );
      } else {
        state = state.copyWith(
          lastSummaryVendorCode: nextVendorCode,
          lastSummaryVendorCodes: nextVendorCodes,
          lastSummaryTipoDocumento: tipoDocumento?.trim(),
          lastSummaryFechaDesde: fechaDesde?.trim(),
          lastSummaryFechaHasta: fechaHasta?.trim(),
          error: 'Error al cargar resumen de pendientes',
        );
      }
    } catch (e) {
      if (!ref.mounted) return;
      state = state.copyWith(error: 'Error de conexión: $e');
    } finally {
      if (!ref.mounted) return;
      state = state.copyWith(isLoading: false);
    }
  }

  Future<void> cargarCobrosPendientes(
    String codigoCliente, {
    String? tipoDocumento,
    String? fechaDesde,
    String? fechaHasta,
    String? vendedorCodes,
    bool forceRefresh = false,
  }) async {
    if (!ref.mounted) return;
    state = state.copyWith(isLoading: true, error: null);
    try {
      final params = <String, String>{};
      if (tipoDocumento != null && tipoDocumento.trim().isNotEmpty) {
        params['tipoDocumento'] = tipoDocumento.trim();
      }
      if (fechaDesde != null && fechaDesde.trim().isNotEmpty) {
        params['fechaDesde'] = fechaDesde.trim();
      }
      if (fechaHasta != null && fechaHasta.trim().isNotEmpty) {
        params['fechaHasta'] = fechaHasta.trim();
      }
      _addNonBlankParam(params, 'vendedorCodes', vendedorCodes);
      final networkParams = Map<String, String>.from(params);
      _addForceRefreshParam(networkParams, forceRefresh);
      final endpoint = _endpointWithQuery(
        '/cobros/$codigoCliente/pendientes',
        networkParams,
      );
      final response = await ApiClient.get(
        endpoint,
        cacheKey: 'cobros:pendientes:$codigoCliente:${_stableQueryKey(params)}',
        cacheTTL: const Duration(minutes: 1),
        forceRefresh: forceRefresh,
        allowStale: false,
      );
      if (!ref.mounted) return;
      if (response['success'] == true) {
        final payload = response['pendientes'] is Map
            ? Map<String, dynamic>.from(response['pendientes'] as Map)
            : response;
        final items = _parseCobrosPendientes(payload['cobros']);
        Object? resumen = CobrosState._sentinel;
        if (payload['resumen'] != null) {
          resumen = ResumenCobros.fromJson(
            payload['resumen'] as Map<String, dynamic>,
          );
        }
        state = state.copyWith(
          cobrosPendientes: items,
          resumenCobros: resumen,
          error: null,
        );
      } else {
        state = state.copyWith(
          error: (response['error'] as String?) ?? 'Error cargando cobros',
        );
      }
    } catch (e) {
      if (!ref.mounted) return;
      state = state.copyWith(error: 'Error cargando cobros: $e');
    } finally {
      if (!ref.mounted) return;
      state = state.copyWith(isLoading: false);
    }
  }

  List<CobroPendiente> _parseCobrosPendientes(dynamic raw) {
    final parsed = (raw as List<dynamic>?)
            ?.map((e) => CobroPendiente.fromJson(e as Map<String, dynamic>))
            .toList() ??
        [];
    return _dedupeCobrosPendientes(parsed);
  }

  static List<CobroPendiente> _dedupeCobrosPendientes(
    List<CobroPendiente> items,
  ) {
    final seen = <String>{};
    final out = <CobroPendiente>[];
    for (final item in items) {
      final docKey = item.docKey;
      final key = docKey != null && docKey.isNotEmpty
          ? docKey.entries.map((e) => '${e.key}:${e.value}').join('|')
          : [
              item.tipo.name,
              item.referencia.trim(),
              item.fecha.toIso8601String().substring(0, 10),
              item.importePendiente.toStringAsFixed(2),
            ].join('|');
      if (seen.add(key)) out.add(item);
    }
    return out;
  }

  static List<CobroHistorico> _dedupeHistoricoCobros(
    List<CobroHistorico> items,
  ) {
    final seen = <String>{};
    final out = <CobroHistorico>[];
    for (final item in items) {
      final key = [
        item.id.trim(),
        item.referencia.trim(),
        item.fecha.toIso8601String().substring(0, 10),
        item.importe.toStringAsFixed(2),
        (item.formaPago ?? '').trim(),
      ].join('|');
      if (seen.add(key)) out.add(item);
    }
    return out;
  }

  Future<void> cargarHistoricoCobros(
    String codigoCliente, {
    String? vendedorCodes,
    bool forceRefresh = false,
  }) async {
    try {
      final params = <String, String>{};
      _addNonBlankParam(params, 'vendedorCodes', vendedorCodes);
      final networkParams = Map<String, String>.from(params);
      _addForceRefreshParam(networkParams, forceRefresh);
      final response = await ApiClient.get(
        _endpointWithQuery('/cobros/$codigoCliente/historico', networkParams),
        cacheKey: 'cobros:historico:$codigoCliente:${_stableQueryKey(params)}',
        cacheTTL: const Duration(minutes: 5),
        forceRefresh: forceRefresh,
        maxStale: const Duration(minutes: 10),
      );
      if (!ref.mounted) return;
      if (response['success'] == true) {
        final list = response['historico'] as List? ?? [];
        state = state.copyWith(
          historicoCobros: _dedupeHistoricoCobros(
            list
                .map(
                  (e) => CobroHistorico.fromJson(
                    Map<String, dynamic>.from(e as Map),
                  ),
                )
                .toList(growable: false),
          ),
        );
      }
    } catch (e) {
      debugPrint('[CobrosProvider] cargarHistoricoCobros error: $e');
    }
  }

  Future<void> verificarEstadoCliente(
    String codigoCliente, {
    String? vendedorCodes,
    bool forceRefresh = false,
  }) async {
    try {
      final params = <String, String>{};
      _addNonBlankParam(params, 'vendedorCodes', vendedorCodes);
      final networkParams = Map<String, String>.from(params);
      _addForceRefreshParam(networkParams, forceRefresh);
      final response = await ApiClient.get(
        _endpointWithQuery('/cobros/$codigoCliente/estado', networkParams),
        cacheKey: 'cobros:estado:$codigoCliente:${_stableQueryKey(params)}',
        cacheTTL: const Duration(minutes: 1),
        forceRefresh: forceRefresh,
        allowStale: false,
      );
      if (!ref.mounted) return;
      if (response['success'] == true && response['estadoCliente'] != null) {
        state = state.copyWith(
          estadoClienteActual: EstadoCliente.fromJson(
            response['estadoCliente'] as Map<String, dynamic>,
          ),
        );
      }
    } catch (e) {
      debugPrint('[CobrosProvider] verificarEstadoCliente error: $e');
      if (!ref.mounted) return;
      state = state.copyWith(estadoClienteActual: null);
    }
  }

  String _cobroAttemptKey({
    required String codigoCliente,
    required String referencia,
    required double importe,
    required String formaPago,
    required TipoVenta tipoVenta,
    required TipoModoCobro tipoModo,
    required String codigoUsuario,
  }) {
    return [
      codigoUsuario.trim(),
      codigoCliente.trim(),
      referencia.trim(),
      importe.toStringAsFixed(2),
      formaPago.trim().toUpperCase(),
      tipoVenta.code,
      tipoModo.code,
      if (state.isRepartidor) 'REPARTIDOR' else 'COMERCIAL',
    ].join('|');
  }

  bool _shouldKeepCobroRetryToken(Object error) {
    if (error is ApiException) {
      final statusCode = error.statusCode;
      return statusCode == 0 || (statusCode != null && statusCode >= 500);
    }
    return false;
  }

  Future<bool> registrarCobro({
    required String codigoCliente,
    required String referencia,
    required double importe,
    required String formaPago,
    required TipoVenta tipoVenta,
    required TipoModoCobro tipoModo,
    String? codigoUsuario,
    String? observaciones,
    String? vendedorCodes,
    bool reloadAfter = true,
  }) async {
    final paymentObservations = observaciones?.trim() ?? '';
    // Observaciones obligatorias solo si hay cobro real (importe > 0).
    // En crédito/sin cobro no se bloquea; nunca se envía notas:null.
    if (paymentObservations.isEmpty && importe > 0.004) {
      if (!ref.mounted) return false;
      state = state.copyWith(
        error: 'Indica las observaciones del cobro antes de confirmar',
      );
      return false;
    }
    final actorCode = codigoUsuario ?? state.employeeCode;
    final attemptKey = _cobroAttemptKey(
      codigoCliente: codigoCliente,
      referencia: referencia,
      importe: importe,
      formaPago: formaPago,
      tipoVenta: tipoVenta,
      tipoModo: tipoModo,
      codigoUsuario: actorCode,
    );
    final idempotencyToken = _pendingCobroIdempotencyTokens.putIfAbsent(
      attemptKey,
      () => buildCobroIdempotencyToken(
        employeeCode: actorCode,
        codigoCliente: codigoCliente,
        referencia: referencia,
      ),
    );

    try {
      final response =
          await ApiClient.post('/cobros/$codigoCliente/registrar', {
        'referencia': referencia,
        'importe': importe,
        'formaPago': formaPago,
        'tipoVenta': tipoVenta.code,
        'tipoModo': tipoModo.code,
        'tipoUsuario': state.isRepartidor ? 'REPARTIDOR' : 'COMERCIAL',
        'codigoUsuario': actorCode,
        if (vendedorCodes != null && vendedorCodes.trim().isNotEmpty)
          'vendedorCodes': vendedorCodes.trim(),
        'observaciones': paymentObservations,
        'idempotencyToken': idempotencyToken,
      });
      if (!ref.mounted) return response['success'] == true;
      if (response['success'] == true) {
        await CacheService.invalidateByPrefix(
          'cobros:pendientes:$codigoCliente',
        );
        await CacheService.invalidateByPrefix(
          'cobros:historico:$codigoCliente',
        );
        await CacheService.invalidateByPrefix('cobros:estado:$codigoCliente');
        await CacheService.invalidateByPrefix('cobros:pending-summary:');
        await CacheService.invalidateByPrefix('repartidor:liquidacion');
        await CacheService.invalidateByPrefix('repartidor_finanzas');
        await CacheService.invalidateByPrefix('liquidacion');
        if (!ref.mounted) return true;
        // Emite al instante para que la liquidación suba sin esperar recarga.
        state = state.copyWith();
        if (reloadAfter) {
          await cargarCobrosPendientes(
            codigoCliente,
            vendedorCodes: vendedorCodes,
            forceRefresh: true,
          );
          unawaited(refreshLoadedPendingSummary(forceRefresh: true));
        }
        _pendingCobroIdempotencyTokens.remove(attemptKey);
        return true;
      }
      _pendingCobroIdempotencyTokens.remove(attemptKey);
      return false;
    } catch (e) {
      if (!_shouldKeepCobroRetryToken(e)) {
        _pendingCobroIdempotencyTokens.remove(attemptKey);
      }
      if (!ref.mounted) return false;
      state = state.copyWith(error: 'Error registrando cobro: $e');
      return false;
    }
  }

  Future<void> refreshLoadedPendingSummary({
    bool forceRefresh = true,
  }) async {
    if (state.pendingSummary.isEmpty &&
        state.lastSummaryVendorCode == null &&
        (state.lastSummaryVendorCodes == null ||
            state.lastSummaryVendorCodes!.isEmpty)) {
      return;
    }
    await cargarPendingSummary(
      state.lastSummaryVendorCode,
      vendedorCodes: state.lastSummaryVendorCodes,
      tipoDocumento: state.lastSummaryTipoDocumento,
      fechaDesde: state.lastSummaryFechaDesde,
      fechaHasta: state.lastSummaryFechaHasta,
      forceRefresh: forceRefresh,
    );
  }

  void limpiarDatos() {
    if (!ref.mounted) return;
    state = CobrosState(
      employeeCode: state.employeeCode,
      isRepartidor: state.isRepartidor,
    );
  }
}

// ============================================================
// Riverpod provider — clean family, no hacks, no null checks
// ============================================================

final cobrosProvider = NotifierProvider.family
    .autoDispose<CobrosNotifier, CobrosState, CobrosParams>(
  CobrosNotifier.new,
);

class CobrosParams {
  const CobrosParams({required this.employeeCode, this.isRepartidor = false});
  final String employeeCode;
  final bool isRepartidor;

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        other is CobrosParams &&
            other.employeeCode == employeeCode &&
            other.isRepartidor == isRepartidor;
  }

  @override
  int get hashCode => Object.hash(employeeCode, isRepartidor);
}
