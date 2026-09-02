import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/sales_history/data/sales_history_service.dart';
import 'package:gmp_app_mobilidad/features/sales_history/domain/product_history_item.dart';

// ── State ────────────────────────────────────────────────────────────────────

class SalesHistoryState {
  const SalesHistoryState({
    this.items = const [],
    this.summary,
    this.isLoading = false,
    this.error,
    this.totalCount = 0,
    this.clientCode,
    this.productSearch,
    this.startDate,
    this.endDate,
    this.vendedorCodes,
  });
  final List<ProductHistoryItem> items;
  final Map<String, dynamic>? summary;
  final bool isLoading;
  final String? error;
  final int totalCount;
  final String? clientCode;
  final String? productSearch;
  final String? startDate;
  final String? endDate;
  final String? vendedorCodes;

  SalesHistoryState copyWith({
    List<ProductHistoryItem>? items,
    Object? summary = _sentinel,
    bool? isLoading,
    Object? error = _sentinel,
    int? totalCount,
    Object? clientCode = _sentinel,
    Object? productSearch = _sentinel,
    Object? startDate = _sentinel,
    Object? endDate = _sentinel,
    Object? vendedorCodes = _sentinel,
  }) {
    return SalesHistoryState(
      items: items ?? this.items,
      summary: summary == _sentinel
          ? this.summary
          : summary as Map<String, dynamic>?,
      isLoading: isLoading ?? this.isLoading,
      error: error == _sentinel ? this.error : error as String?,
      totalCount: totalCount ?? this.totalCount,
      clientCode:
          clientCode == _sentinel ? this.clientCode : clientCode as String?,
      productSearch: productSearch == _sentinel
          ? this.productSearch
          : productSearch as String?,
      startDate: startDate == _sentinel ? this.startDate : startDate as String?,
      endDate: endDate == _sentinel ? this.endDate : endDate as String?,
      vendedorCodes: vendedorCodes == _sentinel
          ? this.vendedorCodes
          : vendedorCodes as String?,
    );
  }

  static const _sentinel = Object();
}

// ── Notifier ─────────────────────────────────────────────────────────────────

class SalesHistoryNotifier extends Notifier<SalesHistoryState> {
  /// Uses the shared service unless an isolated reader is injected.
  SalesHistoryNotifier({SalesHistoryService? service})
      : _service = service ?? SalesHistoryService();

  final SalesHistoryService _service;
  int _generation = 0;

  @override
  SalesHistoryState build() {
    ref.onDispose(() => _generation++);
    return const SalesHistoryState();
  }

  void setVendedorCodes(String codes) {
    if (state.vendedorCodes == codes) return;
    _generation++;
    state = state.copyWith(vendedorCodes: codes, isLoading: false);
  }

  void setClientCode(String? code) {
    state = state.copyWith(clientCode: code);
    loadHistory(reset: true);
  }

  void setProductSearch(String query) {
    if (state.productSearch == query) return;
    _generation++;
    state = state.copyWith(productSearch: query, isLoading: false);
  }

  void setDateRange(String? start, String? end) {
    state = state.copyWith(startDate: start, endDate: end);
    loadHistory(reset: true);
  }

  Future<void> loadHistory({bool reset = false}) async {
    final generation = ++_generation;
    final filters = state;
    if (reset) {
      state = state.copyWith(
        items: [],
        summary: null,
        totalCount: 0,
        isLoading: true,
        error: null,
      );
    } else {
      state = state.copyWith(isLoading: true, error: null);
    }

    try {
      final results = await Future.wait([
        _service.getSalesHistory(
          vendedorCodes: filters.vendedorCodes,
          clientCode: filters.clientCode,
          productSearch: filters.productSearch,
          startDate: filters.startDate,
          endDate: filters.endDate,
        ),
        _service.getSalesHistorySummary(
          vendedorCodes: filters.vendedorCodes,
          clientCode: filters.clientCode,
          productSearch: filters.productSearch,
          startDate: filters.startDate,
          endDate: filters.endDate,
        ),
      ]);

      // Logical cancellation also covers cache hits and provider disposal.
      if (generation != _generation) return;
      final historyResult = results[0];
      final summary = results[1];

      state = state.copyWith(
        items: historyResult['items'] as List<ProductHistoryItem>,
        summary: summary,
        totalCount: historyResult['count'] as int,
        isLoading: false,
      );
    } catch (e) {
      if (generation != _generation) return;
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

final salesHistoryProvider =
    NotifierProvider<SalesHistoryNotifier, SalesHistoryState>(
  SalesHistoryNotifier.new,
);

// ── Selectors ────────────────────────────────────────────────────────────────

final salesHistoryItemsProvider = Provider<List<ProductHistoryItem>>((ref) {
  return ref.watch(salesHistoryProvider.select((state) => state.items));
});

final salesHistorySummaryProvider = Provider<Map<String, dynamic>?>((ref) {
  return ref.watch(salesHistoryProvider.select((state) => state.summary));
});

final salesHistoryLoadingProvider = Provider<bool>((ref) {
  return ref.watch(salesHistoryProvider.select((state) => state.isLoading));
});
