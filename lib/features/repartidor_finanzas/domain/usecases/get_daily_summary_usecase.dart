import 'package:gmp_app_mobilidad/core/utils/result.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repositories/repartidor_finanzas_repository.dart';

class GetDailySummaryUseCase {
  const GetDailySummaryUseCase(this._repository);

  final RepartidorFinanzasRepository _repository;

  Future<Result<RepartidorDailySummary>> call({
    required String repartidorId,
    required DateTime date,
    bool forceRefresh = false,
  }) =>
      _repository.getDailySummary(
        repartidorId: repartidorId,
        date: date,
        forceRefresh: forceRefresh,
      );
}
