/// Bolsa Comercial Models (Req #3)
/// =================================
/// Modelos de datos para la Bolsa Comercial: saldo mensual del vendedor
/// y movimientos (acumulaciones/consumos).
library;

/// Estado de la bolsa para un vendedor en un mes concreto.
class BolsaStatus {
  BolsaStatus({
    required this.vendedor,
    required this.ejercicio,
    required this.mes,
    this.id,
    this.limitePct = 3.0,
    this.limiteImporte = 0,
    this.saldoDisponible = 0,
    this.consumido = 0,
    this.acumulado = 0,
  });

  factory BolsaStatus.fromJson(Map<String, dynamic> json) {
    double n(dynamic v) =>
        v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;
    int i(dynamic v) =>
        v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;
    return BolsaStatus(
      id: json['id'] != null ? i(json['id']) : null,
      vendedor: (json['vendedor'] ?? '').toString().trim(),
      ejercicio: i(json['ejercicio']),
      mes: i(json['mes']),
      limitePct: n(json['limitePct']),
      limiteImporte: n(json['limiteImporte']),
      saldoDisponible: n(json['saldoDisponible']),
      consumido: n(json['consumido']),
      acumulado: n(json['acumulado']),
    );
  }

  final int? id;
  final String vendedor;
  final int ejercicio;
  final int mes;
  final double limitePct;
  final double limiteImporte;
  final double saldoDisponible;
  final double consumido;
  final double acumulado;

  /// Porcentaje del límite consumido (0-100).
  double get porcentajeConsumido {
    final base =
        (limiteImporte > 0) ? limiteImporte : (acumulado > 0 ? acumulado : 0);
    if (base <= 0) return 0;
    return (consumido / base * 100).clamp(0, 100).toDouble();
  }

  /// True si el saldo disponible es negativo (consumido > acumulado).
  bool get isDeficit => saldoDisponible < 0;

  /// True si quedan menos del 10% del saldo disponible respecto al acumulado.
  bool get isLow {
    if (acumulado <= 0) return false;
    return saldoDisponible / acumulado < 0.10;
  }
}

/// Tipo de movimiento de bolsa.
enum BolsaMovimientoTipo {
  acumulacion,
  consumo,
  ajuste,
  desconocido;

  static BolsaMovimientoTipo fromString(String? value) {
    switch ((value ?? '').toUpperCase().trim()) {
      case 'ACUMULACION':
        return BolsaMovimientoTipo.acumulacion;
      case 'CONSUMO':
        return BolsaMovimientoTipo.consumo;
      case 'AJUSTE':
        return BolsaMovimientoTipo.ajuste;
      default:
        return BolsaMovimientoTipo.desconocido;
    }
  }

  String get label {
    switch (this) {
      case BolsaMovimientoTipo.acumulacion:
        return 'Acumulación';
      case BolsaMovimientoTipo.consumo:
        return 'Consumo';
      case BolsaMovimientoTipo.ajuste:
        return 'Ajuste';
      case BolsaMovimientoTipo.desconocido:
        return 'Otro';
    }
  }

  /// True si el importe debe mostrarse en positivo (entra en bolsa).
  bool get isCredit => this == BolsaMovimientoTipo.acumulacion;
}

/// Movimiento individual de bolsa (acumulación o consumo).
class BolsaMovimiento {
  BolsaMovimiento({
    required this.id,
    required this.tipo,
    required this.importe,
    required this.saldoAnterior,
    required this.saldoPosterior,
    this.codigoArticulo = '',
    this.descripcion = '',
    this.pedidoId,
    this.fecha,
    this.lineId,
    this.precioMinimoCongelado,
    this.precioVenta,
    this.cantidad,
    this.unidadMedida,
    this.idempotencyKey,
    this.vendedor,
    this.bolsaEjercicio,
    this.bolsaMes,
    this.clienteCodigo,
    this.clienteNombre,
    this.pedidoEjercicio,
    this.pedidoNumero,
    this.pedidoReferencia,
    this.localPedidoReferencia,
    this.systemPedidoReferencia,
    this.targetSchema,
    this.syncStatus,
  });

