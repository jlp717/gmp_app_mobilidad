import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/sales_history_service.dart';
import '../domain/product_history_item.dart';

// ── State ────────────────────────────────────────────────────────────────────

class SalesHistoryState {
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
      summary: summary == _sentinel ? this.summary : summary as Map<String, dynamic>?,
      isLoading: isLoading ?? this.isLoading,
      error: error == _sentinel ? this.error : error as String?,
      totalCount: totalCount ?? this.totalCount,
      clientCode: clientCode == _sentinel ? this.clientCode : clientCode as String?,
      productSearch: productSearch == _sentinel ? this.productSearch : productSearch as String?,
      startDate: startDate == _sentinel ? this.startDate : startDate as String?,
      endDate: endDate == _sentinel ? this.endDate : endDate as String?,
      vendedorCodes: vendedorCodes == _sentinel ? this.vendedorCodes : vendedorCodes as String?,
    );
  }

  static const _sentinel = Object();
}

// ── Notifier ─────────────────────────────────────────────────────────────────

class SalesHistoryNotifier extends Notifier<SalesHistoryState> {
  final SalesHistoryService _service = SalesHistoryService();

  @override
  SalesHistoryState build() => const SalesHistoryState();

  void setVendedorCodes(String codes) {
    state = state.copyWith(vendedorCodes: codes);
  }

  void setClientCode(String? code) {
    state = state.copyWith(clientCode: code);
    loadHistory(reset: true);
  }

  void setProductSearch(String query) {
    state = state.copyWith(productSearch: query);
  }

  void setDateRange(String? start, String? end) {
    state = state.copyWith(startDate: start, endDate: end);
    loadHistory(reset: true);
  }

  Future<void> loadHistory({bool reset = false}) async {
    if (reset) {
      state = state.copyWith(items: [], isLoading: true, error: null);
    } else {
      state = state.copyWith(isLoading: true, error: null);
    }

    try {
      final results = await Future.wait([
        _service.getSalesHistory(
          vendedorCodes: state.vendedorCodes,
          clientCode: state.clientCode,
          productSearch: state.productSearch,
          startDate: state.startDate,
          endDate: state.endDate,
          limit: 100,
          offset: 0,
        ),
        _service.getSalesHistorySummary(
          vendedorCodes: state.vendedorCodes,
          clientCode: state.clientCode,
          productSearch: state.productSearch,
          startDate: state.startDate,
          endDate: state.endDate,
        ),
      ]);

      final historyResult = results[0] as Map<String, dynamic>;
      final summary = results[1] as Map<String, dynamic>;

      state = state.copyWith(
        items: historyResult['items'] as List<ProductHistoryItem>,
        summary: summary,
        totalCount: historyResult['count'] as int,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

final salesHistoryProvider =
    NotifierProvider<SalesHistoryNotifier, SalesHistoryState>(SalesHistoryNotifier.new);

// ── Selectors ────────────────────────────────────────────────────────────────

final salesHistoryItemsProvider = Provider<List<ProductHistoryItem>>((ref) {
  return ref.watch(salesHistoryProvider).items;
});

final salesHistorySummaryProvider = Provider<Map<String, dynamic>?>((ref) {
  return ref.watch(salesHistoryProvider).summary;
});

final salesHistoryLoadingProvider = Provider<bool>((ref) {
  return ref.watch(salesHistoryProvider).isLoading;
});
