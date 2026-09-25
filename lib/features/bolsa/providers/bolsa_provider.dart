/// Bolsa Comercial Provider (Req #3)
/// ==================================
/// Estado de la bolsa para el vendedor en curso. Refresca al cambiar
/// el vendedor seleccionado.
///
/// Migrado a Notifier + NotifierProvider (Riverpod puro, sin ChangeNotifier).
/// El estado es [BolsaState] inmutable; la logica vive en [BolsaProvider]
/// (Notifier) y los callers usan `ref.read(bolsaProvider.notifier)` para
/// acciones y `ref.watch(bolsaProvider.select(...))` sobre el estado.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_service.dart';

void _debugLog(String message) {
  if (kDebugMode) debugPrint(message);
}

final bolsaProvider = NotifierProvider<BolsaProvider, BolsaState>(
  BolsaProvider.new,
);

/// Estado inmutable de la bolsa comercial.
@immutable
class BolsaState {
  const BolsaState({
    this.status,
    this.groupedSummary,
    this.movements = const <BolsaMovimiento>[],
    this.history = const <BolsaMonthlyPoint>[],
    this.isLoading = false,
    this.error,
    this.currentVendor,
    this.isGroupedView = false,
    this.groupedVendorCodes = const <String>[],
    required this.selectedYear,
    required this.selectedMonth,
    this.tipoFilter,
    this.searchQuery = '',
    this.dateFromFilter,
    this.dateToFilter,
    this.documentFilter = '',
    this.clientFilter = '',
  });

  final BolsaStatus? status;
  final BolsaGroupedSummary? groupedSummary;
  final List<BolsaMovimiento> movements;
  final List<BolsaMonthlyPoint> history;
  final bool isLoading;
  final String? error;
  final String? currentVendor;
  final bool isGroupedView;
  final List<String> groupedVendorCodes;
  final int selectedYear;
  final int selectedMonth;

  // Filtros de movimientos
  final BolsaMovimientoTipo? tipoFilter; // null = todos
  final String searchQuery;
  final DateTime? dateFromFilter;
  final DateTime? dateToFilter;
  final String documentFilter;
  final String clientFilter;

  bool get hasData => status != null || groupedSummary != null;

  bool get hasAdvancedFilters =>
      dateFromFilter != null ||
      dateToFilter != null ||
      documentFilter.isNotEmpty ||
      clientFilter.isNotEmpty;

  /// Movimientos aplicando filtros activos.
  List<BolsaMovimiento> get filteredMovements {
    final q = searchQuery.trim().toLowerCase();
    return movements.where((m) {
      if (tipoFilter != null && m.tipo != tipoFilter) return false;
      if (q.isNotEmpty) {
        final hay = m.codigoArticulo.toLowerCase().contains(q) ||
            m.descripcion.toLowerCase().contains(q) ||
            m.displayCliente.toLowerCase().contains(q) ||
            m.displayPedido.toLowerCase().contains(q) ||
            (m.pedidoId?.toString().contains(q) ?? false) ||
            (m.pedidoNumero?.toString().contains(q) ?? false) ||
            (m.lineId?.toString().contains(q) ?? false) ||
            (m.idempotencyKey?.toLowerCase().contains(q) ?? false);
        if (!hay) return false;
      }
      return true;
    }).toList(growable: false);
  }

  /// Cuenta de movimientos por tipo (para badges en chips).
  Map<BolsaMovimientoTipo, int> get countsByTipo {
    final out = <BolsaMovimientoTipo, int>{};
    for (final m in movements) {
      out[m.tipo] = (out[m.tipo] ?? 0) + 1;
    }
    return out;
  }

  BolsaState copyWith({
    BolsaStatus? status,
    BolsaGroupedSummary? groupedSummary,
    List<BolsaMovimiento>? movements,
    List<BolsaMonthlyPoint>? history,
    bool? isLoading,
    String? error,
    String? currentVendor,
    bool? isGroupedView,
    List<String>? groupedVendorCodes,
    int? selectedYear,
    int? selectedMonth,
    BolsaMovimientoTipo? tipoFilter,
    String? searchQuery,
    DateTime? dateFromFilter,
    DateTime? dateToFilter,
    String? documentFilter,
    String? clientFilter,
    bool clearStatus = false,
    bool clearGroupedSummary = false,
    bool clearError = false,
    bool clearCurrentVendor = false,
    bool clearTipoFilter = false,
    bool clearDateFromFilter = false,
    bool clearDateToFilter = false,
  }) {
    return BolsaState(
      status: clearStatus ? null : (status ?? this.status),
      groupedSummary:
          clearGroupedSummary ? null : (groupedSummary ?? this.groupedSummary),
      movements: movements ?? this.movements,
      history: history ?? this.history,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      currentVendor:
          clearCurrentVendor ? null : (currentVendor ?? this.currentVendor),
      isGroupedView: isGroupedView ?? this.isGroupedView,
      groupedVendorCodes: groupedVendorCodes ?? this.groupedVendorCodes,
      selectedYear: selectedYear ?? this.selectedYear,
      selectedMonth: selectedMonth ?? this.selectedMonth,
      tipoFilter: clearTipoFilter ? null : (tipoFilter ?? this.tipoFilter),
      searchQuery: searchQuery ?? this.searchQuery,
      dateFromFilter:
          clearDateFromFilter ? null : (dateFromFilter ?? this.dateFromFilter),
      dateToFilter:
          clearDateToFilter ? null : (dateToFilter ?? this.dateToFilter),
      documentFilter: documentFilter ?? this.documentFilter,
      clientFilter: clientFilter ?? this.clientFilter,
    );
  }
}

