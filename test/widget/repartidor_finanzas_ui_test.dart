import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/comisiones_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/liquidacion_diaria_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/vencimientos_page.dart';

void main() {
  Widget wrap(Widget child, {List<Override> overrides = const []}) {
    return ProviderScope(
      overrides: overrides,
      child: MaterialApp(home: child),
    );
  }

  testWidgets('liquidacion diaria renders financial totals and inputs',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (
      repartidorId: '94',
      date: date,
      forceRefresh: false,
    );

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(repartidorId: '94'),
        overrides: [
          repartidorDailySummaryProvider(args).overrideWith(
            (ref) async => RepartidorDailySummary(
              repartidorId: '94',
              date: '2026-04-24',
              totalEfectivo: 222.79,
              totalCheques: 0,
              totalTarjeta: 0,
              totalPostdatados: 0,
              saldoActual: 4.81,
              totalCobrosDia: 222.79,
              gastos: 0,
              totalAIngresar: 227.60,
              cobrosCount: 2,
            ),
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Liquidacion Diaria'), findsOneWidget);
    expect(find.text('Total efectivo'), findsWidgets);
    expect(find.text('Ingreso en banco'), findsOneWidget);
    expect(find.text('Entregado'), findsOneWidget);
  });

  testWidgets('liquidacion diaria validates required money fields',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (
      repartidorId: '94',
      date: date,
      forceRefresh: false,
    );

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(repartidorId: '94'),
        overrides: [
          repartidorDailySummaryProvider(args).overrideWith(
            (ref) async => RepartidorDailySummary(
              repartidorId: '94',
              date: '2026-04-24',
              totalEfectivo: 0,
              totalCheques: 0,
              totalTarjeta: 0,
              totalPostdatados: 0,
              saldoActual: 0,
              totalCobrosDia: 0,
              gastos: 0,
              totalAIngresar: 0,
              cobrosCount: 0,
            ),
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Grabar'));
    await tester.pumpAndSettle();

    expect(find.text('Obligatorio'), findsNWidgets(2));
  });

  testWidgets('vencimientos can be filtered by group', (tester) async {
    await tester.pumpWidget(
      wrap(
        VencimientosPage(
          vencimientos: [
            VencimientoItem(
              cliente: 'Cliente vencido',
              documento: 'A-1',
              fecha: DateTime(2026, 4, 20),
              importe: 100,
              estado: VencimientoEstado.vencido,
            ),
            VencimientoItem(
              cliente: 'Cliente futuro',
              documento: 'B-1',
              fecha: DateTime(2026, 5, 2),
              importe: 200,
              estado: VencimientoEstado.proximo,
            ),
          ],
        ),
      ),
    );

    expect(find.text('Vencimientos'), findsOneWidget);
    expect(find.text('Cliente vencido'), findsOneWidget);
    expect(find.text('Cliente futuro'), findsOneWidget);

    await tester.tap(find.text('Vencidos'));
    await tester.pumpAndSettle();

    expect(find.text('Cliente vencido'), findsOneWidget);
    expect(find.text('Cliente futuro'), findsNothing);
  });

  testWidgets('comisiones displays summary and editable tiers', (tester) async {
    final now = DateTime.now();
    final summaryArgs = (
      repartidorId: '94',
      from: DateTime(now.year, now.month),
      to: DateTime(now.year, now.month + 1, 0),
      forceRefresh: false,
    );

    await tester.pumpWidget(
      wrap(
        const RepartidorComisionesFinanzasPage(repartidorId: '94'),
        overrides: [
          repartidorCommissionSummaryProvider(summaryArgs).overrideWith(
            (ref) async => RepartidorCommissionSummary(
              repartidorId: '94',
              deliveredAmount: 80000,
              collectedAmount: 20000,
              collectedPct: 25,
              commission: 20,
              reached: const [
                RepartidorCommissionReachedTier(
                  thresholdPct: 20,
                  commissionPct: 0.5,
                  thresholdAmount: 16000,
                  excess: 4000,
                  commission: 20,
                ),
              ],
            ),
          ),
          repartidorCommissionTiersProvider.overrideWith(
            (ref) async => const [
              RepartidorCommissionTier(
                thresholdPct: 20,
                commissionPct: 0.5,
                sortOrder: 1,
              ),
            ],
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Comisiones'), findsOneWidget);
    expect(find.text('20,00 EUR'), findsWidgets);
    expect(find.text('Configuracion de tramos'), findsOneWidget);
    expect(find.text('Umbral'), findsOneWidget);
  });
}
