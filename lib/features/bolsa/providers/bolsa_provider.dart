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
  bool _isLoading = false;
  String? _error;
  String? _currentVendor;

  BolsaStatus? get status => _status;
  List<BolsaMovimiento> get movements => List.unmodifiable(_movements);
  bool get isLoading => _isLoading;
  String? get error => _error;
  String? get currentVendor => _currentVendor;
  bool get hasData => _status != null;

  Future<void> load(String vendedorCode, {bool force = false}) async {
    final code = vendedorCode.trim();
    if (code.isEmpty) {
      _status = null;
      _movements = [];
      _currentVendor = null;
      _error = 'Selecciona un vendedor para ver su bolsa';
      notifyListeners();
      return;
    }
    if (!force && _currentVendor == code && _status != null) return;
    _isLoading = true;
    _error = null;
    _currentVendor = code;
    notifyListeners();
    try {
      final results = await Future.wait([
        BolsaService.getStatus(code),
        BolsaService.getMovements(code, limit: 100),
      ]);
      _status = results[0] as BolsaStatus;
      _movements = (results[1] as List<BolsaMovimiento>)
          .toList(growable: false);
      _error = null;
    } catch (e) {
      _error = e.toString();
      debugPrint('[BolsaProvider] load error: $e');
    } finally {
      _isLoading = false;
      notifyListeners();
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
