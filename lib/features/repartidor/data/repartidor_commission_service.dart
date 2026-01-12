/// REPARTIDOR COMMISSION SERVICE
/// Servicio de cálculo de comisiones para repartidores
/// Umbral 30% antes de aplicar los 4 tramos de comisión

import '../../../../core/api/api_client.dart';

/// Tramos de comisión (idénticos a comerciales, pero solo aplican post-30%)
/// Tier 1: 100-103% = 1.0%
/// Tier 2: 103-106% = 1.3%
/// Tier 3: 106-110% = 1.6%
/// Tier 4: >110% = 2.0%
class CommissionTier {
  final int tier;
  final double minPct;
  final double maxPct;
  final double rate;
  final String label;

  const CommissionTier({
    required this.tier,
    required this.minPct,
    required this.maxPct,
    required this.rate,
    required this.label,
  });
}

/// Los 4 tramos de comisión (iguales que comerciales)
const List<CommissionTier> commissionTiers = [
  CommissionTier(tier: 1, minPct: 100.0, maxPct: 103.0, rate: 0.010, label: '100-103% → 1.0%'),
  CommissionTier(tier: 2, minPct: 103.0, maxPct: 106.0, rate: 0.013, label: '103-106% → 1.3%'),
  CommissionTier(tier: 3, minPct: 106.0, maxPct: 110.0, rate: 0.016, label: '106-110% → 1.6%'),
  CommissionTier(tier: 4, minPct: 110.0, maxPct: double.infinity, rate: 0.020, label: '>110% → 2.0%'),
];

/// Umbral de cobro para empezar a generar comisión
const double thresholdPercentage = 30.0;

/// Resultado del cálculo de comisión
class CommissionResult {
  final double collectable;
  final double collected;
  final double percentageCollected;
  final bool thresholdMet;
  final double thresholdProgress;
  final int currentTier;
  final double commissionEarned;
  final String tierLabel;

  const CommissionResult({
    required this.collectable,
    required this.collected,
    required this.percentageCollected,
    required this.thresholdMet,
    required this.thresholdProgress,
    required this.currentTier,
    required this.commissionEarned,
    required this.tierLabel,
  });

  factory CommissionResult.empty() => const CommissionResult(
    collectable: 0.0,
    collected: 0.0,
    percentageCollected: 0.0,
    thresholdMet: false,
    thresholdProgress: 0.0,
    currentTier: 0,
    commissionEarned: 0.0,
    tierLabel: 'Sin cobros',
  );
}

/// Servicio de comisiones para repartidores
class RepartidorCommissionService {
  
  /// Calcular comisión para un cliente específico
  /// Solo aplica si se ha cobrado >= 30% del monto cobrable
  static CommissionResult calculateCommission({
    required double collectable,
    required double collected,
  }) {
    if (collectable <= 0) {
      return CommissionResult.empty();
    }

    final percentageCollected = (collected / collectable) * 100;
    final thresholdProgress = (percentageCollected / thresholdPercentage).clamp(0.0, 1.0);
    final thresholdMet = percentageCollected >= thresholdPercentage;

    // Si no se ha alcanzado el umbral del 30%, no hay comisión
    if (!thresholdMet) {
      return CommissionResult(
        collectable: collectable,
        collected: collected,
        percentageCollected: percentageCollected,
        thresholdMet: false,
        thresholdProgress: thresholdProgress,
        currentTier: 0,
        commissionEarned: 0.0,
        tierLabel: 'Umbral no alcanzado (${percentageCollected.toStringAsFixed(1)}% de 30%)',
      );
    }

    // Calcular comisión por tramos sobre el exceso
    // El "target" para comisión es el 100% del cobrable
    // La comisión aplica sobre el exceso según el tramo
    
    // Determinar el tier actual basado en el % cobrado
    int currentTier = 0;
    double rate = 0;
    String tierLabel = '';
    
    for (final tier in commissionTiers) {
      if (percentageCollected >= tier.minPct) {
        currentTier = tier.tier;
        rate = tier.rate;
        tierLabel = tier.label;
      }
    }

    // Si el porcentaje es menor a 100%, no hay comisión (solo umbral alcanzado)
    if (percentageCollected < 100) {
      return CommissionResult(
        collectable: collectable,
        collected: collected,
        percentageCollected: percentageCollected,
        thresholdMet: true,
        thresholdProgress: 1.0,
        currentTier: 0,
        commissionEarned: 0.0,
        tierLabel: 'Umbral OK - Sin exceso para comisionar',
      );
    }

    // Calcular comisión sobre el exceso
    final excess = collected - collectable;
    final commission = excess * rate;

    return CommissionResult(
      collectable: collectable,
      collected: collected,
      percentageCollected: percentageCollected,
      thresholdMet: true,
      thresholdProgress: 1.0,
      currentTier: currentTier,
      commissionEarned: commission,
      tierLabel: 'Franja $currentTier: $tierLabel',
    );
  }

  /// Obtener resumen de comisiones del backend
  static Future<Map<String, dynamic>> getSummary({
    required String repartidorId,
    int? year,
    int? month,
  }) async {
    try {
      final queryParams = <String, String>{
        'repartidorId': repartidorId,
      };
      
      if (year != null) queryParams['year'] = year.toString();
      if (month != null) queryParams['month'] = month.toString();

      final response = await ApiClient.get(
        '/repartidor/commissions/summary',
        queryParameters: queryParams,
      );
      
      return response;
    } catch (e) {
      throw Exception('Error cargando comisiones repartidor: $e');
    }
  }

  /// Obtener desglose por cliente
  static Future<List<Map<String, dynamic>>> getByClient({
    required String repartidorId,
    int? year,
    int? month,
  }) async {
    try {
      final queryParams = <String, String>{
        'repartidorId': repartidorId,
      };
      
      if (year != null) queryParams['year'] = year.toString();
      if (month != null) queryParams['month'] = month.toString();

      final response = await ApiClient.get(
        '/repartidor/commissions/by-client',
        queryParameters: queryParams,
      );
      
      if (response is List) {
        return List<Map<String, dynamic>>.from(response);
      }
      
      return (response['clients'] as List?)
          ?.cast<Map<String, dynamic>>() ?? [];
    } catch (e) {
      throw Exception('Error cargando desglose por cliente: $e');
    }
  }

  /// Obtener acumulados diarios
  static Future<List<Map<String, dynamic>>> getDailyAccumulated({
    required String repartidorId,
    int? year,
    int? month,
  }) async {
    try {
      final queryParams = <String, String>{
        'repartidorId': repartidorId,
      };
      
      if (year != null) queryParams['year'] = year.toString();
      if (month != null) queryParams['month'] = month.toString();

      final response = await ApiClient.get(
        '/repartidor/commissions/daily',
        queryParameters: queryParams,
      );
      
      if (response is List) {
        return List<Map<String, dynamic>>.from(response);
      }
      
      return (response['daily'] as List?)
          ?.cast<Map<String, dynamic>>() ?? [];
    } catch (e) {
      throw Exception('Error cargando acumulados diarios: $e');
    }
  }
}
