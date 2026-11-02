import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/pages/promotions_list_page.dart';

/// REQ-25 tanda4: promos [] → literal de historial vacío, nunca badge 0.
void main() {
  testWidgets('lista vacía explica que no hay promociones ni historial',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: PromotionsListPage(
          promotions: const [],
          onProductTap: (_, __) async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('Sin promociones vigentes ni antiguas para este cliente'),
      findsOneWidget,
    );
    expect(
      find.textContaining('Cuando haya ofertas vigentes o antiguas'),
      findsOneWidget,
    );
    // Nota: el contador '0' del AppBar de esta página es informativo
    // (visible/total); el badge engañoso prohibido es el de pedidos_page,
    // que con [] muestra icono sin badge (rama promoCount == 0).
  });
}
