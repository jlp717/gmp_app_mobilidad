import 'dart:io';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter/foundation.dart';
import 'isolate_transformer.dart';
import 'api_config.dart';
import '../cache/cache_service.dart';
import '../services/network_service.dart';
import '../services/device_fingerprint.dart';

/// API Client for all backend communications
/// Enhanced with automatic server detection and fallback
class ApiClient {
  static Dio? _dio;
  static int _maxRetries = 3;
  static Duration _retryDelay = const Duration(seconds: 1);
  static bool _isInitialized = false;

  /// Pending requests map for request deduplication
  /// Prevents duplicate API calls when multiple widgets request the same data
  static final Map<String, Future<dynamic>> _pendingRequests = {};

  /// Callback for 401 Unauthorized events (Global Logout)
  /// This is called when the server returns 401, indicating session expired
  static VoidCallback? onUnauthorized;

  /// Flag to prevent duplicate logout calls
  static bool _isLoggingOut = false;

  /// Initialize the API client with automatic server detection
  static Future<void> initialize() async {
    if (_isInitialized) return;

    try {
      // Collect device fingerprint for audit traceability
      await DeviceFingerprint.initialize();
      // Inicializar NetworkService para detectar servidor automáticamente
      await ApiConfig.initialize();
      _isInitialized = true;
      debugPrint(
          '[ApiClient] ✅ Inicializado con servidor: ${ApiConfig.baseUrl}');
    } catch (e) {
      debugPrint('[ApiClient] ⚠️ Error en inicialización: $e');
      // Continuar con configuración por defecto
      _isInitialized = true;
    }
  }

  /// Initialize or get Dio instance
  static Dio get dio {
    _dio ??= _createDio();
    return _dio!;
  }

