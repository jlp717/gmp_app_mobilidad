import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/promotions_banner.dart';

void main() {
  testWidgets('pinta ofertas en el flujo de pedido cuando hay promociones',
      (tester) async {
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
}
