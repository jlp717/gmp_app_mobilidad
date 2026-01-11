/// COBROS MODELS
/// Modelos de datos para el módulo de cobros y entregas

import 'package:flutter/material.dart';

// ============================================
// ENUMS
// ============================================

enum EstadoEntrega {
  pendiente,
  enRuta,
  entregado,
  parcial,
  noEntregado,
  rechazado;

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
        return Colors.grey;
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
        return Icons.pending;
      case EstadoEntrega.noEntregado:
        return Icons.cancel;
      case EstadoEntrega.rechazado:
        return Icons.block;
    }
  }

  static EstadoEntrega fromString(String value) {
    switch (value.toUpperCase()) {
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

enum TipoCobro {
  albaran,
  factura,
  presupuesto,
  normal;

  String get label {
    switch (this) {
      case TipoCobro.albaran:
        return 'Albarán';
      case TipoCobro.factura:
        return 'Factura';
      case TipoCobro.presupuesto:
        return 'Presupuesto';
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
      case TipoCobro.normal:
        return Colors.orange;
    }
  }
}

// ============================================
// MODELS
// ============================================

/// Cobro pendiente de un cliente
class CobroPendiente {
  final String id;
  final String referencia;
  final TipoCobro tipo;
  final DateTime fecha;
  final double importeTotal;
  final double importePendiente;
  final String? formaPago;
  final bool esCTR;

  CobroPendiente({
    required this.id,
    required this.referencia,
    required this.tipo,
    required this.fecha,
    required this.importeTotal,
    required this.importePendiente,
    this.formaPago,
    this.esCTR = false,
  });

  factory CobroPendiente.fromJson(Map<String, dynamic> json) {
    return CobroPendiente(
      id: json['id']?.toString() ?? '',
      referencia: json['referencia'] ?? '',
      tipo: _parseTipoCobro(json['tipo'] ?? 'normal'),
      fecha: DateTime.tryParse(json['fecha'] ?? '') ?? DateTime.now(),
      importeTotal: (json['importeTotal'] ?? json['importe'] ?? 0).toDouble(),
      importePendiente: (json['importePendiente'] ?? json['importe'] ?? 0).toDouble(),
      formaPago: json['formaPago'],
      esCTR: json['esCTR'] == true,
    );
  }

  static TipoCobro _parseTipoCobro(String value) {
    switch (value.toLowerCase()) {
      case 'albaran':
        return TipoCobro.albaran;
      case 'factura':
        return TipoCobro.factura;
      case 'presupuesto':
        return TipoCobro.presupuesto;
      default:
        return TipoCobro.normal;
    }
  }
}

/// Item de un albarán para entrega
class EntregaItem {
  final String itemId;
  final String codigoArticulo;
  final String descripcion;
  final int cantidadPedida;
  int cantidadEntregada;
  EstadoEntrega estado;

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
      itemId: json['itemId'] ?? '',
      codigoArticulo: json['codigoArticulo'] ?? '',
      descripcion: json['descripcion'] ?? '',
      cantidadPedida: json['cantidadPedida'] ?? 0,
      cantidadEntregada: json['cantidadEntregada'] ?? 0,
      estado: EstadoEntrega.fromString(json['estado'] ?? 'PENDIENTE'),
    );
  }

  double get porcentajeEntregado => 
    cantidadPedida > 0 ? (cantidadEntregada / cantidadPedida) : 0;
}

/// Albarán pendiente de entrega
class Albaran {
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
      id: json['id'] ?? '',
      numeroAlbaran: json['numeroAlbaran'] ?? 0,
      codigoCliente: json['codigoCliente'] ?? '',
      nombreCliente: json['nombreCliente'] ?? '',
      direccion: json['direccion'] ?? '',
      fecha: _parseDate(json['fecha']),
      importeTotal: (json['importeTotal'] ?? 0).toDouble(),
      estado: EstadoEntrega.fromString(json['estado'] ?? 'PENDIENTE'),
      items: (json['items'] as List<dynamic>?)
          ?.map((e) => EntregaItem.fromJson(e))
          .toList() ?? [],
      formaPago: json['formaPago'],
      esCTR: json['esCTR'] == true,
      fotos: List<String>.from(json['fotos'] ?? []),
    );
  }

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
  int get itemsEntregados => items.where((i) => i.estado == EstadoEntrega.entregado).length;
  double get porcentajeCompletado => totalItems > 0 ? (itemsEntregados / totalItems) : 0;
  bool get completo => itemsEntregados == totalItems && totalItems > 0;
}

/// Estado del cliente (moroso, activo, etc)
class EstadoCliente {
  final String codigo;
  final String nombre;
  final double limiteCredito;
  final double totalPendiente;
  final int diasMora;
  final String estado; // ACTIVO, EN_ROJO, BLOQUEADO
  final String? motivo;

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
      codigo: json['codigo'] ?? '',
      nombre: json['nombre'] ?? '',
      limiteCredito: (json['limiteCredito'] ?? 0).toDouble(),
      totalPendiente: (json['totalPendiente'] ?? 0).toDouble(),
      diasMora: json['diasMora'] ?? 0,
      estado: json['estado'] ?? 'ACTIVO',
      motivo: json['motivo'],
    );
  }

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
  final double totalPendiente;
  final int numFacturas;
  final int numAlbaranes;
  final int diasMoraMaximo;
  final List<CobroPendiente> cobros;

  ResumenCobros({
    this.totalPendiente = 0,
    this.numFacturas = 0,
    this.numAlbaranes = 0,
    this.diasMoraMaximo = 0,
    this.cobros = const [],
  });

  factory ResumenCobros.fromJson(Map<String, dynamic> json) {
    return ResumenCobros(
      totalPendiente: (json['totalPendiente'] ?? 0).toDouble(),
      numFacturas: json['facturas'] ?? 0,
      numAlbaranes: json['albaranes'] ?? 0,
      diasMoraMaximo: json['diasMoraMaximo'] ?? 0,
      cobros: (json['cobros'] as List<dynamic>?)
          ?.map((e) => CobroPendiente.fromJson(e))
          .toList() ?? [],
    );
  }
}
