import 'package:intl/intl.dart';

/// Cantidad de catálogo/stock: enteros sin decimales, fraccionarios con
/// los decimales que tengan (máximo 3), en formato español.
String formatCatalogQuantity(num value) {
  final amount = value.toDouble();
  if (!amount.isFinite) return '0';
  final nearest = amount.roundToDouble();
  if ((amount - nearest).abs() < 0.0005) {
    return NumberFormat.decimalPattern('es_ES').format(nearest);
  }
  return NumberFormat('#,##0.###', 'es_ES').format(amount);
}
