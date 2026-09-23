/// Product family filter model for pedidos comercial chips.
///
/// Codes and names MUST come from API/DB (`/pedidos/families/detailed`).
/// Display shortcuts only rename known codes that already exist in the payload.
library;

/// Family entry returned by GET /api/pedidos/families/detailed.
class ProductFamilyFilter {
  const ProductFamilyFilter({
    required this.code,
    required this.name,
    this.prefamily = '',
    this.artCount = 0,
    this.isNestle = false,
    this.isImpulso = false,
  });

  factory ProductFamilyFilter.fromJson(Map<String, dynamic> json) {
    final code = (json['code'] ?? '').toString().trim();
    final name = (json['name'] ?? code).toString().trim();
    final prefamily = (json['prefamily'] ?? '').toString().trim();
    final artCount = _toInt(json['artCount'] ?? json['art_count']);
    final isNestle = json['isNestle'] == true ||
        RegExp(r'NESTL', caseSensitive: false).hasMatch(name) ||
        code.startsWith('003');
    final isImpulso = json['isImpulso'] == true ||
        code == '003' ||
        RegExp(r'IMPULSO', caseSensitive: false).hasMatch(name);
    return ProductFamilyFilter(
      code: code,
      name: name.isEmpty ? code : name,
      prefamily: prefamily,
      artCount: artCount,
      isNestle: isNestle,
      isImpulso: isImpulso,
    );
  }

  final String code;
  final String name;
  final String prefamily;
  final int artCount;
  final bool isNestle;
  final bool isImpulso;

  /// Chip label for the horizontal filter bar (layout-friendly).
  String get chipLabel {
    final shortcut = kCommercialFamilyShortcuts[code];
    if (shortcut != null) return shortcut;
    if (name.length <= 18) return name;
    return '${name.substring(0, 16)}…';
  }
}

/// Commercial pin order: only codes present in the API response are shown.
/// Source of truth remains DSEDAC.FAM / ART — these are display priorities.
const List<String> kPinnedCommercialFamilyCodes = <String>[
  '003', // NESTLE IMPULSO
  '001', // CONGELADO
  '013', // MARISCO Y CEFALOPODOS
  '002', // CARNE VARIOS
  '060', // TOPFRESH
  '0031', // NESTLE RESTAURACION
  '700', // MASAS PANAMAR PAN
  '701', // MASAS PANAMAR BOLL.
];

/// Short commercial labels for pinned / high-traffic families already in DB.
const Map<String, String> kCommercialFamilyShortcuts = <String, String>{
  '003': 'Impulso',
  '001': 'Congelado',
  '013': 'Marisco',
  '002': 'Carne',
  '060': 'TopFresh',
  '0031': 'Nestlé Rest.',
  '700': 'Panamar pan',
  '701': 'Panamar boll.',
};

/// Orders families: pinned commercial codes first (DB-backed), then by name.
List<ProductFamilyFilter> orderFamiliesForChips(
  Iterable<ProductFamilyFilter> families,
) {
  final byCode = <String, ProductFamilyFilter>{};
  for (final family in families) {
    final code = family.code.trim();
    if (code.isEmpty) continue;
    byCode[code] = family;
  }

  final ordered = <ProductFamilyFilter>[];
  final seen = <String>{};

  for (final code in kPinnedCommercialFamilyCodes) {
    final family = byCode[code];
    if (family == null) continue;
    ordered.add(family);
    seen.add(code);
  }

  final rest = byCode.values.where((f) => !seen.contains(f.code)).toList()
    ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  ordered.addAll(rest);
  return ordered;
}

int _toInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}
