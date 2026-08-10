import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/smart_delivery_card.dart';

void main() {
  AlbaranEntrega buildAlbaran({
    EstadoEntrega estado = EstadoEntrega.pendiente,
  }) {
    return AlbaranEntrega(
      id: 'delivery-1',
      numeroAlbaran: 1,
      ejercicio: 2026,
      codigoCliente: 'CLIENTE-1',
      nombreCliente: 'Cliente de prueba',
      fecha: '2026-08-03',
      importeTotal: 10,
      estado: estado,
    );
  }

  Future<void> pumpCard(
    WidgetTester tester, {
    required AlbaranEntrega albaran,
    required VoidCallback onTap,
    VoidCallback? onSwipeComplete,
    VoidCallback? onSwipeNote,
  }) {
    return tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SmartDeliveryCard(
            albaran: albaran,
            onTap: onTap,
            onSwipeComplete: onSwipeComplete,
            onSwipeNote: onSwipeNote,
          ),
        ),
      ),
    );
  }

  testWidgets('tap opens the supplied detail action once', (tester) async {
    var taps = 0;

    await pumpCard(
      tester,
      albaran: buildAlbaran(),
      onTap: () => taps++,
    );

    await tester.tap(find.text('Cliente de prueba'));

    expect(taps, 1);
  });

  testWidgets('a drag below the threshold does not invoke any swipe action',
      (tester) async {
    var completions = 0;
    var notes = 0;

    await pumpCard(
      tester,
      albaran: buildAlbaran(),
      onTap: () {},
      onSwipeComplete: () => completions++,
      onSwipeNote: () => notes++,
    );

    await tester.drag(find.byType(GestureDetector).first, const Offset(-60, 0));
    await tester.pumpAndSettle();

    expect(completions, 0);
    expect(notes, 0);
  });

  testWidgets('a left drag above the threshold invokes completion once',
      (tester) async {
    var completions = 0;

    await pumpCard(
      tester,
      albaran: buildAlbaran(),
      onTap: () {},
      onSwipeComplete: () => completions++,
    );

    await tester.drag(
        find.byType(GestureDetector).first, const Offset(-120, 0));
    await tester.pumpAndSettle();

    expect(completions, 1);
  });

  testWidgets('swipe actions are suppressed for an already delivered order',
      (tester) async {
    var completions = 0;
    var notes = 0;

    await pumpCard(
      tester,
      albaran: buildAlbaran(estado: EstadoEntrega.entregado),
      onTap: () {},
      onSwipeComplete: () => completions++,
      onSwipeNote: () => notes++,
    );

    await tester.drag(
        find.byType(GestureDetector).first, const Offset(-120, 0));
    await tester.drag(find.byType(GestureDetector).first, const Offset(120, 0));
    await tester.pumpAndSettle();

    expect(completions, 0);
    expect(notes, 0);
  });
}
