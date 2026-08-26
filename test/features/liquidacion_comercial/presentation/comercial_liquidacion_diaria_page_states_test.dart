import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/presentation/pages/comercial_liquidacion_diaria_page.dart';

Future<void> _pumpPage(
  WidgetTester tester, {
  ComercialLiquidacionSummary summary = const ComercialLiquidacionSummary(),
  FutureOr<void> Function(ComercialLiquidacionDraft)? onSubmit,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        home: ComercialLiquidacionDiariaPage(
          employeeCode: '57',
          initialSummary: summary,
          onSubmit: onSubmit,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  Future<void> fillBalanced(WidgetTester tester) async {
    await tester.enterText(find.byType(TextFormField).at(0), '120');
    await tester.enterText(find.byType(TextFormField).at(1), '80');
    await tester.pumpAndSettle();
  }

  testWidgets('muestra Pendiente cuando no hay importes', (tester) async {
    await _pumpPage(tester);

    expect(find.text('Pendiente').first, findsOneWidget);
    expect(find.text('Cuadrada'), findsNothing);
  });

  testWidgets('muestra Cuadrada cuando los importes cuadran', (tester) async {
    const summary = ComercialLiquidacionSummary(totalAIngresar: 200);
    await _pumpPage(tester, summary: summary);
    await fillBalanced(tester);

    expect(find.text('Cuadrada').first, findsOneWidget);
    expect(find.text('Descuadre'), findsNothing);
  });

  testWidgets('muestra Descuadre con formato es_ES', (tester) async {
    const summary = ComercialLiquidacionSummary(totalAIngresar: 200);
    await _pumpPage(tester, summary: summary);

    await tester.enterText(find.byType(TextFormField).at(0), '1.234,56');
    await tester.enterText(find.byType(TextFormField).at(1), '100');
    await tester.pumpAndSettle();

    expect(find.text('Descuadre').first, findsOneWidget);
    expect(find.text('Revisar'), findsNothing);
  });

  testWidgets('muestra Revisar con formato invalido', (tester) async {
    await _pumpPage(tester);

    await tester.enterText(find.byType(TextFormField).at(0), 'abc');
    await tester.pumpAndSettle();

    expect(find.text('Revisar'), findsNWidgets(2));
    expect(find.text('Introduce un importe válido'), findsOneWidget);
  });

  testWidgets('guardado exitoso llama onSubmit y muestra snackbar',
      (tester) async {
    const summary = ComercialLiquidacionSummary(totalAIngresar: 200);
    final drafts = <ComercialLiquidacionDraft>[];
    await _pumpPage(
      tester,
      summary: summary,
      onSubmit: (draft) async => drafts.add(draft),
    );
    await fillBalanced(tester);

    await tester
        .tap(find.byKey(const ValueKey('comercial-liquidacion-save-button')));
    await tester.pumpAndSettle();

    expect(drafts, hasLength(1));
    expect(drafts.first.registrado, closeTo(200, 0.000001));
    expect(drafts.first.isBalanced, isTrue);
    expect(find.text('Liquidación guardada.'), findsOneWidget);
  });

  testWidgets('error en onSubmit no crashea ni marca guardado', (tester) async {
    const summary = ComercialLiquidacionSummary(totalAIngresar: 200);
    var calls = 0;
    await _pumpPage(
      tester,
      summary: summary,
      onSubmit: (draft) async {
        calls++;
        throw StateError('db down');
      },
    );
    await fillBalanced(tester);

    await tester
        .tap(find.byKey(const ValueKey('comercial-liquidacion-save-button')));
    await tester.pump(const Duration(milliseconds: 400));

    expect(calls, 1);
    expect(find.text('Liquidación guardada.'), findsNothing);
    expect(find.text('Guardar'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
