import 'package:equatable/equatable.dart';

/// Dashboard metrics model - matches new backend API format
class DashboardMetrics extends Equatable {
  final double totalSales;
  final int totalBoxes;
  final int totalOrders;
  final int uniqueClients;
  final double avgOrderValue;
  final double totalMargin;
  final double todaySales;
  final int todayOrders;
  final double lastMonthSales;
  final double growthPercent;
  final int year;
  final int month;

  const DashboardMetrics({
    required this.totalSales,
    required this.totalBoxes,
    required this.totalOrders,
    required this.uniqueClients,
    required this.avgOrderValue,
    required this.totalMargin,
    required this.todaySales,
    required this.todayOrders,
    required this.lastMonthSales,
    required this.growthPercent,
    required this.year,
    required this.month,
  });

  factory DashboardMetrics.fromJson(Map<String, dynamic> json) {
    final period = json['period'] as Map<String, dynamic>?;
    return DashboardMetrics(
      totalSales: (json['totalSales'] as num?)?.toDouble() ?? 0.0,
      totalBoxes: (json['totalBoxes'] as num?)?.toInt() ?? 0,
      totalOrders: (json['totalOrders'] as num?)?.toInt() ?? 0,
      uniqueClients: (json['uniqueClients'] as num?)?.toInt() ?? 0,
      avgOrderValue: (json['avgOrderValue'] as num?)?.toDouble() ?? 0.0,
      totalMargin: (json['totalMargin'] as num?)?.toDouble() ?? 0.0,
      todaySales: (json['todaySales'] as num?)?.toDouble() ?? 0.0,
      todayOrders: (json['todayOrders'] as num?)?.toInt() ?? 0,
      lastMonthSales: (json['lastMonthSales'] as num?)?.toDouble() ?? 0.0,
      growthPercent: (json['growthPercent'] as num?)?.toDouble() ?? 0.0,
      year: period?['year'] as int? ?? DateTime.now().year,
      month: period?['month'] as int? ?? DateTime.now().month,
    );
  }

  double get marginPercent => totalSales > 0 ? (totalMargin / totalSales) * 100 : 0;

  @override
  List<Object?> get props => [
    totalSales, totalBoxes, totalOrders, uniqueClients,
    avgOrderValue, totalMargin, todaySales, todayOrders,
    lastMonthSales, growthPercent, year, month
  ];
}

/// Recent sale model - matches new backend format
class RecentSale extends Equatable {
  final String date;
  final String clientCode;
  final String clientName;
  final String vendedorCode;
  final String type;
  final double totalEuros;
  final double totalMargin;
  final int totalBoxes;
  final int numLines;

  const RecentSale({
    required this.date,
    required this.clientCode,
    required this.clientName,
    required this.vendedorCode,
    required this.type,
    required this.totalEuros,
    required this.totalMargin,
    required this.totalBoxes,
    required this.numLines,
  });

  factory RecentSale.fromJson(Map<String, dynamic> json) {
    return RecentSale(
      date: json['date'] as String? ?? '',
      clientCode: json['clientCode'] as String? ?? '',
      clientName: json['clientName'] as String? ?? 'Sin nombre',
      vendedorCode: json['vendedorCode'] as String? ?? '',
      type: json['type'] as String? ?? 'VT',
      totalEuros: (json['totalEuros'] as num?)?.toDouble() ?? 0.0,
      totalMargin: (json['totalMargin'] as num?)?.toDouble() ?? 0.0,
      totalBoxes: (json['totalBoxes'] as num?)?.toInt() ?? 0,
      numLines: (json['numLines'] as num?)?.toInt() ?? 0,
    );
  }

  DateTime get dateTime => DateTime.tryParse(date) ?? DateTime.now();

  @override
  List<Object?> get props => [date, clientCode, clientName, vendedorCode, type, totalEuros, totalMargin, totalBoxes, numLines];
}

/// Sales evolution data point
class SalesEvolutionPoint extends Equatable {
  final String period;
  final int year;
  final int month;
  final double totalSales;
  final double totalMargin;
  final int totalBoxes;
  final int uniqueClients;

  const SalesEvolutionPoint({
    required this.period,
    required this.year,
    required this.month,
    required this.totalSales,
    required this.totalMargin,
    required this.totalBoxes,
    required this.uniqueClients,
  });

