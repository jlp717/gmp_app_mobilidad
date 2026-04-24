// ignore_for_file: public_member_api_docs

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';

class RepartidorFinanzasFilters {
  const RepartidorFinanzasFilters({
    required this.repartidorId,
    required this.year,
    required this.month,
    this.clientSearch,
    this.selectedClientId,
    this.documentDateFrom,
    this.documentDateTo,
    this.documentYear,
  });

  factory RepartidorFinanzasFilters.initial() {
    final now = DateTime.now();
    return RepartidorFinanzasFilters(
      repartidorId: '',
      year: now.year,
      month: now.month,
    );
  }

  final String repartidorId;
  final int year;
  final int month;
  final String? clientSearch;
  final String? selectedClientId;
  final String? documentDateFrom;
  final String? documentDateTo;
  final int? documentYear;

  bool get hasRepartidor => repartidorId.isNotEmpty;

  RepartidorFinanzasFilters copyWith({
    String? repartidorId,
    int? year,
    int? month,
    Object? clientSearch = _sentinel,
    Object? selectedClientId = _sentinel,
    Object? documentDateFrom = _sentinel,
    Object? documentDateTo = _sentinel,
    Object? documentYear = _sentinel,
  }) {
    return RepartidorFinanzasFilters(
      repartidorId: repartidorId ?? this.repartidorId,
      year: year ?? this.year,
      month: month ?? this.month,
      clientSearch: clientSearch == _sentinel
          ? this.clientSearch
          : clientSearch as String?,
      selectedClientId: selectedClientId == _sentinel
          ? this.selectedClientId
          : selectedClientId as String?,
      documentDateFrom: documentDateFrom == _sentinel
          ? this.documentDateFrom
          : documentDateFrom as String?,
      documentDateTo: documentDateTo == _sentinel
          ? this.documentDateTo
          : documentDateTo as String?,
      documentYear:
          documentYear == _sentinel ? this.documentYear : documentYear as int?,
    );
  }

  static const _sentinel = Object();
}

class RepartidorFinanzasState {
  RepartidorFinanzasState({
    RepartidorFinanzasFilters? filters,
    this.collectionSummary,
    List<DailyCollectionSnapshot> dailyCollections = const [],
    List<RepartidorHistoryClient> clients = const [],
    List<RepartidorHistoryDocument> selectedClientDocuments = const [],
    List<RepartidorMonthlyObjective> monthlyObjectives = const [],
    this.objectivesDetail,
    this.deliverySummary,
    this.isLoadingOverview = false,
    this.isLoadingClients = false,
    this.isLoadingDocuments = false,
    this.isLoadingObjectives = false,
    this.error,
    this.lastUpdated,
  })  : filters = filters ?? RepartidorFinanzasFilters.initial(),
        dailyCollections = List.unmodifiable(dailyCollections),
        clients = List.unmodifiable(clients),
        selectedClientDocuments = List.unmodifiable(selectedClientDocuments),
        monthlyObjectives = List.unmodifiable(monthlyObjectives);

  final RepartidorFinanzasFilters filters;
  final RepartidorCollectionSummary? collectionSummary;
  final List<DailyCollectionSnapshot> dailyCollections;
  final List<RepartidorHistoryClient> clients;
  final List<RepartidorHistoryDocument> selectedClientDocuments;
  final List<RepartidorMonthlyObjective> monthlyObjectives;
  final RepartidorObjectivesDetail? objectivesDetail;
  final RepartidorDeliverySummary? deliverySummary;
  final bool isLoadingOverview;
  final bool isLoadingClients;
  final bool isLoadingDocuments;
  final bool isLoadingObjectives;
  final String? error;
  final DateTime? lastUpdated;

  bool get isLoading =>
      isLoadingOverview ||
      isLoadingClients ||
      isLoadingDocuments ||
      isLoadingObjectives;

  bool get hasOverview => collectionSummary != null;

