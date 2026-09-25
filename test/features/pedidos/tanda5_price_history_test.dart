/// Tanda 5 — REQ-28 widget: la ficha muestra Último + % subida + Competitivo
/// por defecto (sin interacción), con datos del histórico TEST.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/product_detail_sheet.dart';

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.handler);

  final ResponseBody Function(RequestOptions options) handler;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async =>
      handler(options);

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Map<String, dynamic> body) => ResponseBody.fromString(
      jsonEncode(body),
      200,
      headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
    );

// PNG 1x1: Image.network decodifica sin errorBuilder ni carreras de layout.
final Uint8List _kPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
);

class _FakeImageHeaders implements HttpHeaders {
  @override
  ContentType? get contentType => ContentType('image', 'png');

  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {}

  @override
  void add(String name, Object value, {bool preserveHeaderCase = false}) {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeImageResponse implements HttpClientResponse {
  final Stream<List<int>> _stream = Stream<List<int>>.value(_kPng);

  @override
  int get statusCode => HttpStatus.ok;

  @override
  int get contentLength => _kPng.length;

  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  HttpHeaders get headers => _FakeImageHeaders();

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) =>
      _stream.listen(
        onData,
        onError: onError,
        onDone: onDone,
        cancelOnError: cancelOnError,
      );

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeImageRequest implements HttpClientRequest {
  final HttpHeaders _headers = _FakeImageHeaders();

  @override
  HttpHeaders get headers => _headers;

  @override
  Future<HttpClientResponse> close() async => _FakeImageResponse();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeImageClient implements HttpClient {
  @override
  Future<HttpClientRequest> getUrl(Uri url) async => _FakeImageRequest();

  @override
  void close({bool force = false}) {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeImageOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) => _FakeImageClient();
}

void main() {
  final previousAdapter = ApiClient.dio.httpClientAdapter;

  setUp(() {
    HttpOverrides.global = _FakeImageOverrides();
    ApiClient.dio.httpClientAdapter = _FakeAdapter((options) {
      final path = options.path;
      if (path.contains('product-price-history')) {
        return _json({
          'success': true,
          'productCode': 'P28',
          'clientCode': 'C28',
          'ultimoPrecio': 10.5,
          'precioAnterior': 10.0,
          'pctSubida': 5.0,
          'competitivo': 9.5,
        });
      }
      return _json({
        'product': {
          'code': 'P28',
          'name': 'Producto 28',
          'precioTarifa1': 9.5,
          'precioCompetitivo': 9.5,
        },
        'tariffs': [],
        'stockByWarehouse': [],
      });
    });
  });

  tearDown(() {
    HttpOverrides.global = null;
    ApiClient.dio.httpClientAdapter = previousAdapter;
  });

  testWidgets('ficha muestra historico por defecto: Ultimo, subida, Competitivo',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: ProductDetailSheet(
            productCode: 'P28',
            productName: 'Producto 28',
            clientCode: 'C28',
            clientName: 'Cliente 28',
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));

    // Sin tocar nada: la tira del histórico ya está visible (es_ES: 10,50 €).
    expect(find.text('Último'), findsOneWidget);
    expect(find.text('% subida'), findsOneWidget);
    expect(find.text('Competitivo'), findsOneWidget);
    expect(find.textContaining('10,50'), findsWidgets);
    expect(find.textContaining('5.0%'), findsOneWidget);
    expect(find.textContaining('9,50'), findsWidgets);
  });
}