class BolsaProvider extends Notifier<BolsaState> {
  int _loadGeneration = 0;

  @override
  BolsaState build() {
    final now = DateTime.now();
    return BolsaState(selectedYear: now.year, selectedMonth: now.month);
  }

  // ── Lecturas delegadas al estado (compat con widgets que reciben
  // el notifier y leen provider.xxx) ──
  BolsaStatus? get status => state.status;
  BolsaGroupedSummary? get groupedSummary => state.groupedSummary;
  List<BolsaMovimiento> get movements => state.movements;
  List<BolsaMonthlyPoint> get history => state.history;
  bool get isLoading => state.isLoading;
  String? get error => state.error;
  String? get currentVendor => state.currentVendor;
  bool get isGroupedView => state.isGroupedView;
  bool get hasData => state.hasData;
  int get selectedYear => state.selectedYear;
  int get selectedMonth => state.selectedMonth;
  BolsaMovimientoTipo? get tipoFilter => state.tipoFilter;
  String get searchQuery => state.searchQuery;
  DateTime? get dateFromFilter => state.dateFromFilter;
  DateTime? get dateToFilter => state.dateToFilter;
  String get documentFilter => state.documentFilter;
  String get clientFilter => state.clientFilter;
  bool get hasAdvancedFilters => state.hasAdvancedFilters;
  List<BolsaMovimiento> get filteredMovements => state.filteredMovements;
  Map<BolsaMovimientoTipo, int> get countsByTipo => state.countsByTipo;

  void setTipoFilter(BolsaMovimientoTipo? tipo) {
    if (state.tipoFilter == tipo) return;
    state = state.copyWith(tipoFilter: tipo, clearTipoFilter: tipo == null);
  }

  void setSearchQuery(String q) {
    final v = q.trim();
    if (state.searchQuery == v) return;
    state = state.copyWith(searchQuery: v);
  }

  Future<void> setDateRange(DateTime? from, DateTime? to) async {
    if (_sameDate(state.dateFromFilter, from) &&
        _sameDate(state.dateToFilter, to)) {
      return;
    }
    state = state.copyWith(
      dateFromFilter: from,
      dateToFilter: to,
      clearDateFromFilter: from == null,
      clearDateToFilter: to == null,
    );
    await refresh();
  }

  Future<void> setDocumentFilter(String value) async {
    final next = value.trim();
    if (state.documentFilter == next) return;
    state = state.copyWith(documentFilter: next);
    await refresh();
  }

  Future<void> setClientFilter(String value) async {
    final next = value.trim();
    if (state.clientFilter == next) return;
    state = state.copyWith(clientFilter: next);
    await refresh();
  }

  Future<void> clearFilters() async {
    if (state.tipoFilter == null &&
        state.searchQuery.isEmpty &&
        !state.hasAdvancedFilters) {
      return;
    }
    state = state.copyWith(
      searchQuery: '',
      documentFilter: '',
      clientFilter: '',
      clearTipoFilter: true,
      clearDateFromFilter: true,
      clearDateToFilter: true,
    );
    await refresh();
  }

  void _clearVendorSelection({String? message}) {
    _loadGeneration++;
    state = state.copyWith(
      movements: const <BolsaMovimiento>[],
      history: const <BolsaMonthlyPoint>[],
      isLoading: false,
      isGroupedView: false,
      groupedVendorCodes: const <String>[],
      error: message,
      clearStatus: true,
      clearGroupedSummary: true,
      clearCurrentVendor: true,
      clearError: message == null,
    );
  }