  RepartidorFinanzasState copyWith({
    RepartidorFinanzasFilters? filters,
    Object? collectionSummary = _sentinel,
    List<DailyCollectionSnapshot>? dailyCollections,
    List<RepartidorHistoryClient>? clients,
    List<RepartidorHistoryDocument>? selectedClientDocuments,
    List<RepartidorMonthlyObjective>? monthlyObjectives,
    Object? objectivesDetail = _sentinel,
    Object? deliverySummary = _sentinel,
    bool? isLoadingOverview,
    bool? isLoadingClients,
    bool? isLoadingDocuments,
    bool? isLoadingObjectives,
    Object? error = _sentinel,
    Object? lastUpdated = _sentinel,
  }) {
    return RepartidorFinanzasState(
      filters: filters ?? this.filters,
      collectionSummary: collectionSummary == _sentinel
          ? this.collectionSummary
          : collectionSummary as RepartidorCollectionSummary?,
      dailyCollections: dailyCollections ?? this.dailyCollections,
      clients: clients ?? this.clients,
      selectedClientDocuments:
          selectedClientDocuments ?? this.selectedClientDocuments,
      monthlyObjectives: monthlyObjectives ?? this.monthlyObjectives,
      objectivesDetail: objectivesDetail == _sentinel
          ? this.objectivesDetail
          : objectivesDetail as RepartidorObjectivesDetail?,
      deliverySummary: deliverySummary == _sentinel
          ? this.deliverySummary
          : deliverySummary as RepartidorDeliverySummary?,
      isLoadingOverview: isLoadingOverview ?? this.isLoadingOverview,
      isLoadingClients: isLoadingClients ?? this.isLoadingClients,
      isLoadingDocuments: isLoadingDocuments ?? this.isLoadingDocuments,
      isLoadingObjectives: isLoadingObjectives ?? this.isLoadingObjectives,
      error: error == _sentinel ? this.error : error as String?,
      lastUpdated: lastUpdated == _sentinel
          ? this.lastUpdated
          : lastUpdated as DateTime?,
    );
  }

  static const _sentinel = Object();
}

class RepartidorFinanzasNotifier extends Notifier<RepartidorFinanzasState> {
  RepartidorFinanzasService get _service {
    return ref.read(repartidorFinanzasServiceProvider);
  }

  @override
  RepartidorFinanzasState build() => RepartidorFinanzasState();

  Future<void> configure({
    required String repartidorId,
    int? year,
    int? month,
    bool load = false,
  }) async {
    state = state.copyWith(
      filters: state.filters.copyWith(
        repartidorId: repartidorId,
        year: year,
        month: month,
      ),
      error: null,
    );

    if (load) {
      await loadOverview();
    }
  }

  Future<void> setPeriod(int year, int month, {bool load = true}) async {
    state = state.copyWith(
      filters: state.filters.copyWith(year: year, month: month),
      error: null,
    );

    if (load) {
      await loadOverview();
    }
  }

  Future<void> loadOverview({bool forceRefresh = false}) async {
    final filters = state.filters;
    if (!filters.hasRepartidor) return;

    state = state.copyWith(isLoadingOverview: true, error: null);

    try {
      final results = await Future.wait<dynamic>([
        _service.getCollectionSummary(
          repartidorId: filters.repartidorId,
          year: filters.year,
          month: filters.month,
          forceRefresh: forceRefresh,
        ),
        _service.getDailyCollections(
          repartidorId: filters.repartidorId,
          year: filters.year,
          month: filters.month,
          forceRefresh: forceRefresh,
        ),
        _service.getDeliverySummary(
          repartidorId: filters.repartidorId,
          year: filters.year,
          month: filters.month,
          forceRefresh: forceRefresh,
        ),
      ]);

      state = state.copyWith(
        collectionSummary: results[0] as RepartidorCollectionSummary,
        dailyCollections: results[1] as List<DailyCollectionSnapshot>,
        deliverySummary: results[2] as RepartidorDeliverySummary,
        isLoadingOverview: false,
        lastUpdated: DateTime.now(),
      );
    } catch (e) {
      state = state.copyWith(
        isLoadingOverview: false,
        error: e.toString(),
      );
    }
  }

  Future<void> loadClients({
    String? search,
    bool forceRefresh = false,
  }) async {
    final filters = state.filters;
    if (!filters.hasRepartidor) return;

    state = state.copyWith(
      filters: filters.copyWith(clientSearch: search),
      isLoadingClients: true,
      error: null,
    );

    try {
      final clients = await _service.getHistoryClients(
        repartidorId: filters.repartidorId,
        search: search,
        forceRefresh: forceRefresh,
      );
      state = state.copyWith(
        clients: clients,
        isLoadingClients: false,
        lastUpdated: DateTime.now(),
      );
    } catch (e) {
      state = state.copyWith(
        isLoadingClients: false,
        error: e.toString(),
      );
    }
  }

