import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

void main() {
  group('OrderLine recalculation', () {
    test('charges caja price once when units are only the box equivalence', () {
      final line = OrderLine(
        codigoArticulo: 'P001',
        descripcion: 'Producto caja',
        cantidadEnvases: 2,
        cantidadUnidades: 24,
        unidadMedida: 'CAJAS',
        unidadesCaja: 12,
        unidadesFraccion: 1,
        precioVenta: 10,
        precioCosto: 5,
      );

      line.recalculate();

      expect(line.importeVenta, 20);
      expect(line.importeCosto, 10);
    });

    test('charges loose units as a box fraction for dual-field products', () {
      final line = OrderLine(
        codigoArticulo: 'P002',
        descripcion: 'Producto fraccionable',
        cantidadEnvases: 2,
        cantidadUnidades: 3,
        unidadMedida: 'CAJAS',
        unidadesCaja: 12,
        unidadesFraccion: 1,
        precioVenta: 10,
        precioCosto: 5,
      );

      line.recalculate();

      expect(line.importeVenta, 22.5);
      expect(line.importeCosto, 11.25);
      expect(line.cantidadUnidades, 3);
    });
  });

  group('Product minimum price per unit', () {
    test('converts minimum box price to selected sale unit', () {
      final product = Product(
        code: 'P003',
        name: 'Producto pesado',
        unitsPerBox: 12,
        formato: 'K',
        productoPesado: true,
        precioTarifa1: 30,
        precioMinimo: 24,
      );

      expect(product.minimumPriceForUnit('CAJAS'), 24);
      expect(product.minimumPriceForUnit('KILOGRAMOS'), 2);
    });
  });

  group('Order delivery options', () {
    test('parses delivery date, allowed days and truck suggestion', () {
      final options = OrderDeliveryOptions.fromJson({
        'clientCode': '4300010363',
        'vendedorCode': '57',
        'allowedDeliveryDays': ['martes', 'jueves'],
        'selectedDeliveryDate': '2026-05-05',
        'selectedDeliveryDateFormatted': '05/05/2026',
        'vehicleCode': '11',
        'driverCode': '57',
        'vehicleMatricula': '0883HFF',
        'routeCode': 'R1',
        'validated': true,
      });

      expect(options.deliveryLabel, '05/05/2026');
      expect(options.allowedDeliveryDays, ['martes', 'jueves']);
      expect(options.truckLabel, '11 - 0883HFF - Rep. 57');
      expect(options.hasTruck, true);
      expect(options.validated, true);
    });
  });
}
