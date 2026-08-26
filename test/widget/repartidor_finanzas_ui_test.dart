import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/comisiones_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/liquidacion_diaria_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/pages/vencimientos_page.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/providers/repartidor_finanzas_providers.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('es_ES');
  });

  Widget wrap(Widget child, {List<Override> overrides = const []}) {
    return ProviderScope(
      overrides: overrides,
      child: MaterialApp(home: child),
    );
  }

  const openLedger = RepartidorLiquidacionLedger(
    status: 'OPEN',
    expenses: [],
    adjustments: [],
    bankDeposits: [],
    expensesTotal: 0,
    adjustmentsTotal: 0,
    bankDepositsTotal: 0,
  );

  testWidgets('liquidacion diaria renders executive ERP layout',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (
      repartidorId: '94',
      date: date,
      forceRefresh: true,
    );

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(
          repartidorId: '94',
          showMonthlySummary: false,
        ),
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
              cobros: const [
                RepartidorCobroDia(
                  fecha: '2026-04-24',
                  codigoCliente: '4300001119',
                  nombreCliente: 'CARNICERIA MECA',
                  tipoCobro: 'E',
                  tipoDocumento: 'FAC',
                  documento: 'FAC-001',
                  importe: 100,
                  cobrado: 100,
                  pendiente: 0,
                ),
              ],
            ),
          ),
          repartidorLiquidacionLedgerProvider(
            (
              repartidorId: '94',
              date: date,
            ),
          ).overrideWith((ref) async => openLedger),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Liquidación Diaria'), findsOneWidget);
    expect(find.text('COBROS DE LA LIQUIDACIÓN'), findsOneWidget);
    expect(find.text('RESUMEN TESORERÍA'), findsOneWidget);
    expect(find.text('Total Efectivo'), findsOneWidget);
    expect(find.text('Total repartido'), findsOneWidget);
    expect(find.text('Deuda pendiente'), findsOneWidget);
    expect(find.text('Ingreso en Banco'), findsOneWidget);
    expect(find.text('TOTAL'), findsOneWidget);
    expect(find.text('Cerrar día y grabar liquidación'), findsOneWidget);
    expect(find.text('Cliente'), findsWidgets);
  });

  testWidgets('liquidacion diaria validates required money fields',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (
      repartidorId: '94',
      date: date,
      forceRefresh: true,
    );

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(
          repartidorId: '94',
          showMonthlySummary: false,
        ),
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
          repartidorLiquidacionLedgerProvider(
            (
              repartidorId: '94',
              date: date,
            ),
          ).overrideWith((ref) async => openLedger),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Ingreso banco'));
    await tester.tap(find.text('Ingreso banco'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Registrar'));
    await tester.pumpAndSettle();

    expect(find.textContaining('importe positivo'), findsOneWidget);
    expect(find.text('Este campo es obligatorio.'), findsOneWidget);
  });

  testWidgets('liquidacion diaria renders aggregate readonly totals',
      (tester) async {
    final now = DateTime.now();
    final date = DateTime(now.year, now.month, now.day);
    final args = (
      repartidorId: '94,95',
      date: date,
      forceRefresh: true,
    );

    await tester.pumpWidget(
      wrap(
        const RepartidorLiquidacionDiariaPage(repartidorId: '94,95'),
        overrides: [
          repartidorDailySummaryProvider(args).overrideWith(
            (ref) async => RepartidorDailySummary(
              repartidorId: '94,95',
              date: '2026-04-24',
              totalEfectivo: 300,
              totalCheques: 0,
              totalTarjeta: 50,
              totalPostdatados: 0,
              saldoActual: 25,
              totalCobrosDia: 350,
              gastos: 0,
              totalAIngresar: 375,
              cobrosCount: 3,
            ),
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Selecciona un repartidor para liquidar'), findsNothing);
    expect(find.text('Liquidación Diaria'), findsOneWidget);
    expect(find.text('Cerrar día y grabar liquidación'), findsNothing);
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

  test('cobros search matches client and document', () {
    const items = [
      VencimientoItem(
        cliente: 'Cliente Norte',
        codigoCliente: '4300001119',
        nombreCliente: 'Cliente Norte',
        documento: 'E 2026-B-A-001-000123-01',
        fecha: null,
        importe: 10,
        estado: VencimientoEstado.vencido,
      ),
      VencimientoItem(
        cliente: 'Cliente Sur',
        codigoCliente: '4300002228',
        nombreCliente: 'Cliente Sur',
        documento: 'E 2026-B-A-001-000456-01',
        fecha: null,
        importe: 20,
        estado: VencimientoEstado.proximo,
      ),
    ];

    expect(filterVencimientosBySearch(items, '4300002228'), hasLength(1));
    expect(filterVencimientosBySearch(items, '000123'), hasLength(1));
    expect(filterVencimientosBySearch(items, 'cliente'), hasLength(2));
  });

  testWidgets('repartidor vencimientos exposes abonar action', (tester) async {
    final now = DateTime.now();
    final from = DateTime(now.year, now.month, now.day).subtract(
      const Duration(days: 180),
    );
    final to = DateTime(now.year, now.month, now.day).add(
      const Duration(days: 180),
    );
    final args = (
      repartidorId: '94',
      from: from,
      to: to,
      clientCode: null as String?,
      search: null as String?,
      estado: null as String?,
      cursor: null as String?,
      limit: 100,
      forceRefresh: false,
    );

    await tester.pumpWidget(
      wrap(
        const RepartidorVencimientosPage(repartidorId: '94'),
        overrides: [
          repartidorVencimientosProvider(args).overrideWith(
            (ref) async => RepartidorVencimientosBatch(
              items: [
                RepartidorVencimiento(
                  tipoDocumento: 'CAC',
                  codigoCliente: '4300001119',
                  nombreCliente: 'CARNICERIA MECA',
                  fechaVencimiento: DateTime(now.year, now.month, now.day)
                      .toIso8601String()
                      .substring(0, 10),
                  documento: 'E 2026-B-I-010-002730-01',
                  importe: 73.19,
                  importePendiente: 40,
                  keys: const {
                    'tipoDocumento': 'CAC',
                    'origenDocumento': 'B',
                    'subempresaDocumento': 'GMP',
                    'ejercicioDocumento': 2026,
                    'serieDocumento': 'I',
                    'terminalDocumento': 10,
                    'numeroDocumento': 2730,
                    'xdeDocumento': 1,
                    'dexDocumento': 1,
                  },
                ),
              ],
              total: 1,
              hasMore: false,
              nextCursor: null,
            ),
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.textContaining('CARNICERIA MECA'));
    await tester.pumpAndSettle();

    expect(find.text('Abonar'), findsOneWidget);
  });

  testWidgets('comisiones displays summary and commercial-style table',
      (tester) async {
    final summary = RepartidorCommissionSummary(
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
    );
    const tiers = [
      RepartidorCommissionTier(
        thresholdPct: 20,
        commissionPct: 0.5,
        sortOrder: 1,
      ),
    ];

    await tester.pumpWidget(
      wrap(
        const RepartidorComisionesFinanzasPage(repartidorId: '94'),
        overrides: [
          repartidorFinanzasServiceProvider.overrideWith(
            (ref) => _StubFinanzasService(
              commissionSummary: summary,
              commissionTiers: tiers,
            ),
          ),
          repartidorCommissionTiersProvider.overrideWith(
            (ref) async => tiers,
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Comisiones'), findsOneWidget);
    expect(find.textContaining('20,00'), findsWidgets);
    expect(find.text('COBRADO'), findsOneWidget);
    expect(find.text('EXCESO'), findsOneWidget);
    expect(find.text('0.5%'), findsWidgets);
  });

  testWidgets('comisiones accepts aggregate repartidor id', (tester) async {
    final summary = RepartidorCommissionSummary(
      repartidorId: '94,95',
      deliveredAmount: 1000,
      collectedAmount: 275,
      collectedPct: 27.5,
      commission: 0.75,
      reached: const [
        RepartidorCommissionReachedTier(
          thresholdPct: 20,
          commissionPct: 1,
          thresholdAmount: 200,
          excess: 75,
          commission: 0.75,
        ),
      ],
    );
    const tiers = [
      RepartidorCommissionTier(
        thresholdPct: 20,
        commissionPct: 1,
        sortOrder: 1,
      ),
    ];

    await tester.pumpWidget(
      wrap(
        const RepartidorComisionesFinanzasPage(repartidorId: '94,95'),
        overrides: [
          repartidorFinanzasServiceProvider.overrideWith(
            (ref) => _StubFinanzasService(
              commissionSummary: summary,
              commissionTiers: tiers,
            ),
          ),
          repartidorCommissionTiersProvider.overrideWith(
            (ref) async => tiers,
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Selecciona un repartidor para consultar comisiones'),
      findsNothing,
    );
    expect(find.text('Comisiones'), findsOneWidget);
  });

  test('ledger accepts JS timestamps and skips a bad entry', () {
    final ledger = RepartidorLiquidacionLedger.fromJson(
      {
        'repartidorId': '44',
        'date': '2026-08-14',
        'status': 'OPEN',
        'extra': true,
        'expenses': [
          {
            'id': 12,
            'type': 'EXPENSE',
            'repartidorId': '44',
            'date': '2026-08-14',
            'amount': 8.25,
            'category': 'PEAJE',
            'status': 'PENDING',
            'createdAt': '2026-08-14T10:00:00.456Z',
          },
          {
            'id': 'bad',
            'type': 'EXPENSE',
            'repartidorId': '44',
            'date': '2026-08-14',
            'amount': 1,
            'category': 'PEAJE',
            'status': 'PENDING',
            'createdAt': 'not-a-date',
          },
        ],
        'adjustments': [],
        'bankDeposits': [],
        'totals': {'expenses': 99, 'adjustments': 0, 'bankDeposits': 0},
      },
      expectedRepartidorId: '44',
      expectedDate: '2026-08-14',
    );

    expect(ledger.status, 'OPEN');
    expect(ledger.expenses, hasLength(1));
    expect(ledger.expenses.first.id, '12');
    expect(ledger.expensesTotal, 8.25);
  });
}

class _StubFinanzasService extends RepartidorFinanzasService {
  _StubFinanzasService({
    required this.commissionSummary,
    required this.commissionTiers,
  });

  final RepartidorCommissionSummary commissionSummary;
  final List<RepartidorCommissionTier> commissionTiers;

  @override
  Future<RepartidorCommissionSummary> getCommissionSummary({
    required String repartidorId,
    required DateTime from,
    required DateTime to,
    bool forceRefresh = false,
  }) async {
    return commissionSummary;
  }

  @override
  Future<List<RepartidorCommissionTier>> getCommissionTiers({
    bool forceRefresh = false,
  }) async {
    return commissionTiers;
  }
}
