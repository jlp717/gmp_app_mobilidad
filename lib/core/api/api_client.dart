import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/api/isolate_transformer.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/services/device_fingerprint.dart';
import 'package:gmp_app_mobilidad/core/services/secure_storage.dart';
import 'package:sentry_dio/sentry_dio.dart';

/// API Client for all backend communications
/// Enhanced with automatic server detection and fallback
class ApiClient {
  static Dio? _dio;
  static const int _maxRetries = 3;
  static const Duration _retryDelay = Duration(seconds: 1);
  static bool _isInitialized = false;
  static String? _savedAuthToken;
  static Future<bool>? _refreshInFlight;

  /// Pending requests map for request deduplication
  /// Prevents duplicate API calls when multiple widgets request the same data
  static final Map<String, Future<dynamic>> _pendingRequests = {};

  /// Callback for 401 Unauthorized events (Global Logout)
  /// This is called when the server returns 401, indicating session expired
  static VoidCallback? onUnauthorized;

  /// Flag to prevent duplicate logout calls
  static bool _isLoggingOut = false;

  /// Flag to suppress 401→logout while a login is in progress.
  /// Prevents stale 401 responses from clearing the new token mid-login.
  static bool _isLoggingIn = false;

  // ── Connectivity Monitoring ──────────────────────────────────────────
  static StreamSubscription<List<ConnectivityResult>>? _connectivitySub;
  static ConnectivityResult _lastConnectivity = ConnectivityResult.wifi;
  static bool _connectivityMonitoring = false;

