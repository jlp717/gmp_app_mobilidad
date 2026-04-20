// GMP String Utils Tests
import 'package:flutter_test/flutter_test.dart';

class StringUtils {
  static String truncate(String text, int maxLength) {
    if (text.length <= maxLength) return text;
    return '${text.substring(0, maxLength)}...';
  }

  static String capitalize(String text) {
    if (text.isEmpty) return text;
    return text[0].toUpperCase() + text.substring(1).toLowerCase();
  }

  static bool isNumeric(String text) {
    return double.tryParse(text) != null;
  }

  static String formatCurrency(double amount, {String symbol = '€'}) {
    return '${amount.toStringAsFixed(2)} $symbol';
  }

  static String formatPhone(String phone) {
    final cleaned = phone.replaceAll(RegExp(r'[^\d]'), '');
    if (cleaned.length == 9) {
      return '${cleaned.substring(0, 3)} ${cleaned.substring(3, 6)} ${cleaned.substring(6)}';
    }
    return phone;
  }
}

void main() {
  group('StringUtils truncate Tests', () {
    test('returns original when shorter than maxLength', () {
      expect(StringUtils.truncate('Hello', 10), 'Hello');
    });

    test('truncates when longer than maxLength', () {
      expect(StringUtils.truncate('Hello World', 5), 'Hello...');
    });

    test('returns original when exactly maxLength', () {
      expect(StringUtils.truncate('Hello', 5), 'Hello');
    });

    test('handles empty string', () {
      expect(StringUtils.truncate('', 5), '');
    });
  });

  group('StringUtils capitalize Tests', () {
    test('capitalizes first letter', () {
      expect(StringUtils.capitalize('hello'), 'Hello');
    });

    test('lowercases rest of string', () {
      expect(StringUtils.capitalize('HELLO'), 'Hello');
    });

    test('handles empty string', () {
      expect(StringUtils.capitalize(''), '');
    });

    test('handles single character', () {
      expect(StringUtils.capitalize('h'), 'H');
    });
  });

  group('StringUtils isNumeric Tests', () {
    test('returns true for integer', () {
      expect(StringUtils.isNumeric('123'), true);
    });

    test('returns true for decimal', () {
      expect(StringUtils.isNumeric('123.45'), true);
    });

    test('returns false for text', () {
      expect(StringUtils.isNumeric('hello'), false);
    });

    test('returns false for mixed', () {
      expect(StringUtils.isNumeric('123abc'), false);
    });

    test('returns false for empty', () {
      expect(StringUtils.isNumeric(''), false);
    });
  });

  group('StringUtils formatCurrency Tests', () {
    test('formats with default euro symbol', () {
      expect(StringUtils.formatCurrency(100.0), '100.00 €');
    });

    test('formats with custom symbol', () {
      expect(StringUtils.formatCurrency(100.0, symbol: '\$'), '100.00 \$');
    });

    test('formats with 2 decimals', () {
      expect(StringUtils.formatCurrency(100), '100.00 €');
    });

    test('formats negative values', () {
      expect(StringUtils.formatCurrency(-50.0), '-50.00 €');
    });
  });

  group('StringUtils formatPhone Tests', () {
    test('formats 9 digit phone', () {
      expect(StringUtils.formatPhone('612345678'), '612 345 678');
    });

    test('removes non-digits before formatting', () {
      expect(StringUtils.formatPhone('612-345-678'), '612 345 678');
    });

    test('returns original for non-9-digit input', () {
      expect(StringUtils.formatPhone('12345'), '12345');
    });
  });
}
