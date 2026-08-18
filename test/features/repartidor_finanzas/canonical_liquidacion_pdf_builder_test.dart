import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/canonical_liquidacion_pdf_builder.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

RepartidorLiquidacionResult _result({double balance = 125}) =>
    RepartidorLiquidacionResult(
      created: true,
      id: 'liq-42',
      marker: 'marker-42',
      repartidorId: '08',
      date: '2026-08-18',
      status: 'CLOSED',
      snapshot: RepartidorLiquidacionSnapshot(
        deliveries: 150,
        payments: 100,
        expenses: 20,
        adjustments: -5,
        bankDeposits: 50,
        pending: 0,
        openingBalance: 100,
        balance: balance,
      ),
    );

void main() {
  test('genera un PDF real solo desde una instantanea cerrada que cuadra',
      () async {
    final bytes = await CanonicalLiquidacionPdfBuilder.buildBytes(
      liquidacion: _result(),
    );

    expect(bytes.length, greaterThan(500));
    expect(ascii.decode(bytes.take(4).toList()), '%PDF');
  });

  test('rechaza importes no finitos de la instantanea cerrada', () async {
    await expectLater(
      CanonicalLiquidacionPdfBuilder.buildBytes(
        liquidacion: _result(balance: double.nan),
      ),
      throwsStateError,
    );
  });

  test('bloquea un PDF si la instantanea persistida no cuadra', () async {
    await expectLater(
      CanonicalLiquidacionPdfBuilder.buildBytes(
        liquidacion: _result(balance: 124.99),
      ),
      throwsStateError,
    );
  });

  test('el parser exige saldo inicial e ingresos bancarios del cierre', () {
    expect(
      () => RepartidorLiquidacionResult.fromJson({
        'created': true,
        'liquidacion': {
          'id': 'liq-42',
          'marker': 'marker-42',
          'repartidorId': '08',
          'date': '2026-08-18',
          'status': 'CLOSED',
          'snapshot': {
            'deliveries': 150,
            'payments': 100,
            'expenses': 20,
            'adjustments': -5,
            'pending': 0,
            'balance': 125,
          },
        },
      }),
      throwsFormatException,
    );
  });
}
