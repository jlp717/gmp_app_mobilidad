/// COBROS PROVIDER
/// Estado global para el módulo de cobros y entregas

import 'package:flutter/material.dart';
import '../data/models/cobros_models.dart';
import '../../../core/api/api_client.dart';

class CobrosProvider extends ChangeNotifier {
  final String employeeCode;
  final bool isRepartidor;

  // Estado
  bool _isLoading = false;
  String? _error;
  
  // Datos del repartidor
  List<Albaran> _albaranesPendientes = [];
  Albaran? _albaranActual;
  
  // Datos del comercial
  List<CobroPendiente> _cobrosPendientes = [];
  ResumenCobros? _resumenCobros;
  EstadoCliente? _estadoClienteActual;
  
  // Filtros
  String _filtroEstado = 'todos';
  String _filtroCliente = '';
  DateTime? _filtroFecha;

  CobrosProvider({
    required this.employeeCode,
    this.isRepartidor = false,
  });

  // ============================================
  // GETTERS
  // ============================================

  bool get isLoading => _isLoading;
  String? get error => _error;
  List<Albaran> get albaranesPendientes => _albaranesPendientes;
  Albaran? get albaranActual => _albaranActual;
  List<CobroPendiente> get cobrosPendientes => _cobrosPendientes;
  ResumenCobros? get resumenCobros => _resumenCobros;
  EstadoCliente? get estadoClienteActual => _estadoClienteActual;
  String get filtroEstado => _filtroEstado;
  String get filtroCliente => _filtroCliente;

  // Estadísticas calculadas
  int get totalEntregasPendientes => _albaranesPendientes
      .where((a) => a.estado == EstadoEntrega.pendiente)
      .length;
  
  int get totalEntregasCompletadas => _albaranesPendientes
      .where((a) => a.estado == EstadoEntrega.entregado)
      .length;

  double get totalImportePendiente => _albaranesPendientes
      .where((a) => a.estado != EstadoEntrega.entregado)
      .fold(0.0, (sum, a) => sum + a.importeTotal);

  int get totalCTRPendientes => _albaranesPendientes
      .where((a) => a.esCTR && a.estado != EstadoEntrega.entregado)
      .length;

  // Albaranes filtrados
  List<Albaran> get albaranesFiltrados {
    var resultado = _albaranesPendientes;
    
    if (_filtroEstado != 'todos') {
      final estado = EstadoEntrega.fromString(_filtroEstado);
      resultado = resultado.where((a) => a.estado == estado).toList();
    }
    
    if (_filtroCliente.isNotEmpty) {
      resultado = resultado.where((a) => 
        a.nombreCliente.toLowerCase().contains(_filtroCliente.toLowerCase()) ||
        a.codigoCliente.contains(_filtroCliente)
      ).toList();
    }
    
    return resultado;
  }

  // ============================================
  // SETTERS / FILTROS
  // ============================================

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

  // ============================================
  // API - REPARTIDOR
  // ============================================

  /// Carga albaranes pendientes del día
  Future<void> cargarAlbaranesPendientes() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await ApiClient.get('/entregas/pendientes/$employeeCode');
      
