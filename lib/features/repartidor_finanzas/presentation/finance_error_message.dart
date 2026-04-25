import 'package:gmp_app_mobilidad/core/api/api_client.dart';

String financeErrorMessage(Object error, String fallback) {
  if (error is ApiException) {
    final message = error.message.trim();
    if (message.isNotEmpty) return message;
  }
  return fallback;
}
