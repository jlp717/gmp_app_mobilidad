import 'package:equatable/equatable.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

/// Data model for analytics information.
class AnalyticsData extends Equatable {
  final double totalSales;
  final int totalOrders;
  final int totalClients;
  final Map<String, dynamic> rawData;

  const AnalyticsData({
    this.totalSales = 0,
    this.totalOrders = 0,
    this.totalClients = 0,
    this.rawData = const {},
  });

  factory AnalyticsData.fromJson(Map<String, dynamic> json) {
    return AnalyticsData(
      totalSales: (json['totalSales'] as num?)?.toDouble() ?? 0,
      totalOrders: (json['totalOrders'] as num?)?.toInt() ?? 0,
      totalClients: (json['totalClients'] as num?)?.toInt() ?? 0,
      rawData: json,
    );
  }

  @override
  List<Object?> get props => [totalSales, totalOrders, totalClients];
}

/// Repository for fetching analytics data from the backend.
class AnalyticsRepository {
  Future<AnalyticsData> getAnalyticsData() async {
    try {
      final response = await ApiClient.get('/analytics/summary');
      return AnalyticsData.fromJson(response);
    } catch (e) {
      return const AnalyticsData();
    }
  }
}
