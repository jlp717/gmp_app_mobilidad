/// Sales History Service - OPTIMIZED
/// ================================
/// Refactored to use ApiClient with full caching support
/// Replaces raw http.Client for consistency and performance

import '../../../core/api/api_client.dart';
import '../../../core/cache/cache_service.dart';
import '../domain/product_history_item.dart';

class SalesHistoryService {
  // Singleton pattern - no need for http.Client instance
  SalesHistoryService();

  /// Get sales history with caching
  /// TTL: 10 minutes (balance between freshness and performance)
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
      final queryParams = <String, dynamic>{
        if (vendedorCodes != null) 'vendedorCodes': vendedorCodes,
        if (clientCode != null) 'clientCode': clientCode,
        if (productSearch != null && productSearch.isNotEmpty) 'productSearch': productSearch,
        if (startDate != null) 'startDate': startDate,
        if (endDate != null) 'endDate': endDate,
        'limit': limit.toString(),
        'offset': offset.toString(),
      };

      // Generate cache key from params
      final cacheKey = 'sales_history_${vendedorCodes ?? 'all'}_${clientCode ?? 'all'}_${startDate ?? ''}_${endDate ?? ''}_${limit}_$offset';

      final response = await ApiClient.get(
        '/sales-history',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 10),
      );

      final List<dynamic> rowsJson = (response['rows'] as List?) ?? [];
      final items = rowsJson.map((json) => ProductHistoryItem.fromJson(json as Map<String, dynamic>)).toList();
      final count = response['count'] as int? ?? 0;
      
      return {
        'items': items,
        'count': count,
      };
    } catch (e) {
      throw Exception('Error fetching sales history: $e');
    }
  }

  /// Get sales history summary with caching
  /// TTL: 10 minutes
  Future<Map<String, dynamic>> getSalesHistorySummary({
    String? vendedorCodes,
    String? clientCode,
    String? productSearch,
    String? startDate,
    String? endDate,
  }) async {
    try {
      final queryParams = <String, dynamic>{
        if (vendedorCodes != null) 'vendedorCodes': vendedorCodes,
        if (clientCode != null) 'clientCode': clientCode,
        if (productSearch != null && productSearch.isNotEmpty) 'productSearch': productSearch,
        if (startDate != null) 'startDate': startDate,
        if (endDate != null) 'endDate': endDate,
      };

      final cacheKey = 'sales_history_summary_${vendedorCodes ?? 'all'}_${clientCode ?? 'all'}_${startDate ?? ''}_${endDate ?? ''}';

      return await ApiClient.get(
        '/sales-history/summary',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 10),
      );
    } catch (e) {
      throw Exception('Error fetching summary: $e');
    }
  }
}
