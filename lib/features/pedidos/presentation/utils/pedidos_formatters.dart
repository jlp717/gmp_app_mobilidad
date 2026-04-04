import 'package:intl/intl.dart';

class PedidosFormatters {
  PedidosFormatters._();

  static final NumberFormat _money2 = NumberFormat.currency(
    locale: 'es_ES',
    customPattern: '#,##0.00 \u20AC',
    symbol: '\u20AC',
    decimalDigits: 2,
  );

  static final NumberFormat _money3 = NumberFormat.currency(
    locale: 'es_ES',
    customPattern: '#,##0.000 \u20AC',
    symbol: '\u20AC',
    decimalDigits: 3,
  );

  static final NumberFormat _number0 = NumberFormat.decimalPattern('es_ES');
  static final NumberFormat _number1 = NumberFormat('#,##0.0', 'es_ES');
  static final NumberFormat _number2 = NumberFormat('#,##0.##', 'es_ES');

  static String money(num value, {int decimals = 2}) {
    final amount = value.toDouble();
    if (decimals == 3) return _money3.format(amount);
    return _money2.format(amount);
  }

  static String number(num value, {int decimals = 0}) {
    final amount = value.toDouble();
    switch (decimals) {
      case 0:
        return _number0.format(amount);
      case 1:
        return _number1.format(amount);
      default:
        return _number2.format(amount);
    }
  }
}
