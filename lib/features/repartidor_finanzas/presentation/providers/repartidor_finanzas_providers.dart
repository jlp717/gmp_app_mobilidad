// ignore_for_file: public_member_api_docs

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repartidor_finanzas_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/data/repositories/repartidor_finanzas_repository_impl.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repartidor_finanzas_models.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/repositories/repartidor_finanzas_repository.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/usecases/get_daily_summary_usecase.dart';
import 'package:gmp_app_mobilidad/features/repartidor_finanzas/domain/usecases/submit_liquidacion_usecase.dart';

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
    this.objectivesClientId,
    this.objectivesYear,
    this.objectivesPageLimit = 100,
    this.deliverySummary,
    this.isLoadingOverview = false,
    this.isLoadingClients = false,
    this.isLoadingDocuments = false,
    this.isLoadingObjectives = false,
    this.isLoadingNextObjectives = false,
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
  final String? objectivesClientId;
  final int? objectivesYear;
  final int objectivesPageLimit;
  final RepartidorDeliverySummary? deliverySummary;
  final bool isLoadingOverview;
  final bool isLoadingClients;
  final bool isLoadingDocuments;
  final bool isLoadingObjectives;
  final bool isLoadingNextObjectives;
  final String? error;
  final DateTime? lastUpdated;

  bool get isLoading =>
      isLoadingOverview ||
      isLoadingClients ||
      isLoadingDocuments ||
      isLoadingObjectives ||
      isLoadingNextObjectives;

  bool get hasMoreObjectives => objectivesDetail?.hasMore ?? false;
  int? get objectivesNextOffset => objectivesDetail?.nextOffset;

  bool get hasOverview => collectionSummary != null;

  RepartidorFinanzasState copyWith({
    RepartidorFinanzasFilters? filters,
    Object? collectionSummary = _sentinel,
    List<DailyCollectionSnapshot>? dailyCollections,
    List<RepartidorHistoryClient>? clients,
    List<RepartidorHistoryDocument>? selectedClientDocuments,
    List<RepartidorMonthlyObjective>? monthlyObjectives,
    Object? objectivesDetail = _sentinel,
    Object? objectivesClientId = _sentinel,
    Object? objectivesYear = _sentinel,
    int? objectivesPageLimit,
    Object? deliverySummary = _sentinel,
    bool? isLoadingOverview,
    bool? isLoadingClients,
    bool? isLoadingDocuments,
    bool? isLoadingObjectives,
    bool? isLoadingNextObjectives,
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
      objectivesClientId: objectivesClientId == _sentinel
          ? this.objectivesClientId
          : objectivesClientId as String?,
      objectivesYear: objectivesYear == _sentinel
          ? this.objectivesYear
          : objectivesYear as int?,
      objectivesPageLimit: objectivesPageLimit ?? this.objectivesPageLimit,
      deliverySummary: deliverySummary == _sentinel
          ? this.deliverySummary
          : deliverySummary as RepartidorDeliverySummary?,
      isLoadingOverview: isLoadingOverview ?? this.isLoadingOverview,
      isLoadingClients: isLoadingClients ?? this.isLoadingClients,
      isLoadingDocuments: isLoadingDocuments ?? this.isLoadingDocuments,
      isLoadingObjectives: isLoadingObjectives ?? this.isLoadingObjectives,
      isLoadingNextObjectives:
          isLoadingNextObjectives ?? this.isLoadingNextObjectives,
      error: error == _sentinel ? this.error : error as String?,
      lastUpdated: lastUpdated == _sentinel
          ? this.lastUpdated
          : lastUpdated as DateTime?,
    );
  }

  static const _sentinel = Object();
}

class RepartidorFinanzasNotifier extends Notifier<RepartidorFinanzasState> {
  int _requestGeneration = 0;

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
    final requestGeneration = ++_requestGeneration;
    final filters = state.filters;
    if (!filters.hasRepartidor) return;

    state = state.copyWith(isLoadingOverview: true, error: null);

