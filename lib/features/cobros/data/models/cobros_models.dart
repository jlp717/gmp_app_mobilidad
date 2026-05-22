/// COBROS MODELS
/// Modelos de datos para el módulo de cobros y entregas
library;

import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/models/estado_entrega.dart';

// Re-export EstadoEntrega from shared location
export 'package:gmp_app_mobilidad/core/models/estado_entrega.dart';

// ============================================
// ENUMS
// ============================================

enum TipoCobro {
  albaran,
  factura,
  presupuesto,
  pedidoApp,
  normal;

  String get label {
    switch (this) {
      case TipoCobro.albaran:
        return 'Albarán';
      case TipoCobro.factura:
        return 'Factura';
      case TipoCobro.presupuesto:
        return 'Presupuesto';
      case TipoCobro.pedidoApp:
        return 'Pedido App';
      case TipoCobro.normal:
        return 'Cobro';
    }
  }

  Color get color {
    switch (this) {
      case TipoCobro.albaran:
        return Colors.blue;
      case TipoCobro.factura:
        return Colors.green;
      case TipoCobro.presupuesto:
        return Colors.purple;
      case TipoCobro.pedidoApp:
        return Colors.teal;
      case TipoCobro.normal:
        return Colors.orange;
    }
  }
}

enum TipoVenta {
  contado,
  credito;

  String get code => this == contado ? 'CC' : 'VC';
  String get label => this == contado ? 'Contado' : 'Crédito';
}

enum TipoModoCobro {
  normal,
  especial;

  String get code => this == normal ? 'NORMAL' : 'ESPECIAL';
  String get label => this == normal ? 'Normal' : 'Especial';
}

// ============================================
// MODELS
// ============================================

/// Estado de un cobro/vencimiento (Req #15).
enum EstadoCobro {
  vencido,
  pendiente,
  alDia;

  /// Parsea desde el backend (CVC + cálculo de fecha).
  static EstadoCobro fromString(String? value) {
    final v = (value ?? '').trim().toUpperCase();
    if (v == 'VENCIDO') return EstadoCobro.vencido;
    if (v == 'AL_DIA' || v == 'ALDIA') return EstadoCobro.alDia;
    return EstadoCobro.pendiente;
  }

  String get label {
    switch (this) {
      case EstadoCobro.vencido:
        return 'Vencido';
      case EstadoCobro.pendiente:
        return 'Pendiente';
      case EstadoCobro.alDia:
        return 'Al día';
    }
  }

  Color get color {
    switch (this) {
      case EstadoCobro.vencido:
        return Colors.red;
      case EstadoCobro.pendiente:
        return Colors.amber;
      case EstadoCobro.alDia:
        return Colors.green;
    }
  }
}

/// Cobro pendiente de un cliente
class CobroPendiente {

  CobroPendiente({
    required this.id,
    required this.referencia,
    required this.tipo,
    required this.fecha,
    required this.importeTotal,
    required this.importePendiente,
    this.fechaVencimiento,
    this.formaPago,
    this.esCTR = false,
    this.estado = EstadoCobro.pendiente,
    this.importeCobrado = 0,
    this.docKey,
  });

