import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/bolsa/providers/bolsa_provider.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_notifier.dart';

void main() {
  tearDown(ApiClient.resetForTesting);

  test(
      'orders stats products and bolsa discard in-flight responses after epoch rotation',
      () async {
    ApiClient.resetForTesting();
    ApiClient.setAuthToken('token-a');
    final expectedEpoch = ApiClient.authMutationEpoch;
    final responseGate = Completer<void>();
    final adapter = _PostSyncAdapter(responseGate);
    ApiClient.dio.httpClientAdapter = adapter;

    final container = ProviderContainer();
    addTearDown(container.dispose);
    final pedidos = container.read(pedidosNotifierProvider.notifier)
      ..setClient('4300040687', 'Cliente epoch');
    final bolsa = container.read(bolsaProvider.notifier);

    final operations = <Future<void>>[
      pedidos.loadProducts(
        vendedorCodes: '35',
        reset: true,
        forceRefresh: true,
        expectedAuthEpoch: expectedEpoch,
      ),
      pedidos.loadOrders(
        vendedorCodes: '35',
        forceRefresh: true,
        expectedAuthEpoch: expectedEpoch,
      ),
      pedidos.loadOrderStats(
        vendedorCodes: '35',
        forceRefresh: true,
        expectedAuthEpoch: expectedEpoch,
      ),
      bolsa.load(
        '35',
        force: true,
        expectedAuthEpoch: expectedEpoch,
      ),
    ];
    await adapter.waitForRequests(6);

    ApiClient.setAuthToken('token-b');
    responseGate.complete();
    await Future.wait(operations);

    final pedidosState = container.read(pedidosNotifierProvider);
    expect(pedidosState.products, isEmpty);
    expect(pedidosState.orders, isEmpty);
    expect(pedidosState.orderStats?.totalOrders ?? 0, 0);
    expect(pedidosState.isLoadingProducts, isFalse);
    expect(pedidosState.isLoadingOrders, isFalse);
    expect(pedidosState.isLoadingStats, isFalse);

    final bolsaState = container.read(bolsaProvider);
    expect(bolsaState.status, isNull);
    expect(bolsaState.movements, isEmpty);
    expect(bolsaState.history, isEmpty);
    expect(bolsaState.isLoading, isFalse);
  });
}

class _PostSyncAdapter implements HttpClientAdapter {
  _PostSyncAdapter(this.responseGate);

  final Completer<void> responseGate;
  final List<RequestOptions> requests = [];

  Future<void> waitForRequests(int count) async {
    final deadline = DateTime.now().add(const Duration(seconds: 5));
    while (requests.length < count && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    expect(requests, hasLength(count));
  }

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    await responseGate.future;
    return ResponseBody.fromString(
      jsonEncode(_bodyFor(options.path)),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  Map<String, dynamic> _bodyFor(String path) {
    if (path.endsWith('/pedidos/products')) {
      return {
        'products': [
          {'code': 'STALE-PRODUCT', 'name': 'No publicar'},
        ],
      };
    }
    if (path.endsWith('/pedidos/orders/stats')) {
      return {
        'stats': {'totalOrders': 999, 'totalAmount': 999},
      };
    }
    if (path.endsWith('/pedidos')) {
      return {
        'orders': [
          {'id': 999, 'estado': 'CONFIRMADO'},
        ],
      };
    }
    if (path.endsWith('/bolsa/35/status')) {
      return {
        'bolsa': {
          'vendedor': '35',
          'ejercicio': 2026,
          'mes': 11,
          'saldoDisponible': 999,
        },
      };
    }
    if (path.endsWith('/bolsa/35/movements')) {
      return {
        'movements': [
          {'id': 999, 'tipo': 'CONSUMO', 'importe': 999},
        ],
      };
    }
    if (path.endsWith('/bolsa/35/history')) {
      return {'points': const []};
    }
    throw StateError('Unexpected request path: $path');
  }

  @override
  void close({bool force = false}) {}
}
