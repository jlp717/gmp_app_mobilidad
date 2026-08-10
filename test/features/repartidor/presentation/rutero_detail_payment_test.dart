import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_payment.dart';

void main() {
  testWidgets('emits the four canonical payment payload codes', (tester) async {
    final payloadCodes = <String>[];
    final amountController = TextEditingController(text: '25.00');
    addTearDown(amountController.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RuteroDetailPayment(
            albaran: AlbaranEntrega(
              id: 'delivery-1',
              numeroAlbaran: 1,
              ejercicio: 2026,
              codigoCliente: 'client-1',
              nombreCliente: 'Cliente',
              fecha: '2026-08-03',
              importeTotal: 25,
            ),
            selectedPaymentMethod: 'EFECTIVO',
            isPaid: false,
            pagoError: null,
            importeCobradoController: amountController,
            importeCobradoError: null,
            onPaymentMethodChanged: (method) => payloadCodes.add(method),
            onPaidChanged: () {},
            onContinueToFinalize: () {},
            getPaymentTypeLabel: () => 'Contado',
          ),
        ),
      ),
    );

    for (final label in <String>[
      'EFECTIVO',
      'TARJETA',
      'BIZUM',
      'Transferencia',
    ]) {
      await tester.ensureVisible(find.text(label));
      await tester.tap(find.text(label));
      await tester.pump();
    }

    expect(
      payloadCodes,
      <String>['EFECTIVO', 'TARJETA', 'BIZUM', 'TRANSFERENCIA'],
    );
    expect(payloadCodes, isNot(contains('TRANSFER')));
  });
}
