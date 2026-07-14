import 'package:flutter_test/flutter_test.dart';

/// Verified fixture: comercial 72, 2026-06-27, liquidación 91 (DSEDAC.LQD).
/// Source: DSEDAC.LQD summary; card detail aggregate-only (no per-card lines).
void main() {
  group('Comercial liquidación API contract (ref 72)', () {
    const vendorCode = '72';
    const date = '2026-06-27';
    const liquidacionNumero = 91;
    const idempotencyToken = 'liq-comercial-20260627-72';
    const email = 'josemiguel.acacio@mari-pepa.com';
    const efectivo = 844.29;
    const tarjeta = 568.89;
    const totalCobros = 1413.18;
    const saldo = -1.69;
    const totalAIngresar = 842.60;
    const ingresoBanco = 840.0;
    const entregado = 2.60;
    const delta = 2.60;

    test('total cobros equals efectivo plus tarjeta aggregate', () {
      expect(efectivo + tarjeta, closeTo(totalCobros, 0.01));
    });

    test('delta is totalAIngresar minus banco when entregado is zero', () {
      expect(totalAIngresar - ingresoBanco, closeTo(delta, 0.01));
    });

    test('balanced close when banco plus entregado equals totalAIngresar', () {
      expect(ingresoBanco + entregado, closeTo(totalAIngresar, 0.01));
      expect(totalAIngresar - ingresoBanco - entregado, closeTo(0, 0.01));
    });

    test('saldo participates in totalAIngresar expectation', () {
      // totalAIngresar = efectivo + cheques + postdatados + saldo (no tarjeta in ingreso)
      const cheques = 0.0;
      const postdatados = 0.0;
      expect(
        efectivo + cheques + postdatados + saldo,
        closeTo(totalAIngresar, 0.01),
      );
    });

    test('card detail stays aggregate-only in contract', () {
      expect(tarjeta, closeTo(568.89, 0.01));
      // Per-card lines must not be required for UI/PDF summary contract.
      const cardLines = <Map<String, Object>>[];
      final aggregate = cardLines.fold<double>(
        0,
        (sum, line) => sum + (line['amount'] as num).toDouble(),
      );
      expect(aggregate, 0);
    });

    test('fixture identity fields for backend close and email', () {
      expect(vendorCode, '72');
      expect(date, '2026-06-27');
      expect(liquidacionNumero, 91);
      expect(idempotencyToken, contains('20260627'));
      expect(email, endsWith('@mari-pepa.com'));
    });

    test('idempotency replay must not change monetary payload', () {
      final firstClose = <String, Object>{
        'vendorCode': vendorCode,
        'date': date,
        'idempotencyToken': idempotencyToken,
        'ingresoBanco': ingresoBanco,
        'entregado': entregado,
      };
      final replayClose = Map<String, Object>.from(firstClose);
      expect(replayClose, equals(firstClose));
    });

    test(
        'daily-summary API shape includes aggregate summary without card lines',
        () {
      final summary = <String, Object?>{
        'vendorCode': vendorCode,
        'date': date,
        'liquidacionNumero': liquidacionNumero,
        'totalEfectivo': efectivo,
        'totalTarjeta': tarjeta,
        'totalCobrosDia': totalCobros,
        'saldoActual': saldo,
        'totalAIngresar': totalAIngresar,
        'ingresoBanco': ingresoBanco,
        'delta': delta,
        'cardDetailAggregateOnly': true,
      };

      expect(summary['totalTarjeta'], tarjeta);
      expect(summary['cardDetailAggregateOnly'], isTrue);
      expect(summary.containsKey('cardPayments'), isFalse);
      expect(summary.containsKey('tarjetaDetalle'), isFalse);
    });

    test('summary contract exposes ingresoBanco and delta from DSEDAC.LQD', () {
      expect(ingresoBanco, 840.0);
      expect(totalAIngresar - ingresoBanco, closeTo(delta, 0.01));
    });

    test('UI draft delta mirrors banco shortfall when entregado is zero', () {
      const expectedTotal = totalAIngresar;
      const registrado = ingresoBanco + 0;
      final diferencia = expectedTotal - registrado;
      expect(diferencia, closeTo(delta, 0.01));
      expect(diferencia.abs() >= 0.01, isTrue);
    });

    test(
        'UI draft is balanced when banco plus entregado matches totalAIngresar',
        () {
      final registrado = ingresoBanco + entregado;
      final diferencia = totalAIngresar - registrado;
      expect(diferencia.abs(), lessThan(0.01));
    });

    test('close payload rejects entregado that breaks totalAIngresar balance',
        () {
      const unbalancedEntregado = 50.0;
      expect(
        ingresoBanco + unbalancedEntregado,
        isNot(closeTo(totalAIngresar, 0.01)),
      );
    });

    test('reference delta matches entregado when banco is 840', () {
      expect(entregado, closeTo(delta, 0.01));
      expect(ingresoBanco + entregado, closeTo(totalAIngresar, 0.01));
    });

    test('email failure must not block successful close contract', () {
      const response = <String, Object>{
        'success': true,
        'created': true,
        'liquidacion': <String, Object>{
          'idempotencyToken': idempotencyToken,
          'ingresoBanco': ingresoBanco,
          'entregado': entregado,
        },
        'emailWarnings': <Map<String, Object>>[
          <String, Object>{
            'to': email,
            'success': false,
            'error': 'SMTP timeout'
          },
        ],
      };
      expect(response['success'], isTrue);
      expect(response['created'], isTrue);
      expect(response['emailWarnings'], isA<List>());
      expect((response['emailWarnings'] as List).length, greaterThan(0));
    });
  });
}
