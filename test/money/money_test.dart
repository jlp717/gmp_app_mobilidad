import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/money/money.dart';

void main() {
  group('Money.fromCents', () {
    test('stores exact cents and renders identical doubles', () {
      const money = Money.zero;
      expect(money.cents, 0);
      expect(Money.fromCents(12345).cents, 12345);
      expect(Money.fromCents(12345).toDouble(), 123.45);
      // Wire compat: toJson emits the same double number as legacy code.
      expect(Money.fromCents(1999).toJson(), 19.99);
      expect(Money.fromCents(-99).toJson(), -0.99);
    });
  });

  group('Money.fromDouble', () {
    test('rounds typical prices to exact cents', () {
      expect(Money.fromDouble(19.99).cents, 1999);
      expect(Money.fromDouble(10.20).cents, 1020);
      expect(Money.fromDouble(0.1).cents, 10);
      expect(Money.fromDouble(0).cents, 0);
    });

    test('documents binary-float reality on user input', () {
      // Textbook case: 1.005 as double is really 1.0049999..., so cent
      // rounding gives 100; the exact decimal string gives the half-away
      // 101. This is why user/wire input must enter Money via
      // tryParse/fromCents, never via double.
      expect(Money.fromDouble(1.005).cents, 100);
      expect(Money.tryParse('1.005')?.cents, 101);
      // Exactly representable halves round away from zero.
      expect(Money.fromDouble(2.5).cents, 250);
      expect(Money.fromDouble(-2.5).cents, -250);
      expect(Money.fromDouble(1.125).cents, 113);
    });

    test('rejects non-finite input', () {
      expect(() => Money.fromDouble(double.nan), throwsArgumentError);
      expect(
        () => Money.fromDouble(double.infinity),
        throwsArgumentError,
      );
    });
  });

  group('Money.tryParse (ES)', () {
    test('parses ES and international formats', () {
      expect(Money.tryParse('1.234,56')?.cents, 123456);
      expect(Money.tryParse('1,234.56')?.cents, 123456);
      expect(Money.tryParse('1234.56')?.cents, 123456);
      expect(Money.tryParse('1234,56')?.cents, 123456);
      expect(Money.tryParse('12')?.cents, 1200);
      expect(Money.tryParse('12,3')?.cents, 1230);
      expect(Money.tryParse(' 1.234,56 ')?.cents, 123456);
      expect(Money.tryParse('-12,30')?.cents, -1230);
      expect(Money.tryParse(',99')?.cents, 99);
    });

    test('rounds extra decimals half-away on the exact string', () {
      expect(Money.tryParse('2.345')?.cents, 235);
      expect(Money.tryParse('-2.345')?.cents, -235);
      expect(Money.tryParse('2.344')?.cents, 234);
      expect(Money.tryParse('2.3445')?.cents, 234);
      expect(Money.tryParse('2.3451')?.cents, 235);
    });

    test('rejects empty and invalid text', () {
      expect(Money.tryParse(''), isNull);
      expect(Money.tryParse('   '), isNull);
      expect(Money.tryParse('abc'), isNull);
      expect(Money.tryParse('12,34,56'), isNull);
      expect(Money.tryParse('12.34.56'), isNull);
      expect(Money.tryParse('--5'), isNull);
    });

    test('parse throws on invalid text', () {
      expect(() => Money.parse('abc'), throwsFormatException);
      expect(Money.parse('10,00').cents, 1000);
    });
  });

  group('Money.moneyValue (wire reader)', () {
    test('reads num, ES string, fallback', () {
      expect(Money.moneyValue(10.5).cents, 1050);
      expect(Money.moneyValue('3,25').cents, 325);
      expect(Money.moneyValue(null), Money.zero);
      expect(
        Money.moneyValue('xx', fallback: Money.fromCents(7)),
        Money.fromCents(7),
      );
    });
  });

  group('Money arithmetic stays in cents', () {
    test('0.1 + 0.2 == 0.3 exactly (legacy double fails this)', () {
      // ignore: deprecated_member_use
      expect(0.1 + 0.2 == 0.3, isFalse);
      expect(
        Money.fromDouble(0.1) + Money.fromDouble(0.2),
        Money.fromDouble(0.3),
      );
    });

    test('adds, subtracts, negates, abs', () {
      expect(
        Money.fromCents(100) + Money.fromCents(23),
        Money.fromCents(123),
      );
      expect(
        Money.fromCents(100) - Money.fromCents(23),
        Money.fromCents(77),
      );
      expect(-Money.fromCents(5), Money.fromCents(-5));
      expect(Money.fromCents(-5).abs(), Money.fromCents(5));
    });

    test('scales: int exact, double rounded half-away', () {
      expect(Money.fromCents(101) * 2, Money.fromCents(202));
      expect(Money.fromCents(101) * 1.5, Money.fromCents(152));
      expect(Money.fromCents(100) * 0.1, Money.fromCents(10));
    });

    test('compares and hashes by cents', () {
      expect(Money.fromCents(1) < Money.fromCents(2), isTrue);
      expect(Money.fromCents(2) <= Money.fromCents(2), isTrue);
      expect(Money.fromCents(3) > Money.fromCents(2), isTrue);
      expect(Money.fromCents(3) >= Money.fromCents(3), isTrue);
      expect(Money.fromCents(5).compareTo(Money.fromCents(5)), 0);
      expect(Money.fromCents(5).hashCode, Money.fromCents(5).hashCode);
      expect(Money.fromCents(1).isZero, isFalse);
      expect(Money.zero.isZero, isTrue);
      expect(Money.fromCents(-1).isNegative, isTrue);
      expect(Money.fromCents(1).isPositive, isTrue);
    });
  });

  group('Money.toStringES', () {
    test('formats spanish with thousands and comma decimals', () {
      expect(Money.fromCents(123456).toStringES(), '1.234,56');
      expect(Money.fromCents(0).toStringES(), '0,00');
      expect(Money.fromCents(-99).toStringES(), '-0,99');
      expect(Money.fromCents(100000).toStringES(), '1.000,00');
      expect(Money.fromCents(123456789).toStringES(), '1.234.567,89');
    });
  });
}
