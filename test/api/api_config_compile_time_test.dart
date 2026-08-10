import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';

const _compiledBaseUrl = String.fromEnvironment('API_BASE_URL');
const _hasCompiledBaseUrl = bool.hasEnvironment('API_BASE_URL');

void main() {
  test('uses a safe compile-time API base URL without network access', () {
    if (!_hasCompiledBaseUrl) {
      expect(ApiConfig.baseUrl, 'https://api.mari-pepa.com/api');
      return;
    }

    final configured = _compiledBaseUrl.trim();
    final uri = Uri.tryParse(configured);
    final isSafe = uri != null &&
        uri.scheme == 'https' &&
        uri.host.isNotEmpty &&
        uri.userInfo.isEmpty &&
        !uri.hasQuery &&
        !uri.hasFragment;
    if (!isSafe) {
      expect(() => ApiConfig.baseUrl, throwsStateError);
      return;
    }

    final expectedPath =
        uri.path == '/' ? '' : uri.path.replaceFirst(RegExp(r'/+$'), '');
    expect(ApiConfig.baseUrl, uri.replace(path: expectedPath).toString());
  });

  test('rejects unsafe runtime production URLs without changing the active URL',
      () {
    final configured = _compiledBaseUrl.trim();
    if (_hasCompiledBaseUrl) {
      final uri = Uri.tryParse(configured);
      final isSafe = uri != null &&
          uri.scheme == 'https' &&
          uri.host.isNotEmpty &&
          uri.userInfo.isEmpty &&
          !uri.hasQuery &&
          !uri.hasFragment;
      if (!isSafe) return;
    }

    final original = ApiConfig.baseUrl;

    expect(
      () => ApiConfig.setProductionUrl('http://invalid.invalid'),
      throwsStateError,
    );
    expect(
      () => ApiConfig.setProductionUrl('https://user@invalid.invalid'),
      throwsStateError,
    );
    expect(
      () => ApiConfig.setProductionUrl('https:///api'),
      throwsStateError,
    );
    expect(ApiConfig.baseUrl, original);
  });
}
