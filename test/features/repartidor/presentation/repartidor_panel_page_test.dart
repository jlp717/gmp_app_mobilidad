import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_panel_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

RepartidorMonthlySummary _finance({
  double cobrado = 120,
  double liquidado = 80,
  double pendiente = 40,
}) {
  return RepartidorMonthlySummary(
    repartidorId: '05',
    period: const RepartidorFinancialPeriod(year: 2026, month: 8),
    totalCobrado: cobrado,
    totalLiquidado: liquidado,
    saldoPendiente: pendiente,
    cobrosCount: cobrado == 0 ? 0 : 2,
    liquidacionesCount: liquidado == 0 ? 0 : 1,
  );
}

Map<String, dynamic> _delivery({int total = 1}) {
  return <String, dynamic>{
    'summary': <String, dynamic>{
      'totalAlbaranes': total,
      'entregados': total,
      'noEntregados': 0,
      'pendientes': 0,
      'importeTotal': total * 25.0,
      'pctEntrega': total == 0 ? 0.0 : 100.0,
    },
    'daily': <Map<String, dynamic>>[],
  };
}

void _useWideTestViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1440, 2560);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('shows the real monthly Cobrado Liquidado Pendiente summary', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorPanelPage(
          repartidorId: '05',
          deliverySummaryLoader: ({
            required String repartidorId,
            required int year,
            required int month,
          }) async =>
              _delivery(),
          monthlySummaryLoader: ({
            required String repartidorId,
            required int year,
            required int month,
          }) async =>
              _finance(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Resumen financiero mensual'), findsOneWidget);
    expect(find.text('Cobrado'), findsOneWidget);
    expect(find.text('Liquidado'), findsOneWidget);
    expect(find.text('Pendiente'), findsWidgets);
    expect(find.text(CurrencyFormatter.format(120)), findsOneWidget);
    expect(find.text(CurrencyFormatter.format(80)), findsOneWidget);
    expect(find.text(CurrencyFormatter.format(40)), findsOneWidget);
    expect(find.textContaining('Comisi'), findsNothing);
  });

  testWidgets('keeps successful delivery data visible as a partial result', (
    tester,
  ) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorPanelPage(
          repartidorId: '05',
          deliverySummaryLoader: ({
            required String repartidorId,
            required int year,
            required int month,
          }) async =>
              _delivery(),
          monthlySummaryLoader: ({
            required String repartidorId,
            required int year,
            required int month,
          }) async =>
              throw StateError('finance unavailable'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Datos parciales'), findsOneWidget);
    expect(find.text('Datos financieros no disponibles'), findsOneWidget);
    expect(find.text('Total Albaranes'), findsOneWidget);
    expect(find.text('Sin datos para este periodo'), findsNothing);
  });

  testWidgets('distinguishes an empty period from an error', (tester) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorPanelPage(
          repartidorId: '05',
          deliverySummaryLoader: ({
            required String repartidorId,
            required int year,
            required int month,
          }) async =>
              _delivery(total: 0),
          monthlySummaryLoader: ({
            required String repartidorId,
            required int year,
            required int month,
          }) async =>
              _finance(cobrado: 0, liquidado: 0, pendiente: 0),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Sin datos para este periodo'), findsOneWidget);
    expect(find.textContaining('No se pudieron cargar'), findsNothing);
  });

  testWidgets('shows a retryable error when both sources fail', (tester) async {
    _useWideTestViewport(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: RepartidorPanelPage(
          repartidorId: '05',
          deliverySummaryLoader: ({
            required String repartidorId,
            required int year,
            required int month,
          }) async =>
              throw StateError('delivery unavailable'),
          monthlySummaryLoader: ({
            required String repartidorId,
            required int year,
            required int month,
          }) async =>
              throw StateError('finance unavailable'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.textContaining('No se pudieron cargar los datos del periodo'),
      findsOneWidget,
    );
    expect(find.text('Sin datos para este periodo'), findsNothing);
  });
}
