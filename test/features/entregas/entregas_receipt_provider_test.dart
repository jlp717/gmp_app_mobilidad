import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

void main() {
  late ProviderContainer container;

  setUp(() {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('test-bearer');
    ApiClient.dio.options.baseUrl = 'https://receipt.invalid/api';
    container = ProviderContainer();
  });

  tearDown(() {
    container.dispose();
    ApiClient.resetForTesting();
  });

  test('canonical receipt is GET-only, authenticated and body-free', () async {
    final pdfBase64 = base64Encode(
      utf8.encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n'),
    );
    final adapter = _RecordingAdapter(<String, dynamic>{
      'success': true,
      'pdfBase64': pdfBase64,
    });
    ApiClient.dio.httpClientAdapter = adapter;

    final result = await container
        .read(entregasProvider.notifier)
        .generateReceipt(confirmationId: '81');

    expect(result, <String, dynamic>{
      'success': true,
      'pdfBase64': pdfBase64,
      'confirmationId': '81',
    });
    expect(adapter.requests, hasLength(1));
    final request = adapter.requests.single;
    expect(request.method, 'GET');
    expect(
      request.path,
      '/repartidor-finanzas/rutero/confirmations/81/receipt',
    );
    expect(request.headers['Authorization'], 'Bearer test-bearer');
    expect(request.data, isNull);
    expect(request.hadRequestStream, isFalse);
    expect(Uri.parse(request.path).queryParameters, isEmpty);
    expect(request.path, isNot(contains('dni')));
    expect(request.path, isNot(contains('cantidad')));
    expect(request.path, isNot(contains('total')));
  });

  test('malformed receipt response is rejected by the shared PDF parser',
      () async {
    final adapter = _RecordingAdapter(<String, dynamic>{
      'success': true,
      'pdfBase64': base64Encode(utf8.encode('not a PDF')),
    });
    ApiClient.dio.httpClientAdapter = adapter;

    final result = await container
        .read(entregasProvider.notifier)
        .generateReceipt(confirmationId: '81');

    expect(result, isNull);
    expect(container.read(entregasProvider).error, contains('PDF valido'));
    expect(adapter.requests, hasLength(1));
  });

  test('legacy albaran calls fail closed without any network write', () async {
    final adapter = _RecordingAdapter(<String, dynamic>{'success': true});
    ApiClient.dio.httpClientAdapter = adapter;
    final notifier = container.read(entregasProvider.notifier);
    final albaran = _legacyAlbaran();

    expect(await notifier.generateReceipt(albaran: albaran), isNull);
    expect(
      await notifier.sendReceiptByEmail(
        albaran: albaran,
        email: 'destino@example.invalid',
      ),
      isFalse,
    );
    expect(adapter.requests, isEmpty);
  });
}

AlbaranEntrega _legacyAlbaran() => AlbaranEntrega(
      id: 'delivery-legacy',
      numeroAlbaran: 1,
      ejercicio: 2026,
      codigoCliente: 'client-1',
      nombreCliente: 'Cliente',
      fecha: '2026-08-09',
      importeTotal: 10,
      firma: 'local-signature-that-must-never-be-sent',
    );

class _RecordedRequest {
  const _RecordedRequest({
    required this.method,
    required this.path,
    required this.headers,
    required this.data,
    required this.hadRequestStream,
  });

  final String method;
  final String path;
  final Map<String, dynamic> headers;
  final Object? data;
  final bool hadRequestStream;
}

class _RecordingAdapter implements HttpClientAdapter {
  _RecordingAdapter(this.response);

  final Map<String, dynamic> response;
  final List<_RecordedRequest> requests = <_RecordedRequest>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(
      _RecordedRequest(
        method: options.method,
        path: options.path,
        headers: Map<String, dynamic>.from(options.headers),
        data: options.data,
        hadRequestStream: requestStream != null,
      ),
    );
    return ResponseBody.fromString(
      jsonEncode(response),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
