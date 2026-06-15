import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

/// Narrow order API used by pedido providers.
///
/// This keeps confirmation flows testable without mocking static service
/// methods.
abstract class PedidosOrderApi {
  /// Creates a draft order in backend storage.
  Future<Map<String, dynamic>> createOrder({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    required String tipoVenta,
    required List<OrderLine> lines,
    required String observaciones,
    String? clientRequestId,
  });

  /// Confirms an existing order and returns the backend confirmation response.
  Future<Map<String, dynamic>> confirmOrder(
    int orderId,
    String saleType, {
    String? deliveryDate,
    String? vehicleCode,
    String? driverCode,
    String? routeCode,
  });
}

/// Default [PedidosOrderApi] implementation backed by [PedidosService].
class PedidosServiceOrderApi implements PedidosOrderApi {
  /// Creates the service adapter.
  const PedidosServiceOrderApi();

  @override
  Future<Map<String, dynamic>> createOrder({
    required String clientCode,
    required String clientName,
    required String vendedorCode,
    required String tipoVenta,
    required List<OrderLine> lines,
    required String observaciones,
    String? clientRequestId,
  }) {
    return PedidosService.createOrder(
      clientCode: clientCode,
      clientName: clientName,
      vendedorCode: vendedorCode,
      tipoVenta: tipoVenta,
      lines: lines,
      observaciones: observaciones,
      clientRequestId: clientRequestId,
    );
  }

  @override
  Future<Map<String, dynamic>> confirmOrder(
    int orderId,
    String saleType, {
    String? deliveryDate,
    String? vehicleCode,
    String? driverCode,
    String? routeCode,
  }) {
    return PedidosService.confirmOrder(
      orderId,
      saleType,
      deliveryDate: deliveryDate,
      vehicleCode: vehicleCode,
      driverCode: driverCode,
      routeCode: routeCode,
    );
  }
}
