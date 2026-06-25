/// Auth Notifier - Riverpod AsyncNotifier v4.0.0
///
/// Replaces AuthProvider (ChangeNotifier) with compile-safe AsyncNotifier.
/// Features:
/// - Auto-login on app start
/// - Login/logout with secure storage
/// - Role switching
/// - 401 global logout callback
/// - Mandatory update check
///
/// @agent Flutter Riverpod - AsyncNotifier + code generation ready
/// @agent Security - Secure token storage, no plaintext credentials
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/providers/filter_provider.dart';
import 'package:gmp_app_mobilidad/core/services/cache_prewarmer.dart';
import 'package:gmp_app_mobilidad/core/services/secure_storage.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_favorites_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ============================================================
// STATE
// ============================================================

class AuthState {
  const AuthState({
    this.user,
    this.vendedorCodes = const [],
    this.isLoading = false,
    this.error,
    this.isInitialized = false,
    this.updateAvailable = false,
    this.isMandatoryUpdate = false,
    this.updateMessage = '',
  });
  final UserModel? user;
  final List<String> vendedorCodes;
  final bool isLoading;
  final String? error;
  final bool isInitialized;
  final bool updateAvailable;
  final bool isMandatoryUpdate;
  final String updateMessage;

  bool get isAuthenticated => user != null;
  bool get isDirector => user?.isDirector ?? false;
  String get playStoreUrl =>
      'https://play.google.com/store/apps/details?id=com.jlp.gmp_mobilidad';

