import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/errors/failure.dart' as errors;
import 'package:gmp_app_mobilidad/core/utils/result.dart' as result;
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repositories/repartidor_finanzas_repository.dart';

class RepartidorFinanzasRepositoryImpl implements RepartidorFinanzasRepository {
  const RepartidorFinanzasRepositoryImpl(this._service);

  final RepartidorFinanzasService _service;

  @override
  Future<result.Result<RepartidorDailySummary>> getDailySummary({
    required String repartidorId,
    required DateTime date,
    bool forceRefresh = false,
  }) =>
      _guard(
        () => _service.getDailySummary(
          repartidorId: repartidorId,
          date: date,
          forceRefresh: forceRefresh,
        ),
      );

  @override
  Future<result.Result<RepartidorLiquidacionResult>> submitLiquidacion({
    required String repartidorId,
    required DateTime date,
    required String idempotencyToken,
    String? matricula,
    String? codigoVehiculo,
    bool sendEmails = true,
  }) =>
      _guard(
        () => _service.closeLiquidacion(
          repartidorId: repartidorId,
          date: date,
          idempotencyToken: idempotencyToken,
          matricula: matricula,
          codigoVehiculo: codigoVehiculo,
          sendEmails: sendEmails,
        ),
      );

  Future<result.Result<T>> _guard<T>(Future<T> Function() operation) async {
    try {
      return result.Success(await operation());
    } catch (error) {
      return result.Failure(_mapFailure(error));
    }
  }

  errors.Failure _mapFailure(Object error) {
    if (error is RepartidorLiquidacionInputException ||
        error is ArgumentError) {
      return errors.ValidationFailure(error.toString());
    }
    if (error is ApiException) {
      if (error.statusCode == null || error.statusCode == 0) {
        return errors.NetworkFailure(
          error.message,
          error.code,
          error.confirmationId,
          error.message,
        );
      }
      return errors.ServerFailure(
        error.message,
        statusCode: error.statusCode,
        code: error.code,
        confirmationId: error.confirmationId,
        originalMessage: error.message,
      );
    }
    if (error is FormatException) {
      return errors.ValidationFailure(error.message);
    }
    return errors.UnknownFailure(error.toString());
  }
}
