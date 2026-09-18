import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/repartidor_confirm_dialog.dart';

void main() {
  testWidgets('pide confirmación accesible antes de continuar', (tester) async {
    var confirmed = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            return TextButton(
              onPressed: () async {
                confirmed = await confirmRepartidorAction(
                  context,
                  title: '¿Estás seguro?',
                  message: 'Se completará el albarán.',
                );
              },
              child: const Text('abrir'),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();

    expect(find.text('¿Estás seguro?'), findsOneWidget);
    expect(find.text('Se completará el albarán.'), findsOneWidget);
    expect(find.text('Cancelar'), findsOneWidget);
    expect(find.text('Sí, continuar'), findsOneWidget);
    expect(
      tester.getSemantics(find.text('Cancelar')).label,
      'Cancelar',
    );
    expect(
      tester.getSemantics(find.text('Sí, continuar')).label,
      'Sí, continuar',
    );

    await tester.tap(find.text('Sí, continuar'));
    await tester.pumpAndSettle();
    expect(confirmed, isTrue);
  });

  testWidgets('Confirmar entrega muestra el modal y cancelar no POST',
      (tester) async {
    var posted = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            return TextButton(
              onPressed: () async {
                final ok = await confirmRuteroDeliveryWrite(
                  context,
                  noEntrega: false,
                  documentLabel: 'Albarán P-15-2367',
                  amountLabel: '173,78 €',
                  receiverLine: 'carlls (23331494H)',
                );
                if (ok) posted = true;
              },
              child: const Text('Confirmar entrega'),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('Confirmar entrega'));
    await tester.pumpAndSettle();

    expect(find.text('¿Confirmar la entrega?'), findsOneWidget);
    expect(find.textContaining('Albarán P-15-2367'), findsOneWidget);
    expect(find.text('Cancelar'), findsOneWidget);

    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(posted, isFalse);

    await tester.tap(find.text('Confirmar entrega'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirmar entrega').last);
    await tester.pumpAndSettle();
    expect(posted, isTrue);
  });

  testWidgets('No entrega muestra el modal y cancelar no cambia estado',
      (tester) async {
    var proceeded = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            return TextButton(
              onPressed: () async {
                final ok = await confirmRuteroNoEntregaIntent(context);
                if (ok) proceeded = true;
              },
              child: const Text('No entrega (cerrado o no disponible)'),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('No entrega (cerrado o no disponible)'));
    await tester.pumpAndSettle();

    expect(find.text('¿Registrar no entrega?'), findsOneWidget);
    expect(find.text('Continuar a Finalizar'), findsOneWidget);

    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(proceeded, isFalse);

    await tester.tap(find.text('No entrega (cerrado o no disponible)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continuar a Finalizar'));
    await tester.pumpAndSettle();
    expect(proceeded, isTrue);
  });

  testWidgets('el modal de confirmación aparece encima de un bottom sheet',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            return TextButton(
              onPressed: () {
                showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (sheetContext) {
                    return SizedBox(
                      height: 700,
                      child: Center(
                        child: TextButton(
                          onPressed: () {
                            confirmRuteroDeliveryWrite(
                              sheetContext,
                              noEntrega: false,
                              documentLabel: 'Albarán P-15-2367',
                              amountLabel: '10,00 €',
                            );
                          },
                          child: const Text('Confirmar entrega'),
                        ),
                      ),
                    );
                  },
                );
              },
              child: const Text('abrir sheet'),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('abrir sheet'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirmar entrega'));
    await tester.pumpAndSettle();

    expect(find.text('¿Confirmar la entrega?'), findsOneWidget);
    expect(find.text('Confirmar entrega'), findsWidgets);
  });
}
