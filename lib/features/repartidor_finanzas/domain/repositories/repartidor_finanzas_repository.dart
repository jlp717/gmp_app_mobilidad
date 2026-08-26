import 'package:gmp_app_mobilidad/core/utils/result.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

abstract interface class RepartidorFinanzasRepository {
  Future<Result<RepartidorDailySummary>> getDailySummary({
    required String repartidorId,
    required DateTime date,
    bool forceRefresh = false,
  });

  Future<Result<RepartidorLiquidacionResult>> submitLiquidacion({
    required String repartidorId,
    required DateTime date,
    required String idempotencyToken,
    String? matricula,
    String? codigoVehiculo,
    bool sendEmails = true,
  });
}
