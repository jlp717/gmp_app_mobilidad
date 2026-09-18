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
      await _disposeAndDrain(tester);
    });
  }

  for (final hasDetail in <bool>[false, true]) {
    testWidgets('card cobros can close without cash; detail $hasDetail',
        (tester) async {
      final actions = _RecordingLiquidacionActions();
      final date = await _pumpPage(
        tester,
        actions,
        count: hasDetail ? 0 : 1,
        cobros: hasDetail ? const [_cardCobro] : const [],
      );
      await tester.tap(find.text('Cerrar día y grabar liquidación'));
      await tester.pumpAndSettle();
      expect(actions.closeTokens, isEmpty);
      await tester.tap(find.text('Sí, grabar'));
      await tester.pumpAndSettle();

      await tester.pump(const Duration(seconds: 2));
      await tester.pumpAndSettle();
      expect(actions.closeTokens, hasLength(1));
      expect(actions.closeTokens.single, _expectedToken(date));
      expect(actions.closeSendEmails, [true]);
      expect(find.text(_noCobrosMessage), findsNothing);
      expect(actions.depositCalls, 0);
      expect(find.text('Cerrar día y grabar liquidación'), findsNothing);
      expect(find.byTooltip('Ver PDF'), findsOneWidget);
      await _disposeAndDrain(tester);
    });
  }

  testWidgets(
      'closed ledger retrieves replay without cobros or another deposit',
      (tester) async {
    final actions = _RecordingLiquidacionActions(isReplay: true);
    final date = await _pumpPage(
      tester,
      actions,
      closedLedger: true,
      ingresoBanco: 20,
    );
    _expectClosedReadonly(tester);
    await tester.tap(find.text('Recuperar comprobante'));
    await tester.pumpAndSettle();
    expect(actions.closeTokens, isEmpty);
    await tester.tap(find.text('Recuperar comprobante').last);
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(actions.closeTokens, hasLength(1));
    expect(actions.closeTokens.single, _expectedToken(date));
    expect(actions.closeSendEmails, [false]);
    expect(actions.depositCalls, 0);
    expect(find.text(_noCobrosMessage), findsNothing);
    expect(find.byTooltip('Ver PDF'), findsOneWidget);
    expect(find.text('Recuperar comprobante'), findsNothing);
    _expectClosedReadonly(tester);
    await _disposeAndDrain(tester);
  });

  testWidgets('closed ledger recovery can be cancelled without writes',
      (tester) async {
    final actions = _RecordingLiquidacionActions(isReplay: true);
    await _pumpPage(tester, actions, closedLedger: true, ingresoBanco: 20);
    _expectClosedReadonly(tester);
    await tester.tap(find.text('Recuperar comprobante'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();

    expect(actions.closeTokens, isEmpty);
    expect(actions.closeSendEmails, isEmpty);
    expect(actions.depositCalls, 0);
    expect(find.text('Recuperar comprobante'), findsOneWidget);
    _expectClosedReadonly(tester);
    await _disposeAndDrain(tester);
  });

  testWidgets('closed ledger recovery failure remains retryable and readonly',
      (tester) async {
    final actions = _RecordingLiquidacionActions(
      isReplay: true,
      throwOnClose: true,
    );
    final date = await _pumpPage(
      tester,
      actions,
      closedLedger: true,
      ingresoBanco: 20,
    );
    _expectClosedReadonly(tester);
    await tester.tap(find.text('Recuperar comprobante'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Recuperar comprobante').last);
    await tester.pumpAndSettle();

    expect(actions.closeTokens, hasLength(1));
    expect(actions.closeSendEmails, [false]);
    expect(actions.depositCalls, 0);
    await tester.tap(find.text('Cerrar'));
    await tester.pumpAndSettle();
    expect(find.text('Recuperar comprobante'), findsOneWidget);
    _expectClosedReadonly(tester);
    await tester.tap(find.text('Recuperar comprobante'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Recuperar comprobante').last);
    await tester.pumpAndSettle();
    expect(actions.closeTokens, [_expectedToken(date), _expectedToken(date)]);
    expect(actions.closeSendEmails, [false, false]);
    expect(actions.depositCalls, 0);
    await tester.tap(find.text('Cerrar'));
    await tester.pumpAndSettle();
    _expectClosedReadonly(tester);
    await _disposeAndDrain(tester);
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

Future<DateTime> _pumpPage(
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
  final summary = RepartidorDailySummary(
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
  );

  Future<RepartidorDailySummary> summaryFixture(bool forceRefresh) async {
    expect(summary.repartidorId, '94');
    expect(summary.date, date.toIso8601String().substring(0, 10));
    expect(forceRefresh, isA<bool>());
    return summary;
  }

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        repartidorDailySummaryProvider(
          (
            repartidorId: '94',
            date: date,
            forceRefresh: false,
          ),
        ).overrideWith((ref) => summaryFixture(false)),
        repartidorDailySummaryProvider(
          (
            repartidorId: '94',
            date: date,
            forceRefresh: true,
          ),
        ).overrideWith((ref) => summaryFixture(true)),
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
  await tester.ensureVisible(
    find.text(
      closedLedger
          ? 'Recuperar comprobante'
          : 'Cerrar día y grabar liquidación',
    ),
  );
  return date;
}

String _expectedToken(DateTime date) =>
    'liq_94_${date.toIso8601String().substring(0, 10).replaceAll('-', '')}';

void _expectClosedReadonly(WidgetTester tester) {
  final fields = find.byType(TextField);
  expect(fields, findsOneWidget);
  expect(tester.widget<TextField>(fields).enabled, isFalse);
  for (final action in ['Gasto', 'Ingreso banco', 'Ajuste']) {
    expect(find.text(action), findsNothing);
  }
}

Future<void> _disposeAndDrain(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 12));
}

class _RecordingLiquidacionActions extends Fake
    implements RepartidorLiquidacionActions {
  _RecordingLiquidacionActions({
    this.isReplay = false,
    this.throwOnClose = false,
  });

  final bool isReplay;
  final bool throwOnClose;
  final closeTokens = <String>[];
  final closeSendEmails = <bool>[];
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
    closeSendEmails.add(sendEmails);
    if (throwOnClose) {
      throw ApiException('Replay unavailable in this fixture', statusCode: 503);
    }
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