  Future<void> load(String vendedorCode, {bool force = false}) async {
    final code = vendedorCode.trim();
    if (code.isEmpty || code.toUpperCase() == 'ALL') {
      _clearVendorSelection(
        message:
            code.isEmpty ? 'Selecciona un vendedor para ver su bolsa' : null,
      );
      return;
    }
    if (!force && state.currentVendor == code && state.status != null) return;
    final generation = ++_loadGeneration;
    state = state.copyWith(
      isLoading: true,
      currentVendor: code,
      isGroupedView: false,
      clearError: true,
      clearGroupedSummary: true,
    );
    try {
      final results = await Future.wait([
        BolsaService.getStatus(
          code,
          year: state.selectedYear,
          month: state.selectedMonth,
          forceRefresh: force,
        ),
        BolsaService.getMovements(
          code,
          limit: 150,
          year: state.selectedYear,
          month: state.selectedMonth,
          dateFrom: state.dateFromFilter,
          dateTo: state.dateToFilter,
          documentQuery: state.documentFilter,
          clientQuery: state.clientFilter,
          forceRefresh: force || state.hasAdvancedFilters,
        ),
        BolsaService.getHistory(
          code,
          months: 12,
          year: state.selectedYear,
          month: state.selectedMonth,
          forceRefresh: force,
        ),
      ]);
      if (generation != _loadGeneration || state.currentVendor != code) return;
      state = state.copyWith(
        status: results[0] as BolsaStatus,
        movements: _dedupeMovements(
          (results[1] as List<BolsaMovimiento>).toList(growable: false),
        ),
        history:
            (results[2] as List<BolsaMonthlyPoint>).toList(growable: false),
        clearError: true,
      );
    } catch (e) {
      if (generation == _loadGeneration) {
        state = state.copyWith(error: e.toString());
        _debugLog('[BolsaProvider] load error: $e');
      }
    } finally {
      if (generation == _loadGeneration) {
        state = state.copyWith(isLoading: false);
      }
    }
  }

  Future<void> loadGrouped({
    List<String>? vendedorCodes,
    bool force = false,
  }) async {
    final codes = (vendedorCodes ?? const <String>[])
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty && code.toUpperCase() != 'ALL')
        .toList(growable: false);
    final key = codes.join(',');
    if (!force &&
        state.isGroupedView &&
        state.groupedSummary != null &&
        key == state.currentVendor) {
      return;
    }
    final generation = ++_loadGeneration;
    state = state.copyWith(
      isLoading: true,
      currentVendor: key,
      groupedVendorCodes: codes,
      isGroupedView: true,
      movements: const <BolsaMovimiento>[],
      history: const <BolsaMonthlyPoint>[],
      clearError: true,
      clearStatus: true,
    );
    try {
      final grouped = await BolsaService.getGroupedStatus(
        year: state.selectedYear,
        month: state.selectedMonth,
        vendedorCodes: codes,
        forceRefresh: force,
      );
      if (generation != _loadGeneration || !state.isGroupedView) return;
      state = state.copyWith(groupedSummary: grouped, clearError: true);
    } catch (e) {
      if (generation == _loadGeneration) {
        state = state.copyWith(error: e.toString());
        _debugLog('[BolsaProvider] loadGrouped error: $e');
      }
    } finally {
      if (generation == _loadGeneration) {
        state = state.copyWith(isLoading: false);
      }
    }
  }

  Future<bool> updateConfig({
    required double limitePct,
    double? limiteImporte,
  }) async {
    final code = state.currentVendor;
    if (code == null || code.isEmpty) return false;
    try {
      final updated = await BolsaService.updateConfig(
        code,
        limitePct: limitePct,
        limiteImporte: limiteImporte,
        year: state.selectedYear,
        month: state.selectedMonth,
      );
      state = state.copyWith(status: updated);
      return true;
    } catch (e) {
      state = state.copyWith(error: e.toString());
      return false;
    }
  }

  Future<void> refresh() async {
    if (state.isGroupedView) {
      await loadGrouped(
        vendedorCodes: List<String>.unmodifiable(state.groupedVendorCodes),
        force: true,
      );
      return;
    }
    if (state.currentVendor == null) return;
    await load(state.currentVendor!, force: true);
  }

  Future<void> setPeriod({required int year, required int month}) async {
    final boundedMonth = month.clamp(1, 12);
    final boundedYear = year.clamp(2020, 2030);
    if (state.selectedYear == boundedYear &&
        state.selectedMonth == boundedMonth) {
      return;
    }
    state = state.copyWith(
      selectedYear: boundedYear,
      selectedMonth: boundedMonth,
    );
    await refresh();
  }

  static bool _sameDate(DateTime? left, DateTime? right) {
    if (left == null || right == null) return left == right;
    return left.year == right.year &&
        left.month == right.month &&
        left.day == right.day;
  }

  /// Evita duplicados si el backend reenvía el mismo movimiento (id o idempotencyKey).
  static List<BolsaMovimiento> _dedupeMovements(List<BolsaMovimiento> raw) {
    final seen = <String>{};
    final out = <BolsaMovimiento>[];
    for (final movement in raw) {
      final key = movement.idempotencyKey?.trim();
      final dedupeKey =
          (key != null && key.isNotEmpty) ? key : 'id:${movement.id}';
      if (seen.add(dedupeKey)) {
        out.add(movement);
      }
    }
    return out;
  }
}
