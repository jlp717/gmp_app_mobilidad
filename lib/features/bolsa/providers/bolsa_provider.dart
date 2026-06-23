/// Bolsa Comercial Provider (Req #3)
/// ==================================
/// Estado de la bolsa para el vendedor en curso. Refresca al cambiar
/// el vendedor seleccionado.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_service.dart';

void _debugLog(String message) {
  if (kDebugMode) debugPrint(message);
}

final bolsaProvider = ChangeNotifierProvider<BolsaProvider>(
  (ref) => BolsaProvider(),
);

class BolsaProvider with ChangeNotifier {
  BolsaStatus? _status;
  BolsaGroupedSummary? _groupedSummary;
  List<BolsaMovimiento> _movements = [];
  List<BolsaMonthlyPoint> _history = [];
  bool _isLoading = false;
  String? _error;
  String? _currentVendor;
  bool _isGroupedView = false;
  List<String> _groupedVendorCodes = [];
  int _loadGeneration = 0;

  // Filtros de movimientos
  BolsaMovimientoTipo? _tipoFilter; // null = todos
  String _searchQuery = '';
  DateTime? _dateFromFilter;
  DateTime? _dateToFilter;
  String _documentFilter = '';
  String _clientFilter = '';

  BolsaStatus? get status => _status;
  BolsaGroupedSummary? get groupedSummary => _groupedSummary;
  List<BolsaMovimiento> get movements => List.unmodifiable(_movements);
  List<BolsaMonthlyPoint> get history => List.unmodifiable(_history);
  bool get isLoading => _isLoading;
  String? get error => _error;
  String? get currentVendor => _currentVendor;
  bool get isGroupedView => _isGroupedView;
  bool get hasData => _status != null || _groupedSummary != null;
  BolsaMovimientoTipo? get tipoFilter => _tipoFilter;
  String get searchQuery => _searchQuery;
  DateTime? get dateFromFilter => _dateFromFilter;
  DateTime? get dateToFilter => _dateToFilter;
  String get documentFilter => _documentFilter;
  String get clientFilter => _clientFilter;
  bool get hasAdvancedFilters =>
      _dateFromFilter != null ||
      _dateToFilter != null ||
      _documentFilter.isNotEmpty ||
      _clientFilter.isNotEmpty;

  /// Movimientos aplicando filtros activos.
  List<BolsaMovimiento> get filteredMovements {
    final q = _searchQuery.trim().toLowerCase();
    return _movements.where((m) {
      if (_tipoFilter != null && m.tipo != _tipoFilter) return false;
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
    for (final m in _movements) {
      out[m.tipo] = (out[m.tipo] ?? 0) + 1;
    }
    return out;
  }

  void setTipoFilter(BolsaMovimientoTipo? tipo) {
    if (_tipoFilter == tipo) return;
    _tipoFilter = tipo;
    notifyListeners();
  }

  void setSearchQuery(String q) {
    final v = q.trim();
    if (_searchQuery == v) return;
    _searchQuery = v;
    notifyListeners();
  }

  Future<void> setDateRange(DateTime? from, DateTime? to) async {
    if (_sameDate(_dateFromFilter, from) && _sameDate(_dateToFilter, to)) {
      return;
    }
    _dateFromFilter = from;
    _dateToFilter = to;
    notifyListeners();
    await refresh();
  }

  Future<void> setDocumentFilter(String value) async {
    final next = value.trim();
    if (_documentFilter == next) return;
    _documentFilter = next;
    notifyListeners();
    await refresh();
  }

  Future<void> setClientFilter(String value) async {
    final next = value.trim();
    if (_clientFilter == next) return;
    _clientFilter = next;
    notifyListeners();
    await refresh();
  }

  Future<void> clearFilters() async {
    if (_tipoFilter == null &&
        _searchQuery.isEmpty &&
        !hasAdvancedFilters) {
      return;
    }
    _tipoFilter = null;
    _searchQuery = '';
    _dateFromFilter = null;
    _dateToFilter = null;
    _documentFilter = '';
    _clientFilter = '';
    notifyListeners();
    await refresh();
  }

  void _clearVendorSelection({String? message}) {
    _loadGeneration++;
    _status = null;
    _groupedSummary = null;
    _movements = [];
    _history = [];
    _currentVendor = null;
    _isGroupedView = false;
    _groupedVendorCodes = [];
    _isLoading = false;
    _error = message;
    notifyListeners();
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
    if (!force && _currentVendor == code && _status != null) return;
    _isLoading = true;
    _error = null;
    _currentVendor = code;
    _isGroupedView = false;
    _groupedSummary = null;
    final generation = ++_loadGeneration;
    notifyListeners();
    try {
      final results = await Future.wait([
        BolsaService.getStatus(code, forceRefresh: force),
        BolsaService.getMovements(
          code,
          limit: 150,
          dateFrom: _dateFromFilter,
          dateTo: _dateToFilter,
          documentQuery: _documentFilter,
          clientQuery: _clientFilter,
          forceRefresh: force || hasAdvancedFilters,
        ),
        BolsaService.getHistory(code, months: 12, forceRefresh: force),
      ]);
      if (generation != _loadGeneration || _currentVendor != code) return;
      _status = results[0] as BolsaStatus;
      _movements = _dedupeMovements(
        (results[1] as List<BolsaMovimiento>).toList(growable: false),
      );
      _history =
          (results[2] as List<BolsaMonthlyPoint>).toList(growable: false);
      _error = null;
    } catch (e) {
      if (generation == _loadGeneration) {
        _error = e.toString();
        _debugLog('[BolsaProvider] load error: $e');
      }
    } finally {
      if (generation == _loadGeneration) {
        _isLoading = false;
        notifyListeners();
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
    if (!force && _isGroupedView && _groupedSummary != null && key == _currentVendor) {
      return;
    }
    _isLoading = true;
    _error = null;
    _currentVendor = key;
    _groupedVendorCodes = codes;
    _isGroupedView = true;
    _status = null;
    _movements = [];
    _history = [];
    final generation = ++_loadGeneration;
    notifyListeners();
    try {
      final grouped = await BolsaService.getGroupedStatus(
        vendedorCodes: codes,
        forceRefresh: force,
      );
      if (generation != _loadGeneration || !_isGroupedView) return;
      _groupedSummary = grouped;
      _error = null;
    } catch (e) {
      if (generation == _loadGeneration) {
        _error = e.toString();
        _debugLog('[BolsaProvider] loadGrouped error: $e');
      }
    } finally {
      if (generation == _loadGeneration) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }

  Future<bool> updateConfig({
    required double limitePct,
    double? limiteImporte,
  }) async {
    final code = _currentVendor;
    if (code == null || code.isEmpty) return false;
    try {
      final updated = await BolsaService.updateConfig(
        code,
        limitePct: limitePct,
        limiteImporte: limiteImporte,
      );
      _status = updated;
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<void> refresh() async {
    if (_isGroupedView) {
      await loadGrouped(vendedorCodes: _groupedVendorCodes, force: true);
      return;
    }
    if (_currentVendor == null) return;
    await load(_currentVendor!, force: true);
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
