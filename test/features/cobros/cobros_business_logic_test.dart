import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';
import 'package:gmp_app_mobilidad/features/cobros/providers/cobros_provider.dart';

void main() {
  group('Cobros models', () {
    test('parses pedidos summary separately from facturas and albaranes', () {
      final resumen = ResumenCobros.fromJson({
        'totalPendiente': 42.5,
        'pedidos': {'cantidad': 2, 'total': 42.5},
      });

      expect(resumen.totalPendiente, 42.5);
      expect(resumen.numPedidos, 2);
      expect(resumen.numFacturas, 0);
      expect(resumen.numAlbaranes, 0);
    });

    test('classifies due today as vencido when backend estado is missing', () {
      final today = DateTime.now();
      final dueToday = DateTime(today.year, today.month, today.day);

      final cobro = CobroPendiente.fromJson({
        'id': 'cvc_M_1',
        'referencia': 'M-1',
        'tipo': 'factura',
        'fecha': dueToday.toIso8601String(),
        'fechaVencimiento': dueToday.toIso8601String(),
        'importeTotal': 100,
        'importePendiente': 25,
      });

      expect(cobro.estado, EstadoCobro.vencido);
    });
  });

  group('Cobros provider params', () {
    test('uses value equality for Riverpod family keys', () {
      const a = CobrosParams(employeeCode: '01');
      const b = CobrosParams(employeeCode: '01');
      const c = CobrosParams(employeeCode: '02');

      expect(a, b);
      expect(a.hashCode, b.hashCode);
      expect(a == c, isFalse);
    });

    test('builds backend-safe idempotency tokens for commercial payments', () {
      final token = buildCobroIdempotencyToken(
        employeeCode: '01',
        codigoCliente: '4300030041',
        referencia: 'M-1',
      );

      expect(token.length, greaterThanOrEqualTo(8));
      expect(token.length, lessThanOrEqualTo(128));
      expect(RegExp(r'^[A-Za-z0-9_.:-]+$').hasMatch(token), isTrue);
      expect(token, contains('01'));
      expect(token, contains('4300030041'));
    });
  });

  group('Pending summary status resolver', () {
    test('returns neutral status when summary entry is missing', () {
      expect(estadoFromPendingSummaryEntry(null), 'SIN_DATOS');
    });

    test('does not classify explicit SIN_DATOS as al dia', () {
      expect(
        estadoFromPendingSummaryEntry({'estado': 'SIN_DATOS'}),
        'SIN_DATOS',
      );
    });

    test('returns VENCIDO when pending and overdue amounts are positive', () {
      expect(
        estadoFromPendingSummaryEntry({'total': 42.5, 'vencido': 12.3}),
        'VENCIDO',
      );
    });

    test('returns PENDIENTE when pending amount is positive without overdue',
        () {
      expect(
        estadoFromPendingSummaryEntry({'total': 42.5, 'vencido': 0}),
        'PENDIENTE',
      );
    });

    test('returns AL_DIA only for explicit zero pending and overdue amounts',
        () {
      expect(
        estadoFromPendingSummaryEntry({'total': 0, 'vencido': 0}),
        'AL_DIA',
      );
    });
  });
}
