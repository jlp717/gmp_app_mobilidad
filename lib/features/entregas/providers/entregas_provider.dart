import 'package:flutter/material.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_config.dart';

/// Estados posibles de una entrega
enum EstadoEntrega {
  pendiente,
  enRuta,
  entregado,
  parcial,
  noEntregado,
  rechazado,
}

extension EstadoEntregaExtension on EstadoEntrega {
  String get value {
    switch (this) {
      case EstadoEntrega.pendiente:
        return 'PENDIENTE';
      case EstadoEntrega.enRuta:
        return 'EN_RUTA';
      case EstadoEntrega.entregado:
        return 'ENTREGADO';
      case EstadoEntrega.parcial:
        return 'PARCIAL';
      case EstadoEntrega.noEntregado:
        return 'NO_ENTREGADO';
      case EstadoEntrega.rechazado:
        return 'RECHAZADO';
    }
  }

  String get label {
    switch (this) {
      case EstadoEntrega.pendiente:
        return 'Pendiente';
      case EstadoEntrega.enRuta:
        return 'En Ruta';
      case EstadoEntrega.entregado:
        return 'Entregado';
      case EstadoEntrega.parcial:
        return 'Parcial';
      case EstadoEntrega.noEntregado:
        return 'No Entregado';
      case EstadoEntrega.rechazado:
        return 'Rechazado';
    }
  }

  Color get color {
    switch (this) {
      case EstadoEntrega.pendiente:
        return Colors.orange;
      case EstadoEntrega.enRuta:
        return Colors.blue;
      case EstadoEntrega.entregado:
        return Colors.green;
      case EstadoEntrega.parcial:
        return Colors.amber;
      case EstadoEntrega.noEntregado:
        return Colors.red;
      case EstadoEntrega.rechazado:
        return Colors.red.shade900;
    }
  }

  IconData get icon {
    switch (this) {
      case EstadoEntrega.pendiente:
        return Icons.schedule;
      case EstadoEntrega.enRuta:
        return Icons.local_shipping;
      case EstadoEntrega.entregado:
        return Icons.check_circle;
      case EstadoEntrega.parcial:
        return Icons.pie_chart;
      case EstadoEntrega.noEntregado:
        return Icons.cancel;
      case EstadoEntrega.rechazado:
        return Icons.block;
    }
  }

  static EstadoEntrega fromString(String value) {
    switch (value.toUpperCase()) {
      case 'PENDIENTE':
        return EstadoEntrega.pendiente;
      case 'EN_RUTA':
        return EstadoEntrega.enRuta;
      case 'ENTREGADO':
        return EstadoEntrega.entregado;
      case 'PARCIAL':
        return EstadoEntrega.parcial;
      case 'NO_ENTREGADO':
        return EstadoEntrega.noEntregado;
      case 'RECHAZADO':
        return EstadoEntrega.rechazado;
      default:
        return EstadoEntrega.pendiente;
    }
  }
}

/// Item de un albarán (línea de producto)
class EntregaItem {
  final String itemId;
  final String codigoArticulo;
  final String descripcion;
  final double cantidadPedida;
  final String? unit;
  final double precioUnitario;
  double cantidadEntregada;
  EstadoEntrega estado;
  String? observacion; // New field for row observation

  EntregaItem({
    required this.itemId,
    required this.codigoArticulo,
    required this.descripcion,
    required this.cantidadPedida,
    this.unit,
    this.precioUnitario = 0,
    this.cantidadEntregada = 0,
    this.estado = EstadoEntrega.pendiente,
    this.observacion,
  });

  factory EntregaItem.fromJson(Map<String, dynamic> json) {
    return EntregaItem(
      itemId: json['itemId']?.toString() ?? '',
      codigoArticulo: json['codigoArticulo']?.toString() ?? '',
      descripcion: json['descripcion']?.toString() ?? '',
      cantidadPedida: (json['cantidadPedida'] ?? json['QTY'] ?? 0).toDouble(),
      unit: json['UNIT']?.toString() ?? json['unit']?.toString(), // Handle both cases
      precioUnitario: (json['precioUnitario'] ?? json['PRICE'] ?? 0).toDouble(),
      cantidadEntregada: (json['cantidadEntregada'] ?? 0).toDouble(),
      estado: EstadoEntregaExtension.fromString(json['estado'] ?? 'PENDIENTE'),
      observacion: json['observacion'],
    );
  }

