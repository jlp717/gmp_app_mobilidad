import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_order_api.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';

class _RecordingOrderApi implements PedidosOrderApi {
  int? confirmedOrderId;
  String? confirmedSaleType;
  String? confirmedDeliveryDate;
  String? confirmedVehicleCode;
  String? confirmedDriverCode;
  String? confirmedRouteCode;

  @override
  Future<Map<String, dynamic>> createOrder({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    required String tipoVenta,
    required List<OrderLine> lines,
    required String observaciones,
  }) async {
    return {
      'id': 42,
      'estado': 'BORRADOR',
      'numeroPedido': 1001,
    };
  }

  @override
  Future<Map<String, dynamic>> confirmOrder(
    int orderId,
    String saleType, {
    String? deliveryDate,
    String? vehicleCode,
    String? driverCode,
    String? routeCode,
  }) async {
    confirmedOrderId = orderId;
    confirmedSaleType = saleType;
    confirmedDeliveryDate = deliveryDate;
    confirmedVehicleCode = vehicleCode;
    confirmedDriverCode = driverCode;
    confirmedRouteCode = routeCode;
    return {
      'header': {
        'id': orderId,
        'estado': 'CONFIRMADO',
        'numeroPedido': 1001,
        'vehicleCode': vehicleCode,
        'driverCode': driverCode,
        'routeCode': routeCode,
      },
    };
  }
}

void main() {
  group('OrderLine recalculation', () {
    test('keeps gift lines at zero sale and negative cost margin', () {
      final line = OrderLine(
        codigoArticulo: 'P004',
        descripcion: '[REGALO] Producto regalo',
        cantidadUnidades: 2,
        unidadMedida: 'UNIDADES',
        unidadesCaja: 1,
        precioVenta: 0,
        precioCosto: 3,
        tipoLinea: 'G',
      );

      line.recalculate();

      expect(line.tipoLinea, 'G');
      expect(line.importeVenta, 0);
      expect(line.importeCosto, 6);
      expect(line.importeMargen, -6);
      expect(line.toJson()['tipoLinea'], 'G');
    });

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

  group('Promotions', () {
    test('parses gift promotion metadata from backend JSON', () {
      final promo = PromotionItem.fromJson({
        'code': 'NST_1582',
        'productCode': '1582',
        'name': 'Regalo producto',
        'promoDesc': '3+1 gratis',
        'promoType': 'GIFT',
        'promoCode': 'NST_1582',
        'minQty': 3,
        'giftQty': 1,
        'cumulative': true,
        'isGlobal': true,
        'noGiftBought': true,
      });

      expect(promo.productCode, '1582');
      expect(promo.isGlobal, isTrue);
      expect(promo.noGiftBought, isTrue);
      expect(promo.isGift, isTrue);
    });

    test(
      'auto-adds cumulative gift lines when sale quantity reaches threshold',
      () {
        final provider = PedidosProvider();
        provider.setClient('4300010363', 'Cliente test');
        provider.debugSetPromotions([
          PromotionItem(
            code: 'NST_1582',
            productCode: '1582',
            name: 'Regalo producto',
            promoDesc: 'Compra 3 y regalo 1',
            promoType: 'GIFT',
            promoCode: 'NST_1582',
            minQty: 3,
            giftQty: 1,
            cumulative: true,
          ),
        ]);

        provider.addLine(
          Product(
            code: '1582',
            name: 'Producto con regalo',
            stockUnidades: 20,
            precioTarifa1: 10,
            precioCosto: 4,
            unitMeasure: 'UNIDADES',
          ),
          0,
          6,
          'UNIDADES',
          10,
        );

        expect(provider.lines.length, 3);
        expect(
          provider.lines.where((line) => line.tipoLinea == 'G').length,
          2,
        );
        expect(provider.totalImporte, 60);
        expect(provider.totalCosto, 32);
        expect(provider.totalMargen, 28);
      },
      skip: 'Gift auto-add pending in PedidosProvider',
    );
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

  group('Order confirmation result handling', () {
    test('preserves blocked confirmation instead of falling back to draft', () {
      final result = normalizeConfirmOrderResultForProvider(
        createResult: {
          'id': 42,
          'estado': 'BORRADOR',
        },
        confirmedResult: {
          'blocked': true,
          'reason': 'STOCK_INSUFICIENTE',
          'message': 'Stock insuficiente',
          'stockWarnings': [
            {'product': 'P001'},
          ],
        },
      );

      expect(result['blocked'], isTrue);
      expect(result['reason'], 'STOCK_INSUFICIENTE');
      expect(result['estado'], isNull);
    });

    test('does not clear cart when confirmation is blocked', () {
      expect(
        shouldClearCartAfterConfirmation({'blocked': true}),
        isFalse,
      );
      expect(
        shouldClearCartAfterConfirmation({'estado': 'CONFIRMADO'}),
        isTrue,
      );
    });

    test('does not clear cart when confirmation header remains draft', () {
      final result = normalizeConfirmOrderResultForProvider(
        createResult: {'id': 42, 'estado': 'BORRADOR'},
        confirmedResult: {
          'header': {'id': 42, 'estado': 'BORRADOR'},
        },
      );

      expect(result['estado'], 'BORRADOR');
      expect(shouldClearCartAfterConfirmation(result), isFalse);
    });

    test('treats only confirmed or sent states as successful confirmation', () {
      expect(
        isConfirmedOrderResultForProvider({'estado': 'CONFIRMADO'}),
        isTrue,
      );
      expect(
        isConfirmedOrderResultForProvider({'estado': 'ENVIADO'}),
        isTrue,
      );
      expect(
        isConfirmedOrderResultForProvider({'estado': 'BORRADOR'}),
        isFalse,
      );
      expect(
        isConfirmedOrderResultForProvider({'estado': 'PENDIENTE'}),
        isFalse,
      );
      expect(
        isConfirmedOrderResultForProvider({'blocked': true}),
        isFalse,
      );
    });
  });

  group('PedidosProvider confirmation API contract', () {
    test('forwards selected delivery vehicle assignment to confirmation API',
        () async {
      final api = _RecordingOrderApi();
      final provider = PedidosProvider(orderApi: api);
      provider.setClient('4300010363', 'SUSHI LORCA, S.L.');
      provider.addLine(
        Product(
          code: 'ART001',
          name: 'Producto test',
          stockEnvases: 10,
          precioTarifa1: 10,
        ),
        1,
        0,
        'CAJAS',
        10,
      );

      final result = await provider.confirmOrder(
        '57',
        deliveryDate: '2026-05-05',
        vehicleCode: '44',
        driverCode: '88',
        routeCode: 'R9',
      );

      expect(result, isNotNull);
      expect(api.confirmedOrderId, 42);
      expect(api.confirmedSaleType, 'CC');
      expect(api.confirmedDeliveryDate, '2026-05-05');
      expect(api.confirmedVehicleCode, '44');
      expect(api.confirmedDriverCode, '88');
      expect(api.confirmedRouteCode, 'R9');
    });
  });
}
