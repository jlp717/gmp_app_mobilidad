/// DEVICE FINGERPRINT SERVICE
/// ==========================
/// Collects device info (model, OS, app version, device ID) ONCE at startup.
/// Used to send X-App-Version, X-Device-Model, X-Device-OS, X-Device-ID
/// headers on every API call for enterprise audit traceability.
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:device_info_plus/device_info_plus.dart';

class DeviceFingerprint {
  static String appVersion = 'unknown';
  static String buildNumber = 'unknown';
  static String deviceModel = 'unknown';
  static String deviceOS = 'unknown';
  static String deviceId = 'unknown';

  /// Full version string: "3.2.4+29"
  static String get fullVersion => '$appVersion+$buildNumber';

  static bool _initialized = false;

  /// Initialize once at app startup. Safe to call multiple times.
  static Future<void> initialize() async {
    if (_initialized) return;
    try {
      // App version
      final packageInfo = await PackageInfo.fromPlatform();
      appVersion = packageInfo.version;
      buildNumber = packageInfo.buildNumber;

      // Device info
      final deviceInfo = DeviceInfoPlugin();
      if (Platform.isAndroid) {
        final android = await deviceInfo.androidInfo;
        deviceModel = '${android.brand} ${android.model}';
        deviceOS = 'Android ${android.version.release}';
        deviceId = android.id; // Unique per build/device
      } else if (Platform.isIOS) {
        final ios = await deviceInfo.iosInfo;
        deviceModel = ios.model;
        deviceOS = '${ios.systemName} ${ios.systemVersion}';
        deviceId = ios.identifierForVendor ?? 'unknown';
      }

      _initialized = true;
      debugPrint('[DeviceFingerprint] ✅ $fullVersion | $deviceModel | $deviceOS | ID:$deviceId');
    } catch (e) {
      debugPrint('[DeviceFingerprint] ⚠️ Error: $e');
      _initialized = true; // Don't retry, use defaults
    }
  }

  /// Headers to attach to every API request
  static Map<String, String> get headers => {
    'User-Agent': 'GMP-App/$fullVersion ($deviceModel; $deviceOS)',
    'X-App-Version': fullVersion,
    'X-Device-Model': deviceModel,
    'X-Device-OS': deviceOS,
    'X-Device-ID': deviceId,
  };
}
