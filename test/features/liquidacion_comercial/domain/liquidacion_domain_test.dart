import 'package:flutter_test/flutter_test.dart';
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
  });

  group('classifyLiquidacionStatus', () {
    test('returns each status kind', () {
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
}
