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
  // FIX: Added subfamily and FI codes to support proper classification display
  final String family;
  final String subfamily;
  final String fi1;
  final String fi2;
  final String fi3;
  final String fi4;
  final String fi5;

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
    this.family = '',
    this.subfamily = 'General',
    this.fi1 = '',
    this.fi2 = '',
    this.fi3 = '',
    this.fi4 = '',
    this.fi5 = '',
  });

  factory ProductHistoryItem.fromJson(Map<String, dynamic> json) {
    return ProductHistoryItem(
      date: (json['date'] as String?) ?? '',
      year: (json['year'] as int?) ?? 0,
      month: (json['month'] as int?) ?? 0,
      clientCode: (json['clientCode'] as String?) ?? '',
      productCode: (json['productCode'] as String?) ?? '',
      productName: (json['productName'] as String?) ?? '',
      price: (json['price'] as String?) ?? '0.00€',
      quantity: (json['quantity'] as num?)?.toDouble() ?? 0.0,
      total: (json['total'] as String?) ?? '0.00€',
      lote: (json['lote'] as String?) ?? '',
      ref: (json['ref'] as String?) ?? '',
      invoice: (json['invoice'] as String?) ?? '',
      family: (json['family'] as String?) ?? '',
      subfamily: (json['subfamily'] as String?) ?? 'General',
      fi1: (json['fi1'] as String?) ?? '',
      fi2: (json['fi2'] as String?) ?? '',
      fi3: (json['fi3'] as String?) ?? '',
      fi4: (json['fi4'] as String?) ?? '',
      fi5: (json['fi5'] as String?) ?? '',
    );
  }
}

