import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../core/api/api_config.dart';
import '../domain/product_history_item.dart';

class SalesHistoryService {
  final http.Client client;

  SalesHistoryService({http.Client? client}) : client = client ?? http.Client();

  Future<Map<String, dynamic>> getSalesHistory({
    String? vendedorCodes,
    String? clientCode,
    String? productSearch,
    String? startDate,
    String? endDate,
    int limit = 100,
    int offset = 0,
  }) async {
    try {
      final queryParams = <String, String>{
        if (vendedorCodes != null) 'vendedorCodes': vendedorCodes,
        if (clientCode != null) 'clientCode': clientCode,
        if (productSearch != null && productSearch.isNotEmpty) 'productSearch': productSearch,
        if (startDate != null) 'startDate': startDate,
        if (endDate != null) 'endDate': endDate,
        'limit': limit.toString(),
        'offset': offset.toString(),
      };

      final uri = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.salesHistory}')
          .replace(queryParameters: queryParams);

      final response = await client.get(uri);

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final List<dynamic> rowsJson = data['rows'] ?? [];
        
        final items = rowsJson.map((json) => ProductHistoryItem.fromJson(json)).toList();
        final count = data['count'] as int? ?? 0;
        
        return {
          'items': items,
          'count': count,
        };
      } else {
        throw Exception('Failed to load sales history: ${response.statusCode}');
      }
    } catch (e) {
      throw Exception('Error fetching sales history: $e');
    }
  }

  Future<Map<String, dynamic>> getSalesHistorySummary({
    String? vendedorCodes,
    String? clientCode,
    String? productSearch,
    String? startDate,
    String? endDate,
  }) async {
    try {
      final queryParams = <String, String>{
        if (vendedorCodes != null) 'vendedorCodes': vendedorCodes,
        if (clientCode != null) 'clientCode': clientCode,
        if (productSearch != null && productSearch.isNotEmpty) 'productSearch': productSearch,
        if (startDate != null) 'startDate': startDate,
        if (endDate != null) 'endDate': endDate,
      };

      final uri = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.salesHistory}/summary')
          .replace(queryParameters: queryParams);

      final response = await client.get(uri);

      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      } else {
        throw Exception('Failed to load summary: ${response.statusCode}');
      }
    } catch (e) {
      throw Exception('Error fetching summary: $e');
    }
  }
}