  factory BolsaMovimiento.fromJson(Map<String, dynamic> json) {
    double n(dynamic v) =>
        v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;
    double? nullableNumber(dynamic v) {
      if (v == null) return null;
      if (v is num) return v.toDouble();
      final text = v.toString().trim();
      if (text.isEmpty) return null;
      return double.tryParse(text);
    }

    int? nullableInt(dynamic v) {
      if (v == null) return null;
      if (v is num) return v.toInt();
      final text = v.toString().trim();
      if (text.isEmpty) return null;
      return int.tryParse(text);
    }

    String? nullableText(dynamic v) {
      final text = v?.toString().trim() ?? '';
      return text.isEmpty ? null : text;
    }

    return BolsaMovimiento(
      id: (json['id'] is num)
          ? (json['id'] as num).toInt()
          : int.tryParse(json['id']?.toString() ?? '') ?? 0,
      tipo: BolsaMovimientoTipo.fromString(json['tipo'] as String?),
      importe: n(json['importe']),
      saldoAnterior: n(json['saldoAnterior']),
      saldoPosterior: n(json['saldoPosterior']),
      codigoArticulo: (json['codigoArticulo'] ?? '').toString().trim(),
      descripcion: (json['descripcion'] ?? '').toString().trim(),
      pedidoId: nullableInt(json['pedidoId']),
      fecha: DateTime.tryParse((json['fecha'] as String?) ?? ''),
      lineId: nullableInt(json['lineId']),
      precioMinimoCongelado: nullableNumber(json['precioMinimoCongelado']),
      precioVenta: nullableNumber(json['precioVenta']),
      cantidad: nullableNumber(json['cantidad']),
      unidadMedida: nullableText(json['unidadMedida']),
      idempotencyKey: nullableText(json['idempotencyKey']),
      vendedor: nullableText(json['vendedor']),
      bolsaEjercicio: nullableInt(json['bolsaEjercicio']),
      bolsaMes: nullableInt(json['bolsaMes']),
      clienteCodigo: nullableText(json['clienteCodigo']),
      clienteNombre: nullableText(json['clienteNombre']),
      pedidoEjercicio: nullableInt(json['pedidoEjercicio']),
      pedidoNumero: nullableInt(json['pedidoNumero']),
      pedidoReferencia: nullableText(json['pedidoReferencia']),
      localPedidoReferencia: nullableText(json['localPedidoReferencia']),
      systemPedidoReferencia: nullableText(json['systemPedidoReferencia']),
      targetSchema: nullableText(json['targetSchema']),
      syncStatus: nullableText(json['syncStatus']),
    );
  }

  final int id;
  final BolsaMovimientoTipo tipo;
  final double importe;
  final double saldoAnterior;
  final double saldoPosterior;
  final String codigoArticulo;
  final String descripcion;
  final int? pedidoId;
  final DateTime? fecha;

  /// Identificador de la línea de pedido que originó el movimiento.
  final int? lineId;

  /// Precio mínimo unitario aplicado y congelado para la línea.
  final double? precioMinimoCongelado;

  /// Precio de venta unitario usado en el cálculo del movimiento.
  final double? precioVenta;

  /// Cantidad vendida o consumida asociada a la línea.
  final double? cantidad;

  /// Unidad de medida enviada por backend para la cantidad.
  final String? unidadMedida;

  /// Clave idempotente del movimiento para trazabilidad.
  final String? idempotencyKey;

  final String? vendedor;
  final int? bolsaEjercicio;
  final int? bolsaMes;
  final String? clienteCodigo;
  final String? clienteNombre;
  final int? pedidoEjercicio;
  final int? pedidoNumero;
  final String? pedidoReferencia;
  final String? localPedidoReferencia;
  final String? systemPedidoReferencia;
  final String? targetSchema;
  final String? syncStatus;

  /// Importe con signo: positivo si acumulación, negativo si consumo.
  double get importeFirmado => tipo.isCredit ? importe : -importe;

  String get displayPedido {
    final ref = pedidoReferencia?.trim();
    if (ref != null && ref.isNotEmpty) return ref;
    if (pedidoId != null) return 'Pedido $pedidoId';
    return '';
  }

  String get displayCliente {
    final code = clienteCodigo?.trim() ?? '';
    final name = clienteNombre?.trim() ?? '';
    if (code.isEmpty) return name;
    if (name.isEmpty) return code;
    return '$code - $name';
  }
}

/// Punto histórico mensual (acumulado/consumido por mes).
class BolsaMonthlyPoint {
  BolsaMonthlyPoint({
    required this.ejercicio,
    required this.mes,
    required this.acumulado,
    required this.consumido,
    required this.saldoDisponible,
  });

  factory BolsaMonthlyPoint.fromJson(Map<String, dynamic> json) {
    double n(dynamic v) =>
        v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;
    int i(dynamic v) =>
        v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;
    return BolsaMonthlyPoint(
      ejercicio: i(json['ejercicio']),
      mes: i(json['mes']),
      acumulado: n(json['acumulado']),
      consumido: n(json['consumido']),
      saldoDisponible: n(json['saldoDisponible']),
    );
  }

  final int ejercicio;
  final int mes;
  final double acumulado;
  final double consumido;
  final double saldoDisponible;
}

class BolsaGroupedSummary {
  BolsaGroupedSummary({
    required this.ejercicio,
    required this.mes,
    required this.vendedores,
    required this.saldoDisponible,
    required this.consumido,
    required this.acumulado,
  });

  factory BolsaGroupedSummary.fromJson(Map<String, dynamic> json) {
    double n(dynamic v) =>
        v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;
    int i(dynamic v) =>
        v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;
    final totals = json['totals'] is Map
        ? Map<String, dynamic>.from(json['totals'] as Map)
        : const <String, dynamic>{};
    final rawVendedores = json['vendedores'] as List? ?? const [];
    return BolsaGroupedSummary(
      ejercicio: i(json['ejercicio']),
      mes: i(json['mes']),
      vendedores: rawVendedores
          .map(
            (item) =>
                BolsaStatus.fromJson(Map<String, dynamic>.from(item as Map)),
          )
          .toList(growable: false),
      saldoDisponible: n(totals['saldoDisponible']),
      consumido: n(totals['consumido']),
      acumulado: n(totals['acumulado']),
    );
  }

  final int ejercicio;
  final int mes;
  final List<BolsaStatus> vendedores;
  final double saldoDisponible;
  final double consumido;
  final double acumulado;
}
