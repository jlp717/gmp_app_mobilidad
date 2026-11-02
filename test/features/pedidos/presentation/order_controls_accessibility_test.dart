import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/tarifa_selector_modal.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/unit_selector_modal.dart';

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
