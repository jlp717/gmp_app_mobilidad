import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';

void main() {
  group('ApiConfig', () {
    test('should have correct base URL format', () {
      expect(ApiConfig.baseUrl, startsWith('https://'));
      expect(Uri.parse(ApiConfig.baseUrl).host, isNotEmpty);
      // Production default embeds /api; compile-time API_BASE_URL overrides (test isolation) may omit it.
      if (!const bool.hasEnvironment('API_BASE_URL')) {
        expect(ApiConfig.baseUrl, contains('/api'));
      }
    });

    test('should have correct endpoint paths', () {
      expect(ApiConfig.login, '/auth/login');
      expect(ApiConfig.dashboardMetrics, '/dashboard/metrics');
      expect(ApiConfig.salesEvolution, '/dashboard/sales-evolution');
      expect(ApiConfig.yoyComparison, '/analytics/yoy-comparison');
      expect(ApiConfig.recentSales, '/dashboard/recent-sales');
      expect(ApiConfig.clientsList, '/clients');
      expect(ApiConfig.clientDetail, '/clients');
      expect(ApiConfig.routerCalendar, '/router/calendar');
      expect(ApiConfig.topProducts, '/analytics/top-products');
      expect(ApiConfig.topClients, '/analytics/top-clients');
      expect(ApiConfig.productsList, '/products');
      expect(ApiConfig.vendedores, '/vendedores');
      expect(ApiConfig.health, '/health');
    });

    test('should have reasonable timeout values', () {
      expect(ApiConfig.connectTimeout.inSeconds, greaterThanOrEqualTo(10));
      expect(ApiConfig.receiveTimeout.inSeconds, greaterThanOrEqualTo(10));
    });

    test('should have correct min year for data filtering', () {
      expect(ApiConfig.minYear, ApiConfig.currentYear - 2);
    });

    test('should have valid pagination defaults', () {
      expect(ApiConfig.defaultPageSize, greaterThan(0));
      expect(ApiConfig.maxPageSize, greaterThan(ApiConfig.defaultPageSize));
    });
  });
}
