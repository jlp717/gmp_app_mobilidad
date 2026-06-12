/// Bolsa Comercial Provider (Req #3)
/// ==================================
/// Estado de la bolsa para el vendedor en curso. Refresca al cambiar
/// el vendedor seleccionado.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_service.dart';

final bolsaProvider = ChangeNotifierProvider<BolsaProvider>(
  (ref) => BolsaProvider(),
);

class BolsaProvider with ChangeNotifier {
  BolsaStatus? _status;
  List<BolsaMovimiento> _movements = [];
  List<BolsaMonthlyPoint> _history = [];
  bool _isLoading = false;
  String? _error;
  String? _currentVendor;
  int _loadGeneration = 0;

  // Filtros de movimientos
  BolsaMovimientoTipo? _tipoFilter; // null = todos
  String _searchQuery = '';

  BolsaStatus? get status => _status;
  List<BolsaMovimiento> get movements => List.unmodifiable(_movements);
  List<BolsaMonthlyPoint> get history => List.unmodifiable(_history);
  bool get isLoading => _isLoading;
  String? get error => _error;
  String? get currentVendor => _currentVendor;
  bool get hasData => _status != null;
  BolsaMovimientoTipo? get tipoFilter => _tipoFilter;
  String get searchQuery => _searchQuery;

  /// Movimientos aplicando filtros activos.
  List<BolsaMovimiento> get filteredMovements {
    final q = _searchQuery.trim().toLowerCase();
    return _movements.where((m) {
      if (_tipoFilter != null && m.tipo != _tipoFilter) return false;
      if (q.isNotEmpty) {
        final hay = m.codigoArticulo.toLowerCase().contains(q) ||
            m.descripcion.toLowerCase().contains(q) ||
            (m.pedidoId?.toString().contains(q) ?? false) ||
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

  void clearFilters() {
    if (_tipoFilter == null && _searchQuery.isEmpty) return;
    _tipoFilter = null;
    _searchQuery = '';
    notifyListeners();
  }

  void _clearVendorSelection({String? message}) {
    _loadGeneration++;
    _status = null;
    _movements = [];
    _history = [];
    _currentVendor = null;
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
    final generation = ++_loadGeneration;
    notifyListeners();
    try {
      final results = await Future.wait([
        BolsaService.getStatus(code, forceRefresh: force),
        BolsaService.getMovements(code, limit: 100, forceRefresh: force),
        BolsaService.getHistory(code, months: 12, forceRefresh: force),
      ]);
      if (generation != _loadGeneration || _currentVendor != code) return;
      _status = results[0] as BolsaStatus;
      _movements =
          (results[1] as List<BolsaMovimiento>).toList(growable: false);
      _history =
          (results[2] as List<BolsaMonthlyPoint>).toList(growable: false);
      _error = null;
    } catch (e) {
      if (generation == _loadGeneration) {
        _error = e.toString();
        debugPrint('[BolsaProvider] load error: $e');
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
    if (_currentVendor == null) return;
    await load(_currentVendor!, force: true);
  }
}