  bool get entregadoCompleto => cantidadEntregada >= cantidadPedida;
}

/// Albarán completo para entrega
class AlbaranEntrega {
  final String id;
  final int numeroAlbaran;
  final int ejercicio;
  final String serie;
  final int terminal;
  final int numeroFactura;
  final String serieFactura;
  final String codigoCliente;
  final String nombreCliente;
  final String direccion;
  final String poblacion;
  final String telefono;
  final String fecha;
  final double importeTotal;
  final String formaPago;
  final String formaPagoDesc;  // e.g., "CRÉDITO", "CONTADO"
  final String tipoPago;       // e.g., "CREDITO", "CONTADO", "REPOSICION"
  final int diasPago;          // 0, 7, 30, 60, etc.
  final bool esCTR;            // MUST collect
  final bool puedeCobrarse;    // CAN optionally collect
  final String colorEstado;    // "red", "green", "orange"
  final String ruta;
  final String codigoVendedor;
  final String nombreVendedor;
  final String codigoRepartidor; // Para Jefe de Ventas
  EstadoEntrega estado;
  List<EntregaItem> items;
  String? observaciones;
  List<String> fotos;
  String? firma;
  DateTime? horaEntrega;

  AlbaranEntrega({
    required this.id,
    required this.numeroAlbaran,
    required this.ejercicio,
    this.serie = '',
    this.terminal = 0,
    this.numeroFactura = 0,
    this.serieFactura = '',
    required this.codigoCliente,
    required this.nombreCliente,
    this.direccion = '',
    this.poblacion = '',
    this.telefono = '',
    required this.fecha,
    required this.importeTotal,
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
    this.estado = EstadoEntrega.pendiente,
    this.items = const [],
    this.observaciones,
    this.fotos = const [],
    this.firma,
    this.horaEntrega,
  });


  factory AlbaranEntrega.fromJson(Map<String, dynamic> json) {
    return AlbaranEntrega(
      id: json['id']?.toString() ?? '',
      numeroAlbaran: json['numeroAlbaran'] ?? json['numero'] ?? 0,
      ejercicio: json['ejercicio'] ?? DateTime.now().year,
      serie: json['serie']?.toString() ?? '',
      terminal: json['terminal'] ?? 0,
      numeroFactura: json['numeroFactura'] ?? 0,
      serieFactura: json['serieFactura']?.toString() ?? '',
      codigoCliente: json['codigoCliente']?.toString() ?? '',
      nombreCliente: json['nombreCliente']?.toString() ?? 'Cliente',
      direccion: json['direccion']?.toString() ?? '',
      poblacion: json['poblacion']?.toString() ?? '',
      telefono: json['telefono']?.toString() ?? '',
      fecha: json['fecha']?.toString() ?? '',
      importeTotal: (json['importe'] ?? json['importeTotal'] ?? 0).toDouble(),
      formaPago: json['formaPago']?.toString() ?? '',
      formaPagoDesc: json['formaPagoDesc']?.toString() ?? '',
      tipoPago: json['tipoPago']?.toString() ?? '',
      diasPago: json['diasPago'] ?? 0,
      esCTR: json['esCTR'] == true,
      puedeCobrarse: json['puedeCobrarse'] == true,
      colorEstado: json['colorEstado']?.toString() ?? 'green',
      ruta: json['ruta']?.toString() ?? '',
      codigoVendedor: json['codigoVendedor']?.toString() ?? '',
      nombreVendedor: json['nombreVendedor']?.toString() ?? '',
      codigoRepartidor: json['codigoRepartidor']?.toString() ?? '',
      estado: EstadoEntregaExtension.fromString(json['estado'] ?? 'PENDIENTE'),
      items: (json['items'] as List<dynamic>?)
              ?.map((e) => EntregaItem.fromJson(e))
              .toList() ??
          [],
      observaciones: json['observaciones'],
      fotos: (json['fotos'] as List<dynamic>?)?.cast<String>() ?? [],
      firma: json['firma'],
    );
  }

