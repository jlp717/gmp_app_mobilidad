/// COBROS MODELS
/// Modelos de datos para el módulo de cobros y entregas

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
      referencia: (json['referencia'] as String?) ?? '',
      tipo: _parseTipoCobro((json['tipo'] as String?) ?? 'normal'),
      fecha: DateTime.tryParse((json['fecha'] as String?) ?? '') ?? DateTime.now(),
      importeTotal: ((json['importeTotal'] ?? json['importe'] ?? 0) as num).toDouble(),
      importePendiente: ((json['importePendiente'] ?? json['importe'] ?? 0) as num).toDouble(),
      formaPago: json['formaPago'] as String?,
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
      itemId: (json['itemId'] as String?) ?? '',
      codigoArticulo: (json['codigoArticulo'] as String?) ?? '',
      descripcion: (json['descripcion'] as String?) ?? '',
      cantidadPedida: (json['cantidadPedida'] as int?) ?? 0,
      cantidadEntregada: (json['cantidadEntregada'] as int?) ?? 0,
      estado: EstadoEntrega.fromString((json['estado'] as String?) ?? 'PENDIENTE'),
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
      id: (json['id'] as String?) ?? '',
      numeroAlbaran: (json['numeroAlbaran'] as int?) ?? 0,
      codigoCliente: (json['codigoCliente'] as String?) ?? '',
      nombreCliente: (json['nombreCliente'] as String?) ?? '',
      direccion: (json['direccion'] as String?) ?? '',
      fecha: _parseDate(json['fecha']),
      importeTotal: ((json['importeTotal'] ?? 0) as num).toDouble(),
      estado: EstadoEntrega.fromString((json['estado'] as String?) ?? 'PENDIENTE'),
      items: (json['items'] as List<dynamic>?)
          ?.map((e) => EntregaItem.fromJson(e as Map<String, dynamic>))
          .toList() ?? [],
      formaPago: json['formaPago'] as String?,
      esCTR: json['esCTR'] == true,
      fotos: List<String>.from(json['fotos'] as List? ?? []),
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
      codigo: (json['codigo'] as String?) ?? '',
      nombre: (json['nombre'] as String?) ?? '',
      limiteCredito: ((json['limiteCredito'] ?? 0) as num).toDouble(),
      totalPendiente: ((json['totalPendiente'] ?? 0) as num).toDouble(),
      diasMora: (json['diasMora'] as int?) ?? 0,
      estado: (json['estado'] as String?) ?? 'ACTIVO',
      motivo: json['motivo'] as String?,
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
      totalPendiente: ((json['totalPendiente'] ?? 0) as num).toDouble(),
      numFacturas: (json['facturas'] as int?) ?? 0,
      numAlbaranes: (json['albaranes'] as int?) ?? 0,
      diasMoraMaximo: (json['diasMoraMaximo'] as int?) ?? 0,
      cobros: (json['cobros'] as List<dynamic>?)
          ?.map((e) => CobroPendiente.fromJson(e as Map<String, dynamic>))
          .toList() ?? [],
    );
  }
}
