import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/environment/environment_profile.dart';

/// Fetches the public, non-cached runtime profile from the active API server.
class EnvironmentProfileService {
  EnvironmentProfileService._();

  /// Loads and validates the server profile without accepting stale cache.
  static Future<EnvironmentProfile> load() async {
    final response = await ApiClient.get(
      '/runtime-profile',
      cacheResponse: false,
      forceRefresh: true,
      allowStale: false,
      receiveTimeout: const Duration(seconds: 5),
      skipRetry: true,
    );
    return EnvironmentProfile.fromResponse(response);
  }
}
