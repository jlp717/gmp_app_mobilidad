import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'api_config.dart';
import '../cache/cache_service.dart';

/// API Client for all backend communications
/// Enhanced with retry logic and cache integration
class ApiClient {
  static Dio? _dio;
  static int _maxRetries = 3;
  static Duration _retryDelay = const Duration(seconds: 1);

  /// Initialize or get Dio instance
  static Dio get dio {
    _dio ??= _createDio();
    return _dio!;
  }

  /// Create Dio instance with interceptors
  static Dio _createDio() {
    final dio = Dio(BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: ApiConfig.connectTimeout,
      receiveTimeout: ApiConfig.receiveTimeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ));

    // Add retry interceptor
    dio.interceptors.add(_RetryInterceptor(dio, _maxRetries, _retryDelay));

    // Add logging interceptor in debug mode
    if (kDebugMode) {
      dio.interceptors.add(LogInterceptor(
        requestBody: false,
        responseBody: false,
        logPrint: (log) => debugPrint('[API] $log'),
      ));
    }

    return dio;
  }

  /// Reinitialize Dio (useful when base URL changes)
  static void reinitialize() {
    _dio = null;
  }

  /// Set authentication token
  static void setAuthToken(String token) {
    dio.options.headers['Authorization'] = 'Bearer $token';
  }

  /// Clear authentication token
  static void clearAuthToken() {
    dio.options.headers.remove('Authorization');
  }

  /// GET request with optional caching
  /// 
  /// [cacheKey] - If provided, response will be cached and returned from cache if valid
  /// [cacheTTL] - Cache time-to-live, defaults to CacheService.defaultTTL
  /// [forceRefresh] - If true, bypasses cache and fetches fresh data
  static Future<Map<String, dynamic>> get(
    String endpoint, {
    Map<String, dynamic>? queryParameters,
    String? cacheKey,
    Duration? cacheTTL,
    bool forceRefresh = false,
  }) async {
    // Try cache first if cacheKey provided and not forcing refresh
    if (cacheKey != null && !forceRefresh) {
      final cached = CacheService.get<Map<String, dynamic>>(cacheKey);
      if (cached != null) {
        debugPrint('[ApiClient] Returning cached response for: $cacheKey');
        return cached;
      }
    }

    try {
      final response = await dio.get(
        endpoint,
        queryParameters: queryParameters,
      );
      final data = response.data as Map<String, dynamic>;

      // Cache the response if cacheKey provided
      if (cacheKey != null) {
        await CacheService.set(cacheKey, data, ttl: cacheTTL);
      }

      return data;
    } on DioException catch (e) {
      // On network error, try to return cached data if available
      if (cacheKey != null && _isNetworkError(e)) {
        final cached = CacheService.get<Map<String, dynamic>>(cacheKey);
        if (cached != null) {
          debugPrint('[ApiClient] Network error, returning stale cache for: $cacheKey');
          return cached;
        }
      }
      throw _handleError(e);
    }
  }

  /// GET request that returns a List
  static Future<List<dynamic>> getList(
    String endpoint, {
    Map<String, dynamic>? queryParameters,
    String? cacheKey,
    Duration? cacheTTL,
    bool forceRefresh = false,
  }) async {
    // Try cache first if cacheKey provided and not forcing refresh
    if (cacheKey != null && !forceRefresh) {
      final cached = CacheService.get<List<dynamic>>(cacheKey);
      if (cached != null) {
        debugPrint('[ApiClient] Returning cached list for: $cacheKey');
        return cached;
      }
    }

    try {
      final response = await dio.get(
        endpoint,
        queryParameters: queryParameters,
      );
      
      final data = response.data;
      List<dynamic> result;
      
      if (data is List) {
        result = data;
      } else if (data is Map && data.containsKey('data')) {
        result = data['data'] as List<dynamic>;
      } else {
        result = [data];
      }

      // Cache the response if cacheKey provided
      if (cacheKey != null) {
        await CacheService.set(cacheKey, result, ttl: cacheTTL);
      }

      return result;
    } on DioException catch (e) {
      // On network error, try to return cached data if available
      if (cacheKey != null && _isNetworkError(e)) {
        final cached = CacheService.get<List<dynamic>>(cacheKey);
        if (cached != null) {
          debugPrint('[ApiClient] Network error, returning stale cache list for: $cacheKey');
          return cached;
        }
      }
      throw _handleError(e);
    }
  }

  /// POST request (never cached)
  static Future<Map<String, dynamic>> post(
    String endpoint,
    Map<String, dynamic> data,
  ) async {
    try {
      final fullUrl = '${dio.options.baseUrl}$endpoint';
      debugPrint('[ApiClient] POST $fullUrl');
      
      final response = await dio.post(endpoint, data: data);
      
      debugPrint('[ApiClient] Response status: ${response.statusCode}');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      debugPrint('[ApiClient] DioException: ${e.type} - ${e.message}');
      throw _handleError(e);
    } catch (e) {
      debugPrint('[ApiClient] Unexpected error: $e');
      rethrow;
    }
  }

  static bool _isNetworkError(DioException e) {
    return e.type == DioExceptionType.connectionError ||
           e.type == DioExceptionType.connectionTimeout ||
           e.type == DioExceptionType.unknown;
  }

  static String _handleError(DioException e) {
    if (e.type == DioExceptionType.connectionTimeout) {
      return 'Timeout de conexión - Verifica tu red';
    } else if (e.type == DioExceptionType.connectionError) {
      return 'Error de conexión - Verifica tu red WiFi';
    } else if (e.type == DioExceptionType.receiveTimeout) {
      return 'El servidor está tardando demasiado';
    } else if (e.response != null) {
      final statusCode = e.response?.statusCode;
      final data = e.response?.data;
      
      // Extract server error message
      String? serverMessage;
      if (data is Map<String, dynamic>) {
        serverMessage = data['error'] as String? ?? data['message'] as String?;
      }
      
      if (statusCode == 400) {
        return serverMessage ?? 'Solicitud incorrecta';
      } else if (statusCode == 401) {
        return serverMessage ?? 'Credenciales inválidas';
      } else if (statusCode == 403) {
        return serverMessage ?? 'Acceso denegado';
      } else if (statusCode == 404) {
        return serverMessage ?? 'Recurso no encontrado';
      } else if (statusCode == 429) {
        return serverMessage ?? 'Demasiados intentos - Espera un momento';
      } else if (statusCode == 500) {
        return serverMessage ?? 'Error del servidor';
      }
      return serverMessage ?? 'Error: $statusCode';
    } else if (e.type == DioExceptionType.unknown) {
      if (e.error.toString().contains('SocketException')) {
        return 'No se pudo conectar al servidor';
      }
    }
    return 'Error de red';
  }
}

