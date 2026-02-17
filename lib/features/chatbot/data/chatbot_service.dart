import 'dart:convert';
import 'package:http/http.dart' as http;

import '../../../../core/api/api_config.dart';

/// [ChatbotService] - API service for AI chatbot communication
class ChatbotService {
  /// Send message to chatbot API
  Future<String> sendMessage({
    required String message,
    required List<String> vendedorCodes,
    String? clientCode,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/chatbot/message'),
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'message': message,
          'vendedorCodes': vendedorCodes.join(','),
          'clientCode': clientCode,
        }),
      ).timeout(const Duration(seconds: 30));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return (data['response'] as String?) ?? 'No se recibió respuesta del asistente.';
      } else {
        final error = jsonDecode(response.body);
        throw Exception(error['error'] ?? 'Error desconocido');
      }
    } catch (e) {
      throw Exception('Error de conexión: $e');
    }
  }
}
