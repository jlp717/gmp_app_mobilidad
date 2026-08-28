import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/errors/failure.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/finance_error_message.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/liquidacion_diaria_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/providers/repartidor_finanzas_providers.dart';
import 'package:intl/date_symbol_data_local.dart';

const _noCobrosMessage = 'No se puede cerrar la liquidación: '
    'no hay cobros en el periodo seleccionado.';

void main() {
  setUpAll(() => initializeDateFormatting('es_ES'));

  test('maps no-cobros code from API and repository failures', () {
    for (final error in <Object>[
      ApiException('raw', code: 'LIQUIDACION_NO_COBROS', statusCode: 409),
      const ServerFailure(
        'raw',
        code: 'LIQUIDACION_NO_COBROS',
        statusCode: 409,
      ),
    ]) {
      expect(financeErrorMessage(error, 'fallback'), _noCobrosMessage);
    }
    expect(financeErrorMessage(StateError('raw'), 'fallback'), 'fallback');
  });

  for (final openingBalance in <double>[0, 50]) {
    testWidgets(
        'no cobros prevents close and bank deposit; balance $openingBalance',
        (tester) async {
      final actions = _RecordingLiquidacionActions();
      await _pumpPage(
        tester,
        actions,
        openingBalance: openingBalance,
        ingresoBanco: 20,
      );
      await tester.tap(find.text('Cerrar día y grabar liquidación'));
      await tester.pumpAndSettle();

      expect(find.text(_noCobrosMessage), findsOneWidget);
      expect(find.text('Grabando liquidacion...'), findsNothing);
      expect(actions.closeTokens, isEmpty);
      expect(actions.depositCalls, 0);
    });
  }

  for (final hasDetail in <bool>[false, true]) {
    testWidgets('card cobros can close without cash; detail $hasDetail',
        (tester) async {
      final actions = _RecordingLiquidacionActions();
      await _pumpPage(
        tester,
        actions,
        count: hasDetail ? 0 : 1,
        cobros: hasDetail ? const [_cardCobro] : const [],
      );
      await tester.tap(find.text('Cerrar día y grabar liquidación'));
      await tester.pumpAndSettle();

      await tester.pump(const Duration(seconds: 2));
      await tester.pumpAndSettle();
      expect(actions.closeTokens, hasLength(1));
      expect(actions.closeTokens.single, isNotEmpty);
      expect(find.text(_noCobrosMessage), findsNothing);
      expect(actions.depositCalls, 0);
      expect(find.text('Cerrar día y grabar liquidación'), findsNothing);
      expect(find.byTooltip('Ver PDF'), findsOneWidget);
    });
  }

  testWidgets(
      'closed ledger retrieves replay without cobros or another deposit',
      (tester) async {
    final actions = _RecordingLiquidacionActions(isReplay: true);
    await _pumpPage(tester, actions, closedLedger: true, ingresoBanco: 20);
    await tester.tap(find.text('Cerrar día y grabar liquidación'));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(actions.closeTokens, hasLength(1));
    expect(actions.depositCalls, 0);
    expect(find.text(_noCobrosMessage), findsNothing);
    expect(find.byTooltip('Ver PDF'), findsOneWidget);
  });
}

const _cardCobro = RepartidorCobroDia(
  fecha: '2026-08-28',
  codigoCliente: 'CLIENT-1',
  nombreCliente: 'Cliente',
  tipoCobro: 'TJ',
  tipoDocumento: 'FAC',
  documento: 'FAC-1',
  importe: 25,
  cobrado: 25,
  pendiente: 0,
);

Future<void> _pumpPage(
  WidgetTester tester,
  _RecordingLiquidacionActions actions, {
  double openingBalance = 0,
  double ingresoBanco = 0,
  bool closedLedger = false,
  int count = 0,
  List<RepartidorCobroDia> cobros = const [],
}) async {
  tester.view.physicalSize = const Size(800, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final now = DateTime.now();
  final date = DateTime(now.year, now.month, now.day);
  final hasCobros = count > 0 || cobros.isNotEmpty;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        repartidorDailySummaryProvider(
          (
            repartidorId: '94',
            date: date,
            forceRefresh: true,
          ),
        ).overrideWith(
          (ref) async => RepartidorDailySummary(
            repartidorId: '94',
            date: date.toIso8601String().substring(0, 10),
            totalEfectivo: 0,
            totalCheques: 0,
            totalTarjeta: hasCobros ? 25 : 0,
            totalPostdatados: 0,
            saldoActual: openingBalance,
            totalCobrosDia: hasCobros ? 25 : 0,
            gastos: 0,
            totalAIngresar: openingBalance,
            ingresoBanco: ingresoBanco,
            cobrosCount: count,
            cobros: cobros,
          ),
        ),
        repartidorLiquidacionLedgerProvider((repartidorId: '94', date: date))
            .overrideWith(
          (ref) async => RepartidorLiquidacionLedger(
            status: closedLedger ? 'CLOSED' : 'OPEN',
            expenses: [],
            adjustments: [],
            bankDeposits: [],
            expensesTotal: 0,
            adjustmentsTotal: 0,
            bankDepositsTotal: 0,
          ),
        ),
        repartidorLiquidacionActionsProvider.overrideWithValue(actions),
      ],
      child: const MaterialApp(
        home: RepartidorLiquidacionDiariaPage(
          repartidorId: '94',
          showMonthlySummary: false,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Cerrar día y grabar liquidación'));
}

class _RecordingLiquidacionActions extends Fake
    implements RepartidorLiquidacionActions {
  _RecordingLiquidacionActions({this.isReplay = false});

  final bool isReplay;
  final closeTokens = <String>[];
  int depositCalls = 0;

  @override
  Future<RepartidorLiquidacionResult> close({
    required String repartidorId,
    required DateTime date,
    required String idempotencyToken,
    String? matricula,
    String? codigoVehiculo,
    bool sendEmails = true,
  }) async {
    closeTokens.add(idempotencyToken);
    return RepartidorLiquidacionResult(
      created: !isReplay,
      id: '701',
      marker: 'LQD-701',
      repartidorId: repartidorId,
      date: date.toIso8601String().substring(0, 10),
      status: 'CLOSED',
      snapshot: const RepartidorLiquidacionSnapshot(
        deliveries: 0,
        payments: 25,
        expenses: 0,
        adjustments: 0,
        bankDeposits: 0,
        pending: 0,
        openingBalance: 0,
        balance: 0,
      ),
    );
  }

  @override
  Future<RepartidorLiquidacionPdf> getClosedLiquidacionPdf({
    required RepartidorLiquidacionResult liquidacion,
    required String idempotencyToken,
  }) async {
    // PDF rendering is covered separately; no network or platform I/O here.
    throw ApiException('PDF unavailable in this fixture', statusCode: 503);
  }

  @override
  Future<RepartidorLiquidacionEntryResult> createBankDeposit({
    required String repartidorId,
    required DateTime date,
    required double amount,
    required String reference,
    required String idempotencyToken,
    String? observation,
  }) async {
    depositCalls++;
    throw StateError('No bank deposit expected');
  }
}
