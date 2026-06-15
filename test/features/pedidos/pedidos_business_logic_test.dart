import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_order_api.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_provider.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/unit_selector_modal.dart';

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

class _BlockingOrderApi implements PedidosOrderApi {
  final Completer<Map<String, dynamic>> createCompleter =
      Completer<Map<String, dynamic>>();
  int createOrderCalls = 0;
  int confirmOrderCalls = 0;

  @override
  Future<Map<String, dynamic>> createOrder({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    required String tipoVenta,
    required List<OrderLine> lines,
    required String observaciones,
  }) {
    createOrderCalls++;
    return createCompleter.future;
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
    confirmOrderCalls++;
    return {
      'header': {'id': orderId, 'estado': 'CONFIRMADO'},
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

    test('estimates bolsa impact without double-counting box-equivalent units',
        () {
      final line = OrderLine(
        codigoArticulo: 'P005',
        descripcion: 'Producto bolsa',
        cantidadEnvases: 2,
        cantidadUnidades: 24,
        unidadMedida: 'CAJAS',
        unidadesCaja: 12,
        precioVenta: 12,
        precioMinimo: 10,
      );

      final impact = line.estimatedBolsaImpact;

      expect(line.billingQuantity, 2);
      expect(impact.hasImpact, isTrue);
      expect(impact.acumulacion, 4);
      expect(impact.consumo, 0);
      expect(impact.neto, 4);
    });

    test('parses persisted bolsa trace from order detail payload', () {
      final detail = OrderDetail.fromJson({
        'id': 42,
        'numeroPedido': 1001,
        'clienteCode': 'C001',
        'clienteName': 'Cliente',
        'vendedorCode': '10',
        'fecha': '10/06/2026',
        'estado': 'CONFIRMADO',
        'tipoVenta': 'CC',
        'total': 24,
        'bolsaSummary': {
          'acumulacion': 4,
          'consumo': 0,
          'neto': 4,
          'movementCount': 1,
        },
        'bolsaMovements': [
          {
            'id': 99,
            'tipo': 'ACUMULACION',
            'importe': 4,
            'pedidoId': 42,
            'lineId': 7,
            'precioMinimoCongelado': 10,
            'precioVenta': 12,
            'cantidad': 2,
            'unidadMedida': 'CAJAS',
          }
        ],
        'lines': [
          {
            'id': 7,
            'codigoArticulo': 'P005',
            'descripcion': 'Producto bolsa',
            'cantidadEnvases': 2,
            'cantidadUnidades': 24,
            'unidadMedida': 'CAJAS',
            'unidadesCaja': 12,
            'precioVenta': 12,
            'precioMinimo': 10,
            'bolsaImpact': {
              'acumulacion': 4,
              'consumo': 0,
              'neto': 4,
              'movementCount': 1,
              'hasImpact': true,
            },
            'bolsaMovements': [
              {
                'id': 99,
                'tipo': 'ACUMULACION',
                'importe': 4,
                'lineId': 7,
              }
            ],
          }
        ],
      });

      expect(detail.bolsaSummary.acumulacion, 4);
      expect(detail.bolsaMovements.single.lineId, 7);
      expect(detail.lines.single.bolsaImpact.hasImpact, isTrue);
      expect(detail.lines.single.bolsaMovements.single.tipo, 'ACUMULACION');
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

    test('stores line minimum and cost in the selected sale unit', () {
      final provider = PedidosProvider();
      provider.setClient('4300010363', 'Cliente test');

      provider.addLine(
        Product(
          code: 'P006',
          name: 'Producto unidades',
          stockEnvases: 10,
          unitsPerBox: 12,
          precioTarifa1: 30,
          precioMinimo: 24,
          precioCosto: 12,
        ),
        0,
        5,
        'UNIDADES',
        2.5,
      );

      final line = provider.lines.single;
      expect(line.precioMinimo, 2);
      expect(line.precioCosto, 1);
      expect(line.billingQuantity, 5);
      expect(line.importeVenta, 12.5);
      expect(line.importeCosto, 5);
      expect(line.estimatedBolsaImpact.acumulacion, 2.5);
    });
  });

  group('PedidosProvider stock guard', () {
    test('addLine does not mutate cart when requested quantity exceeds stock',
        () {
      final provider = PedidosProvider();
      provider.setClient('4300010363', 'Cliente test');

      final result = provider.addLine(
        Product(
          code: 'STOCK-LIMIT-1',
          name: 'Producto stock limitado',
          stockEnvases: 2,
          unitsPerBox: 12,
          precioTarifa1: 10,
        ),
        3,
        36,
        'CAJAS',
        10,
      );

      expect(result, isNotNull);
      expect(
        provider.lines,
        isEmpty,
        reason:
            'Quick/strict add must not silently add a PARCIAL line when requested quantity exceeds stock.',
      );
    });

    test('addLine can still apply explicit partial when requested', () {
      final provider = PedidosProvider();
      provider.setClient('4300010363', 'Cliente test');
      final result = provider.addLine(
        Product(
            code: 'STOCK-PARTIAL-1',
            name: 'Producto parcial',
            stockEnvases: 2,
            unitsPerBox: 12,
            precioTarifa1: 10),
        3,
        36,
        'CAJAS',
        10,
        allowPartial: true,
      );
      expect(result, startsWith('PARCIAL:1'));
      expect(provider.lines, hasLength(1));
      expect(provider.lines.single.cantidadEnvases, 2);
    });

    test(
        'updateLine rejects dual-field quantities above stock without mutation',
        () {
      final provider = PedidosProvider();
      provider.setClient('4300010363', 'Cliente test');
      final product = Product(
          code: 'DUAL-STOCK-1',
          name: 'Producto dual',
          stockEnvases: 1,
          stockUnidades: 0,
          unitsPerBox: 12,
          unitsFraction: 1,
          precioTarifa1: 10);
      provider.addLine(product, 1, 0, 'CAJAS', 10);
      final result =
          provider.updateLine(0, cantidadEnvases: 2, cantidadUnidades: 0);
      expect(result, contains('Stock insuficiente'));
      expect(provider.lines.single.cantidadEnvases, 1);
      expect(provider.lines.single.cantidadUnidades, 0);
    });

    testWidgets(
        'UnitSelectorModal blocks accepting quantity above selected stock',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
          home: Builder(
              builder: (context) => ElevatedButton(
                  onPressed: () {
                    UnitSelectorModal.show(context,
                        product: Product(
                            code: 'MODAL-STOCK-1',
                            name: 'Producto modal',
                            stockEnvases: 1,
                            unitsPerBox: 12,
                            precioTarifa1: 10),
                        initialUnit: 'CAJAS',
                        initialQuantity: 2,
                        availableUnits: const ['CAJAS']);
                  },
                  child: const Text('open')))));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ACEPTAR'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Stock insuficiente'), findsOneWidget);
      expect(find.text('Seleccionar unidad y cantidad'), findsOneWidget);
    });

    testWidgets('UnitSelectorModal blocks normal accept when quantity is zero',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () {
                UnitSelectorModal.show(
                  context,
                  initialUnit: 'CAJAS',
                  initialQuantity: 0,
                  availableUnits: const ['CAJAS'],
                );
              },
              child: const Text('open zero'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open zero'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ACEPTAR'));
      await tester.pumpAndSettle();

      expect(find.text('Indica una cantidad valida.'), findsOneWidget);
      expect(find.text('Seleccionar unidad y cantidad'), findsOneWidget);
    });

    testWidgets(
        'UnitSelectorModal keeps explicit LIMPIAR zero quantity behavior',
        (tester) async {
      Future<Map<String, dynamic>?>? modalResult;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () {
                modalResult = UnitSelectorModal.show(
                  context,
                  initialUnit: 'CAJAS',
                  initialQuantity: 1,
                  availableUnits: const ['CAJAS'],
                );
              },
              child: const Text('open clear'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open clear'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('LIMPIAR'));
      await tester.pumpAndSettle();

      final result = await modalResult;
      expect(result, isNotNull);
      expect(result!['quantity'], 0.0);
      expect(result['cleared'], isTrue);
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

  group('PedidosService confirmation conflicts', () {
    test('maps bolsa-insufficient 409 to a typed blocked result', () async {
      final rejectingBolsaConflict = InterceptorsWrapper(
        onRequest: (options, handler) {
          handler.reject(
            DioException(
              requestOptions: options,
              response: Response<Map<String, dynamic>>(
                requestOptions: options,
                statusCode: 409,
                data: const {
                  'code': 'BOLSA_INSUFICIENTE',
                  'error': 'BOLSA_INSUFICIENTE',
                  'message': 'Saldo insuficiente en bolsa comercial',
                },
              ),
              type: DioExceptionType.badResponse,
            ),
          );
        },
      );
      ApiClient.dio.interceptors.add(rejectingBolsaConflict);
      addTearDown(() {
        ApiClient.dio.interceptors.remove(rejectingBolsaConflict);
      });

      final result = await PedidosService.confirmOrder(42, 'CC');

      expect(result['blocked'], isTrue);
      expect(result['code'], 'BOLSA_INSUFICIENTE');
      expect(result['reason'], 'BOLSA_INSUFICIENTE');
      expect(result['statusCode'], 409);
    });
  });

  group('PedidosProvider confirmation API contract', () {
    test('forwards selected delivery vehicle assignment to confirmation API',
        () async {
      final api = _RecordingOrderApi();
      final provider = PedidosProvider(
        orderApi: api,
        refreshAfterConfirm: false,
      );
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
    test('guards reentrant confirmation while a save is already in progress',
        () async {
      final api = _BlockingOrderApi();
      final provider = PedidosProvider(
        orderApi: api,
        refreshAfterConfirm: false,
      );
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

      final first = provider.confirmOrder('57');
      expect(api.createOrderCalls, 1);

      final second = provider.confirmOrder('57');

      api.createCompleter.complete({'id': 42, 'estado': 'BORRADOR'});
      await Future.wait([first, second]);

      expect(api.createOrderCalls, 1);
      expect(api.confirmOrderCalls, 1);
    });
  });
}
