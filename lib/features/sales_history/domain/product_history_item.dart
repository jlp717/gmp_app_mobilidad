class ProductHistoryItem {
  final String date;
  final int year;
  final int month;
  final String clientCode;
  final String productCode;
  final String productName;
  final String price;
  final double quantity;
  final String total;
  final String lote;
  final String ref;
  final String invoice;

  ProductHistoryItem({
    required this.date,
    required this.year,
    required this.month,
    required this.clientCode,
    required this.productCode,
    required this.productName,
    required this.price,
    required this.quantity,
    required this.total,
    required this.lote,
    required this.ref,
    required this.invoice,
  });

  factory ProductHistoryItem.fromJson(Map<String, dynamic> json) {
    return ProductHistoryItem(
      date: json['date'] ?? '',
      year: json['year'] ?? 0,
      month: json['month'] ?? 0,
      clientCode: json['clientCode'] ?? '',
      productCode: json['productCode'] ?? '',
      productName: json['productName'] ?? '',
      price: json['price'] ?? '0.00€',
      quantity: (json['quantity'] as num?)?.toDouble() ?? 0.0,
      total: json['total'] ?? '0.00€',
      lote: json['lote'] ?? '',
      ref: json['ref'] ?? '',
      invoice: json['invoice'] ?? '',
    );
  }
}
