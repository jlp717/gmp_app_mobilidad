import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/comisiones_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/vencimientos_page.dart';

void main() {
  Widget wrap(Widget child, List<Override> overrides) {
    return ProviderScope(
      overrides: overrides,
      child: MaterialApp(home: child),
    );
  }

  testWidgets('invalid vencimiento is explicit and excluded from próximos', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: VencimientosPage(
          vencimientos: const [
            VencimientoItem(
              cliente: 'Cliente sin fecha',
              documento: 'A-1',
              fecha: null,
              importe: 10,
              estado: VencimientoEstado.sinFecha,
            ),
          ],
        ),
      ),
    );

    expect(find.text('Sin fecha válida'), findsWidgets);
    await tester.tap(find.text('Proximos'));
    await tester.pumpAndSettle();
    expect(find.text('Cliente sin fecha'), findsNothing);
  });

  testWidgets('commission progress is clamped to one', (tester) async {
    final now = DateTime.now();
    final args = (
      repartidorId: '94',
      from: DateTime(now.year, now.month),
      to: DateTime(now.year, now.month + 1, 0),
      forceRefresh: false,
    );
    await tester.pumpWidget(
      wrap(const RepartidorComisionesFinanzasPage(repartidorId: '94'), [
        repartidorCommissionSummaryProvider(args).overrideWith(
          (ref) async => RepartidorCommissionSummary(
            repartidorId: '94',
            deliveredAmount: 100,
            collectedAmount: 250,
            collectedPct: 250,
            commission: 1,
          ),
        ),
        repartidorCommissionTiersProvider.overrideWith(
          (ref) async => const [
            RepartidorCommissionTier(
              thresholdPct: 20,
              commissionPct: 1,
              sortOrder: 1,
            ),
          ],
        ),
      ]),
    );
    await tester.pumpAndSettle();

    final indicator = tester.widget<LinearProgressIndicator>(
      find.byType(LinearProgressIndicator).last,
    );
    expect(indicator.value, 1);
  });

  testWidgets('empty commission tiers have an explicit retry state', (
    tester,
  ) async {
    final now = DateTime.now();
    final args = (
      repartidorId: '94',
      from: DateTime(now.year, now.month),
      to: DateTime(now.year, now.month + 1, 0),
      forceRefresh: false,
    );
    await tester.pumpWidget(
      wrap(const RepartidorComisionesFinanzasPage(repartidorId: '94'), [
        repartidorCommissionSummaryProvider(args).overrideWith(
          (ref) async => RepartidorCommissionSummary(
            repartidorId: '94',
            deliveredAmount: 0,
            collectedAmount: 0,
            collectedPct: 0,
            commission: 0,
          ),
        ),
        repartidorCommissionTiersProvider.overrideWith((ref) async => const []),
      ]),
    );
    await tester.pumpAndSettle();

    expect(find.text('No hay tramos de comisión configurados'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
  });
}
