import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/api_client.dart';
import '../api/api_config.dart';
import '../models/user_model.dart';
import 'dart:convert';
import 'package:package_info_plus/package_info_plus.dart';
import '../cache/cache_service.dart';
import '../services/cache_prewarmer.dart';
import '../services/secure_storage.dart';

/// Authentication provider with role detection
class AuthProvider with ChangeNotifier {
  UserModel? _currentUser;
  bool _isLoading = false;
  String? _error;
  bool _initialized = false;
  bool _isMandatoryUpdate = false;
  String _playStoreUrl =
      'https://play.google.com/store/apps/details?id=com.jlp.gmp_mobilidad';
  bool _updateAvailable = false;
  String _updateMessage = '';
  List<String> _vendedorCodes = [];

  UserModel? get currentUser => _currentUser;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isAuthenticated => _currentUser != null;
  bool get isInitialized => _initialized;
  bool get updateAvailable => _updateAvailable;
  bool get isMandatoryUpdate => _isMandatoryUpdate;
  String get updateMessage => _updateMessage;
  String get playStoreUrl => _playStoreUrl;
  bool get isDirector => _currentUser?.isDirector ?? false;
  List<String> get vendorCodes => _vendedorCodes;
  // Alias for compatibility
  List<String> get vendedorCodes => _vendedorCodes;

  /// Check for updates and enforce mandatory update if needed
  Future<void> checkForUpdates() async {
    try {
      final packageInfo = await PackageInfo.fromPlatform();
      final currentVersion = int.parse(packageInfo.buildNumber);

      // SENIOR APPROACH: Fetch minimum required version from server
      // For now, we mock the check. In a real scenario, this comes from /health or /config
      final response = await ApiClient.get('/health/version-check');

      if (response != null && response['success'] == true) {
        final minRequiredVersion =
            int.tryParse(response['minVersion']?.toString() ?? '0') ?? 0;
        final latestVersion =
            int.tryParse(response['latestVersion']?.toString() ?? '0') ?? 0;

        if (currentVersion < minRequiredVersion) {
          _updateAvailable = true;
          _isMandatoryUpdate = true;
          _updateMessage = (response['message'] as String?) ??
              'Es necesaria una nueva versión para continuar.';
          notifyListeners();
        } else if (currentVersion < latestVersion) {
          _updateAvailable = true;
          _isMandatoryUpdate = false;
          _updateMessage = (response['message'] as String?) ??
              'Hay una nueva versión disponible.';
          notifyListeners();
        }
      }
    } catch (e) {
      debugPrint('[AuthProvider] Error checking updates: $e');
    }
  }

  AuthProvider() {
    // Bind global 401 unauthorized event to logout
    ApiClient.onUnauthorized = () {
      debugPrint('[AuthProvider] 401 Detected - Logging out...');
      logout();
    };

    // Initial update check
    checkForUpdates();
  }

  /// Login with username and password
  Future<bool> login(String username, String password) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      if (kDebugMode) debugPrint('[AuthProvider] Calling API login...');

      final response = await ApiClient.post(
        ApiConfig.login,
        {'username': username, 'password': password},
      );

      if (kDebugMode)
        debugPrint('[AuthProvider] Response received: ${response.keys}');

      if (response != null && response['user'] != null) {
        _currentUser =
            UserModel.fromJson(response['user'] as Map<String, dynamic>);

        // Handle vendedor codes
        if (response['vendedorCodes'] != null) {
          _vendedorCodes =
              List<String>.from(response['vendedorCodes'] as Iterable);
        }

        ApiClient.setAuthToken(response['token'] as String);

        // Save sensitive data to secure storage
        await SecureStorage.writeSecureData(
            'user_token', response['token'] as String);
        await SecureStorage.writeSecureData(
            'user_data', jsonEncode(response['user']));
        // Non-sensitive data stays in SharedPreferences
        final prefs = await SharedPreferences.getInstance();
        await prefs.setStringList('vendedor_codes', _vendedorCodes);

        _isLoading = false;
        notifyListeners();
        if (kDebugMode) debugPrint('[AuthProvider] Login SUCCESS');

        // OPTIMIZATION: Pre-warm cache for instant data access
        // Run in background without awaiting to not block UI
        CachePreWarmer.preWarmCache(this);

        return true;
      } else {
        throw Exception('Respuesta inválida del servidor');
      }
    } catch (e) {
      if (kDebugMode) debugPrint('[AuthProvider] Login ERROR: $e');
      _error = e.toString().replaceAll('Exception: ', '');
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// Try to restore session from storage
  Future<bool> tryAutoLogin() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = await SecureStorage.readSecureData('user_token');
      final userDataStr = await SecureStorage.readSecureData('user_data');
      final codes = prefs.getStringList('vendedor_codes');

      if (token != null && userDataStr != null) {
        ApiClient.setAuthToken(token);
        _currentUser =
            UserModel.fromJson(jsonDecode(userDataStr) as Map<String, dynamic>);
        if (codes != null) _vendedorCodes = codes;

        notifyListeners();

        // OPTIMIZATION: Pre-warm cache on auto-login too
        CachePreWarmer.preWarmCache(this);

        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /// Logout — clears auth data AND all cached data (defense-in-depth)
  /// Ensures no data from a previous user leaks to the next user on shared devices
  Future<void> logout() async {
    _currentUser = null;
    _vendedorCodes = [];
    ApiClient.clearAuthToken();

    // Clear sensitive data from secure storage
    await SecureStorage.deleteSecureData('user_token');
    await SecureStorage.deleteSecureData('user_data');

    // Clear non-sensitive data from SharedPreferences
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('vendedor_codes');

    // CRITICAL: Clear ALL cached API data (Hive + memory)
    // This prevents data from leaking between users on shared tablets
    try {
      await CacheService.clearAll();
      CacheService.clearMemoryCache();
      CachePreWarmer.reset();
      debugPrint('[AuthProvider] All caches cleared on logout');
    } catch (e) {
      debugPrint('[AuthProvider] Cache clear error: $e');
    }

    notifyListeners();
  }

  /// Switch user role (Jefe / Repartidor)
  Future<bool> switchRole(String newRole, {String? viewAs}) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await ApiClient.post(
        '/auth/switch-role',
        {'userId': _currentUser?.code, 'newRole': newRole, 'viewAs': viewAs},
      );

      if (response != null && response['success'] == true) {
        // Update token
        if (response['token'] != null) {
          ApiClient.setAuthToken(response['token'] as String);
          await SecureStorage.writeSecureData(
              'user_token', response['token'] as String);

          // Update local user model with new role
          if (_currentUser != null) {
            _currentUser = _currentUser!.copyWith(role: newRole);
          }
        }

        _isLoading = false;
        notifyListeners();
        return true;
      }

      throw Exception('Failed to switch role');
    } catch (e) {
      _error = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }
}
