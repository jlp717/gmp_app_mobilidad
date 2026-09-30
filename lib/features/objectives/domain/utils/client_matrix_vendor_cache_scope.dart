/// Canonical seller scope for the persistent client-matrix cache key.
///
/// A missing scope must not be cached: its effective value comes from the
/// authenticated session and cannot safely be inferred for a device-wide key.
String? clientMatrixVendorCacheScope(String? vendorCodes) {
  if (vendorCodes == null || vendorCodes.trim().isEmpty) return null;

  final codes = vendorCodes
      .split(',')
      .map((code) => code.trim())
      .where((code) => code.isNotEmpty)
      .toList()
    ..sort();
  return codes.isEmpty ? null : codes.join(',');
}

/// Builds a persistent matrix cache key that cannot cross seller scopes.
///
/// If the seller scope comes only from the authenticated session, return null
/// so the caller disables device-wide response caching.
String? clientMatrixCacheKey({
  required String clientCode,
  required String? vendorScope,
  required String years,
  required int startMonth,
  required int endMonth,
  required String productCode,
  required String productName,
  required String fi1,
  required String fi2,
  required String fi3,
  required String fi4,
  required String fi5,
}) {
  if (vendorScope == null || vendorScope.isEmpty) return null;

  return [
    'client-matrix-advanced',
    clientCode,
    'vendors:$vendorScope',
    years,
    startMonth,
    endMonth,
    productCode,
    productName,
    fi1,
    fi2,
    fi3,
    fi4,
    fi5,
  ].join(':');
}
