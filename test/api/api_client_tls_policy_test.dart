import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

void main() {
  group('ApiClient TLS policy', () {
    test('rejects invalid non-dev certificates even when pinning is empty', () {
      expect(
        ApiClient.shouldBypassInvalidCertificateForHost(
          'api.granjamaripepa.com',
          debugMode: true,
        ),
        isFalse,
      );
      expect(
        ApiClient.shouldBypassInvalidCertificateForHost(
          'api.granjamaripepa.com',
          debugMode: false,
        ),
        isFalse,
      );
    });

    test('allows invalid certificates only for local debug hosts', () {
      expect(
        ApiClient.shouldBypassInvalidCertificateForHost(
          'localhost',
          debugMode: true,
        ),
        isTrue,
      );
      expect(
        ApiClient.shouldBypassInvalidCertificateForHost(
          'localhost',
          debugMode: false,
        ),
        isFalse,
      );
    });
  });

  group('ApiClient auth session deadline', () {
    tearDown(() {
      ApiClient.authSessionExpiresAt = null;
    });

    test('treats a missing local deadline as not expired', () {
      ApiClient.authSessionExpiresAt = null;

      expect(ApiClient.isAuthSessionExpired, isFalse);
    });

    test('expires the local auth session when the deadline has passed', () {
      ApiClient.authSessionExpiresAt =
          DateTime.now().subtract(const Duration(milliseconds: 1));

      expect(ApiClient.isAuthSessionExpired, isTrue);
    });

    test('keeps the local auth session active before the deadline', () {
      ApiClient.authSessionExpiresAt =
          DateTime.now().add(const Duration(days: 1));

      expect(ApiClient.isAuthSessionExpired, isFalse);
    });
  });

  group('ApiClient stale auth requests', () {
    tearDown(ApiClient.resetForTesting);

    test('retries a stale 401 once with the current token', () async {
      ApiClient.resetForTesting();
      ApiClient.setAuthToken('old-token');

      var unauthorizedCalled = false;
      ApiClient.onUnauthorized = () => unauthorizedCalled = true;

      final adapter = _StaleTokenAdapter();
      ApiClient.dio.httpClientAdapter = adapter;

      final response = await ApiClient.get('/protected');

      expect(response['ok'], isTrue);
      expect(
        adapter.authorizationHeaders,
        equals(['Bearer old-token', 'Bearer new-token']),
      );
      expect(unauthorizedCalled, isFalse);
    });

    test('does not logout when a pre-login request returns 401 after login',
        () async {
      ApiClient.resetForTesting();

      var unauthorizedCalled = false;
      ApiClient.onUnauthorized = () => unauthorizedCalled = true;

      final adapter = _NoTokenThenLoginAdapter();
      ApiClient.dio.httpClientAdapter = adapter;

      final response = await ApiClient.get('/protected/no-token-first');

      expect(response['ok'], isTrue);
      expect(
        adapter.authorizationHeaders,
        equals([null, 'Bearer fresh-token']),
      );
      expect(unauthorizedCalled, isFalse);
    });
  });
}

class _StaleTokenAdapter implements HttpClientAdapter {
  final authorizationHeaders = <String?>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final authorization = options.headers['Authorization']?.toString();
    authorizationHeaders.add(authorization);

    if (authorization == 'Bearer old-token') {
      ApiClient.setAuthToken('new-token');
      return ResponseBody.fromString(
        jsonEncode({'error': 'expired'}),
        401,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    }

    return ResponseBody.fromString(
      jsonEncode({'ok': true}),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _NoTokenThenLoginAdapter implements HttpClientAdapter {
  final authorizationHeaders = <String?>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final authorization = options.headers['Authorization']?.toString();
    authorizationHeaders.add(authorization);

    if (authorization == null) {
      ApiClient.setAuthToken('fresh-token');
      return ResponseBody.fromString(
        jsonEncode({'error': 'missing token'}),
        401,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );
    }

    return ResponseBody.fromString(
      jsonEncode({'ok': true}),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
