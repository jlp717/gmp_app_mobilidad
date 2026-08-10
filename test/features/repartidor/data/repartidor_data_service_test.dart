import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';

void main() {
  tearDown(ApiClient.resetForTesting);

  test(
    'client documents always sends owner scope and bounded pagination',
    () async {
      final adapter = _DocumentsAdapter();
      ApiClient.dio.httpClientAdapter = adapter;

      final documents = await RepartidorDataService.getClientDocuments(
        clientId: 'C1',
        repartidorId: '05',
        year: 2026,
      );

      expect(documents, hasLength(1));
      expect(adapter.options?.path, '/repartidor/history/documents/C1');
      expect(
        adapter.options?.queryParameters,
        containsPair('repartidorId', '05'),
      );
      expect(adapter.options?.queryParameters, containsPair('limit', '100'));
      expect(adapter.options?.queryParameters, containsPair('offset', '0'));
    },
  );

  test('rejects a missing owner before making a request', () async {
    expect(
      () => RepartidorDataService.getClientDocuments(
        clientId: 'C1',
        repartidorId: '',
      ),
      throwsA(isA<RepartidorDataException>()),
    );
  });

  test('maps API details to a typed redacted exception', () async {
    ApiClient.dio.httpClientAdapter = _FailingAdapter();

    await expectLater(
      RepartidorDataService.getClientDocuments(
        clientId: 'C2',
        repartidorId: '05',
      ),
      throwsA(
        isA<RepartidorDataException>().having(
          (error) => error.message,
          'message',
          'No se pudo cargar el historial de documentos',
        ),
      ),
    );
  });

  test('client pages send trimmed search and explicit pagination', () async {
    final adapter = _ClientsAdapter();
    ApiClient.dio.httpClientAdapter = adapter;

    final page = await RepartidorDataService.getHistoryClients(
      repartidorId: '05',
      search: ' Acme ',
      limit: 25,
      offset: 100,
      forceRefresh: true,
    );

    expect(page.clients, isEmpty);
    expect(page.hasMore, isFalse);
    expect(adapter.options?.path, '/repartidor/history/clients/05');
    expect(adapter.options?.queryParameters, containsPair('search', 'Acme'));
    expect(adapter.options?.queryParameters, containsPair('limit', '25'));
    expect(adapter.options?.queryParameters, containsPair('offset', '100'));
  });

  test('accepts the exact maximum page size of 100', () async {
    final adapter = _ClientsAdapter();
    ApiClient.dio.httpClientAdapter = adapter;

    final page = await RepartidorDataService.getHistoryClients(
      repartidorId: '05',
      limit: 100,
    );

    expect(page.clients, isEmpty);
    expect(
      adapter.options?.queryParameters,
      containsPair('limit', '100'),
    );
  });
  test('email ledger 503 remains typed and is never retried blindly', () async {
    final adapter = _JsonAdapter(
      statusCode: 503,
      body: <String, dynamic>{
        'success': false,
        'code': 'EMAIL_DELIVERY_LEDGER_REQUIRED',
        'error': 'Delivery ledger required',
      },
    );
    ApiClient.dio.httpClientAdapter = adapter;

    await expectLater(
      RepartidorDataService.sendEmail(
        year: 2026,
        serie: 'A',
        number: 1,
        type: 'albaran',
        destinatario: 'test@example.invalid',
        canEmailDocuments: true,
      ),
      throwsA(
        isA<RepartidorDataException>()
            .having((error) => error.statusCode, 'statusCode', 503)
            .having(
              (error) => error.code,
              'code',
              'EMAIL_DELIVERY_LEDGER_REQUIRED',
            )
            .having(
              (error) => error.message.toLowerCase(),
              'message',
              contains('unavailable'),
            ),
      ),
    );
    expect(adapter.calls, 1);
  });

  test('email defaults fail closed and never performs a POST', () async {
    final adapter = _JsonAdapter(
      statusCode: 200,
      body: <String, dynamic>{'success': true},
    );
    ApiClient.dio.httpClientAdapter = adapter;

    await expectLater(
      RepartidorDataService.sendEmail(
        year: 2026,
        serie: 'A',
        number: 1,
        type: 'albaran',
        destinatario: 'test@example.invalid',
      ),
      throwsA(
        isA<RepartidorDataException>()
            .having((error) => error.statusCode, 'statusCode', 503)
            .having(
              (error) => error.code,
              'code',
              'EMAIL_DOCUMENT_CAPABILITY_REQUIRED',
            ),
      ),
    );
    expect(adapter.calls, 0);
  });

  test('local share requires sent false and localShare true', () async {
    ApiClient.dio.httpClientAdapter = _JsonAdapter(
      statusCode: 200,
      body: <String, dynamic>{
        'success': true,
        'sent': false,
        'localShare': true,
      },
    );

    final result = await RepartidorDataService.shareWhatsApp(
      year: 2026,
      serie: 'A',
      number: 1,
      type: 'albaran',
      telefono: '600000000',
    );

    expect(result.localShare, isTrue);
    expect(result.sent, isFalse);
  });

  test('local share rejects a response that claims an external send', () async {
    ApiClient.dio.httpClientAdapter = _JsonAdapter(
      statusCode: 200,
      body: <String, dynamic>{
        'success': true,
        'sent': true,
        'localShare': true,
      },
    );

    await expectLater(
      RepartidorDataService.shareWhatsApp(
        year: 2026,
        serie: 'A',
        number: 1,
        type: 'albaran',
        telefono: '600000000',
      ),
      throwsA(isA<RepartidorDataException>()),
    );
  });

  test('download errors map every supported HTTP state without raw details',
      () {
    final cases = <({int status, String expected})>[
      (status: 401, expected: 'sesión ha caducado'),
      (status: 403, expected: 'No tienes permiso'),
      (status: 404, expected: 'ya no está disponible'),
      (status: 409, expected: 'está cambiando'),
      (status: 503, expected: 'temporalmente'),
    ];

    for (final testCase in cases) {
      final result = RepartidorDataService.mapDocumentDownloadError(
        ApiException(
          'internal host must not leak',
          statusCode: testCase.status,
          code: 'DOCUMENT_DOWNLOAD_ERROR',
        ),
      );
      expect(result.statusCode, testCase.status);
      expect(result.code, 'DOCUMENT_DOWNLOAD_ERROR');
      expect(result.message, contains(testCase.expected));
      expect(result.message, isNot(contains('internal host')));
    }

    final timeout = RepartidorDataService.mapDocumentDownloadError(
      ApiException('El servidor está tardando demasiado.', statusCode: 0),
    );
    expect(timeout.statusCode, 0);
    expect(timeout.message, contains('tiempo de espera'));
  });
}

class _DocumentsAdapter implements HttpClientAdapter {
  RequestOptions? options;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    this.options = options;
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'success': true,
        'documents': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': '2026-A-0-1',
            'type': 'albaran',
            'number': 1,
            'date': '2026-08-03',
            'amount': 25,
            'pending': 0,
            'status': 'delivered',
            'hasSignature': false,
          },
        ],
      }),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _FailingAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'success': false,
        'error': 'SQL30081N internal-db2-host',
      }),
      403,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _JsonAdapter implements HttpClientAdapter {
  _JsonAdapter({required this.statusCode, required this.body});

  final int statusCode;
  final Map<String, dynamic> body;
  int calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _ClientsAdapter implements HttpClientAdapter {
  RequestOptions? options;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    this.options = options;
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'success': true,
        'clients': <Map<String, dynamic>>[],
        'pagination': <String, dynamic>{'hasMore': false},
      }),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
