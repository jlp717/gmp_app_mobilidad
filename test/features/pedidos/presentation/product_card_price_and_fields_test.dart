import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/product_card.dart';

class _NoNetwork extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) => _ThrowingClient();
}

class _ThrowingClient extends Fake implements HttpClient {
  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    throw const SocketException('widget test');
  }

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    throw const SocketException('widget test');
  }
}

Product _product({
  double precioTarifa1 = 10.5,
  double precioCliente = 9.25,
  bool precioEspecialCliente = true,
}) {
  return Product(
    code: 'ART1',
    name: 'Helado vainilla',
    unitType: 'caja',
    hasPurchased: true,
    yoyChange: 12.5,
    stockEnvases: 3,
    stockUnidades: 2,
    unitsPerBox: 10,
    unitsRetractil: 4,
    precioTarifa1: precioTarifa1,
    precioCliente: precioCliente,
    precioMinimo: 8,
    precioEspecialCliente: precioEspecialCliente,
    unitMeasure: 'CAJAS',
  );
}

Widget _card({
  double scale = 1,
  double precioTarifa1 = 10.5,
  double precioCliente = 9.25,
  bool precioEspecialCliente = true,
  bool isMarginVisible = true,
}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(
        size: const Size(360, 2400),
        textScaler: TextScaler.linear(scale),
      ),
      child: Scaffold(
        body: SingleChildScrollView(
          child: ProductCard(
            product: _product(
              precioTarifa1: precioTarifa1,
              precioCliente: precioCliente,
              precioEspecialCliente: precioEspecialCliente,
            ),
            promo: PromotionItem(
              code: 'PROMO',
              name: 'Oferta',
              promoDesc: 'Oferta verano',
            ),
            onTap: () {},
            onQuickAdd: () {},
            onToggleFavorite: () {},
            isMarginVisible: isMarginVisible,
            cartQty: 2,
            cartQtySuffix: 'c',
          ),
        ),
      ),
    ),
  );
}

double _lin(double channel) => channel <= 0.04045
    ? channel / 12.92
    : math.pow((channel + 0.055) / 1.055, 2.4).toDouble();

