import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/models/estado_entrega.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_sync_notifier.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_receipt_contract.dart';

export '../../../core/models/estado_entrega.dart';

const _deliveryLoadFailureMessage =
    'No se pudieron cargar las entregas. Intentalo de nuevo.';

bool _selectedOwnerContains(String selection, String owner) {
  final target = owner.trim().toUpperCase();
  if (target.isEmpty) return false;
  return selection.split(',').any((candidate) {
    final normalized = candidate.trim().toUpperCase();
    if (normalized == target) return true;
    final candidateNumber = int.tryParse(normalized);
    final targetNumber = int.tryParse(target);
    return candidateNumber != null &&
        targetNumber != null &&
        candidateNumber == targetNumber;
  });
}

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

double? _optionalNullableDouble(Map<String, dynamic> json, List<String> keys) {
  for (final key in keys) {
    if (!json.containsKey(key) || json[key] == null) continue;
    return _requiredDoubleAlias(json, <String>[key]);
  }
  return null;
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
  final iso =
      RegExp(r'^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$').firstMatch(value);
  if (iso != null) {
    final year = int.parse(iso.group(1)!);
    final month = int.parse(iso.group(2)!);
    final day = int.parse(iso.group(3)!);
    final parsed = DateTime(year, month, day);
    if (parsed.year == year && parsed.month == month && parsed.day == day) {
      return '${year.toString().padLeft(4, '0')}-'
          '${month.toString().padLeft(2, '0')}-'
          '${day.toString().padLeft(2, '0')}';
    }
  }
  final slash = RegExp(r'^(\d{1,2})/(\d{1,2})/(\d{4})$').firstMatch(value);
  if (slash != null) {
    final day = int.parse(slash.group(1)!);
    final month = int.parse(slash.group(2)!);
    final year = int.parse(slash.group(3)!);
    final parsed = DateTime(year, month, day);
    if (parsed.year == year && parsed.month == month && parsed.day == day) {
      return '${year.toString().padLeft(4, '0')}-'
          '${month.toString().padLeft(2, '0')}-'
          '${day.toString().padLeft(2, '0')}';
    }
  }
  throw const EntregasPayloadException('fecha');
}

String _documentDate(Map<String, dynamic> json) {
  try {
    return _requiredDate(json);
  } catch (_) {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
  }
}

String _lineArticleCode(Map<String, dynamic> json) {
  try {
    return _requiredText(json, 'codigoArticulo');
  } catch (_) {
    return _requiredText(json, 'itemId');
  }
}

List<IvaBreakdownItem> _parseIvaBreakdown(Object? raw) {
  if (raw is! List) return const [];
  final items = <IvaBreakdownItem>[];
  for (final entry in raw) {
    if (entry is! Map) continue;
    try {
      items.add(IvaBreakdownItem.fromJson(Map<String, dynamic>.from(entry)));
    } catch (_) {
      continue;
    }
  }
  return items;
}

List<EntregaItem> _parseEntregaItems(Object? raw) {
  if (raw is! List) return const [];
  final items = <EntregaItem>[];
  for (final entry in raw) {
    if (entry is! Map) continue;
    try {
      items.add(EntregaItem.fromJson(Map<String, dynamic>.from(entry)));
    } catch (_) {
      continue;
    }
  }
  return items;
}

