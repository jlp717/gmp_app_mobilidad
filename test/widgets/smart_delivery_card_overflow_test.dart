import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/smart_delivery_card.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('es_ES');
  });

  testWidgets('delivery card truncates long ids and amounts on a 320px phone',
      (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final albaran = AlbaranEntrega(
      id: '2026-A-99-999999-CLIENTE-LARGO',
      numeroAlbaran: 999999,
      ejercicio: 2026,
      codigoCliente: 'C99999',
      nombreCliente: 'Cliente con razón social extraordinariamente larga S.L.',
      fecha: '2026-09-07',
      importeTotal: 123456.78,
      serie: 'ALB',
      terminal: 12,
      serieFactura: 'FACTURA',
      numeroFactura: 888888,
      tipoPago: '01 CONTADO EFECTIVO',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(size: Size(320, 568)),
          child: Scaffold(
            body: SizedBox(
              width: 320,
              child: SmartDeliveryCard(
                albaran: albaran,
                onTap: () {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byType(SmartDeliveryCard), findsOneWidget);
  });
}
