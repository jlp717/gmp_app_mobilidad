// ignore_for_file: public_member_api_docs

String normalizeVendorCode(String? code) {
  final raw = (code ?? '').trim();
  if (raw.isEmpty) return raw;
  final normalized = raw.replaceFirst(RegExp('^0+'), '');
  return normalized.isEmpty ? raw : normalized;
}

List<String> uniqueVendorCodes(Iterable<String> codes) {
  final seen = <String>{};
  final result = <String>[];

  for (final code in codes) {
    final trimmed = code.trim();
    if (trimmed.isEmpty) continue;

    final normalized = normalizeVendorCode(trimmed);
    if (seen.add(normalized)) {
      result.add(trimmed);
    }
  }

  return result;
}

bool vendorCodeListContains(Iterable<String> codes, String? code) {
  final normalized = normalizeVendorCode(code);
  if (normalized.isEmpty) return false;
  return codes.any((c) => normalizeVendorCode(c) == normalized);
}

/// Returns true only when the authenticated claims explicitly contain more
/// than the user's own vendor. The backend is responsible for issuing those
/// claims from ERP/authorization data; this client never derives them by ID.
bool hasScopedVendorAccess({
  required String? userCode,
  required List<String> vendorCodes,
}) {
  final uniqueCodes = uniqueVendorCodes(vendorCodes);
  final ownCode = normalizeVendorCode(userCode);
  return uniqueCodes.length > 1 &&
      ownCode.isNotEmpty &&
      vendorCodeListContains(uniqueCodes, ownCode);
}

List<String> allowedVendorCodesForScope(List<String> authVendorCodes) =>
    uniqueVendorCodes(authVendorCodes);

List<String>? effectiveAllowedVendorCodes({
  required String? userCode,
  required List<String> authVendorCodes,
  List<String>? explicitAllowedCodes,
}) {
  if (explicitAllowedCodes != null && explicitAllowedCodes.isNotEmpty) {
    return uniqueVendorCodes(explicitAllowedCodes);
  }

  if (hasScopedVendorAccess(
    userCode: userCode,
    vendorCodes: authVendorCodes,
  )) {
    return allowedVendorCodesForScope(authVendorCodes);
  }

  return null;
}

String resolveScopedVendorCodes({
  required String? userCode,
  required List<String> authVendorCodes,
  required String? selectedVendor,
  required String fallbackVendorCodes,
}) {
  final allowedCodes = allowedVendorCodesForScope(authVendorCodes);
  final fallback = fallbackVendorCodes.trim();
  final scopedFallback = fallback.isNotEmpty && fallback.toUpperCase() != 'ALL'
      ? fallback
      : allowedCodes.join(',');

  if (selectedVendor == null ||
      selectedVendor.isEmpty ||
      selectedVendor == 'ALL') {
    return scopedFallback;
  }

  if (vendorCodeListContains(allowedCodes, selectedVendor)) {
    return selectedVendor;
  }

  return scopedFallback;
}

/// Vendor codes sent to commercial rutero APIs.
///
/// Jefe "Todos" must stay the literal ALL so the API expands visible claims.
/// A plain commercial never sends ALL or another persisted vendor from a
/// previous session.
String resolveRuteroRequestVendorCodes({
  required String? userCode,
  required List<String> authVendorCodes,
  required String? selectedVendor,
  required String fallbackVendorCodes,
  required bool isJefeVentas,
}) {
  if (isJefeVentas) {
    if (selectedVendor == null ||
        selectedVendor.isEmpty ||
        selectedVendor.toUpperCase() == 'ALL') {
      return 'ALL';
    }
    return selectedVendor;
  }

  if (hasScopedVendorAccess(
    userCode: userCode,
    vendorCodes: authVendorCodes,
  )) {
    return resolveScopedVendorCodes(
      userCode: userCode,
      authVendorCodes: authVendorCodes,
      selectedVendor: selectedVendor,
      fallbackVendorCodes: fallbackVendorCodes,
    );
  }

  final ownCodes = uniqueVendorCodes(<String>[
    if (userCode != null && userCode.trim().isNotEmpty) userCode,
    ...authVendorCodes,
    ...fallbackVendorCodes.split(','),
  ]).where((code) => code.toUpperCase() != 'ALL').toList();
  final own = ownCodes.isNotEmpty ? ownCodes.first : fallbackVendorCodes.trim();

  if (selectedVendor == null ||
      selectedVendor.isEmpty ||
      selectedVendor.toUpperCase() == 'ALL' ||
      selectedVendor.contains(',')) {
    return own;
  }

  if (vendorCodeListContains(ownCodes, selectedVendor)) {
    return selectedVendor;
  }

  return own;
}
