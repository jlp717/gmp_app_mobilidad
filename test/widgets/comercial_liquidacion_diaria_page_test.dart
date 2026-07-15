import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/presentation/pages/comercial_liquidacion_diaria_page.dart';

void main() {
  Widget buildPage({ComercialLiquidacionSummary? summary}) {
    return ProviderScope(
      child: MaterialApp(
        theme: AppTheme.darkTheme,
        home: ComercialLiquidacionDiariaPage(
          employeeCode: '57',
          initialSummary: summary ?? const ComercialLiquidacionSummary(),
        ),
      ),
    );
  }

  testWidgets('renders commercial daily settlement form', (tester) async {
    await tester.pumpWidget(buildPage());

    expect(find.text('Liquidación diaria'), findsWidgets);
    expect(find.text('Total efectivo'), findsOneWidget);
    expect(find.text('Ingreso en banco'), findsOneWidget);
    expect(find.byType(TextFormField), findsNWidgets(2));
    expect(find.text('Cuadre'), findsOneWidget);

    final button = tester.widget<ButtonStyleButton>(
      find.byKey(const ValueKey('comercial-liquidacion-save-button')),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('enables save and shows balanced state with valid amounts',
      (tester) async {
    await tester.pumpWidget(
      buildPage(
        summary: const ComercialLiquidacionSummary(totalAIngresar: 150),
      ),
    );

    await tester.enterText(find.byType(TextFormField).at(0), '100');
    await tester.enterText(find.byType(TextFormField).at(1), '50');
    await tester.pump();

    expect(find.text('Cuadrada'), findsWidgets);
    final button = tester.widget<ButtonStyleButton>(
      find.byKey(const ValueKey('comercial-liquidacion-save-button')),
    );
    expect(button.onPressed, isNotNull);
  });

  testWidgets('keeps mismatch visible before saving', (tester) async {
    await tester.pumpWidget(
      buildPage(
        summary: const ComercialLiquidacionSummary(totalAIngresar: 100),
      ),
    );

    await tester.enterText(find.byType(TextFormField).first, '20');
    await tester.pump();

    expect(find.text('Descuadre'), findsWidgets);
  });
}