  AuthState copyWith({
    UserModel? user,
    List<String>? vendedorCodes,
    bool? isLoading,
    String? error,
    bool? isInitialized,
    bool? updateAvailable,
    bool? isMandatoryUpdate,
    String? updateMessage,
  }) {
    return AuthState(
      user: user ?? this.user,
      vendedorCodes: vendedorCodes ?? this.vendedorCodes,
      isLoading: isLoading ?? this.isLoading,
      error: error, // null = keep, empty string = clear
      isInitialized: isInitialized ?? this.isInitialized,
      updateAvailable: updateAvailable ?? this.updateAvailable,
      isMandatoryUpdate: isMandatoryUpdate ?? this.isMandatoryUpdate,
      updateMessage: updateMessage ?? this.updateMessage,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthState &&
          runtimeType == other.runtimeType &&
          user == other.user &&
          vendedorCodes == other.vendedorCodes &&
          isLoading == other.isLoading &&
          error == other.error &&
          isInitialized == other.isInitialized &&
          updateAvailable == other.updateAvailable &&
          isMandatoryUpdate == other.isMandatoryUpdate &&
          updateMessage == other.updateMessage;

  @override
  int get hashCode => Object.hash(
        user,
        vendedorCodes,
        isLoading,
        error,
        isInitialized,
        updateAvailable,
        isMandatoryUpdate,
        updateMessage,
      );
}

// ============================================================
// NOTIFIER
// ============================================================

// CRITICAL: Do NOT use autoDispose for auth provider.
// When user presses back button and returns, autoDispose would destroy
// the provider and force re-initialization, causing session loss and
// triggering rate limiting from repeated login attempts.
class AuthNotifier extends AsyncNotifier<AuthState> {
  @override
  Future<AuthState> build() async {
    // Bind global 401 callback
    ApiClient.onUnauthorized = () {
      debugPrint('[AuthNotifier] 401 detected — logging out');
      logout(sessionExpired: true);
    };

    // Try auto-login
    return _tryAutoLogin();
  }

  void _applyCacheScope(UserModel user, List<String> vendedorCodes) {
    final normalizedCodes = vendedorCodes
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .toSet()
        .toList()
      ..sort();

    final scope = [
      'user=${user.code.trim()}',
      'role=${user.role.trim().toUpperCase()}',
      'jefe=${user.isJefeVentas}',
      'vendors=${normalizedCodes.join(',')}',
    ].join('|');
    CacheService.setScope(scope);
    PedidosOfflineService.setScope(scope);
    PedidosFavoritesService.setScope(scope);
  }

  Future<void> _clearLocalSessionCache() async {
    try {
      await CacheService.clearAll();
      CacheService.clearScope();
      ApiClient.clearPendingRequests();
      PedidosOfflineService.clearScope();
      PedidosFavoritesService.clearScope();
      CachePreWarmer.reset();
      debugPrint('[AuthNotifier] Local session caches cleared');
    } catch (e) {
      debugPrint('[AuthNotifier] Cache clear error: $e');
    }
  }

  /// Returns true if the stored token is expired.
  /// The server uses a custom 2-part HMAC format: base64(JSON).hmacHex
  /// The payload contains a 'timestamp' (ms epoch) and the TTL is 1 hour.
  bool _isTokenExpired(String token) {
    try {
      // Custom format: base64Payload.hmacHex  (NOT standard 3-part JWT)
      final dotIndex = token.indexOf('.');
      if (dotIndex < 1) return true;
      var dataB64 = token.substring(0, dotIndex);
      // Add standard base64 padding if needed
      switch (dataB64.length % 4) {
        case 2:
          dataB64 += '==';
          break;
        case 3:
          dataB64 += '=';
          break;
        default:
          break;
      }
      final decoded = utf8.decode(base64.decode(dataB64));
      final data = jsonDecode(decoded) as Map<String, dynamic>;
      // Token payload uses 'timestamp' (ms since epoch), TTL = 1 hour server-side
      final timestamp = data['timestamp'];
      if (timestamp == null) return true;
      final ts = timestamp is int
          ? timestamp
          : int.tryParse(timestamp.toString()) ?? 0;
      const ttlMs = 86400000; // 24 hours — matches server JWT_ACCESS_EXPIRES
      return DateTime.now().millisecondsSinceEpoch - ts > ttlMs;
    } catch (_) {
      return true; // can't decode → treat as expired
    }
  }

  /// Attempt to restore session from storage
  Future<AuthState> _tryAutoLogin() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      var token = await SecureStorage.readSecureData('user_token');
      final userDataStr = await SecureStorage.readSecureData('user_data');
      final codes = prefs.getStringList('vendedor_codes');

      if (token != null && userDataStr != null) {
        // Check token expiry BEFORE restoring session to avoid a burst of 401s
        if (_isTokenExpired(token)) {
          ApiClient.setAuthToken(token);
          final refreshed = await ApiClient.refreshAccessToken();
          token = await SecureStorage.readSecureData('user_token');
          if (refreshed && token != null && token.isNotEmpty) {
            debugPrint('[AuthNotifier] Stored token refreshed');
          } else {
            debugPrint(
                '[AuthNotifier] Stored token expired — clearing session');
            await SecureStorage.deleteSecureData('user_token');
            await SecureStorage.deleteSecureData('refresh_token');
            await SecureStorage.deleteSecureData('user_data');
            await prefs.remove('vendedor_codes');
            await _clearLocalSessionCache();
            return const AuthState(isInitialized: true);
          }
        }
        // Validate token with server before restoring session.
        // The server uses ephemeral JWT secrets — a server restart invalidates
        // all stored tokens even if they haven't expired by time.
        // If the server is unreachable (offline), we proceed optimistically.
        ApiClient.setAuthToken(token);
        ApiClient.startLogin(); // suppress onUnauthorized during validation
        try {
          await ApiClient.get(ApiConfig.validate);
        } on ApiException catch (e) {
          if (e.statusCode == 401 || e.statusCode == 403) {
            debugPrint(
              '[AuthNotifier] Server rejected stored token — clearing session',
            );
            ApiClient.clearAuthToken();
            await SecureStorage.deleteSecureData('user_token');
            await SecureStorage.deleteSecureData('refresh_token');
            await SecureStorage.deleteSecureData('user_data');
            await prefs.remove('vendedor_codes');
            await _clearLocalSessionCache();
            return const AuthState(isInitialized: true);
          }
        } catch (_) {
          // Network error — proceed with stored session (offline-tolerant)
          debugPrint(
              '[AuthNotifier] Could not reach server, proceeding offline');
        } finally {
          ApiClient.endLogin();
        }
        final user = UserModel.fromJson(
          jsonDecode(userDataStr) as Map<String, dynamic>,
        );
        final vendedorCodes = codes ?? [];
        _applyCacheScope(user, vendedorCodes);

        // Pre-warm cache in background
        unawaited(
          CachePreWarmer.preWarmCache(
            vendedorCodes: vendedorCodes,
            isJefeVentas: user.isJefeVentas,
          ),
        );

        // Check for updates in background
        unawaited(_checkForUpdates());

        return AuthState(
          user: user,
          vendedorCodes: vendedorCodes,
          isInitialized: true,
        );
      }
    } catch (e) {
      debugPrint('[AuthNotifier] Auto-login failed: $e');
    }

    return const AuthState(isInitialized: true);
  }

