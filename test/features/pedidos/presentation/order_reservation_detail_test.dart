import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_detail_sheet.dart';

class _OrderDetailAdapter implements HttpClientAdapter {
  int requestCount = 0;
  bool failSecondRequest = false;
  String initialStatus = 'ACTIVE';
  String? orderState;
  bool useLongLabels = false;

  void reset() => requestCount = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.method != 'GET' || !options.path.endsWith('/pedidos/42')) {
      throw StateError('Unexpected request: ${options.method} ${options.path}');
    }
    requestCount += 1;
    if (failSecondRequest && requestCount == 2) {
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.connectionError,
        message: 'simulated connection failure',
      );
    }
    final status = requestCount == 1 ? initialStatus : 'EXPIRED';
    return ResponseBody.fromString(
      jsonEncode({
        'success': true,
        'order': _orderPayload(
          status,
          orderState: orderState,
          useLongLabels: useLongLabels,
        ),
      }),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

const _longOrderReference = 'M-2026-0000000000000106-REFERENCIA-COMPLETA';
const _longClientName =
    'Cliente de demostración con razón social extraordinariamente larga';
const _longProductName =
    'Producto activo de demostración con descripción completa muy extensa';

Map<String, dynamic> _orderPayload(
  String reservationStatus, {
  String? orderState,
  bool useLongLabels = false,
}) =>
    {
      'header': {
        'id': 42,
        'numeroPedido': 106,
        'numeroPedidoFormatted':
            useLongLabels ? _longOrderReference : 'M-1-106',
        'clienteId': '4300032888',
        'clienteNombre':
            useLongLabels ? _longClientName : 'Cliente de demostración',
        'vendedor': '73',
        'fecha': '03/11/2026',
        'fechaFormatted': '03/11/2026',
        'estado': orderState ??
            (reservationStatus == 'RELEASED' ? 'CANCELADO' : 'BORRADOR'),
        'tipoventa': 'CC',
        'total': 29.28,
        'formaPago': '02',
      },
      'lines': [
        {
          'id': 7,
          'codigoArticulo': '2974',
          'descripcion': useLongLabels
              ? _longProductName
              : 'Producto activo de demostración',
          'cantidadEnvases': 1,
          'cantidadUnidades': 0,
          'unidadMedida': 'CAJAS',
          'unidadesCaja': 1,
          'precioVenta': 29.28,
          'importeVenta': 29.28,
          'codigoIva': '2',
        },
      ],
      'bolsaSummary': {
        'acumulacion': 0,
        'consumo': 0,
        'neto': 0,
        'movementCount': 0,
      },
      'inventoryRead': {
        'status': 'available',
        'serverTimeZone': 'Europe/Madrid',
        'stockStatus': 'available',
        'reservation': {
          'status': reservationStatus,
          'serverNowLocal': '2026-11-03T14:19:59.000000',
          'reservedUntilLocal': reservationStatus == 'RELEASED'
              ? null
              : '2026-11-03T14:20:00.000000',
        },
      },
    };

Widget _app({double textScale = 2}) => ProviderScope(
      key: UniqueKey(),
      child: MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(textScale),
          ),
          child: child!,
        ),
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => OrderDetailSheet.show(
                  context,
                  orderId: 42,
                ),
                child: const Text('Abrir detalle'),
              ),
            ),
          ),
        ),
      ),
    );

Future<void> _openDetail(WidgetTester tester) async {
  await tester.tap(find.text('Abrir detalle'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 20));
}

