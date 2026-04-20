import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_service.dart';

// ── State ────────────────────────────────────────────────────────────────────

class ChatMessage {

  ChatMessage({
    required this.content,
    required this.isUser,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
  final String content;
  final bool isUser;
  final DateTime timestamp;
}

class ChatbotState {

  const ChatbotState({
    this.messages = const [],
    this.isLoading = false,
    this.error,
    this.currentClientCode,
    this.vendedorCodes = const [],
  });
  final List<ChatMessage> messages;
  final bool isLoading;
  final String? error;
  final String? currentClientCode;
  final List<String> vendedorCodes;

  ChatbotState copyWith({
    List<ChatMessage>? messages,
    bool? isLoading,
    Object? error = _sentinel,
    Object? currentClientCode = _sentinel,
    List<String>? vendedorCodes,
  }) {
    return ChatbotState(
      messages: messages ?? this.messages,
      isLoading: isLoading ?? this.isLoading,
      error: error == _sentinel ? this.error : error as String?,
      currentClientCode: currentClientCode == _sentinel
          ? this.currentClientCode
          : currentClientCode as String?,
      vendedorCodes: vendedorCodes ?? this.vendedorCodes,
    );
  }

  static const _sentinel = Object();
}

// ── Notifier ─────────────────────────────────────────────────────────────────

class ChatbotNotifier extends Notifier<ChatbotState> {

  ChatbotNotifier({List<String> vendedorCodes = const []})
      : _initialVendedorCodes = vendedorCodes;
  final ChatbotService _service = ChatbotService();

  final List<String> _initialVendedorCodes;

  @override
  ChatbotState build() => ChatbotState(vendedorCodes: _initialVendedorCodes);

  void setClientContext(String clientCode) {
    state = state.copyWith(currentClientCode: clientCode);
  }

  Future<void> sendMessage(String text) async {
    if (text.trim().isEmpty) return;

    state = state.copyWith(
      messages: [...state.messages, ChatMessage(content: text, isUser: true)],
      isLoading: true,
      error: null,
    );

    try {
      final response = await _service.sendMessage(
        message: text,
        vendedorCodes: state.vendedorCodes,
        clientCode: state.currentClientCode,
      );

      state = state.copyWith(
        messages: [
          ...state.messages,
          ChatMessage(content: response, isUser: false),
        ],
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        messages: [
          ...state.messages,
          ChatMessage(
            content:
                'Lo siento, hubo un error al procesar tu mensaje. Intenta de nuevo.',
            isUser: false,
          ),
        ],
        isLoading: false,
        error: e.toString(),
      );
    }
  }

  void clearChat() {
    state = state.copyWith(messages: [], error: null);
  }

  void addSystemMessage(String text) {
    state = state.copyWith(
      messages: [
        ...state.messages,
        ChatMessage(content: text, isUser: false),
      ],
    );
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

final chatbotProvider =
    NotifierProvider<ChatbotNotifier, ChatbotState>(ChatbotNotifier.new);

// ── Selectors ────────────────────────────────────────────────────────────────

final chatMessagesProvider = Provider<List<ChatMessage>>((ref) {
  return ref.watch(chatbotProvider).messages;
});

final chatIsLoadingProvider = Provider<bool>((ref) {
  return ref.watch(chatbotProvider).isLoading;
});
