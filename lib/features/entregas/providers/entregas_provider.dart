import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/api_config.dart';
import '../../../core/models/estado_entrega.dart';

export '../../../core/models/estado_entrega.dart';

// ── Models (kept from original) ──────────────────────────────────────────────

class EntregaItem {
  final String itemId;
  final String codigoArticulo;
  final String descripcion;
  final double cantidadPedida;
  final int bultos;
  final String? unit;
  final double precioUnitario;
  double cantidadEntregada;
  EstadoEntrega estado;
  String? observacion;

  EntregaItem({
    required this.itemId,
    required this.codigoArticulo,
    required this.descripcion,
    required this.cantidadPedida,
    this.bultos = 0,
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
      cantidadPedida:
          ((json['cantidadPedida'] ?? json['QTY'] ?? 0) as num).toDouble(),
      bultos: ((json['bultos'] ?? 0) as num).toInt(),
      unit: json['UNIT']?.toString() ?? json['unit']?.toString(),
      precioUnitario:
          ((json['precioUnitario'] ?? json['PRICE'] ?? 0) as num).toDouble(),
      cantidadEntregada:
          ((json['cantidadEntregada'] ?? 0) as num).toDouble(),
      estado: EstadoEntrega.fromString(
          (json['estado'] ?? 'PENDIENTE') as String),
      observacion: json['observacion'] as String?,
    );
  }

  bool get entregadoCompleto => cantidadEntregada >= cantidadPedida;
}

class IvaBreakdownItem {
  final double base;
  final double pct;
  final double iva;

  IvaBreakdownItem({required this.base, required this.pct, required this.iva});

  factory IvaBreakdownItem.fromJson(Map<String, dynamic> json) {
    return IvaBreakdownItem(
      base: ((json['base'] ?? 0) as num).toDouble(),
      pct: ((json['pct'] ?? 0) as num).toDouble(),
      iva: ((json['iva'] ?? 0) as num).toDouble(),
    );
  }
}

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
    this.telefono2 = '',
    this.emailCliente = '',
    required this.fecha,
    required this.importeTotal,
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
      id: json['id']?.toString() ?? '',
      numeroAlbaran:
          (json['numeroAlbaran'] ?? json['numero'] ?? 0) as int,
      ejercicio: (json['ejercicio'] ?? DateTime.now().year) as int,
      serie: json['serie']?.toString() ?? '',
      terminal: (json['terminal'] ?? 0) as int,
      numeroFactura: (json['numeroFactura'] ?? 0) as int,
      serieFactura: json['serieFactura']?.toString() ?? '',
      codigoCliente: json['codigoCliente']?.toString() ?? '',
      nombreCliente: json['nombreCliente']?.toString() ?? 'Cliente',
      direccion: json['direccion']?.toString() ?? '',
      poblacion: json['poblacion']?.toString() ?? '',
      telefono: json['telefono']?.toString() ?? '',
      telefono2: json['telefono2']?.toString() ?? '',
      emailCliente:
          json['emailCliente']?.toString() ?? json['email']?.toString() ?? '',
      fecha: json['fecha']?.toString() ?? '',
      importeTotal:
          ((json['importe'] ?? json['importeTotal'] ?? 0) as num).toDouble(),
      importeBruto: ((json['importeBruto'] ?? 0) as num).toDouble(),
      importeNeto: ((json['netoSum'] ?? 0) as num).toDouble(),
      importeIva: ((json['ivaSum'] ?? 0) as num).toDouble(),
      ivaBreakdown: (json['ivaBreakdown'] as List<dynamic>?)
              ?.map((e) =>
                  IvaBreakdownItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      checksum: json['checksum']?.toString(),
      formaPago: json['formaPago']?.toString() ?? '',
      formaPagoDesc: json['formaPagoDesc']?.toString() ?? '',
      tipoPago: json['tipoPago']?.toString() ?? '',
      diasPago: (json['diasPago'] ?? 0) as int,
      esCTR: json['esCTR'] == true,
      puedeCobrarse: json['puedeCobrarse'] == true,
      colorEstado: json['colorEstado']?.toString() ?? 'green',
      ruta: json['ruta']?.toString() ?? '',
      codigoVendedor: json['codigoVendedor']?.toString() ?? '',
      nombreVendedor: json['nombreVendedor']?.toString() ?? '',
      codigoRepartidor: json['codigoRepartidor']?.toString() ?? '',
      nombreRepartidor: json['nombreRepartidor']?.toString() ?? '',
      ordenPreparacion: json['ordenPreparacion'] as int?,
      discrepancy: json['discrepancy'] == true,
      lineSum: ((json['lineSum'] ?? 0) as num).toDouble(),
      estado: EstadoEntrega.fromString(
          (json['estado'] ?? 'PENDIENTE') as String),
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
  double get progreso =>
      totalItems > 0 ? itemsEntregados / totalItems : 0;
  bool get requiereCobro => esCTR && estado != EstadoEntrega.entregado;
}

// ── Riverpod State ────────────────────────────────────────────────────────────

