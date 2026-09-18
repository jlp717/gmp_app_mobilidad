/// Pure cache policy for order promotions.
///
/// The PMR endpoint receives DB2 client codes as CHAR(10), and an empty
/// promotion response must not be reused from cache.
String normalizePedidoClientCode(String? raw) {
  final trimmed = (raw ?? '').trim();
  if (trimmed.isEmpty) return '';
  return trimmed.length <= 10 ? trimmed : trimmed.substring(0, 10);
}

/// Builds the cache key for promotions for one client and vendor selection.
String promotionsCacheKey(String clientCode, String vendedorCodes) {
  return 'pedidos:promotions:'
      '${normalizePedidoClientCode(clientCode)}:${vendedorCodes.trim()}';
}

/// Mirror of GET /pedidos/promotions: never reuse a cached empty list.
bool shouldReusePromotionsCache(Object? cached) {
  if (cached is! Map) return false;
  final list = cached['promotions'];
  return list is List && list.isNotEmpty;
}
