import 'package:get_it/get_it.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repositories/repartidor_finanzas_repository_impl.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repositories/repartidor_finanzas_repository.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/usecases/get_daily_summary_usecase.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/usecases/submit_liquidacion_usecase.dart';

// ponytail: registro manual get_it; migrar a injectable codegen si supera ~20 registros.
void configureDependencies() {
  final getIt = GetIt.I;
  // Guard sobre el ULTIMO del grafo: garantiza que la cadena completa
  // (service -> repository -> usecases) existe antes de salir.
  if (getIt.isRegistered<SubmitLiquidacionUseCase>()) return;

  getIt
    ..registerLazySingleton(RepartidorFinanzasService.new)
    ..registerLazySingleton<RepartidorFinanzasRepository>(
      () => RepartidorFinanzasRepositoryImpl(getIt()),
    )
    ..registerLazySingleton(() => GetDailySummaryUseCase(getIt()))
    ..registerLazySingleton(() => SubmitLiquidacionUseCase(getIt()));
}
