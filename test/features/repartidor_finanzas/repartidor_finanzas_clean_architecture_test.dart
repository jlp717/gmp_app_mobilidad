import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/errors/failure.dart' as errors;
import 'package:gmp_app_mobilidad/core/utils/result.dart' as result;
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repositories/repartidor_finanzas_repository_impl.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/usecases/get_daily_summary_usecase.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/usecases/submit_liquidacion_usecase.dart';

class _FakeService extends RepartidorFinanzasService {
  _FakeService({this.dailySummary, this.dailyError, this.liquidacion});

  final RepartidorDailySummary? dailySummary;
  final Object? dailyError;
  final RepartidorLiquidacionResult? liquidacion;

  @override
  Future<RepartidorDailySummary> getDailySummary({
    required String repartidorId,
    required DateTime date,
    bool forceRefresh = false,
  }) async {
    if (dailyError != null) throw dailyError!;
    return dailySummary!;
  }

  @override
  Future<RepartidorLiquidacionResult> closeLiquidacion({
    required String repartidorId,
    required DateTime date,
    required String idempotencyToken,
    String? matricula,
    String? codigoVehiculo,
    bool sendEmails = true,
  }) async =>
      liquidacion!;
}

RepartidorDailySummary _summary() => RepartidorDailySummary(
      repartidorId: '8',
      date: '2026-08-26',
      totalEfectivo: 0,
      totalCheques: 0,
      totalTarjeta: 0,
      totalPostdatados: 0,
      saldoActual: 0,
      totalCobrosDia: 0,
      gastos: 0,
      totalAIngresar: 0,
      cobrosCount: 0,
    );

RepartidorLiquidacionResult _liquidacion() => const RepartidorLiquidacionResult(
      created: true,
      id: '1',
      marker: 'GMP-1',
      repartidorId: '8',
      date: '2026-08-26',
      status: 'CLOSED',
      snapshot: RepartidorLiquidacionSnapshot(
        deliveries: 0,
        payments: 0,
        expenses: 0,
        adjustments: 0,
        bankDeposits: 0,
        pending: 0,
        openingBalance: 0,
        balance: 0,
      ),
    );

void main() {
  test('daily summary use case returns service success', () async {
    final expected = _summary();
    final useCase = GetDailySummaryUseCase(
      RepartidorFinanzasRepositoryImpl(_FakeService(dailySummary: expected)),
    );

    final outcome =
        await useCase(repartidorId: '8', date: DateTime(2026, 8, 26));
    expect(outcome, isA<result.Success<RepartidorDailySummary>>());
    expect(
      outcome.fold(onSuccess: (value) => value, onFailure: (_) => null),
      expected,
    );
  });

  test('submit liquidacion use case returns service success', () async {
    final expected = _liquidacion();
    final useCase = SubmitLiquidacionUseCase(
      RepartidorFinanzasRepositoryImpl(_FakeService(liquidacion: expected)),
    );

    final outcome = await useCase(
      repartidorId: '8',
      date: DateTime(2026, 8, 26),
      idempotencyToken: 'fixture-idempotency-token',
    );
    expect(
      outcome.fold(onSuccess: (value) => value.id, onFailure: (_) => ''),
      '1',
    );
  });

  test('repository maps network errors to failure', () async {
    final repository = RepartidorFinanzasRepositoryImpl(
      _FakeService(dailyError: ApiException('sin red', statusCode: 0)),
    );

    final outcome = await repository.getDailySummary(
      repartidorId: '8',
      date: DateTime(2026, 8, 26),
    );
    expect(outcome, isA<result.Failure<RepartidorDailySummary>>());
    expect(
      outcome.fold(
        onSuccess: (_) => false,
        onFailure: (error) => error is errors.NetworkFailure,
      ),
      isTrue,
    );
  });

  test('repository preserves ApiException code and confirmationId', () async {
    final repository = RepartidorFinanzasRepositoryImpl(
      _FakeService(
        dailyError: ApiException(
          'conflicto de liquidacion',
          statusCode: 500,
          code: 'CONFLICT',
          confirmationId: 'GMP-2026-0001',
        ),
      ),
    );

    final outcome = await repository.getDailySummary(
      repartidorId: '8',
      date: DateTime(2026, 8, 26),
    );
    final failure = outcome.fold<errors.Failure?>(
      onSuccess: (_) => null,
      onFailure: (error) => error as errors.Failure,
    );
    expect(failure, isA<errors.ServerFailure>());
    expect(failure!.message, 'conflicto de liquidacion');
    expect(failure.code, 'CONFLICT');
    expect(failure.confirmationId, 'GMP-2026-0001');
    expect(failure.originalMessage, 'conflicto de liquidacion');
  });

  test('repository maps validation errors to ValidationFailure', () async {
    final repository = RepartidorFinanzasRepositoryImpl(
      _FakeService(dailyError: ArgumentError('importe invalido')),
    );

    final outcome = await repository.getDailySummary(
      repartidorId: '8',
      date: DateTime(2026, 8, 26),
    );
    expect(
      outcome.fold(
        onSuccess: (_) => false,
        onFailure: (error) => error is errors.ValidationFailure,
      ),
      isTrue,
    );
  });

  test('repository maps unknown errors to UnknownFailure', () async {
    final repository = RepartidorFinanzasRepositoryImpl(
      _FakeService(dailyError: StateError('boom inesperado')),
    );

    final outcome = await repository.getDailySummary(
      repartidorId: '8',
      date: DateTime(2026, 8, 26),
    );
    expect(
      outcome.fold(
        onSuccess: (_) => false,
        onFailure: (error) => error is errors.UnknownFailure,
      ),
      isTrue,
    );
  });

  test('Result.fold selects success and failure branches', () {
    expect(
      const result.Success<int>(2)
          .fold(onSuccess: (value) => value * 2, onFailure: (_) => 0),
      4,
    );
    expect(
      result.Failure<int>(StateError('x'))
          .fold(onSuccess: (_) => 0, onFailure: (_) => 3),
      3,
    );
  });
}
