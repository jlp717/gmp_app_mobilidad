import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import '../utils/compute_helpers.dart';

/// Dio Transformer that parses JSON in a background isolate
/// preventing UI jank during large data processing
class IsolateTransformer extends DefaultTransformer {
  IsolateTransformer() : super(jsonDecodeCallback: _parseJson);
}

/// Parse JSON in background
FutureOr<dynamic> _parseJson(String text) {
  if (text.isEmpty) return null;
  // Use smart parse from compute_helpers which decides 
  // whether to use isolate based on size
  return smartParseJson(text);
}
