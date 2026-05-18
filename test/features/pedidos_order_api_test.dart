import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_order_api.dart';

void main() {
  group('PedidosOrderApi', () {
    test('PedidosServiceOrderApi implements PedidosOrderApi', () {
      final api = PedidosServiceOrderApi();
      expect(api, isA<PedidosOrderApi>());
    });

    test('PedidosServiceOrderApi.createOrder accepts correct parameters', () {
      final api = PedidosServiceOrderApi();
      expect(
        () => api.createOrder(
          clientCode: 'CLI001',
          clientName: 'Test Client',
          vendedorCode: '10',
          tipoVenta: 'CC',
          lines: [],
          observaciones: '',
        ),
        returnsNormally,
      );
    });
  });
}
