import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/data/comercial_liquidacion_service.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/domain/comercial_liquidacion_models.dart';

void main() {
  group('ComercialLiquidacionService', () {
    test('idempotencyToken matches backend contract for ref 72', () {
      final token = ComercialLiquidacionService.idempotencyToken(
        '72',
        DateTime.parse('2026-06-27'),
      );
      expect(token, 'liq-comercial-20260627-72');
    });

    test('dailySummaryCacheKey is stable per vendor and date', () {
      expect(
        ComercialLiquidacionService.dailySummaryCacheKey('72', '2026-06-27'),
        'comercial_liquidacion_summary_72_2026-06-27',
      );
    });

    test('paths match comercial liquidaciones API contract', () {
      expect(
        ComercialLiquidacionService.dailySummaryPath('72'),
        '/comercial-liquidaciones/daily-summary/72',
      );
      expect(
        ComercialLiquidacionService.closePath,
        '/comercial-liquidaciones',
      );
    });

    test('closeLiquidacion sends backend close payload contract', () async {
      Map<String, dynamic>? sentPayload;
      final interceptor = InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.method == 'POST' &&
              options.path == ComercialLiquidacionService.closePath) {
            sentPayload = Map<String, dynamic>.from(options.data as Map);
            handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                data: const {'success': true, 'created': true},
              ),
            );
            return;
          }
          handler.next(options);
        },
      );
      ApiClient.dio.interceptors.add(interceptor);
      addTearDown(() => ApiClient.dio.interceptors.remove(interceptor));

      const service = ComercialLiquidacionService();
      final date = DateTime.parse('2026-06-27');
      await service.closeLiquidacion(
        draft: ComercialLiquidacionDraft(
          employeeCode: '72',
          date: date,
          expectedTotal: 842.60,
          ingresoBanco: 840,
          entregado: 2.60,
        ),
        summary: ComercialLiquidacionSummary(
          totalEfectivo: 844.29,
          totalTarjeta: 568.89,
          totalCobrosDia: 1413.18,
          saldoActual: -1.69,
          totalAIngresar: 842.60,
        ),
        idempotencyToken: 'liq-comercial-20260627-72',
      );

      expect(sentPayload, isNotNull);
      expect(sentPayload, containsPair('vendedorId', '72'));
      expect(sentPayload,
          containsPair('idempotencyKey', 'liq-comercial-20260627-72'));
      expect(sentPayload, containsPair('sendEmail', true));
      expect(sentPayload, isNot(contains('vendorCode')));
      expect(sentPayload, isNot(contains('idempotencyToken')));
      expect(sentPayload, isNot(contains('sendEmails')));
      expect(sentPayload!['totals'], containsPair('efectivo', 844.29));
      expect(sentPayload!['totals'], containsPair('tarjeta', 568.89));
      expect(sentPayload!['totals'], containsPair('totalCobros', 1413.18));
      expect(sentPayload!['totals'], isNot(contains('totalCobrosDia')));
    });
  });

  group('ComercialLiquidacionDailyResult.fromJson', () {
    test('maps nested summary from daily-summary response', () {
      final result = ComercialLiquidacionDailyResult.fromJson({
        'success': true,
        'vendorCode': '72',
        'date': '2026-06-27',
        'vendorEmail': 'josemiguel.acacio@mari-pepa.com',
        'summary': {
          'liquidacionNumero': 91,
          'totalEfectivo': 844.29,
          'totalTarjeta': 568.89,
          'totalCobrosDia': 1413.18,
          'totalCheques': 0,
          'totalPostdatados': 0,
          'saldoActual': -1.69,
          'totalAIngresar': 842.60,
          'ingresoBanco': 840,
          'delta': 2.60,
          'cardDetailAggregateOnly': true,
        },
      });

      expect(result.vendorCode, '72');
      expect(result.date, '2026-06-27');
      expect(result.summary.liquidacionNumero, 91);
      expect(result.summary.totalEfectivo, closeTo(844.29, 0.01));
      expect(result.summary.totalTarjeta, closeTo(568.89, 0.01));
      expect(result.summary.totalAIngresar, closeTo(842.60, 0.01));
      expect(result.summary.deltaFromBanco, closeTo(2.60, 0.01));
      expect(result.summary.isPopulated, isTrue);
    });

    test('maps direct summary response shape', () {
      final result = ComercialLiquidacionDailyResult.fromJson({
        'success': true,
        'vendedorId': '72',
        'date': '2026-06-27',
        'liquidacionNumero': 91,
        'totalEfectivo': 844.29,
        'totalTarjeta': 568.89,
        'totalCobrosDia': 1413.18,
        'saldoActual': -1.69,
        'totalAIngresar': 842.60,
      });

      expect(result.vendorCode, '72');
      expect(result.summary.totalTarjeta, closeTo(568.89, 0.01));
      expect(result.summary.isPopulated, isTrue);
    });

    test(
        'maps registered cobros, obligation and closeability from daily-summary response',
        () {
      final result = ComercialLiquidacionDailyResult.fromJson({
        'success': true,
        'vendorCode': '72',
        'date': '2026-06-27',
        'summary': {
          'liquidacionNumero': 91,
          'totalEfectivo': 844.29,
          'totalTarjeta': 568.89,
          'totalCobrosDia': 1413.18,
          'saldoActual': -1.69,
          'totalAIngresar': 842.60,
          'registeredCobros': {'registeredCents': 4000},
          'obligation': {
            'minimumPercent': 60,
            'collectableCents': 12500,
            'registeredCents': 4000,
            'remainingCents': 3500,
            'met': false,
          },
          'closeability': {
            'canClose': false,
            'reasons': ['MINIMUM_OBLIGATION_NOT_MET'],
          },
        },
      });

      expect(result.summary.registeredCobros.registeredCents, 4000);
      expect(result.summary.obligation.minimumPercent, 60);
      expect(result.summary.obligation.remainingCents, 3500);
      expect(result.summary.obligation.met, isFalse);
      expect(result.summary.closeability.canClose, isFalse);
      expect(
        result.summary.closeability.reasons,
        contains('MINIMUM_OBLIGATION_NOT_MET'),
      );
    });
  });
}
