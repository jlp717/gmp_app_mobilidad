import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/money/money.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_delivery_validation.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_standalone_cobro.dart';

// L8a: the Money-canonical rutero functions must emit doubles identical to
// the legacy implementations for cent-rounded wire data (backend N/N-1).
void main() {
  group('capSaldoCobrableAlDocumento parity', () {
    const cases = [
      (2841.76, 3279.61),
      (161.58, 174.78),
      (100.0, 12.0),
      (100.0, 100.0),
      (0.0, 10.0),
      (10.0, 0.0),
    ];
    for (final (document, collectable) in cases) {
      test('document=$document collectable=$collectable', () {
        final legacy = capSaldoCobrableAlDocumento(
          documentAmount: document,
          collectableAmount: collectable,
        );
        final canonical = capSaldoCobrableAlDocumentoMoney(
          documentAmount: Money.fromDouble(document),
          collectableAmount: Money.fromDouble(collectable),
        ).toDouble();
        expect(canonical, legacy);
      });
    }
  });

  group('canonicalRuteroDocumentAmount parity', () {
    test('untouched keeps header', () {
      expect(
        canonicalRuteroDocumentAmountMoney(
          headerAmount: Money.fromDouble(31),
          deliveredLineSum: Money.fromDouble(30.80),
          quantitiesChanged: false,
        ).toDouble(),
        canonicalRuteroDocumentAmount(
          headerAmount: 31,
          deliveredLineSum: 30.80,
          quantitiesChanged: false,
        ),
      );
    });

    test('qty change persists live total', () {
      expect(
        canonicalRuteroDocumentAmountMoney(
          headerAmount: Money.fromDouble(31),
          deliveredLineSum: Money.fromDouble(23.10),
          quantitiesChanged: true,
        ).toDouble(),
        23.10,
      );
    });
  });

  group('parseRuteroMoney parity', () {
    const inputs = [
      '12,01',
      '2841,76',
      '1.234,56',
      '10.00',
      '0,00',
      '',
      'abc',
      '12,34,56',
    ];
    for (final input in inputs) {
      test('"$input"', () {
        expect(
          parseRuteroMoneyValue(input)?.toDouble(),
          parseRuteroMoney(input),
        );
      });
    }
  });

  group('nextRuteroSuggestedPaymentAmount parity', () {
    test('follows repeated edits, keeps manual input', () {
      final first = nextRuteroSuggestedPaymentAmountMoney(
        currentAmount: Money.fromDouble(100),
        lastSuggestedAmount: Money.fromDouble(100),
        maximumAmount: Money.fromDouble(40),
      );
      expect(first?.toDouble(), 40);
      final second = nextRuteroSuggestedPaymentAmountMoney(
        currentAmount: first,
        lastSuggestedAmount: first,
        maximumAmount: Money.fromDouble(20),
      );
      expect(second?.toDouble(), 20);
      expect(
        nextRuteroSuggestedPaymentAmountMoney(
          currentAmount: Money.fromDouble(15),
          lastSuggestedAmount: second,
          maximumAmount: Money.fromDouble(10),
        ),
        isNull,
      );
    });

    test('double wrapper agrees', () {
      expect(
        nextRuteroSuggestedPaymentAmount(
          currentAmount: 100,
          lastSuggestedAmount: 100,
          maximumAmount: 40,
        ),
        40,
      );
    });
  });

  group('standalone cobro parity', () {
    test('validate agrees on cap boundary', () {
      expect(
        validateRuteroStandaloneCobroAmountMoney(
          amount: Money.fromDouble(12.01),
          maxCollectable: Money.fromDouble(12),
        ),
        validateRuteroStandaloneCobroAmount(
          amount: 12.01,
          maxCollectable: 12,
        ),
      );
      expect(
        validateRuteroStandaloneCobroAmountMoney(
          amount: Money.fromDouble(12),
          maxCollectable: Money.fromDouble(12),
        ),
        isNull,
      );
    });

    test('remaining is exact cents', () {
      expect(
        remainingCollectableAfterMoney(
          currentAvailable: Money.fromDouble(100),
          collected: Money.fromDouble(40),
        ),
        Money.fromDouble(60),
      );
      expect(
        remainingCollectableAfterMoney(
          currentAvailable: Money.fromDouble(10),
          collected: Money.fromDouble(20),
        ),
        Money.zero,
      );
      expect(
        remainingCollectableAfter(
          currentAvailable: 100,
          collected: 40,
        ),
        60,
      );
    });
  });

  group('wire doubles identical', () {
    test('Money round-trips cent values exactly', () {
      for (final value in [19.99, 2841.76, 161.58, 0.0, 10.20, -4.0]) {
        expect(Money.fromDouble(value).toJson(), value);
      }
    });
  });
}
