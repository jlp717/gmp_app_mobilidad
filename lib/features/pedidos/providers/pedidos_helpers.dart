/// Pedidos helpers puros (fase4 WS-C5).
///
/// Extraídos copia exacta del viejo `pedidos_provider.dart` (L30-93) para
/// romper la dependencia del `PedidosNotifier` y `promotions_banner.dart`
/// contra el provider mutable. Sin estado, sin Riverpod: solo funciones
/// puras testeables.
library;

import 'package:flutter/foundation.dart';

/// CHAR(10) client codes come padded from DB2; the PMR lookup casts to CHAR(10).
@visibleForTesting
String normalizePedidoClientCode(String? raw) {
  final trimmed = (raw ?? '').trim();
  if (trimmed.isEmpty) return '';
  return trimmed.length <= 10 ? trimmed : trimmed.substring(0, 10);
}

@visibleForTesting
String promotionsCacheKey(String clientCode, String vendedorCodes) {
  return 'pedidos:promotions:${normalizePedidoClientCode(clientCode)}:${vendedorCodes.trim()}';
}

/// Mirror of GET /pedidos/promotions: never reuse a cached empty list.
@visibleForTesting
bool shouldReusePromotionsCache(Object? cached) {
  if (cached is! Map) return false;
  final list = cached['promotions'];
  return list is List && list.isNotEmpty;
}

/// Chooses the provider-facing result from create + confirm API responses.
Map<String, dynamic> normalizeConfirmOrderResultForProvider({
  required Map<String, dynamic> createResult,
  required Map<String, dynamic> confirmedResult,
}) {
  if (confirmedResult['blocked'] == true) {
    return Map<String, dynamic>.from(confirmedResult);
  }

  final order = confirmedResult['order'];
  final orderMap = order is Map ? Map<String, dynamic>.from(order) : null;
  final header = confirmedResult['header'] ?? orderMap?['header'] ?? orderMap;
  if (header is Map) {
    final normalized = Map<String, dynamic>.from(header);
    if (orderMap?['lines'] is List) normalized['lines'] = orderMap!['lines'];
    return normalized;
  }

  return Map<String, dynamic>.from(createResult);
}

/// Returns true when the cart may be cleared after confirmation.
bool shouldClearCartAfterConfirmation(Map<String, dynamic>? result) {
  return isConfirmedOrderResultForProvider(result);
}

/// Extracts backend order status from a normalized header or wrapper.
String orderConfirmationStatusForProvider(Map<String, dynamic>? result) {
  if (result == null) return '';

  final header = result['header'];
  final rawStatus = result['estado'] ??
      result['estadoPedido'] ??
      (header is Map ? header['estado'] ?? header['estadoPedido'] : null);

  return rawStatus?.toString().trim().toUpperCase() ?? '';
}

/// Returns true only after the backend leaves the order confirmed.
bool isConfirmedOrderResultForProvider(Map<String, dynamic>? result) {
  if (result == null || result['blocked'] == true) return false;

  final status = orderConfirmationStatusForProvider(result);
  return status == 'CONFIRMADO';
}
