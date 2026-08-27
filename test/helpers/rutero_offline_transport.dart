import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

/// No sockets: mocked interceptors must answer every request in rutero tests.
class RuteroOfflineTransport implements HttpClientAdapter {
  late final HttpClientAdapter _previousAdapter;
  late final String _previousBaseUrl;

  void install() {
    _previousAdapter = ApiClient.dio.httpClientAdapter;
    _previousBaseUrl = ApiClient.dio.options.baseUrl;
    ApiClient.dio.httpClientAdapter = this;
    ApiClient.dio.options.baseUrl = 'http://127.0.0.1';
  }

  void restore() {
    ApiClient.dio.httpClientAdapter = _previousAdapter;
    ApiClient.dio.options.baseUrl = _previousBaseUrl;
  }

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    throw StateError(
        'Unmocked rutero request: ${options.method} ${options.path}');
  }

  @override
  void close({bool force = false}) {}
}
