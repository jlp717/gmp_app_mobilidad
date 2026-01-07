import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/api_client.dart';
import '../api/api_config.dart';
import '../models/user_model.dart';
import 'dart:convert';

/// Authentication provider with role detection
class AuthProvider with ChangeNotifier {
  UserModel? _currentUser;
  bool _isLoading = false;
  String? _error;
  List<String> _vendedorCodes = [];

  UserModel? get currentUser => _currentUser;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isAuthenticated => _currentUser != null;
  bool get isDirector => _currentUser?.isDirector ?? false;
  List<String> get vendedorCodes => _vendedorCodes;

  AuthProvider() {
    // Bind global 401 unauthorized event to logout
    ApiClient.onUnauthorized = () {
      debugPrint('[AuthProvider] 401 Detected - Logging out...');
      logout();
    };
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
}
