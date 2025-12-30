import 'package:flutter/foundation.dart';
import '../data/chatbot_service.dart';

/// Chat message model
class ChatMessage {
  final String content;
  final bool isUser;
  final DateTime timestamp;

  ChatMessage({
    required this.content,
    required this.isUser,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

/// [ChatbotProvider] - State management for AI chatbot
/// 
/// Manages:
/// - Message history
/// - Loading states
/// - API communication
class ChatbotProvider extends ChangeNotifier {
  ChatbotProvider({required this.vendedorCodes});

  final List<String> vendedorCodes;
  final ChatbotService _service = ChatbotService();
  
  final List<ChatMessage> _messages = [];
  bool _isLoading = false;
  String? _error;
  String? _currentClientCode;

  // Getters
  List<ChatMessage> get messages => List.unmodifiable(_messages);
  bool get isLoading => _isLoading;
  String? get error => _error;
  String? get currentClientCode => _currentClientCode;

  /// Set current client context for the chat
  void setClientContext(String clientCode) {
    _currentClientCode = clientCode;
    notifyListeners();
  }

  /// Send a message to the AI
  Future<void> sendMessage(String text) async {
    if (text.trim().isEmpty) return;

    // Add user message
    _messages.add(ChatMessage(
      content: text,
      isUser: true,
    ));
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      // Call API
      final response = await _service.sendMessage(
        message: text,
        vendedorCodes: vendedorCodes,
        clientCode: _currentClientCode,
      );

      // Add bot response
      _messages.add(ChatMessage(
        content: response,
        isUser: false,
      ));
    } catch (e) {
      _error = e.toString();
      _messages.add(ChatMessage(
        content: 'Lo siento, hubo un error al procesar tu mensaje. Intenta de nuevo.',
        isUser: false,
      ));
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Clear chat history
  void clearChat() {
    _messages.clear();
    _error = null;
    notifyListeners();
  }

  /// Add a system message (for context changes, etc.)
  void addSystemMessage(String text) {
    _messages.add(ChatMessage(
      content: text,
      isUser: false,
    ));
    notifyListeners();
  }
}
