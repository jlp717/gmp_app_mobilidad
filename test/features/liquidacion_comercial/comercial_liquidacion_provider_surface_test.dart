import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/data/comercial_liquidacion_service.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/presentation/pages/comercial_liquidacion_diaria_page.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/providers/comercial_liquidacion_provider.dart';
import 'package:intl/intl.dart';

void main() {
  final money = NumberFormat.currency(locale: 'es_ES', symbol: '€');

  Widget buildLivePage({List<Override> overrides = const []}) {
    return ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        theme: AppTheme.darkTheme,
        home: const ComercialLiquidacionDiariaPage(employeeCode: '72'),
      ),
    );
  }

  group('ComercialLiquidacion provider surface', () {
    testWidgets(
      'shows loading indicator while summary fetch is in flight',
      (tester) async {
        await tester.pumpWidget(
          buildLivePage(
            overrides: [
              comercialLiquidacionSummaryProvider.overrideWith(
                (ref, query) => Completer<ComercialLiquidacionSummary>().future,
              ),
            ],
          ),
        );
        await tester.pump();

        expect(
          find.byKey(const ValueKey('comercial-liquidacion-loading')),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'shows error panel with retry when summary fetch fails',
      (tester) async {
        await tester.pumpWidget(
          buildLivePage(
            overrides: [
              comercialLiquidacionSummaryProvider.overrideWith(
                (ref, query) async {
                  throw const ComercialLiquidacionException(
                    'No se pudo cargar la liquidación',
                  );
                },
              ),
            ],
          ),
        );
        await tester.pumpAndSettle();

        expect(
          find.byKey(const ValueKey('comercial-liquidacion-error')),
          findsOneWidget,
        );
        expect(find.text('No se pudo cargar la liquidación'), findsOneWidget);
      },
    );

    testWidgets(
      'shows tarjeta and total cobros metrics from DSEDAC.LQD summary',
      (tester) async {
        await tester.pumpWidget(
          buildLivePage(
            overrides: [
              comercialLiquidacionSummaryProvider.overrideWith(
                (ref, query) async => const ComercialLiquidacionSummary(
                  totalEfectivo: 844.29,
                  totalTarjeta: 568.89,
                  totalCobrosDia: 1413.18,
                  totalCheques: 0,
                  totalPostdatados: 0,
                  saldoActual: -1.69,
                  liquidacionNumero: 91,
                  totalAIngresar: 842.60,
                ),
              ),
            ],
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Total tarjeta'), findsOneWidget);
        expect(find.text(money.format(568.89)), findsOneWidget);
        expect(find.text('Total cobros'), findsOneWidget);
        expect(find.text(money.format(1413.18)), findsOneWidget);
      },
    );
  });
}
