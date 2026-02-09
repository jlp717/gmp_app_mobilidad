import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/api_client.dart';
import '../api/api_config.dart';
import '../models/user_model.dart';
import 'dart:convert';
import 'package:package_info_plus/package_info_plus.dart';
import '../services/cache_prewarmer.dart';

/// Authentication provider with role detection
class AuthProvider with ChangeNotifier {
  UserModel? _currentUser;
  bool _isLoading = false;
  String? _error;
  bool _initialized = false;
  bool _isMandatoryUpdate = false;
  String _playStoreUrl = 'https://play.google.com/store/apps/details?id=com.jlp.gmp_mobilidad';
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
        final minRequiredVersion = int.tryParse(response['minVersion']?.toString() ?? '0') ?? 0;
        final latestVersion = int.tryParse(response['latestVersion']?.toString() ?? '0') ?? 0;
        
        if (currentVersion < minRequiredVersion) {
          _updateAvailable = true;
          _isMandatoryUpdate = true;
          _updateMessage = response['message'] ?? 'Es necesaria una nueva versión para continuar.';
          notifyListeners();
        } else if (currentVersion < latestVersion) {
          _updateAvailable = true;
          _isMandatoryUpdate = false;
          _updateMessage = response['message'] ?? 'Hay una nueva versión disponible.';
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
    debugPrint('[AuthProvider] login() called with user: $username');
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      debugPrint('[AuthProvider] Calling ApiClient.post...');
      debugPrint('[AuthProvider] Endpoint: ${ApiConfig.login}');
      debugPrint('[AuthProvider] BaseUrl: ${ApiConfig.baseUrl}');
      
      final response = await ApiClient.post(
        ApiConfig.login,
        {'username': username, 'password': password},
      );

      debugPrint('[AuthProvider] Response received: ${response.keys}');

      if (response != null && response['user'] != null) {
        _currentUser = UserModel.fromJson(response['user'] as Map<String, dynamic>);
        
        // Handle vendedor codes
        if (response['vendedorCodes'] != null) {
          _vendedorCodes = List<String>.from(response['vendedorCodes']);
        }
        
        ApiClient.setAuthToken(response['token']);

        // Save to persistent storage
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('user_token', response['token']);
        await prefs.setString('user_data', jsonEncode(response['user']));
        await prefs.setStringList('vendedor_codes', _vendedorCodes);

        _isLoading = false;
        notifyListeners();
        debugPrint('[AuthProvider] Login SUCCESS');
        
        // OPTIMIZATION: Pre-warm cache for instant data access
        // Run in background without awaiting to not block UI
        CachePreWarmer.preWarmCache(this);
        
        return true;
      } else {
        throw Exception('Respuesta inválida del servidor');
      }
    } catch (e) {
      debugPrint('[AuthProvider] Login ERROR: $e');
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
      final token = prefs.getString('user_token');
      final userDataStr = prefs.getString('user_data');
      final codes = prefs.getStringList('vendedor_codes');

      if (token != null && userDataStr != null) {
        ApiClient.setAuthToken(token);
        _currentUser = UserModel.fromJson(jsonDecode(userDataStr));
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

  /// Logout
  Future<void> logout() async {
    _currentUser = null;
    _vendedorCodes = [];
    ApiClient.clearAuthToken();
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
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
        {
          'userId': _currentUser?.code,
          'newRole': newRole,
          'viewAs': viewAs
        },
      );

      if (response != null && response['success'] == true) {
        // Update token
        if (response['token'] != null) {
          ApiClient.setAuthToken(response['token']);
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('user_token', response['token']);
          
          // Update local user model with new role
          if (_currentUser != null) {
             _currentUser = _currentUser!.copyWith(role: newRole);
             
             // If debugging, print to verify
             debugPrint('[AuthProvider] Local user role updated to: ${_currentUser!.userRole}');
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