  factory CobroPendiente.fromJson(Map<String, dynamic> json) {
    final pendiente =
        ((json['importePendiente'] ?? json['importe'] ?? 0) as num).toDouble();
    // Req #15: si el backend no envía `estado`, lo inferimos a partir del
    // importe pendiente y la fecha de vencimiento (vencido si <hoy y pendiente>0).
    final parsedVenc =
        DateTime.tryParse((json['fechaVencimiento'] as String?) ?? '');
    EstadoCobro estadoCalc;
    if (json['estado'] != null) {
      estadoCalc = EstadoCobro.fromString(json['estado'] as String?);
    } else if (pendiente <= 0.0001) {
      estadoCalc = EstadoCobro.alDia;
    } else if (parsedVenc != null) {
      // Vencido si fecha venc <= hoy.
      final today = DateTime.now();
      final dueOnly = DateTime(parsedVenc.year, parsedVenc.month, parsedVenc.day);
      final todayOnly = DateTime(today.year, today.month, today.day);
      estadoCalc = !dueOnly.isAfter(todayOnly)
          ? EstadoCobro.vencido
          : EstadoCobro.pendiente;
    } else {
      estadoCalc = EstadoCobro.pendiente;
    }

    return CobroPendiente(
      id: json['id']?.toString() ?? '',
      referencia: (json['referencia'] as String?) ?? '',
      tipo: _parseTipoCobro((json['tipo'] as String?) ?? 'normal'),
      fecha:
          DateTime.tryParse((json['fecha'] as String?) ?? '') ?? DateTime.now(),
      fechaVencimiento: parsedVenc,
      importeTotal:
          ((json['importeTotal'] ?? json['importe'] ?? 0) as num).toDouble(),
      importePendiente: pendiente,
      importeCobrado:
          ((json['importeCobrado'] ?? json['importeCancelado'] ?? 0) as num)
              .toDouble(),
      formaPago: json['formaPago'] as String?,
      esCTR: json['esCTR'] == true,
      estado: estadoCalc,
      docKey: json['docKey'] is Map
          ? Map<String, dynamic>.from(json['docKey'] as Map)
          : null,
    );
  }
  final String id;
  final String referencia;
  final TipoCobro tipo;
  final DateTime fecha;
  final DateTime? fechaVencimiento;
  final double importeTotal;
  final double importePendiente;
  final double importeCobrado;
  final String? formaPago;
  final bool esCTR;
  final EstadoCobro estado;
  final Map<String, dynamic>? docKey;

  bool get isVencido => estado == EstadoCobro.vencido;
  int get diasMora {
    if (fechaVencimiento == null || !isVencido) return 0;
    return DateTime.now().difference(fechaVencimiento!).inDays;
  }

  static TipoCobro _parseTipoCobro(String value) {
    switch (value.toLowerCase()) {
      case 'albaran':
        return TipoCobro.albaran;
      case 'factura':
        return TipoCobro.factura;
      case 'presupuesto':
        return TipoCobro.presupuesto;
      case 'pedido_app':
        return TipoCobro.pedidoApp;
      default:
        return TipoCobro.normal;
    }
  }
}

/// Item de un albarán para entrega
class EntregaItem {

  EntregaItem({
    required this.itemId,
    required this.codigoArticulo,
    required this.descripcion,
    required this.cantidadPedida,
    this.cantidadEntregada = 0,
    this.estado = EstadoEntrega.pendiente,
  });

  factory EntregaItem.fromJson(Map<String, dynamic> json) {
    return EntregaItem(
      itemId: (json['itemId'] as String?) ?? '',
      codigoArticulo: (json['codigoArticulo'] as String?) ?? '',
      descripcion: (json['descripcion'] as String?) ?? '',
      cantidadPedida: (json['cantidadPedida'] as int?) ?? 0,
      cantidadEntregada: (json['cantidadEntregada'] as int?) ?? 0,
      estado:
          EstadoEntrega.fromString((json['estado'] as String?) ?? 'PENDIENTE'),
    );
  }
  final String itemId;
  final String codigoArticulo;
  final String descripcion;
  final int cantidadPedida;
  int cantidadEntregada;
  EstadoEntrega estado;

  double get porcentajeEntregado =>
      cantidadPedida > 0 ? (cantidadEntregada / cantidadPedida) : 0;
}

/// Albarán pendiente de entrega
class Albaran {

  Albaran({
    required this.id,
    required this.numeroAlbaran,
    required this.codigoCliente,
    required this.nombreCliente,
    required this.direccion,
    required this.fecha,
    required this.importeTotal,
    this.estado = EstadoEntrega.pendiente,
    this.items = const [],
    this.formaPago,
    this.esCTR = false,
    this.firmaBase64,
    this.fotos = const [],
  });

