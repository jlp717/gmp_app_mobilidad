import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

void main() {
  tearDown(ApiClient.resetForTesting);

  test('expected auth epoch rejects before a replacement bearer is attached',
      () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    final epochA = ApiClient.authMutationEpoch;
    final release = Completer<void>();
    final adapter = _CaptureAdapter();
    ApiClient.dio.httpClientAdapter = adapter;

    final request = ApiClient.runForAuthEpoch(epochA, () async {
      await release.future;
      return ApiClient.post('/pedidos/create', const {'clientCode': 'C1'});
    });

    ApiClient.setAuthToken('token-b');
    release.complete();

    await expectLater(
      request,
      throwsA(
        isA<ApiException>()
            .having((error) => error.code, 'code', 'AUTH_CONTEXT_CHANGED'),
      ),
    );
    expect(adapter.fetchCount, 0);
    expect(adapter.authorizationHeaders, isEmpty);
  });

  test('stable expected auth epoch reaches transport with its bearer',
      () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    final adapter = _CaptureAdapter();
    ApiClient.dio.httpClientAdapter = adapter;

    final response = await ApiClient.runForAuthEpoch(
      ApiClient.authMutationEpoch,
      () => ApiClient.post('/pedidos/create', const {'clientCode': 'C1'}),
    );

    expect(response['ok'], isTrue);
    expect(adapter.fetchCount, 1);
    expect(adapter.authorizationHeaders, ['Bearer token-a']);
  });
}

class _CaptureAdapter implements HttpClientAdapter {
  int fetchCount = 0;
  final authorizationHeaders = <String?>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    fetchCount++;
    authorizationHeaders.add(options.headers['Authorization']?.toString());
    return ResponseBody.fromString(
      jsonEncode({'ok': true}),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
