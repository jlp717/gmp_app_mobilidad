/// EstadoEntrega - Shared enum for delivery states
/// Used by entregas, cobros, and repartidor modules

import 'package:flutter/material.dart';

enum EstadoEntrega {
  pendiente,
  enRuta,
  entregado,
  parcial,
  noEntregado,
  rechazado;

  /// API value (e.g. 'PENDIENTE', 'EN_RUTA')
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

  /// Human-readable Spanish label
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
