import 'dart:convert';
import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

void main() {
  group('EntregaItem confirmation semantics', () {
    test(
        'keeps unavailable quantity null instead of fabricating confirmed zero',
        () {
      final item = EntregaItem.fromJson({
        'itemId': '1',
        'codigoArticulo': 'A',
        'cantidadPedida': 3,
        'confirmationState': 'UNAVAILABLE',
      });

      expect(item.cantidadEntregada, isNull);
      expect(item.confirmationState, 'UNAVAILABLE');
      expect(item.entregadoCompleto, isFalse);
    });

    test('preserves an authoritative confirmed zero', () {
      final item = EntregaItem.fromJson({
        'itemId': '1',
        'codigoArticulo': 'A',
        'cantidadPedida': 3,
        'cantidadEntregada': 0,
        'confirmationState': 'CONFIRMED',
      });

      expect(item.cantidadEntregada, 0);
      expect(item.confirmationState, 'CONFIRMED');
    });
  });

  group('strict delivery payload contract', () {
    test('accepts DB2 numeric strings without fabricating critical values', () {
      final albaran = AlbaranEntrega.fromJson(<String, dynamic>{
        'id': '2026-P-93-69',
        'numero': '69',
        'ejercicio': '2026',
        'codigoCliente': '4300039982',
        'nombreCliente': 'Cliente real',
        'fecha': '2026-08-10',
        'importe': '570.39',
        'items': <Map<String, dynamic>>[
          <String, dynamic>{
            'itemId': '1',
            'codigoArticulo': 'ART-1',
            'cantidadPedida': '3.5',
          },
        ],
      });

      expect(albaran.numeroAlbaran, 69);
      expect(albaran.importeTotal, 570.39);
      expect(albaran.items.single.cantidadPedida, 3.5);
      expect(albaran.items.single.cantidadEntregada, isNull);
    });

    test('rejects missing or invalid critical delivery fields fail-closed', () {
      final valid = <String, dynamic>{
        'id': 'delivery-1',
        'numero': 1,
        'ejercicio': 2026,
        'codigoCliente': 'C1',
        'nombreCliente': 'Cliente',
        'fecha': '2026-08-10',
        'importe': 10,
      };
      for (final invalid in <Map<String, dynamic>>[
        <String, dynamic>{...valid}..remove('id'),
        <String, dynamic>{...valid, 'numero': '1.5'},
        <String, dynamic>{...valid, 'codigoCliente': ''},
        <String, dynamic>{...valid, 'fecha': 'not-a-date'},
        <String, dynamic>{...valid, 'importe': 'not-a-number'},
      ]) {
        expect(
          () => AlbaranEntrega.fromJson(invalid),
          throwsA(isA<EntregasPayloadException>()),
        );
      }
      expect(
        () => EntregaItem.fromJson(<String, dynamic>{
          'itemId': '1',
          'codigoArticulo': 'A',
          'cantidadPedida': 'invalid',
        }),
        throwsA(isA<EntregasPayloadException>()),
      );
    });

    test('accepts real ISO and DD/MM/YYYY dates but rejects impossible dates',
        () {
      final base = <String, dynamic>{
        'id': 'delivery-date',
        'numero': 1,
        'ejercicio': 2026,
        'codigoCliente': 'C1',
        'nombreCliente': 'Cliente',
        'importe': 10,
      };
      expect(
        AlbaranEntrega.fromJson(
          <String, dynamic>{...base, 'fecha': '2026-08-10'},
        ).fecha,
        '2026-08-10',
      );
      expect(
        AlbaranEntrega.fromJson(
          <String, dynamic>{...base, 'fecha': '10/08/2026'},
        ).fecha,
        '10/08/2026',
      );
      expect(
        () => AlbaranEntrega.fromJson(
          <String, dynamic>{...base, 'fecha': '31/02/2026'},
        ),
        throwsA(isA<EntregasPayloadException>()),
      );
      expect(
        () => AlbaranEntrega.fromJson(
          <String, dynamic>{...base, 'fecha': '2026-02-31'},
        ),
        throwsA(isA<EntregasPayloadException>()),
      );
    });
  });

  test('changing driver clears A before a failed B load can surface it',
      () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('test-bearer');
    ApiClient.dio.options.baseUrl = 'https://entregas.invalid/api';
    final adapter = _DriverResponseAdapter();
    ApiClient.dio.httpClientAdapter = adapter;
    final container = ProviderContainer();
    addTearDown(() {
      container.dispose();
      ApiClient.resetForTesting();
    });
    final notifier = container.read(entregasProvider.notifier);

    notifier.setRepartidor('A', autoReload: false);
    await notifier.cargarAlbaranesPendientes(forceRefresh: true);
    expect(container.read(entregasProvider).albaranes.single.id, 'A-1');

    notifier.setRepartidor('B', autoReload: false);
    final afterSwitch = container.read(entregasProvider);
    expect(afterSwitch.albaranes, isEmpty);
    expect(afterSwitch.albaranSeleccionado, isNull);
    expect(afterSwitch.error, isNull);
    expect(afterSwitch.nextOffset, 0);
    expect(afterSwitch.total, isNull);

    await notifier.cargarAlbaranesPendientes(forceRefresh: true);
    final afterFailure = container.read(entregasProvider);
    expect(afterFailure.albaranes, isEmpty);
    expect(afterFailure.error, isNotNull);
  });

  test('a stale response from A cannot overwrite the new empty driver state',
      () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('test-bearer');
    ApiClient.dio.options.baseUrl = 'https://entregas.invalid/api';
    final adapter = _DriverResponseAdapter(delayA: true);
    ApiClient.dio.httpClientAdapter = adapter;
    final container = ProviderContainer();
    addTearDown(() {
      container.dispose();
      ApiClient.resetForTesting();
    });
    final notifier = container.read(entregasProvider.notifier);

    notifier.setRepartidor('A', autoReload: false);
    final loadingA = notifier.cargarAlbaranesPendientes(forceRefresh: true);
    await adapter.aRequestStarted.future;

    notifier.setRepartidor('B', autoReload: false);
    adapter.completeA();
    await loadingA;

    final state = container.read(entregasProvider);
    expect(state.repartidorId, 'B');
    expect(state.albaranes, isEmpty);
    expect(state.error, isNull);
  });

  test('detail parsing errors never expose sensitive payload text', () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('test-bearer');
    ApiClient.dio.options.baseUrl = 'https://entregas.invalid/api';
    ApiClient.dio.httpClientAdapter = _SensitiveDetailAdapter();
    final container = ProviderContainer();
    addTearDown(() {
      container.dispose();
      ApiClient.resetForTesting();
    });

    final detail = await container
        .read(entregasProvider.notifier)
        .obtenerDetalleAlbaran(1, 2026, 'P', 1, 'C1');

    expect(detail, isNull);
    final error = container.read(entregasProvider).error!;
    expect(error, contains('contrato de reparto'));
    expect(error, isNot(contains('db2-secret-token')));
  });

  test('success false never copies backend secrets into UI state', () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('test-bearer');
    ApiClient.dio.options.baseUrl = 'https://entregas.invalid/api';
    ApiClient.dio.httpClientAdapter = _UnsafeFailureAdapter();
    final container = ProviderContainer();
    addTearDown(() {
      container.dispose();
      ApiClient.resetForTesting();
    });
    final notifier = container.read(entregasProvider.notifier);

    notifier.setRepartidor('A', autoReload: false);
    await notifier.cargarAlbaranesPendientes(forceRefresh: true);

    final error = container.read(entregasProvider).error!;
    expect(error, 'No se pudieron cargar las entregas. Intentalo de nuevo.');
    for (final secret in <String>[
      'SQLSTATE',
      r'C:\private\route',
      '12345678Z',
      'bearer-secret-token',
    ]) {
      expect(error, isNot(contains(secret)));
    }
  });

  test('pagination state distinguishes an exact total from an open page', () {
    final openPage = EntregasState().copyWith(
      hasMore: true,
      nextOffset: 100,
      total: null,
    );
    final finalPage =
        openPage.copyWith(hasMore: false, nextOffset: 125, total: 125);

    expect(openPage.hasMore, isTrue);
    expect(openPage.nextOffset, 100);
    expect(openPage.total, isNull);
    expect(finalPage.hasMore, isFalse);
    expect(finalPage.nextOffset, 125);
    expect(finalPage.total, 125);
  });

  test('provider uses canonical read contract and has no retired write path',
      () {
    final source = File(
      'lib/features/entregas/providers/entregas_provider.dart',
    ).readAsStringSync();

    expect(source, contains(r'&limit=100&offset=$pageOffset'));
    expect(source, contains('append ? requestState.nextOffset : 0'));
    expect(source, contains("response['pagination']"));
    expect(source, contains("pagination['hasMore']"));
    expect(source, contains("pagination['nextOffset']"));
    expect(source, contains('Future<void> cargarMasAlbaranes()'));
    expect(source,
        contains(r'&cliente=${Uri.encodeQueryComponent(codigoCliente)}'));
    expect(source, isNot(contains('/entregas/update')));
    expect(source, isNot(contains('/entregas/uploads/signature')));
  });
}

