import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
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
/// 3. If limited/offline → return stale cache with warning
///
/// For WRITES:
/// 1. If online → send to API → update cache on success
/// 2. If limited/offline → save to sync queue → return optimistic result
class OfflineAwareApi {
  const OfflineAwareApi._();

  /// Whether we have verified real connectivity (not just a network interface).
  static bool get _isOnline =>
      ConnectivityService.instance.currentStatus == ConnectivityStatus.online;

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
    CancelToken? cancelToken,
  }) async {
    if (forceRefresh) {
      await CacheService.invalidate(cacheKey);
    }

    // 1. Try fresh cache first (unless force refreshing)
    if (!forceRefresh) {
      try {
        final cached = CacheService.get<Map<String, dynamic>>(cacheKey);
        if (cached != null) {
          debugPrint('[OfflineAware] Cache HIT: $endpoint');
          return OfflineResult(
              data: _deepCastMap(cached), source: DataSource.cache);
        }
      } catch (_) {}
    }

    // 2. If online (verified), fetch from API
    if (_isOnline) {
      try {
        final response = await ApiClient.get(
          endpoint,
          queryParameters: queryParameters,
          cacheKey: cacheKey,
          cacheTTL: cacheTTL,
          forceRefresh: forceRefresh,
          cancelToken: cancelToken,
        );
        return OfflineResult(data: response, source: DataSource.network);
      } catch (e) {
        // Network error — fall through to stale cache
        if (forceRefresh) rethrow;
        debugPrint('[OfflineAware] Network error, trying stale: $e');
      }
    }

    // 3. Try stale cache (offline, limited, or network error)
    if (!forceRefresh) {
      try {
        final stale = CacheService.getStale<Map<String, dynamic>>(cacheKey);
        if (stale != null) {
          final status = ConnectivityService.instance.currentStatus;
          final errorLabel = status == ConnectivityStatus.limited
              ? 'Conexión limitada. Mostrando datos guardados.'
              : status == ConnectivityStatus.offline
                  ? 'Sin conexión. Mostrando datos guardados.'
                  : 'Error de red. Mostrando datos guardados.';
          debugPrint('[OfflineAware] Stale cache HIT: $endpoint');
          return OfflineResult(
            data: _deepCastMap(stale),
            source: DataSource.stale,
            error: errorLabel,
          );
        }
      } catch (_) {}
    }

    // 4. Nothing — throw
    final status = ConnectivityService.instance.currentStatus;
    final msg = status == ConnectivityStatus.limited
        ? 'No hay datos disponibles y la conexión es limitada.'
        : 'No hay datos disponibles. Conéctate a internet y vuelve a intentarlo.';
    throw OfflineException(msg);
  }

  /// GET with offline-first strategy for List responses.
  static Future<OfflineResult<List<dynamic>>> getList(
    String endpoint, {
    Map<String, dynamic>? queryParameters,
    required String cacheKey,
    Duration? cacheTTL,
    bool forceRefresh = false,
    CancelToken? cancelToken,
  }) async {
    if (forceRefresh) {
      await CacheService.invalidate(cacheKey);
    }

    if (!forceRefresh) {
      try {
        final cached = CacheService.get<List<dynamic>>(cacheKey);
        if (cached != null) {
          return OfflineResult(data: cached, source: DataSource.cache);
        }
      } catch (_) {}
    }

    if (_isOnline) {
      try {
        final response = await ApiClient.getList(
          endpoint,
          queryParameters: queryParameters,
          cacheKey: cacheKey,
          cacheTTL: cacheTTL,
          forceRefresh: forceRefresh,
          cancelToken: cancelToken,
        );
        return OfflineResult(data: response, source: DataSource.network);
      } catch (e) {
        if (forceRefresh) rethrow;
        debugPrint('[OfflineAware] Network error, trying stale: $e');
      }
    }

    if (!forceRefresh) {
      try {
        final stale = CacheService.getStale<List<dynamic>>(cacheKey);
        if (stale != null) {
          final status = ConnectivityService.instance.currentStatus;
          final errorLabel = status == ConnectivityStatus.limited
              ? 'Conexión limitada. Mostrando datos guardados.'
              : status == ConnectivityStatus.offline
                  ? 'Sin conexión. Mostrando datos guardados.'
                  : 'Error de red. Mostrando datos guardados.';
          return OfflineResult(
            data: stale,
            source: DataSource.stale,
            error: errorLabel,
          );
        }
      } catch (_) {}
    }

    final status = ConnectivityService.instance.currentStatus;
    final msg = status == ConnectivityStatus.limited
        ? 'No hay datos disponibles y la conexión es limitada.'
        : 'No hay datos disponibles. Conéctate a internet y vuelve a intentarlo.';
    throw OfflineException(msg);
  }

  /// POST with offline support: if online, send directly;
  /// if limited/offline, queue for later sync.
  static Future<Map<String, dynamic>> post(
    String endpoint,
    Map<String, dynamic> data, {
    String? syncType,
    String? cacheKey,
    Map<String, String>? headers,
    bool idempotent = false,
    Map<String, dynamic>? queueExtras,
  }) async {
    if (_isOnline) {
      try {
        final response = await ApiClient.post(
          endpoint,
          data,
          headers: headers,
          idempotent: idempotent,
        );
        // Update cache if cacheKey provided
        if (cacheKey != null) {
          await CacheService.set(cacheKey, response,
              ttl: CacheService.shortTTL);
        }
        return response;
      } catch (e) {
        if (!_shouldQueueMutationFailure(e)) {
          rethrow;
        }
        // Verified network/timeout/server-unreachable error - fall through to queue.
      }
    }

    // Offline/limited: queue for later sync with a stable clientRequestId
    final operationId =
        '${syncType ?? 'op'}_${DateTime.now().microsecondsSinceEpoch}';
    final queuedPayload = Map<String, dynamic>.from(data);
    if (queueExtras != null) {
      queuedPayload.addAll(queueExtras);
    }
    queuedPayload.putIfAbsent('clientRequestId', () => operationId);
    final operation = SyncOperation(
      id: operationId,
      type: syncType ?? 'mutation',
      endpoint: endpoint,
      method: 'POST',
      payload: queuedPayload,
      headers: headers == null ? null : Map<String, String>.from(headers),
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
    if (_isOnline) {
      try {
        final response = await ApiClient.put(endpoint, data: data);
        if (cacheKey != null) {
          await CacheService.set(cacheKey, response,
              ttl: CacheService.shortTTL);
        }
        return response;
      } catch (e) {
        if (!_shouldQueueMutationFailure(e)) {
          rethrow;
        }
      }
    }

    final operationId =
        '${syncType ?? 'op'}_${DateTime.now().microsecondsSinceEpoch}';
    final queuedPayload = Map<String, dynamic>.from(data ?? {});
    queuedPayload.putIfAbsent('clientRequestId', () => operationId);
    final operation = SyncOperation(
      id: operationId,
      type: syncType ?? 'mutation',
      endpoint: endpoint,
      method: 'PUT',
      payload: queuedPayload,
    );
    await SyncQueueService.instance.enqueue(operation);
    return {'success': true, 'queued': true, 'syncId': operation.id};
  }

  /// DELETE with offline support.
  static Future<Map<String, dynamic>> delete(
    String endpoint, {
    String? syncType,
    String? cacheKey,
  }) async {
    if (_isOnline) {
      try {
        final response = await ApiClient.delete(endpoint);
        if (cacheKey != null) {
          await CacheService.invalidate(cacheKey);
        }
        return response;
      } catch (e) {
        if (!_shouldQueueMutationFailure(e)) {
          rethrow;
        }
      }
    }

    final operationId =
        '${syncType ?? 'op'}_${DateTime.now().microsecondsSinceEpoch}';
    final operation = SyncOperation(
      id: operationId,
      type: syncType ?? 'mutation',
      endpoint: endpoint,
      method: 'DELETE',
      payload: {'clientRequestId': operationId},
    );
    await SyncQueueService.instance.enqueue(operation);
    debugPrint('[OfflineAware] Queued DELETE for sync: $endpoint');

    return {'success': true, 'queued': true, 'syncId': operation.id};
  }

  static bool _shouldQueueMutationFailure(Object error) {
    if (error is ApiException) {
      return error.statusCode == 0;
    }
    return false;
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