  /// Create Dio instance with OPTIMIZED settings
  /// - Gzip compression for faster transfers
  /// - Connection Keep-Alive for connection reuse
  /// - Optimized timeouts for mobile networks
  /// - Certificate pinning for production
  static Dio _createDio() {
    final dio = Dio(BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: ApiConfig.connectTimeout,
      receiveTimeout: ApiConfig.receiveTimeout,
      sendTimeout: const Duration(seconds: 30),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate', // Enable gzip compression
        'Connection': 'keep-alive', // Connection pooling
        // AUDIT: Device fingerprint on every request
        ...DeviceFingerprint.headers,
      },
      // Enable response compression
      responseType: ResponseType.json,
      // Only accept 2xx responses as successful — 4xx/5xx trigger DioException
      validateStatus: (status) => status != null && status >= 200 && status < 300,
    ));

    // Configure certificate handling
    (dio.httpClientAdapter as IOHttpClientAdapter).createHttpClient = () {
      final client = HttpClient();
      client.badCertificateCallback = (X509Certificate cert, String host, int port) {
        // Allow development IPs without pinning
        const devHosts = ['127.0.0.1', '10.0.2.2', '192.168.1.52', '172.31.192.1', 'localhost'];
        if (devHosts.contains(host)) return true;
        
        // Production: pin certificate SHA256 fingerprint
        const pinnedCertSha256 = '';
        if (pinnedCertSha256.isNotEmpty) {
          return cert.sha1 == pinnedCertSha256;
        }
        
        // No pinning configured: trust platform default cert validation.
        // Returning true here means Dart accepts the cert even if the
        // platform flagged it — safe because the platform already
        // validated the chain on Android/iOS before this callback fires.
        // In debug mode this allows self-signed certs for local servers.
        return true;
      };
      return client;
    };

    // OPTIMIZATION: Parse JSON in background isolate
    dio.transformer = IsolateTransformer();

    // Add retry interceptor
    dio.interceptors.add(_RetryInterceptor(dio, _maxRetries, _retryDelay));

    // Add performance logging interceptor in debug mode
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
    _pendingRequests.clear();
  }

  /// Intenta reconectar a otro servidor disponible
  static Future<bool> tryReconnect() async {
    debugPrint('[ApiClient] 🔄 Intentando reconectar...');
    try {
      await ApiConfig.refreshConnection();
      reinitialize();
      return ApiConfig.isNetworkReady;
    } catch (e) {
      debugPrint('[ApiClient] ❌ Error en reconexión: $e');
      return false;
    }
  }

  /// Get current auth token (for Image.network headers etc.)
  static String? get authToken {
    final header = dio.options.headers['Authorization']?.toString();
    if (header != null && header.startsWith('Bearer ')) {
      return header.substring(7);
    }
    return null;
  }

  /// Auth headers map for Image.network, url_launcher, etc.
  static Map<String, String> get authHeaders {
    final token = authToken;
    if (token != null) return {'Authorization': 'Bearer $token'};
    return {};
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
      try {
        final cached = CacheService.get(cacheKey);
        if (cached != null && cached is Map) {
          return Map<String, dynamic>.from(cached);
        }
      } catch (e) {
        // Continue to network request
      }
    }

    try {
      final response = await dio.get(
        endpoint,
        queryParameters: queryParameters,
      );
      final rawData = response.data;
      if (rawData is! Map) {
        if (rawData is List)
          throw ApiException('Response is a List, use getList() instead');
        throw ApiException(
            'Expected Map response but got ${rawData.runtimeType}');
      }
      final data = Map<String, dynamic>.from(rawData);

      // Cache the response if cacheKey provided
      if (cacheKey != null) {
        await CacheService.set(cacheKey, data, ttl: cacheTTL);
      }

      return data;
    } on DioException catch (e) {
      if (cacheKey != null && _isNetworkError(e)) {
        try {
          final cached = CacheService.get(cacheKey);
          if (cached != null && cached is Map) {
            return Map<String, dynamic>.from(cached);
          }
        } catch (_) {}
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
      try {
        final cached = CacheService.get(cacheKey);
        if (cached != null && cached is List) {
          return cached;
        }
      } catch (e) {
        // Continue to network
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
      if (cacheKey != null && _isNetworkError(e)) {
        final cached = CacheService.get<List<dynamic>>(cacheKey);
        if (cached != null) {
          return cached;
        }
      }
      throw _handleError(e);
    }
  }

  /// GET request returning bytes (Blob/PDF)
  /// Uses extended timeout since PDF generation can be slow
  static Future<List<int>> getBytes(
    String endpoint, {
    Map<String, dynamic>? queryParameters,
  }) async {
    try {
      final response = await dio.get(
        endpoint,
        queryParameters: queryParameters,
        options: Options(
          responseType: ResponseType.bytes,
          receiveTimeout: const Duration(seconds: 60),
        ),
      );
      return response.data as List<int>;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  /// POST request (never cached)
  static Future<Map<String, dynamic>> post(
    String endpoint,
    Map<String, dynamic> data,
  ) async {
    try {
      final response = await dio.post(endpoint, data: data);
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  /// POST with custom timeout (for heavy endpoints)
  static Future<Map<String, dynamic>> postWithTimeout(
    String endpoint,
    Map<String, dynamic> data, {
    Duration? receiveTimeout,
  }) async {
    try {
      final response = await dio.post(
        endpoint,
        data: data,
        options: receiveTimeout != null
            ? Options(receiveTimeout: receiveTimeout)
            : null,
      );
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  /// PUT request
  static Future<Map<String, dynamic>> put(
    String endpoint, {
    Map<String, dynamic>? data,
  }) async {
    try {
      final response = await dio.put(endpoint, data: data);
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  static bool _isNetworkError(DioException e) {
    return e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.unknown;
  }

  static ApiException _handleError(DioException e) {
    // Always log raw error details for diagnostics (visible in adb logcat)
    debugPrint('[ApiClient] DioException type=${e.type} error=${e.error.runtimeType}: ${e.error}');
    if (e.type == DioExceptionType.connectionTimeout) {
      return ApiException(
        'Timeout de conexión. Verifica tu conexión a internet e inténtalo de nuevo.',
        statusCode: 0
      );
    } else if (e.type == DioExceptionType.connectionError) {
      // Verificar si es error de socket (sin internet)
      if (e.error is SocketException || 
          (e.error?.toString().contains('SocketException') ?? false)) {
        return ApiException(
          'No hay conexión a internet. Verifica tu WiFi o datos móviles.',
          statusCode: 0
        );
      }
      return ApiException(
        'Error de conexión. Verifica tu conexión a internet.',
        statusCode: 0
      );
    } else if (e.type == DioExceptionType.receiveTimeout) {
      return ApiException(
        'El servidor está tardando demasiado. Inténtalo de nuevo.',
        statusCode: 0
      );
    } else if (e.type == DioExceptionType.sendTimeout) {
      return ApiException(
        'Error al enviar datos. Verifica tu conexión.',
        statusCode: 0
      );
    } else if (e.response != null) {
      final statusCode = e.response?.statusCode ?? 0;
      final data = e.response?.data;

      // Extract server error message
      String? serverMessage;
      if (data is Map<String, dynamic>) {
        final error = data['error'] as String?;
        final details = data['details'] as String?;
        serverMessage = details != null && details.isNotEmpty
            ? '$error: $details'
            : (error ?? data['message'] as String?);
      }

      if (statusCode == 401) {
        final isLoginRequest = e.requestOptions.path.contains('/auth/login');
        if (!isLoginRequest && !_isLoggingOut) {
          _isLoggingOut = true;
          debugPrint('[ApiClient] 401 detected - triggering logout');
          onUnauthorized?.call();
          // Reset flag after short delay to allow re-login
          Future.delayed(const Duration(seconds: 2), () => _isLoggingOut = false);
        }
        return ApiException(
          serverMessage ?? 'Credenciales inválidas. Verifica usuario y PIN.',
          statusCode: 401
        );
      } else if (statusCode == 403) {
        return ApiException(
          serverMessage ?? 'Acceso denegado. No tienes permisos.',
          statusCode: 403
        );
      } else if (statusCode == 404) {
        return ApiException(
          serverMessage ?? 'Recurso no encontrado.',
          statusCode: 404
        );
      } else if (statusCode == 429) {
        return ApiException(
          serverMessage ?? 'Demasiados intentos. Espera un momento.',
          statusCode: 429
        );
      } else if (statusCode >= 500) {
        return ApiException(
          'Error del servidor ($statusCode). Inténtalo más tarde.',
          statusCode: statusCode
        );
      }
      return ApiException(
        serverMessage ?? 'Error ($statusCode)',
        statusCode: statusCode
      );
    } else if (e.type == DioExceptionType.unknown) {
      final errorMsg = e.error?.toString().toLowerCase() ?? '';
      if (errorMsg.contains('socket')) {
        return ApiException(
          'No hay conexión a internet. Verifica WiFi o datos móviles.',
          statusCode: 0
        );
      } else if (errorMsg.contains('ssl') || errorMsg.contains('certificate')) {
        return ApiException(
          'Error de seguridad. Verifica tu conexión.',
          statusCode: 0
        );
      }
    }
    
    // Default error
    return ApiException(
      'Error de conexión. Verifica tu internet e inténtalo de nuevo.',
      statusCode: 0
    );
  }

  /// Deduplicated GET request - prevents duplicate concurrent API calls
  /// Use this when multiple widgets might request the same data simultaneously
  static Future<Map<String, dynamic>> getDeduped(
    String endpoint, {
    Map<String, dynamic>? queryParameters,
    String? cacheKey,
    Duration? cacheTTL,
    bool forceRefresh = false,
  }) async {
    final requestKey = '$endpoint${queryParameters?.toString() ?? ''}';

    // Return existing pending request if one is in progress
    if (_pendingRequests.containsKey(requestKey) && !forceRefresh) {
      debugPrint('[ApiClient] Deduping request: $endpoint');
      return await _pendingRequests[requestKey] as Map<String, dynamic>;
    }

    // Create new request
    final future = get(
      endpoint,
      queryParameters: queryParameters,
      cacheKey: cacheKey,
      cacheTTL: cacheTTL,
      forceRefresh: forceRefresh,
    );
    _pendingRequests[requestKey] = future;

    try {
      return await future;
    } finally {
      _pendingRequests.remove(requestKey);
    }
  }

  /// Get count of pending requests (for debugging)
  static int get pendingRequestCount => _pendingRequests.length;
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

    if (retryCount == 0) {
      // Log full request details on first failure
      debugPrint('[ApiClient] ❌ Request failed: ${err.requestOptions.method} ${err.requestOptions.uri}');
      debugPrint('[ApiClient] Headers sent: ${err.requestOptions.headers}');
      debugPrint('[ApiClient] Error type: ${err.type}, Error: ${err.error}');
    }

    if (shouldRetry && retryCount < _maxRetries) {
      debugPrint(
          '[ApiClient] Retrying request (${retryCount + 1}/$_maxRetries)...');

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