class EntregasState {
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
    this.resumenCompletedCount = 0,
  }) : fechaSeleccionada = fechaSeleccionada ?? DateTime.now();

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
    int? resumenCompletedCount,
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
      resumenTotalOpcional:
          resumenTotalOpcional ?? this.resumenTotalOpcional,
      resumenCompletedCount:
          resumenCompletedCount ?? this.resumenCompletedCount,
    );
  }

  static const _sentinel = Object();

  List<AlbaranEntrega> get albaranesPendientes =>
      albaranes.where((a) => a.estado == EstadoEntrega.pendiente).toList();

  List<AlbaranEntrega> get albaranesEnRuta =>
      albaranes.where((a) => a.estado == EstadoEntrega.enRuta).toList();

  List<AlbaranEntrega> get albaranesEntregados => albaranes
      .where((a) => a.estado == EstadoEntrega.entregado ||
          a.estado == EstadoEntrega.parcial)
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
  @override
  EntregasState build() => EntregasState();

  void setRepartidor(String repartidorId,
      {bool autoReload = true, bool forceReload = false}) {
    final wasChanged = state.repartidorId != repartidorId;
    if (autoReload && (wasChanged || forceReload)) {
      state = state.copyWith(repartidorId: repartidorId);
      cargarAlbaranesPendientes();
    } else {
      state = state.copyWith(repartidorId: repartidorId);
    }
  }

  void seleccionarFecha(DateTime fecha) {
    state = state.copyWith(fechaSeleccionada: fecha);
    cargarAlbaranesPendientes();
  }

  void setSearchQuery(String query) {
    state = state.copyWith(searchQuery: query);
    cargarAlbaranesPendientes();
  }

  void setSearchClient(String query) {
    state = state.copyWith(searchClient: query);
    cargarAlbaranesPendientes();
  }

  void setSearchAlbaran(String query) {
    state = state.copyWith(searchAlbaran: query);
    cargarAlbaranesPendientes();
  }

  void setSortBy(String sort) {
    state = state.copyWith(sortBy: sort);
    cargarAlbaranesPendientes();
  }

  void setFilterTipoPago(String tipo) {
    state = state.copyWith(filterTipoPago: tipo);
    cargarAlbaranesPendientes();
  }

  void setFilterDebeCobrar(String debeCobrar) {
    state = state.copyWith(filterDebeCobrar: debeCobrar);
    cargarAlbaranesPendientes();
  }

  void setFilterDocTipo(String docTipo) {
    state = state.copyWith(filterDocTipo: docTipo);
    cargarAlbaranesPendientes();
  }

  Future<void> cargarAlbaranesPendientes() async {
    if (state.repartidorId.isEmpty) return;

    state = state.copyWith(isLoading: true, error: null);

    try {
      final formattedDate =
          '${state.fechaSeleccionada.year}-${state.fechaSeleccionada.month.toString().padLeft(2, '0')}-${state.fechaSeleccionada.day.toString().padLeft(2, '0')}';

      String url =
          '/entregas/pendientes/${state.repartidorId}?date=$formattedDate';

      if (state.searchQuery.isNotEmpty) {
        url += '&search=${Uri.encodeComponent(state.searchQuery)}';
      }
      if (state.searchClient.isNotEmpty) {
        url += '&searchClient=${Uri.encodeComponent(state.searchClient)}';
      }
      if (state.searchAlbaran.isNotEmpty) {
        url += '&searchAlbaran=${Uri.encodeComponent(state.searchAlbaran)}';
      }
      if (state.sortBy != 'default') {
        url += '&sortBy=${state.sortBy}';
      }
      if (state.filterTipoPago.isNotEmpty) {
        url += '&tipoPago=${state.filterTipoPago}';
      }
      if (state.filterDebeCobrar.isNotEmpty) {
        url += '&debeCobrar=${state.filterDebeCobrar}';
      }
      if (state.filterDocTipo.isNotEmpty) {
        url += '&docTipo=${state.filterDocTipo}';
      }

      final response = await ApiClient.get(url);

      if (response['success'] == true) {
        final lista = response['albaranes'] as List<dynamic>? ?? [];
        final albaranes = lista
            .map((e) => AlbaranEntrega.fromJson(e as Map<String, dynamic>))
            .toList();

        final resumen = response['resumen'] as Map<String, dynamic>? ?? {};
        state = state.copyWith(
          albaranes: albaranes,
          isLoading: false,
          resumenTotalBruto:
              ((resumen['totalBruto'] ?? 0) as num).toDouble(),
          resumenTotalACobrar:
              ((resumen['totalACobrar'] ?? 0) as num).toDouble(),
          resumenTotalOpcional:
              ((resumen['totalOpcional'] ?? 0) as num).toDouble(),
          resumenCompletedCount: (resumen['completedCount'] ?? 0) as int,
        );
      } else {
        state = state.copyWith(
          isLoading: false,
          error: (response['error'] ?? 'Error cargando entregas') as String,
        );
      }
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: 'Error de conexión: $e',
      );
    }
  }

  Future<AlbaranEntrega?> obtenerDetalleAlbaran(
      int numero, int ejercicio, String serie, int terminal) async {
    try {
      final response = await ApiClient.get(
        '/entregas/albaran/$numero/$ejercicio?serie=$serie&terminal=$terminal',
      );

      if (response['success'] == true && response['albaran'] != null) {
        final albaran =
            AlbaranEntrega.fromJson(response['albaran'] as Map<String, dynamic>);
        state = state.copyWith(albaranSeleccionado: albaran);
        return albaran;
      }
    } catch (e) {
      state = state.copyWith(error: 'Error obteniendo detalle: $e');
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
    String? firmaPath;

    if (firma != null) {
      try {
        final res = await ApiClient.post('/entregas/uploads/signature', {
          'entregaId': albaranId,
          'firma': firma,
          'clientCode': clientCode,
          'dni': dni,
          'nombre': nombre,
        });
        if (res['success'] == true) {
          firmaPath = res['path'] as String?;
        }
      } catch (e) {
        debugPrint('Error uploading signature: $e');
      }
    }

    return await _actualizarEstado(
      itemId: albaranId,
      estado: EstadoEntrega.entregado,
      observaciones: observaciones,
      firma: firmaPath,
      fotos: fotos,
      latitud: latitud,
      longitud: longitud,
    );
  }

  Future<Map<String, dynamic>?> generateReceipt({
    required AlbaranEntrega albaran,
  }) async {
    try {
      final response = await ApiClient.post('/entregas/receipt/${albaran.id}', {
        'signaturePath': albaran.firma,
        'items': albaran.items
            .map((i) => {
                  'cantidad': i.cantidadPedida,
                  'descripcion': i.descripcion,
                  'precio': i.precioUnitario,
                })
            .toList(),
        'clientCode': albaran.codigoCliente,
        'clientName': albaran.nombreCliente,
        'albaranNum': albaran.numeroAlbaran,
        'facturaNum':
            albaran.numeroFactura > 0 ? albaran.numeroFactura : null,
        'fecha': albaran.fecha,
        'subtotal': albaran.importeNeto > 0
            ? albaran.importeNeto
            : albaran.importeTotal,
        'iva': albaran.importeIva,
        'total': albaran.importeTotal,
        'formaPago': albaran.formaPagoDesc,
        'repartidor': albaran.nombreRepartidor.isNotEmpty
            ? albaran.nombreRepartidor
            : albaran.codigoRepartidor,
      });
      if (response['success'] == true) return response;
      return null;
    } catch (e) {
      return null;
    }
  }

  Future<bool> sendReceiptByEmail({
    required AlbaranEntrega albaran,
    required String email,
  }) async {
    try {
      final response =
          await ApiClient.post('/entregas/receipt/${albaran.id}/email', {
        'email': email,
        'signaturePath': albaran.firma,
        'items': albaran.items
            .map((i) => {
                  'cantidad': i.cantidadPedida,
                  'descripcion': i.descripcion,
                  'precio': i.precioUnitario,
                })
            .toList(),
        'clientCode': albaran.codigoCliente,
        'clientName': albaran.nombreCliente,
        'albaranNum': albaran.numeroAlbaran,
        'facturaNum':
            albaran.numeroFactura > 0 ? albaran.numeroFactura : null,
        'fecha': albaran.fecha,
        'subtotal': albaran.importeNeto > 0
            ? albaran.importeNeto
            : albaran.importeTotal,
        'iva': albaran.importeIva,
        'total': albaran.importeTotal,
        'formaPago': albaran.formaPagoDesc,
        'repartidor': albaran.nombreRepartidor.isNotEmpty
            ? albaran.nombreRepartidor
            : albaran.codigoRepartidor,
      });
      return response['success'] == true;
    } catch (e) {
      return false;
    }
  }

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
      final response = await ApiClient.post(
        '/entregas/update',
        {
          'itemId': itemId,
          'status': estado.value,
          'repartidorId': state.repartidorId,
          'observaciones': observaciones,
          'firma': firma,
          'fotos': fotos,
          'latitud': latitud,
          'longitud': longitud,
          'forceUpdate': forceUpdate,
        },
      );

      if (response['success'] == true) {
        final idx = state.albaranes.indexWhere((a) => a.id == itemId);
        if (idx != -1) {
          final updated = List<AlbaranEntrega>.from(state.albaranes);
          final albaran = updated[idx];
          albaran.estado = estado;
          albaran.observaciones = observaciones;
          albaran.horaEntrega = DateTime.now();
          if (firma != null) albaran.firma = firma;
          if (fotos != null) albaran.fotos = fotos;
          state = state.copyWith(albaranes: updated);
        }
        return true;
      } else if (response['alreadyDelivered'] == true) {
        state = state.copyWith(
            error: 'Esta entrega ya fue confirmada anteriormente');
        return false;
      } else {
        state = state.copyWith(
            error: (response['error'] ?? 'Error desconocido') as String);
        return false;
      }
    } catch (e) {
      state = state.copyWith(error: 'Error actualizando: $e');
    }
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
