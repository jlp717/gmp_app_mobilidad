/// Contractual value and document count shown by the Ventas hoy cards.
class SalesTodayMetricSelection {
  /// Creates a validated Ventas hoy selection.
  const SalesTodayMetricSelection({
    required this.amount,
    required this.documents,
    required this.usesGross,
  });

  /// Amount displayed by the sales card.
  final double amount;

  /// Document count displayed beside today's sales.
  final int documents;

  /// Kept for older call sites. The card never selects the route-sheet gross.
  final bool usesGross;
}

double _legacyDouble(Object? value) {
  if (value is num && value.isFinite) return value.toDouble();
  final parsed = double.tryParse(value?.toString() ?? '');
  return parsed != null && parsed.isFinite ? parsed : 0;
}

int _legacyInt(Object? value) {
  if (value is int) return value;
  if (value is num && value.isFinite) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

bool _isWholeCount(Object? value) {
  return value is num &&
      value.isFinite &&
      value >= 0 &&
      value == value.roundToDouble();
}

/// Selects the commercial day total. [todaySales] is that amount.
/// The route-sheet gross stays in `todaySalesGross` and is not the card.
SalesTodayMetricSelection selectSalesTodayMetric(
  Map<String, dynamic> payload,
) {
  final filteredDocs = payload['todayDocumentsFiltered'];
  return SalesTodayMetricSelection(
    amount: _legacyDouble(payload['todaySales']),
    documents: _isWholeCount(filteredDocs)
        ? (filteredDocs as num).toInt()
        : _legacyInt(payload['totalOrders']),
    usesGross: false,
  );
}

/// Title with the Madrid calendar day, for example `Ventas hoy (01/10/2026)`.
String salesTodayTitle(Object? contractDate) {
  final raw = contractDate?.toString() ?? '';
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(raw);
  if (match == null) return 'Ventas hoy';
  return 'Ventas hoy (${match.group(3)}/${match.group(2)}/${match.group(1)})';
}
