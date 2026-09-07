/// Typed JSON-map casting for Dio/Hive payloads.
///
/// Hive returns nested `Map<dynamic,dynamic>`. Recursively copying a 1000-row
/// matrix on the UI isolate is multi-second jank on a real phone. Skip the
/// copy when the value is already `Map<String, dynamic>` (Dio isolate parse)
/// and offload bulky Hive maps to `compute`.
library;

/// True when the map holds a list large enough to jank the UI thread.
bool isBulkyJsonMap(Map<dynamic, dynamic> src) {
  final bulky = src['rows'] ?? src['clients'] ?? src['data'] ?? src['items'];
  return bulky is List && bulky.length >= 80;
}

/// Recursively copies [src] into a string-keyed map. Isolate-safe (top-level).
Map<String, dynamic> deepCastJsonMap(Map<dynamic, dynamic> src) {
  return src.map(
    (key, value) => MapEntry(key.toString(), _deepCastJsonValue(value)),
  );
}

Object? _deepCastJsonValue(Object? value) {
  if (value is Map) {
    return deepCastJsonMap(Map<dynamic, dynamic>.from(value));
  }
  if (value is List) {
    return value.map(_deepCastJsonValue).toList();
  }
  return value;
}

/// Fast path: already-typed Dio maps are returned as-is.
Map<String, dynamic> castResponseMap(Object src) {
  if (src is Map<String, dynamic>) return src;
  if (src is Map) {
    return deepCastJsonMap(Map<dynamic, dynamic>.from(src));
  }
  throw ArgumentError.value(src, 'src', 'Expected Map');
}
