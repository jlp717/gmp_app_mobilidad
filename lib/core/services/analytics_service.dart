import 'dart:io';
import 'package:flutter/foundation.dart';
import '../api/api_client.dart';

/// Analytics service for tracking user actions during closed testing.
/// Sends data to backend server (no Firebase dependency).
class AnalyticsService {
  static final AnalyticsService _instance = AnalyticsService._internal();
  factory AnalyticsService() => _instance;
  AnalyticsService._internal();

  String? _userId;
  String? _userEmail;
  static const String _appVersion = '1.0.0';
  bool _installLogged = false;

  /// Initialize with user info after login
  void setUser({required String userId, required String email}) {
    _userId = userId;
    _userEmail = email;
  }

  /// Clear user info on logout
  void clearUser() {
    _userId = null;
    _userEmail = null;
  }

  /// Log screen view
  Future<void> logScreenView(String screenName) async {
    await _sendAction('screen_view', screenName);
  }

  /// Log user interaction (button tap, form submit, etc.)
  Future<void> logAction(
    String action, {
    String? screen,
    Map<String, dynamic>? metadata,
  }) async {
    await _sendAction(action, screen ?? 'unknown', metadata: metadata);
  }

  /// Log app installation (call once after first successful login)
  Future<void> logInstallIfNeeded() async {
    if (_installLogged) return;
    
    try {
      await ApiClient.instance.post('/logs/app-install', data: {
        'userId': _userId,
        'userEmail': _userEmail,
        'appVersion': _appVersion,
        'deviceModel': _getDeviceModel(),
        'osVersion': Platform.operatingSystemVersion,
      });
      _installLogged = true;
    } catch (e) {
      debugPrint('Analytics install log error: $e');
    }
  }

  Future<void> _sendAction(
    String action,
    String screen, {
    Map<String, dynamic>? metadata,
  }) async {
    if (_userId == null) return; // Not logged in yet
    
    try {
      await ApiClient.instance.post('/logs/user-action', data: {
        'userId': _userId,
        'userEmail': _userEmail,
        'action': action,
        'screen': screen,
        'metadata': metadata ?? {},
        'appVersion': _appVersion,
        'deviceInfo': {
          'platform': Platform.operatingSystem,
          'version': Platform.operatingSystemVersion,
        },
      });
    } catch (e) {
      // Silent fail - don't interrupt user experience
      debugPrint('Analytics error: $e');
    }
  }

  String _getDeviceModel() {
    // Platform.localHostname gives device name on most platforms
    try {
      return Platform.localHostname;
    } catch (e) {
      return 'Unknown Device';
    }
  }
}
