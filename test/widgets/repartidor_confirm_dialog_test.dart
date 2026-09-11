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
}
