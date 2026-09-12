import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_payment.dart';

AlbaranEntrega _collectableAlbaran({
  double saldo = 120.5,
  double deudaCliente = 450,
  bool capped = true,
}) {
  return AlbaranEntrega(
    id: '2026-A-1-99-C1',
    numeroAlbaran: 99,
    ejercicio: 2026,
    serie: 'A',
    codigoCliente: 'C1',
    nombreCliente: 'Bar La Esquina',
    fecha: '2026-09-07',
    importeTotal: 120.5,
    codigoRepartidor: '08',
    estado: EstadoEntrega.enRuta,
    importeDisponibleCobro: saldo,
    importeCvcPendiente: deudaCliente,
    cobroSaldoCapped: capped,
    esCTR: true,
  );
}

Widget _wrap(Widget child, {Size size = const Size(390, 844)}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(size: size),
      child: Scaffold(body: child),
    ),
  );
}

void main() {
  testWidgets('muestra saldo del albarán y deuda total del cliente',
      (tester) async {
    final controller = TextEditingController(text: '120,50');
    await tester.pumpWidget(
      _wrap(
        RuteroDetailPayment(
          albaran: _collectableAlbaran(),
          selectedPaymentMethod: 'EFECTIVO',
          isPaid: false,
          pagoError: null,
          importeCobradoController: controller,
          importeCobradoError: null,
          onPaymentMethodChanged: (_) {},
          onPaidChanged: () {},
          onContinueToFinalize: () {},
          getPaymentTypeLabel: () => 'Contado',
        ),
      ),
    );

    expect(find.text('Saldo cobrable de este albarán'), findsOneWidget);
    expect(find.textContaining('120,50'), findsWidgets);
    expect(find.textContaining('Deuda total del cliente'), findsOneWidget);
    expect(find.textContaining('450,00'), findsOneWidget);
    expect(find.textContaining('Solo puedes cobrar el saldo de este albarán'),
        findsOneWidget);
  });

  testWidgets('los cuatro métodos de pago caben en 390px sin overflow',
      (tester) async {
    final controller = TextEditingController();
    await tester.pumpWidget(
      _wrap(
        RuteroDetailPayment(
          albaran:
              _collectableAlbaran(saldo: 40, deudaCliente: 40, capped: false),
          selectedPaymentMethod: 'TALON',
          isPaid: false,
          pagoError: null,
          importeCobradoController: controller,
          importeCobradoError: null,
          onPaymentMethodChanged: (_) {},
          onPaidChanged: () {},
          onContinueToFinalize: () {},
          getPaymentTypeLabel: () => 'Contado',
        ),
      ),
    );

    expect(find.text('Efectivo'), findsOneWidget);
    expect(find.text('Tarjeta'), findsOneWidget);
    expect(find.text('Bizum'), findsOneWidget);
    expect(find.text('Talón'), findsOneWidget);
    expect(find.text('Transferencia'), findsNothing);
    expect(find.text('TRANSFERENCIA'), findsNothing);

    expect(tester.takeException(), isNull);
  });

  testWidgets('muestra error de pago y permite continuar', (tester) async {
    final controller = TextEditingController();
    var continued = false;
    await tester.pumpWidget(
      _wrap(
        RuteroDetailPayment(
          albaran: _collectableAlbaran(),
          selectedPaymentMethod: 'TARJETA',
          isPaid: false,
          pagoError: 'Selecciona un método de pago.',
          importeCobradoController: controller,
          importeCobradoError: null,
          onPaymentMethodChanged: (_) {},
          onPaidChanged: () {},
          onContinueToFinalize: () => continued = true,
          getPaymentTypeLabel: () => 'Contado',
        ),
      ),
    );

    expect(find.text('Selecciona un método de pago.'), findsOneWidget);

    await tester.tap(find.text('Continuar a finalizar'));
    await tester.pump();
    expect(continued, isTrue);
  });

  testWidgets('sin saldo cobrable muestra mensaje claro', (tester) async {
    final controller = TextEditingController();
    final albaran = AlbaranEntrega(
      id: '2026-A-1-100-C1',
      numeroAlbaran: 100,
      ejercicio: 2026,
      codigoCliente: 'C2',
      nombreCliente: 'Cliente crédito',
      fecha: '2026-09-07',
      importeTotal: 80,
      codigoRepartidor: '08',
      estado: EstadoEntrega.enRuta,
      importeDisponibleCobro: 0,
    );

    await tester.pumpWidget(
      _wrap(
        RuteroDetailPayment(
          albaran: albaran,
          selectedPaymentMethod: 'EFECTIVO',
          isPaid: false,
          pagoError: null,
          importeCobradoController: controller,
          importeCobradoError: null,
          onPaymentMethodChanged: (_) {},
          onPaidChanged: () {},
          onContinueToFinalize: () {},
          getPaymentTypeLabel: () => 'Crédito',
        ),
      ),
    );

    expect(find.text('Sin saldo cobrable'), findsOneWidget);
    expect(find.textContaining('Sin saldo cobrable en este albarán'),
        findsOneWidget);
    expect(find.text('Registrar cobro'), findsNothing);
  });

  testWidgets('cobro obligatorio aparece marcado y no se desmarca',
      (tester) async {
    final controller = TextEditingController(text: '120,50');
    var taps = 0;
    await tester.pumpWidget(
      _wrap(
        RuteroDetailPayment(
          albaran: _collectableAlbaran(),
          selectedPaymentMethod: 'EFECTIVO',
          isPaid: true,
          pagoError: null,
          importeCobradoController: controller,
          importeCobradoError: null,
          paymentLocked: true,
          onPaymentMethodChanged: (_) {},
          onPaidChanged: () => taps += 1,
          onContinueToFinalize: () {},
          getPaymentTypeLabel: () => 'Contado',
        ),
      ),
    );

    expect(find.text('Voy a cobrar este documento'), findsOneWidget);
    expect(find.textContaining('Cobro obligatorio'), findsWidgets);
    await tester.tap(find.text('Voy a cobrar este documento'));
    await tester.pump();
    expect(taps, 0);
  });

  testWidgets('talón pide número, vencimiento y banco', (tester) async {
    final controller = TextEditingController(text: '40,00');
    final numero = TextEditingController();
    final vencimiento = TextEditingController();
    final codigo = TextEditingController();
    final banco = TextEditingController();
    await tester.pumpWidget(
      _wrap(
        RuteroDetailPayment(
          albaran:
              _collectableAlbaran(saldo: 40, deudaCliente: 40, capped: false),
          selectedPaymentMethod: 'TALON',
          isPaid: true,
          pagoError: null,
          importeCobradoController: controller,
          importeCobradoError: null,
          numeroTalonController: numero,
          fechaVencimientoTalonController: vencimiento,
          bancoCodigoController: codigo,
          bancoNombreController: banco,
          onPaymentMethodChanged: (_) {},
          onPaidChanged: () {},
          onContinueToFinalize: () {},
          getPaymentTypeLabel: () => 'Contado',
        ),
      ),
    );

    expect(find.text('Datos del talón'), findsOneWidget);
    expect(find.text('Número de talón'), findsOneWidget);
    expect(find.text('Fecha de vencimiento'), findsOneWidget);
    expect(find.textContaining('Código de entidad'), findsOneWidget);
    expect(find.text('Nombre del banco'), findsOneWidget);
    expect(find.text('Transferencia'), findsNothing);
  });

  testWidgets(
      'TRANSFERENCIA interno se muestra como Talón y no como chip extra',
      (tester) async {
    final controller = TextEditingController(text: '40,00');
    await tester.pumpWidget(
      _wrap(
        RuteroDetailPayment(
          albaran:
              _collectableAlbaran(saldo: 40, deudaCliente: 40, capped: false),
          selectedPaymentMethod: 'TRANSFERENCIA',
          isPaid: true,
          pagoError: null,
          importeCobradoController: controller,
          importeCobradoError: null,
          onPaymentMethodChanged: (_) {},
          onPaidChanged: () {},
          onContinueToFinalize: () {},
          getPaymentTypeLabel: () => 'Contado',
        ),
      ),
    );

    expect(find.text('Talón'), findsWidgets);
    expect(find.text('Transferencia'), findsNothing);
    expect(find.text('TRANSFERENCIA'), findsNothing);
    expect(find.text('Datos del talón'), findsOneWidget);
  });
}
