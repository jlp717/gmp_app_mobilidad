import 'dart:developer' as developer;

import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';

/// Result from Asistente GMP message endpoint.
class ChatbotMessageResult {
  const ChatbotMessageResult({
    required this.response,
    this.metadata = const ChatResponseMetadata(),
  });

  final String response;
  final ChatResponseMetadata metadata;
}

/// ChatbotService — Authenticated API service for Asistente GMP.
class ChatbotService {
  /// Send message to chatbot API with conversation context.
  Future<ChatbotMessageResult> sendMessage({
    required String message,
    String? repartidorId,
    List<Map<String, String>>? conversationHistory,
    String? clientCode,
  }) async {
    try {
      final body = <String, dynamic>{
        'message': message,
        if (conversationHistory != null && conversationHistory.isNotEmpty)
          'conversationHistory': conversationHistory,
        if (clientCode != null && clientCode.trim().isNotEmpty)
          'clientCode': clientCode.trim(),
        if (repartidorId != null && repartidorId.trim().isNotEmpty)
          'repartidorId': repartidorId.trim(),
      };

      final response = await ApiClient.post('/chatbot/message', body);

      final text = response['response']?.toString() ??
          'No se recibio respuesta del asistente.';
      final metadata = ChatResponseMetadata.fromJson(
        response['metadata'] as Map<String, dynamic>?,
      );

      return ChatbotMessageResult(response: text, metadata: metadata);
    } on Exception {
      developer.log('CHATBOT_REQUEST_FAILED', name: 'chatbot');
      throw Exception('No se pudo conectar con el asistente.');
    }
  }

  /// Check chatbot health (no auth required).
  Future<Map<String, dynamic>> checkHealth() async {
    try {
      final response = await ApiClient.get('/chatbot/health');
      return response;
    } catch (e) {
      developer.log('CHATBOT_HEALTH_FAILED', name: 'chatbot');
      return {'status': 'error', 'code': 'CHATBOT_HEALTH_FAILED'};
    }
  }
}