void main() {
  test('parses the optional inventory read model and uses server-local delta',
      () {
    final detail = OrderDetail.fromJson(_orderPayload('ACTIVE'));

    expect(detail.inventoryRead?.status, 'available');
    expect(detail.inventoryRead?.serverTimeZone, 'Europe/Madrid');
    expect(detail.inventoryRead?.reservation.status, 'ACTIVE');
    expect(
      orderReservationRefreshDelay(detail.inventoryRead),
      const Duration(seconds: 1),
    );
    expect(
        OrderDetail.fromJson(_orderPayload('EXPIRED'))
            .inventoryRead
            ?.reservation
            .status,
        'EXPIRED');
    expect(
      OrderDetail.fromJson(
              {..._orderPayload('ACTIVE')}..remove('inventoryRead'))
          .inventoryRead,
      isNull,
    );
  });

  test('does not schedule invalid, elapsed or unbounded server-local clocks',
      () {
    OrderInventoryRead inventory(String now, String until) =>
        OrderInventoryRead(
          status: 'available',
          reservation: OrderReservationRead(
            status: 'ACTIVE',
            serverNowLocal: now,
            reservedUntilLocal: until,
          ),
        );

    expect(
      orderReservationRefreshDelay(
        inventory(
          '2026-11-03T14:20:00.000000',
          '2026-11-03T14:20:00.000000',
        ),
      ),
      isNull,
    );
    expect(
      orderReservationRefreshDelay(
        inventory(
          '2026-11-03T14:20:01.000000',
          '2026-11-03T14:20:00.000000',
        ),
      ),
      isNull,
    );
    expect(
      orderReservationRefreshDelay(
        inventory(
          '2026-11-03T14:20:00.000000',
          '2026-11-04T14:20:00.000001',
        ),
      ),
      isNull,
    );
    expect(
      orderReservationRefreshDelay(inventory('not-a-date', 'also-invalid')),
      isNull,
    );
  });

  testWidgets(
      'detalle compacto envuelve referencia cliente producto y localiza estado',
      (tester) async {
    final originalAdapter = ApiClient.dio.httpClientAdapter;
    final originalBaseUrl = ApiClient.dio.options.baseUrl;
    final adapter = _OrderDetailAdapter()
      ..useLongLabels = true
      ..orderState = 'DRAFT';
    ApiClient.dio.httpClientAdapter = adapter;
    ApiClient.dio.options.baseUrl = 'http://127.0.0.1/api';
    addTearDown(() {
      ApiClient.dio.httpClientAdapter = originalAdapter;
      ApiClient.dio.options.baseUrl = originalBaseUrl;
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    tester.view
      ..physicalSize = const Size(360, 640)
      ..devicePixelRatio = 1;

    await tester.pumpWidget(_app(textScale: 2));
    await _openDetail(tester);

    final orderTitle = find.text('Pedido $_longOrderReference');
    expect(orderTitle, findsOneWidget);
    expect(tester.widget<Text>(orderTitle).overflow, isNull);
    final client = find.text('$_longClientName (4300032888)');
    expect(client, findsOneWidget);
    expect(tester.widget<Text>(client).overflow, isNull);
    expect(find.text('Borrador'), findsOneWidget);
    expect(
      tester.widget<Text>(find.text('Borrador')).style?.fontSize,
      greaterThanOrEqualTo(18),
    );
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Semantics &&
            widget.properties.label == 'Estado: Borrador',
      ),
      findsOneWidget,
    );
    expect(find.text('DRAFT'), findsNothing);
    expect(
      find.bySemanticsLabel('Confirmar pedido'),
      findsNothing,
      reason: 'La etiqueta visual no cambia el estado bruto de autorización.',
    );

    final product = find.text(_longProductName);
    await tester.ensureVisible(product);
    await tester.pump();
    expect(product, findsOneWidget);
    expect(tester.widget<Text>(product).overflow, isNull);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets(
      'modal real muestra reserva y cambia a caducada en teléfono y tablet al 200%',
      (tester) async {
    final originalAdapter = ApiClient.dio.httpClientAdapter;
    final originalBaseUrl = ApiClient.dio.options.baseUrl;
    final adapter = _OrderDetailAdapter();
    ApiClient.dio.httpClientAdapter = adapter;
    ApiClient.dio.options.baseUrl = 'http://127.0.0.1/api';
    addTearDown(() {
      ApiClient.dio.httpClientAdapter = originalAdapter;
      ApiClient.dio.options.baseUrl = originalBaseUrl;
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    for (final size in const [Size(360, 640), Size(1024, 1366)]) {
      adapter.reset();
      tester.view
        ..physicalSize = size
        ..devicePixelRatio = 1;
      await tester.pumpWidget(_app());
      await _openDetail(tester);

      expect(
        find.byKey(const ValueKey('order-reservation-active')),
        findsOneWidget,
        reason: '$size',
      );
      expect(find.text('Stock reservado'), findsOneWidget);
      expect(
        find.text('Reservado hasta 03/11 a las 14:20.'),
        findsOneWidget,
      );
      expect(
        find.bySemanticsLabel(
          'Stock reservado. Reservado hasta 03/11 a las 14:20.',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull, reason: '$size active');

      await tester.pump(const Duration(milliseconds: 1001));
      await tester.pump(const Duration(milliseconds: 20));

      expect(adapter.requestCount, 2, reason: '$size');
      expect(
        find.byKey(const ValueKey('order-reservation-expired')),
        findsOneWidget,
        reason: '$size',
      );
      expect(find.text('Reserva caducada'), findsOneWidget);
      expect(
        find.text(
          'Han pasado 24 horas. El stock se comprobará de nuevo al confirmar.',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull, reason: '$size expired');

      // Desmonta el modal y cancela su temporizador antes de cambiar el
      // viewport. Así cada variante prueba una navegación real independiente.
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    }
  });

  testWidgets(
      'fallo al vencer no mantiene garantía activa ni reintenta en bucle',
      (tester) async {
    final originalAdapter = ApiClient.dio.httpClientAdapter;
    final originalBaseUrl = ApiClient.dio.options.baseUrl;
    final adapter = _OrderDetailAdapter()..failSecondRequest = true;
    ApiClient.dio.httpClientAdapter = adapter;
    ApiClient.dio.options.baseUrl = 'http://127.0.0.1/api';
    addTearDown(() {
      ApiClient.dio.httpClientAdapter = originalAdapter;
      ApiClient.dio.options.baseUrl = originalBaseUrl;
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    tester.view
      ..physicalSize = const Size(360, 640)
      ..devicePixelRatio = 1;
    await tester.pumpWidget(_app());
    await _openDetail(tester);

    await tester.pump(const Duration(milliseconds: 1001));
    await tester.pump(const Duration(milliseconds: 20));

    expect(adapter.requestCount, 2);
    expect(find.text('No se pudo verificar la reserva'), findsOneWidget);
    expect(find.text('Stock reservado'), findsNothing);
    expect(
      find.byKey(const ValueKey('order-reservation-retry')),
      findsOneWidget,
    );

    await tester.pump(const Duration(seconds: 2));
    expect(adapter.requestCount, 2, reason: 'no debe reintentar en bucle');

    final retry = find.byKey(const ValueKey('order-reservation-retry'));
    await tester.ensureVisible(retry);
    await tester.pump();
    await tester.tap(retry);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));
    expect(adapter.requestCount, 3);
    await tester.ensureVisible(find.text('Reserva caducada'));
    await tester.pumpAndSettle();
    expect(find.text('Reserva caducada'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('muestra una reserva liberada sin fecha ni refresco automático',
      (tester) async {
    final originalAdapter = ApiClient.dio.httpClientAdapter;
    final originalBaseUrl = ApiClient.dio.options.baseUrl;
    final adapter = _OrderDetailAdapter()..initialStatus = 'RELEASED';
    ApiClient.dio.httpClientAdapter = adapter;
    ApiClient.dio.options.baseUrl = 'http://127.0.0.1/api';
    addTearDown(() {
      ApiClient.dio.httpClientAdapter = originalAdapter;
      ApiClient.dio.options.baseUrl = originalBaseUrl;
    });
    await tester.pumpWidget(_app());
    await _openDetail(tester);

    expect(find.text('Reserva liberada'), findsOneWidget);
    expect(find.textContaining('Reservado hasta'), findsNothing);
    await tester.pump(const Duration(seconds: 2));
    expect(adapter.requestCount, 1);
    expect(tester.takeException(), isNull);
  });
}
