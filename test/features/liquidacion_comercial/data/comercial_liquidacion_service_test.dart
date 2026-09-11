import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/data/comercial_liquidacion_service.dart';

void main() {
  test('parses daily settlement JSON including already-collected returns', () {
    final snapshot = ComercialLiquidacionDailySnapshot.fromJson({
      'date': '2026-05-31',
      'summary': {
        'totalEfectivo': 1000,
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
    expect(snapshot.summary.devolucionesYaCobradas, 1000);
    expect(snapshot.summary.totalAIngresar, 0);
    expect(snapshot.returns.single.documento, 'D-1');
    expect(snapshot.returns.single.amount, -1000);
    expect(snapshot.returns.single.yaCobrada, isTrue);
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
      },
      'returns': const [],
    });

    expect(snapshot.summary.totalAIngresar, 2500);
    expect(snapshot.summary.devolucionesYaCobradas, 400);
    expect(snapshot.savedDraft?.ingresoBanco, 100);
    expect(snapshot.savedDraft?.entregado, 2400);
  });
}
