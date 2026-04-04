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

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'dart:async';

import '../../core/api/api_client.dart';
import '../../core/api/api_config.dart';
import '../../core/models/user_model.dart';
import '../../core/cache/cache_service.dart';
import '../../core/services/cache_prewarmer.dart';
import '../../core/services/secure_storage.dart';
import 'filter_provider.dart';

// ============================================================
// STATE
// ============================================================

class AuthState {
  final UserModel? user;
  final List<String> vendedorCodes;
  final bool isLoading;
  final String? error;
  final bool isInitialized;
  final bool updateAvailable;
  final bool isMandatoryUpdate;
  final String updateMessage;

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

class AuthNotifier extends AutoDisposeAsyncNotifier<AuthState> {
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

  /// Attempt to restore session from storage
  Future<AuthState> _tryAutoLogin() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = await SecureStorage.readSecureData('user_token');
      final userDataStr = await SecureStorage.readSecureData('user_data');
      final codes = prefs.getStringList('vendedor_codes');

      if (token != null && userDataStr != null) {
        ApiClient.setAuthToken(token);
        final user = UserModel.fromJson(
          jsonDecode(userDataStr) as Map<String, dynamic>,
        );
        final vendedorCodes = codes ?? [];

        // Pre-warm cache in background
        unawaited(CachePreWarmer.preWarmCacheForCodes(vendedorCodes));

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
    state = const AsyncValue.loading();

    try {
      if (username.isEmpty || password.isEmpty) {
        state = AsyncValue.data(
          const AuthState(isInitialized: true, error: 'Usuario y contraseña requeridos'),
        );
        return false;
      }

      final response = await ApiClient.post(
        ApiConfig.login,
        {'username': username, 'password': password},
      );

      if (response == null) {
        state = AsyncValue.data(
          const AuthState(
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
        
        if (token == null || token.isEmpty) {
          state = AsyncValue.data(
            const AuthState(
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
        await SecureStorage.writeSecureData(
          'user_data',
          jsonEncode(response['user']),
        );

        final prefs = await SharedPreferences.getInstance();
        await prefs.setStringList('vendedor_codes', vendedorCodes);

        // Update state
        state = AsyncValue.data(
          AuthState(
            user: user,
            vendedorCodes: vendedorCodes,
            isInitialized: true,
          ),
        );

        // Pre-warm cache in background
        unawaited(CachePreWarmer.preWarmCacheForCodes(vendedorCodes));

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
    }
  }

  /// Login for multi-role users
  Future<bool> loginWithRole(String username, String password, String role) async {
    state = const AsyncValue.loading();

    try {
      final response = await ApiClient.post(
        ApiConfig.login,
        {'username': username, 'password': password, 'role': role},
      );

      if (response == null || response['user'] == null) {
        state = AsyncValue.data(
          const AuthState(isInitialized: true, error: 'Credenciales inválidas'),
        );
        return false;
      }

      final user = UserModel.fromJson(response['user'] as Map<String, dynamic>);
      final token = response['token'] as String?;
      if (token == null) {
        state = AsyncValue.data(
          const AuthState(isInitialized: true, error: 'Token faltante'),
        );
        return false;
      }

      final vendedorCodes = response['vendedorCodes'] != null
          ? List<String>.from(response['vendedorCodes'] as Iterable)
          : <String>[];

      ApiClient.setAuthToken(token);
      await SecureStorage.writeSecureData('user_token', token);
      await SecureStorage.writeSecureData('user_data', jsonEncode(response['user']));

      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList('vendedor_codes', vendedorCodes);

      state = AsyncValue.data(
        AuthState(user: user, vendedorCodes: vendedorCodes, isInitialized: true),
      );

      unawaited(CachePreWarmer.preWarmCacheForCodes(vendedorCodes));
      return true;
    } catch (e) {
      state = AsyncValue.data(
        AuthState(isInitialized: true, error: e.toString()),
      );
      return false;
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
    await SecureStorage.deleteSecureData('user_token');
    await SecureStorage.deleteSecureData('user_data');

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('vendedor_codes');
    await prefs.remove('global_filter_vendor');

    // Clear ALL caches (defense-in-depth for shared devices)
    try {
      await CacheService.clearAll();
      CacheService.clearMemoryCache();
      CachePreWarmer.reset();
      debugPrint('[AuthNotifier] All caches cleared on logout');
    } catch (e) {
      debugPrint('[AuthNotifier] Cache clear error: $e');
    }

    // Clear filters
    try {
      FilterProvider().clear();
    } catch (e) {
      debugPrint('[AuthNotifier] Filter clear error: $e');
    }
  }

  /// Switch role (Jefe / Comercial / Repartidor)
  Future<bool> switchRole(String newRole, {String? viewAs}) async {
    final currentState = state.value;
    if (currentState?.user == null) return false;

    state = AsyncValue.data(currentState!.copyWith(isLoading: true, error: null));

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
          ApiClient.setAuthToken(token);
          await SecureStorage.writeSecureData('user_token', token);

          final updatedUser = currentState.user!.copyWith(role: newRole);
          state = AsyncValue.data(currentState.copyWith(user: updatedUser, isLoading: false));
        }
        return true;
      }

      state = AsyncValue.data(currentState.copyWith(isLoading: false, error: 'Failed to switch role'));
      return false;
    } catch (e) {
      state = AsyncValue.data(currentState.copyWith(isLoading: false, error: e.toString()));
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
      state = AsyncValue.data(currentState.copyWith(error: null));
    }
  }
}

// ============================================================
// PROVIDER
// ==========================================================

final authProvider = AsyncNotifierProvider.autoDispose<AuthNotifier, AuthState>(
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

final updateCheckProvider = Provider<({bool available, bool mandatory, String message})>((ref) {
  final state = ref.watch(authProvider).value;
  return (
    available: state?.updateAvailable ?? false,
    mandatory: state?.isMandatoryUpdate ?? false,
    message: state?.updateMessage ?? '',
  );
});
