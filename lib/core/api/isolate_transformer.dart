import 'package:dio/dio.dart';
import 'package:gmp_app_mobilidad/core/utils/compute_helpers.dart';

/// Dio Transformer that parses JSON in a background isolate
/// preventing UI jank during large data processing
class IsolateTransformer extends SyncTransformer {
  IsolateTransformer() : super(jsonDecodeCallback: smartParseJson);
}