/// Retry interceptor for handling transient failures
class _RetryInterceptor extends Interceptor {
  final Dio _dio;
  final int _maxRetries;
  final Duration _retryDelay;

  _RetryInterceptor(this._dio, this._maxRetries, this._retryDelay);

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final shouldRetry = _shouldRetry(err);
    final retryCount = err.requestOptions.extra['retryCount'] as int? ?? 0;

    if (shouldRetry && retryCount < _maxRetries) {
      debugPrint('[ApiClient] Retrying request (${retryCount + 1}/$_maxRetries)...');
      
      // Exponential backoff
      final delay = _retryDelay * (retryCount + 1);
      await Future<void>.delayed(delay);

      try {
        err.requestOptions.extra['retryCount'] = retryCount + 1;
        final response = await _dio.fetch(err.requestOptions);
        handler.resolve(response);
        return;
      } catch (e) {
        // Continue with normal error handling
      }
    }

    handler.next(err);
  }

  bool _shouldRetry(DioException err) {
    // Retry on network errors and 5xx server errors
    if (err.type == DioExceptionType.connectionError ||
        err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.receiveTimeout) {
      return true;
    }

    final statusCode = err.response?.statusCode;
    if (statusCode != null && statusCode >= 500 && statusCode < 600) {
      return true;
    }

    return false;
  }
}

class ApiException implements Exception {
  final String message;
  final int? statusCode;

  ApiException(this.message, {this.statusCode});

  @override
  String toString() => message;
}
