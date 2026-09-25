import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_card.dart';

/// REQ-19 tanda4: portrait 800x1280 → Mis pedidos en lista 1 columna con
/// OrderCard completo (compact:false). Sin GridView de 2 columnas.
void main() {
  OrderSummary order(int id, String client, double total) => OrderSummary(
        id: id,
        numeroPedido: id,
        clienteCode: 'C$id',
        clienteName: client,
        vendedorCode: '80',
        fecha: '2026-09-24',
        fechaFormatted: '24/09/2026',
        estado: 'CONFIRMADO',
        tipoVenta: 'CC',
        total: total,
        lineCount: 3,
        numeroPedidoFormatted: 'M-2026-$id',
      );

  Widget harness(List<OrderSummary> orders) {
    return MaterialApp(
      home: Scaffold(
        body: LayoutBuilder(
          builder: (context, _) {
            // Misma regla que _buildOrdersList en pedidos_page.dart:
            // portrait manda → 1 columna lista.
            final isPortrait = !Responsive.isLandscape(context);
            final cols = isPortrait
                ? 1
                : Responsive.denseListCrossAxisCount(context);
            if (cols <= 1) {
              return ListView.builder(
                itemCount: orders.length,
                itemBuilder: (context, index) => OrderCard(
                  order: orders[index],
                  compact: false,
                  onTap: () {},
                ),
              );
            }
            return GridView.builder(
              gridDelegate:
                  const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
              ),
              itemCount: orders.length,
              itemBuilder: (context, index) => OrderCard(
                order: orders[index],
                compact: true,
                onTap: () {},
              ),
            );
          },
        ),
      ),
    );
  }

  testWidgets('portrait 800x1280: lista 1 col, OrderCard completo, sin GridView',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1280);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final orders = [
      order(1, 'Cliente Uno', 120.50),
      order(2, 'Cliente Dos', 340.00),
      order(3, 'Cliente Tres', 55.75),
    ];
    await tester.pumpWidget(harness(orders));
    await tester.pumpAndSettle();

    // Regla portrait: 1 columna.
    expect(find.byType(GridView), findsNothing);
    expect(find.byType(ListView), findsOneWidget);
    expect(find.byType(OrderCard), findsNWidgets(3));

    // OrderCard completo: nombre cliente + nº líneas + compact:false.
    expect(find.text('Cliente Uno'), findsOneWidget);
    expect(find.text('3 líneas'), findsWidgets);
    for (final card
        in tester.widgetList<OrderCard>(find.byType(OrderCard))) {
      expect(card.compact, isFalse);
    }
  });
}
