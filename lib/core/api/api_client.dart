import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/api/isolate_transformer.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/security/certificate_pinning.dart';
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
  static int _authEpoch = 0;
  static bool _lastTokenRefreshFailedDueToConnectivity = false;

  @visibleForTesting

  /// Overrides secure refresh-token reads in tests.
  static Future<String?> Function()? refreshTokenReaderOverride;

  /// Absolute local deadline for the current authenticated session.
  static DateTime? authSessionExpiresAt;

  /// Pending requests map for request deduplication
  /// Prevents duplicate API calls when multiple widgets request the same data
  static final Map<String, Future<dynamic>> _pendingRequests = {};

  /// Callback for 401 Unauthorized events (Global Logout)
  /// This is called when the server returns 401, indicating session expired
  static VoidCallback? onUnauthorized;

  /// Commits a complete DB-revalidated refresh projection locally.
  static FutureOr<bool> Function(Map<String, dynamic> response)?
      onTokenRefreshed;

  /// Clears local auth when a refresh response may have been lost after CAS.
  static FutureOr<void> Function()? onAuthSessionDiverged;

  /// Flag to prevent duplicate logout calls
  static bool _isLoggingOut = false;

  /// Flag to suppress 401â†’logout while a login is in progress.
  /// Prevents stale 401 responses from clearing the new token mid-login.
  static bool _isLoggingIn = false;

  static const Set<String> _debugCertificateBypassHosts = {
    '127.0.0.1',
    '10.0.2.2',
    '192.168.1.52',
    '172.31.192.1',
    'localhost',
  };

  /// Whether debug TLS bypass is allowed for a local [host].
  @visibleForTesting
  static bool shouldBypassInvalidCertificateForHost(
    String host, {
    bool debugMode = kDebugMode,
  }) {
    return debugMode && _debugCertificateBypassHosts.contains(host);
  }

  // Connectivity monitoring.â”€â”€
  static StreamSubscription<List<ConnectivityResult>>? _connectivitySub;
  static ConnectivityResult _lastConnectivity = ConnectivityResult.wifi;
  static bool _connectivityMonitoring = false;

  /// Start monitoring network changes (WiFi â†” mobile data).
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
        debugPrint('[ApiClient] ðŸ”„ Network changed to: $result');
        // Reset Dio so new connections use optimal settings for current network
        final token = _savedAuthToken;
        _dio = null;
        if (token != null) _savedAuthToken = token;
        debugPrint('[ApiClient] âœ… Dio reinitialized for network: $result');
      }
    });
  }

  /// Stop connectivity monitoring.
  static void stopConnectivityMonitoring() {
    unawaited(_connectivitySub?.cancel());
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
        debugPrint('[ApiClient] ðŸ”„ Reconnected for network: $result');
      }
    } catch (_) {}
  }

  // End connectivity monitoring.

  /// Call before sending login credentials to block concurrent 401â†’logout.
  static void startLogin() {
    _isLoggingIn = true;
    _pendingRequests.clear();
    _authEpoch++;
  }

  /// Call when login completes (success or failure) to re-enable 401â†’logout.
  static void endLogin() => _isLoggingIn = false;

  /// Initialize the API client with automatic server detection
  static Future<void> initialize() async {
    if (_isInitialized) return;

    try {
      // Collect device fingerprint for audit traceability
      await DeviceFingerprint.initialize();
      // Inicializar NetworkService para detectar servidor automÃ¡ticamente
      await ApiConfig.initialize();
      _isInitialized = true;
      debugPrint(
        '[ApiClient] âœ… Inicializado con servidor: ${ApiConfig.baseUrl}',
      );
    } catch (_) {
      debugPrint('[ApiClient] Initialization failed; using safe defaults');
      // Continuar con configuraciÃ³n por defecto
      _isInitialized = true;
    }
  }

  /// Initialize or get Dio instance
  static Dio get dio {
    _dio ??= _createDio();
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
    debugPrint(
        '[ApiClient] ðŸ“¡ Timeouts: connect=${connectTimeout.inSeconds}s, '
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
        // Only accept 2xx responses as successful â€” 4xx/5xx trigger DioException
        validateStatus: (status) =>
            status != null && status >= 200 && status < 300,
      ),
    );

    // Configure TLS handling. Platform chain validation always runs first;
    // badCertificateCallback adds pinning on top and fails closed.
    if (kIsWeb) {
      return dio;
    }

    (dio.httpClientAdapter as IOHttpClientAdapter).createHttpClient = () {
      final client = HttpClient()
        ..badCertificateCallback =
            (X509Certificate cert, String host, int port) {
          // Development/local hosts bypass pinning (debug builds only).
          if (shouldBypassInvalidCertificateForHost(host)) {
            if (kDebugMode) {
              debugPrint('[ApiClient] Dev host bypass - no pinning: $host');
            }
            return true;
          }

          // Fail closed: reject unless a configured pin matches. Pins come from
          // --dart-define=GMP_TLS_PINS (see TlsPinningConfig and
          // scripts/security/get-tls-pin.ps1).
          final pinned = TlsPinning.certificateMatchesPin(
            cert,
            TlsPinningConfig.pins,
          );
          if (!pinned && kDebugMode) {
            debugPrint(
              '[ApiClient] Certificate rejected for $host:$port '
              '(pin mismatch or GMP_TLS_PINS not configured)',
            );
          }
          return pinned;
        }
        ..connectionTimeout = ApiConfig.connectTimeout;

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
          options.extra['authEpoch'] = _authEpoch;
          options.extra['hadAuthToken'] = token != null;
          if (token != null) {
            if (isAuthSessionExpired &&
                options.extra['allowExpiredAuthForLogout'] != true) {
              _savedAuthToken = null;
              _authEpoch++;
              options.headers.remove('Authorization');
              handler.reject(
                DioException(
                  requestOptions: options,
                  response: Response<Map<String, dynamic>>(
                    requestOptions: options,
                    statusCode: 401,
                    data: const {
                      'error':
                          'Tu sesiÃ³n ha expirado. Inicia sesiÃ³n de nuevo.',
                    },
                  ),
                  type: DioExceptionType.badResponse,
                ),
              );
              return;
            }
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
          final isAuthEndpoint = path.contains('/auth/login') ||
              path.contains('/auth/refresh') ||
              path.contains('/auth/logout') ||
              path.contains('/auth/switch-role');
          final alreadyRetried =
              error.requestOptions.extra['authRetried'] == true;

          if (statusCode == 401 &&
              !isAuthEndpoint &&
              !alreadyRetried &&
              !isAuthSessionExpired) {
            final currentAuth =
                _savedAuthToken != null ? 'Bearer $_savedAuthToken' : null;
            final isStaleRequest = _isStaleUnauthorized(error);

            if (isStaleRequest && currentAuth != null) {
              try {
                error.requestOptions.extra['authRetried'] = true;
                error.requestOptions.headers['Authorization'] = currentAuth;
                final response = await dio.fetch<dynamic>(error.requestOptions);
                handler.resolve(response);
                return;
              } catch (_) {
                // Fall through to normal 401 handling below.
              }
            } else if (!isStaleRequest && await refreshAccessToken()) {
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
          requestHeader: false,
          requestBody: false,
          responseHeader: false,
          responseBody: false,
          error: false,
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
    debugPrint('[ApiClient] ðŸ”„ Intentando reconectar...');
    try {
      await ApiConfig.refreshConnection();
      reinitialize();
      return ApiConfig.isNetworkReady;
    } catch (_) {
      debugPrint('[ApiClient] Connectivity recheck failed');
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
    final changed = _savedAuthToken != token;
    _savedAuthToken = token;
    dio.options.headers['Authorization'] = 'Bearer $token';
    if (changed) {
      _authEpoch++;
      _pendingRequests.clear();
    }
  }

  /// Whether the current local auth session deadline has elapsed.
  static bool get isAuthSessionExpired {
    final expiresAt = authSessionExpiresAt;
    if (expiresAt == null) return false;
    return !DateTime.now().isBefore(expiresAt);
  }

  /// Whether latest token refresh failed because transport was unavailable.
  static bool get lastTokenRefreshFailedDueToConnectivity =>
      _lastTokenRefreshFailedDueToConnectivity;

  /// Clear authentication token
  static void clearAuthToken() {
    final changed = _savedAuthToken != null || authSessionExpiresAt != null;
    _savedAuthToken = null;
    authSessionExpiresAt = null;
    dio.options.headers.remove('Authorization');
    if (changed) {
      _authEpoch++;
      _pendingRequests.clear();
    }
  }

  /// Clears in-flight request deduplication state.
  static void clearPendingRequests() {
    _pendingRequests.clear();
  }

  /// Stores rotated refresh [token] in secure storage.
  static Future<void> storeRefreshToken(String token) async {
    await SecureStorage.writeSecureData('refresh_token', token);
  }

  /// Removes refresh token from secure storage.
  static Future<void> clearRefreshToken() async {
    await SecureStorage.deleteSecureData('refresh_token');
  }

  /// Revokes the canonical server session exactly once before local cleanup.
  /// Logout is deliberately non-idempotent from the client's perspective and
  /// is never retried automatically.
  static Future<void> revokeCurrentSession() async {
    final token = _savedAuthToken;
    if (token == null || token.isEmpty) return;

    _isLoggingOut = true;
    try {
      await dio.post<Map<String, dynamic>>(
        ApiConfig.logout,
        data: const <String, dynamic>{},
        options: Options(
          headers: {'Authorization': 'Bearer $token'},
          extra: const {
            'skipRetry': true,
            'idempotent': false,
            'allowExpiredAuthForLogout': true,
          },
        ),
      );
    } finally {
      _isLoggingOut = false;
    }
  }

  /// Refreshes access credentials using single-flight coordination.
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
    _lastTokenRefreshFailedDueToConnectivity = false;
    if (isAuthSessionExpired) {
      debugPrint('[ApiClient] Token refresh blocked: local session expired');
      return false;
    }

    final refreshToken = await (refreshTokenReaderOverride?.call() ??
        SecureStorage.readSecureData('refresh_token'));
    if (refreshToken == null || refreshToken.isEmpty) {
      final diverged = onAuthSessionDiverged;
      if (diverged != null) await diverged();
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
      final nextRefreshToken = body['refreshToken']?.toString();

      if (accessToken == null ||
          accessToken.isEmpty ||
          nextRefreshToken == null ||
          nextRefreshToken.isEmpty) {
        final diverged = onAuthSessionDiverged;
        if (diverged != null) await diverged();
        return false;
      }

      final callback = onTokenRefreshed;
      if (callback == null) {
        final diverged = onAuthSessionDiverged;
        if (diverged != null) await diverged();
        return false;
      }
      final committed = await callback(Map<String, dynamic>.from(body));
      if (!committed) return false;
      debugPrint('[ApiClient] Access token refreshed');
      return true;
    } on DioException catch (e) {
      _lastTokenRefreshFailedDueToConnectivity = _isNetworkError(e);
      if (!_lastTokenRefreshFailedDueToConnectivity) {
        final diverged = onAuthSessionDiverged;
        if (diverged != null) await diverged();
      }
      debugPrint('[ApiClient] Token refresh failed');
      return false;
    } catch (_) {
      final diverged = onAuthSessionDiverged;
      if (diverged != null) await diverged();
      debugPrint('[ApiClient] Token refresh failed');
      return false;
    } finally {
      _isLoggingIn = false;
    }
  }

  /// Clears static client state between unit tests.
  @visibleForTesting
  static void resetForTesting() {
    _dio = null;
    _isInitialized = false;
    _savedAuthToken = null;
    _refreshInFlight = null;
    _authEpoch = 0;
    _lastTokenRefreshFailedDueToConnectivity = false;
    refreshTokenReaderOverride = null;
    authSessionExpiresAt = null;
    _pendingRequests.clear();
    onUnauthorized = null;
    onTokenRefreshed = null;
    onAuthSessionDiverged = null;
    _isLoggingOut = false;
    _isLoggingIn = false;
  }

  static String _buildRequestKey(
    String method,
    String endpoint,
    Map<String, dynamic>? queryParameters,
  ) {
    final authScope = 'auth=$_authEpoch';
    if (queryParameters == null || queryParameters.isEmpty) {
      return '$method:$authScope:$endpoint';
    }

    final normalized = queryParameters.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));

    final queryString =
        normalized.map((entry) => '${entry.key}=${entry.value}').join('&');

    return '$method:$authScope:$endpoint?$queryString';
  }

  static String? _autoCacheKey(
    String endpoint,
    Map<String, dynamic>? queryParameters,
  ) {
    final lower = endpoint.toLowerCase();
    final nonCacheable = lower.contains('/auth') ||
        lower.contains('/health') ||
        lower.contains('/metrics') ||
        lower.contains('/optimization') ||
        lower.contains('/admin');
    if (nonCacheable) return null;

    final queryString = _normalizedQueryString(queryParameters);
    return queryString.isEmpty
        ? 'api:auto:$endpoint'
        : 'api:auto:$endpoint?$queryString';
  }

  static String _normalizedQueryString(Map<String, dynamic>? queryParameters) {
    if (queryParameters == null || queryParameters.isEmpty) return '';
    final normalized = queryParameters.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));
    return normalized
        .map((entry) => '${entry.key}=${_normalizeQueryValue(entry.value)}')
        .join('&');
  }

  static String _normalizeQueryValue(Object? value) {
    if (value == null) return '';
    if (value is Iterable<Object?>) {
      return value.map(_normalizeQueryValue).join(',');
    }
    if (value is Map<Object?, Object?>) {
      final entries = value.entries.toList()
        ..sort((a, b) => a.key.toString().compareTo(b.key.toString()));
      return entries
          .map((entry) => '${entry.key}:${_normalizeQueryValue(entry.value)}')
          .join(',');
    }
    return value.toString();
  }

  static bool _isStaleUnauthorized(DioException e) {
    final currentAuth =
        _savedAuthToken != null ? 'Bearer $_savedAuthToken' : null;
    if (currentAuth == null) return false;

    final requestAuth = e.requestOptions.headers['Authorization']?.toString();
    if (requestAuth == null || requestAuth != currentAuth) {
      return true;
    }

    final requestEpoch = e.requestOptions.extra['authEpoch'];
    return requestEpoch is int && requestEpoch != _authEpoch;
  }

  /// Converts nested dynamic maps to string-keyed maps recursively.
  /// Hive deserialization returns _Map<dynamic,dynamic> for nested objects;
  /// a shallow Map.from() only fixes the top level.
  static Map<String, dynamic> _deepCastMap(Map<Object?, Object?> src) {
    return src.map((k, v) => MapEntry(k.toString(), _deepCastValue(v)));
  }

  static Object? _deepCastValue(Object? value) {
    if (value is Map<Object?, Object?>) return _deepCastMap(value);
    if (value is List<Object?>) {
      return value.map(_deepCastValue).toList();
    }
    return value;
  }

  static Options? _getOptionsForRead({
    bool forceRefresh = false,
    Duration? receiveTimeout,
  }) {
    if (!forceRefresh && receiveTimeout == null) return null;

    return Options(
      receiveTimeout: receiveTimeout,
      headers: forceRefresh
          ? const {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'X-Force-Refresh': 'true',
            }
          : null,
    );
  }

  /// GET request with optional caching
  ///
  /// [cacheKey] caches valid responses when provided.
  /// [cacheTTL] defaults to [CacheService.defaultTTL].
  /// [forceRefresh] bypasses cache when true.
  static Future<Map<String, dynamic>> get(
    String endpoint, {
    Map<String, dynamic>? queryParameters,
    String? cacheKey,
    Duration? cacheTTL,
    bool forceRefresh = false,
    bool allowStale = true,
    Duration maxStale = const Duration(hours: 24),
    Duration? receiveTimeout,
    CancelToken? cancelToken,
  }) async {
    final requestKey = _buildRequestKey('GET_MAP', endpoint, queryParameters);
    final effectiveCacheKey = cacheKey ??
        _autoCacheKey(
          endpoint,
          queryParameters,
        );
    final canDeduplicate = !forceRefresh && cancelToken == null;

    if (canDeduplicate) {
      final pending = _pendingRequests[requestKey];
      if (pending != null) {
        debugPrint('[ApiClient] Deduping request: $endpoint');
        return await pending as Map<String, dynamic>;
      }
    }

    final future = () async {
      if (effectiveCacheKey != null && forceRefresh) {
        await CacheService.invalidate(effectiveCacheKey);
      }

      // Try cache first if cacheKey provided and not forcing refresh
      if (effectiveCacheKey != null && !forceRefresh) {
        try {
          final cached = CacheService.get<Object?>(effectiveCacheKey);
          if (cached is Map<Object?, Object?>) {
            return _deepCastMap(cached);
          }
        } catch (e) {
          // Continue to network request
        }
      }

      try {
        final response = await dio.get<Object?>(
          endpoint,
          queryParameters: queryParameters,
          cancelToken: cancelToken,
          options: _getOptionsForRead(
            forceRefresh: forceRefresh,
            receiveTimeout: receiveTimeout,
          ),
        );
        final rawData = response.data;
        if (rawData is! Map<Object?, Object?>) {
          if (rawData is List) {
            throw ApiException('Response is a List, use getList() instead');
          }
          throw ApiException(
            'Expected Map response but got ${rawData.runtimeType}',
          );
        }
        final data = _deepCastMap(rawData);

        // Cache the response if cacheKey provided
        if (effectiveCacheKey != null) {
          await CacheService.set(effectiveCacheKey, data, ttl: cacheTTL);
        }

        return data;
      } on DioException catch (e) {
        if (effectiveCacheKey != null &&
            !forceRefresh &&
            allowStale &&
            _isNetworkError(e)) {
          try {
            final cached = CacheService.getStale<Object?>(
              effectiveCacheKey,
              maxStale: maxStale,
            );
            if (cached is Map<Object?, Object?>) {
              return _deepCastMap(cached);
            }
          } catch (_) {}
        }
        throw _handleError(e);
      }
    }();

    if (canDeduplicate) {
      _pendingRequests[requestKey] = future;
    }

    try {
      return await future;
    } finally {
      if (canDeduplicate) {
        final _ = _pendingRequests.remove(requestKey);
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
    bool allowStale = true,
    Duration maxStale = const Duration(hours: 24),
    CancelToken? cancelToken,
  }) async {
    final requestKey = _buildRequestKey('GET_LIST', endpoint, queryParameters);
    final effectiveCacheKey = cacheKey ??
        _autoCacheKey(
          endpoint,
          queryParameters,
        );
    final canDeduplicate = !forceRefresh && cancelToken == null;

    if (canDeduplicate) {
      final pending = _pendingRequests[requestKey];
      if (pending != null) {
        debugPrint('[ApiClient] Deduping list request: $endpoint');
        return await pending as List<dynamic>;
      }
    }

    final future = () async {
      if (effectiveCacheKey != null && forceRefresh) {
        await CacheService.invalidate(effectiveCacheKey);
      }

      // Try cache first if cacheKey provided and not forcing refresh
      if (effectiveCacheKey != null && !forceRefresh) {
        try {
          final cached = CacheService.get<Object?>(effectiveCacheKey);
          if (cached != null && cached is List) {
            return cached;
          }
        } catch (e) {
          // Continue to network
        }
      }

      try {
        final response = await dio.get<Object?>(
          endpoint,
          queryParameters: queryParameters,
          cancelToken: cancelToken,
          options: _getOptionsForRead(forceRefresh: forceRefresh),
        );

        final data = response.data;
        List<dynamic> result;

        if (data is List) {
          result = data;
        } else if (data is Map<Object?, Object?>) {
          final nestedData = data['data'];
          if (nestedData is! List<Object?>) {
            throw ApiException(
              'Expected List in response data but got '
              '${nestedData.runtimeType}',
            );
          }
          result = List<dynamic>.from(nestedData);
        } else {
          result = [data];
        }

        // Cache the response if cacheKey provided
        if (effectiveCacheKey != null) {
          await CacheService.set(effectiveCacheKey, result, ttl: cacheTTL);
        }

        return result;
      } on DioException catch (e) {
        if (effectiveCacheKey != null &&
            !forceRefresh &&
            allowStale &&
            _isNetworkError(e)) {
          final cached = CacheService.getStale<List<dynamic>>(
            effectiveCacheKey,
            maxStale: maxStale,
          );
          if (cached != null) {
            return cached;
          }
        }
        throw _handleError(e);
      }
    }();

    if (canDeduplicate) {
      _pendingRequests[requestKey] = future;
    }

    try {
      return await future;
    } finally {
      if (canDeduplicate) {
        final _ = _pendingRequests.remove(requestKey);
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
      final response = await dio.get<Object?>(
        endpoint,
        queryParameters: queryParameters,
        options: Options(
          responseType: ResponseType.bytes,
          receiveTimeout: const Duration(seconds: 60),
        ),
      );
      return response.data! as List<int>;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  /// Downloads a file through shared interceptors and error mapping.
  static Future<Response<dynamic>> download(
    String url,
    String savePath, {
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
    ProgressCallback? onReceiveProgress,
    Duration receiveTimeout = const Duration(seconds: 60),
    bool deleteOnError = true,
  }) async {
    try {
      return await dio.download(
        url,
        savePath,
        queryParameters: queryParameters,
        cancelToken: cancelToken,
        onReceiveProgress: onReceiveProgress,
        deleteOnError: deleteOnError,
        options: Options(receiveTimeout: receiveTimeout),
      );
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  /// POST request (never cached)
  static Future<Map<String, dynamic>> post(
    String endpoint,
    Map<String, dynamic> data, {
    Map<String, String>? headers,
    bool idempotent = false,
    Duration? receiveTimeout,
    int? maxRetries,
  }) async {
    try {
      final response = await dio.post<Map<String, dynamic>>(
        endpoint,
        data: data,
        options: Options(
          receiveTimeout: receiveTimeout,
          headers: headers == null ? null : Map<String, String>.from(headers),
          extra: <String, dynamic>{
            'idempotent': idempotent,
            if (maxRetries != null) 'maxRetries': maxRetries,
          },
        ),
      );
      return response.data!;
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
    return post(endpoint, data, receiveTimeout: receiveTimeout);
  }

  /// PUT request
  static Future<Map<String, dynamic>> put(
    String endpoint, {
    Map<String, dynamic>? data,
  }) async {
    try {
      final response =
          await dio.put<Map<String, dynamic>>(endpoint, data: data);
      return response.data!;
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
      final response =
          await dio.delete<Map<String, dynamic>>(endpoint, data: data);
      return response.data!;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  static bool _isNetworkError(DioException e) {
    return e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.unknown;
  }

  static ApiException _handleError(DioException e) {
    // Never emit transport payloads, exception strings, request paths, tokens,
    // SQL or filesystem details to client logs.
    debugPrint(
      '[ApiClient] Request failed: type=${e.type} '
      'status=${e.response?.statusCode ?? 0}',
    );
    if (e.type == DioExceptionType.cancel) {
      return ApiException(
        'Solicitud cancelada.',
        statusCode: 0,
        code: 'CANCELLED',
      );
    } else if (e.type == DioExceptionType.connectionTimeout) {
      return ApiException(
        'Timeout de conexiÃ³n. Verifica tu conexiÃ³n a internet e '
        'intÃ©ntalo de nuevo.',
        statusCode: 0,
      );
    } else if (e.type == DioExceptionType.connectionError) {
      // Verificar si es error de socket (sin internet)
      if (e.error is SocketException ||
          (e.error?.toString().contains('SocketException') ?? false)) {
        return ApiException(
          'No hay conexiÃ³n a internet. Verifica tu WiFi o datos mÃ³viles.',
          statusCode: 0,
        );
      }
      return ApiException(
        'Error de conexiÃ³n. Verifica tu conexiÃ³n a internet.',
        statusCode: 0,
      );
    } else if (e.type == DioExceptionType.receiveTimeout) {
      return ApiException(
        'El servidor estÃ¡ tardando demasiado. IntÃ©ntalo de nuevo.',
        statusCode: 0,
      );
    } else if (e.type == DioExceptionType.sendTimeout) {
      return ApiException(
        'Error al enviar datos. Verifica tu conexiÃ³n.',
        statusCode: 0,
      );
    } else if (e.response != null) {
      final statusCode = e.response?.statusCode ?? 0;
      final data = e.response?.data;

      // Extract server error message + semantic code
      String? serverMessage;
      String? serverCode;
      String? serverConfirmationId;
      if (data is Map<String, dynamic>) {
        final error = data['error'] as String?;
        final details = data['details'] as String?;
        serverMessage = details != null && details.isNotEmpty
            ? '$error: $details'
            : (error ?? data['message'] as String?);
        serverCode = data['code'] as String?;
        final rawConfirmationId = data['confirmationId'];
        if (rawConfirmationId is String && rawConfirmationId.isNotEmpty) {
          serverConfirmationId = rawConfirmationId.trim();
        } else if (rawConfirmationId is num && rawConfirmationId.isFinite) {
          serverConfirmationId =
              rawConfirmationId == rawConfirmationId.roundToDouble()
                  ? rawConfirmationId.toInt().toString()
                  : rawConfirmationId.toString();
        }
      }

      if (statusCode == 401) {
        final isLoginRequest = e.requestOptions.path.contains('/auth/login');
        // Compare the token used in THIS request vs the currently stored token.
        // If they differ, this 401 is from a STALE request (previous session)
        // and must NOT trigger a logout that would wipe the fresh new token.
        final isStaleRequest = _isStaleUnauthorized(e);
        if (!isLoginRequest &&
            !_isLoggingOut &&
            !_isLoggingIn &&
            !isStaleRequest) {
          _isLoggingOut = true;
          debugPrint('[ApiClient] 401 detected - triggering logout');
          onUnauthorized?.call();
          // Reset flag after short delay to allow re-login
          unawaited(
            Future<void>.delayed(
              const Duration(seconds: 2),
              () => _isLoggingOut = false,
            ),
          );
        }
        return ApiException(
          serverMessage ?? 'Credenciales invÃ¡lidas. Verifica usuario y PIN.',
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
          confirmationId: serverConfirmationId,
        );
      } else if (statusCode >= 500) {
        return ApiException(
          'Error del servidor ($statusCode). IntÃ©ntalo mÃ¡s tarde.',
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
          'No hay conexiÃ³n a internet. Verifica WiFi o datos mÃ³viles.',
          statusCode: 0,
        );
      } else if (errorMsg.contains('ssl') || errorMsg.contains('certificate')) {
        return ApiException(
          'Error de seguridad. Verifica tu conexiÃ³n.',
          statusCode: 0,
        );
      }
    }

    // Default error
    return ApiException(
      'Error de conexiÃ³n. Verifica tu internet e intÃ©ntalo de nuevo.',
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
    bool allowStale = true,
    Duration maxStale = const Duration(hours: 24),
    CancelToken? cancelToken,
  }) async {
    return get(
      endpoint,
      queryParameters: queryParameters,
      cacheKey: cacheKey,
      cacheTTL: cacheTTL,
      forceRefresh: forceRefresh,
      allowStale: allowStale,
      maxStale: maxStale,
      cancelToken: cancelToken,
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
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final shouldRetry = _shouldRetry(err);
    final configuredRetries = err.requestOptions.extra['maxRetries'];
    final retryLimit = configuredRetries is int && configuredRetries >= 0
        ? configuredRetries
        : _maxRetries;
    final retryCount = err.requestOptions.extra['retryCount'] as int? ?? 0;

    if (retryCount == 0) {
      // Keep diagnostics useful without leaking paths, query values, headers,
      // bearer tokens, credentials or raw transport exceptions.
      debugPrint(
        '[ApiClient] Request failed: method=${err.requestOptions.method} '
        'type=${err.type} status=${err.response?.statusCode ?? 0}',
      );
    }

    if (shouldRetry && retryCount < retryLimit) {
      // FIX: Use longer backoff for 429 rate limit errors
      final isRateLimited = err.response?.statusCode == 429;
      final baseDelay = isRateLimited ? _retryDelay * 2 : _retryDelay;
      final delay = baseDelay * (retryCount + 1);

      debugPrint(
        '[ApiClient] Retrying request (${retryCount + 1}/$retryLimit) in ${delay.inSeconds}s...',
      );

      // Exponential backoff
      await Future<void>.delayed(delay);

      try {
        err.requestOptions.extra['retryCount'] = retryCount + 1;
        final response = await _dio.fetch<dynamic>(err.requestOptions);
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

/// Typed API failure exposed to application layers.
class ApiException implements Exception {
  /// Creates an API failure with optional backend metadata.
  ApiException(
    this.message, {
    this.statusCode,
    this.code,
    this.confirmationId,
  });

  /// User-facing failure description.
  final String message;

  /// HTTP status, or zero/null for transport failures.
  final int? statusCode;

  /// CÃ³digo semÃ¡ntico devuelto por el backend (por ejemplo
  /// `COBRO_ALREADY_LIQUIDADO`, `PAYMENT_AUTHZ_DENIED`, ...). Permite
  /// que la UI haga mensaje especÃ­fico sin parsear el texto humano.
  final String? code;

  /// Server-issued confirmation identifier returned by a typed conflict.
  final String? confirmationId;
  @override
  String toString() => code != null ? '[$code] $message' : message;
}
