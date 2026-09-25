/// Tanda 3 — REQ-13/15 cuadre bolsa (unit, sin red ni DB2).
/// - Misma fórmula Flutter ↔ backend `validateOrderWithBolsa`:
///   diff = round2((effectiveUnit - ref) * qty), redondeo solo al final.
/// - Repro caso 1 €: la fórmula vieja (`importeVenta * factor`) daba 1,00
///   donde backend da 0,99 (redondeo por unidad vs por total).
/// - Parseo `OrderSummary`: neto firmado + fallback acum-consumo.
/// - `BolsaMovimiento`: mismatch ±0,01 + motivo legible sin margen.
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

OrderLine _line({
  double precioVenta = 10,
  double tarifaCliente = 9,
  double tarifa = 0,
  double minimo = 0,
  double envases = 3,
  double unidades = 0,
  String uom = 'CAJAS',
  double unidadesCaja = 1,
  double lineDiscount = 0,
}) {
  final line = OrderLine(
    codigoArticulo: 'ART1',
    descripcion: 'Artículo 1',
    precioVenta: precioVenta,
    precioTarifaCliente: tarifaCliente,
    precioTarifa: tarifa,
    precioMinimo: minimo,
    cantidadEnvases: envases,
    cantidadUnidades: unidades,
    unidadMedida: uom,
    unidadesCaja: unidadesCaja,
  )..lineDiscountPct = lineDiscount;
  line.recalculate();
  return line;
}

void main() {
  group('REQ-13 fórmula unificada saleTotal − referenceTotal', () {
    test('venta sobre tarifa acumula (dif +X)', () {
      final impact = _line().estimatedBolsaImpactForFactor(1);
      expect(impact.hasImpact, isTrue);
      expect(impact.acumulacion, 3.0);
      expect(impact.neto, 3.0);
      expect(impact.consumo, 0);
    });

    test('venta bajo tarifa consume (−Y)', () {
      final impact = _line(precioVenta: 8, tarifaCliente: 9)
          .estimatedBolsaImpactForFactor(1);
      expect(impact.hasImpact, isTrue);
      expect(impact.consumo, 3.0);
      expect(impact.neto, -3.0);
    });

    test('dto línea + global usan precio unitario efectivo (backend)', () {
      // effective = round2(10 × 0.9 × 0.95) = 8.55; diff = 8.55 − 9 = −0.45
      final impact = _line(envases: 1, lineDiscount: 10)
          .estimatedBolsaImpactForFactor(0.95);
      expect(impact.consumo, 0.45);
      expect(impact.neto, -0.45);
    });

    test('repro 1 €: redondeo por unidad, no por total', () {
      // precio 10.333 × 3: backend effective round2(10.333) = 10.33
      // diff = round2(0.33 × 3) = 0.99 (la fórmula vieja daba 1.00).
      final impact = _line(
        precioVenta: 10.333,
        tarifaCliente: 10,
      ).estimatedBolsaImpactForFactor(1);
      expect(impact.acumulacion, 0.99);
      expect(impact.neto, 0.99);
    });

    test('sin referencia o sin cantidad → sin impacto', () {
      expect(
        _line(tarifaCliente: 0, tarifa: 0, minimo: 0)
            .estimatedBolsaImpactForFactor(1)
            .hasImpact,
        isFalse,
      );
      expect(
        _line(envases: 0).estimatedBolsaImpactForFactor(1).hasImpact,
        isFalse,
      );
    });

    test('misma magnitud y signo ±0,01 en agregación mixta', () {
      final a = _line(precioVenta: 10, tarifaCliente: 9, envases: 1);
      final b = _line(precioVenta: 8, tarifaCliente: 9, envases: 1);
      final ia = a.estimatedBolsaImpactForFactor(1);
      final ib = b.estimatedBolsaImpactForFactor(1);
      final neto = double.parse(
        (ia.neto + ib.neto).toStringAsFixed(2),
      );
      expect(neto, 0.0);
      expect(ia.acumulacion, 1.0);
      expect(ib.consumo, 1.0);
    });
  });

  group('REQ-13 parseo OrderSummary (chip Mis pedidos)', () {
    test('bolsaNeto firmado negativo → chip Bolsa usada', () {
      final s = OrderSummary.fromJson({
        'id': 1,
        'numeroPedido': 2296,
        'clienteCode': 'C1',
        'clienteName': 'Cliente',
        'vendedorCode': '15',
        'fecha': '24/09/2026',
        'estado': 'CONFIRMADO',
        'tipoVenta': 'CC',
        'total': 100,
        'bolsaGenerada': true,
        'bolsaNeto': -2.5,
      });
      expect(s.bolsaNeto, -2.5);
      expect(s.bolsaGenerada, isTrue);
    });

    test('resumen sin neto usa acum − consumo', () {
      final s = OrderSummary.fromJson({
        'id': 1,
        'numeroPedido': 1,
        'clienteCode': 'C1',
        'clienteName': 'C',
        'vendedorCode': '15',
        'fecha': '',
        'estado': 'CONFIRMADO',
        'tipoVenta': 'CC',
        'total': 10,
        'bolsaSummary': {'acumulacion': 5, 'consumo': 2, 'movementCount': 2},
      });
      expect(s.bolsaNeto, 3.0);
      expect(s.bolsaGenerada, isTrue);
    });

    test('ruido < 0,005 → sin impacto', () {
      final s = OrderSummary.fromJson({
        'id': 1,
        'numeroPedido': 1,
        'clienteCode': 'C1',
        'clienteName': 'C',
        'vendedorCode': '15',
        'fecha': '',
        'estado': 'CONFIRMADO',
        'tipoVenta': 'CC',
        'total': 10,
        'bolsaNeto': 0.004,
      });
      expect(s.bolsaGenerada, isFalse);
    });
  });

  group('REQ-15 saldo anterior → posterior + motivo', () {
    BolsaMovimiento _mov({
      double anterior = 100,
      double posterior = 101.93,
      double importe = 1.93,
      String tipo = 'ACUMULACION',
    }) =>
        BolsaMovimiento(
          id: 1,
          tipo: BolsaMovimientoTipo.fromString(tipo),
          importe: importe,
          saldoAnterior: anterior,
          saldoPosterior: posterior,
          codigoArticulo: 'ART1',
          descripcion: 'Artículo 1',
        );

    test('variación = posterior − anterior; sin mismatch', () {
      final m = _mov();
      expect(m.variacionSaldo, 1.93);
      expect(m.hasSaldoMismatch, isFalse);
      expect(m.motivoVariacion(), contains('Artículo 1'));
      expect(m.motivoVariacion(), contains('+'));
    });

    test('descuadre > 0,01 → revisar', () {
      final m = _mov(posterior: 102.5);
      expect(m.hasSaldoMismatch, isTrue);
    });

    test('consumo firma negativo y motivo bajo tarifa', () {
      final m = _mov(
        anterior: 100,
        posterior: 97,
        importe: 3,
        tipo: 'CONSUMO',
      );
      expect(m.importeFirmado, -3);
      expect(m.hasSaldoMismatch, isFalse);
      expect(m.motivoVariacion(), contains('bajo tarifa'));
    });

    test('serie completa en displayPedido', () {
      final m = BolsaMovimiento(
        id: 2,
        tipo: BolsaMovimientoTipo.acumulacion,
        importe: 1,
        saldoAnterior: 0,
        saldoPosterior: 1,
        pedidoReferencia: 'P-015-002296',
      );
      expect(m.displayPedido, 'P-015-002296');
    });
  });
}
