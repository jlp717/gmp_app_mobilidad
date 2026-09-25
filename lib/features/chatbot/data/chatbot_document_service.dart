import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/errors/failure.dart';

/// Servicio de datos para previsualizar documentos del chatbot.
///
/// Extrae la normalizacion de endpoint y la descarga de bytes de preview
/// fuera de la UI ([ChatMessageBubble]) para evitar acoplar widgets a Dio.
class ChatbotDocumentService {
  /// Visible para tests: permite inyectar baseUrl sin tocar Dio.
  const ChatbotDocumentService({this.baseUrlOverride});

  /// Base URL opcional para tests. En produccion se lee de Dio.
  final String? baseUrlOverride;

  /// Normaliza [rawUrl] a path relativo apto para [ApiClient].
  ///
  /// Logica movida desde `chat_message_bubble.dart:642` sin cambios
  /// de comportamiento: recorta baseUrl, elimina prefijo `/api/` y
  /// garantiza leading `/`.
  String normalizeDocumentEndpoint(String rawUrl) {
    var endpoint = rawUrl.trim();
    final baseUrl =
        baseUrlOverride ?? ApiClient.dio.options.baseUrl;
    if (baseUrl.isNotEmpty && endpoint.startsWith(baseUrl)) {
      endpoint = endpoint.substring(baseUrl.length);
    }
    if (endpoint.startsWith('/api/')) {
      endpoint = endpoint.substring(4);
    }
    if (!endpoint.startsWith('/')) {
      endpoint = '/$endpoint';
    }
    return endpoint;
  }

  /// Descarga bytes de preview para [rawUrl] con `preview=true` anti-cache.
  ///
  /// Lanza [ValidationFailure] si la URL esta vacia o el payload no parece
  /// un PDF valido (<100 bytes). Mapea [ApiException] a [Failure] tipado.
  Future<List<int>> fetchPreviewBytes(String rawUrl) async {
    if (rawUrl.trim().isEmpty) {
      throw const ValidationFailure('Documento sin URL valida.');
    }
    final endpoint = normalizeDocumentEndpoint(rawUrl);
    try {
      final bytes = await ApiClient.getBytes(
        endpoint,
        queryParameters: {
          'preview': 'true',
          '_t': DateTime.now().millisecondsSinceEpoch.toString(),
        },
      );
      if (bytes.length < 100) {
        throw const ValidationFailure(
          'El documento recibido no parece un PDF valido.',
        );
      }
      return bytes;
    } on ValidationFailure {
      rethrow;
    } on ApiException catch (e) {
      if ((e.statusCode ?? 0) == 0) {
        throw NetworkFailure(e.message, e.code, e.confirmationId, e.message);
      }
      throw ServerFailure(
        e.message,
        statusCode: e.statusCode,
        code: e.code,
        confirmationId: e.confirmationId,
        originalMessage: e.message,
      );
    }
  }
}

/// Provider local del servicio de documentos del chatbot.
final chatbotDocumentServiceProvider =
    Provider<ChatbotDocumentService>((ref) => const ChatbotDocumentService());
