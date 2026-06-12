/// COBROS PROVIDER — 100% Riverpod (ChangeNotifierProvider.family.autoDispose)
///
/// State management for cobros/entregas module.
/// Uses family pattern to parameterize by employeeCode + isRepartidor.
/// No overrideWithValue, no UnimplementedError, no null checks.
library;

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
  ResumenCobros? _resumenCobros;
  EstadoCliente? _estadoClienteActual;
  Map<String, Map<String, dynamic>> _pendingSummary = {};
  String? _lastSummaryVendorCode;
  List<String>? _lastSummaryVendorCodes;
  double _grandTotal = 0;
  double _grandTotalVencido = 0;
  String _filtroEstado = 'todos';
  String _filtroCliente = '';
  DateTime? _filtroFecha;

  bool get isLoading => _isLoading;
  String? get error => _error;
  List<Albaran> get albaranesPendientes => _albaranesPendientes;
  Albaran? get albaranActual => _albaranActual;
  List<CobroPendiente> get cobrosPendientes => _cobrosPendientes;
  ResumenCobros? get resumenCobros => _resumenCobros;
  EstadoCliente? get estadoClienteActual => _estadoClienteActual;
  String get filtroEstado => _filtroEstado;
  String get filtroCliente => _filtroCliente;
  Map<String, Map<String, dynamic>> get pendingSummary => _pendingSummary;
  double get grandTotal => _grandTotal;
  double get grandTotalVencido => _grandTotalVencido;

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
    try {
      final response = await ApiClient.post('/entregas/update', {
        'itemId': itemId,
        'status': estado.name.toUpperCase(),
        'repartidorId': employeeCode,
        'cantidadEntregada': cantidadEntregada,
        'observaciones': observaciones,
        'latitud': latitud,
        'longitud': longitud,
      });
      if (response['success'] == true) {
        await CacheService.invalidateByPrefix(
          'entregas:pendientes:$employeeCode:',
        );
        final index = _albaranesPendientes
            .indexWhere((a) => a.items.any((i) => i.itemId == itemId));
        if (index >= 0) {
          final item = _albaranesPendientes[index]
              .items
              .firstWhere((i) => i.itemId == itemId);
          item.estado = estado;
          item.cantidadEntregada = cantidadEntregada ?? item.cantidadEntregada;
          final albaran = _albaranesPendientes[index];
          if (albaran.completo) albaran.estado = EstadoEntrega.entregado;
          notifyListeners();
        }
        return true;
      }
      return false;
    } catch (e) {
      _error = 'Error actualizando entrega: $e';
      notifyListeners();
      return false;
    }
  }

  Future<bool> registrarFirma(String entregaId, String base64Firma) async {
    try {
      final response = await ApiClient.post('/entregas/uploads/signature', {
        'entregaId': entregaId,
        'firma': base64Firma,
      });
      if (response['success'] == true) {
        if (_albaranActual != null) {
          _albaranActual!.firmaBase64 = base64Firma;
          notifyListeners();
        }
        return true;
      }
      return false;
    } catch (e) {
      _error = 'Error guardando firma: $e';
      return false;
    }
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
    final albaran = _albaranesPendientes.firstWhere(
      (a) => a.id == albaranId,
      orElse: () => throw Exception('Albarán no encontrado'),
    );
    final pendingItems = albaran.items
        .where((item) => item.estado != EstadoEntrega.entregado)
        .toList(growable: false);

    if (pendingItems.isEmpty) {
      albaran.estado = EstadoEntrega.entregado;
      notifyListeners();
      return true;
    }

    try {
      final response = await ApiClient.post('/entregas/update', {
        'idempotencyKey': _buildEntregaCompletionIdempotencyKey(albaranId),
        'albaranId': albaran.id,
        'status': EstadoEntrega.entregado.name.toUpperCase(),
        'repartidorId': employeeCode,
        'observaciones': observaciones,
        'items': pendingItems
            .map(
              (item) => {
                'itemId': item.itemId,
                'status': EstadoEntrega.entregado.name.toUpperCase(),
                'cantidadEntregada': item.cantidadPedida,
                'observaciones': observaciones,
              },
            )
            .toList(growable: false),
      });

      if (response['success'] == true) {
        await CacheService.invalidateByPrefix(
          'entregas:pendientes:$employeeCode:',
        );
        for (final item in pendingItems) {
          item.estado = EstadoEntrega.entregado;
          item.cantidadEntregada = item.cantidadPedida;
        }
        albaran.estado = EstadoEntrega.entregado;
        _error = null;
        notifyListeners();
        return true;
      }

      _error = (response['error'] as String?) ??
          'No se pudieron completar todos los ítems de la entrega';
      notifyListeners();
      return false;
    } catch (e) {
      _error = 'Error completando entrega: $e';
      notifyListeners();
      return false;
    }
  }

  Future<void> cargarPendingSummary(
    String? vendedorCode, {
    List<String>? vendedorCodes,
    bool forceRefresh = false,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      String endpoint;
      if (vendedorCodes != null && vendedorCodes.isNotEmpty) {
        _lastSummaryVendorCode = null;
        _lastSummaryVendorCodes = List<String>.from(vendedorCodes);
        endpoint = '/cobros/pending-summary/${vendedorCodes.join(',')}';
      } else if (vendedorCode != null && vendedorCode.isNotEmpty) {
        _lastSummaryVendorCode = vendedorCode;
        _lastSummaryVendorCodes = null;
        endpoint = '/cobros/pending-summary/$vendedorCode';
      } else {
        _lastSummaryVendorCode = null;
        _lastSummaryVendorCodes = null;
        endpoint = '/cobros/pending-summary/ALL';
      }
      final response = await ApiClient.get(
        endpoint,
        cacheKey: 'cobros:pending-summary:$endpoint',
        cacheTTL: const Duration(minutes: 2),
        forceRefresh: forceRefresh,
      );
      if (response['success'] == true) {
        final raw = response['summary'] as Map<String, dynamic>? ?? {};
        _pendingSummary =
            raw.map((k, v) => MapEntry(k, Map<String, dynamic>.from(v as Map)));
        _grandTotal = (response['grandTotal'] as num?)?.toDouble() ?? 0;
        _grandTotalVencido =
            (response['grandTotalVencido'] as num?)?.toDouble() ?? 0;
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
    bool forceRefresh = false,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      final response = await ApiClient.get(
        '/cobros/$codigoCliente/pendientes',
        cacheKey: 'cobros:pendientes:$codigoCliente',
        cacheTTL: const Duration(minutes: 1),
        forceRefresh: forceRefresh,
      );
      if (response['success'] == true) {
        final payload = response['pendientes'] is Map
            ? Map<String, dynamic>.from(response['pendientes'] as Map)
            : response;
        _cobrosPendientes = (payload['cobros'] as List<dynamic>?)
                ?.map((e) => CobroPendiente.fromJson(e as Map<String, dynamic>))
                .toList() ??
            [];
        if (payload['resumen'] != null) {
          _resumenCobros = ResumenCobros.fromJson(
            payload['resumen'] as Map<String, dynamic>,
          );
        }
      }
    } catch (e) {
      _error = 'Error cargando cobros: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> verificarEstadoCliente(String codigoCliente) async {
    try {
      final response = await ApiClient.get(
        '/cobros/$codigoCliente/estado',
        cacheKey: 'cobros:estado:$codigoCliente',
        cacheTTL: const Duration(minutes: 1),
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

  Future<bool> registrarCobro({
    required String codigoCliente,
    required String referencia,
    required double importe,
    required String formaPago,
    required TipoVenta tipoVenta,
    required TipoModoCobro tipoModo,
    String? codigoUsuario,
    String? observaciones,
    bool reloadAfter = true,
  }) async {
    try {
      final response =
          await ApiClient.post('/cobros/$codigoCliente/registrar', {
        'referencia': referencia,
        'importe': importe,
        'formaPago': formaPago,
        'tipoVenta': tipoVenta.code,
        'tipoModo': tipoModo.code,
        'tipoUsuario': isRepartidor ? 'REPARTIDOR' : 'COMERCIAL',
        'codigoUsuario': codigoUsuario ?? employeeCode,
        'observaciones': observaciones,
        'idempotencyToken': buildCobroIdempotencyToken(
          employeeCode: codigoUsuario ?? employeeCode,
          codigoCliente: codigoCliente,
          referencia: referencia,
        ),
      });
      if (response['success'] == true) {
        await CacheService.invalidate('cobros:pendientes:$codigoCliente');
        await CacheService.invalidate('cobros:estado:$codigoCliente');
        await CacheService.invalidateByPrefix('cobros:pending-summary:');
        if (reloadAfter) {
          await cargarCobrosPendientes(codigoCliente, forceRefresh: true);
          // Refresca el summary agregado para que la lista principal se actualice.
          // Solo si ya teniamos un summary cargado (vendedor conocido).
          if (_pendingSummary.isNotEmpty) {
            // No bloqueamos el flujo de UI con await: fire-and-forget.
            // ignore: unawaited_futures
            cargarPendingSummary(
              _lastSummaryVendorCode,
              vendedorCodes: _lastSummaryVendorCodes,
              forceRefresh: true,
            );
          }
        }
        return true;
      }
      return false;
    } catch (e) {
      _error = 'Error registrando cobro: $e';
      notifyListeners();
      return false;
    }
  }

  void limpiarDatos() {
    _albaranesPendientes = [];
    _cobrosPendientes = [];
    _albaranActual = null;
    _resumenCobros = null;
    _estadoClienteActual = null;
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