  Future<void> loadClientDocuments({
    required String clientId,
    String? dateFrom,
    String? dateTo,
    int? year,
    bool forceRefresh = false,
  }) async {
    final filters = state.filters;

    state = state.copyWith(
      filters: filters.copyWith(
        selectedClientId: clientId,
        documentDateFrom: dateFrom,
        documentDateTo: dateTo,
        documentYear: year,
      ),
      isLoadingDocuments: true,
      error: null,
    );

    try {
      final documents = await _service.getClientDocuments(
        clientId: clientId,
        repartidorId:
            filters.repartidorId.isEmpty ? null : filters.repartidorId,
        dateFrom: dateFrom,
        dateTo: dateTo,
        year: year,
        forceRefresh: forceRefresh,
      );
      state = state.copyWith(
        selectedClientDocuments: documents,
        isLoadingDocuments: false,
        lastUpdated: DateTime.now(),
      );
    } catch (e) {
      state = state.copyWith(
        isLoadingDocuments: false,
        error: e.toString(),
      );
    }
  }

  Future<void> loadObjectives({
    String? clientId,
    int? year,
    bool forceRefresh = false,
  }) async {
    final filters = state.filters;
    if (!filters.hasRepartidor) return;

    final selectedYear = year ?? filters.year;

    state = state.copyWith(isLoadingObjectives: true, error: null);

    try {
      final results = await Future.wait<dynamic>([
        _service.getMonthlyObjectives(
          repartidorId: filters.repartidorId,
          clientId: clientId,
          forceRefresh: forceRefresh,
        ),
        _service.getObjectivesDetail(
          repartidorId: filters.repartidorId,
          year: selectedYear,
          clientId: clientId,
          forceRefresh: forceRefresh,
        ),
      ]);

      state = state.copyWith(
        monthlyObjectives: results[0] as List<RepartidorMonthlyObjective>,
        objectivesDetail: results[1] as RepartidorObjectivesDetail,
        isLoadingObjectives: false,
        lastUpdated: DateTime.now(),
      );
    } catch (e) {
      state = state.copyWith(
        isLoadingObjectives: false,
        error: e.toString(),
      );
    }
  }

  Future<void> refreshOverview() async {
    final filters = state.filters;
    if (!filters.hasRepartidor) return;

    await _service.invalidatePeriod(
      repartidorId: filters.repartidorId,
      year: filters.year,
      month: filters.month,
    );
    await loadOverview(forceRefresh: true);
  }

  Future<void> refreshClientDocuments() async {
    final filters = state.filters;
    final clientId = filters.selectedClientId;
    if (clientId == null || clientId.isEmpty) return;

    await _service.invalidateClientDocuments(
      clientId: clientId,
      repartidorId: filters.repartidorId.isEmpty ? null : filters.repartidorId,
      dateFrom: filters.documentDateFrom,
      dateTo: filters.documentDateTo,
      year: filters.documentYear,
    );
    await loadClientDocuments(
      clientId: clientId,
      dateFrom: filters.documentDateFrom,
      dateTo: filters.documentDateTo,
      year: filters.documentYear,
      forceRefresh: true,
    );
  }

  Future<void> refreshObjectives({String? clientId, int? year}) async {
    final filters = state.filters;
    if (!filters.hasRepartidor) return;

    await _service.invalidateObjectives(
      repartidorId: filters.repartidorId,
      year: year ?? filters.year,
      clientId: clientId,
    );
    await loadObjectives(
      clientId: clientId,
      year: year,
      forceRefresh: true,
    );
  }

  Future<void> invalidateAllCaches() async {
    final repartidorId = state.filters.repartidorId;
    if (repartidorId.isEmpty) return;
    await _service.invalidateAllForRepartidor(repartidorId);
  }

  void clearError() {
    state = state.copyWith(error: null);
  }

  void clearSelectedClient() {
    state = state.copyWith(
      filters: state.filters.copyWith(
        selectedClientId: null,
        documentDateFrom: null,
        documentDateTo: null,
        documentYear: null,
      ),
      selectedClientDocuments: const [],
    );
  }
}

final repartidorFinanzasServiceProvider =
    Provider<RepartidorFinanzasService>((ref) {
  return const RepartidorFinanzasService();
});

final repartidorFinanzasProvider =
    NotifierProvider<RepartidorFinanzasNotifier, RepartidorFinanzasState>(
  RepartidorFinanzasNotifier.new,
);

final repartidorFinanzasSummaryProvider =
    Provider<RepartidorCollectionSummary?>((ref) {
  return ref.watch(repartidorFinanzasProvider).collectionSummary;
});

final repartidorFinanzasDailyProvider =
    Provider<List<DailyCollectionSnapshot>>((ref) {
  return ref.watch(repartidorFinanzasProvider).dailyCollections;
});

