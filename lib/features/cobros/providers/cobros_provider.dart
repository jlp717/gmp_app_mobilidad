/// COBROS PROVIDER — 100% Riverpod (ChangeNotifierProvider.family.autoDispose)
///
/// State management for cobros/entregas module.
/// Uses family pattern to parameterize by employeeCode + isRepartidor.
/// No overrideWithValue, no UnimplementedError, no null checks.

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/models/cobros_models.dart';
import '../../../core/api/api_client.dart';

class CobrosProvider extends ChangeNotifier {
  final String employeeCode;
  final bool isRepartidor;

  bool _isLoading = false;
  String? _error;

  List<Albaran> _albaranesPendientes = [];
  Albaran? _albaranActual;
  List<CobroPendiente> _cobrosPendientes = [];
  ResumenCobros? _resumenCobros;
  EstadoCliente? _estadoClienteActual;
  Map<String, Map<String, dynamic>> _pendingSummary = {};
  double _grandTotal = 0;
  String _filtroEstado = 'todos';
  String _filtroCliente = '';
  DateTime? _filtroFecha;

  CobrosProvider({
    required this.employeeCode,
    this.isRepartidor = false,
  });

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

  int get totalEntregasPendientes =>
      _albaranesPendientes.where((a) => a.estado == EstadoEntrega.pendiente).length;
  int get totalEntregasCompletadas =>
      _albaranesPendientes.where((a) => a.estado == EstadoEntrega.entregado).length;
  double get totalImportePendiente => _albaranesPendientes
      .where((a) => a.estado != EstadoEntrega.entregado)
      .fold(0.0, (sum, a) => sum + a.importeTotal);
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
      resultado = resultado.where((a) =>
          a.nombreCliente.toLowerCase().contains(_filtroCliente.toLowerCase()) ||
          a.codigoCliente.contains(_filtroCliente)).toList();
    }
    return resultado;
  }

  void setFiltroEstado(String estado) { _filtroEstado = estado; notifyListeners(); }
  void setFiltroCliente(String cliente) { _filtroCliente = cliente; notifyListeners(); }
  void limpiarFiltros() { _filtroEstado = 'todos'; _filtroCliente = ''; _filtroFecha = null; notifyListeners(); }

  Future<void> cargarAlbaranesPendientes() async {
    _isLoading = true; _error = null; notifyListeners();
    try {
      final response = await ApiClient.get('/entregas/pendientes/$employeeCode');
      if (response['success'] == true) {
        _albaranesPendientes = (response['albaranes'] as List<dynamic>?)
            ?.map((e) => Albaran.fromJson(e as Map<String, dynamic>)).toList() ?? [];
      } else {
        _error = (response['error'] as String?) ?? 'Error cargando albaranes';
      }
    } catch (e) {
      _error = 'Error de conexión: $e';
      if (kDebugMode) _cargarDatosEjemplo();
    } finally { _isLoading = false; notifyListeners(); }
  }

  Future<void> cargarDetalleAlbaran(int numeroAlbaran, int ejercicio) async {
    _isLoading = true; notifyListeners();
    try {
      final response = await ApiClient.get('/entregas/albaran/$numeroAlbaran/$ejercicio');
      if (response['success'] == true && response['albaran'] != null) {
        _albaranActual = Albaran.fromJson(response['albaran'] as Map<String, dynamic>);
      }
    } catch (e) { _error = 'Error cargando albarán: $e'; }
    finally { _isLoading = false; notifyListeners(); }
  }

  Future<bool> actualizarEstadoEntrega({
    required String itemId,
    required EstadoEntrega estado,
    int? cantidadEntregada,
    String? observaciones,
    double? latitud, double? longitud,
  }) async {
    try {
      final response = await ApiClient.post('/entregas/update', {
        'itemId': itemId, 'status': estado.name.toUpperCase(),
        'repartidorId': employeeCode, 'cantidadEntregada': cantidadEntregada,
        'observaciones': observaciones, 'latitud': latitud, 'longitud': longitud,
      });
      if (response['success'] == true) {
        final index = _albaranesPendientes.indexWhere(
          (a) => a.items.any((i) => i.itemId == itemId));
        if (index >= 0) {
          final item = _albaranesPendientes[index].items.firstWhere((i) => i.itemId == itemId);
          item.estado = estado;
          item.cantidadEntregada = cantidadEntregada ?? item.cantidadEntregada;
          final albaran = _albaranesPendientes[index];
          if (albaran.completo) albaran.estado = EstadoEntrega.entregado;
          notifyListeners();
        }
        return true;
      }
      return false;
    } catch (e) { _error = 'Error actualizando entrega: $e'; notifyListeners(); return false; }
  }

  Future<bool> registrarFirma(String entregaId, String base64Firma) async {
    try {
      final response = await ApiClient.post('/entregas/uploads/signature', {
        'entregaId': entregaId, 'firma': base64Firma,
      });
      if (response['success'] == true) {
        if (_albaranActual != null) { _albaranActual!.firmaBase64 = base64Firma; notifyListeners(); }
        return true;
      }
      return false;
    } catch (e) { _error = 'Error guardando firma: $e'; return false; }
  }

  Future<bool> completarEntrega(String albaranId, {String? observaciones}) async {
    final albaran = _albaranesPendientes.firstWhere(
      (a) => a.id == albaranId, orElse: () => throw Exception('Albarán no encontrado'));
    bool allSucceeded = true;
    for (final item in albaran.items) {
      if (item.estado != EstadoEntrega.entregado) {
        final ok = await actualizarEstadoEntrega(
          itemId: item.itemId, estado: EstadoEntrega.entregado,
          cantidadEntregada: item.cantidadPedida, observaciones: observaciones);
        if (!ok) allSucceeded = false;
      }
    }
    if (allSucceeded) { albaran.estado = EstadoEntrega.entregado; }
    else { _error = 'No se pudieron completar todos los ítems de la entrega'; }
    notifyListeners();
    return allSucceeded;
  }

  Future<void> cargarPendingSummary(String? vendedorCode, {List<String>? vendedorCodes}) async {
    _isLoading = true; _error = null; notifyListeners();
    try {
      String endpoint;
      if (vendedorCodes != null && vendedorCodes.isNotEmpty) {
        endpoint = '/cobros/pending-summary/${vendedorCodes.join(',')}';
      } else if (vendedorCode != null && vendedorCode.isNotEmpty) {
        endpoint = '/cobros/pending-summary/$vendedorCode';
      } else {
        endpoint = '/cobros/pending-summary/ALL';
      }
      final response = await ApiClient.get(endpoint);
      if (response['success'] == true) {
        final raw = response['summary'] as Map<String, dynamic>? ?? {};
        _pendingSummary = raw.map((k, v) => MapEntry(k, Map<String, dynamic>.from(v as Map)));
        _grandTotal = (response['grandTotal'] as num?)?.toDouble() ?? 0;
        _error = null;
      } else { _error = 'Error al cargar resumen de pendientes'; }
    } catch (e) { _error = 'Error de conexión: $e'; }
    finally { _isLoading = false; notifyListeners(); }
  }

  double pendingForClient(String code) {
    final entry = _pendingSummary[code.trim()];
    return (entry?['total'] as num?)?.toDouble() ?? 0;
  }

  Future<void> cargarCobrosPendientes(String codigoCliente) async {
    _isLoading = true; _error = null; notifyListeners();
    try {
      final response = await ApiClient.get('/cobros/$codigoCliente/pendientes');
      if (response['success'] == true) {
        _cobrosPendientes = (response['cobros'] as List<dynamic>?)
            ?.map((e) => CobroPendiente.fromJson(e as Map<String, dynamic>)).toList() ?? [];
        if (response['resumen'] != null) {
          _resumenCobros = ResumenCobros.fromJson(response['resumen'] as Map<String, dynamic>);
        }
      }
    } catch (e) { _error = 'Error cargando cobros: $e'; }
    finally { _isLoading = false; notifyListeners(); }
  }

  Future<void> verificarEstadoCliente(String codigoCliente) async {
    try {
      final response = await ApiClient.get('/cobros/$codigoCliente/estado');
      if (response['success'] == true && response['estadoCliente'] != null) {
        _estadoClienteActual = EstadoCliente.fromJson(response['estadoCliente'] as Map<String, dynamic>);
        notifyListeners();
      }
    } catch (e) { _estadoClienteActual = null; }
  }

  Future<bool> registrarCobro({
    required String codigoCliente, required String referencia,
    required double importe, required String formaPago,
    required TipoVenta tipoVenta, required TipoModoCobro tipoModo,
    String? codigoUsuario, String? observaciones,
  }) async {
    try {
      final response = await ApiClient.post('/cobros/$codigoCliente/registrar', {
        'referencia': referencia, 'importe': importe, 'formaPago': formaPago,
        'tipoVenta': tipoVenta.code, 'tipoModo': tipoModo.code,
        'tipoUsuario': isRepartidor ? 'REPARTIDOR' : 'COMERCIAL',
        'codigoUsuario': codigoUsuario ?? employeeCode, 'observaciones': observaciones,
      });
      if (response['success'] == true) {
        await cargarCobrosPendientes(codigoCliente);
        return true;
      }
      return false;
    } catch (e) { _error = 'Error registrando cobro: $e'; notifyListeners(); return false; }
  }

  void _cargarDatosEjemplo() {
    final now = DateTime.now();
    _albaranesPendientes = [
      Albaran(id: '2026-A-1001', numeroAlbaran: 1001, codigoCliente: '9900',
        nombreCliente: 'BAR EL RINCÓN', direccion: 'C/ Mayor, 15 - Madrid',
        fecha: now, importeTotal: 245.80, esCTR: true,
        items: [
          EntregaItem(itemId: '1001-1', codigoArticulo: 'COCA2L',
            descripcion: 'Coca-Cola 2L Pack 6', cantidadPedida: 5),
          EntregaItem(itemId: '1001-2', codigoArticulo: 'AGUA1L',
            descripcion: 'Agua Mineral 1.5L Pack 6', cantidadPedida: 10),
        ]),
      Albaran(id: '2026-A-1002', numeroAlbaran: 1002, codigoCliente: '8801',
        nombreCliente: 'RESTAURANTE LA PLAZA', direccion: 'Plaza España, 3 - Madrid',
        fecha: now, importeTotal: 532.40, esCTR: false,
        items: [
          EntregaItem(itemId: '1002-1', codigoArticulo: 'CERV33',
            descripcion: 'Cerveza 33cl Caja 24', cantidadPedida: 8),
        ]),
    ];
  }

  void limpiarDatos() {
    _albaranesPendientes = []; _cobrosPendientes = []; _albaranActual = null;
    _resumenCobros = null; _estadoClienteActual = null; _error = null;
    notifyListeners();
  }
}

// ============================================================
// Riverpod provider — clean family, no hacks, no null checks
// ============================================================

final cobrosProvider = ChangeNotifierProvider.family.autoDispose<CobrosProvider, CobrosParams>(
  (ref, params) => CobrosProvider(
    employeeCode: params.employeeCode,
    isRepartidor: params.isRepartidor,
  ),
);

class CobrosParams {
  final String employeeCode;
  final bool isRepartidor;
  const CobrosParams({required this.employeeCode, this.isRepartidor = false});
}
