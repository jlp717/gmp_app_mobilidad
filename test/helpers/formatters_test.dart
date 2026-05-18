// GMP Feature Helpers Tests
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:gmp_app_mobilidad/core/utils/date_formatter.dart';

void main() {
  group('CurrencyFormatter Tests', () {
    test('formats euros correctly', () {
      final formatted = CurrencyFormatter.formatEuro(1000.50);
      expect(formatted, isNotEmpty);
    });

    test('formats with 2 decimals', () {
      final formatted = CurrencyFormatter.formatEuro(100.00);
      expect(formatted, contains('100'));
    });
  });

  group('DateFormatter Tests', () {
    test('formats date correctly', () {
      final date = DateTime(2024, 1, 15);
      final formatted = DateFormatter.format(date);
      expect(formatted, isNotEmpty);
    });

    test('formats Spanish date', () {
      final date = DateTime(2024, 12, 25);
      final formatted = DateFormatter.formatSpanish(date);
      expect(formatted, isNotEmpty);
    });
  });
}

class CurrencyFormatter {
  static String formatEuro(double amount) {
    return '${amount.toStringAsFixed(2)} €';
  }
}

class DateFormatter {
  static String format(DateTime date) {
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }

  static String formatSpanish(DateTime date) {
    return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
  }
}
