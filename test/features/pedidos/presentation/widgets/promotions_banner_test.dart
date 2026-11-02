import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/promotions_banner.dart';

void main() {
  testWidgets('pinta ofertas en el flujo de pedido cuando hay promociones',
      (tester) async {
    tester.view.physicalSize = const Size(600, 400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final promotions = [
      PromotionItem(
        code: 'ART1',
        name: 'Migas de bacalao',
        promoDesc: 'Oferta PMR',
        promoType: 'GIFT',
        promoCode: 'PMR-27',
        minQty: 14,
        giftQty: 4,
      ),
      PromotionItem(
        code: 'ART2',
        name: 'Anillas de calamar',
        promoDesc: 'Precio promo',
        promoType: 'PRICE',
        promoCode: 'CPES-1',
        promoPrice: 8.5,
        regularPrice: 10,
      ),
    ];

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: ThemeData(useMaterial3: true),
          home: Scaffold(
            body: PromotionsBanner(
              promotions: promotions,
              onProductTap: (_, __) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Ofertas activas (2)'), findsOneWidget);
    await tester.tap(find.text('Ofertas activas (2)'));
    await tester.pumpAndSettle();
    expect(find.text('Migas de bacalao'), findsOneWidget);
    expect(find.text('Anillas de calamar'), findsOneWidget);
    expect(find.text('Ofertas activas (0)'), findsNothing);
  });

  testWidgets('no congela el banner cuando la lista de ofertas esta vacia',
      (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: PromotionsBanner(promotions: []),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Ofertas activas'), findsNothing);
  });

  testWidgets('pinta Ofertas activas (27) con el corte PMR del comercial 35',
      (tester) async {
    final promotions = List<PromotionItem>.generate(
      27,
      (i) => PromotionItem(
        code: 'PMR$i',
        name: 'Oferta PMR $i',
        promoDesc: 'Regalo $i',
        promoType: 'GIFT',
        promoCode: 'PMR-$i',
        minQty: 14,
        giftQty: 4,
      ),
    );

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: ThemeData(useMaterial3: true),
          home: Scaffold(
            body: PromotionsBanner(
              promotions: promotions,
              onProductTap: (_, __) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Ofertas activas (27)'), findsOneWidget);
    expect(find.text('Ofertas activas (0)'), findsNothing);
  });

  testWidgets('actualiza el banner cuando el provider pasa de 0 a 27 ofertas',
      (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: _PromotionsBannerHarness(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Ofertas activas'), findsNothing);

    await tester.tap(find.text('cargar 27'));
    await tester.pumpAndSettle();
    expect(find.text('Ofertas activas (27)'), findsOneWidget);
  });

  testWidgets('cabecera es legible y tactil con texto al 200 por ciento',
      (tester) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2),
            ),
            child: child!,
          ),
          home: Scaffold(
            body: PromotionsBanner(
              promotions: [
                PromotionItem(
                  code: '3519',
                  name: 'Producto en oferta',
                  promoDesc: 'Oferta activa',
                  promoType: 'PRICE',
                  promoCode: 'PROMO-1',
                  promoPrice: 27.54,
                  regularPrice: 29.4,
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final title = find.text('Ofertas activas (1)');
    expect(title, findsOneWidget);
    expect(
      find.bySemanticsLabel(RegExp(r'Mostrar ofertas activas.*1 campañas')),
      findsOneWidget,
    );
    final header = find.ancestor(of: title, matching: find.byType(InkWell));
    expect(tester.getSize(header.first).height, greaterThanOrEqualTo(56));
    expect(tester.takeException(), isNull);

    await tester.tap(title);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(
      find.bySemanticsLabel(RegExp(r'Ocultar ofertas activas.*1 campañas')),
      findsOneWidget,
    );
  });
}

class _PromotionsBannerHarness extends StatefulWidget {
  const _PromotionsBannerHarness();

  @override
  State<_PromotionsBannerHarness> createState() =>
      _PromotionsBannerHarnessState();
}

class _PromotionsBannerHarnessState extends State<_PromotionsBannerHarness> {
  List<PromotionItem> _promotions = const [];

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TextButton(
          onPressed: () {
            setState(() {
              _promotions = List<PromotionItem>.generate(
                27,
                (i) => PromotionItem(
                  code: 'PMR$i',
                  name: 'Oferta PMR $i',
                  promoDesc: 'Regalo $i',
                  promoType: 'GIFT',
                  promoCode: 'PMR-$i',
                ),
              );
            });
          },
          child: const Text('cargar 27'),
        ),
        PromotionsBanner(promotions: _promotions),
      ],
    );
  }
}
