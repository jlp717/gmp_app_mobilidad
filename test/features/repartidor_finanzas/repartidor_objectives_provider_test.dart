import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_providers.dart';

Map<String, dynamic> _client(String code, double sales, {String? name}) => {
      'code': code,
      'name': name ?? code,
      'totalSales': sales,
      'totalCost': sales / 2,
      'totalUnits': sales / 10,
      'productCount': 0,
      'margin': 50,
      'families': <Map<String, dynamic>>[],
    };

RepartidorObjectivesDetail _page({
  required List<Map<String, dynamic>> clients,
  required int offset,
  required bool hasMore,
  int? nextOffset,
}) {
  final sales = clients.fold<double>(
    0,
    (sum, client) => sum + (client['totalSales'] as num).toDouble(),
  );
  return RepartidorObjectivesDetail.fromJson({
    'success': true,
    'year': 2026,
    'pageTotal': {
      'sales': sales,
      'cost': sales / 2,
      'units': sales / 10,
      'margin': 50,
    },
    'grandTotal': null,
    'scopeTotalAvailability': 'PAGED',
    'clients': clients,
    'pagination': {
      'limit': 2,
      'offset': offset,
      'total': 3,
      'hasMore': hasMore,
      'nextOffset': nextOffset,
    },
  });
}

class _FakeObjectivesService extends RepartidorFinanzasService {
  _FakeObjectivesService({required this.first, required this.next});

  final RepartidorObjectivesDetail first;
  final RepartidorObjectivesDetail next;
  final calls = <({int limit, int offset})>[];
  Completer<RepartidorObjectivesDetail>? nextCompleter;

  @override
  Future<List<RepartidorMonthlyObjective>> getMonthlyObjectives({
    required String repartidorId,
    String? clientId,
    bool forceRefresh = false,
  }) async =>
      const [];

  @override
  Future<RepartidorObjectivesDetail> getObjectivesDetail({
    required String repartidorId,
    int? year,
    String? clientId,
    int limit = 100,
    int offset = 0,
    bool forceRefresh = false,
  }) {
    calls.add((limit: limit, offset: offset));
    if (offset == 0) return Future.value(first);
    return nextCompleter?.future ?? Future.value(next);
  }
}

void main() {
  late ProviderContainer container;

  tearDown(() => container.dispose());

  test('loads one explicit first page then merges next page stably', () async {
    final fake = _FakeObjectivesService(
      first: _page(
        clients: [_client('A', 100), _client('B', 200, name: 'B original')],
        offset: 0,
        hasMore: true,
        nextOffset: 2,
      ),
      next: _page(
        clients: [_client('B', 999, name: 'B repetido'), _client('C', 300)],
        offset: 2,
        hasMore: false,
      ),
    );
    container = ProviderContainer(
      overrides: [repartidorFinanzasServiceProvider.overrideWithValue(fake)],
    );
    final notifier = container.read(repartidorFinanzasProvider.notifier);
    await notifier.configure(repartidorId: '08', year: 2026);

    await notifier.loadObjectives(limit: 2);

    var state = container.read(repartidorFinanzasProvider);
    expect(fake.calls, [(limit: 2, offset: 0)]);
    expect(state.objectivesDetail?.grandTotal, isNull);
    expect(state.hasMoreObjectives, isTrue);
    expect(state.objectivesNextOffset, 2);

    await notifier.loadNextObjectives();

    state = container.read(repartidorFinanzasProvider);
    expect(fake.calls, [(limit: 2, offset: 0), (limit: 2, offset: 2)]);
    expect(state.objectivesDetail?.clients.map((client) => client.code),
        ['A', 'B', 'C']);
    expect(state.objectivesDetail?.clients[1].name, 'B original');
    expect(state.objectivesDetail?.hasCompleteScopeTotal, isTrue);
  });

  test('does not start concurrent next-page requests', () async {
    final fake = _FakeObjectivesService(
      first: _page(
        clients: [_client('A', 100), _client('B', 200)],
        offset: 0,
        hasMore: true,
        nextOffset: 2,
      ),
      next: _page(clients: [_client('C', 300)], offset: 2, hasMore: false),
    )..nextCompleter = Completer<RepartidorObjectivesDetail>();
    container = ProviderContainer(
      overrides: [repartidorFinanzasServiceProvider.overrideWithValue(fake)],
    );
    final notifier = container.read(repartidorFinanzasProvider.notifier);
    await notifier.configure(repartidorId: '08', year: 2026);
    await notifier.loadObjectives(limit: 2);

    final firstRequest = notifier.loadNextObjectives();
    await notifier.loadNextObjectives();
    expect(fake.calls, [(limit: 2, offset: 0), (limit: 2, offset: 2)]);

    fake.nextCompleter!.complete(fake.next);
    await firstRequest;
    expect(container.read(repartidorFinanzasProvider).isLoadingNextObjectives,
        isFalse);
  });
}
