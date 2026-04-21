/// Objectives Service - centralizes objectives-related API calls
/// Used by objectives_page
library;

import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';

class ObjectivesService {
  /// Fetch list of distinct populations/cities
  static Future<List<String>> getPopulations() async {
    final res = await ApiClient.getList(
      '/objectives/populations',
      cacheKey: 'objectives_populations',
      cacheTTL: CacheService.longTTL,
    );
    return res.map((e) => e.toString()).toList();
  }

  /// Fetch evolution data for given vendor and years
  static Future<Map<String, dynamic>> getEvolution({
    required String vendedorCodes,
    required List<int> years,
  }) async {
    final yearsKey = years.toList()..sort();
    return ApiClient.get(
      ApiConfig.objectivesEvolution,
      queryParameters: {
        'vendedorCodes': vendedorCodes,
        'years': years.join(','),
      },
      cacheKey: 'objectives_evolution_${vendedorCodes}_${yearsKey.join('-')}',
      cacheTTL: const Duration(minutes: 10),
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

    final yearsKey = years.toList()..sort();
    final monthsKey = (months ?? const <int>[]).toList()..sort();
    final normalizedCity = city ?? '';
    final normalizedCode = code ?? '';
    final normalizedNif = nif ?? '';
    final normalizedName = name ?? '';

    return ApiClient.get(
      ApiConfig.objectivesByClient,
      queryParameters: params,
      cacheKey:
          'objectives_by_client_${vendedorCodes}_${yearsKey.join('-')}_${monthsKey.join('-')}_${normalizedCity}_${normalizedCode}_${normalizedNif}_${normalizedName}_${limit ?? 'all'}',
      cacheTTL: const Duration(minutes: 5),
    );
  }
}
