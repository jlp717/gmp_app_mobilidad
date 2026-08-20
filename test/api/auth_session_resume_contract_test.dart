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