  factory SalesEvolutionPoint.fromJson(Map<String, dynamic> json) {
    return SalesEvolutionPoint(
      period: json['period'] as String? ?? '',
      year: json['year'] as int? ?? 0,
      month: json['month'] as int? ?? 0,
      totalSales: (json['totalSales'] as num?)?.toDouble() ?? 0.0,
      totalMargin: (json['totalMargin'] as num?)?.toDouble() ?? 0.0,
      totalBoxes: (json['totalBoxes'] as num?)?.toInt() ?? 0,
      uniqueClients: (json['uniqueClients'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props => [period, year, month, totalSales, totalMargin, totalBoxes, uniqueClients];
}

/// YoY Comparison model - matches new backend format
class YoYComparison extends Equatable {
  final YearData currentYear;
  final YearData lastYear;
  final GrowthData growth;

  const YoYComparison({
    required this.currentYear,
    required this.lastYear,
    required this.growth,
  });

  factory YoYComparison.fromJson(Map<String, dynamic> json) {
    return YoYComparison(
      currentYear: YearData.fromJson(json['currentYear'] as Map<String, dynamic>? ?? {}),
      lastYear: YearData.fromJson(json['lastYear'] as Map<String, dynamic>? ?? {}),
      growth: GrowthData.fromJson(json['growth'] as Map<String, dynamic>? ?? {}),
    );
  }

  @override
  List<Object?> get props => [currentYear, lastYear, growth];
}

class YearData extends Equatable {
  final int year;
  final double sales;
  final double margin;
  final int boxes;
  final int clients;

  const YearData({
    required this.year,
    required this.sales,
    required this.margin,
    required this.boxes,
    required this.clients,
  });

  factory YearData.fromJson(Map<String, dynamic> json) {
    return YearData(
      year: json['year'] as int? ?? 0,
      sales: (json['sales'] as num?)?.toDouble() ?? 0.0,
      margin: (json['margin'] as num?)?.toDouble() ?? 0.0,
      boxes: (json['boxes'] as num?)?.toInt() ?? 0,
      clients: (json['clients'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props => [year, sales, margin, boxes, clients];
}

class GrowthData extends Equatable {
  final double salesPercent;
  final double marginPercent;

  const GrowthData({
    required this.salesPercent,
    required this.marginPercent,
  });

  factory GrowthData.fromJson(Map<String, dynamic> json) {
    return GrowthData(
      salesPercent: (json['salesPercent'] as num?)?.toDouble() ?? 0.0,
      marginPercent: (json['marginPercent'] as num?)?.toDouble() ?? 0.0,
    );
  }

  @override
  List<Object?> get props => [salesPercent, marginPercent];
}

/// Top Product model
class TopProduct extends Equatable {
  final String code;
  final String name;
  final String? brand;
  final String? family;
  final double totalSales;
  final double totalMargin;
  final double marginPercent;
  final int totalBoxes;
  final int totalUnits;
  final int numClients;

  const TopProduct({
    required this.code,
    required this.name,
    this.brand,
    this.family,
    required this.totalSales,
    required this.totalMargin,
    required this.marginPercent,
    required this.totalBoxes,
    required this.totalUnits,
    required this.numClients,
  });

  factory TopProduct.fromJson(Map<String, dynamic> json) {
    return TopProduct(
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? 'Producto desconocido',
      brand: json['brand'] as String?,
      family: json['family'] as String?,
      totalSales: (json['totalSales'] as num?)?.toDouble() ?? 0.0,
      totalMargin: (json['totalMargin'] as num?)?.toDouble() ?? 0.0,
      marginPercent: (json['marginPercent'] as num?)?.toDouble() ?? 0.0,
      totalBoxes: (json['totalBoxes'] as num?)?.toInt() ?? 0,
      totalUnits: (json['totalUnits'] as num?)?.toInt() ?? 0,
      numClients: (json['numClients'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props => [code, name, brand, family, totalSales, totalMargin, marginPercent, totalBoxes, totalUnits, numClients];
}

/// Top Client model
class TopClient extends Equatable {
  final String code;
  final String name;
  final String? city;
  final double totalSales;
  final double totalMargin;
  final double marginPercent;
  final int totalBoxes;
  final int numOrders;
  final int numProducts;

  const TopClient({
    required this.code,
    required this.name,
    this.city,
    required this.totalSales,
    required this.totalMargin,
    required this.marginPercent,
    required this.totalBoxes,
    required this.numOrders,
    required this.numProducts,
  });

  factory TopClient.fromJson(Map<String, dynamic> json) {
    return TopClient(
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? 'Cliente desconocido',
      city: json['city'] as String?,
      totalSales: (json['totalSales'] as num?)?.toDouble() ?? 0.0,
      totalMargin: (json['totalMargin'] as num?)?.toDouble() ?? 0.0,
      marginPercent: (json['marginPercent'] as num?)?.toDouble() ?? 0.0,
      totalBoxes: (json['totalBoxes'] as num?)?.toInt() ?? 0,
      numOrders: (json['numOrders'] as num?)?.toInt() ?? 0,
      numProducts: (json['numProducts'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props => [code, name, city, totalSales, totalMargin, marginPercent, totalBoxes, numOrders, numProducts];
}