  int get totalItems => items.length;
  int get itemsEntregados =>
      items.where((i) => i.estado == EstadoEntrega.entregado).length;
  double get progreso =>
      totalItems > 0 ? itemsEntregados / totalItems : 0;
  bool get requiereCobro => esCTR && estado != EstadoEntrega.entregado;
}

/// Provider de entregas para repartidor
class EntregasProvider extends ChangeNotifier {

  
  List<AlbaranEntrega> _albaranes = [];
  AlbaranEntrega? _albaranSeleccionado;
  bool _isLoading = false;
  String? _error;
  String _repartidorId = '';
  DateTime _fechaSeleccionada = DateTime.now();

  // Getters
  List<AlbaranEntrega> get albaranes => _albaranes;
  AlbaranEntrega? get albaranSeleccionado => _albaranSeleccionado;
  bool get isLoading => _isLoading;
  String? get error => _error;
  DateTime get fechaSeleccionada => _fechaSeleccionada;
  
  List<AlbaranEntrega> get albaranesPendientes =>
      _albaranes.where((a) => a.estado == EstadoEntrega.pendiente).toList();
  
  List<AlbaranEntrega> get albaranesEnRuta =>
      _albaranes.where((a) => a.estado == EstadoEntrega.enRuta).toList();
  
  List<AlbaranEntrega> get albaranesEntregados =>
      _albaranes.where((a) => a.estado == EstadoEntrega.entregado || 
                              a.estado == EstadoEntrega.parcial).toList();

  int get totalPendientes => albaranesPendientes.length;
  int get totalEntregados => albaranesEntregados.length;
  double get progresoTotal => 
      _albaranes.isNotEmpty ? totalEntregados / _albaranes.length : 0;

  double get importeTotalCTR => _albaranes
      .where((a) => a.esCTR && a.estado != EstadoEntrega.entregado)
      .fold(0, (sum, a) => sum + a.importeTotal);

  // Search and sort state
  String _searchQuery = '';
  String _sortBy = 'default'; // 'default', 'importe_desc', 'importe_asc'
  String _filterTipoPago = ''; // 'CONTADO', 'CREDITO', 'DOMICILIADO', etc.
  String _filterDebeCobrar = ''; // 'S' or 'N'
  String _filterDocTipo = ''; // 'ALBARAN' or 'FACTURA'
  
  // Resumen totals from API
  double _resumenTotalBruto = 0;
  double _resumenTotalACobrar = 0;
  double _resumenTotalOpcional = 0;
  int _resumenCompletedCount = 0;

  String get searchQuery => _searchQuery;
  String get sortBy => _sortBy;
  String get filterTipoPago => _filterTipoPago;
  String get filterDebeCobrar => _filterDebeCobrar;
  String get filterDocTipo => _filterDocTipo;
  double get resumenTotalBruto => _resumenTotalBruto;
  double get resumenTotalACobrar => _resumenTotalACobrar;
  double get resumenTotalOpcional => _resumenTotalOpcional;
  int get resumenCompletedCount => _resumenCompletedCount;
  
  void setSearchQuery(String query) {
    _searchQuery = query;
    cargarAlbaranesPendientes();
  }

  void setSortBy(String sort) {
    _sortBy = sort;
    cargarAlbaranesPendientes();
  }

  void setFilterTipoPago(String tipo) {
    _filterTipoPago = tipo;
    cargarAlbaranesPendientes();
  }

  void setFilterDebeCobrar(String debeCobrar) {
    _filterDebeCobrar = debeCobrar;
    cargarAlbaranesPendientes();
  }

  void setFilterDocTipo(String docTipo) {
    _filterDocTipo = docTipo;
    cargarAlbaranesPendientes();
  }

  /// Inicializar con ID del repartidor
  void setRepartidor(String repartidorId, {bool autoReload = true, bool forceReload = false}) {
    final wasChanged = _repartidorId != repartidorId;
    _repartidorId = repartidorId;
    print('[ENTREGAS_PROVIDER] setRepartidor: $repartidorId (changed: $wasChanged, autoReload: $autoReload, force: $forceReload)');
    if (autoReload && (wasChanged || forceReload)) {
      cargarAlbaranesPendientes();
    }
  }

