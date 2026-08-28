/// Sales History Service - OPTIMIZED
/// ================================
/// Refactored to use ApiClient with full caching support
/// Replaces raw http.Client for consistency and performance
library;

import 'dart:convert';

import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/sales_history/domain/product_history_item.dart';

/// Injectable API read contract; defaults to the shared, scoped ApiClient.
typedef SalesHistoryGet = Future<Map<String, dynamic>> Function(
  String endpoint, {
  Map<String, dynamic>? queryParameters,
  String? cacheKey,
  Duration? cacheTTL,
});

/// Reads detailed sales and summaries through the shared API/cache layer.
class SalesHistoryService {
  /// Allows isolated tests to replace reads without creating network traffic.
  SalesHistoryService({SalesHistoryGet? get}) : _get = get ?? ApiClient.get;

  final SalesHistoryGet _get;

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
        if (productSearch != null && productSearch.isNotEmpty)
          'productSearch': productSearch,
        if (startDate != null) 'startDate': startDate,
        if (endDate != null) 'endDate': endDate,
        'limit': limit.toString(),
        'offset': offset.toString(),
      };

      // Generate cache key from params
      final cacheKey = 'sales_history_v2_${jsonEncode(queryParams)}';

      final response = await _get(
        '/sales-history',
        queryParameters: queryParams,
        cacheKey: cacheKey,
        cacheTTL: const Duration(minutes: 10),
      );

      final rowsJson = (response['rows'] as List?) ?? [];
      final items = rowsJson
          .map(
            (json) => ProductHistoryItem.fromJson(json as Map<String, dynamic>),
          )
          .toList();
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
        if (productSearch != null && productSearch.isNotEmpty)
          'productSearch': productSearch,
        if (startDate != null) 'startDate': startDate,
        if (endDate != null) 'endDate': endDate,
      };

      final cacheKey = 'sales_history_summary_v2_${jsonEncode(queryParams)}';

      return await _get(
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
