import 'dart:convert';
import 'dart:typed_data';

/// Extracts a readable server error from JSON maps, JSON bytes or text.
String extractServerErrorMessage(dynamic data) {
  if (data == null) return '';

  if (data is Map) {
    return _extractServerErrorFromMap(data);
  }

  if (data is Uint8List) {
    return extractServerErrorMessage(utf8.decode(data, allowMalformed: true));
  }

  if (data is List<int>) {
    return extractServerErrorMessage(utf8.decode(data, allowMalformed: true));
  }

  if (data is String) {
    final text = data.trim();
    if (text.isEmpty) return '';

    try {
      return extractServerErrorMessage(jsonDecode(text));
    } catch (_) {
      return text;
    }
  }

  return data.toString();
}

String _extractServerErrorFromMap(Map<dynamic, dynamic> data) {
  final error = data['error']?.toString().trim() ?? '';
  final details = data['details']?.toString().trim() ?? '';
  final message = data['message']?.toString().trim() ?? '';

  if (error.isNotEmpty && details.isNotEmpty && error != details) {
    return '$error: $details';
  }
  if (details.isNotEmpty) return details;
  if (error.isNotEmpty) return error;
  if (message.isNotEmpty) return message;
  return '';
}
