import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

RepartidorLiquidacionResult _closedResult() => RepartidorLiquidacionResult(
      created: true,
      id: '701',
      marker: 'marker-701',
      repartidorId: '08',
      date: '2026-08-19',
      status: 'CLOSED',
      snapshot: RepartidorLiquidacionSnapshot(
        deliveries: 100,
        payments: 100,
        expenses: 0,
        adjustments: 0,
        bankDeposits: 0,
        pending: 0,
        openingBalance: 0,
        balance: 100,
      ),
    );

void main() {
  test('loads the immutable PDF with the close token and validates identity',
      () async {
    String? endpoint;
    Map<String, String>? query;
    final service = RepartidorFinanzasService(
      liquidacionGet: (path, {queryParameters}) async {
        endpoint = path;
        query = queryParameters;
        return <String, dynamic>{
          'success': true,
          'pdfBase64': base64Encode(utf8.encode('%PDF-1.7')),
          'fileName': 'Liquidacion_701.pdf',
          'liquidacionId': '701',
          'repartidorId': '08',
          'date': '2026-08-19',
          'status': 'CLOSED',
        };
      },
    );

    final pdf = await service.getClosedLiquidacionPdf(
      liquidacion: _closedResult(),
      idempotencyToken: 'liquidacion-close-20260819-08',
    );

    expect(
      endpoint,
      '/repartidor-finanzas/liquidaciones/liquidacion-close-20260819-08/pdf',
    );
    expect(query, <String, String>{'repartidorId': '08'});
    expect(pdf.fileName, 'Liquidacion_701.pdf');
    expect(pdf.bytes, orderedEquals(utf8.encode('%PDF-1.7')));
  });

  test('rejects a PDF response for another closed operation', () async {
    final service = RepartidorFinanzasService(
      liquidacionGet: (_, {queryParameters}) async => <String, dynamic>{
        'success': true,
        'pdfBase64': base64Encode(utf8.encode('%PDF-1.7')),
        'fileName': 'Liquidacion_702.pdf',
        'liquidacionId': '702',
        'repartidorId': '08',
        'date': '2026-08-19',
        'status': 'CLOSED',
      },
    );

    await expectLater(
      service.getClosedLiquidacionPdf(
        liquidacion: _closedResult(),
        idempotencyToken: 'liquidacion-close-20260819-08',
      ),
      throwsA(isA<RepartidorLiquidacionContractException>()),
    );
  });
}
