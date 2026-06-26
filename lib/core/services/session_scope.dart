import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_favorites_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';

class SessionScope {
  const SessionScope._();

  static String build(UserModel user, List<String> vendedorCodes) {
    final normalizedCodes = vendedorCodes
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .toSet()
        .toList()
      ..sort();

    return [
      'user=${user.code.trim()}',
      'role=${user.role.trim().toUpperCase()}',
      'jefe=${user.isJefeVentas}',
      'vendors=${normalizedCodes.join(',')}',
    ].join('|');
  }

  static void apply(UserModel user, List<String> vendedorCodes) {
    final scope = build(user, vendedorCodes);
    CacheService.setScope(scope);
    PedidosOfflineService.setScope(scope);
    PedidosFavoritesService.setScope(scope);
  }

  static void clear() {
    CacheService.clearScope();
    PedidosOfflineService.clearScope();
    PedidosFavoritesService.clearScope();
    debugPrint('[SessionScope] Cleared');
  }
}
