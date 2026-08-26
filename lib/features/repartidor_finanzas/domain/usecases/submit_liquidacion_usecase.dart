import 'package:gmp_app_mobilidad/core/utils/result.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repositories/repartidor_finanzas_repository.dart';

class SubmitLiquidacionUseCase {
  const SubmitLiquidacionUseCase(this._repository);

  final RepartidorFinanzasRepository _repository;

  Future<Result<RepartidorLiquidacionResult>> call({
    required String repartidorId,
    required DateTime date,
    required String idempotencyToken,
    String? matricula,
    String? codigoVehiculo,
    bool sendEmails = true,
  }) =>
      _repository.submitLiquidacion(
        repartidorId: repartidorId,
        date: date,
        idempotencyToken: idempotencyToken,
        matricula: matricula,
        codigoVehiculo: codigoVehiculo,
        sendEmails: sendEmails,
      );
}
