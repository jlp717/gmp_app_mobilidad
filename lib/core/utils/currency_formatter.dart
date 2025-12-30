import 'package:intl/intl.dart';

/// Utility class for formatting currency values in Spanish format
class CurrencyFormatter {
  static final NumberFormat _formatterFull = NumberFormat.currency(
    locale: 'es_ES',
    symbol: '€',
    decimalDigits: 2,
  );

  static final NumberFormat _formatterCompact = NumberFormat.compact(
    locale: 'es_ES',
  );

  /// Formats a number as Spanish currency: "1.234,56 €"
  static String format(double value) {
    return _formatterFull.format(value);
  }

  /// Formats with NO decimals for whole amounts: "1.234 €"
  static String formatWhole(double value) {
    final formatter = NumberFormat.currency(
      locale: 'es_ES',
      symbol: '€',
      decimalDigits: 0,
    );
    return formatter.format(value);
  }

  /// Formats for chart axis labels: "300k" or "1,2M"
  static String formatAxis(double value) {
    if (value >= 1000000) {
      return '${(value / 1000000).toStringAsFixed(1).replaceAll('.', ',')}M';
    } else if (value >= 1000) {
      return '${(value / 1000).toStringAsFixed(0)}k';
    }
    return value.toStringAsFixed(0);
  }

  /// Formats compact with € symbol: "1,2 M€"
  static String formatCompact(double value) {
    if (value >= 1000000) {
      return '${_formatterCompact.format(value)} €';
    }
    return format(value);
  }
}

