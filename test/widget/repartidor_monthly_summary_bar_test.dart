import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/widgets/repartidor_monthly_summary_bar.dart';

void main() {
  Widget subject(RepartidorMonthlySummaryLoader loader) {
    return MaterialApp(
      home: Scaffold(
        body: RepartidorMonthlySummaryBar(
          repartidorId: '94',
          loader: loader,
        ),
      ),
    );
  }

  RepartidorMonthlySummary summary({
    double totalCobrado = 0,
    double totalLiquidado = 0,
    double saldoPendiente = 0,
    int liquidacionesCount = 0,
  }) {
    return RepartidorMonthlySummary(
      repartidorId: '94',
      period: const RepartidorFinancialPeriod(year: 2026, month: 4),
      totalCobrado: totalCobrado,
      totalLiquidado: totalLiquidado,
      saldoPendiente: saldoPendiente,
      cobrosCount: 3,
      liquidacionesCount: liquidacionesCount,
      liquidaciones: liquidacionesCount == 0
          ? const []
          : const [
              RepartidorMonthlyLiquidacion(
                idempotencyToken: 'liq_94_20260423',
                date: '2026-04-23',
                totalLiquidado: 300,
              ),
            ],
    );
  }

  testWidgets('renders populated monthly aggregates', (tester) async {
    await tester.pumpWidget(
      subject(
        (repartidorId, year, month) async {
          expect(repartidorId, '94');
          expect(year, DateTime.now().year);
          expect(month, DateTime.now().month);
          return summary(
            totalCobrado: 350,
            totalLiquidado: 300,
            saldoPendiente: 50,
            liquidacionesCount: 1,
          );
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Acumulado de abril'), findsOneWidget);
    expect(find.text('Cobrado'), findsOneWidget);
    expect(find.text('Liquidado'), findsOneWidget);
    expect(find.text('Pendiente'), findsOneWidget);
    expect(find.text('1 cierres'), findsOneWidget);
    expect(find.text('350€'), findsOneWidget);
    expect(find.text('300€'), findsOneWidget);
    expect(find.text('50€'), findsOneWidget);
  });

  testWidgets('hides an empty monthly summary', (tester) async {
    await tester.pumpWidget(subject((_, __, ___) async => summary()));
    await tester.pumpAndSettle();

    expect(find.text('Cobrado'), findsNothing);
    expect(find.text('Resumen mensual no disponible'), findsNothing);
  });

  testWidgets('shows a compact unavailable state on 503', (tester) async {
    await tester.pumpWidget(
      subject(
        (_, __, ___) async {
          throw Exception('503 REPARTO_SCHEMA_UNAVAILABLE');
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Resumen mensual no disponible'), findsOneWidget);
    expect(find.byIcon(Icons.cloud_off), findsOneWidget);
  });
}
