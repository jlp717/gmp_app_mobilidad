import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/add_to_order_sheet.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/tarifa_selector_modal.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/unit_selector_modal.dart';

class _UnavailableProductDetailAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode({'success': false, 'error': 'fixture unavailable'}),
      404,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

const _portraitSizes = <Size>[
  Size(360, 640),
  Size(430, 932),
  Size(800, 1280),
  Size(1024, 1366),
];
const _textScales = <double>[1, 1.5, 2];

final _product = Product(
  code: '3519',
  name: 'Producto real de demostración con nombre largo',
  unitsPerBox: 12,
  unitMeasure: 'UNIDADES',
  stockEnvases: 20,
  stockUnidades: 240,
  precioTarifa1: 27.54,
);

final _tariffs = <TariffEntry>[
  TariffEntry(
    code: 1,
    description: 'Tarifa del cliente',
    price: 27.54,
    precioUnitario: 2.295,
  ),
  TariffEntry(
    code: 2,
    description: 'Tarifa profesional alternativa',
    price: 29.4,
    precioUnitario: 2.45,
  ),
];

void main() {
  final scenarios = <({Size size, double scale})>[];
  for (final portrait in _portraitSizes) {
    for (final size in [portrait, Size(portrait.height, portrait.width)]) {
      for (final scale in _textScales) {
        scenarios.add((size: size, scale: scale));
      }
    }
  }

  for (final scenario in scenarios) {
    final orientation =
        scenario.size.width > scenario.size.height ? 'landscape' : 'portrait';
    testWidgets(
      'tarifa y unidad accesibles ${scenario.size.width.toInt()}x'
      '${scenario.size.height.toInt()} $orientation texto ${scenario.scale}',
      (tester) async {
        await _setViewport(tester, scenario.size);

        await tester.pumpWidget(
          _testApp(
            textScale: scenario.scale,
            child: TarifaSelectorModal(
              product: _product,
              tariffs: _tariffs,
              codigoTarifaCliente: 1,
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(
          find.bySemanticsLabel(
            RegExp(r'Tarifa del cliente.*Seleccionada'),
          ),
          findsOneWidget,
        );
        expect(
          tester.getSize(find.byKey(const Key('tarifa_cancel_button'))).height,
          greaterThanOrEqualTo(56),
        );
        expect(
          tester.getSize(find.byKey(const Key('tarifa_accept_button'))).height,
          greaterThanOrEqualTo(56),
        );

        final alternative = find.text('Tarifa 2');
        await tester.ensureVisible(alternative);
        await tester.tap(alternative);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(
          find.bySemanticsLabel(RegExp(r'Tarifa 2.*Seleccionada')),
          findsOneWidget,
        );

        await tester.pumpWidget(
          _testApp(
            textScale: scenario.scale,
            child: UnitSelectorModal(
              product: _product,
              initialUnit: 'CAJAS',
              initialQuantity: 1,
              availableUnits: const ['CAJAS', 'UNIDADES'],
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(
          find.bySemanticsLabel(RegExp(r'Cajas.*Seleccionada')),
          findsOneWidget,
        );
        expect(
          tester.getSize(find.byKey(const Key('unit_clear_button'))).height,
          greaterThanOrEqualTo(56),
        );
        expect(
          tester.getSize(find.byKey(const Key('unit_accept_button'))).height,
          greaterThanOrEqualTo(56),
        );

        final units = find.text('Unidades');
        await tester.ensureVisible(units);
        await tester.tap(units);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(
          find.bySemanticsLabel(RegExp(r'Unidades.*Seleccionada')),
          findsOneWidget,
        );
      },
    );
  }

  testWidgets('acciones de línea fluyen a columna sólo en teléfono ampliado',
      (tester) async {
    final originalAdapter = ApiClient.dio.httpClientAdapter;
    final originalBaseUrl = ApiClient.dio.options.baseUrl;
    ApiClient.dio.httpClientAdapter = _UnavailableProductDetailAdapter();
    ApiClient.dio.options.baseUrl = 'http://127.0.0.1/api';
    addTearDown(() {
      ApiClient.dio.httpClientAdapter = originalAdapter;
      ApiClient.dio.options.baseUrl = originalBaseUrl;
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    for (final scenario in const [
      (size: Size(360, 640), scale: 2.0, stacked: true),
      (size: Size(1024, 1366), scale: 1.0, stacked: false),
    ]) {
      await _setViewport(tester, scenario.size);
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: ThemeData.dark(useMaterial3: true),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(scenario.scale),
              ),
              child: child!,
            ),
            home: Scaffold(
              body: Consumer(
                builder: (context, ref, _) => ElevatedButton(
                  onPressed: () => AddToOrderSheet.show(
                    context,
                    ref,
                    product: _product,
                  ),
                  child: const Text('Abrir línea'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Abrir línea'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      final clear = find.byKey(const ValueKey('order-line-clear-button'));
      final add = find.byKey(const ValueKey('order-line-add-button'));
      expect(clear, findsOneWidget);
      expect(add, findsOneWidget);
      await tester.ensureVisible(add);
      await tester.pump();
      expect(tester.getSize(clear).height, greaterThanOrEqualTo(56));
      expect(tester.getSize(add).height, greaterThanOrEqualTo(56));
      if (scenario.stacked) {
        expect(tester.getSize(clear).width, greaterThan(300));
        expect(tester.getSize(add).width, greaterThan(300));
        expect(
          tester.getTopLeft(add).dy,
          greaterThan(tester.getBottomLeft(clear).dy),
        );
        await tester.tap(clear);
        await tester.tap(add);
        await tester.pump();
        expect(find.text('Indica una cantidad mayor que 0'), findsOneWidget);
      } else {
        expect(
          tester.getTopLeft(add).dy,
          closeTo(tester.getTopLeft(clear).dy, 0.1),
        );
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    }
  });

  testWidgets('tarifas con igual precio conservan una identidad seleccionada',
      (tester) async {
    int? selectedCode;
    double? selectedPrice;
    final duplicatePriceTariffs = <TariffEntry>[
      TariffEntry(
        code: 1,
        description: 'Tarifa cliente',
        price: 27.54,
        precioUnitario: 2.295,
      ),
      TariffEntry(
        code: 2,
        description: 'Tarifa alternativa',
        price: 27.54,
        precioUnitario: 2.295,
      ),
    ];

    await tester.pumpWidget(
      _testApp(
        textScale: 1,
        child: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () async {
              selectedPrice = await TarifaSelectorModal.show(
                context,
                product: _product,
                tariffs: duplicatePriceTariffs,
                codigoTarifaCliente: 1,
                onTariffSelected: (code) => selectedCode = code,
              );
            },
            child: const Text('Abrir tarifas'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Abrir tarifas'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tarifa 2'));
    final accept = find.byKey(const Key('tarifa_accept_button'));
    await tester.ensureVisible(accept);
    await tester.pumpAndSettle();
    await tester.tap(accept);
    await tester.pumpAndSettle();

    expect(selectedCode, 2);
    expect(selectedPrice, 2.295);
  });
}

Widget _testApp({required double textScale, required Widget child}) {
  return MaterialApp(
    theme: ThemeData.dark(useMaterial3: true),
    builder: (context, appChild) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: TextScaler.linear(textScale),
      ),
      child: appChild!,
    ),
    home: Scaffold(body: Center(child: child)),
  );
}

Future<void> _setViewport(WidgetTester tester, Size size) async {
  tester.view
    ..physicalSize = size
    ..devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}
