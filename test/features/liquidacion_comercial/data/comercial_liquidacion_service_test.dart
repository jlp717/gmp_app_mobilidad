import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/money/money.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/data/comercial_liquidacion_service.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/domain/liquidacion_domain.dart';

void main() {
  test('idempotency key changes only after the persisted revision changes', () {
    ComercialLiquidacionDraft draft(String revision) =>
        ComercialLiquidacionDraft.fromMoney(
          employeeCode: '57',
          date: DateTime(2026, 11, 2),
          expectedTotal: Money.fromDouble(200),
          ingresoBanco: Money.fromDouble(120),
          entregado: Money.fromDouble(80),
          expectedRevision: revision,
        );

    final beforeAck = buildLiquidacionIdempotencyKey(
      draft('2026-11-02 10:11:12.123456'),
    );
    expect(
      buildLiquidacionIdempotencyKey(
        draft('2026-11-02 10:11:12.123456'),
      ),
      beforeAck,
    );
    expect(
      buildLiquidacionIdempotencyKey(
        draft('2026-11-02 10:11:13.000002'),
      ),
      isNot(beforeAck),
    );
    expect(beforeAck, isNot(contains(' ')));
  });

  test('parses daily settlement JSON including already-collected returns', () {
    final snapshot = ComercialLiquidacionDailySnapshot.fromJson({
      'date': '2026-05-31',
      'summary': {
        'totalEfectivo': 1000,
        'totalTarjeta': 250,
        'totalTransferencia': 125,
        'totalCheques': 0,
        'totalPostdatados': 0,
        'saldoActual': 0,
        'devolucionesYaCobradas': 1000,
        'totalAIngresar': 0,
      },
      'returns': [
        {
          'documento': 'D-1',
          'cliente': '4300000354',
          'amount': -1000,
          'vendedor': '80',
          'date': '2026-05-31',
          'yaCobrada': true,
        },
      ],
    });

    expect(snapshot.date, '2026-05-31');
    expect(snapshot.summary.totalEfectivo, 1000);
    expect(snapshot.summary.totalTarjetaMoney.toDouble(), 250);
    expect(snapshot.summary.totalTransferenciaMoney.toDouble(), 125);
    expect(snapshot.summary.devolucionesYaCobradas, 1000);
    expect(snapshot.summary.totalAIngresar, 0);
    expect(snapshot.returns.single.documento, 'D-1');
    expect(snapshot.returns.single.amount, -1000);
    expect(snapshot.returns.single.yaCobrada, isTrue);
  });

  test('parses PG formaPago and YA_COBRADOS impact from Devuelve overlay', () {
    final snapshot = ComercialLiquidacionDailySnapshot.fromJson({
      'summary': {'totalAIngresar': 0, 'devolucionesYaCobradas': 1000},
      'returns': [
        {
          'documento': 'D-1',
          'cliente': '4300010001',
          'amount': -1000,
          'yaCobrada': true,
          'formaPago': 'P1',
          'impactoLqd': 'YA_COBRADOS',
          'albaranOrigen': 'P-2-1',
          'vencimiento': '2026-08-31',
          'pendienteTecnicoMovimiento': true,
          'source': 'JAVIER.TEST_DEVOLUCIONES_COMERCIAL',
        },
      ],
    });

    expect(snapshot.returns.single.formaPago, 'P1');
    expect(snapshot.returns.single.impactoLqd, 'YA_COBRADOS');
    expect(snapshot.returns.single.albaranOrigen, 'P-2-1');
    expect(snapshot.returns.single.vencimiento, '2026-08-31');
    expect(snapshot.returns.single.pendienteTecnicoMovimiento, isTrue);
  });

  test('parses saved TEST draft without subtracting returns from LQD', () {
    final snapshot = ComercialLiquidacionDailySnapshot.fromJson({
      'date': '2026-09-11',
      'summary': {
        'totalEfectivo': 800,
        'devolucionesYaCobradas': 400,
        'totalAIngresar': 2500,
        'source': 'DSEDAC.LQD',
      },
      'savedDraft': {
        'vendedor': '80',
        'date': '2026-09-11',
        'ingresoBanco': 100,
        'entregado': 2400,
        'totalEsperado': 2500,
        'revision': '2026-11-02-10.11.12.123456',
      },
      'returns': const [],
    });

    expect(snapshot.summary.totalAIngresar, 2500);
    expect(snapshot.summary.devolucionesYaCobradas, 400);
    expect(snapshot.savedDraft?.ingresoBanco, 100);
    expect(snapshot.savedDraft?.entregado, 2400);
    expect(
      snapshot.savedDraft?.expectedRevision,
      '2026-11-02-10.11.12.123456',
    );
  });
}
