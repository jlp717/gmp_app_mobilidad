import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

void main() {
  tearDown(ApiClient.resetForTesting);

  test('post preserves Idempotency-Key and Bearer through a safe retry',
      () async {
    ApiClient.setAuthToken('test-bearer');
    ApiClient.dio.options.baseUrl = 'https://receipt.invalid/api';
    final adapter = _RetryingAdapter();
    ApiClient.dio.httpClientAdapter = adapter;

    final response = await ApiClient.post(
      '/repartidor-finanzas/rutero/confirm-delivery-cobro',
      <String, dynamic>{'delivery': <String, dynamic>{}},
      headers: const <String, String>{'Idempotency-Key': 'rep-key-12345678'},
      idempotent: true,
    );

    expect(response['ok'], isTrue);
    expect(adapter.headers, hasLength(2));
    for (final headers in adapter.headers) {
      expect(headers['Idempotency-Key'], 'rep-key-12345678');
      expect(headers['Authorization'], 'Bearer test-bearer');
    }
    expect(
        ApiClient.dio.options.headers.containsKey('Idempotency-Key'), isFalse);
  });
}

class _RetryingAdapter implements HttpClientAdapter {
  final headers = <Map<String, dynamic>>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    headers.add(Map<String, dynamic>.from(options.headers));
    if (headers.length == 1) {
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.connectionError,
      );
    }
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