String _safeDeliveryError(Object error, {required bool detail}) {
  if (error is EntregasPayloadException) {
    return detail
        ? 'El detalle recibido no cumple el contrato de reparto.'
        : 'Los datos de entregas recibidos no son válidos.';
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
      codigoArticulo: _lineArticleCode(json),
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
      estado: EstadoEntrega.fromString('${json['estado'] ?? 'PENDIENTE'}'),
      observacion: json['observacion']?.toString(),
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
    required this.fecha,
    required this.importeTotal,
    this.nombreComercial,
    this.nombreFiscal,
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
    this.latitud,
    this.longitud,
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
    this.pricingState = 'READY',
    this.amountSource = 'CPC_IMPORTETOTAL',
    this.estado = EstadoEntrega.pendiente,
    this.items = const [],
    this.observaciones,
    this.fotos = const [],
    this.firma,
    this.horaEntrega,
    this.horaPrevista,
    this.confirmationId,
    this.cobroId,
    this.cobrado = false,
    this.importeCobrado,
    this.importePendienteCobro,
    this.importeDisponibleCobro,
    this.formaPagoCobro,
    this.cobroParcial = false,
  });

  factory AlbaranEntrega.fromJson(Map<String, dynamic> json) {
    final codigoCliente = _requiredText(json, 'codigoCliente');
    final nombreRaw = json['nombreCliente']?.toString().trim() ?? '';
    return AlbaranEntrega(
      id: _requiredText(json, 'id'),
      numeroAlbaran:
          _requiredIntAlias(json, const <String>['numeroAlbaran', 'numero']),
      ejercicio: _requiredIntAlias(json, const <String>['ejercicio']),
      serie: json['serie']?.toString() ?? '',
      terminal: _optionalIntAlias(json, const <String>['terminal']),
      numeroFactura: _optionalIntAlias(json, const <String>['numeroFactura']),
      serieFactura: json['serieFactura']?.toString() ?? '',
      codigoCliente: codigoCliente,
      nombreCliente: nombreRaw.isNotEmpty ? nombreRaw : codigoCliente,
      nombreComercial: json['nombreComercial']?.toString(),
      nombreFiscal: json['nombreFiscal']?.toString(),
      direccion: json['direccion']?.toString() ?? '',
      poblacion: json['poblacion']?.toString() ?? '',
      telefono: json['telefono']?.toString() ?? '',
      telefono2: json['telefono2']?.toString() ?? '',
      latitud: _optionalNullableDouble(
          json, const <String>['latitud', 'lat', 'latitude']),
      longitud: _optionalNullableDouble(
          json, const <String>['longitud', 'lng', 'longitude']),
      emailCliente:
          json['emailCliente']?.toString() ?? json['email']?.toString() ?? '',
      fecha: _documentDate(json),
      importeTotal:
          _requiredDoubleAlias(json, const <String>['importe', 'importeTotal']),
      importeBruto: _optionalDoubleAlias(json, const <String>['importeBruto']),
      importeNeto: _optionalDoubleAlias(json, const <String>['netoSum']),
      importeIva: _optionalDoubleAlias(json, const <String>['ivaSum']),
      ivaBreakdown: _parseIvaBreakdown(json['ivaBreakdown']),
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
      pricingState: json['pricingState']?.toString() ?? 'READY',
      amountSource: json['amountSource']?.toString() ?? 'CPC_IMPORTETOTAL',
      estado: EstadoEntrega.fromString('${json['estado'] ?? 'PENDIENTE'}'),
      items: _parseEntregaItems(json['items']),
      observaciones: json['observaciones']?.toString(),
      fotos: (json['fotos'] as List<dynamic>?)
              ?.map((item) => item.toString())
              .toList() ??
          [],
      firma: json['firma']?.toString(),
      horaPrevista: _parseHoraPrevista(json['HORALLEGADA']),
      confirmationId: json['confirmationId']?.toString(),
      cobroId: json['cobroId']?.toString(),
      cobrado: json['cobrado'] == true,
      importeCobrado:
          _optionalNullableDouble(json, const <String>['importeCobrado']),
      importePendienteCobro: _optionalNullableDouble(
        json,
        const <String>['importePendienteCobro'],
      ),
      importeDisponibleCobro: _optionalNullableDouble(
        json,
        const <String>['importeDisponibleCobro'],
      ),
      formaPagoCobro: json['formaPagoCobro']?.toString(),
      cobroParcial: json['cobroParcial'] == true,
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
  final double? latitud;
  final double? longitud;
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
  final String pricingState;
  final String amountSource;
  EstadoEntrega estado;
  List<EntregaItem> items;
  String? observaciones;
  List<String> fotos;
  String? firma;
  DateTime? horaEntrega;
  final String? horaPrevista;
  final String? confirmationId;
  final String? cobroId;
  final bool cobrado;
  final double? importeCobrado;
  final double? importePendienteCobro;
  final double? importeDisponibleCobro;
  final String? formaPagoCobro;
  final bool cobroParcial;

  bool get isPendingPrice => pricingState == 'PENDING_PRICE';
  bool get isZeroEmpty => pricingState == 'ZERO_EMPTY';
  bool get hasAppCobro =>
      cobrado && (importeCobrado != null && importeCobrado! > 0.004);

  bool get tieneSaldoCobrable =>
      importeDisponibleCobro != null && importeDisponibleCobro! > 0.004;

  AlbaranEntrega copyWith({
    double? importeTotal,
    double? importeBruto,
    double? importeNeto,
    double? importeIva,
    List<IvaBreakdownItem>? ivaBreakdown,
    String? checksum,
    bool? discrepancy,
    double? lineSum,
    String? pricingState,
    String? amountSource,
    double? latitud,
    double? longitud,
    EstadoEntrega? estado,
    List<EntregaItem>? items,
    String? observaciones,
    String? confirmationId,
    String? cobroId,
    bool? cobrado,
    double? importeCobrado,
    double? importeDisponibleCobro,
    String? formaPagoCobro,
    bool clearPaymentBalance = false,
  }) {
    return AlbaranEntrega(
      id: id,
      numeroAlbaran: numeroAlbaran,
      ejercicio: ejercicio,
      serie: serie,
      terminal: terminal,
      numeroFactura: numeroFactura,
      serieFactura: serieFactura,
      codigoCliente: codigoCliente,
      nombreCliente: nombreCliente,
      nombreComercial: nombreComercial,
      nombreFiscal: nombreFiscal,
      direccion: direccion,
      poblacion: poblacion,
      telefono: telefono,
      telefono2: telefono2,
      latitud: latitud ?? this.latitud,
      longitud: longitud ?? this.longitud,
      emailCliente: emailCliente,
      fecha: fecha,
      importeTotal: importeTotal ?? this.importeTotal,
      importeBruto: importeBruto ?? this.importeBruto,
      importeNeto: importeNeto ?? this.importeNeto,
      importeIva: importeIva ?? this.importeIva,
      ivaBreakdown: ivaBreakdown ?? this.ivaBreakdown,
      checksum: checksum ?? this.checksum,
      formaPago: formaPago,
      formaPagoDesc: formaPagoDesc,
      tipoPago: tipoPago,
      diasPago: diasPago,
      esCTR: esCTR,
      puedeCobrarse: puedeCobrarse,
      colorEstado: colorEstado,
      ruta: ruta,
      codigoVendedor: codigoVendedor,
      nombreVendedor: nombreVendedor,
      codigoRepartidor: codigoRepartidor,
      nombreRepartidor: nombreRepartidor,
      ordenPreparacion: ordenPreparacion,
      discrepancy: discrepancy ?? this.discrepancy,
      lineSum: lineSum ?? this.lineSum,
      pricingState: pricingState ?? this.pricingState,
      amountSource: amountSource ?? this.amountSource,
      estado: estado ?? this.estado,
      items: items ?? this.items,
      observaciones: observaciones ?? this.observaciones,
      fotos: fotos,
      firma: firma,
      horaEntrega: horaEntrega,
      horaPrevista: horaPrevista,
      confirmationId: confirmationId ?? this.confirmationId,
      cobroId: cobroId ?? this.cobroId,
      cobrado: cobrado ?? this.cobrado,
      importeCobrado: importeCobrado ?? this.importeCobrado,
      importePendienteCobro: clearPaymentBalance ? null : importePendienteCobro,
      importeDisponibleCobro: clearPaymentBalance
          ? 0
          : importeDisponibleCobro ?? this.importeDisponibleCobro,
      formaPagoCobro: formaPagoCobro ?? this.formaPagoCobro,
      cobroParcial: clearPaymentBalance ? false : cobroParcial,
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
    void refreshAfterConfirmedOfflineDelivery() {
      if (state.repartidorId.isEmpty) return;
      unawaited(cargarAlbaranesPendientes(forceRefresh: true));
    }

    OfflineSyncNotifier.deliveryConfirmationRevision
        .addListener(refreshAfterConfirmedOfflineDelivery);
    ref.onDispose(() {
      _debounceTimer?.cancel();
      OfflineSyncNotifier.deliveryConfirmationRevision
          .removeListener(refreshAfterConfirmedOfflineDelivery);
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

  void _scheduleFilterReload(bool autoReload) {
    if (autoReload) {
      _debouncedLoad();
    } else {
      _cancelDebouncedLoad();
    }
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

  void setSearchClient(String query, {bool autoReload = true}) {
    state = state.copyWith(searchClient: query);
    _scheduleFilterReload(autoReload);
  }

  void setSearchAlbaran(String query, {bool autoReload = true}) {
    state = state.copyWith(searchAlbaran: query);
    _scheduleFilterReload(autoReload);
  }

  void setSortBy(String sort, {bool autoReload = true}) {
    state = state.copyWith(sortBy: sort);
    _scheduleFilterReload(autoReload);
  }

  void setFilterTipoPago(String tipo, {bool autoReload = true}) {
    state = state.copyWith(filterTipoPago: tipo);
    _scheduleFilterReload(autoReload);
  }

  void setFilterDebeCobrar(String debeCobrar, {bool autoReload = true}) {
    state = state.copyWith(filterDebeCobrar: debeCobrar);
    _scheduleFilterReload(autoReload);
  }

  void setFilterDocTipo(String docTipo, {bool autoReload = true}) {
    state = state.copyWith(filterDocTipo: docTipo);
    _scheduleFilterReload(autoReload);
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
      final routeLoadRequested = requestState.sortBy == 'default' &&
          requestState.repartidorId.isNotEmpty;
      final routeOrderRequested =
          routeLoadRequested && !requestState.repartidorId.contains(',');
      final requestLimit = routeLoadRequested ? 500 : 100;
      var url =
          '/entregas/pendientes/${requestState.repartidorId}?date=$formattedDate&limit=$requestLimit&offset=$pageOffset';
      if (routeOrderRequested) {
        url += '&routeOrder=true';
      }

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
          routeLoadRequested ? 'rutero-page-v2' : 'source-page',
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
        final page = <AlbaranEntrega>[];
        for (final raw in lista) {
          if (raw is! Map) continue;
          try {
            page.add(
              AlbaranEntrega.fromJson(Map<String, dynamic>.from(raw)),
            );
          } catch (_) {
            continue;
          }
        }
        if (lista.isNotEmpty && page.isEmpty) {
          throw const EntregasPayloadException('albaranes');
        }
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

  /// Local projection only after the canonical journal has accepted the ACK.
  /// A queued/offline request must never call this method as a success.
  void applyAcknowledgedDelivery({
    required String deliveryId,
    required String repartidorId,
    required Map<String, dynamic> response,
    double? acceptedPaymentAmount,
    String? acceptedPaymentMethod,
  }) {
    if (!_selectedOwnerContains(state.repartidorId, repartidorId) ||
        response['queued'] == true) return;
    final status = response['deliveryStatus']?.toString();
    if (!const ['ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO']
        .contains(status)) return;
    final ack = RepartoConfirmationAcknowledgement.fromResponse(response);
    final paid = ack.cobroId != null &&
        acceptedPaymentAmount != null &&
        acceptedPaymentAmount.isFinite &&
        acceptedPaymentAmount > 0;
    _pendingLoadGeneration++; // An older in-flight read cannot erase this ACK.
    state = state.copyWith(
        isLoading: false,
        albaranes: state.albaranes.map((item) {
          if (item.id != deliveryId) return item;
          return item.copyWith(
            estado: EstadoEntrega.fromString(status!),
            confirmationId: ack.confirmationId,
            cobroId: ack.cobroId, cobrado: paid ? true : null,
            importeCobrado: paid ? acceptedPaymentAmount : null,
            formaPagoCobro: paid ? acceptedPaymentMethod : null,
            // The ACK doesn't return the server balance. Do not guess it from
            // invoice totals: partial deliveries can change the payable amount.
            clearPaymentBalance: paid,
          );
        }).toList(growable: false));
  }

  Future<AlbaranEntrega?> obtenerDetalleAlbaran(
    int numero,
    int ejercicio,
    String serie,
    int terminal,
    String codigoCliente, {
    String? deliveryId,
    String? repartidorId,
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
    final owner = resolveRepartoDocumentOwner(
      documentOwner: repartidorId,
      selectedOwner: state.repartidorId,
    );
    if (owner == null) {
      state = state.copyWith(
        error: 'Falta un repartidor concreto para cargar el detalle.',
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
          'repartidorId': owner,
        },
        cacheKey:
            'entregas:albaran:$owner:$numero:$ejercicio:$serie:$terminal:$resolvedCliente',
        cacheTTL: const Duration(minutes: 2),
        forceRefresh: true,
        allowStale: false,
      );

      if (response['success'] == true && response['albaran'] != null) {
        final albaran = AlbaranEntrega.fromJson(
          response['albaran'] as Map<String, dynamic>,
        );
        final patched = state.albaranes.map((existing) {
          if (existing.id != albaran.id) return existing;
          return existing.copyWith(
            importeTotal: albaran.importeTotal,
            importeBruto: albaran.importeBruto,
            importeNeto: albaran.importeNeto,
            importeIva: albaran.importeIva,
            ivaBreakdown: albaran.ivaBreakdown,
            checksum: albaran.checksum,
            discrepancy: albaran.discrepancy,
            lineSum: albaran.lineSum,
            pricingState: albaran.pricingState,
            amountSource: albaran.amountSource,
            importeDisponibleCobro: albaran.importeDisponibleCobro,
            items: albaran.items.isNotEmpty ? albaran.items : existing.items,
          );
        }).toList(growable: false);
        state = state.copyWith(
          albaranes: patched,
          albaranSeleccionado: albaran,
        );
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
    final owner = resolveRepartoDocumentOwner(
      documentOwner: albaran?.codigoRepartidor,
      selectedOwner: state.repartidorId,
    );
    if (owner == null) {
      state = state.copyWith(
        error: 'El recibo requiere un repartidor concreto.',
      );
      return null;
    }
    try {
      final response = await ApiClient.get(
        RepartoCanonicalReceiptRequest(
          canonicalReceiptId,
          repartidorId: owner,
        ).endpoint,
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
        error: error.statusCode == 403
            ? 'No tienes permiso para recuperar este recibo.'
            : 'No se pudo recuperar el recibo confirmado.',
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
    required String email,
    AlbaranEntrega? albaran,
    String? confirmationId,
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
