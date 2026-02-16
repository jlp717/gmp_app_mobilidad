/// Clients Service - centralizes client-related API calls
/// Used by client_detail_page and simple_client_list_page

import '../../../core/api/api_client.dart';
import '../../../core/api/api_config.dart';

class ClientsService {
  /// Fetch client list with optional search and vendor filter
  static Future<List<Map<String, dynamic>>> getClientsList({
    String? vendedorCodes,
    String? search,
    int limit = 1000,
  }) async {
    final params = <String, dynamic>{
      'limit': limit.toString(),
    };
    if (vendedorCodes != null && vendedorCodes.isNotEmpty) {
      params['vendedorCodes'] = vendedorCodes;
    }
    if (search != null && search.isNotEmpty) {
      params['search'] = search;
    }

    final response = await ApiClient.get(
      ApiConfig.clientsList,
      queryParameters: params,
      cacheKey: 'clients_list_${vendedorCodes ?? "ALL"}_${search ?? ''}',
      cacheTTL: const Duration(minutes: 5),
    );

    final rawList = response['clients'] ?? [];
    return (rawList as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
  }

  /// Fetch detailed client information
  static Future<Map<String, dynamic>> getClientDetail({
    required String clientCode,
    required String vendedorCodes,
  }) async {
    return await ApiClient.get(
      '${ApiConfig.clientDetail}/$clientCode',
      queryParameters: {'vendedorCodes': vendedorCodes},
    );
  }

  /// Update client notes
  static Future<void> updateClientNotes({
    required String clientCode,
    required String notes,
    required String vendorCode,
  }) async {
    await ApiClient.put(
      '${ApiConfig.clientDetail}/$clientCode/notes',
      data: {
        'notes': notes,
        'vendorCode': vendorCode,
      },
    );
  }

  /// Fetch client sales history
  static Future<List<Map<String, dynamic>>> getClientSalesHistory({
    required String clientCode,
    required String vendedorCodes,
    int limit = 50,
  }) async {
    final response = await ApiClient.get(
      '${ApiConfig.clientDetail}/$clientCode/sales-history',
      queryParameters: {
        'vendedorCodes': vendedorCodes,
        'limit': limit.toString(),
      },
    );
    final rawList = response['history'] ?? [];
    return (rawList as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
  }

  /// Fetch sales summary for a client
  static Future<Map<String, dynamic>> getSalesSummary({
    required String clientCode,
    required String vendedorCodes,
  }) async {
    return await ApiClient.get(
      '/sales-history/summary',
      queryParameters: {
        'clientCode': clientCode,
        'vendedorCodes': vendedorCodes,
      },
    );
  }
}
