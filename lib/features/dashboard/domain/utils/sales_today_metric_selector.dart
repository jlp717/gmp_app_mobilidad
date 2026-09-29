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

  /// Whether the gross contract was valid and selected.
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

/// Selects the gross metric only when amount and document count are valid.
SalesTodayMetricSelection selectSalesTodayMetric(
  Map<String, dynamic> payload,
) {
  final gross = payload['todaySalesGross'];
  final documents = payload['todayDocumentsGross'];
  final validGross = gross is num && gross.isFinite;
  final validDocuments = documents is num &&
      documents.isFinite &&
      documents >= 0 &&
      documents == documents.roundToDouble();

  if (validGross && validDocuments) {
    return SalesTodayMetricSelection(
      amount: gross.toDouble(),
      documents: documents.toInt(),
      usesGross: true,
    );
  }
  return SalesTodayMetricSelection(
    amount: _legacyDouble(payload['todaySales']),
    documents: _legacyInt(payload['totalOrders']),
    usesGross: false,
  );
}
