import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/presentation/pages/comercial_liquidacion_diaria_page.dart';
import 'package:intl/intl.dart';

void main() {
  final money = NumberFormat.currency(locale: 'es_ES', symbol: '€');

  /// Verified fixture: comercial 72, 2026-06-27, liquidación 91
  ComercialLiquidacionSummary ref72Summary() {
    return const ComercialLiquidacionSummary(
      totalEfectivo: 844.29,
      totalTarjeta: 568.89,
      totalCobrosDia: 1413.18,
      totalCheques: 0,
      totalPostdatados: 0,
      saldoActual: -1.69,
      totalAIngresar: 842.60,
    );
  }

  Widget buildPage({
    ComercialLiquidacionSummary? summary,
    FutureOr<void> Function(ComercialLiquidacionDraft draft)? onSubmit,
  }) {
    return ProviderScope(
      child: MaterialApp(
        theme: AppTheme.darkTheme,
        home: ComercialLiquidacionDiariaPage(
          employeeCode: '72',
          initialSummary: summary ?? ref72Summary(),
          onSubmit: onSubmit,
        ),
      ),
    );
  }

  group('ComercialLiquidacionDiariaPage', () {
    testWidgets('populated state shows efectivo, saldo and total a ingresar',
        (tester) async {
      await tester.pumpWidget(buildPage(summary: ref72Summary()));

      expect(find.text('Total efectivo'), findsOneWidget);
      expect(find.text('Total cheques'), findsOneWidget);
      expect(find.text('Total postdatados'), findsOneWidget);
      expect(find.text('Saldo actual'), findsOneWidget);
      expect(find.text(money.format(844.29)), findsOneWidget);
      expect(find.text(money.format(0)), findsWidgets);
      expect(find.text(money.format(-1.69)), findsOneWidget);
      expect(find.text(money.format(842.60)), findsWidgets);
    });

    testWidgets(
      'populated state shows tarjeta and total cobros aggregate',
      (tester) async {
        await tester.pumpWidget(buildPage(summary: ref72Summary()));

        expect(find.text('Total tarjeta'), findsOneWidget);
        expect(find.text(money.format(568.89)), findsOneWidget);
        expect(find.text('Total cobros'), findsOneWidget);
        expect(find.text(money.format(1413.18)), findsOneWidget);
      },
    );

    testWidgets('shows banco and delta after valid bank input', (tester) async {
      await tester.pumpWidget(buildPage(summary: ref72Summary()));

      await tester.enterText(find.byType(TextFormField).at(0), '840');
      await tester.enterText(find.byType(TextFormField).at(1), '0');
      await tester.pump();

      expect(find.text('Banco'), findsWidgets);
      expect(find.text(money.format(840)), findsWidgets);
      expect(find.text(money.format(2.60)), findsOneWidget);
      expect(find.text('Descuadre'), findsWidgets);
    });

    testWidgets('save stays enabled with descuadre when amounts parse',
        (tester) async {
      await tester.pumpWidget(buildPage(summary: ref72Summary()));

      await tester.enterText(find.byType(TextFormField).at(0), '840');
      await tester.enterText(find.byType(TextFormField).at(1), '0');
      await tester.pump();

      final button = tester.widget<ButtonStyleButton>(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      expect(button.onPressed, isNotNull);
      expect(find.text('Revisar'), findsWidgets);
    });

    testWidgets('save disabled for invalid money input', (tester) async {
      await tester.pumpWidget(buildPage(summary: ref72Summary()));

      await tester.enterText(find.byType(TextFormField).first, 'abc');
      await tester.pump();

      final button = tester.widget<ButtonStyleButton>(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      expect(button.onPressed, isNull);
      expect(find.text('Revisar'), findsWidgets);
    });

    testWidgets('save disabled for negative money input', (tester) async {
      await tester.pumpWidget(buildPage(summary: ref72Summary()));

      await tester.enterText(find.byType(TextFormField).at(0), '-10');
      await tester.enterText(find.byType(TextFormField).at(1), '0');
      await tester.pump();

      final button = tester.widget<ButtonStyleButton>(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      expect(button.onPressed, isNull);
      expect(find.text('Revisar'), findsWidgets);
    });

    testWidgets('save disabled when bank and entregado fields are empty',
        (tester) async {
      await tester.pumpWidget(buildPage(summary: ref72Summary()));

      final button = tester.widget<ButtonStyleButton>(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets(
        'save enabled when banco plus entregado balances totalAIngresar',
        (tester) async {
      await tester.pumpWidget(buildPage(summary: ref72Summary()));

      await tester.enterText(find.byType(TextFormField).at(0), '837,40');
      await tester.enterText(find.byType(TextFormField).at(1), '5,20');
      await tester.pump();

      final button = tester.widget<ButtonStyleButton>(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      expect(button.onPressed, isNotNull);
      expect(find.text('Cuadrada'), findsWidgets);
    });

    testWidgets('onSubmit receives entregado and ingreso banco values',
        (tester) async {
      ComercialLiquidacionDraft? captured;

      await tester.pumpWidget(
        buildPage(
          summary: ref72Summary(),
          onSubmit: (draft) async {
            captured = draft;
          },
        ),
      );

      await tester.enterText(find.byType(TextFormField).at(0), '840');
      await tester.enterText(find.byType(TextFormField).at(1), '2,60');
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(captured, isNotNull);
      expect(captured!.ingresoBanco, closeTo(840, 0.01));
      expect(captured!.entregado, closeTo(2.60, 0.01));
      expect(captured!.expectedTotal, closeTo(842.60, 0.01));
      expect(captured!.employeeCode, '72');
    });

    testWidgets('shows loading state while onSubmit is in flight',
        (tester) async {
      final completer = Completer<void>();

      await tester.pumpWidget(
        buildPage(
          summary: ref72Summary(),
          onSubmit: (_) => completer.future,
        ),
      );

      await tester.enterText(find.byType(TextFormField).at(0), '840');
      await tester.enterText(find.byType(TextFormField).at(1), '2,60');
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      await tester.pump();

      expect(find.text('Guardando'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      completer.complete();
      await tester.pumpAndSettle();
    });

    testWidgets(
      'save disabled when only one money field is filled',
      (tester) async {
        await tester.pumpWidget(buildPage(summary: ref72Summary()));

        await tester.enterText(find.byType(TextFormField).at(0), '840');
        await tester.pump();

        final button = tester.widget<ButtonStyleButton>(
          find.byKey(const ValueKey('comercial-liquidacion-save-button')),
        );
        expect(button.onPressed, isNull);
      },
    );

    testWidgets('re-enables save after onSubmit throws', (tester) async {
      var calls = 0;

      await tester.pumpWidget(
        buildPage(
          summary: ref72Summary(),
          onSubmit: (_) async {
            calls += 1;
            throw StateError('API 500');
          },
        ),
      );

      await tester.enterText(find.byType(TextFormField).at(0), '840');
      await tester.enterText(find.byType(TextFormField).at(1), '2,60');
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(calls, 1);
      expect(find.text('Guardando'), findsNothing);

      final button = tester.widget<ButtonStyleButton>(
        find.byKey(const ValueKey('comercial-liquidacion-save-button')),
      );
      expect(button.onPressed, isNotNull);
    });

    testWidgets(
      'loading state via provider surface',
      skip: true, // covered in comercial_liquidacion_provider_surface_test.dart
      (tester) async {
        await tester.pumpWidget(buildPage());
        expect(
          find.byKey(const ValueKey('comercial-liquidacion-loading')),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'error state via provider surface',
      skip: true, // covered in comercial_liquidacion_provider_surface_test.dart
      (tester) async {
        await tester.pumpWidget(buildPage());
        expect(
          find.byKey(const ValueKey('comercial-liquidacion-error')),
          findsOneWidget,
        );
        expect(find.text('No se pudo cargar la liquidación'), findsOneWidget);
      },
    );
  });
}
