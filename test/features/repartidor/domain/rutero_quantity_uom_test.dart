import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_quantity_uom.dart';

EntregaItem _packed({
  required String id,
  required double pieces,
  required double boxes,
  String unit = 'UNIDADES',
}) {
  return EntregaItem(
    itemId: id,
    codigoArticulo: id,
    descripcion: 'Art $id',
    cantidadPedida: pieces,
    bultos: boxes,
    unit: unit,
    precioUnitario: 1,
  );
}

void main() {
  group('rutero UOM facing (global, not only 7020)', () {
    test('7020-like 1×27 shows 1 caja', () {
      final item = _packed(id: '7020', pieces: 27, boxes: 1);
      expect(ruteroPrefersBoxQuantity(item), isTrue);
      expect(ruteroDriverFacingOrderedQty(item), 1);
      expect(ruteroLineQuantityUnitLabel(item), 'caja');
      expect(ruteroCanonicalFromFacing(item, 1), 27);
      expect(ruteroPrintFacingQuantity(item), 1);
    });

    test('2 cajas × 12 piezas shows 2 cajas', () {
      final item = _packed(id: 'A12', pieces: 24, boxes: 2);
      expect(ruteroPrefersBoxQuantity(item), isTrue);
      expect(ruteroDriverFacingOrderedQty(item), 2);
      expect(ruteroLineQuantityUnitLabel(item), 'cajas');
      expect(ruteroUnitsPerBox(item), 12);
      expect(ruteroFacingFromCanonical(item, 36), 3);
      expect(ruteroPrintFacingQuantity(item, deliveredCanonical: 36), 3);
    });

    test('3 cajas × 6 with CAJAS unit still remaps pieces→cajas', () {
      final item = _packed(
        id: 'B6',
        pieces: 18,
        boxes: 3,
        unit: 'CAJAS',
      );
      expect(ruteroPrefersBoxQuantity(item), isTrue);
      expect(ruteroDriverFacingOrderedQty(item), 3);
      expect(
        ruteroFacingQuantityChangeLabel(
          item,
          fromCanonical: 18,
          toCanonical: 12,
        ),
        '3 cajas -> 2 cajas',
      );
    });

    test('kg never remaps to cajas even if bultos set', () {
      final item = EntregaItem(
        itemId: 'P',
        codigoArticulo: 'POLLO',
        descripcion: 'Pollo',
        cantidadPedida: 5.75,
        bultos: 1,
        unit: 'KILOGRAMOS',
        precioUnitario: 4,
      );
      expect(ruteroPrefersBoxQuantity(item), isFalse);
      expect(ruteroDriverFacingOrderedQty(item), 5.75);
      expect(ruteroLineQuantityUnitLabel(item), 'kg');
      expect(ruteroPrintFacingQuantity(item), 5.75);
    });

    test('factor 1 stays in pieces/uds', () {
      final item = _packed(id: 'U1', pieces: 4, boxes: 4);
      expect(ruteroPrefersBoxQuantity(item), isFalse);
      expect(ruteroDriverFacingOrderedQty(item), 4);
    });

    test('EntregaItem maps unidadMedida + cantidadEnvases aliases', () {
      final item = EntregaItem.fromJson({
        'itemId': '1',
        'codigoArticulo': '7020',
        'descripcion': 'Pan',
        'cantidadPedida': 27,
        'cantidadEnvases': 1,
        'unidadMedida': 'UNIDADES',
        'precioUnitario': 0.5,
      });
      expect(item.bultos, 1);
      expect(item.unit, 'UNIDADES');
      expect(ruteroPrefersBoxQuantity(item), isTrue);
      expect(ruteroPrintFacingQuantity(item), 1);
    });
  });
}
