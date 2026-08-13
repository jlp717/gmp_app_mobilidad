// ignore_for_file: public_member_api_docs

const String commercial80Code = '80';
const List<String> commercial80AlmeriaCodes = <String>['72', '73', '81', '83'];
const List<String> commercial80ScopedCodes = <String>[
  commercial80Code,
  ...commercial80AlmeriaCodes,
];

String normalizeVendorCode(String? code) {
  final raw = (code ?? '').trim();
  if (raw.isEmpty) return raw;
  final normalized = raw.replaceFirst(RegExp('^0+'), '');
  return normalized.isEmpty ? raw : normalized;
}

bool isCommercial80Code(String? code) =>
    normalizeVendorCode(code) == commercial80Code;

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

bool hasCommercial80VendorScope({
  required String? userCode,
  required List<String> vendorCodes,
}) {
  if (!isCommercial80Code(userCode)) return false;
  return vendorCodes.isEmpty || vendorCodes.length > 1;
}

List<String> commercial80AllowedVendorCodes(List<String> authVendorCodes) {
  final base =
      authVendorCodes.isNotEmpty ? authVendorCodes : commercial80ScopedCodes;
  return uniqueVendorCodes(
    base.where((code) => vendorCodeListContains(commercial80ScopedCodes, code)),
  );
}

List<String>? effectiveAllowedVendorCodes({
  required String? userCode,
  required List<String> authVendorCodes,
  List<String>? explicitAllowedCodes,
}) {
  if (explicitAllowedCodes != null && explicitAllowedCodes.isNotEmpty) {
    return uniqueVendorCodes(explicitAllowedCodes);
  }

  if (isCommercial80Code(userCode)) {
    return commercial80AllowedVendorCodes(authVendorCodes);
  }

  return null;
}

String resolveScopedVendorCodes({
  required String? userCode,
  required List<String> authVendorCodes,
  required String? selectedVendor,
  required String fallbackVendorCodes,
}) {
  if (!hasCommercial80VendorScope(
    userCode: userCode,
    vendorCodes: authVendorCodes,
  )) {
    return selectedVendor != null && selectedVendor.isNotEmpty
        ? selectedVendor
        : fallbackVendorCodes;
  }

  final allowedCodes = commercial80AllowedVendorCodes(authVendorCodes);
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
/// A plain commercial must never send ALL or another vendor persisted in
/// SharedPreferences from a previous jefe session.
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

  if (hasCommercial80VendorScope(
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