  /// Login with credentials
  Future<bool> login(String username, String password) async {
    ApiClient.startLogin(); // Block concurrent 401s from triggering logout
    state = const AsyncValue.loading();

    try {
      if (username.isEmpty || password.isEmpty) {
        state = const AsyncValue.data(
          AuthState(
              isInitialized: true, error: 'Usuario y contraseña requeridos'),
        );
        return false;
      }

      // Ensure Dio is ready with correct timeouts for current network
      await ApiClient.ensureDioReady();

      final response = await ApiClient.post(
        ApiConfig.login,
        {'username': username, 'password': password},
      );

      if (response == null) {
        state = const AsyncValue.data(
          AuthState(
            isInitialized: true,
            error: 'No se pudo conectar con el servidor',
          ),
        );
        return false;
      }

      if (response['requiresRoleSelection'] == true) {
        state = AsyncValue.data(
          AuthState(
            isInitialized: true,
            error: 'ROLE_SELECTION',
            updateMessage: jsonEncode(response['availableRoles'] ?? []),
          ),
        );
        return false;
      }

      if (response['user'] != null) {
        final user = UserModel.fromJson(
          response['user'] as Map<String, dynamic>,
        );
        final token = response['token'] as String?;
        final refreshToken = response['refreshToken'] as String?;

        if (token == null || token.isEmpty) {
          state = const AsyncValue.data(
            AuthState(
              isInitialized: true,
              error: 'Respuesta inválida del servidor: token faltante',
            ),
          );
          return false;
        }

        final vendedorCodes = response['vendedorCodes'] != null
            ? List<String>.from(response['vendedorCodes'] as Iterable)
            : <String>[];

        // Store token
        ApiClient.setAuthToken(token);
        await SecureStorage.writeSecureData('user_token', token);
        if (refreshToken != null && refreshToken.isNotEmpty) {
          await ApiClient.storeRefreshToken(refreshToken);
        }
        await SecureStorage.writeSecureData(
          'user_data',
          jsonEncode(response['user']),
        );

        final prefs = await SharedPreferences.getInstance();
        await prefs.setStringList('vendedor_codes', vendedorCodes);
        _applyCacheScope(user, vendedorCodes);

        // Re-apply token immediately before state update to guard against
        // stale 401 responses clearing it during the storage writes above
        ApiClient.setAuthToken(token);

        // Update state
        state = AsyncValue.data(
          AuthState(
            user: user,
            vendedorCodes: vendedorCodes,
            isInitialized: true,
          ),
        );

        // Pre-warm cache in background
        unawaited(
          CachePreWarmer.preWarmCache(
            vendedorCodes: vendedorCodes,
            isJefeVentas: user.isJefeVentas,
          ),
        );

        debugPrint('[AuthNotifier] Login successful: ${user.name}');
        return true;
      } else {
        state = AsyncValue.data(
          AuthState(
            isInitialized: true,
            error: response['error']?.toString() ?? 'Respuesta inválida',
          ),
        );
        return false;
      }
    } catch (e, st) {
      debugPrint('[AuthNotifier] Login error: $e');
      state = AsyncValue.data(
        AuthState(
          isInitialized: true,
          error: e.toString().replaceAll('Exception: ', ''),
        ),
      );
      debugPrintStack(stackTrace: st);
      return false;
    } finally {
      ApiClient.endLogin();
    }
  }

