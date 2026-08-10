import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/presentation/finance_error_message.dart';

void main() {
  group('RepartidorEvolutionData', () {
    test('parses a strict YYYY-MM and finite numeric contract', () {
      final data = RepartidorEvolutionData.fromJson({
        'evolution': [
          {'period': '2026-04', 'totalSales': 222.79, 'numCobros': 2},
        ],
        'topProducts': [
          {
            'code': 'ART-1',
            'name': 'Helado',
            'totalUnits': 12,
            'totalSales': 240.5,
          },
        ],
      });

      expect(data.evolution.single.monthLabel, '04');
      expect(data.evolution.single.totalSales, 222.79);
      expect(data.topProducts.single.totalUnits, 12);
    });

    test('rejects malformed evolution values', () {
      final invalidPoints = <Map<String, Object>>[
        {'period': '04/2026', 'totalSales': 1, 'numCobros': 1},
        {'period': '2026-13', 'totalSales': 1, 'numCobros': 1},
        {'period': '2026-04', 'totalSales': 'not-a-number', 'numCobros': 1},
      ];

      for (final point in invalidPoints) {
        expect(
          () => RepartidorEvolutionData.fromJson({
            'evolution': [point],
            'topProducts': const [],
          }),
          throwsFormatException,
        );
      }
    });
  });
  test('vencimiento rejects an impossible calendar date', () {
    final item = RepartidorVencimiento.fromJson({
      'fechaVencimiento': '2026-02-30',
      'importe': 10,
      'importePendiente': 10,
    });

    expect(item.dueDate, isNull);
    expect(item.hasValidDueDate, isFalse);
  });

  test('vencimiento token identifies an intent, not a payment tuple', () {
    final first = createVencimientoCobroIdempotencyToken(
      '94',
      'E 2026-B-I-010-002730-01',
      entropy: List<int>.generate(16, (index) => index),
    );
    final retryOfSameIntent = createVencimientoCobroIdempotencyToken(
      '94',
      'E 2026-B-I-010-002730-01',
      entropy: List<int>.generate(16, (index) => index),
    );
    final nextIntentForSameDocument = createVencimientoCobroIdempotencyToken(
      '94',
      'E 2026-B-I-010-002730-01',
      entropy: List<int>.generate(16, (index) => index + 1),
    );

    expect(retryOfSameIntent, first);
    expect(nextIntentForSameDocument, isNot(first));
    expect(first.length, lessThanOrEqualTo(128));
    expect(first, startsWith('vto_94_'));
  });

  group('daily summary reverse-cobro capability', () {
    Map<String, dynamic> response([Object? capability]) => {
          'repartidorId': '94',
          'date': '2026-08-10',
          if (capability != null) 'canReverseCobros': capability,
          'totals': const <String, dynamic>{},
          'cobros': const <Map<String, dynamic>>[],
        };

    test('is disabled when the backend omits it', () {
      expect(
        RepartidorDailySummary.fromJson(response()).canReverseCobros,
        isFalse,
      );
    });

    test('accepts only an explicit boolean true', () {
      expect(
        RepartidorDailySummary.fromJson(response(false)).canReverseCobros,
        isFalse,
      );
      expect(
        RepartidorDailySummary.fromJson(response('true')).canReverseCobros,
        isFalse,
      );
      expect(
        RepartidorDailySummary.fromJson(response(true)).canReverseCobros,
        isTrue,
      );
    });
  });

  test(
    'finance errors map authentication, authorization and server status',
    () {
      expect(
        financeErrorMessage(ApiException('raw', statusCode: 401), 'fallback'),
        contains('sesi\u00f3n'),
      );
      expect(
        financeErrorMessage(ApiException('raw', statusCode: 403), 'fallback'),
        contains('permisos'),
      );
      expect(
        financeErrorMessage(ApiException('raw', statusCode: 503), 'fallback'),
        contains('no est\u00e1 disponible'),
      );
    },
  );

  test('finance notifier never exposes raw service exceptions', () async {
    final container = ProviderContainer(
      overrides: [
        repartidorFinanzasServiceProvider.overrideWithValue(
          _SensitiveFailureFinanceService(),
        ),
      ],
    );
    addTearDown(container.dispose);
    final notifier = container.read(repartidorFinanzasProvider.notifier);
    await notifier.configure(repartidorId: '94');

    await notifier.loadOverview();
    _expectSanitized(container.read(repartidorFinanzasProvider).error);
    await notifier.loadClients();
    _expectSanitized(container.read(repartidorFinanzasProvider).error);
    await notifier.loadClientDocuments(clientId: 'CLIENTE-1');
    _expectSanitized(container.read(repartidorFinanzasProvider).error);
    await notifier.loadObjectives();
    _expectSanitized(container.read(repartidorFinanzasProvider).error);
  });
}

void _expectSanitized(String? message) {
  expect(message, isNotNull);
  expect(message, isNot(contains('SQLSTATE')));
  expect(message, isNot(contains('DSEDAC.CLIENTE-SECRET')));
}

class _SensitiveFailureFinanceService extends RepartidorFinanzasService {
  static final _failure = Exception(
    'SQLSTATE 58004 DSEDAC.CLIENTE-SECRET /private/device/path',
  );

  @override
  Future<RepartidorCollectionSummary> getCollectionSummary({
    required String repartidorId,
    int? year,
    int? month,
    bool forceRefresh = false,
  }) =>
      Future<RepartidorCollectionSummary>.error(_failure);

  @override
  Future<List<DailyCollectionSnapshot>> getDailyCollections({
    required String repartidorId,
    int? year,
    int? month,
    bool forceRefresh = false,
  }) =>
      Future<List<DailyCollectionSnapshot>>.error(_failure);

  @override
  Future<RepartidorDeliverySummary> getDeliverySummary({
    required String repartidorId,
    int? year,
    int? month,
    bool forceRefresh = false,
  }) =>
      Future<RepartidorDeliverySummary>.error(_failure);

  @override
  Future<List<RepartidorHistoryClient>> getHistoryClients({
    required String repartidorId,
    String? search,
    bool forceRefresh = false,
  }) =>
      Future<List<RepartidorHistoryClient>>.error(_failure);

  @override
  Future<List<RepartidorHistoryDocument>> getClientDocuments({
    required String clientId,
    String? repartidorId,
    String? dateFrom,
    String? dateTo,
    int? year,
    bool forceRefresh = false,
  }) =>
      Future<List<RepartidorHistoryDocument>>.error(_failure);

  @override
  Future<List<RepartidorMonthlyObjective>> getMonthlyObjectives({
    required String repartidorId,
    String? clientId,
    bool forceRefresh = false,
  }) =>
      Future<List<RepartidorMonthlyObjective>>.error(_failure);

  @override
  Future<RepartidorObjectivesDetail> getObjectivesDetail({
    required String repartidorId,
    int? year,
    String? clientId,
    bool forceRefresh = false,
  }) =>
      Future<RepartidorObjectivesDetail>.error(_failure);
}
