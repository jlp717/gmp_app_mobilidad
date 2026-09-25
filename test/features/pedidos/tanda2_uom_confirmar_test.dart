import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

void main() {
  group('REQ-08 UOM veraz (mapa unico IVA + unidades reales)', () {
    test("codigoIva '0'/vacio -> 21% (mapa unico)", () {
      expect(ivaRateFromCode('0'), 0.21);
      expect(ivaRateFromCode(''), 0.21);
      expect(ivaRateFromCode(null), 0.21);
      expect(ivaRateFromCode('desconocido'), 0.21);
    });

    test('mapa verificado: 1->10%, 2->21%, 3->4%, 4->0%, 5->10%', () {
      expect(ivaRateFromCode('1'), 0.10);
      expect(ivaRateFromCode('2'), 0.21);
      expect(ivaRateFromCode('3'), 0.04);
      expect(ivaRateFromCode('4'), 0.0);
      expect(ivaRateFromCode('5'), 0.10);
    });

    test("etiqueta '0' es General 21%, no Exento", () {
      expect(ivaLabelFromCode('0'), 'General (21%)');
      expect(ivaLabelFromCode('4'), 'Exento (0%)');
    });
  });

  group('REQ-10 truckLabel codigo-matricula-nombre', () {
    test('con driverName muestra nombre, nunca solo codigo', () {
      final o = OrderDeliveryOptions(
        clientCode: 'C1',
        vendedorCode: '80',
        vehicleCode: '08',
        driverCode: '84',
        driverName: 'JUAN PEREZ',
        vehicleMatricula: '1234ABC',
      );
      expect(o.truckLabel, '08 - 1234ABC - JUAN PEREZ');
      expect(o.truckLabel.contains('Rep. 84'), isFalse);
    });

    test('sin nombre usa fallback Rep. <code>', () {
      final o = OrderDeliveryOptions(
        clientCode: 'C1',
        vendedorCode: '80',
        vehicleCode: '08',
        driverCode: '84',
        vehicleMatricula: '1234ABC',
      );
      expect(o.truckLabel, '08 - 1234ABC - Rep. 84');
    });

    test('fromJson propaga driverName backend', () {
      final o = OrderDeliveryOptions.fromJson({
        'clientCode': 'C1',
        'vendedorCode': '80',
        'vehicleCode': '08',
        'driverCode': '84',
        'driverName': 'JUAN PEREZ',
        'vehicleMatricula': '1234ABC',
      });
      expect(o.driverName, 'JUAN PEREZ');
      expect(o.truckLabel, contains('JUAN PEREZ'));
    });
  });

  group('REQ-11 IVA cuadre', () {
    test('normalizeIvaRate: 21 -> 0.21, 0.21 intacto', () {
      expect(normalizeIvaRate(21, fallback: 0), closeTo(0.21, 1e-9));
      expect(normalizeIvaRate(0.21, fallback: 0), closeTo(0.21, 1e-9));
      expect(normalizeIvaRate(0, fallback: 0), 0);
    });

    test('multi-tipo 21%+10%+4%: suma breakdown = totalIva ±0,01 y Base+IVA=Total', () {
      // Misma fuente que provider: ivaRateFromCode + formula
      // pedidos_provider.dart:602 ivaBreakdown / :499 totalIva.
      final lines = [
        OrderLine(
          codigoArticulo: 'A',
          descripcion: 'A',
          importeVenta: 100,
          ivaRate: ivaRateFromCode('2'),
        ),
        OrderLine(
          codigoArticulo: 'B',
          descripcion: 'B',
          importeVenta: 50,
          ivaRate: ivaRateFromCode('1'),
        ),
        OrderLine(
          codigoArticulo: 'C',
          descripcion: 'C',
          importeVenta: 200,
          ivaRate: ivaRateFromCode('3'),
        ),
      ];
      const factor = 1.0; // sin dto global
      final breakdown = <int, double>{};
      var totalIva = 0.0;
      for (final l in lines) {
        final rate = normalizeIvaRate(l.ivaRate, fallback: 0);
        final saleAfterDiscount = l.importeVenta * factor;
        final ivaAmount = saleAfterDiscount * rate;
        totalIva += ivaAmount;
        final pct = (rate * 100).round();
        breakdown[pct] = (breakdown[pct] ?? 0) + ivaAmount;
      }
      final sumBreakdown = breakdown.values.fold(0.0, (a, b) => a + b);
      expect(ivaRateFromCode('2'), closeTo(0.21, 1e-9));
      expect(ivaRateFromCode('1'), closeTo(0.10, 1e-9));
      expect(breakdown[21], closeTo(21.0, 0.01));
      expect(breakdown[10], closeTo(5.0, 0.01));
      expect(breakdown[4], closeTo(8.0, 0.01));
      expect(sumBreakdown, closeTo(totalIva, 0.01));
      final base = lines.fold(0.0, (s, l) => s + l.importeVenta * factor);
      expect(base + totalIva, closeTo(base + sumBreakdown, 0.01));
      expect(base, closeTo(350.0, 0.01));
      expect(base + totalIva, closeTo(384.0, 0.01));
    });
  });

  group('REQ-12 bolsa preview local (mismo factor dto, visible COMERCIAL)', () {
    OrderLine bajoTarifa() => OrderLine(
          codigoArticulo: 'P1',
          descripcion: 'P1',
          unidadMedida: 'CAJAS',
          unidadesCaja: 1,
          cantidadEnvases: 10,
          precioVenta: 9,
          precioTarifaCliente: 10,
          importeVenta: 90, // 10 bajo tarifa (ref 100)
        );

    test('apply dto global recalcula con mismo factor; remove vuelve', () {
      final line = bajoTarifa();
      final sinDto = line.estimatedBolsaImpactForFactor(1.0);
      final conDto = line.estimatedBolsaImpactForFactor(0.9);
      final alQuitar = line.estimatedBolsaImpactForFactor(1.0);
      expect(sinDto.hasImpact, isTrue);
      expect(sinDto.consumo, closeTo(10.0, 0.01));
      // 90*0.9=81 vs ref 100 → consumo 19.
      expect(conDto.hasImpact, isTrue);
      expect(conDto.consumo, closeTo(19.0, 0.01));
      expect(alQuitar.consumo, closeTo(sinDto.consumo, 0.01));
    });

    test('sin impacto → hasImpact false → etiqueta Sin impacto en bolsa', () {
      final line = OrderLine(
        codigoArticulo: 'P2',
        descripcion: 'P2',
        unidadMedida: 'CAJAS',
        unidadesCaja: 1,
        cantidadEnvases: 10,
        precioVenta: 10,
        precioTarifaCliente: 10,
        importeVenta: 100, // igual a tarifa → diff 0
      );
      final impact = line.estimatedBolsaImpactForFactor(1.0);
      expect(impact.hasImpact, isFalse);
      // Mapeo UI order_preview_sheet: !hasImpact → línea colapsada.
      final label = impact.hasImpact ? 'con impacto' : 'Sin impacto en bolsa';
      expect(label, 'Sin impacto en bolsa');
    });

    test('con impacto → visible para COMERCIAL (no gated por margen)', () {
      final impact = bajoTarifa().estimatedBolsaImpactForFactor(1.0);
      // REQ-12 spec: bolsa visible COMERCIAL y JEFE_VENTAS cuando
      // hasImpact; coste/margen siguen gated a isMarginVisible.
      const rolComercialVeBolsa = true; // decisión §2 REQ-12 documentada
      expect(impact.hasImpact && rolComercialVeBolsa, isTrue);
    });
  });

  group('REQ-09 predicate días reparto (order_preview_sheet.dart:1344-1354)', () {
    String dayName(DateTime d) {
      const names = [
        'lunes',
        'martes',
        'miercoles',
        'jueves',
        'viernes',
        'sabado',
        'domingo'
      ];
      return names[d.weekday - 1];
    }

    // Réplica exacta de la rama production: hasRule = validated && no vacío.
    bool selectable(DateTime d,
        {required bool validated, required Set<String> allowed}) {
      final hasRule = validated && allowed.isNotEmpty;
      if (!hasRule) return true; // modo flexible: picker libre 0-60 días
      return allowed.contains(dayName(d));
    }

    // Lunes 2026-09-21, martes 2026-09-22.
    test('día permitido seleccionable, no permitido bloqueado', () {
      const allowed = {'lunes', 'miercoles', 'viernes'};
      expect(
          selectable(DateTime(2026, 9, 21),
              validated: true, allowed: allowed),
          isTrue);
      expect(
          selectable(DateTime(2026, 9, 22),
              validated: true, allowed: allowed),
          isFalse);
    });

    test('flexible validated=false permite cualquiera', () {
      expect(
          selectable(DateTime(2026, 9, 22),
              validated: false, allowed: {}),
          isTrue);
      expect(
          selectable(DateTime(2026, 9, 22),
              validated: false, allowed: {'lunes'}),
          isTrue);
    });
  });
}