    // The three overview calls (collection summary, daily collections, delivery
    // summary) are independent GETs — fire them in parallel instead of paying
    // 3x serialized latency on every overview load. Partial-failure semantics
    // are preserved: collections errors degrade to empty + banner while the
    // delivery summary still decides success vs error state.
    final results = await Future.wait<List<dynamic>>([
      _service
          .getCollectionSummary(
            repartidorId: filters.repartidorId,
            year: filters.year,
            month: filters.month,
            forceRefresh: forceRefresh,
          )
          .then<List<dynamic>>((value) => [value])
          .catchError((_) => const []),
      _service
          .getDailyCollections(
            repartidorId: filters.repartidorId,
            year: filters.year,
            month: filters.month,
            forceRefresh: forceRefresh,
          )
          .then<List<dynamic>>((value) => [value])
          .catchError((_) => const []),
      _service
          .getDeliverySummary(
            repartidorId: filters.repartidorId,
            year: filters.year,
            month: filters.month,
            forceRefresh: forceRefresh,
          )
          .then<List<dynamic>>((value) => [value])
          .catchError((_) => const [null]),
    ]);

    final collectionSummary = results[0].isNotEmpty
        ? results[0][0] as RepartidorCollectionSummary
        : RepartidorCollectionSummary.empty(
            repartidorId: filters.repartidorId,
            year: filters.year,
            month: filters.month,
          );
    final collectionsIncomplete = results[0].isEmpty || results[1].isEmpty;
    final dailyCollections = results[1].isNotEmpty
        ? results[1][0] as List<DailyCollectionSnapshot>
        : const <DailyCollectionSnapshot>[];

    if (requestGeneration != _requestGeneration) return;
    final deliveryResult = results[2][0];
    if (deliveryResult != null) {
      state = state.copyWith(
        collectionSummary: collectionSummary,
        dailyCollections: dailyCollections,
        deliverySummary: deliveryResult as RepartidorDeliverySummary,
        isLoadingOverview: false,
        lastUpdated: DateTime.now(),
        error: collectionsIncomplete
            ? 'El detalle de cobros ERP no está completo. '
                'Entregas y liquidación sí están disponibles.'
            : null,
      );
    } else {
      state = state.copyWith(
        collectionSummary: collectionSummary,
        dailyCollections: dailyCollections,
        isLoadingOverview: false,
        error: 'No se pudo cargar el resumen de entregas.',
      );
    }
  }

  Future<void> loadClients({
    String? search,
    bool forceRefresh = false,
  }) async {
    final requestGeneration = ++_requestGeneration;
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
      if (requestGeneration != _requestGeneration) return;
      state = state.copyWith(
        clients: clients,
        isLoadingClients: false,
        lastUpdated: DateTime.now(),
      );
    } catch (_) {
      if (requestGeneration != _requestGeneration) return;
      state = state.copyWith(
        isLoadingClients: false,
        error: 'No se pudo cargar la lista de clientes.',
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
    final requestGeneration = ++_requestGeneration;
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
      if (requestGeneration != _requestGeneration) return;
      state = state.copyWith(
        selectedClientDocuments: documents,
        isLoadingDocuments: false,
        lastUpdated: DateTime.now(),
      );
    } catch (_) {
      if (requestGeneration != _requestGeneration) return;
      state = state.copyWith(
        isLoadingDocuments: false,
        error: 'No se pudieron cargar los documentos del cliente.',
      );
    }
  }

  Future<void> loadObjectives({
    String? clientId,
    int? year,
    int limit = 100,
    bool forceRefresh = false,
  }) async {
    final requestGeneration = ++_requestGeneration;
    final filters = state.filters;
    if (!filters.hasRepartidor) return;

    final selectedYear = year ?? filters.year;

    state = state.copyWith(
      objectivesDetail: null,
      objectivesClientId: clientId,
      objectivesYear: selectedYear,
      objectivesPageLimit: limit,
      isLoadingObjectives: true,
      isLoadingNextObjectives: false,
      error: null,
    );

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
          limit: limit,
          offset: 0,
          forceRefresh: forceRefresh,
        ),
      ]);

      if (requestGeneration != _requestGeneration) return;
      state = state.copyWith(
        monthlyObjectives: results[0] as List<RepartidorMonthlyObjective>,
        objectivesDetail: results[1] as RepartidorObjectivesDetail,
        isLoadingObjectives: false,
        lastUpdated: DateTime.now(),
      );
    } catch (_) {
      if (requestGeneration != _requestGeneration) return;
      state = state.copyWith(
        isLoadingObjectives: false,
        error: 'No se pudieron cargar los objetivos.',
      );
    }
  }

  Future<void> loadNextObjectives({bool forceRefresh = false}) async {
    final current = state.objectivesDetail;
    if (current == null ||
        !current.hasMore ||
        current.nextOffset == null ||
        state.isLoadingNextObjectives) {
      return;
    }
    final requestGeneration = ++_requestGeneration;

    final repartidorId = state.filters.repartidorId;
    final clientId = state.objectivesClientId;
    final year = state.objectivesYear ?? current.year;
    final limit = state.objectivesPageLimit;
    final offset = current.nextOffset!;
    state = state.copyWith(isLoadingNextObjectives: true, error: null);

    try {
      final nextPage = await _service.getObjectivesDetail(
        repartidorId: repartidorId,
        year: year,
        clientId: clientId,
        limit: limit,
        offset: offset,
        forceRefresh: forceRefresh,
      );
      final sameScope = state.filters.repartidorId == repartidorId &&
          state.objectivesClientId == clientId &&
          state.objectivesYear == year &&
          state.objectivesPageLimit == limit;
      if (!sameScope || requestGeneration != _requestGeneration) return;
      state = state.copyWith(
        objectivesDetail: current.mergePage(nextPage),
        isLoadingNextObjectives: false,
        lastUpdated: DateTime.now(),
      );
    } catch (_) {
      final sameScope = state.filters.repartidorId == repartidorId &&
          state.objectivesClientId == clientId &&
          state.objectivesYear == year;
      if (sameScope && requestGeneration == _requestGeneration) {
        state = state.copyWith(
          isLoadingNextObjectives: false,
          error: 'No se pudo cargar la siguiente pagina de objetivos.',
        );
      }
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
  return RepartidorFinanzasService();
});