  /// Login for multi-role users
  Future<bool> loginWithRole(
      String username, String password, String role) async {
    ApiClient.startLogin(); // Block concurrent 401s from triggering logout
    state = const AsyncValue.loading();

    try {
      final response = await ApiClient.post(
        ApiConfig.login,
        {'username': username, 'password': password, 'role': role},
      );

      if (response == null || response['user'] == null) {
        state = const AsyncValue.data(
          AuthState(isInitialized: true, error: 'Credenciales inválidas'),
        );
        return false;
      }

      final user = UserModel.fromJson(response['user'] as Map<String, dynamic>);
      final token = response['token'] as String?;
      final refreshToken = response['refreshToken'] as String?;
      if (token == null) {
        state = const AsyncValue.data(
          AuthState(isInitialized: true, error: 'Token faltante'),
        );
        return false;
      }

      final vendedorCodes = response['vendedorCodes'] != null
          ? List<String>.from(response['vendedorCodes'] as Iterable)
          : <String>[];

      ApiClient.setAuthToken(token);
      await SecureStorage.writeSecureData('user_token', token);
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await ApiClient.storeRefreshToken(refreshToken);
      }
      await SecureStorage.writeSecureData(
          'user_data', jsonEncode(response['user']));

      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList('vendedor_codes', vendedorCodes);
      _applyCacheScope(user, vendedorCodes);

      // Re-apply token immediately before state update to guard against
      // stale 401 responses clearing it during the storage writes above
      ApiClient.setAuthToken(token);

      state = AsyncValue.data(
        AuthState(
            user: user, vendedorCodes: vendedorCodes, isInitialized: true),
      );

      unawaited(
        CachePreWarmer.preWarmCache(
          vendedorCodes: vendedorCodes,
          isJefeVentas: user.isJefeVentas,
        ),
      );
      return true;
    } catch (e) {
      state = AsyncValue.data(
        AuthState(isInitialized: true, error: e.toString()),
      );
      return false;
    } finally {
      ApiClient.endLogin();
    }
  }

  /// Logout
  Future<void> logout({bool sessionExpired = false}) async {
    // Clear auth state immediately
    state = AsyncValue.data(
      AuthState(
        isInitialized: true,
        error: sessionExpired
            ? 'Tu sesión ha expirado. Por favor, inicia sesión de nuevo.'
            : null,
      ),
    );

    // Clear token
    ApiClient.clearAuthToken();
    await ApiClient.clearRefreshToken();
    await SecureStorage.deleteSecureData('user_token');
    await SecureStorage.deleteSecureData('user_data');

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('vendedor_codes');
    await prefs.remove('global_filter_vendor');

    // Clear ALL caches (defense-in-depth for shared devices)
    await _clearLocalSessionCache();

    // Clear filters
    try {
      ref.read(filterProvider.notifier).clear();
    } catch (e) {
      debugPrint('[AuthNotifier] Filter clear error: $e');
    }
  }

  /// Switch role (Jefe / Comercial / Repartidor)
  Future<bool> switchRole(String newRole, {String? viewAs}) async {
    final currentState = state.value;
    if (currentState?.user == null) return false;

    state = AsyncValue.data(currentState!.copyWith(isLoading: true));

    try {
      final response = await ApiClient.post(
        '/auth/switch-role',
        {
          'userId': currentState.user!.code,
          'newRole': newRole,
          'viewAs': viewAs,
        },
      );

      if (response != null && response['success'] == true) {
        if (response['token'] != null) {
          final token = response['token'] as String;
          final refreshToken = response['refreshToken'] as String?;
          ApiClient.setAuthToken(token);
          await SecureStorage.writeSecureData('user_token', token);
          if (refreshToken != null && refreshToken.isNotEmpty) {
            await ApiClient.storeRefreshToken(refreshToken);
          }

          final updatedUser = currentState.user!.copyWith(role: newRole);
          final nextVendedorCodes = response['vendedorCodes'] != null
              ? List<String>.from(response['vendedorCodes'] as Iterable)
              : currentState.vendedorCodes;
          final prefs = await SharedPreferences.getInstance();
          await prefs.setStringList('vendedor_codes', nextVendedorCodes);
          await SecureStorage.writeSecureData(
            'user_data',
            jsonEncode(updatedUser.toJson()),
          );
          await _clearLocalSessionCache();
          _applyCacheScope(updatedUser, nextVendedorCodes);
          state = AsyncValue.data(
            currentState.copyWith(
              user: updatedUser,
              vendedorCodes: nextVendedorCodes,
              isLoading: false,
            ),
          );
        }
        return true;
      }

      state = AsyncValue.data(currentState.copyWith(
          isLoading: false, error: 'Failed to switch role'));
      return false;
    } catch (e) {
      state = AsyncValue.data(
          currentState.copyWith(isLoading: false, error: e.toString()));
      return false;
    }
  }

  /// Check for mandatory updates
  Future<void> _checkForUpdates() async {
    try {
      final response = await ApiClient.get('/health/version-check');
      if (response == null) return;

      final currentState = state.value;
      if (currentState == null) return;

      final data = response as Map<String, dynamic>;
      state = AsyncValue.data(
        currentState.copyWith(
          updateAvailable: data['updateAvailable'] == true,
          isMandatoryUpdate: data['isMandatoryUpdate'] == true,
          updateMessage: (data['message'] as String?) ?? '',
        ),
      );
    } catch (e) {
      debugPrint('[AuthNotifier] Update check error: $e');
    }
  }

  /// Clear error
  void clearError() {
    final currentState = state.value;
    if (currentState != null) {
      state = AsyncValue.data(currentState.copyWith());
    }
  }
}

// ============================================================
// PROVIDER
// ==========================================================

final authProvider = AsyncNotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);

// ============================================================
// SELECTORS (derived state, recompute only when dependency changes)
// ============================================================

final isAuthenticatedProvider = Provider<bool>((ref) {
  return ref.watch(authProvider).value?.isAuthenticated ?? false;
});

final currentUserProvider = Provider<UserModel?>((ref) {
  return ref.watch(authProvider).value?.user;
});

final vendedorCodesProvider = Provider<List<String>>((ref) {
  return ref.watch(authProvider).value?.vendedorCodes ?? [];
});

final isJefeVentasProvider = Provider<bool>((ref) {
  return ref.watch(authProvider).value?.isDirector ?? false;
});

final isInitializedProvider = Provider<bool>((ref) {
  return ref.watch(authProvider).value?.isInitialized ?? false;
});

final authErrorProvider = Provider<String?>((ref) {
  return ref.watch(authProvider).value?.error;
});

final updateCheckProvider =
    Provider<({bool available, bool mandatory, String message})>((ref) {
  final state = ref.watch(authProvider).value;
  return (
    available: state?.updateAvailable ?? false,
    mandatory: state?.isMandatoryUpdate ?? false,
    message: state?.updateMessage ?? '',
  );
});
