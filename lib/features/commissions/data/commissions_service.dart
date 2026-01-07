import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';

class CommissionsService {
  /// Get Commissions Summary
  static Future<Map<String, dynamic>> getSummary({required String vendedorCode, int year = 2026}) async {
    try {
      final response = await ApiClient.get(
        '/commissions/summary', 
        queryParameters: {
          'vendedorCode': vendedorCode,
          'year': year.toString(),
        }
      );
      return response;
    } catch (e) {
      throw Exception('Error cargando comisiones: $e');
    }
  }

  static Future<List<dynamic>> getVendedores() async {
    try {
      final response = await ApiClient.get('/vendedores');
      // Response is { period: {...}, vendedores: [...] }
      if (response is Map && response.containsKey('vendedores')) {
        return response['vendedores'] as List<dynamic>;
      }
      return [];
    } catch (e) {
      print('Error loading vendors: $e');
      return [];
    }
  }
}
