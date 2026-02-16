/// Objectives Service - centralizes objectives-related API calls
/// Used by objectives_page

import '../../../core/api/api_client.dart';
import '../../../core/api/api_config.dart';

class ObjectivesService {
  /// Fetch list of distinct populations/cities
  static Future<List<String>> getPopulations() async {
    final res = await ApiClient.getList('/objectives/populations');
    return res.map((e) => e.toString()).toList();
  }

  /// Fetch evolution data for given vendor and years
  static Future<Map<String, dynamic>> getEvolution({
    required String vendedorCodes,
    required List<int> years,
  }) async {
    return await ApiClient.get(
      ApiConfig.objectivesEvolution,
      queryParameters: {
        'vendedorCodes': vendedorCodes,
        'years': years.join(','),
      },
    );
  }

  /// Fetch by-client objectives for given vendor and periods
  static Future<Map<String, dynamic>> getByClient({
    required String vendedorCodes,
    required List<int> years,
    List<int>? months,
    String? city,
    String? code,
    String? nif,
    String? name,
    int? limit,
  }) async {
    final params = <String, dynamic>{
      'vendedorCodes': vendedorCodes,
      'years': years.join(','),
    };
    if (months != null && months.isNotEmpty) {
      params['months'] = months.join(',');
    }
    if (city != null && city.isNotEmpty) {
      params['city'] = city;
    }
    if (code != null && code.isNotEmpty) params['code'] = code;
    if (nif != null && nif.isNotEmpty) params['nif'] = nif;
    if (name != null && name.isNotEmpty) params['name'] = name;
    if (limit != null) {
      params['limit'] = limit.toString();
    }

    return await ApiClient.get(
      ApiConfig.objectivesByClient,
      queryParameters: params,
    );
  }
}
