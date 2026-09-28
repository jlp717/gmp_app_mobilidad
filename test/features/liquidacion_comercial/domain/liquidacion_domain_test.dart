import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/money/money.dart';
import 'package:gmp_app_mobilidad/features/liquidacion_comercial/domain/liquidacion_domain.dart';

void main() {
  final date = DateTime(2026, 8, 26);

  ComercialLiquidacionDraft draft({
    double expectedTotal = 100,
    double ingresoBanco = 60,
    double entregado = 40,
  }) {
    return ComercialLiquidacionDraft(
      employeeCode: '57',
      date: date,
      expectedTotal: expectedTotal,
      ingresoBanco: ingresoBanco,
      entregado: entregado,
    );
  }

  group('parseAmount', () {
    test('parses accepted formats and rejects invalid values', () {
      expect(parseAmount('1234,56'), 1234.56);
      expect(parseAmount('1.234,56'), 1234.56);
      expect(parseAmount('1,234.56'), 1234.56);
      expect(parseAmount(''), 0);
      expect(parseAmount('   '), 0);
      expect(parseAmount('abc'), isNull);
      expect(parseAmount('-5'), isNull);
      expect(parseAmount('0'), 0.0);
    });
  });

  group('validateAmount', () {
    test('validates malformed and excessive amounts', () {
      expect(validateAmount(null), 'Introduce un importe válido');
      expect(validateAmount('abc'), 'Introduce un importe válido');
      expect(validateAmount('1000000'), 'Importe demasiado alto');
      expect(validateAmount('999999.99'), isNull);
    });
  });

  group('ComercialLiquidacionDraft', () {
    test('calculates registered amount, difference and balance tolerance', () {
      final balanced = draft(ingresoBanco: 60, entregado: 39.991);
      // ponytail: 39.99 produce diferencia flotante ~-7e-15 (borde inestable);
      // caso inequívoco con diff 0.5.
      final unbalanced = draft(ingresoBanco: 60, entregado: 39.5);

      expect(balanced.registrado, closeTo(99.991, 0.000001));
      expect(balanced.diferencia, closeTo(0.009, 0.000001));
      expect(balanced.isBalanced, isTrue);
      expect(unbalanced.isBalanced, isFalse);
    });
  });

  group('ComercialLiquidacionSummary', () {
    test('sums total by default and respects an override', () {
      const calculated = ComercialLiquidacionSummary(
        totalEfectivo: 10,
        totalCheques: 20,
        totalPostdatados: 30,
        saldoActual: 40,
      );
      const overridden = ComercialLiquidacionSummary(
        totalEfectivo: 10,
        totalAIngresar: 75,
      );

      expect(calculated.totalAIngresar, 100);
      expect(overridden.totalAIngresar, 75);
    });

    test(
        'does not subtract already-collected returns from the amount to deposit',
        () {
      const withReturns = ComercialLiquidacionSummary(
        totalEfectivo: 1000,
        devolucionesYaCobradas: 1000,
      );

      expect(withReturns.devolucionesYaCobradas, 1000);
      expect(withReturns.totalAIngresar, 1000);
    });
  });

  group('classifyLiquidacionStatus', () {    test('returns each status kind', () {
      final balanced = draft();
      final mismatch = draft(entregado: 20);

      expect(
        classifyLiquidacionStatus(
          balanced,
          hasInput: false,
          amountsAreValid: true,
        ),
        LiquidacionStatusKind.pending,
      );
      expect(
        classifyLiquidacionStatus(
          balanced,
          hasInput: true,
          amountsAreValid: true,
        ),
        LiquidacionStatusKind.balanced,
      );
      expect(
        classifyLiquidacionStatus(
          mismatch,
          hasInput: true,
          amountsAreValid: true,
        ),
        LiquidacionStatusKind.mismatch,
      );
      expect(
        classifyLiquidacionStatus(
          balanced,
          hasInput: true,
          amountsAreValid: false,
        ),
        LiquidacionStatusKind.invalid,
      );
    });
  });

  group('parseMoney (canonical)', () {
    test('parses ES formats, maps empty to zero, rejects invalid', () {
      expect(parseMoney('1234,56'), Money.fromCents(123456));
      expect(parseMoney('1.234,56'), Money.fromCents(123456));
      expect(parseMoney('1,234.56'), Money.fromCents(123456));
      expect(parseMoney(''), Money.zero);
      expect(parseMoney('   '), Money.zero);
      expect(parseMoney('abc'), isNull);
      expect(parseMoney('-5'), isNull);
      expect(parseMoney('0'), Money.zero);
    });

    test('legacy parseAmount stays behavior-identical (compat)', () {
      // ignore: deprecated_member_use
      expect(parseAmount('1.234,56'), 1234.56);
      // ignore: deprecated_member_use
      expect(parseAmount(''), 0);
      // ignore: deprecated_member_use
      expect(parseAmount('abc'), isNull);
    });
  });

  group('Money draft/summary/devolucion', () {
    test('fromMoney computes registrado/diferencia in exact cents', () {
      final draft = ComercialLiquidacionDraft.fromMoney(
        employeeCode: '57',
        date: date,
        expectedTotal: Money.fromCents(10000),
        ingresoBanco: Money.fromCents(6000),
        entregado: Money.fromCents(3999),
      );

      expect(draft.registradoMoney, Money.fromCents(9999));
      expect(draft.diferenciaMoney, Money.fromCents(1));
      expect(draft.isBalancedExact, isFalse);

      final balanced = ComercialLiquidacionDraft.fromMoney(
        employeeCode: '57',
        date: date,
        expectedTotal: Money.fromDouble(100),
        ingresoBanco: Money.fromDouble(60),
        entregado: Money.fromDouble(40),
      );
      expect(balanced.diferenciaMoney, Money.zero);
      expect(balanced.isBalancedExact, isTrue);
    });

    test('kills the 39.99 float-drift edge: exact cent math', () {
      // Legacy double: 100 - (60 + 39.99) = 0.009999999999990905.
      final draft = ComercialLiquidacionDraft.fromMoney(
        employeeCode: '57',
        date: date,
        expectedTotal: Money.tryParse('100')!,
        ingresoBanco: Money.tryParse('60')!,
        entregado: Money.tryParse('39,99')!,
      );
      expect(draft.diferenciaMoney, Money.fromCents(1));
      expect(draft.isBalancedExact, isFalse);
    });

    test('summary fromMoney derives total and exposes Money views', () {
      final summary = ComercialLiquidacionSummary.fromMoney(
        totalEfectivo: Money.fromDouble(10),
        totalCheques: Money.fromDouble(20),
        totalPostdatados: Money.fromDouble(30),
        saldoActual: Money.fromDouble(40),
      );
      expect(summary.totalAIngresarMoney, Money.fromCents(10000));
      expect(summary.totalEfectivoMoney, Money.fromCents(1000));
      // Wire compat: legacy doubles unchanged.
      // ignore: deprecated_member_use
      expect(summary.totalAIngresar, 100);

      final overridden = ComercialLiquidacionSummary.fromMoney(
        totalEfectivo: Money.fromDouble(10),
        totalAIngresar: Money.fromDouble(75),
      );
      expect(overridden.totalAIngresarMoney, Money.fromCents(7500));
    });

    test('devolucion fromMoney keeps signed amount in cents', () {
      final item = ComercialDevolucionItem.fromMoney(
        documento: 'P-2-1',
        cliente: 'C1',
        amount: Money.tryParse('-1.000,50')!,
      );
      expect(item.amountMoney, Money.fromCents(-100050));
    });
  });
}
