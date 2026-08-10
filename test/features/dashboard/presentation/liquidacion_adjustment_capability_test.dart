import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/liquidacion_diaria_page.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() => initializeDateFormatting('es_ES'));

  for (final capability in [false, true]) {
    testWidgets(
      capability
          ? 'JEFE capability shows the structured adjustment action'
          : 'REPARTIDOR capability hides the structured adjustment action',
      (tester) async {
        final now = DateTime.now();
        final date = DateTime(now.year, now.month, now.day);
        final summaryArgs = (
          repartidorId: '050',
          date: date,
          forceRefresh: false,
        );
        final ledgerArgs = (repartidorId: '050', date: date);

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              repartidorDailySummaryProvider(summaryArgs).overrideWith(
                (ref) async => RepartidorDailySummary(
                  repartidorId: '050',
                  date: '2026-08-10',
                  totalEfectivo: 10,
                  totalCheques: 0,
                  totalTarjeta: 0,
                  totalPostdatados: 0,
                  saldoActual: 10,
                  totalCobrosDia: 10,
                  gastos: 0,
                  totalAIngresar: 10,
                  cobrosCount: 1,
                ),
              ),
              repartidorLiquidacionLedgerProvider(ledgerArgs).overrideWith(
                (ref) async => const RepartidorLiquidacionLedger(
                  status: 'OPEN',
                  expenses: [],
                  adjustments: [],
                  bankDeposits: [],
                  expensesTotal: 0,
                  adjustmentsTotal: 0,
                  bankDepositsTotal: 0,
                ),
              ),
            ],
            child: MaterialApp(
              home: RepartidorLiquidacionDiariaPage(
                repartidorId: '050',
                showMonthlySummary: false,
                canCreateAdjustments: capability,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Gasto'), findsOneWidget);
        expect(
          find.text('Ajuste'),
          capability ? findsOneWidget : findsNothing,
        );
      },
    );
  }
}
