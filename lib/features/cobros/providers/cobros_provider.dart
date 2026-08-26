/// COBROS PROVIDER — 100% Riverpod (ChangeNotifierProvider.family.autoDispose)
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

class CobrosProvider extends ChangeNotifier {
  CobrosProvider({
    required this.employeeCode,
    this.isRepartidor = false,
  });
  final String employeeCode;
  final bool isRepartidor;

  bool _isLoading = false;
  String? _error;
  bool _disposed = false;

  List<Albaran> _albaranesPendientes = [];
  Albaran? _albaranActual;
  List<CobroPendiente> _cobrosPendientes = [];
  List<CobroHistorico> _historicoCobros = [];
  ResumenCobros? _resumenCobros;
  EstadoCliente? _estadoClienteActual;
  Map<String, Map<String, dynamic>> _pendingSummary = {};
  String? _lastSummaryVendorCode;
  List<String>? _lastSummaryVendorCodes;
  String? _lastSummaryTipoDocumento;
  String? _lastSummaryFechaDesde;
  String? _lastSummaryFechaHasta;
  double _grandTotal = 0;
  double _grandTotalVencido = 0;
  double _cvcGrandTotal = 0;
  double _cvcGrandTotalVencido = 0;
  double _appAdjustmentsTotal = 0;
  double _appOrdersTotal = 0;
  int _portfolioClientCount = 0;
  int _portfolioVencidoClientCount = 0;
  String _summarySource = '';
  String _filtroEstado = 'todos';
  String _filtroCliente = '';
  DateTime? _filtroFecha;
  final Map<String, String> _pendingCobroIdempotencyTokens = {};

  bool get isLoading => _isLoading;
  String? get error => _error;
  List<Albaran> get albaranesPendientes => _albaranesPendientes;
  Albaran? get albaranActual => _albaranActual;
  List<CobroPendiente> get cobrosPendientes => _cobrosPendientes;
  List<CobroHistorico> get historicoCobros =>
      List.unmodifiable(_historicoCobros);
  ResumenCobros? get resumenCobros => _resumenCobros;
  EstadoCliente? get estadoClienteActual => _estadoClienteActual;
  String get filtroEstado => _filtroEstado;
  String get filtroCliente => _filtroCliente;
  Map<String, Map<String, dynamic>> get pendingSummary => _pendingSummary;
  double get grandTotal => _grandTotal;
  double get grandTotalVencido => _grandTotalVencido;
  double get cvcGrandTotal => _cvcGrandTotal;
  double get cvcGrandTotalVencido => _cvcGrandTotalVencido;
  double get appAdjustmentsTotal => _appAdjustmentsTotal;
  double get appOrdersTotal => _appOrdersTotal;
  int get portfolioClientCount => _portfolioClientCount;
  int get portfolioVencidoClientCount => _portfolioVencidoClientCount;
  String get summarySource => _summarySource;

  /// Numero de clientes con cualquier importe pendiente (>0).
  int get clientsWithDebt => _pendingSummary.values
      .where((v) => ((v['total'] as num?)?.toDouble() ?? 0) > 0)
      .length;

  /// Numero de clientes con importe vencido (>0).
  int get clientsWithVencido => _pendingSummary.values
      .where((v) => ((v['vencido'] as num?)?.toDouble() ?? 0) > 0)
      .length;

  int get totalEntregasPendientes => _albaranesPendientes
      .where((a) => a.estado == EstadoEntrega.pendiente)
      .length;
  int get totalEntregasCompletadas => _albaranesPendientes
      .where((a) => a.estado == EstadoEntrega.entregado)
      .length;
  double get totalImportePendiente => _albaranesPendientes
      .where((a) => a.estado != EstadoEntrega.entregado)
      .fold(0, (sum, a) => sum + a.importeTotal);
  int get totalCTRPendientes => _albaranesPendientes
      .where((a) => a.esCTR && a.estado != EstadoEntrega.entregado)
      .length;

  List<Albaran> get albaranesFiltrados {
    var resultado = _albaranesPendientes;
    if (_filtroEstado != 'todos') {
      final estado = EstadoEntrega.fromString(_filtroEstado);
      resultado = resultado.where((a) => a.estado == estado).toList();
    }
    if (_filtroCliente.isNotEmpty) {
      resultado = resultado
          .where(
            (a) =>
                a.nombreCliente
                    .toLowerCase()
                    .contains(_filtroCliente.toLowerCase()) ||
                a.codigoCliente.contains(_filtroCliente),
          )
          .toList();
    }
    return resultado;
  }

  void setFiltroEstado(String estado) {
    _filtroEstado = estado;
    notifyListeners();
  }

  void setFiltroCliente(String cliente) {
    _filtroCliente = cliente;
    notifyListeners();
  }

  void limpiarFiltros() {
    _filtroEstado = 'todos';
    _filtroCliente = '';
    _filtroFecha = null;
    notifyListeners();
  }

