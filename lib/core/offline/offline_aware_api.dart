import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/offline/connectivity_provider.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';

/// Result of an offline-aware fetch operation.
class OfflineResult<T> {
  OfflineResult({
    required this.data,
    this.source = DataSource.cache,
    this.error,
  });

  final T data;
  final DataSource source;
  final String? error;

  bool get isFromNetwork => source == DataSource.network;
  bool get isFromCache => source == DataSource.cache;
  bool get isFromStale => source == DataSource.stale;
}

enum DataSource { network, cache, stale }

/// Offline-aware wrapper around ApiClient.
///
/// Implements the following strategy for READS:
/// 1. Try cache → if fresh (< 24h), yield immediately
/// 2. If online → fetch API → update cache → return network data
/// 3. If offline → return stale cache with warning
///
/// For WRITES:
/// 1. If online → send to API → update cache on success
/// 2. If offline → save to sync queue → return optimistic result
class OfflineAwareApi {
  const OfflineAwareApi._();

  /// GET with offline-first strategy.
  ///
  /// [cacheKey] is used for Hive cache storage.
  /// [cacheTTL] defaults to CacheService.longTTL (24h).
  /// Returns the data and a source indicator.
  static Future<OfflineResult<Map<String, dynamic>>> get(
    String endpoint, {
    Map<String, dynamic>? queryParameters,
    required String cacheKey,
    Duration? cacheTTL,
    bool forceRefresh = false,
  }) async {
    final isOnline = ConnectivityService.instance.currentStatus == ConnectivityStatus.online;

    // 1. Try fresh cache first (unless force refreshing)
    if (!forceRefresh) {
      try {
        final cached = CacheService.get<Map<String, dynamic>>(cacheKey);
        if (cached != null) {
          debugPrint('[OfflineAware] Cache HIT: $endpoint');
          return OfflineResult(data: _deepCastMap(cached), source: DataSource.cache);
        }
      } catch (_) {}
    }

    // 2. If online, fetch from API
    if (isOnline) {
      try {
        final response = await ApiClient.get(
          endpoint,
          queryParameters: queryParameters,
          cacheKey: cacheKey,
          cacheTTL: cacheTTL,
          forceRefresh: forceRefresh,
        );
        return OfflineResult(data: response, source: DataSource.network);
      } catch (e) {
        // Network error — fall through to stale cache
        debugPrint('[OfflineAware] Network error, trying stale: $e');
      }
    }

    // 3. Try stale cache (offline or network error)
    try {
      final stale = CacheService.getStale<Map<String, dynamic>>(cacheKey);
      if (stale != null) {
        debugPrint('[OfflineAware] Stale cache HIT: $endpoint');
        return OfflineResult(
          data: _deepCastMap(stale),
          source: DataSource.stale,
          error: isOnline ? 'Error de red. Mostrando datos guardados.' : 'Sin conexión. Mostrando datos guardados.',
        );
      }
    } catch (_) {}

    // 4. Nothing — throw
    throw OfflineException('No hay datos disponibles. Conéctate a internet y vuelve a intentarlo.');
  }

  /// GET with offline-first strategy for List responses.
  static Future<OfflineResult<List<dynamic>>> getList(
    String endpoint, {
    Map<String, dynamic>? queryParameters,
    required String cacheKey,
    Duration? cacheTTL,
    bool forceRefresh = false,
  }) async {
    final isOnline = ConnectivityService.instance.currentStatus == ConnectivityStatus.online;

    if (!forceRefresh) {
      try {
        final cached = CacheService.get<List<dynamic>>(cacheKey);
        if (cached != null) {
          return OfflineResult(data: cached, source: DataSource.cache);
        }
      } catch (_) {}
    }

    if (isOnline) {
      try {
        final response = await ApiClient.getList(
          endpoint,
          queryParameters: queryParameters,
          cacheKey: cacheKey,
          cacheTTL: cacheTTL,
          forceRefresh: forceRefresh,
        );
        return OfflineResult(data: response, source: DataSource.network);
      } catch (e) {
        debugPrint('[OfflineAware] Network error, trying stale: $e');
      }
    }

    try {
      final stale = CacheService.getStale<List<dynamic>>(cacheKey);
      if (stale != null) {
        return OfflineResult(
          data: stale,
          source: DataSource.stale,
          error: isOnline ? 'Error de red. Mostrando datos guardados.' : 'Sin conexión. Mostrando datos guardados.',
        );
      }
    } catch (_) {}

    throw OfflineException('No hay datos disponibles. Conéctate a internet y vuelve a intentarlo.');
  }

  /// POST with offline support: if online, send directly;
  /// if offline, queue for later sync.
  static Future<Map<String, dynamic>> post(
    String endpoint,
    Map<String, dynamic> data, {
    String? syncType,
    String? cacheKey,
  }) async {
    final isOnline = ConnectivityService.instance.currentStatus == ConnectivityStatus.online;

    if (isOnline) {
      try {
        final response = await ApiClient.post(endpoint, data);
        // Update cache if cacheKey provided
        if (cacheKey != null) {
          await CacheService.set(cacheKey, response, ttl: CacheService.shortTTL);
        }
        return response;
      } catch (e) {
        // If server error (not network), rethrow
        if (e is ApiException && e.statusCode != null && e.statusCode! >= 500) {
          rethrow;
        }
        // Network error — fall through to queue
      }
    }

    // Offline: queue for later sync
    final operation = SyncOperation(
      id: '${syncType ?? 'op'}_${DateTime.now().microsecondsSinceEpoch}',
      type: syncType ?? 'mutation',
      endpoint: endpoint,
      method: 'POST',
      payload: data,
    );
    await SyncQueueService.instance.enqueue(operation);
    debugPrint('[OfflineAware] Queued for sync: $endpoint');

    return {'success': true, 'queued': true, 'syncId': operation.id};
  }

  /// PUT with offline support.
  static Future<Map<String, dynamic>> put(
    String endpoint, {
    Map<String, dynamic>? data,
    String? syncType,
    String? cacheKey,
  }) async {
    final isOnline = ConnectivityService.instance.currentStatus == ConnectivityStatus.online;

    if (isOnline) {
      try {
        final response = await ApiClient.put(endpoint, data: data);
        if (cacheKey != null) {
          await CacheService.set(cacheKey, response, ttl: CacheService.shortTTL);
        }
        return response;
      } catch (e) {
        if (e is ApiException && e.statusCode != null && e.statusCode! >= 500) {
          rethrow;
        }
      }
    }

    final operation = SyncOperation(
      id: '${syncType ?? 'op'}_${DateTime.now().microsecondsSinceEpoch}',
      type: syncType ?? 'mutation',
      endpoint: endpoint,
      method: 'PUT',
      payload: data ?? {},
    );
    await SyncQueueService.instance.enqueue(operation);
    return {'success': true, 'queued': true, 'syncId': operation.id};
  }

  static Map<String, dynamic> _deepCastMap(Map src) {
    return src.map((k, v) => MapEntry(k.toString(), _deepCastValue(v)));
  }

  static dynamic _deepCastValue(dynamic v) {
    if (v is Map) return _deepCastMap(v);
    if (v is List) return v.map(_deepCastValue).toList();
    return v;
  }
}

class OfflineException implements Exception {
  OfflineException(this.message);
  final String message;
  @override
  String toString() => message;
}
