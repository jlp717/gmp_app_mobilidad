import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/sales_history/data/sales_history_service.dart';
import 'package:gmp_app_mobilidad/features/sales_history/domain/product_history_item.dart';
import 'package:gmp_app_mobilidad/features/sales_history/providers/sales_history_provider.dart';

class _Pending {
  final history = Completer<Map<String, dynamic>>();
  final summary = Completer<Map<String, dynamic>>();

  void complete(String label) {
    history.complete({
      'items': <ProductHistoryItem>[
        ProductHistoryItem.fromJson({'productName': label}),
      ],
      'count': 1,
    });
    summary.complete({'label': label});
  }
}

class _ControlledService extends SalesHistoryService {
  final requests = <_Pending>[];
  final historyFilters = <List<String?>>[];
  final summaryFilters = <List<String?>>[];

  @override
  Future<Map<String, dynamic>> getSalesHistory({
    String? vendedorCodes,
    String? clientCode,
    String? productSearch,
    String? startDate,
    String? endDate,
    int limit = 100,
    int offset = 0,
  }) {
    historyFilters
        .add([vendedorCodes, clientCode, productSearch, startDate, endDate]);
    final pending = _Pending();
    requests.add(pending);
    return pending.history.future;
  }

  @override
  Future<Map<String, dynamic>> getSalesHistorySummary({
    String? vendedorCodes,
    String? clientCode,
    String? productSearch,
    String? startDate,
    String? endDate,
  }) {
    summaryFilters
        .add([vendedorCodes, clientCode, productSearch, startDate, endDate]);
    return requests.last.summary.future;
  }
}

