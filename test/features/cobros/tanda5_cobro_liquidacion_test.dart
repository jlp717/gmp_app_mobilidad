/// Tanda 5 — REQ-30 flutter: tras registrarCobro (total y parcial) el provider
/// notifica al instante (la liquidación sube sin esperar recarga).
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';
import 'package:gmp_app_mobilidad/features/cobros/providers/cobros_provider.dart';

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

void main() {
  final previousAdapter = ApiClient.dio.httpClientAdapter;

  setUp(() {
    ApiClient.dio.httpClientAdapter = _FakeAdapter((options) {
      final path = options.path;
      if (options.method == 'POST' && path.contains('/cobros/')) {
        return _json({'success': true, 'mensaje': 'Cobro registrado'});
      }
      if (path.contains('/pendientes')) {
        return _json({
          'success': true,
          'pendientes': {
            'cobros': [],
            'resumen': null,
          },
        });
      }
      return _json({'success': true});
    });
  });

  tearDown(() {
    ApiClient.dio.httpClientAdapter = previousAdapter;
  });

  Future<bool> pay(CobrosNotifier notifier, double importe) {
    return notifier.registrarCobro(
      codigoCliente: 'C30',
      referencia: 'P-15-2296',
      importe: importe,
      formaPago: 'EFECTIVO',
      tipoVenta: TipoVenta.contado,
      tipoModo: TipoModoCobro.normal,
      observaciones: 'REQ-30 tanda5',
    );
  }

  test('cobro total notifica al instante sin depender de la recarga', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    const params = CobrosParams(employeeCode: '07', isRepartidor: true);
    final notifier = container.read(cobrosProvider(params).notifier);
    var notifications = 0;
    container.listen<CobrosState>(
      cobrosProvider(params),
      (_, _) => notifications++,
    );

    final ok = await notifier.registrarCobro(
      codigoCliente: 'C30',
      referencia: 'P-15-2296',
      importe: 100,
      formaPago: 'EFECTIVO',
      tipoVenta: TipoVenta.contado,
      tipoModo: TipoModoCobro.normal,
      observaciones: 'REQ-30 tanda5',
      reloadAfter: false,
    );

    expect(ok, isTrue);
    // state.copyWith() corre justo tras invalidar repartidor:liquidacion,
    // antes de cualquier recarga: la UI sube al instante.
    expect(notifications, greaterThanOrEqualTo(1));
  });

  test('cobro parcial tambien resuelve e invalida (notify)', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    const params = CobrosParams(employeeCode: '07', isRepartidor: true);
    final notifier = container.read(cobrosProvider(params).notifier);
    var notifications = 0;
    container.listen<CobrosState>(
      cobrosProvider(params),
      (_, _) => notifications++,
    );

    expect(await pay(notifier, 100), isTrue);
    expect(await pay(notifier, 40), isTrue);
    expect(notifications, greaterThanOrEqualTo(2));
  });
}