double _contrast(Color a, Color b) {
  double lum(Color c) =>
      0.2126 * _lin(c.r) + 0.7152 * _lin(c.g) + 0.0722 * _lin(c.b);
  final l1 = lum(a);
  final l2 = lum(b);
  final hi = math.max(l1, l2);
  final lo = math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

BorderRadius _radius(WidgetTester tester, Key key) {
  final material = tester.widget<Material>(find.byKey(key));
  final shape = material.shape! as RoundedRectangleBorder;
  return shape.borderRadius as BorderRadius;
}

void _expectNoOverflow(WidgetTester tester) {
  Object? error = tester.takeException();
  while (error != null) {
    final text = error.toString();
    if (text.contains('overflowed') || text.contains('RenderFlex')) {
      fail(text);
    }
    error = tester.takeException();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    HttpOverrides.global = _NoNetwork();
    ApiConfig.setProduction();
  });

  tearDownAll(() {
    HttpOverrides.global = null;
  });

  setUp(() {
    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      final msg = details.exceptionAsString();
      if (msg.contains('Socket') ||
          msg.contains('HTTP') ||
          msg.contains('NetworkImage') ||
          msg.contains('Image')) {
        return;
      }
      previous?.call(details);
    };
  });

  testWidgets('both prices show amounts and one tap switches the active price',
      (tester) async {
    await tester.pumpWidget(_card());
    await tester.pump();
    _expectNoOverflow(tester);

    expect(find.text('Precio de tarifa'), findsOneWidget);
    expect(find.text('Precio especial'), findsOneWidget);
    expect(find.text('10,500 €'), findsWidgets);
    expect(find.text('9,250 €'), findsWidgets);
    expect(find.textContaining('0,000'), findsNothing);
    expect(find.textContaining('0.000'), findsNothing);

    expect(
      tester.widget<Text>(find.byKey(const Key('active-sale-price'))).data,
      '9,250 €',
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('price-mode-especial')),
        matching: find.byIcon(Icons.check),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('price-mode-tarifa')),
        matching: find.byIcon(Icons.check),
      ),
      findsNothing,
    );

    final tarifaRadius = _radius(tester, const Key('price-mode-tarifa'));
    final especialRadius = _radius(tester, const Key('price-mode-especial'));
    expect(
      tarifaRadius.topLeft.x,
      isNot(equals(especialRadius.topLeft.x)),
    );

    final tarifaFill = tester
        .widget<Material>(find.byKey(const Key('price-mode-tarifa')))
        .color!;
    final especialFill = tester
        .widget<Material>(find.byKey(const Key('price-mode-especial')))
        .color!;
    expect(tarifaFill, isNot(equals(especialFill)));

    for (final key in const [
      Key('price-mode-tarifa'),
      Key('price-mode-especial'),
    ]) {
      final material = tester.widget<Material>(find.byKey(key));
      final label = key == const Key('price-mode-tarifa')
          ? 'Precio de tarifa'
          : 'Precio especial';
      final text = tester.widget<Text>(
        find.descendant(of: find.byKey(key), matching: find.text(label)),
      );
      expect(text.style!.fontSize, greaterThanOrEqualTo(16));
      expect(_contrast(text.style!.color!, material.color!),
          greaterThanOrEqualTo(4.5));
      final box = tester.getSize(find.byKey(key));
      expect(box.width, greaterThanOrEqualTo(48));
      expect(box.height, greaterThanOrEqualTo(48));
    }

    await tester.tap(find.byKey(const Key('price-mode-tarifa')));
    await tester.pump();

    expect(
      tester.widget<Text>(find.byKey(const Key('active-sale-price'))).data,
      '10,500 €',
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('price-mode-tarifa')),
        matching: find.byIcon(Icons.check),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('price-mode-especial')),
        matching: find.byIcon(Icons.check),
      ),
      findsNothing,
    );
  });

  testWidgets('missing special price stays empty and is not a fake zero',
      (tester) async {
    await tester.pumpWidget(
      _card(precioCliente: 0, precioEspecialCliente: false),
    );
    await tester.pump();
    _expectNoOverflow(tester);

    expect(find.text('Sin precio especial'), findsOneWidget);
    expect(find.text('10,500 €'), findsWidgets);
    expect(find.textContaining('0,000'), findsNothing);
    expect(find.textContaining('0.000'), findsNothing);
    expect(
      tester.widget<Text>(find.byKey(const Key('active-sale-price'))).data,
      '10,500 €',
    );

    await tester.tap(find.byKey(const Key('price-mode-especial')));
    await tester.pump();
    expect(
      tester.widget<Text>(find.byKey(const Key('active-sale-price'))).data,
      '10,500 €',
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('price-mode-especial')),
        matching: find.byIcon(Icons.check),
      ),
      findsNothing,
    );
  });

  for (final scale in const [1.0, 1.5, 2.0]) {
    testWidgets('price labels stay readable at text scale $scale',
        (tester) async {
      await tester.pumpWidget(_card(scale: scale));
      await tester.pump();
      _expectNoOverflow(tester);

      for (final label in const ['Precio de tarifa', 'Precio especial']) {
        final text = tester.widget<Text>(find.text(label));
        expect(text.style!.fontSize, greaterThanOrEqualTo(16));
        final painted = tester.getSize(find.text(label));
        expect(painted.height, greaterThanOrEqualTo(16 * scale));
      }
      _expectNoOverflow(tester);
    });
  }

  testWidgets('compacted catalog fields are visible without a tap',
      (tester) async {
    await tester.pumpWidget(_card());
    await tester.pump();
    _expectNoOverflow(tester);

    expect(find.text('Helado vainilla'), findsOneWidget);
    expect(find.text('ART1'), findsOneWidget);
    expect(find.text('Comprado'), findsOneWidget);
    expect(find.text('Caja'), findsOneWidget);
    expect(find.textContaining('Oferta verano'), findsOneWidget);
    expect(find.textContaining('cj'), findsWidgets);
    expect(find.textContaining('12.5%'), findsOneWidget);
    expect(find.textContaining('10 uds'), findsWidgets);
    expect(find.textContaining('U/R:'), findsOneWidget);
    expect(find.textContaining('Min cajas:'), findsOneWidget);
    expect(find.text('Precio exclusivo cliente'), findsOneWidget);
    expect(find.text('Añadir'), findsOneWidget);
    expect(find.text('2c'), findsOneWidget);
    expect(find.byIcon(Icons.chevron_right), findsOneWidget);
    expect(find.text('Sin IVA'), findsOneWidget);
  });
}