void main() {
  late _ControlledService service;
  late ProviderContainer container;
  late SalesHistoryNotifier notifier;

  group('sales history request generations', () {
    setUp(() {
      service = _ControlledService();
      container = ProviderContainer(
        overrides: [
          salesHistoryProvider
              .overrideWith(() => SalesHistoryNotifier(service: service)),
        ],
      );
      notifier = container.read(salesHistoryProvider.notifier);
    });
    tearDown(() => container.dispose());

    test('older success cannot overwrite newer items, summary or filters',
        () async {
      notifier.setProductSearch('old');
      final old = notifier.loadHistory();
      notifier.setProductSearch('new');
      final current = notifier.loadHistory(reset: true);
      service.requests[1].complete('new');
      await current;
      service.requests[0].complete('old');
      await old;
      final state = container.read(salesHistoryProvider);
      expect(state.items.single.productName, 'new');
      expect(state.summary, {'label': 'new'});
      expect(state.productSearch, 'new');
      expect(state.totalCount, 1);
      expect(state.isLoading, false);
      expect(service.historyFilters, service.summaryFilters);
    });

    test('older failure cannot clear loading or set error on current request',
        () async {
      final old = notifier.loadHistory();
      final current = notifier.loadHistory();
      service.requests[0].history.completeError(StateError('old failure'));
      service.requests[0].summary.complete({});
      await old;
      expect(container.read(salesHistoryProvider).isLoading, true);
      expect(container.read(salesHistoryProvider).error, isNull);
      service.requests[1].complete('new');
      await current;
    });

    for (final filter in ['product', 'vendor']) {
      test('$filter change invalidates response before another load starts',
          () async {
        final pending = notifier.loadHistory();
        if (filter == 'product') {
          notifier.setProductSearch('new');
        } else {
          notifier.setVendedorCodes('02');
        }
        service.requests.single.complete('old');
        await pending;
        final state = container.read(salesHistoryProvider);
        expect(state.items, isEmpty);
        expect(state.summary, isNull);
        expect(state.isLoading, false);
        expect(state.error, isNull);
      });
    }

    test('client and date setters reload with one snapshot and reset totals',
        () async {
      final initial = notifier.loadHistory();
      service.requests[0].complete('initial');
      await initial;
      notifier.setClientCode('C002');
      expect(container.read(salesHistoryProvider).summary, isNull);
      expect(container.read(salesHistoryProvider).totalCount, 0);
      notifier.setDateRange('2026-01-01', '2026-01-31');
      service.requests[2].complete('dated');
      await pumpEventQueue();
      service.requests[1].complete('client-only');
      await pumpEventQueue();
      expect(
        container.read(salesHistoryProvider).items.single.productName,
        'dated',
      );
      expect(
        service.historyFilters.last,
        [null, 'C002', null, '2026-01-01', '2026-01-31'],
      );
      expect(service.historyFilters, service.summaryFilters);
    });

    test('current failure is visible and a retry can succeed', () async {
      final pending = notifier.loadHistory();
      service.requests.single.history.completeError(StateError('current'));
      service.requests.single.summary.complete({});
      await pending;
      expect(container.read(salesHistoryProvider).error, contains('current'));
      expect(container.read(salesHistoryProvider).isLoading, false);
      final retry = notifier.loadHistory();
      service.requests.last.complete('retry');
      await retry;
      expect(container.read(salesHistoryProvider).error, isNull);
    });

    test('disposal logically cancels pending success and failure', () async {
      final first = notifier.loadHistory();
      final second = notifier.loadHistory();
      container.dispose();
      service.requests[0].complete('disposed');
      service.requests[1].history.completeError(StateError('disposed'));
      service.requests[1].summary.complete({});
      await expectLater(Future.wait([first, second]), completes);
    });

    test('provider invalidation rejects old generation after rebuild',
        () async {
      final old = notifier.loadHistory();
      container.invalidate(salesHistoryProvider);
      notifier = container.read(salesHistoryProvider.notifier);
      final current = notifier.loadHistory();
      service.requests[1].complete('rebuilt');
      await current;
      service.requests[0].complete('old');
      await old;
      expect(
        container.read(salesHistoryProvider).items.single.productName,
        'rebuilt',
      );
    });
  });

  test('service cache keys include all query params and separate both searches',
      () async {
    final cache = <String, Map<String, dynamic>>{};
    final keys = <String>[];
    var reads = 0;
    final api = SalesHistoryService(
      get: (endpoint, {queryParameters, cacheKey, cacheTTL}) async {
        expect(cacheTTL, const Duration(minutes: 10));
        final prefix = endpoint.endsWith('/summary')
            ? 'sales_history_summary_v2_'
            : 'sales_history_v2_';
        expect(jsonDecode(cacheKey!.substring(prefix.length)), queryParameters);
        keys.add(cacheKey);
        return cache.putIfAbsent(cacheKey, () {
          reads++;
          return endpoint.endsWith('/summary')
              ? {'search': queryParameters!['productSearch']}
              : {
                  'rows': [
                    {'productName': queryParameters!['productSearch']},
                  ],
                  'count': 1,
                };
        });
      },
    );
    final first = await api.getSalesHistory(productSearch: 'milk');
    final second = await api.getSalesHistory(productSearch: 'bread');
    await api.getSalesHistory(productSearch: 'milk');
    expect(
      (first['items'] as List<ProductHistoryItem>).single.productName,
      'milk',
    );
    expect(
      (second['items'] as List<ProductHistoryItem>).single.productName,
      'bread',
    );
    expect(reads, 2);
    expect(
      await api.getSalesHistorySummary(productSearch: 'milk'),
      {'search': 'milk'},
    );
    expect(
      await api.getSalesHistorySummary(productSearch: 'bread'),
      {'search': 'bread'},
    );
    await api.getSalesHistorySummary(productSearch: 'milk');
    expect(reads, 4);
    await api.getSalesHistory(
      vendedorCodes: '01',
      clientCode: 'C1',
      productSearch: 'x_y',
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      limit: 20,
      offset: 40,
    );
    expect(keys.toSet().length, 5);
  });
}
