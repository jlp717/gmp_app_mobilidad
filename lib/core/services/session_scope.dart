import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/cache/cache_service.dart';
import 'package:gmp_app_mobilidad/core/models/user_model.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_queue_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_favorites_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';

class SessionScope {
  const SessionScope._();

  static String build(UserModel user, List<String> vendedorCodes) {
    return buildRaw(
      userCode: user.code,
      role: user.role,
      isJefeVentas: user.isJefeVentas,
      vendedorCodes: vendedorCodes,
    );
  }

  static String buildRaw({
    required String userCode,
    required String role,
    required bool isJefeVentas,
    required List<String> vendedorCodes,
  }) {
    final normalizedCodes = vendedorCodes
        .map((code) => code.trim())
        .where((code) => code.isNotEmpty)
        .toSet()
        .toList()
      ..sort();

    return [
      'user=${userCode.trim()}',
      'role=${role.trim().toUpperCase()}',
      'jefe=$isJefeVentas',
      'vendors=${normalizedCodes.join(',')}',
    ].join('|');
  }

  static void apply(UserModel user, List<String> vendedorCodes) {
    final scope = build(user, vendedorCodes);
    CacheService.setScope(scope);
    SyncQueueService.instance.setScope(scope);
    PedidosOfflineService.setScope(scope);
    PedidosFavoritesService.setScope(scope);
  }

  static void applyRaw({
    required String userCode,
    required String role,
    required bool isJefeVentas,
    required List<String> vendedorCodes,
  }) {
    final scope = buildRaw(
      userCode: userCode,
      role: role,
      isJefeVentas: isJefeVentas,
      vendedorCodes: vendedorCodes,
    );
    CacheService.setScope(scope);
    SyncQueueService.instance.setScope(scope);
    PedidosOfflineService.setScope(scope);
    PedidosFavoritesService.setScope(scope);
  }

  static void clear() {
    CacheService.clearScope();
    SyncQueueService.instance.clearScope();
    PedidosOfflineService.clearScope();
    PedidosFavoritesService.clearScope();
    debugPrint('[SessionScope] Cleared');
  }
}