final repartidorFinanzasClientsProvider =
    Provider<List<RepartidorHistoryClient>>((ref) {
  return ref.watch(repartidorFinanzasProvider).clients;
});

final repartidorFinanzasDocumentsProvider =
    Provider<List<RepartidorHistoryDocument>>((ref) {
  return ref.watch(repartidorFinanzasProvider).selectedClientDocuments;
});

final repartidorFinanzasObjectivesProvider =
    Provider<List<RepartidorMonthlyObjective>>((ref) {
  return ref.watch(repartidorFinanzasProvider).monthlyObjectives;
});

final repartidorFinanzasLoadingProvider = Provider<bool>((ref) {
  return ref.watch(repartidorFinanzasProvider).isLoading;
});

final repartidorFinanzasErrorProvider = Provider<String?>((ref) {
  return ref.watch(repartidorFinanzasProvider).error;
});

typedef DailySummaryArgs = ({
  String repartidorId,
  DateTime date,
  bool forceRefresh,
});

typedef VencimientosArgs = ({
  String repartidorId,
  DateTime from,
  DateTime to,
  String? clientCode,
  String? estado,
  bool forceRefresh,
});

typedef CommissionSummaryArgs = ({
  String repartidorId,
  DateTime from,
  DateTime to,
  bool forceRefresh,
});

final repartidorDailySummaryProvider =
    FutureProvider.family<RepartidorDailySummary, DailySummaryArgs>(
  (ref, args) {
    return ref.read(repartidorFinanzasServiceProvider).getDailySummary(
          repartidorId: args.repartidorId,
          date: args.date,
          forceRefresh: args.forceRefresh,
        );
  },
);

final repartidorVencimientosProvider =
    FutureProvider.family<List<RepartidorVencimiento>, VencimientosArgs>(
  (ref, args) {
    return ref.read(repartidorFinanzasServiceProvider).getVencimientos(
          repartidorId: args.repartidorId,
          from: args.from,
          to: args.to,
          clientCode: args.clientCode,
          estado: args.estado,
          forceRefresh: args.forceRefresh,
        );
  },
);

final repartidorCommissionSummaryProvider =
    FutureProvider.family<RepartidorCommissionSummary, CommissionSummaryArgs>(
  (ref, args) {
    return ref.read(repartidorFinanzasServiceProvider).getCommissionSummary(
          repartidorId: args.repartidorId,
          from: args.from,
          to: args.to,
          forceRefresh: args.forceRefresh,
        );
  },
);

final repartidorCommissionTiersProvider =
    FutureProvider<List<RepartidorCommissionTier>>((ref) {
  return ref.read(repartidorFinanzasServiceProvider).getCommissionTiers();
});

final repartidorLiquidacionActionsProvider =
    Provider<RepartidorLiquidacionActions>((ref) {
  return RepartidorLiquidacionActions(ref);
});

class RepartidorLiquidacionActions {
  RepartidorLiquidacionActions(this._ref);

  final Ref _ref;

  Future<RepartidorLiquidacionResult> close({
    required String repartidorId,
    required DateTime date,
    required String idempotencyToken,
    required RepartidorDailySummary summary,
    required double ingresoBanco,
    required double entregado,
  }) async {
    final result =
        await _ref.read(repartidorFinanzasServiceProvider).closeLiquidacion(
              repartidorId: repartidorId,
              date: date,
              idempotencyToken: idempotencyToken,
              totalEfectivo: summary.totalEfectivo,
              totalCheques: summary.totalCheques,
              totalTarjeta: summary.totalTarjeta,
              totalPostdatados: summary.totalPostdatados,
              saldoActual: summary.saldoActual,
              totalCobrosDia: summary.totalCobrosDia,
              totalAIngresar: summary.totalAIngresar,
              ingresoBanco: ingresoBanco,
              gastos: summary.gastos,
              efectivo2: summary.totalEfectivo,
              entregado2: entregado,
            );

    _ref.invalidate(repartidorDailySummaryProvider);
    _ref.invalidate(repartidorVencimientosProvider);
    _ref.invalidate(repartidorCommissionSummaryProvider);
    return result;
  }

  Future<List<RepartidorCommissionTier>> saveCommissionTiers(
    List<RepartidorCommissionTier> tiers,
  ) async {
    final result = await _ref
        .read(repartidorFinanzasServiceProvider)
        .saveCommissionTiers(tiers);
    _ref.invalidate(repartidorCommissionTiersProvider);
    _ref.invalidate(repartidorCommissionSummaryProvider);
    return result;
  }
}
