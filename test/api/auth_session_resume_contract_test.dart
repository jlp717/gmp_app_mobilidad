import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/providers/auth_notifier.dart';

void main() {
  group('Local authentication session contract', () {
    test('keeps the same 24-hour local deadline for every supported role', () {
      const roles = <String>[
        'ADMIN',
        'DIRECTOR',
        'JEFE_VENTAS',
        'COMERCIAL',
        'REPARTIDOR',
      ];
      final issuedAt = DateTime(2026, 8, 20, 8, 6);

      for (final role in roles) {
        expect(
          AuthNotifier.localSessionDeadline(issuedAt),
          issuedAt.add(const Duration(hours: 24)),
          reason: 'The $role session must not receive a shorter local TTL.',
        );
      }
    });
  });

  group('Resume refresh contract', () {
    tearDown(ApiClient.resetForTesting);

    test('coalesces simultaneous resume refreshes into one canonical commit',
        () async {
      ApiClient.resetForTesting();
      ApiClient.authSessionExpiresAt =
          DateTime.now().add(const Duration(hours: 1));
      ApiClient.refreshTokenReaderOverride = () async => 'refresh-token';
      final adapter = _RefreshAdapter();
      ApiClient.dio.httpClientAdapter = adapter;

      var committedToken = '';
      ApiClient.onTokenRefreshed = (response) async {
        committedToken = response['token'] as String;
        return true;
      };

      final results = await Future.wait([
        ApiClient.refreshAccessToken(),
        ApiClient.refreshAccessToken(),
      ]);

      expect(results, equals(const [true, true]));
      expect(adapter.requests, 1);
      expect(committedToken, 'fresh-access-token');
    });

    test('keeps the local session available when resume refresh is offline',
        () async {
      ApiClient.resetForTesting();
      ApiClient.authSessionExpiresAt =
          DateTime.now().add(const Duration(hours: 1));
      ApiClient.refreshTokenReaderOverride = () async => 'refresh-token';
      ApiClient.dio.httpClientAdapter = _OfflineRefreshAdapter();

      var diverged = false;
      ApiClient.onAuthSessionDiverged = () => diverged = true;

      expect(await ApiClient.refreshAccessToken(), isFalse);
      expect(ApiClient.lastTokenRefreshFailedDueToConnectivity, isTrue);
      expect(diverged, isFalse);
    });

    test('does not wipe a switch-role session when a concurrent refresh 401s',
        () async {
      ApiClient.resetForTesting();
      ApiClient.authSessionExpiresAt =
          DateTime.now().add(const Duration(hours: 1));
      ApiClient.setAuthToken('switching-token');
      ApiClient.refreshTokenReaderOverride = () async => 'stale-refresh';

      var diverged = false;
      var unauthorized = false;
      ApiClient.onAuthSessionDiverged = () => diverged = true;
      ApiClient.onUnauthorized = () => unauthorized = true;
      ApiClient.dio.httpClientAdapter = _UnauthorizedRefreshAdapter();

      ApiClient.startLogin();
      expect(await ApiClient.refreshAccessToken(), isFalse);
      ApiClient.endLogin();

      expect(diverged, isFalse);
      expect(unauthorized, isFalse);
      expect(ApiClient.authToken, 'switching-token');
    });

    test('does not retry commercial evolution with a delivery JWT after switch',
        () async {
      ApiClient.resetForTesting();
      ApiClient.authSessionExpiresAt =
          DateTime.now().add(const Duration(hours: 1));
      ApiClient.setAuthToken('commercial-token');
      ApiClient.setAuthMode('COMERCIAL');

      var unauthorized = false;
      ApiClient.onUnauthorized = () => unauthorized = true;
      final adapter = _SwitchRoleEvolutionAdapter();
      ApiClient.dio.httpClientAdapter = adapter;

      ApiException? caught;
      try {
        await ApiClient.get('/objectives/evolution');
        fail('Expected ApiException');
      } on ApiException catch (error) {
        caught = error;
      }

      expect(caught, isNotNull);
      expect(caught!.statusCode, 401);
      expect(caught.code, 'SESSION_REVOKED');
      expect(adapter.authorizationHeaders, equals(['Bearer commercial-token']));
      expect(unauthorized, isFalse);
      expect(ApiClient.authToken, 'delivery-token');
    });

    test('does not logout on leftover commercial 401 in delivery mode',
        () async {
      ApiClient.resetForTesting();
      ApiClient.authSessionExpiresAt =
          DateTime.now().add(const Duration(hours: 1));
      ApiClient.setAuthToken('delivery-token');
      ApiClient.setAuthMode('REPARTIDOR');

      var unauthorized = false;
      ApiClient.onUnauthorized = () => unauthorized = true;
      ApiClient.dio.httpClientAdapter = _UnauthorizedRefreshAdapter();

      ApiException? caught;
      try {
        await ApiClient.get('/objectives/evolution');
        fail('Expected ApiException');
      } on ApiException catch (error) {
        caught = error;
      }

      expect(caught, isNotNull);
      expect(caught!.statusCode, 401);
      expect(unauthorized, isFalse);
    });
  });

  group('Access token TTL contract', () {
    test('server default TTL mirrors the backend 15-minute default', () {
      expect(
        AuthNotifier.serverDefaultAccessTokenTtl,
        const Duration(minutes: 15),
        reason: 'Fallback must mirror the ACCESS_TTL_MS default of the '
            'backend auth middleware, never an optimistic 1-hour guess.',
      );
    });

    test('reads the real TTL seconds reported by auth responses', () {
      expect(
        AuthNotifier.accessTokenTtlMsFromResponse({'tokenExpiresIn': 900}),
        900000,
      );
      expect(
        AuthNotifier.accessTokenTtlMsFromResponse({'expiresIn': '1800'}),
        1800000,
      );
    });

    test('tokenExpiresIn wins over expiresIn', () {
      expect(
        AuthNotifier.accessTokenTtlMsFromResponse({
          'tokenExpiresIn': 600,
          'expiresIn': 1200,
        }),
        600000,
      );
    });

    test('ignores absent, invalid or implausible TTL values', () {
      expect(AuthNotifier.accessTokenTtlMsFromResponse({}), isNull);
      expect(
        AuthNotifier.accessTokenTtlMsFromResponse({'tokenExpiresIn': 0}),
        isNull,
      );
      expect(
        AuthNotifier.accessTokenTtlMsFromResponse({'tokenExpiresIn': -5}),
        isNull,
      );
      expect(
        AuthNotifier.accessTokenTtlMsFromResponse({'expiresIn': 'abc'}),
        isNull,
      );
      expect(
        AuthNotifier.accessTokenTtlMsFromResponse({
          'tokenExpiresIn': const Duration(days: 31).inSeconds,
        }),
        isNull,
      );
    });
  });
}

class _RefreshAdapter implements HttpClientAdapter {
  int requests = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests++;
    await Future<void>.delayed(const Duration(milliseconds: 5));
    return ResponseBody.fromString(
      jsonEncode({
        'token': 'fresh-access-token',
        'refreshToken': 'fresh-refresh-token',
      }),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _OfflineRefreshAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    throw DioException.connectionError(
      requestOptions: options,
      reason: 'offline',
    );
  }

  @override
  void close({bool force = false}) {}
}

class _UnauthorizedRefreshAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode({'error': 'expired'}),
      401,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _SwitchRoleEvolutionAdapter implements HttpClientAdapter {
  final authorizationHeaders = <String?>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    authorizationHeaders.add(options.headers['Authorization']?.toString());
    ApiClient.startLogin();
    ApiClient.setAuthToken('delivery-token');
    ApiClient.setAuthMode('REPARTIDOR');
    ApiClient.endLogin();
    return ResponseBody.fromString(
      jsonEncode({
        'error': 'Sesión revocada.',
        'code': 'SESSION_REVOKED',
      }),
      401,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