  factory Albaran.fromJson(Map<String, dynamic> json) {
    return Albaran(
      id: (json['id'] as String?) ?? '',
      numeroAlbaran: (json['numeroAlbaran'] as int?) ?? 0,
      codigoCliente: (json['codigoCliente'] as String?) ?? '',
      nombreCliente: (json['nombreCliente'] as String?) ?? '',
      direccion: (json['direccion'] as String?) ?? '',
      fecha: _parseDate(json['fecha']),
      importeTotal: ((json['importeTotal'] ?? 0) as num).toDouble(),
      estado:
          EstadoEntrega.fromString((json['estado'] as String?) ?? 'PENDIENTE'),
      items: (json['items'] as List<dynamic>?)
              ?.map((e) => EntregaItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      formaPago: json['formaPago'] as String?,
      esCTR: json['esCTR'] == true,
      fotos: List<String>.from(json['fotos'] as List? ?? []),
    );
  }
  final String id;
  final int numeroAlbaran;
  final String codigoCliente;
  final String nombreCliente;
  final String direccion;
  final DateTime fecha;
  final double importeTotal;
  EstadoEntrega estado;
  final List<EntregaItem> items;
  final String? formaPago;
  final bool esCTR;
  String? firmaBase64;
  List<String> fotos;

  static DateTime _parseDate(dynamic date) {
    if (date == null) return DateTime.now();
    if (date is DateTime) return date;
    if (date is String) {
      // Handle "dd/mm/yyyy" format
      if (date.contains('/')) {
        final parts = date.split('/');
        if (parts.length == 3) {
          return DateTime(
            int.parse(parts[2]),
            int.parse(parts[1]),
            int.parse(parts[0]),
          );
        }
      }
      return DateTime.tryParse(date) ?? DateTime.now();
    }
    return DateTime.now();
  }

  int get totalItems => items.length;
  int get itemsEntregados =>
      items.where((i) => i.estado == EstadoEntrega.entregado).length;
  double get porcentajeCompletado =>
      totalItems > 0 ? (itemsEntregados / totalItems) : 0;
  bool get completo => itemsEntregados == totalItems && totalItems > 0;
}

/// Estado del cliente (moroso, activo, etc)
class EstadoCliente {

  EstadoCliente({
    required this.codigo,
    required this.nombre,
    this.limiteCredito = 0,
    this.totalPendiente = 0,
    this.diasMora = 0,
    this.estado = 'ACTIVO',
    this.motivo,
  });

  factory EstadoCliente.fromJson(Map<String, dynamic> json) {
    return EstadoCliente(
      codigo: (json['codigo'] as String?) ?? '',
      nombre: (json['nombre'] as String?) ?? '',
      limiteCredito: ((json['limiteCredito'] ?? 0) as num).toDouble(),
      totalPendiente: ((json['totalPendiente'] ?? 0) as num).toDouble(),
      diasMora: (json['diasMora'] as int?) ?? 0,
      estado: (json['estado'] as String?) ?? 'ACTIVO',
      motivo: json['motivo'] as String?,
    );
  }
  final String codigo;
  final String nombre;
  final double limiteCredito;
  final double totalPendiente;
  final int diasMora;
  final String estado; // ACTIVO, EN_ROJO, BLOQUEADO
  final String? motivo;

  bool get isActivo => estado == 'ACTIVO';
  bool get isEnRojo => estado == 'EN_ROJO';
  bool get isBloqueado => estado == 'BLOQUEADO';

  Color get statusColor {
    switch (estado) {
      case 'ACTIVO':
        return Colors.green;
      case 'EN_ROJO':
        return Colors.orange;
      case 'BLOQUEADO':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }
}

/// Resumen de cobros de un cliente
class ResumenCobros {

  ResumenCobros({
    this.totalPendiente = 0,
    this.numFacturas = 0,
    this.numAlbaranes = 0,
    this.numPedidos = 0,
    this.diasMoraMaximo = 0,
    this.cobros = const [],
  });

  factory ResumenCobros.fromJson(Map<String, dynamic> json) {
    final facturasData = json['facturas'];
    final albaranesData = json['albaranes'];
    final pedidosData = json['pedidos'];
    return ResumenCobros(
      totalPendiente: ((json['totalPendiente'] ?? 0) as num).toDouble(),
      numFacturas: facturasData is Map
          ? ((facturasData['cantidad'] ?? 0) as num).toInt()
          : (facturasData as int?) ?? 0,
      numAlbaranes: albaranesData is Map
          ? ((albaranesData['cantidad'] ?? 0) as num).toInt()
          : (albaranesData as int?) ?? 0,
      numPedidos: pedidosData is Map
          ? ((pedidosData['cantidad'] ?? 0) as num).toInt()
          : (pedidosData as int?) ?? 0,
      diasMoraMaximo: (json['diasMoraMaximo'] as int?) ?? 0,
      cobros: (json['cobros'] as List<dynamic>?)
              ?.map((e) => CobroPendiente.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
  final double totalPendiente;
  final int numFacturas;
  final int numAlbaranes;
  final int numPedidos;
  final int diasMoraMaximo;
  final List<CobroPendiente> cobros;
}