  Future<void> cargarAlbaranesPendientes() async {
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      final response = await ApiClient.get(
        '/entregas/pendientes/$employeeCode',
        cacheKey: 'entregas:pendientes:$employeeCode:default',
        cacheTTL: const Duration(minutes: 2),
      );
      if (response['success'] == true) {
        _albaranesPendientes = (response['albaranes'] as List<dynamic>?)
                ?.map((e) => Albaran.fromJson(e as Map<String, dynamic>))
                .toList() ??
            [];
      } else {
        _error = (response['error'] as String?) ?? 'Error cargando albaranes';
      }
    } catch (e) {
      _error = 'Error de conexión: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> cargarDetalleAlbaran(int numeroAlbaran, int ejercicio) async {
    _isLoading = true;
    notifyListeners();
    try {
      final response = await ApiClient.get(
        '/entregas/albaran/$numeroAlbaran/$ejercicio',
        cacheKey: 'entregas:albaran:$numeroAlbaran:$ejercicio',
        cacheTTL: const Duration(minutes: 2),
      );
      if (response['success'] == true && response['albaran'] != null) {
        _albaranActual =
            Albaran.fromJson(response['albaran'] as Map<String, dynamic>);
      }
    } catch (e) {
      _error = 'Error cargando albarán: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
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
    _error =
        'Endpoint retirado (410). Usa el flujo canónico de confirmación de entrega.';
    notifyListeners();
    return false;
  }

  Future<bool> registrarFirma(String entregaId, String base64Firma) async {
    _error =
        'Endpoint retirado (410). La firma se sube por el flujo canónico de evidencias.';
    notifyListeners();
    return false;
  }

  String _buildEntregaCompletionIdempotencyKey(String albaranId) {
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final safeEmployee = employeeCode
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
    _error =
        'Endpoint retirado (410). Completa la entrega desde el detalle canónico del rutero.';
    notifyListeners();
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
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      String baseEndpoint;
      if (vendedorCodes != null && vendedorCodes.isNotEmpty) {
        _lastSummaryVendorCode = null;
        _lastSummaryVendorCodes = List<String>.from(vendedorCodes);
        baseEndpoint = '/cobros/pending-summary/${vendedorCodes.join(',')}';
      } else if (vendedorCode != null && vendedorCode.isNotEmpty) {
        _lastSummaryVendorCode = vendedorCode;
        _lastSummaryVendorCodes = null;
        baseEndpoint = '/cobros/pending-summary/$vendedorCode';
      } else {
        _lastSummaryVendorCode = null;
        _lastSummaryVendorCodes = null;
        baseEndpoint = '/cobros/pending-summary/ALL';
      }
      _lastSummaryTipoDocumento = tipoDocumento?.trim();
      _lastSummaryFechaDesde = fechaDesde?.trim();
      _lastSummaryFechaHasta = fechaHasta?.trim();
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
      if (response['success'] == true) {
        final raw = response['summary'] as Map<String, dynamic>? ?? {};
        _pendingSummary =
            raw.map((k, v) => MapEntry(k, Map<String, dynamic>.from(v as Map)));
        _grandTotal = (response['grandTotal'] as num?)?.toDouble() ?? 0;
        _grandTotalVencido =
            (response['grandTotalVencido'] as num?)?.toDouble() ?? 0;
        _cvcGrandTotal = (response['cvcGrandTotal'] as num?)?.toDouble() ?? 0;
        _cvcGrandTotalVencido =
            (response['cvcGrandTotalVencido'] as num?)?.toDouble() ?? 0;
        _appAdjustmentsTotal =
            (response['appAdjustmentsTotal'] as num?)?.toDouble() ?? 0;
        _appOrdersTotal = (response['appOrdersTotal'] as num?)?.toDouble() ?? 0;
        _portfolioClientCount = (response['clientCount'] as num?)?.toInt() ??
            _pendingSummary.length;
        _portfolioVencidoClientCount =
            (response['vencidoClientCount'] as num?)?.toInt() ??
                clientsWithVencido;
        _summarySource = (response['source'] as String?) ?? '';
        _error = null;
      } else {
        _error = 'Error al cargar resumen de pendientes';
      }
    } catch (e) {
      _error = 'Error de conexión: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  double pendingForClient(String code) {
    final entry = _pendingSummary[code.trim()];
    return (entry?['total'] as num?)?.toDouble() ?? 0;
  }

  bool hasPendingSummaryForClient(String code) {
    return _pendingSummary.containsKey(code.trim());
  }

  /// Req #15: importe vencido por cliente (subset de pending).
  double vencidoForClient(String code) {
    final entry = _pendingSummary[code.trim()];
    return (entry?['vencido'] as num?)?.toDouble() ?? 0;
  }

  /// Req #15: estado consolidado por cliente — VENCIDO | PENDIENTE | AL_DIA.
  String estadoForClient(String code) {
    final entry = _pendingSummary[code.trim()];
    return estadoFromPendingSummaryEntry(entry);
  }

  Future<void> cargarCobrosPendientes(
    String codigoCliente, {
    String? tipoDocumento,
    String? fechaDesde,
    String? fechaHasta,
    String? vendedorCodes,
    bool forceRefresh = false,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();
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
      if (response['success'] == true) {
        final payload = response['pendientes'] is Map
            ? Map<String, dynamic>.from(response['pendientes'] as Map)
            : response;
        _cobrosPendientes = _parseCobrosPendientes(payload['cobros']);
        if (payload['resumen'] != null) {
          _resumenCobros = ResumenCobros.fromJson(
            payload['resumen'] as Map<String, dynamic>,
          );
        }
        _error = null;
      } else {
        _error = (response['error'] as String?) ?? 'Error cargando cobros';
      }
    } catch (e) {
      _error = 'Error cargando cobros: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
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

  /// Solo documentos cobrables por el comercial (excluye responsabilidad repartidor).
  List<CobroPendiente> cobrosPendientesComercial() {
    return _cobrosPendientes.where((c) {
      if (c.cobradoPorRepartidor) return false;
      return c.estado != EstadoCobro.alDia && c.importePendiente > 0.0001;
    }).toList(growable: false);
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
      if (response['success'] == true) {
        final list = response['historico'] as List? ?? [];
        _historicoCobros = _dedupeHistoricoCobros(
          list
              .map(
                (e) => CobroHistorico.fromJson(
                  Map<String, dynamic>.from(e as Map),
                ),
              )
              .toList(growable: false),
        );
        notifyListeners();
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
      if (response['success'] == true && response['estadoCliente'] != null) {
        _estadoClienteActual = EstadoCliente.fromJson(
          response['estadoCliente'] as Map<String, dynamic>,
        );
        notifyListeners();
      }
    } catch (e) {
      debugPrint('[CobrosProvider] verificarEstadoCliente error: $e');
      _estadoClienteActual = null;
      notifyListeners();
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
      if (isRepartidor) 'REPARTIDOR' else 'COMERCIAL',
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
    final actorCode = codigoUsuario ?? employeeCode;
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
        'tipoUsuario': isRepartidor ? 'REPARTIDOR' : 'COMERCIAL',
        'codigoUsuario': actorCode,
        if (vendedorCodes != null && vendedorCodes.trim().isNotEmpty)
          'vendedorCodes': vendedorCodes.trim(),
        'observaciones': observaciones,
        'idempotencyToken': idempotencyToken,
      });
      if (response['success'] == true) {
        await CacheService.invalidateByPrefix(
          'cobros:pendientes:$codigoCliente',
        );
        await CacheService.invalidateByPrefix(
          'cobros:historico:$codigoCliente',
        );
        await CacheService.invalidateByPrefix('cobros:estado:$codigoCliente');
        await CacheService.invalidateByPrefix('cobros:pending-summary:');
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
      _error = 'Error registrando cobro: $e';
      notifyListeners();
      return false;
    }
  }

  Future<void> refreshLoadedPendingSummary({
    bool forceRefresh = true,
  }) async {
    if (_pendingSummary.isEmpty &&
        _lastSummaryVendorCode == null &&
        (_lastSummaryVendorCodes == null || _lastSummaryVendorCodes!.isEmpty)) {
      return;
    }
    await cargarPendingSummary(
      _lastSummaryVendorCode,
      vendedorCodes: _lastSummaryVendorCodes,
      tipoDocumento: _lastSummaryTipoDocumento,
      fechaDesde: _lastSummaryFechaDesde,
      fechaHasta: _lastSummaryFechaHasta,
      forceRefresh: forceRefresh,
    );
  }

  void limpiarDatos() {
    _albaranesPendientes = [];
    _cobrosPendientes = [];
    _historicoCobros = [];
    _albaranActual = null;
    _resumenCobros = null;
    _estadoClienteActual = null;
    _pendingSummary = {};
    _grandTotal = 0;
    _grandTotalVencido = 0;
    _cvcGrandTotal = 0;
    _cvcGrandTotalVencido = 0;
    _appAdjustmentsTotal = 0;
    _appOrdersTotal = 0;
    _portfolioClientCount = 0;
    _portfolioVencidoClientCount = 0;
    _summarySource = '';
    _lastSummaryVendorCode = null;
    _lastSummaryVendorCodes = null;
    _lastSummaryTipoDocumento = null;
    _lastSummaryFechaDesde = null;
    _lastSummaryFechaHasta = null;
    _error = null;
    notifyListeners();
  }

  @override
  void notifyListeners() {
    // Guard: el provider es autoDispose y hay recargas fire-and-forget
    // (p.ej. cargarPendingSummary tras registrarCobro). Nunca emitir
    // estado después de dispose.
    if (_disposed) return;
    super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

// ============================================================
// Riverpod provider — clean family, no hacks, no null checks
// ============================================================

final cobrosProvider =
    ChangeNotifierProvider.family.autoDispose<CobrosProvider, CobrosParams>(
  (ref, params) => CobrosProvider(
    employeeCode: params.employeeCode,
    isRepartidor: params.isRepartidor,
  ),
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
