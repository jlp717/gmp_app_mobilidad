import 'dart:developer' as developer;

import 'package:gmp_app_mobilidad/core/api/api_client.dart';

/// ChatbotService — Authenticated API service for NEXUS AI chatbot.
///
/// Uses ApiClient which attaches the Bearer token automatically via
/// the Dio interceptor.
class ChatbotService {
  /// Send message to chatbot API with conversation context.
  ///
  /// [message] — User's text input.
  /// [conversationHistory] — Last N messages for context (role + content).
  Future<String> sendMessage({
    required String message,
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
      };

      final response = await ApiClient.post(
        '/chatbot/message',
        body,
      );

      if (response['response'] != null) {
        return response['response'] as String;
      }

      return 'No se recibio respuesta del asistente.';
    } on Exception catch (e) {
      developer.log('Chatbot error: $e', name: 'chatbot');
      throw Exception('Error de conexion: $e');
    }
  }

  /// Check chatbot health (no auth required).
  Future<Map<String, dynamic>> checkHealth() async {
    try {
      final response = await ApiClient.get('/chatbot/health');
      return response;
    } catch (e) {
      developer.log('Chatbot health check failed: $e', name: 'chatbot');
      return {'status': 'error', 'detail': e.toString()};
    }
  }
}
