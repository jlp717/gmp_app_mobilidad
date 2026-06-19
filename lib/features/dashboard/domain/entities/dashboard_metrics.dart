import 'package:equatable/equatable.dart';

/// Top-level dashboard metrics container.
class DashboardMetrics extends Equatable {
  const DashboardMetrics({
    this.vencimientos = const VencimientosMetrics(),
    this.cobros = const CobrosMetrics(),
    this.pedidos = const PedidosMetrics(),
    this.salesSummary = const SalesSummary(),
  });
  final VencimientosMetrics vencimientos;
  final CobrosMetrics cobros;
  final PedidosMetrics pedidos;
  final SalesSummary salesSummary;

  @override
  List<Object?> get props => [vencimientos, cobros, pedidos, salesSummary];
}

/// Vencimientos (due dates / expirations).
class VencimientosMetrics extends Equatable {
  const VencimientosMetrics({
    this.pendingCount = 0,
    this.totalAmount = 0,
  });
  final int pendingCount;
  final double totalAmount;

  @override
  List<Object?> get props => [pendingCount, totalAmount];
}

/// Cobros (collections / payments received).
class CobrosMetrics extends Equatable {
  const CobrosMetrics({
    this.realizedCount = 0,
    this.totalAmount = 0,
  });
  final int realizedCount;
  final double totalAmount;

  @override
  List<Object?> get props => [realizedCount, totalAmount];
}

/// Pedidos (orders).
class PedidosMetrics extends Equatable {
  const PedidosMetrics({
    this.pendingCount = 0,
    this.totalAmount = 0,
  });
  final int pendingCount;
  final double totalAmount;

  @override
  List<Object?> get props => [pendingCount, totalAmount];
}

/// Sales summary with daily breakdown.
class SalesSummary extends Equatable {
  const SalesSummary({
    this.totalSales = 0,
    this.totalUnits = 0,
    this.previousPeriodSales = 0,
    this.dailyData = const [],
  });
  final double totalSales;
  final int totalUnits;
  final double previousPeriodSales;
  final List<DailySalesData> dailyData;

  /// Growth percentage vs previous period.
  double get salesGrowth {
    if (previousPeriodSales <= 0) return 0;
    return ((totalSales - previousPeriodSales) / previousPeriodSales) * 100;
  }

  @override
  List<Object?> get props =>
      [totalSales, totalUnits, previousPeriodSales, dailyData];
}

/// Single day sales data point.
class DailySalesData extends Equatable {
  const DailySalesData({
    required this.dayLabel,
    this.sales = 0,
    this.units = 0,
  });
  final String dayLabel;
  final double sales;
  final int units;

  @override
  List<Object?> get props => [dayLabel, sales, units];
}

/// Recent sale entry.
class UltimaVenta extends Equatable {
  const UltimaVenta({
    required this.fecha,
    required this.cliente,
    required this.numeroAlbaran,
    this.importe = 0,
  });
  final String fecha;
  final String cliente;
  final String numeroAlbaran;
  final double importe;

  @override
  List<Object?> get props => [fecha, cliente, numeroAlbaran, importe];
}

/// Sales metrics (today / year).
class VentasMetrics extends Equatable {
  const VentasMetrics({
    this.total = 0,
    this.cantidad = 0,
    this.margen = 0,
  });
  final double total;
  final int cantidad;
  final double margen;

  @override
  List<Object?> get props => [total, cantidad, margen];
}

/// Monthly sales metrics with previous month comparison.
class VentasMesMetrics extends Equatable {
  const VentasMesMetrics({
    this.total = 0,
    this.cantidad = 0,
    this.margen = 0,
    this.comparativaMesAnterior = 0,
  });
  final double total;
  final int cantidad;
  final double margen;
  final double comparativaMesAnterior;

  @override
  List<Object?> get props => [total, cantidad, margen, comparativaMesAnterior];
}

/// Clients attended count.
class ClientesAtendidos extends Equatable {
  const ClientesAtendidos({
    this.hoy = 0,
    this.mes = 0,
  });
  final int hoy;
  final int mes;

  @override
  List<Object?> get props => [hoy, mes];
}