      if (response['success'] == true) {
        final albaranes = (response['albaranes'] as List<dynamic>?)
            ?.map((e) => Albaran.fromJson(e))
            .toList() ?? [];
        
        _albaranesPendientes = albaranes;
      } else {
        _error = response['error'] ?? 'Error cargando albaranes';
      }
    } catch (e) {
      _error = 'Error de conexión: $e';
      // Cargar datos de ejemplo para desarrollo
      _cargarDatosEjemplo();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Obtiene detalle de un albarán con items
  Future<void> cargarDetalleAlbaran(int numeroAlbaran, int ejercicio) async {
    _isLoading = true;
    notifyListeners();

    try {
      final response = await ApiClient.get('/entregas/albaran/$numeroAlbaran/$ejercicio');
      
      if (response['success'] == true && response['albaran'] != null) {
        _albaranActual = Albaran.fromJson(response['albaran']);
      }
    } catch (e) {
      _error = 'Error cargando albarán: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Actualiza estado de una entrega
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
        // Actualizar estado local
        final index = _albaranesPendientes.indexWhere(
          (a) => a.items.any((i) => i.itemId == itemId)
        );
        if (index >= 0) {
          final item = _albaranesPendientes[index].items.firstWhere(
            (i) => i.itemId == itemId
          );
          item.estado = estado;
          item.cantidadEntregada = cantidadEntregada ?? item.cantidadEntregada;
          
          // Verificar si el albarán está completo
          final albaran = _albaranesPendientes[index];
          if (albaran.completo) {
            albaran.estado = EstadoEntrega.entregado;
          }
          
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

  /// Registra firma del cliente
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

  /// Marca albarán como completamente entregado
  Future<bool> completarEntrega(String albaranId, {String? observaciones}) async {
    final albaran = _albaranesPendientes.firstWhere(
      (a) => a.id == albaranId,
      orElse: () => throw Exception('Albarán no encontrado'),
    );

    // Marcar todos los items como entregados
    for (final item in albaran.items) {
      if (item.estado != EstadoEntrega.entregado) {
        await actualizarEstadoEntrega(
          itemId: item.itemId,
          estado: EstadoEntrega.entregado,
          cantidadEntregada: item.cantidadPedida,
          observaciones: observaciones,
        );
      }
    }

    albaran.estado = EstadoEntrega.entregado;
    notifyListeners();
    return true;
  }

  // ============================================
  // API - COMERCIAL
  // ============================================

  /// Carga cobros pendientes de un cliente
  Future<void> cargarCobrosPendientes(String codigoCliente) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await ApiClient.get('/cobros/$codigoCliente/pendientes');
      
      if (response['success'] == true) {
        _cobrosPendientes = (response['cobros'] as List<dynamic>?)
            ?.map((e) => CobroPendiente.fromJson(e))
            .toList() ?? [];
        
        if (response['resumen'] != null) {
          _resumenCobros = ResumenCobros.fromJson(response['resumen']);
        }
      }
    } catch (e) {
      _error = 'Error cargando cobros: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Verifica estado del cliente (moroso, bloqueado, etc)
  Future<void> verificarEstadoCliente(String codigoCliente) async {
    try {
      final response = await ApiClient.get('/cobros/$codigoCliente/estado');
      
      if (response['success'] == true && response['estadoCliente'] != null) {
        _estadoClienteActual = EstadoCliente.fromJson(response['estadoCliente']);
        notifyListeners();
      }
    } catch (e) {
      _estadoClienteActual = null;
    }
  }

  /// Registra un cobro
  Future<bool> registrarCobro({
    required String codigoCliente,
    required String referencia,
    required double importe,
    required String formaPago,
    String? observaciones,
  }) async {
    try {
      final response = await ApiClient.post('/cobros/$codigoCliente/registrar', {
        'referencia': referencia,
        'importe': importe,
        'formaPago': formaPago,
        'observaciones': observaciones,
      });

      if (response['success'] == true) {
        // Recargar cobros pendientes
        await cargarCobrosPendientes(codigoCliente);
        return true;
      }
      return false;
    } catch (e) {
      _error = 'Error registrando cobro: $e';
      return false;
    }
  }

  // ============================================
  // DATOS DE EJEMPLO (DESARROLLO)
  // ============================================

  void _cargarDatosEjemplo() {
    final now = DateTime.now();
    _albaranesPendientes = [
      Albaran(
        id: '2026-A-1001',
        numeroAlbaran: 1001,
        codigoCliente: '9900',
        nombreCliente: 'BAR EL RINCÓN',
        direccion: 'C/ Mayor, 15 - Madrid',
        fecha: now,
        importeTotal: 245.80,
        esCTR: true,
        items: [
          EntregaItem(
            itemId: '1001-1',
            codigoArticulo: 'COCA2L',
            descripcion: 'Coca-Cola 2L Pack 6',
            cantidadPedida: 5,
          ),
          EntregaItem(
            itemId: '1001-2',
            codigoArticulo: 'AGUA1L',
            descripcion: 'Agua Mineral 1.5L Pack 6',
            cantidadPedida: 10,
          ),
        ],
      ),
      Albaran(
        id: '2026-A-1002',
        numeroAlbaran: 1002,
        codigoCliente: '8801',
        nombreCliente: 'RESTAURANTE LA PLAZA',
        direccion: 'Plaza España, 3 - Madrid',
        fecha: now,
        importeTotal: 532.40,
        esCTR: false,
        items: [
          EntregaItem(
            itemId: '1002-1',
            codigoArticulo: 'CERV33',
            descripcion: 'Cerveza 33cl Caja 24',
            cantidadPedida: 8,
          ),
        ],
      ),
      Albaran(
        id: '2026-A-1003',
        numeroAlbaran: 1003,
        codigoCliente: '7755',
        nombreCliente: 'CAFETERÍA CENTRAL',
        direccion: 'Av. Libertad, 42 - Madrid',
        fecha: now,
        importeTotal: 128.50,
        estado: EstadoEntrega.enRuta,
        esCTR: true,
      ),
    ];
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
}
