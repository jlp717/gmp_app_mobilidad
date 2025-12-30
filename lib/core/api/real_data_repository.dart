import 'package:gmp_app_mobilidad/core/api/api_client.dart';

class RealDataRepository {
  // Obtener lista de clientes REALES
  Future<List<Map<String, dynamic>>> getClientes() async {
    final data = await ApiClient.get('/clientes');
    return List<Map<String, dynamic>>.from(data);
  }

  // Obtener rutero del día (clientes a visitar)
  Future<List<Map<String, dynamic>>> getRutero() async {
    final data = await ApiClient.get('/rutero');
    return List<Map<String, dynamic>>.from(data);
  }

  // Obtener detalle completo de un cliente
  Future<Map<String, dynamic>> getClienteDetalle(String clienteId) async {
    final data = await ApiClient.get('/cliente/$clienteId');
    return Map<String, dynamic>.from(data);
  }

  // Obtener estadísticas de ventas
  Future<Map<String, dynamic>> getVentasStats() async {
    final data = await ApiClient.get('/ventas/stats');
    return Map<String, dynamic>.from(data);
  }

  // Obtener productos
  Future<List<Map<String, dynamic>>> getProductos() async {
    final data = await ApiClient.get('/productos');
    return List<Map<String, dynamic>>.from(data);
  }
}