final repartidorFinanzasRepositoryProvider =
    Provider<RepartidorFinanzasRepository>((ref) {
  return RepartidorFinanzasRepositoryImpl(
    ref.watch(repartidorFinanzasServiceProvider),
  );
});

final getDailySummaryUseCaseProvider = Provider<GetDailySummaryUseCase>((ref) {
  return GetDailySummaryUseCase(
    ref.watch(repartidorFinanzasRepositoryProvider),
  );
});

final submitLiquidacionUseCaseProvider =
    Provider<SubmitLiquidacionUseCase>((ref) {
  return SubmitLiquidacionUseCase(
    ref.watch(repartidorFinanzasRepositoryProvider),
  );
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

typedef LiquidacionLedgerArgs = ({
  String repartidorId,
  DateTime date,
});

typedef VencimientosArgs = ({
  String repartidorId,
  DateTime from,
  DateTime to,
  String? clientCode,
  String? search,
  String? estado,
  String? cursor,
  int limit,
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
  (ref, args) async {
    final result = await ref.watch(getDailySummaryUseCaseProvider)(
      repartidorId: args.repartidorId,
      date: args.date,
      forceRefresh: args.forceRefresh,
    );
    return result.fold(
      onSuccess: (summary) => summary,
      onFailure: (failure) => throw failure,
    );
  },
);

final repartidorLiquidacionLedgerProvider =
    FutureProvider.family<RepartidorLiquidacionLedger, LiquidacionLedgerArgs>(
  (ref, args) =>
      ref.read(repartidorFinanzasServiceProvider).getLiquidacionLedger(
            repartidorId: args.repartidorId,
            date: args.date,
          ),
);

final repartidorVencimientosProvider =
    FutureProvider.family<RepartidorVencimientosBatch, VencimientosArgs>(
  (ref, args) {
    return ref.read(repartidorFinanzasServiceProvider).getVencimientos(
          repartidorId: args.repartidorId,
          from: args.from,
          to: args.to,
          clientCode: args.clientCode,
          search: args.search,
          estado: args.estado,
          cursor: args.cursor,
          limit: args.limit,
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
    String? matricula,
    String? codigoVehiculo,
    bool sendEmails = true,
  }) async {
    final submission = await _ref.read(submitLiquidacionUseCaseProvider)(
      repartidorId: repartidorId,
      date: date,
      idempotencyToken: idempotencyToken,
      matricula: matricula,
      codigoVehiculo: codigoVehiculo,
      sendEmails: sendEmails,
    );
    final result = submission.fold(
      onSuccess: (value) => value,
      onFailure: (failure) => throw failure,
    );

    final dailyArgs = (
      repartidorId: repartidorId,
      date: date,
      forceRefresh: false,
    );
    _ref
      ..invalidate(repartidorDailySummaryProvider(dailyArgs))
      ..invalidate(
        repartidorLiquidacionLedgerProvider(
          (
            repartidorId: repartidorId,
            date: date,
          ),
        ),
      )
      ..invalidate(repartidorVencimientosProvider)
      ..invalidate(repartidorCommissionSummaryProvider);
    return result;
  }

  Future<RepartidorLiquidacionPdf> getClosedLiquidacionPdf({
    required RepartidorLiquidacionResult liquidacion,
    required String idempotencyToken,
  }) =>
      _ref.read(repartidorFinanzasServiceProvider).getClosedLiquidacionPdf(
            liquidacion: liquidacion,
            idempotencyToken: idempotencyToken,
          );

  Future<RepartidorLiquidacionEntryResult> createExpense({
    required String repartidorId,
    required DateTime date,
    required double amount,
    required String category,
    required String idempotencyToken,
    String? observation,
  }) =>
      _createEntry(
        repartidorId: repartidorId,
        date: date,
        amount: amount,
        idempotencyToken: idempotencyToken,
        submit: () => _ref
            .read(repartidorFinanzasServiceProvider)
            .createLiquidacionExpense(
              repartidorId: repartidorId,
              date: date,
              amount: amount,
              category: category,
              idempotencyToken: idempotencyToken,
              observation: observation,
            ),
      );

  Future<RepartidorLiquidacionEntryResult> createAdjustment({
    required String repartidorId,
    required DateTime date,
    required double amount,
    required String reason,
    required String idempotencyToken,
    String? observation,
  }) =>
      _createEntry(
        repartidorId: repartidorId,
        date: date,
        amount: amount,
        idempotencyToken: idempotencyToken,
        submit: () => _ref
            .read(repartidorFinanzasServiceProvider)
            .createLiquidacionAdjustment(
              repartidorId: repartidorId,
              date: date,
              amount: amount,
              reason: reason,
              idempotencyToken: idempotencyToken,
              observation: observation,
            ),
      );

  Future<RepartidorLiquidacionEntryResult> createBankDeposit({
    required String repartidorId,
    required DateTime date,
    required double amount,
    required String reference,
    required String idempotencyToken,
    String? observation,
  }) =>
      _createEntry(
        repartidorId: repartidorId,
        date: date,
        amount: amount,
        idempotencyToken: idempotencyToken,
        submit: () => _ref
            .read(repartidorFinanzasServiceProvider)
            .createLiquidacionBankDeposit(
              repartidorId: repartidorId,
              date: date,
              amount: amount,
              reference: reference,
              idempotencyToken: idempotencyToken,
              observation: observation,
            ),
      );

  Future<RepartidorLiquidacionEntryResult> _createEntry({
    required String repartidorId,
    required DateTime date,
    required double amount,
    required String idempotencyToken,
    required Future<RepartidorLiquidacionEntryResult> Function() submit,
  }) async {
    final result = await submit();
    final dailyArgs =
        (repartidorId: repartidorId, date: date, forceRefresh: false);
    _ref
      ..invalidate(repartidorDailySummaryProvider(dailyArgs))
      ..invalidate(
        repartidorLiquidacionLedgerProvider(
          (
            repartidorId: repartidorId,
            date: date,
          ),
        ),
      );
    return result;
  }

  Future<List<RepartidorCommissionTier>> saveCommissionTiers(
    List<RepartidorCommissionTier> tiers,
  ) async {
    final result = await _ref
        .read(repartidorFinanzasServiceProvider)
        .saveCommissionTiers(tiers);
    _ref
      ..invalidate(repartidorCommissionTiersProvider)
      ..invalidate(repartidorCommissionSummaryProvider);
    return result;
  }
}