  /// Cambiar fecha seleccionada
  void seleccionarFecha(DateTime fecha) {
    _fechaSeleccionada = fecha;
    cargarAlbaranesPendientes();
  }

  /// Cargar albaranes pendientes del día
  Future<void> cargarAlbaranesPendientes() async {
    if (_repartidorId.isEmpty) return;

    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final formattedDate = '${_fechaSeleccionada.year}-${_fechaSeleccionada.month.toString().padLeft(2, '0')}-${_fechaSeleccionada.day.toString().padLeft(2, '0')}';
      
      // Build URL with search, sort, and filter parameters
      String url = '/entregas/pendientes/$_repartidorId?date=$formattedDate';
      if (_searchQuery.isNotEmpty) {
        url += '&search=${Uri.encodeComponent(_searchQuery)}';
      }
      if (_sortBy != 'default') {
        url += '&sortBy=$_sortBy';
      }
      if (_filterTipoPago.isNotEmpty) {
        url += '&tipoPago=$_filterTipoPago';
      }
      if (_filterDebeCobrar.isNotEmpty) {
        url += '&debeCobrar=$_filterDebeCobrar';
      }
      if (_filterDocTipo.isNotEmpty) {
        url += '&docTipo=$_filterDocTipo';
      }
      
      final response = await ApiClient.get(url);

      if (response['success'] == true) {
        final lista = response['albaranes'] as List<dynamic>? ?? [];
        _albaranes = lista.map((e) => AlbaranEntrega.fromJson(e)).toList();
        
        // Parse resumen totals
        final resumen = response['resumen'] as Map<String, dynamic>? ?? {};
        _resumenTotalBruto = (resumen['totalBruto'] ?? 0).toDouble();
        _resumenTotalACobrar = (resumen['totalACobrar'] ?? 0).toDouble();
        _resumenTotalOpcional = (resumen['totalOpcional'] ?? 0).toDouble();
        _resumenCompletedCount = (resumen['completedCount'] ?? 0) as int;
        
        print('[ENTREGAS_PROVIDER] Loaded ${_albaranes.length} albaranes for $_fechaSeleccionada, completed=$_resumenCompletedCount');
      } else {
        _error = response['error'] ?? 'Error cargando entregas';
      }
    } catch (e) {
      _error = 'Error de conexión: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Convenience method to get items directly
  Future<List<EntregaItem>> getAlbaranDetalle(int numero, int ejercicio, String serie, int terminal) async {
    print('[ENTREGAS_PROVIDER] getAlbaranDetalle($numero, $ejercicio, $serie, $terminal)');
    try {
      final detalle = await obtenerDetalleAlbaran(numero, ejercicio, serie, terminal);
      if (detalle == null) {
        print('[ENTREGAS_PROVIDER] getAlbaranDetalle returned null');
        return [];
      }
      print('[ENTREGAS_PROVIDER] getAlbaranDetalle returned ${detalle.items.length} items');
      return detalle.items;
    } catch (e) {
      print('[ENTREGAS_PROVIDER] getAlbaranDetalle error: $e');
      return [];
    }
  }

  Future<AlbaranEntrega?> obtenerDetalleAlbaran(int numero, int ejercicio, String serie, int terminal) async {
    try {
      print('[ENTREGAS_PROVIDER] Fetching albaran detail: $numero/$ejercicio?serie=$serie&terminal=$terminal');
      // FIX: ApiConfig.baseUrl ya incluye /api, no duplicar
      final response = await ApiClient.get(
        '/entregas/albaran/$numero/$ejercicio?serie=$serie&terminal=$terminal',
      );

      print('[ENTREGAS_PROVIDER] Albaran detail response: success=${response['success']}');
      
      if (response['success'] == true && response['albaran'] != null) {
        _albaranSeleccionado = AlbaranEntrega.fromJson(response['albaran']);
        print('[ENTREGAS_PROVIDER] Parsed albaran with ${_albaranSeleccionado?.items.length ?? 0} items');
        notifyListeners();
        return _albaranSeleccionado;
      } else {
        print('[ENTREGAS_PROVIDER] Albaran detail failed: ${response['error']}');
      }
    } catch (e) {
      print('[ENTREGAS_PROVIDER] obtenerDetalleAlbaran error: $e');
      _error = 'Error obteniendo detalle: $e';
      notifyListeners();
    }
    return null;
  }

  /// Marcar albarán como entregado
  Future<bool> marcarEntregado({
    required String albaranId,
    String? observaciones,
    String? firma, // base64
    List<String>? fotos,
    double? latitud,
    double? longitud,
    // Signer info
    String? clientCode,
    String? dni,
    String? nombre,
  }) async {
    String? firmaPath;
    
    // 1. Upload signature if exists
    if (firma != null) {
      try {
        print('[ENTREGAS_PROVIDER] Uploading signature...');
        final res = await ApiClient.post('/entregas/uploads/signature', {
           'entregaId': albaranId,
           'firma': firma,
           'clientCode': clientCode,
           'dni': dni,
           'nombre': nombre,
        });
        if (res['success'] == true) {
           firmaPath = res['path'];
           print('[ENTREGAS_PROVIDER] Signature saved: $firmaPath');
        }
      } catch (e) {
        print('[ENTREGAS_PROVIDER] Error uploading signature: $e');
        // Continue? Or fail? Let's continue but log it.
        // Actually if signature fails, we should probably warn, but for now continue.
      }
    }

    // 2. Update status
    return await _actualizarEstado(
      itemId: albaranId,
      estado: EstadoEntrega.entregado,
      observaciones: observaciones,
      firma: firmaPath, // Send path, not base64
      fotos: fotos,
      latitud: latitud,
      longitud: longitud,
    );
  }

  /// Marcar albarán como parcial
  Future<bool> marcarParcial({
    required String albaranId,
    required String observaciones,
    String? firma,
    List<String>? fotos,
  }) async {
    return await _actualizarEstado(
      itemId: albaranId,
      estado: EstadoEntrega.parcial,
      observaciones: observaciones,
      firma: firma,
      fotos: fotos,
    );
  }

  /// Marcar albarán como no entregado
  Future<bool> marcarNoEntregado({
    required String albaranId,
    required String observaciones,
    List<String>? fotos,
  }) async {
    return await _actualizarEstado(
      itemId: albaranId,
      estado: EstadoEntrega.noEntregado,
      observaciones: observaciones,
      fotos: fotos,
    );
  }

  /// Actualizar estado interno
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
    try {
      // FIX: ApiConfig.baseUrl ya incluye /api, no duplicar
      final response = await ApiClient.post(
        '/entregas/update',
        {
          'itemId': itemId,
          'status': estado.value,
          'repartidorId': _repartidorId,
          'observaciones': observaciones,
          'firma': firma,
          'fotos': fotos,
          'latitud': latitud,
          'longitud': longitud,
          'forceUpdate': forceUpdate,
        },
      );

      if (response['success'] == true) {
        // Actualizar estado local
        final idx = _albaranes.indexWhere((a) => a.id == itemId);
        if (idx != -1) {
          _albaranes[idx].estado = estado;
          _albaranes[idx].observaciones = observaciones;
          _albaranes[idx].horaEntrega = DateTime.now();
          if (firma != null) _albaranes[idx].firma = firma;
          if (fotos != null) _albaranes[idx].fotos = fotos;
        }
        notifyListeners();
        return true;
      } else if (response['alreadyDelivered'] == true) {
        // 409 Conflict - already delivered
        _error = 'Esta entrega ya fue confirmada anteriormente';
        notifyListeners();
        return false;
      } else {
        _error = response['error'] ?? 'Error desconocido';
        notifyListeners();
        return false;
      }
    } catch (e) {
      _error = 'Error actualizando: $e';
      notifyListeners();
    }
    return false;
  }

  /// Limpiar selección
  void limpiarSeleccion() {
    _albaranSeleccionado = null;
    notifyListeners();
  }
}
