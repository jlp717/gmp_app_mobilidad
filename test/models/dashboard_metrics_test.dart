// GMP Dashboard Models Tests
import 'package:flutter_test/flutter_test.dart';

class DashboardMetrics {
  DashboardMetrics({
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
  });

  factory DashboardMetrics.empty() {
    return DashboardMetrics(
      totalSales: 0,
      totalBoxes: 0,
      totalOrders: 0,
      uniqueClients: 0,
      avgOrderValue: 0,
      totalMargin: 0,
      todaySales: 0,
      todayOrders: 0,
      lastMonthSales: 0,
      growthPercent: 0,
    );
  }
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

  bool get hasData => totalOrders > 0;
  double get growthPercentage => growthPercent;
}

class KPISummary {
  KPISummary({
    required this.label,
    required this.value,
    required this.target,
    this.unit = '',
  });
  final String label;
  final double value;
  final double target;
  final String unit;

  double get progress => target > 0 ? value / target : 0.0;
  bool get isOnTarget => progress >= 1.0;
}

void main() {
  group('DashboardMetrics Tests', () {
    test('creates empty metrics', () {
      final metrics = DashboardMetrics.empty();

      expect(metrics.totalSales, 0.0);
      expect(metrics.totalBoxes, 0);
      expect(metrics.totalOrders, 0);
      expect(metrics.uniqueClients, 0);
    });

    test('hasData returns false when no orders', () {
      final metrics = DashboardMetrics.empty();
      expect(metrics.hasData, false);
    });

    test('hasData returns true when has orders', () {
      final metrics = DashboardMetrics(
        totalSales: 1000,
        totalBoxes: 10,
        totalOrders: 5,
        uniqueClients: 3,
        avgOrderValue: 200,
        totalMargin: 100,
        todaySales: 500,
        todayOrders: 2,
        lastMonthSales: 800,
        growthPercent: 25,
      );
      expect(metrics.hasData, true);
    });

    test('growthPercentage returns correct value', () {
      final metrics = DashboardMetrics(
        totalSales: 1000,
        totalBoxes: 10,
        totalOrders: 5,
        uniqueClients: 3,
        avgOrderValue: 200,
        totalMargin: 100,
        todaySales: 500,
        todayOrders: 2,
        lastMonthSales: 800,
        growthPercent: 25,
      );
      expect(metrics.growthPercentage, 25.0);
    });
  });

  group('KPISummary Tests', () {
    test('calculates progress correctly', () {
      final kpi = KPISummary(
        label: 'Sales',
        value: 75,
        target: 100,
      );
      expect(kpi.progress, 0.75);
    });

    test('progress is 0 when target is 0', () {
      final kpi = KPISummary(
        label: 'Sales',
        value: 75,
        target: 0,
      );
      expect(kpi.progress, 0.0);
    });

    test('isOnTarget returns true when progress >= 1', () {
      final kpi = KPISummary(
        label: 'Sales',
        value: 100,
        target: 100,
      );
      expect(kpi.isOnTarget, true);
    });

    test('isOnTarget returns false when below target', () {
      final kpi = KPISummary(
        label: 'Sales',
        value: 75,
        target: 100,
      );
      expect(kpi.isOnTarget, false);
    });

    test('default unit is empty', () {
      final kpi = KPISummary(
        label: 'Test',
        value: 100,
        target: 100,
      );
      expect(kpi.unit, '');
    });

    test('custom unit is preserved', () {
      final kpi = KPISummary(
        label: 'Sales',
        value: 1000,
        target: 2000,
        unit: '€',
      );
      expect(kpi.unit, '€');
    });
  });
}
