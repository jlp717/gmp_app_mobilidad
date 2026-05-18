import 'package:gmp_app_mobilidad/core/utils/currency_formatter.dart';
import 'package:intl/intl.dart';

/// Unified formatting facade.
/// Delegates to CurrencyFormatter and provides date formatting helpers.
class Formatters {
  Formatters._();

  /// Format as Spanish currency: "1.234,56 €"
  static String currency(double value) {
    return CurrencyFormatter.format(value);
  }

  /// Compact currency for chart axes: "300k", "1,2M"
  static String compactCurrency(double value) {
    return CurrencyFormatter.formatAxis(value);
  }

  /// Short date-time format: "16/02/2026 14:30"
  static String dateTimeShort(DateTime dateTime) {
    final dateFormat = DateFormat('dd/MM/yyyy HH:mm', 'es_ES');
    return dateFormat.format(dateTime);
  }
}
