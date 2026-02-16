/// Compute Isolate Helpers
/// =======================
/// Move heavy JSON parsing to background isolate
/// Prevents UI jank on large API responses

import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';

/// Parse JSON in a background isolate
/// Use for large API responses to prevent UI blocking
Future<T> parseJsonInBackground<T>(
  String jsonString,
  T Function(Map<String, dynamic>) fromJson,
) async {
  try {
    // Parse JSON in isolate
    final Map<String, dynamic> parsed = await compute(
      _parseJson,
      jsonString,
    );
    return fromJson(parsed);
  } catch (e) {
    debugPrint('[ComputeHelper] JSON parse error: $e');
    rethrow;
  }
}

/// Parse JSON list in a background isolate
Future<List<T>> parseJsonListInBackground<T>(
  String jsonString,
  T Function(Map<String, dynamic>) fromJson,
) async {
  try {
    final List<dynamic> parsed = await compute(
      _parseJsonList,
      jsonString,
    );
    return parsed.map((e) => fromJson(e as Map<String, dynamic>)).toList();
  } catch (e) {
    debugPrint('[ComputeHelper] JSON list parse error: $e');
    rethrow;
  }
}

/// Internal JSON parser for isolate
Map<String, dynamic> _parseJson(String jsonString) {
  return json.decode(jsonString) as Map<String, dynamic>;
}

/// Internal JSON list parser for isolate
List<dynamic> _parseJsonList(String jsonString) {
  return json.decode(jsonString) as List<dynamic>;
}

/// Encode JSON in a background isolate
/// Use for large request bodies
Future<String> encodeJsonInBackground(Map<String, dynamic> data) async {
  try {
    return await compute(_encodeJson, data);
  } catch (e) {
    debugPrint('[ComputeHelper] JSON encode error: $e');
    rethrow;
  }
}

/// Internal JSON encoder for isolate
String _encodeJson(Map<String, dynamic> data) {
  return json.encode(data);
}

/// Threshold for using isolate (in characters)
/// Below this, parsing on main thread is faster due to isolate overhead
const int _isolateThreshold = 50000; // ~50KB

/// Smart JSON parse - uses isolate only for large data
/// Handles both JSON objects AND arrays (returns dynamic)
/// IMPORTANT: Returns FutureOr<dynamic> — synchronous for small data
/// to avoid Future-wrapping issues with Dio's SyncTransformer
FutureOr<dynamic> smartParseJson(String jsonString) {
  if (jsonString.length < _isolateThreshold) {
    // Small data - parse synchronously on main thread (no Future wrapping!)
    return json.decode(jsonString);
  }
  // Large data - use isolate (returns Future)
  return compute(_parseJsonDynamic, jsonString);
}

/// Internal dynamic JSON parser for isolate (handles both Map and List)
dynamic _parseJsonDynamic(String jsonString) {
  return json.decode(jsonString);
}

/// Smart JSON list parse
Future<List<dynamic>> smartParseJsonList(String jsonString) async {
  if (jsonString.length < _isolateThreshold) {
    return json.decode(jsonString) as List<dynamic>;
  }
  return compute(_parseJsonList, jsonString);
}