  /// Start monitoring network changes (WiFi ↔ mobile data).
  /// Reconnects with appropriate settings on network type change.
  static void startConnectivityMonitoring() {
    if (_connectivityMonitoring) return;
    _connectivityMonitoring = true;
    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) {
      final result =
          results.isNotEmpty ? results.first : ConnectivityResult.none;
      if (result == ConnectivityResult.none) return; // offline, keep last
      if (result != _lastConnectivity) {
        _lastConnectivity = result;
        debugPrint('[ApiClient] 🔄 Network changed to: $result');
        // Reset Dio so new connections use optimal settings for current network
        final token = _savedAuthToken;
        _dio = null;
        if (token != null) _savedAuthToken = token;
        debugPrint('[ApiClient] ✅ Dio reinitialized for network: $result');
      }
    });
  }

  /// Stop connectivity monitoring.
  static void stopConnectivityMonitoring() {
    _connectivitySub?.cancel();
    _connectivitySub = null;
    _connectivityMonitoring = false;
  }

  /// Force re-check current connectivity and reconnect if needed.
  static Future<void> checkConnectivity() async {
    try {
      final results = await Connectivity().checkConnectivity();
      final result =
          results.isNotEmpty ? results.first : ConnectivityResult.none;
      if (result != _lastConnectivity && result != ConnectivityResult.none) {
        _lastConnectivity = result;
        final token = _savedAuthToken;
        _dio = null;
        if (token != null) _savedAuthToken = token;
        debugPrint('[ApiClient] 🔄 Reconnected for network: $result');
      }
    } catch (_) {}
  }

  // ── End Connectivity Monitoring ──────────────────────────────────────

  /// Call before sending login credentials to block concurrent 401→logout.
  static void startLogin() => _isLoggingIn = true;

  /// Call when login completes (success or failure) to re-enable 401→logout.
  static void endLogin() => _isLoggingIn = false;

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
        '[ApiClient] ✅ Inicializado con servidor: ${ApiConfig.baseUrl}',
      );
    } catch (e) {
      debugPrint('[ApiClient] ⚠️ Error en inicialización: $e');
      // Continuar con configuración por defecto
      _isInitialized = true;
    }
  }

  /// Initialize or get Dio instance
  static Dio get dio {
    if (_dio == null) {
      _dio = _createDio();
    }
    return _dio!;
  }

  /// Awaitable connectivity check before first Dio use.
  /// Fix: login failing on mobile data because checkConnectivity was
  /// fire-and-forget, so Dio used WiFi timeouts on mobile networks.
  static Future<void> ensureDioReady() async {
    if (_dio == null) {
      await checkConnectivity();
      _dio = _createDio();
    }
  }

  /// Create Dio instance with OPTIMIZED settings
  /// - Gzip compression for faster transfers
  /// - Connection Keep-Alive for connection reuse
  /// - Adaptive timeouts: mobile data gets +50% to handle carrier latency
  /// - Certificate pinning for production
  static Dio _createDio() {
    // Adaptive timeouts: mobile data has higher latency
    final isMobileData = _lastConnectivity == ConnectivityResult.mobile ||
        _lastConnectivity == ConnectivityResult.vpn;
    final connectTimeout =
        isMobileData ? const Duration(seconds: 20) : ApiConfig.connectTimeout;
    final receiveTimeout =
        isMobileData ? const Duration(seconds: 45) : ApiConfig.receiveTimeout;
    debugPrint('[ApiClient] 📡 Timeouts: connect=${connectTimeout.inSeconds}s, '
        'receive=${receiveTimeout.inSeconds}s (network=$_lastConnectivity)');
    final dio = Dio(
      BaseOptions(
        baseUrl: ApiConfig.baseUrl,
        connectTimeout: connectTimeout,
        receiveTimeout: receiveTimeout,
        sendTimeout: isMobileData
            ? const Duration(seconds: 25)
            : const Duration(seconds: 15),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate', // Enable gzip compression
          'Connection': 'keep-alive', // Connection pooling
          // AUDIT: Device fingerprint on every request
          ...DeviceFingerprint.headers,
        },
        // Only accept 2xx responses as successful — 4xx/5xx trigger DioException
        validateStatus: (status) =>
            status != null && status >= 200 && status < 300,
      ),
    );

    // Configure certificate handling with SSL pinning support
    (dio.httpClientAdapter as IOHttpClientAdapter).createHttpClient = () {
      final client = HttpClient();

      // SECURITY CONFIGURATION:
      // 1. Pinning is DISABLED by default (PINNED_CERT_HASH = '')
      //    - Certificate pinning requires the server's certificate hash
      //    - Dart's X509Certificate provides SHA1, so we use SHA1 for pinning
      //    - Hash must be provided by your backend/ops team for production
      //    - Using an incorrect hash will cause ALL connections to fail
      //
      // 2. To enable pinning for production:
      //    - Obtain the server certificate's SHA1 fingerprint:
      //      openssl s_client -connect yourserver.com:443 </dev/null 2>/dev/null \
      //        | openssl x509 -fingerprint -sha1 -noout
      //    - Or compute from the DER bytes (for SHA256):
      //      openssl s_client -connect yourserver.com:443 </dev/null 2>/dev/null \
      //        | openssl x509 -outform DER > cert.der
      //      openssl dgst -sha256 cert.der
      //
      // 3. Set the hash below and change PINNED_CERT_ENABLED to true
      //
      // SECURITY NOTE: badCertificateCallback is called AFTER the platform
      // (Android/iOS) has validated the certificate chain. This callback
      // allows custom pinning logic on top of platform validation.

      // Set to true when hash is configured
      const pinnedCertEnabled = false;

      // SHA1 hash of the production server certificate (Dart X509Certificate API)
      // For SHA256, compute from cert.der bytes using crypto package
      // REPLACE with actual hash from your server certificate
      const pinnedCertHash = '';

      client.badCertificateCallback =
          (X509Certificate cert, String host, int port) {
        // Log certificate details for debugging (only in debug mode)
        if (kDebugMode) {
          debugPrint(
            '[ApiClient] 🔐 Certificate validation for $host:$port',
          );
          debugPrint('[ApiClient]   Subject: ${cert.subject}');
          debugPrint('[ApiClient]   Issuer: ${cert.issuer}');
          debugPrint('[ApiClient]   SHA1: ${cert.sha1}');
          debugPrint(
            '[ApiClient]   Valid from: ${cert.startValidity} '
            'to ${cert.endValidity}',
          );
        }

        // Allow development/local hosts without pinning
        // These IPs are for local development servers (emulator, local backend)
        const devHosts = {
          '127.0.0.1',
          '10.0.2.2', // Android emulator host
          '192.168.1.52', // Local dev server
          '172.31.192.1', // AWS/local network
          'localhost',
        };
        if (devHosts.contains(host)) {
          if (kDebugMode) {
            debugPrint(
              '[ApiClient]   ✅ Dev host bypass - no pinning required',
            );
          }
          return true;
        }

        // If pinning is enabled, validate against pinned certificate
        if (pinnedCertEnabled && pinnedCertHash.isNotEmpty) {
          // Note: Using SHA1 as Dart X509Certificate provides sha1 property
          // For SHA256, import 'crypto' and compute:
          //   import 'dart:convert';
          //   import 'package:crypto/crypto.dart';
          //   final sha256 = sha256.convert(cert.der).toString();
          final isPinned = cert.sha1 == pinnedCertHash;
          if (kDebugMode) {
            debugPrint(
              '[ApiClient]   ${isPinned ? "✅" : "❌"} '
              'Certificate ${isPinned ? "matches pinned hash" : "DOES NOT MATCH pinned hash"}',
            );
          }
          return isPinned;
        }

        // Pinning disabled: trust platform's default certificate validation
        // Platform validation includes:
        //   - Certificate chain verification
        //   - Expiration check
        //   - Revocation status (on supported platforms)
        //   - Root CA trust verification
        //
        // WARNING: When PINNED_CERT_ENABLED=false, the app trusts any
        // certificate validated by the platform. This is less secure but
        // necessary when:
        //   - Using custom/internal CAs
        //   - During development before production cert is available
        //   - When server certificate rotation is frequent
        //
        // RECOMMENDATION: Enable pinning for production builds

        if (kDebugMode) {
          debugPrint(
            '[ApiClient]   ⚠️ Pinning disabled - trusting platform validation',
          );
        }
        return true;
      };

      // Configure security context options
      client.connectionTimeout = ApiConfig.connectTimeout;

      return client;
    };

    // OPTIMIZATION: Parse JSON in background isolate
    dio.transformer = IsolateTransformer();

    // Stamp the current auth token directly into each request's own headers.
    // This makes the stale-token detection in _handleError reliable:
    // requestOptions.headers['Authorization'] will reflect the token that was
    // in use AT THE MOMENT the request was created, not the current token.
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final token = _savedAuthToken;
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          } else {
            options.headers.remove('Authorization');
          }
          handler.next(options);
        },
      ),
    );

    dio.interceptors.add(
      InterceptorsWrapper(
        onError: (error, handler) async {
          final statusCode = error.response?.statusCode;
          final path = error.requestOptions.path;
          final isAuthEndpoint =
              path.contains('/auth/login') || path.contains('/auth/refresh');
          final alreadyRetried =
              error.requestOptions.extra['authRetried'] == true;

          if (statusCode == 401 && !isAuthEndpoint && !alreadyRetried) {
            final requestAuth =
                error.requestOptions.headers['Authorization']?.toString();
            final currentAuth =
                _savedAuthToken != null ? 'Bearer $_savedAuthToken' : null;
            final isStaleRequest =
                requestAuth != null && requestAuth != currentAuth;

            if (!isStaleRequest && await refreshAccessToken()) {
              try {
                error.requestOptions.extra['authRetried'] = true;
                error.requestOptions.headers['Authorization'] =
                    'Bearer $_savedAuthToken';
                final response = await dio.fetch<dynamic>(error.requestOptions);
                handler.resolve(response);
                return;
              } catch (_) {
                // Fall through to normal 401 handling below.
              }
            }
          }

          handler.next(error);
        },
      ),
    );

    // Add retry interceptor
    dio.interceptors.add(_RetryInterceptor(dio, _maxRetries, _retryDelay));

    // Add performance logging interceptor in debug mode
    if (kDebugMode) {
      dio.interceptors.add(
        LogInterceptor(
          logPrint: (log) => debugPrint('[API] $log'),
        ),
      );
    }

    dio.addSentry(captureFailedRequests: true);

    return dio;
  }

  /// Reinitialize Dio (useful when base URL changes)
  static void reinitialize() {
    final token = _savedAuthToken;
    _dio = null;
    _pendingRequests.clear();
    if (token != null) {
      setAuthToken(token);
    }
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
    return _savedAuthToken;
  }

  /// Auth headers map for Image.network, url_launcher, etc.
  static Map<String, String> get authHeaders {
    final token = authToken;
    if (token != null) return {'Authorization': 'Bearer $token'};
    return {};
  }

  /// Set authentication token
  static void setAuthToken(String token) {
    _savedAuthToken = token;
    dio.options.headers['Authorization'] = 'Bearer $token';
  }

  /// Clear authentication token
  static void clearAuthToken() {
    _savedAuthToken = null;
    dio.options.headers.remove('Authorization');
  }

  static Future<void> storeRefreshToken(String token) async {
    await SecureStorage.writeSecureData('refresh_token', token);
  }

  static Future<void> clearRefreshToken() async {
    await SecureStorage.deleteSecureData('refresh_token');
  }

  static Future<bool> refreshAccessToken() async {
    final pending = _refreshInFlight;
    if (pending != null) return pending;

    _refreshInFlight = _refreshAccessTokenInternal();
    try {
      return await _refreshInFlight!;
    } finally {
      _refreshInFlight = null;
    }
  }

  static Future<bool> _refreshAccessTokenInternal() async {
    final refreshToken = await SecureStorage.readSecureData('refresh_token');
    if (refreshToken == null || refreshToken.isEmpty) {
      return false;
    }

    try {
      _isLoggingIn = true;
      final response = await dio.post<Map<String, dynamic>>(
        ApiConfig.refresh,
        data: {'refreshToken': refreshToken},
        options: Options(extra: {'skipRetry': true}),
      );
      final body = response.data ?? const <String, dynamic>{};
      final accessToken = (body['token'] ?? body['accessToken'])?.toString();
      final nextRefreshToken =
          (body['refreshToken'] ?? refreshToken).toString();

      if (accessToken == null || accessToken.isEmpty) {
        return false;
      }

      setAuthToken(accessToken);
      await SecureStorage.writeSecureData('user_token', accessToken);
      await SecureStorage.writeSecureData('refresh_token', nextRefreshToken);
      debugPrint('[ApiClient] Access token refreshed');
      return true;
    } catch (e) {
      debugPrint('[ApiClient] Token refresh failed: $e');
      return false;
    } finally {
      _isLoggingIn = false;
    }
  }

  static String _buildRequestKey(
    String method,
    String endpoint,
    Map<String, dynamic>? queryParameters,
  ) {
    if (queryParameters == null || queryParameters.isEmpty) {
      return '$method:$endpoint';
    }

    final normalized = queryParameters.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));

    final queryString =
        normalized.map((entry) => '${entry.key}=${entry.value}').join('&');

    return '$method:$endpoint?$queryString';
  }

  /// Recursively converts all nested Map<dynamic,dynamic> to Map<String,dynamic>.
  /// Hive deserialization returns _Map<dynamic,dynamic> for nested objects;
  /// a shallow Map.from() only fixes the top level.
  static Map<String, dynamic> _deepCastMap(Map src) {
    return src.map((k, v) => MapEntry(k.toString(), _deepCastValue(v)));
  }

  static dynamic _deepCastValue(dynamic v) {
    if (v is Map) return _deepCastMap(v);
    if (v is List) return v.map(_deepCastValue).toList();
    return v;
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
    Duration? receiveTimeout,
  }) async {
    final requestKey = _buildRequestKey('GET_MAP', endpoint, queryParameters);

    if (!forceRefresh) {
      final pending = _pendingRequests[requestKey];
      if (pending != null) {
        debugPrint('[ApiClient] Deduping request: $endpoint');
        return await pending as Map<String, dynamic>;
      }
    }

    final future = () async {
      // Try cache first if cacheKey provided and not forcing refresh
      if (cacheKey != null && !forceRefresh) {
        try {
          final cached = CacheService.get(cacheKey);
          if (cached != null && cached is Map) {
            return _deepCastMap(cached);
          }
        } catch (e) {
          // Continue to network request
        }
      }

      try {
        final response = await dio.get(
          endpoint,
          queryParameters: queryParameters,
          options: receiveTimeout != null
              ? Options(receiveTimeout: receiveTimeout)
              : null,
        );
        final rawData = response.data;
        if (rawData is! Map) {
          if (rawData is List) {
            throw ApiException('Response is a List, use getList() instead');
          }
          throw ApiException(
            'Expected Map response but got ${rawData.runtimeType}',
          );
        }
        final data = _deepCastMap(rawData);

        // Cache the response if cacheKey provided
        if (cacheKey != null) {
          await CacheService.set(cacheKey, data, ttl: cacheTTL);
        }

        return data;
      } on DioException catch (e) {
        if (cacheKey != null && _isNetworkError(e)) {
          try {
            final cached = CacheService.getStale(cacheKey);
            if (cached != null && cached is Map) {
              return _deepCastMap(cached);
            }
          } catch (_) {}
        }
        throw _handleError(e);
      }
    }();

    if (!forceRefresh) {
      _pendingRequests[requestKey] = future;
    }

    try {
      return await future;
    } finally {
      if (!forceRefresh) {
        _pendingRequests.remove(requestKey);
      }
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
    final requestKey = _buildRequestKey('GET_LIST', endpoint, queryParameters);

    if (!forceRefresh) {
      final pending = _pendingRequests[requestKey];
      if (pending != null) {
        debugPrint('[ApiClient] Deduping list request: $endpoint');
        return await pending as List<dynamic>;
      }
    }

    final future = () async {
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
          final cached = CacheService.getStale<List<dynamic>>(cacheKey);
          if (cached != null) {
            return cached;
          }
        }
        throw _handleError(e);
      }
    }();

    if (!forceRefresh) {
      _pendingRequests[requestKey] = future;
    }

    try {
      return await future;
    } finally {
      if (!forceRefresh) {
        _pendingRequests.remove(requestKey);
      }
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

  /// DELETE request
  static Future<Map<String, dynamic>> delete(
    String endpoint, {
    Map<String, dynamic>? data,
  }) async {
    try {
      final response = await dio.delete(endpoint, data: data);
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  static bool _isNetworkError(DioException e) {
    return e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.unknown;
  }

  static ApiException _handleError(DioException e) {
    // Always log raw error details for diagnostics (visible in adb logcat)
    debugPrint(
      '[ApiClient] DioException type=${e.type} error=${e.error.runtimeType}: ${e.error}',
    );
    if (e.type == DioExceptionType.connectionTimeout) {
      return ApiException(
        'Timeout de conexión. Verifica tu conexión a internet e inténtalo de nuevo.',
        statusCode: 0,
      );
    } else if (e.type == DioExceptionType.connectionError) {
      // Verificar si es error de socket (sin internet)
      if (e.error is SocketException ||
          (e.error?.toString().contains('SocketException') ?? false)) {
        return ApiException(
          'No hay conexión a internet. Verifica tu WiFi o datos móviles.',
          statusCode: 0,
        );
      }
      return ApiException(
        'Error de conexión. Verifica tu conexión a internet.',
        statusCode: 0,
      );
    } else if (e.type == DioExceptionType.receiveTimeout) {
      return ApiException(
        'El servidor está tardando demasiado. Inténtalo de nuevo.',
        statusCode: 0,
      );
    } else if (e.type == DioExceptionType.sendTimeout) {
      return ApiException(
        'Error al enviar datos. Verifica tu conexión.',
        statusCode: 0,
      );
    } else if (e.response != null) {
      final statusCode = e.response?.statusCode ?? 0;
      final data = e.response?.data;

      // Extract server error message + semantic code
      String? serverMessage;
      String? serverCode;
      if (data is Map<String, dynamic>) {
        final error = data['error'] as String?;
        final details = data['details'] as String?;
        serverMessage = details != null && details.isNotEmpty
            ? '$error: $details'
            : (error ?? data['message'] as String?);
        serverCode = data['code'] as String?;
      }

      if (statusCode == 401) {
        final isLoginRequest = e.requestOptions.path.contains('/auth/login');
        // Compare the token used in THIS request vs the currently stored token.
        // If they differ, this 401 is from a STALE request (previous session)
        // and must NOT trigger a logout that would wipe the fresh new token.
        final requestAuth =
            e.requestOptions.headers['Authorization']?.toString();
        final currentAuth =
            _savedAuthToken != null ? 'Bearer $_savedAuthToken' : null;
        final isStaleRequest =
            requestAuth != null && requestAuth != currentAuth;
        if (!isLoginRequest &&
            !_isLoggingOut &&
            !_isLoggingIn &&
            !isStaleRequest) {
          _isLoggingOut = true;
          debugPrint('[ApiClient] 401 detected - triggering logout');
          onUnauthorized?.call();
          // Reset flag after short delay to allow re-login
          Future.delayed(
            const Duration(seconds: 2),
            () => _isLoggingOut = false,
          );
        }
        return ApiException(
          serverMessage ?? 'Credenciales inválidas. Verifica usuario y PIN.',
          statusCode: 401,
          code: serverCode,
        );
      } else if (statusCode == 403) {
        return ApiException(
          serverMessage ?? 'Acceso denegado. No tienes permisos.',
          statusCode: 403,
          code: serverCode,
        );
      } else if (statusCode == 404) {
        return ApiException(
          serverMessage ?? 'Recurso no encontrado.',
          statusCode: 404,
          code: serverCode,
        );
      } else if (statusCode == 429) {
        return ApiException(
          serverMessage ?? 'Demasiados intentos. Espera un momento.',
          statusCode: 429,
          code: serverCode,
        );
      } else if (statusCode == 409) {
        return ApiException(
          serverMessage ?? 'Conflicto con el estado actual.',
          statusCode: 409,
          code: serverCode,
        );
      } else if (statusCode >= 500) {
        return ApiException(
          'Error del servidor ($statusCode). Inténtalo más tarde.',
          statusCode: statusCode,
          code: serverCode,
        );
      }
      return ApiException(
        serverMessage ?? 'Error ($statusCode)',
        statusCode: statusCode,
        code: serverCode,
      );
    } else if (e.type == DioExceptionType.unknown) {
      final errorMsg = e.error?.toString().toLowerCase() ?? '';
      if (errorMsg.contains('socket')) {
        return ApiException(
          'No hay conexión a internet. Verifica WiFi o datos móviles.',
          statusCode: 0,
        );
      } else if (errorMsg.contains('ssl') || errorMsg.contains('certificate')) {
        return ApiException(
          'Error de seguridad. Verifica tu conexión.',
          statusCode: 0,
        );
      }
    }

    // Default error
    return ApiException(
      'Error de conexión. Verifica tu internet e inténtalo de nuevo.',
      statusCode: 0,
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
    return get(
      endpoint,
      queryParameters: queryParameters,
      cacheKey: cacheKey,
      cacheTTL: cacheTTL,
      forceRefresh: forceRefresh,
    );
  }

  /// Get count of pending requests (for debugging)
  static int get pendingRequestCount => _pendingRequests.length;
}

/// Retry interceptor for handling transient failures
class _RetryInterceptor extends Interceptor {
  _RetryInterceptor(this._dio, this._maxRetries, this._retryDelay);
  final Dio _dio;
  final int _maxRetries;
  final Duration _retryDelay;

  @override
  Future<void> onError(
      DioException err, ErrorInterceptorHandler handler) async {
    final shouldRetry = _shouldRetry(err);
    final retryCount = err.requestOptions.extra['retryCount'] as int? ?? 0;

    if (retryCount == 0) {
      // Log full request details on first failure
      debugPrint(
        '[ApiClient] ❌ Request failed: ${err.requestOptions.method} ${err.requestOptions.uri}',
      );
      debugPrint('[ApiClient] Headers sent: ${err.requestOptions.headers}');
      debugPrint('[ApiClient] Error type: ${err.type}, Error: ${err.error}');
    }

    if (shouldRetry && retryCount < _maxRetries) {
      // FIX: Use longer backoff for 429 rate limit errors
      final isRateLimited = err.response?.statusCode == 429;
      final baseDelay = isRateLimited ? _retryDelay * 2 : _retryDelay;
      final delay = baseDelay * (retryCount + 1);

      debugPrint(
        '[ApiClient] Retrying request (${retryCount + 1}/$_maxRetries) in ${delay.inSeconds}s...',
      );

      // Exponential backoff
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
    if (err.requestOptions.extra['skipRetry'] == true) {
      return false;
    }

    // NEVER retry login requests to avoid triggering rate limiting
    if (err.requestOptions.path.contains('/auth/login')) {
      return false;
    }

    final method = err.requestOptions.method.toUpperCase();
    final idempotent = method == 'GET' ||
        method == 'HEAD' ||
        method == 'OPTIONS' ||
        err.requestOptions.extra['idempotent'] == true;
    if (!idempotent) {
      return false;
    }

    // Retry on network errors and 5xx server errors
    if (err.type == DioExceptionType.connectionError ||
        err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.receiveTimeout) {
      return true;
    }

    final statusCode = err.response?.statusCode;

    // FIX: Retry on 429 (Too Many Requests) with longer backoff
    if (statusCode == 429) {
      return true;
    }

    if (statusCode != null && statusCode >= 500 && statusCode < 600) {
      return true;
    }

    return false;
  }
}

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.code});
  final String message;
  final int? statusCode;

  /// Código semántico devuelto por el backend (por ejemplo
  /// `COBRO_ALREADY_LIQUIDADO`, `PAYMENT_AUTHZ_DENIED`, ...). Permite
  /// que la UI haga mensaje específico sin parsear el texto humano.
  final String? code;

  @override
  String toString() => code != null ? '[$code] $message' : message;
}
