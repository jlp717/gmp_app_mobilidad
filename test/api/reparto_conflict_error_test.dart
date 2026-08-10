import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

void main() {
  setUp(() {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('test-bearer');
    ApiClient.dio.options.baseUrl = 'https://receipt.invalid/api';
  });

  tearDown(ApiClient.resetForTesting);

  test('typed 409 retains its server confirmation ID for reconciliation',
      () async {
    ApiClient.dio.httpClientAdapter = _ConflictAdapter();

    await expectLater(
      ApiClient.get(
        '/repartidor-finanzas/rutero/confirmations/delivery-1',
        forceRefresh: true,
        allowStale: false,
      ),
      throwsA(
        isA<ApiException>()
            .having((error) => error.statusCode, 'statusCode', 409)
            .having(
              (error) => error.code,
              'code',
              'DELIVERY_ALREADY_CONFIRMED',
            )
            .having((error) => error.confirmationId, 'confirmationId', '81'),
      ),
    );
  });
}

class _ConflictAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'error': 'already confirmed',
        'code': 'DELIVERY_ALREADY_CONFIRMED',
        'confirmationId': '81',
      }),
      409,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