class _DriverResponseAdapter implements HttpClientAdapter {
  _DriverResponseAdapter({this.delayA = false});

  final bool delayA;
  final Completer<void> aRequestStarted = Completer<void>();
  final Completer<ResponseBody> _aResponse = Completer<ResponseBody>();

  void completeA() => _aResponse.complete(_successResponse());

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.path.contains('/B?')) {
      return ResponseBody.fromString(
        jsonEncode(<String, dynamic>{'error': 'unavailable'}),
        503,
        headers: <String, List<String>>{
          Headers.contentTypeHeader: <String>['application/json'],
        },
      );
    }
    if (delayA) {
      aRequestStarted.complete();
      return _aResponse.future;
    }
    return _successResponse();
  }

  ResponseBody _successResponse() {
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'success': true,
        'albaranes': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'A-1',
            'numero': 1,
            'ejercicio': 2026,
            'codigoCliente': 'A',
            'nombreCliente': 'Cliente A',
            'fecha': '2026-08-10',
            'importe': 1,
          },
        ],
        'pagination': <String, dynamic>{
          'hasMore': false,
          'nextOffset': 1,
          'total': 1,
        },
        'resumen': <String, dynamic>{},
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

class _SensitiveDetailAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'success': true,
        'albaran': <String, dynamic>{
          'id': 'detail-1',
          'numero': 1,
          'ejercicio': 2026,
          'codigoCliente': 'C1',
          'nombreCliente': 'Cliente',
          'fecha': '2026-08-10',
          'importe': 'db2-secret-token',
        },
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

class _UnsafeFailureAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'success': false,
        'code': 'SQLSTATE-42704',
        'error': r'SQLSTATE C:\private\route DNI 12345678Z',
        'details': 'Authorization: Bearer bearer-secret-token',
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
