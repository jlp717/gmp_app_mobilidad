import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/comisiones_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/liquidacion_diaria_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/vencimientos_page.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() async => initializeDateFormatting('es_ES'));

  Widget wrap(Widget child, {List<Override> overrides = const []}) {
    return ProviderScope(
      overrides: overrides,
      child: MaterialApp(home: child),
    );
  }

  RepartidorDailySummary summary(String repartidorId) => RepartidorDailySummary(
        repartidorId: repartidorId,
        date: '2026-08-10',
        totalEfectivo: 10,
        totalCheques: 0,
        totalTarjeta: 0,
        totalPostdatados: 0,
        saldoActual: 0,
        totalCobrosDia: 10,
        gastos: 0,
        totalAIngresar: 10,
        cobrosCount: 1,
      );

  RepartidorDailySummary summaryWithReversibleCobro({
    required bool canReverseCobros,
  }) =>
      RepartidorDailySummary(
        repartidorId: '94',
        date: '2026-08-10',
        totalEfectivo: 10,
        totalCheques: 0,
        totalTarjeta: 0,
        totalPostdatados: 0,
        saldoActual: 0,
        totalCobrosDia: 10,
        gastos: 0,
        totalAIngresar: 10,
        cobrosCount: 1,
        canReverseCobros: canReverseCobros,
        cobros: const [
          RepartidorCobroDia(
            id: '1',
            idempotencyToken: 'pay-94-1',
            fecha: '2026-08-10',
            codigoCliente: '4300001119',
            nombreCliente: 'Cliente con cobro',
            tipoCobro: 'EFECTIVO',
            tipoDocumento: 'CAC',
            documento: 'A-1',
            importe: 10,
            cobrado: 10,
            pendiente: 0,
          ),
        ],
      );

  const ledger = RepartidorLiquidacionLedger(
    status: 'OPEN',
    expenses: [],
    adjustments: [],
    bankDeposits: [],
    expensesTotal: 0,
    adjustmentsTotal: 0,
    bankDepositsTotal: 0,
  );

  testWidgets('financial pages require a concrete repartidor identity',
      (tester) async {
    await tester.pumpWidget(
      wrap(
        const Column(
          children: [
            Expanded(child: RepartidorLiquidacionDiariaPage(repartidorId: '')),
            Expanded(child: RepartidorComisionesFinanzasPage(repartidorId: '')),
            Expanded(child: RepartidorVencimientosPage(repartidorId: '')),
          ],
        ),
      ),
    );

    expect(find.text('Selecciona un repartidor para liquidar'), findsOneWidget);
    expect(
      find.text('Selecciona un repartidor para consultar comisiones'),
      findsOneWidget,
    );
    expect(
      find.text('Selecciona un repartidor para consultar vencimientos'),
      findsOneWidget,
    );
  });

  testWidgets('liquidacion keeps a loading state until server summary arrives',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (repartidorId: '94', date: date, forceRefresh: false);
    final ledgerArgs = (repartidorId: '94', date: date);
    final completer = Completer<RepartidorDailySummary>();

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(
          repartidorId: '94',
          showMonthlySummary: false,
        ),
        overrides: [
          repartidorDailySummaryProvider(args)
              .overrideWith((ref) => completer.future),
          repartidorLiquidacionLedgerProvider(ledgerArgs)
              .overrideWith((ref) async => ledger),
        ],
      ),
    );
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    completer.complete(summary('94'));
    await tester.pumpAndSettle();
    expect(find.text('Total a ingresar'), findsOneWidget);
  });

  testWidgets('liquidacion exposes a typed failure and retries the summary',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (repartidorId: '94', date: date, forceRefresh: false);
    final ledgerArgs = (repartidorId: '94', date: date);
    var calls = 0;

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(
          repartidorId: '94',
          showMonthlySummary: false,
        ),
        overrides: [
          repartidorDailySummaryProvider(args).overrideWith((ref) async {
            calls++;
            if (calls == 1) throw const FormatException('invalid contract');
            return summary('94');
          }),
          repartidorLiquidacionLedgerProvider(ledgerArgs)
              .overrideWith((ref) async => ledger),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No se pudo cargar la liquidacion'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);

    await tester.tap(find.text('Reintentar'));
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(find.text('Total a ingresar'), findsOneWidget);
  });

  testWidgets('structured ledger fails closed then exposes actions after retry',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (repartidorId: '94', date: date, forceRefresh: false);
    final ledgerArgs = (repartidorId: '94', date: date);
    var ledgerCalls = 0;

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(
          repartidorId: '94',
          showMonthlySummary: false,
        ),
        overrides: [
          repartidorDailySummaryProvider(args)
              .overrideWith((ref) async => summary('94')),
          repartidorLiquidacionLedgerProvider(ledgerArgs)
              .overrideWith((ref) async {
            ledgerCalls++;
            if (ledgerCalls == 1) throw StateError('ledger unavailable');
            return ledger;
          }),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(
        find.textContaining('No se pudo cargar el desglose'), findsOneWidget);
    expect(find.text('Gasto'), findsNothing);

    await tester.ensureVisible(find.text('Reintentar').last);
    await tester.tap(find.text('Reintentar').last);
    await tester.pumpAndSettle();
    expect(ledgerCalls, 2);
    expect(find.text('Jornada abierta'), findsOneWidget);
    expect(find.text('Gasto'), findsOneWidget);
  });

  testWidgets('structured entry communicates created and replay separately',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (repartidorId: '94', date: date, forceRefresh: false);
    final ledgerArgs = (repartidorId: '94', date: date);
    final service = _EntryResultService([
      _entryResult(created: true, date: date),
      _entryResult(created: false, date: date),
    ]);

    await tester.pumpWidget(wrap(
      const RepartidorLiquidacionDiariaPage(
        repartidorId: '94',
        showMonthlySummary: false,
      ),
      overrides: [
        repartidorDailySummaryProvider(args)
            .overrideWith((ref) async => summary('94')),
        repartidorLiquidacionLedgerProvider(ledgerArgs)
            .overrideWith((ref) async => ledger),
        repartidorFinanzasServiceProvider.overrideWithValue(service),
      ],
    ));
    await tester.pumpAndSettle();

    Future<void> submitExpense() async {
      await tester.ensureVisible(find.text('Gasto'));
      await tester.tap(find.text('Gasto'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).at(0), '12,50');
      await tester.enterText(find.byType(TextFormField).at(1), 'Parking');
      await tester.tap(find.text('Registrar'));
      await tester.pumpAndSettle();
    }

    await submitExpense();
    expect(find.textContaining('Movimiento creado'), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    await submitExpense();
    expect(find.textContaining('resultado anterior'), findsOneWidget);
    expect(service.calls, 2);
  });

  testWidgets('409 keeps intent and asks for ledger reconciliation',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (repartidorId: '94', date: date, forceRefresh: false);
    final ledgerArgs = (repartidorId: '94', date: date);
    final service = _EntryResultService([
      ApiException(
        'raw conflict',
        statusCode: 409,
        code: 'LIQUIDACION_ENTRY_REPLAY_MISMATCH',
      ),
      _entryResult(created: true, date: date),
    ]);

    await tester.pumpWidget(wrap(
      const RepartidorLiquidacionDiariaPage(
        repartidorId: '94',
        showMonthlySummary: false,
      ),
      overrides: [
        repartidorDailySummaryProvider(args)
            .overrideWith((ref) async => summary('94')),
        repartidorLiquidacionLedgerProvider(ledgerArgs)
            .overrideWith((ref) async => ledger),
        repartidorFinanzasServiceProvider.overrideWithValue(service),
      ],
    ));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Gasto'));
    await tester.tap(find.text('Gasto'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).at(0), '12,50');
    await tester.enterText(find.byType(TextFormField).at(1), 'Parking');
    await tester.tap(find.text('Registrar'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Conservamos este intento'), findsOneWidget);
    expect(find.text('Recargar'), findsOneWidget);
    expect(find.textContaining('raw conflict'), findsNothing);

    await tester.pump(const Duration(seconds: 5));
    await tester.ensureVisible(find.text('Gasto'));
    await tester.tap(find.text('Gasto'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).at(0), '12,50');
    await tester.enterText(find.byType(TextFormField).at(1), 'Parking');
    await tester.tap(find.text('Registrar'));
    await tester.pumpAndSettle();

    expect(service.calls, 2);
    expect(service.idempotencyTokens, hasLength(2));
    expect(service.idempotencyTokens[1], service.idempotencyTokens[0]);
    expect(find.textContaining('Movimiento creado'), findsOneWidget);
  });

  testWidgets('503 and offline retries preserve the exact entry token',
      (tester) async {
    for (final error in <ApiException>[
      ApiException('unavailable', statusCode: 503),
      ApiException('offline', statusCode: 0),
    ]) {
      final now = DateTime.now();
      final date = DateTime(now.year, now.month, now.day);
      final args = (repartidorId: '94', date: date, forceRefresh: false);
      final ledgerArgs = (repartidorId: '94', date: date);
      final service = _EntryResultService([
        error,
        _entryResult(created: true, date: date),
      ]);

      await tester.pumpWidget(wrap(
        const RepartidorLiquidacionDiariaPage(
          repartidorId: '94',
          showMonthlySummary: false,
        ),
        overrides: [
          repartidorDailySummaryProvider(args)
              .overrideWith((ref) async => summary('94')),
          repartidorLiquidacionLedgerProvider(ledgerArgs)
              .overrideWith((ref) async => ledger),
          repartidorFinanzasServiceProvider.overrideWithValue(service),
        ],
      ));
      await tester.pumpAndSettle();

      Future<void> submitExpense() async {
        await tester.ensureVisible(find.text('Gasto'));
        await tester.tap(find.text('Gasto'));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextFormField).at(0), '12,50');
        await tester.enterText(find.byType(TextFormField).at(1), 'Parking');
        await tester.tap(find.text('Registrar'));
        await tester.pumpAndSettle();
      }

      await submitExpense();
      await tester.pump(const Duration(seconds: 5));
      await submitExpense();

      expect(service.calls, 2);
      expect(service.idempotencyTokens, hasLength(2));
      expect(service.idempotencyTokens[1], service.idempotencyTokens[0]);
      expect(find.textContaining('Movimiento creado'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    }
  });

  testWidgets('liquidacion close uses exactly one server-authoritative request',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (repartidorId: '94', date: date, forceRefresh: false);
    final ledgerArgs = (repartidorId: '94', date: date);
    final closeCompleter = Completer<LiquidacionTransportResponse>();
    var requests = 0;
    Map<String, dynamic>? payload;
    final isoDate = '${date.year}-${date.month.toString().padLeft(2, '0')}-'
        '${date.day.toString().padLeft(2, '0')}';
    final service = RepartidorFinanzasService(
      liquidacionPost: (_, body) {
        requests++;
        payload = body;
        return closeCompleter.future;
      },
    );

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(
          repartidorId: '94',
          showMonthlySummary: false,
        ),
        overrides: [
          repartidorDailySummaryProvider(args)
              .overrideWith((ref) async => summary('94')),
          repartidorFinanzasServiceProvider.overrideWithValue(service),
          repartidorLiquidacionLedgerProvider(ledgerArgs)
              .overrideWith((ref) async => ledger),
        ],
      ),
    );
    await tester.pumpAndSettle();

    final closeButton = find.byType(ElevatedButton).last;
    final onClose = tester.widget<ElevatedButton>(closeButton).onPressed!;
    onClose();
    onClose();
    await tester.pump();
    expect(requests, 1);
    expect(payload, {
      'repartidorId': '94',
      'date': isoDate,
      'idempotencyToken': buildLiquidacionIdempotencyToken('94', date),
      'sendEmails': false,
    });

    closeCompleter.complete(
      LiquidacionTransportResponse(
        statusCode: 200,
        body: {
          'created': false,
          'liquidacion': {
            'id': 'liq-94',
            'marker': 'liq_94',
            'repartidorId': '94',
            'date': isoDate,
            'status': 'CLOSED',
            'snapshot': {
              'deliveries': 1,
              'payments': 10,
              'expenses': 0,
              'adjustments': 0,
              'pending': 0,
              'balance': 10,
            },
          },
          'outboxIntent': {'id': 'outbox-94'},
        },
      ),
    );
    await tester.pump();
    expect(find.textContaining('Cierre recuperado'), findsOneWidget);
    expect(tester.widget<ElevatedButton>(closeButton).onPressed, isNull);
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets('liquidacion hides reverse action unless backend enables it',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (repartidorId: '94', date: date, forceRefresh: false);
    final ledgerArgs = (repartidorId: '94', date: date);

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(
          repartidorId: '94',
          showMonthlySummary: false,
        ),
        overrides: [
          repartidorDailySummaryProvider(args).overrideWith(
            (ref) async => summaryWithReversibleCobro(
              canReverseCobros: false,
            ),
          ),
          repartidorLiquidacionLedgerProvider(ledgerArgs)
              .overrideWith((ref) async => ledger),
        ],
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Cliente con cobro'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cliente con cobro'));
    await tester.pumpAndSettle();
    expect(find.text('Anular este cobro'), findsNothing);
  });

  testWidgets('liquidacion shows reverse action for explicit capability true',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (repartidorId: '94', date: date, forceRefresh: false);
    final ledgerArgs = (repartidorId: '94', date: date);

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(
          repartidorId: '94',
          showMonthlySummary: false,
        ),
        overrides: [
          repartidorDailySummaryProvider(args).overrideWith(
            (ref) async => summaryWithReversibleCobro(
              canReverseCobros: true,
            ),
          ),
          repartidorLiquidacionLedgerProvider(ledgerArgs)
              .overrideWith((ref) async => ledger),
        ],
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Cliente con cobro'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cliente con cobro'));
    await tester.pumpAndSettle();
    expect(find.text('Anular este cobro'), findsOneWidget);
  });

  testWidgets('vencimientos exposes loading, empty and pagination states',
      (tester) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final from = today.subtract(const Duration(days: 180));
    final to = today.add(const Duration(days: 180));
    final firstArgs = (
      repartidorId: '94',
      from: from,
      to: to,
      clientCode: null as String?,
      estado: null as String?,
      cursor: null as String?,
      limit: 50,
      forceRefresh: false,
    );
    final secondArgs = (
      repartidorId: '94',
      from: from,
      to: to,
      clientCode: null as String?,
      estado: null as String?,
      cursor: 'next-1' as String?,
      limit: 50,
      forceRefresh: false,
    );
    final completer = Completer<RepartidorVencimientosBatch>();
    await tester.pumpWidget(
      wrap(
        const RepartidorVencimientosPage(repartidorId: '94'),
        overrides: [
          repartidorVencimientosProvider(firstArgs)
              .overrideWith((ref) => completer.future),
          repartidorVencimientosProvider(secondArgs).overrideWith(
            (ref) async => RepartidorVencimientosBatch(
              total: 1,
              hasMore: false,
              nextCursor: null,
              items: const [],
            ),
          ),
        ],
      ),
    );
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    completer.complete(
      RepartidorVencimientosBatch(
        total: 1,
        hasMore: true,
        nextCursor: 'next-1',
        items: [
          RepartidorVencimiento(
            tipoDocumento: 'CAC',
            codigoCliente: '4300001119',
            nombreCliente: 'Cliente real',
            fechaVencimiento: today.toIso8601String().substring(0, 10),
            documento: 'A-1',
            importe: 10,
            importePendiente: 10,
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Cliente real'), findsOneWidget);
    expect(find.text('Cargar más'), findsOneWidget);

    await tester.tap(find.text('Cargar más'));
    await tester.pumpAndSettle();
    expect(find.text('Cargar más'), findsNothing);
    expect(find.textContaining('Cliente real'), findsOneWidget);
  });

  testWidgets('vencimientos empty result is explicit instead of fake records',
      (tester) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final args = (
      repartidorId: '94',
      from: today.subtract(const Duration(days: 180)),
      to: today.add(const Duration(days: 180)),
      clientCode: null as String?,
      estado: null as String?,
      cursor: null as String?,
      limit: 50,
      forceRefresh: false,
    );
    await tester.pumpWidget(
      wrap(
        const RepartidorVencimientosPage(repartidorId: '94'),
        overrides: [
          repartidorVencimientosProvider(args).overrideWith(
            (ref) async => RepartidorVencimientosBatch(
              total: 0,
              hasMore: false,
              nextCursor: null,
              items: const [],
            ),
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No hay vencimientos para el filtro'), findsOneWidget);
  });

  testWidgets('comisiones reports a load failure instead of stale values',
      (tester) async {
    final now = DateTime.now();
    final args = (
      repartidorId: '94',
      from: DateTime(now.year, now.month),
      to: DateTime(now.year, now.month + 1, 0),
      forceRefresh: false,
    );
    await tester.pumpWidget(
      wrap(
        const RepartidorComisionesFinanzasPage(repartidorId: '94'),
        overrides: [
          repartidorCommissionSummaryProvider(args)
              .overrideWith((ref) => Future.error(StateError('unavailable'))),
          repartidorCommissionTiersProvider
              .overrideWith((ref) async => const []),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No se pudo cargar el resumen'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
    expect(find.text('0,00 €'), findsNothing);
  });
}

RepartidorLiquidacionEntryResult _entryResult({
  required bool created,
  required DateTime date,
}) =>
    RepartidorLiquidacionEntryResult(
      created: created,
      entry: RepartidorLiquidacionEntry(
        id: 'entry-1',
        type: 'EXPENSE',
        repartidorId: '94',
        date: date.toIso8601String().substring(0, 10),
        amount: 12.5,
        status: 'PENDING',
        detail: 'Parking',
        createdAt: '2026-04-23T10:00:00.000Z',
      ),
    );

class _EntryResultService extends RepartidorFinanzasService {
  _EntryResultService(this.results);
  final List<Object> results;
  final List<String> idempotencyTokens = [];
  int calls = 0;

  @override
  Future<RepartidorLiquidacionEntryResult> createLiquidacionExpense({
    required String repartidorId,
    required DateTime date,
    required double amount,
    required String category,
    required String idempotencyToken,
    String? observation,
  }) async {
    idempotencyTokens.add(idempotencyToken);
    final result = results[calls++];
    if (result is Exception) throw result;
    return result as RepartidorLiquidacionEntryResult;
  }
}
