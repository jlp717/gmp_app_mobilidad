import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/models/dashboard_models.dart';

void main() {
  group('DashboardMetrics', () {
    test('should parse from JSON correctly', () {
      final json = {
        'totalSales': 125430.50,
        'totalBoxes': 5420,
        'totalOrders': 342,
        'uniqueClients': 87,
        'avgOrderValue': 366.75,
        'totalMargin': 18250.25,
        'todaySales': 4520.00,
        'todayOrders': 12,
        'lastMonthSales': 115000.00,
        'growthPercent': 9.1,
        'period': {'year': 2025, 'month': 3}
      };

      final metrics = DashboardMetrics.fromJson(json);

      expect(metrics.totalSales, 125430.50);
      expect(metrics.totalBoxes, 5420);
      expect(metrics.totalOrders, 342);
      expect(metrics.uniqueClients, 87);
      expect(metrics.avgOrderValue, 366.75);
      expect(metrics.totalMargin, 18250.25);
      expect(metrics.todaySales, 4520.00);
      expect(metrics.todayOrders, 12);
      expect(metrics.lastMonthSales, 115000.00);
      expect(metrics.growthPercent, 9.1);
      expect(metrics.year, 2025);
      expect(metrics.month, 3);
    });

    test('should handle null values with defaults', () {
      final json = <String, dynamic>{};

      final metrics = DashboardMetrics.fromJson(json);

      expect(metrics.totalSales, 0.0);
      expect(metrics.totalBoxes, 0);
      expect(metrics.totalOrders, 0);
      expect(metrics.uniqueClients, 0);
      expect(metrics.totalMargin, 0.0);
    });

    test('should calculate marginPercent correctly', () {
      final json = {
        'totalSales': 100000.0,
        'totalMargin': 15000.0,
      };

      final metrics = DashboardMetrics.fromJson(json);

      expect(metrics.marginPercent, 15.0);
    });

    test('should handle zero sales for marginPercent', () {
      final json = {
        'totalSales': 0.0,
        'totalMargin': 0.0,
      };

      final metrics = DashboardMetrics.fromJson(json);

      expect(metrics.marginPercent, 0.0);
    });
  });

  group('RecentSale', () {
    test('should parse from JSON correctly', () {
      final json = {
        'date': '2025-03-15',
        'clientCode': 'CLI001',
        'clientName': 'Restaurante El Buen Gusto',
        'vendedorCode': '095',
        'type': 'VT',
        'totalEuros': 845.50,
        'totalMargin': 127.50,
        'totalBoxes': 25,
        'numLines': 8
      };

      final sale = RecentSale.fromJson(json);

      expect(sale.date, '2025-03-15');
      expect(sale.clientCode, 'CLI001');
      expect(sale.clientName, 'Restaurante El Buen Gusto');
      expect(sale.vendedorCode, '095');
      expect(sale.type, 'VT');
      expect(sale.totalEuros, 845.50);
      expect(sale.totalMargin, 127.50);
      expect(sale.totalBoxes, 25);
      expect(sale.numLines, 8);
    });

    test('should provide default values for missing fields', () {
      final json = <String, dynamic>{};

      final sale = RecentSale.fromJson(json);

      expect(sale.date, '');
      expect(sale.clientName, 'Sin nombre');
      expect(sale.type, 'VT');
      expect(sale.totalEuros, 0.0);
    });

    test('dateTime getter should parse date string correctly', () {
      final json = {
        'date': '2025-12-19',
      };

      final sale = RecentSale.fromJson(json);
      final dateTime = sale.dateTime;

      expect(dateTime.year, 2025);
      expect(dateTime.month, 12);
      expect(dateTime.day, 19);
    });
  });

  group('SalesEvolutionPoint', () {
    test('should parse from JSON correctly', () {
      final json = {
        'period': '2025-03',
        'year': 2025,
        'month': 3,
        'totalSales': 125000.0,
        'totalMargin': 18750.0,
        'totalBoxes': 4500,
        'uniqueClients': 95
      };

      final point = SalesEvolutionPoint.fromJson(json);

      expect(point.period, '2025-03');
      expect(point.year, 2025);
      expect(point.month, 3);
      expect(point.totalSales, 125000.0);
      expect(point.totalMargin, 18750.0);
      expect(point.totalBoxes, 4500);
      expect(point.uniqueClients, 95);
    });
  });

  group('YoYComparison', () {
    test('should parse from JSON correctly', () {
      final json = {
        'currentYear': {
          'year': 2025,
          'sales': 1250000.0,
          'margin': 187500.0,
          'boxes': 45000,
          'clients': 120
        },
        'lastYear': {
          'year': 2024,
          'sales': 1100000.0,
          'margin': 165000.0,
          'boxes': 40000,
          'clients': 110
        },
        'growth': {
          'salesPercent': 13.6,
          'marginPercent': 13.6
        }
      };

      final comparison = YoYComparison.fromJson(json);

      expect(comparison.currentYear.year, 2025);
      expect(comparison.currentYear.sales, 1250000.0);
      expect(comparison.lastYear.year, 2024);
      expect(comparison.lastYear.sales, 1100000.0);
      expect(comparison.growth.salesPercent, 13.6);
    });

    test('should handle empty JSON', () {
      final json = <String, dynamic>{};

      final comparison = YoYComparison.fromJson(json);

      expect(comparison.currentYear.year, 0);
      expect(comparison.currentYear.sales, 0.0);
      expect(comparison.growth.salesPercent, 0.0);
    });
  });

  group('TopProduct', () {
    test('should parse from JSON correctly', () {
      final json = {
        'code': '7713',
        'name': 'HUEVOS CAMPEROS M 12 UDS',
        'brand': 'ECO',
        'family': 'HUEVOS',
        'totalSales': 45000.0,
        'totalMargin': 6750.0,
        'marginPercent': 15.0,
        'totalBoxes': 1200,
        'totalUnits': 14400,
        'numClients': 45
      };

      final product = TopProduct.fromJson(json);

      expect(product.code, '7713');
      expect(product.name, 'HUEVOS CAMPEROS M 12 UDS');
      expect(product.brand, 'ECO');
      expect(product.family, 'HUEVOS');
      expect(product.totalSales, 45000.0);
      expect(product.totalMargin, 6750.0);
      expect(product.marginPercent, 15.0);
      expect(product.totalBoxes, 1200);
      expect(product.totalUnits, 14400);
      expect(product.numClients, 45);
    });

    test('should handle missing optional fields', () {
      final json = {
        'code': 'TEST',
        'name': 'Test Product',
        'totalSales': 100.0,
        'totalMargin': 15.0,
        'marginPercent': 15.0,
        'totalBoxes': 10,
        'totalUnits': 100,
        'numClients': 5
      };

      final product = TopProduct.fromJson(json);

      expect(product.brand, null);
      expect(product.family, null);
    });
  });

  group('TopClient', () {
    test('should parse from JSON correctly', () {
      final json = {
        'code': 'CLI001',
        'name': 'Bar El Rinconcito',
        'city': 'Almería',
        'totalSales': 35000.0,
        'totalMargin': 5250.0,
        'marginPercent': 15.0,
        'totalBoxes': 900,
        'numOrders': 52,
        'numProducts': 28
      };

      final client = TopClient.fromJson(json);

      expect(client.code, 'CLI001');
      expect(client.name, 'Bar El Rinconcito');
      expect(client.city, 'Almería');
      expect(client.totalSales, 35000.0);
      expect(client.totalMargin, 5250.0);
      expect(client.marginPercent, 15.0);
      expect(client.totalBoxes, 900);
      expect(client.numOrders, 52);
      expect(client.numProducts, 28);
    });

    test('should use default name when missing', () {
      final json = <String, dynamic>{
        'code': 'X123',
      };

      final client = TopClient.fromJson(json);

      expect(client.name, 'Cliente desconocido');
    });
  });

  group('GrowthData', () {
    test('should parse positive growth', () {
      final json = {
        'salesPercent': 12.5,
        'marginPercent': 8.3
      };

      final growth = GrowthData.fromJson(json);

      expect(growth.salesPercent, 12.5);
      expect(growth.marginPercent, 8.3);
    });

    test('should parse negative growth', () {
      final json = {
        'salesPercent': -5.2,
        'marginPercent': -3.1
      };

      final growth = GrowthData.fromJson(json);

      expect(growth.salesPercent, -5.2);
      expect(growth.marginPercent, -3.1);
    });
  });
}
