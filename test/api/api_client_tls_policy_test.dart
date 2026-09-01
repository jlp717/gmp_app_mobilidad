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

    test('recycles the transport without losing the canonical bearer', () {
      ApiClient.resetForTesting();
      ApiClient.setAuthToken('resume-token');
      final previousDio = ApiClient.dio;

      ApiClient.reinitialize();

      expect(ApiClient.authToken, 'resume-token');
      expect(ApiClient.dio, isNot(same(previousDio)));
      expect(
        ApiClient.dio.options.headers['Authorization'],
        'Bearer resume-token',
      );
    });

    test('passes bounded retry and timeout options to idempotent posts',
        () async {
      ApiClient.resetForTesting();
      final adapter = _CapturePostOptionsAdapter();
      ApiClient.dio.httpClientAdapter = adapter;

      await ApiClient.post(
        '/confirm',
        const <String, dynamic>{'delivery': 'safe'},
        idempotent: true,
        receiveTimeout: const Duration(seconds: 15),
        maxRetries: 0,
      );

      expect(adapter.receiveTimeout, const Duration(seconds: 15));
      expect(adapter.idempotent, isTrue);
      expect(adapter.maxRetries, 0);
    });

    test('maps list-valued server errors without a type cast failure',
        () async {
      ApiClient.resetForTesting();
      final adapter = _ListValuedErrorAdapter();
      ApiClient.dio.httpClientAdapter = adapter;

      ApiException? caught;
      try {
        await ApiClient.post(
          '/commissions/pay',
          const <String, dynamic>{'amount': 1},
        );
        fail('Expected ApiException');
      } on ApiException catch (error) {
        caught = error;
      }

      expect(caught, isNotNull);
      expect(caught!.statusCode, 400);
      expect(caught.message, contains('Validation failed'));
      expect(caught.message, contains('concept'));
      expect(caught.code, 'VALIDATION_FAILED');
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

class _CapturePostOptionsAdapter implements HttpClientAdapter {
  Duration? receiveTimeout;
  bool? idempotent;
  int? maxRetries;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    receiveTimeout = options.receiveTimeout;
    idempotent = options.extra['idempotent'] as bool?;
    maxRetries = options.extra['maxRetries'] as int?;
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{'ok': true}),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _ListValuedErrorAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'error': 'Validation failed',
        'details': <Object?>[
          <String, String>{
            'field': 'concept',
            'message': 'Expected string, received null',
          },
          <Object?>[
            <String, String>{
              'field': 'adminCode',
              'message': 'Legacy field',
            },
          ],
        ],
        'code': <String>['VALIDATION_FAILED'],
      }),
      400,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
