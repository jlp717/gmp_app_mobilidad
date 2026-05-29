/// Clients Service - centralizes client-related API calls
/// Used by client_detail_page and simple_client_list_page
library;

import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart';

class ClientsService {
  /// Fetch client list with optional search and vendor filter
  static Future<List<Map<String, dynamic>>> getClientsList({
    String? vendedorCodes,
    String? search,
    int limit = 1000,
    bool forceRefresh = false,
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

    final scopeKey = (vendedorCodes == null || vendedorCodes.isEmpty)
        ? 'ALL'
        : vendedorCodes
            .split(',')
            .map((code) => code.trim())
            .where((code) => code.isNotEmpty)
            .join('_');
    final searchKey = (search == null || search.isEmpty) ? 'none' : search;

    final result = await OfflineAwareApi.get(
      ApiConfig.clientsList,
      queryParameters: params,
      cacheKey: 'clients_list_v2_${scopeKey}_${limit}_$searchKey',
      cacheTTL: const Duration(minutes: 5),
      forceRefresh: forceRefresh,
    );

    final rawList = result.data['clients'] ?? [];
    return (rawList as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
  }

  /// Fetch detailed client information
  static Future<Map<String, dynamic>> getClientDetail({
    required String clientCode,
    required String vendedorCodes,
  }) async {
    return ApiClient.get(
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
    await OfflineAwareApi.put(
      '${ApiConfig.clientDetail}/$clientCode/notes',
      data: {
        'notes': notes,
        'vendorCode': vendorCode,
      },
      syncType: 'update_client_notes',
    );
  }

  /// Fetch client sales history
  /// [groupByFamily] - 0 = no grouping (products), 1 = family1, 2 = family1+2, 3 = family1+2+3, 13 = family1+3
  static Future<List<Map<String, dynamic>>> getClientSalesHistory({
    required String clientCode,
    required String vendedorCodes,
    int limit = 50,
    int groupByFamily = 0,
  }) async {
    final response = await ApiClient.get(
      '${ApiConfig.clientDetail}/$clientCode/sales-history',
      queryParameters: {
        'vendedorCodes': vendedorCodes,
        'limit': limit.toString(),
        'groupByFamily': groupByFamily.toString(),
      },
    );
    final rawList = response['history'] ?? [];
    final isGrouped = response['grouped'] ?? false;
    final result = (rawList as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    if (isGrouped) {
      return result
          .map((item) => {
                ...item,
                'productName': item['family1'] ?? 'Sin familia',
                'productCode': '',
              })
          .toList();
    }
    return result;
  }

  /// Fetch products within a specific family
  static Future<List<Map<String, dynamic>>> getProductsByFamily({
    required String clientCode,
    required String vendedorCodes,
    required String family1,
    String? family2,
    String? family3,
    required int groupLevel,
    int limit = 100,
  }) async {
    final params = <String, dynamic>{
      'vendedorCodes': vendedorCodes,
      'limit': limit.toString(),
      'family1': family1,
      'groupLevel': groupLevel.toString(),
    };
    if (family2 != null && family2.isNotEmpty) params['family2'] = family2;
    if (family3 != null && family3.isNotEmpty) params['family3'] = family3;

    final response = await ApiClient.get(
      '${ApiConfig.clientDetail}/$clientCode/sales-history/family',
      queryParameters: params,
    );
    return ((response['products'] as List?) ?? [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
  }

  /// Fetch sales summary for a client
  static Future<Map<String, dynamic>> getSalesSummary({
    required String clientCode,
    required String vendedorCodes,
  }) async {
    return ApiClient.get(
      '/sales-history/summary',
      queryParameters: {
        'clientCode': clientCode,
        'vendedorCodes': vendedorCodes,
      },
    );
  }
}
