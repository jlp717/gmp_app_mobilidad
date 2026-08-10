import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_payment.dart';

void main() {
  testWidgets(
      'selected payment remains an intent until backend acknowledgement',
      (tester) async {
    final amountController = TextEditingController(text: '25.00');
    addTearDown(amountController.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailPayment(
            albaran: AlbaranEntrega(
              id: 'delivery-intent',
              numeroAlbaran: 1,
              ejercicio: 2026,
              codigoCliente: 'client-intent',
              nombreCliente: 'Cliente',
              fecha: '2026-08-03',
              importeTotal: 25,
            ),
            selectedPaymentMethod: 'EFECTIVO',
            isPaid: true,
            pagoError: null,
            importeCobradoController: amountController,
            importeCobradoError: null,
            onPaymentMethodChanged: (_) {},
            onPaidChanged: () {},
            onContinueToFinalize: () {},
            getPaymentTypeLabel: () => 'Contado',
          ),
        ),
      ),
    );

    expect(find.text('Cobro preparado con EFECTIVO'), findsOneWidget);
    expect(find.textContaining('Cobro registrado'), findsNothing);
  });
}
