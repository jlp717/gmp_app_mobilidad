import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:gmp_app_mobilidad/core/api/api_client.dart';

import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';

import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_persistence.dart';

import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_service.dart';

// ── Helpers ──────────────────────────────────────────────────────────────────

extension ListExt<T> on List<T> {
  /// Returns the last [n] elements (or all if list is shorter).

  List<T> takeLast(int n) {
    if (n >= length) return this;

    return sublist(length - n);
  }
}

// ── State ────────────────────────────────────────────────────────────────────

class ChatMessage {
  ChatMessage({
    required this.content,
    required this.isUser,
    DateTime? timestamp,
    this.metadata = const ChatResponseMetadata(),
    this.isPinned = false,
  }) : timestamp = timestamp ?? DateTime.now();

  final String content;

  final bool isUser;

  final DateTime timestamp;

  final ChatResponseMetadata metadata;

  final bool isPinned;

  ChatMessage copyWith({
    String? content,
    bool? isUser,
    DateTime? timestamp,
    ChatResponseMetadata? metadata,
    bool? isPinned,
  }) {
    return ChatMessage(
      content: content ?? this.content,
      isUser: isUser ?? this.isUser,
      timestamp: timestamp ?? this.timestamp,
      metadata: metadata ?? this.metadata,
      isPinned: isPinned ?? this.isPinned,
    );
  }
}

class ChatbotState {
  const ChatbotState({
    this.messages = const [],
    this.sessions = const [],
    this.isLoading = false,
    this.error,
    this.currentClientCode,
    this.vendedorCodes = const [],
    this.pinnedMessageId,
    this.repartidorId,
    this.sessionUserCode,
    this.activeSessionId,
    this.lastFailedUserMessage,
  });

  final List<ChatMessage> messages;

  final List<ChatbotSessionSummary> sessions;

  final bool isLoading;

  final String? error;

  final String? currentClientCode;

  final List<String> vendedorCodes;

  final int? pinnedMessageId;

  final String? repartidorId;

  final String? sessionUserCode;

  final String? activeSessionId;

  final String? lastFailedUserMessage;

  ChatbotSessionSummary? get activeSession {
    final activeId = activeSessionId;
    if (activeId == null) return null;
    for (final session in sessions) {
      if (session.id == activeId) return session;
    }
    return null;
  }

  ChatMessage? get pinnedMessage {
    if (pinnedMessageId == null) return null;

    if (pinnedMessageId! < 0 || pinnedMessageId! >= messages.length) {
      return null;
    }

    return messages[pinnedMessageId!];
  }

  ChatbotState copyWith({
    List<ChatMessage>? messages,
    List<ChatbotSessionSummary>? sessions,
    bool? isLoading,
    Object? error = _sentinel,
    Object? repartidorId = _sentinel,
    Object? currentClientCode = _sentinel,
    List<String>? vendedorCodes,
    Object? pinnedMessageId = _sentinel,
    Object? sessionUserCode = _sentinel,
    Object? activeSessionId = _sentinel,
    Object? lastFailedUserMessage = _sentinel,
  }) {
    return ChatbotState(
      messages: messages ?? this.messages,
      sessions: sessions ?? this.sessions,
      repartidorId: repartidorId == _sentinel
          ? this.repartidorId
          : repartidorId as String?,
      isLoading: isLoading ?? this.isLoading,
      error: error == _sentinel ? this.error : error as String?,
      currentClientCode: currentClientCode == _sentinel
          ? this.currentClientCode
          : currentClientCode as String?,
      vendedorCodes: vendedorCodes ?? this.vendedorCodes,
      pinnedMessageId: pinnedMessageId == _sentinel
          ? this.pinnedMessageId
          : pinnedMessageId as int?,
      sessionUserCode: sessionUserCode == _sentinel
          ? this.sessionUserCode
          : sessionUserCode as String?,
      activeSessionId: activeSessionId == _sentinel
          ? this.activeSessionId
          : activeSessionId as String?,
      lastFailedUserMessage: lastFailedUserMessage == _sentinel
          ? this.lastFailedUserMessage
          : lastFailedUserMessage as String?,
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

  bool _welcomeBackShown = false;

  @override
  ChatbotState build() => ChatbotState(vendedorCodes: _initialVendedorCodes);

  Future<void> restoreSession(String userCode) async {
    if (userCode.trim().isEmpty) return;

    if (state.sessionUserCode == userCode && state.activeSessionId != null) {
      return;
    }

    final sessions = await ChatbotPersistence.loadSessions(userCode);
    final savedActiveId = await ChatbotPersistence.getActiveSessionId(userCode);
    final activeSessionId = savedActiveId ??
        (sessions.isNotEmpty
            ? sessions.first.id
            : ChatbotPersistence.createSessionId());

    if (sessions.isEmpty) {
      await ChatbotPersistence.setActiveSession(userCode, activeSessionId);
      state = state.copyWith(
        sessionUserCode: userCode,
        activeSessionId: activeSessionId,
        sessions: const [],
      );
      return;
    }

    final saved =
        await ChatbotPersistence.loadSession(userCode, activeSessionId);
    state = state.copyWith(
      messages: saved,
      sessions: sessions,
      sessionUserCode: userCode,
      activeSessionId: activeSessionId,
      pinnedMessageId: _findPinnedIndex(saved),
    );
  }

  int? _findPinnedIndex(List<ChatMessage> messages) {
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].isPinned) return i;
    }

    return null;
  }

  String _buildSessionTitle(List<ChatMessage> messages) {
    for (final message in messages) {
      if (!message.isUser || message.content.trim().isEmpty) continue;
      final firstLine = message.content.trim().split('\n').first;
      if (firstLine.length <= 54) return firstLine;
      return '${firstLine.substring(0, 51)}...';
    }
    return 'Conversacion comercial';
  }

  Future<void> _persist() async {
    final userCode = state.sessionUserCode;

    if (userCode == null || userCode.isEmpty) return;

    final sessionId =
        state.activeSessionId ?? ChatbotPersistence.createSessionId();
    if (state.activeSessionId == null) {
      state = state.copyWith(activeSessionId: sessionId);
    }

    if (state.messages.isEmpty) {
      await ChatbotPersistence.setActiveSession(userCode, sessionId);
      return;
    }

    await ChatbotPersistence.saveSession(
      userCode: userCode,
      sessionId: sessionId,
      messages: state.messages,
      title: _buildSessionTitle(state.messages),
    );
    final sessions = await ChatbotPersistence.loadSessions(userCode);
    state = state.copyWith(sessions: sessions, activeSessionId: sessionId);
  }

  void setClientContext(String? clientCode) {
    final normalized = clientCode?.trim();

    state = state.copyWith(
      currentClientCode:
          (normalized == null || normalized.isEmpty) ? null : normalized,
    );
  }

  void setVendedorCodes(List<String> vendedorCodes) {
    state = state.copyWith(vendedorCodes: List.unmodifiable(vendedorCodes));
  }

  String _friendlyError(Object e) {
    if (e is ApiException) {
      if (e.statusCode == 429) {
        return 'Demasiadas consultas seguidas. Espera un momento e inténtalo de nuevo.';
      }

      if (e.statusCode == 408 ||
          e.message.toLowerCase().contains('timeout') ||
          e.message.toLowerCase().contains('tiempo')) {
        return 'La consulta tardó demasiado. Comprueba la conexión e inténtalo de nuevo.';
      }

      if (e.statusCode != null && e.statusCode! >= 500) {
        return 'El servidor no está disponible ahora. Inténtalo en unos minutos.';
      }
    }

    final raw = e.toString();

    if (raw.toLowerCase().contains('socket') ||
        raw.toLowerCase().contains('network')) {
      return 'Sin conexión. Revisa tu red e inténtalo de nuevo.';
    }

    return 'No se pudo completar la consulta. Inténtalo de nuevo.';
  }

  Future<void> sendMessage(String text) async {
    if (text.trim().isEmpty) return;

    final activeSessionId =
        state.activeSessionId ?? ChatbotPersistence.createSessionId();

    state = state.copyWith(
      messages: [...state.messages, ChatMessage(content: text, isUser: true)],
      activeSessionId: activeSessionId,
      isLoading: true,
      error: null,
      lastFailedUserMessage: null,
    );

    await _persist();

    try {
      final history = state.messages
          .takeLast(5)
          .map(
            (m) => {
              'role': m.isUser ? 'user' : 'assistant',
              'content': m.content,
            },
          )
          .toList();

      final result = await _service.sendMessage(
        message: text,
        conversationHistory: history,
        clientCode: state.currentClientCode,
        repartidorId: state.repartidorId,
      );

      state = state.copyWith(
        messages: [
          ...state.messages,
          ChatMessage(
            content: result.response,
            isUser: false,
            metadata: result.metadata,
          ),
        ],
        isLoading: false,
      );

      await _persist();
    } catch (e) {
      final friendly = _friendlyError(e);

      state = state.copyWith(
        messages: [
          ...state.messages,
          ChatMessage(
            content: 'Lo siento, no pude procesar tu mensaje.\n\n$friendly',
            isUser: false,
          ),
        ],
        isLoading: false,
        error: friendly,
        lastFailedUserMessage: text,
      );

      await _persist();
    }
  }

  Future<void> retryLastMessage() async {
    final failed = state.lastFailedUserMessage;

    if (failed == null || failed.isEmpty || state.isLoading) return;

    final trimmed = state.messages;

    if (trimmed.isNotEmpty &&
        !trimmed.last.isUser &&
        trimmed.last.content.startsWith('Lo siento, no pude')) {
      state = state.copyWith(
        messages: trimmed.sublist(0, trimmed.length - 2),
        error: null,
      );
    }

    await sendMessage(failed);
  }

  void pinMessage(int index) {
    if (index < 0 || index >= state.messages.length) return;

    final updated = state.messages.asMap().entries.map((entry) {
      return entry.value.copyWith(isPinned: entry.key == index);
    }).toList();

    state = state.copyWith(
      messages: updated,
      pinnedMessageId: index,
    );

    _persist();
  }

  void unpinMessage() {
    final updated =
        state.messages.map((m) => m.copyWith(isPinned: false)).toList();

    state = state.copyWith(messages: updated, pinnedMessageId: null);

    _persist();
  }

  Future<void> clearChat() async {
    await startNewSession();
  }

  void setRepartidorScope(String? repartidorId) {
    final trimmed = repartidorId?.trim();
    final normalized = trimmed == null || trimmed.isEmpty ? null : trimmed;
    if (state.repartidorId == normalized) return;
    state = state.copyWith(
      repartidorId: normalized,
      messages: const [],
      error: null,
      currentClientCode: null,
      pinnedMessageId: null,
      activeSessionId: ChatbotPersistence.createSessionId(),
      lastFailedUserMessage: null,
    );
    _welcomeBackShown = false;
  }

  Future<void> startNewSession() async {
    final userCode = state.sessionUserCode;
    final sessionId = ChatbotPersistence.createSessionId();

    state = state.copyWith(
      messages: [],
      error: null,
      pinnedMessageId: null,
      activeSessionId: sessionId,
      lastFailedUserMessage: null,
    );

    _welcomeBackShown = false;

    if (userCode != null) {
      await ChatbotPersistence.setActiveSession(userCode, sessionId);
    }
  }

  Future<void> loadSession(String sessionId) async {
    final userCode = state.sessionUserCode;
    if (userCode == null || userCode.isEmpty || sessionId.trim().isEmpty) {
      return;
    }

    final messages = await ChatbotPersistence.loadSession(userCode, sessionId);
    await ChatbotPersistence.setActiveSession(userCode, sessionId);
    state = state.copyWith(
      messages: messages,
      activeSessionId: sessionId,
      error: null,
      pinnedMessageId: _findPinnedIndex(messages),
      lastFailedUserMessage: null,
    );
    _welcomeBackShown = false;
  }

  Future<void> deleteSession(String sessionId) async {
    final userCode = state.sessionUserCode;
    if (userCode == null || userCode.isEmpty || sessionId.trim().isEmpty) {
      return;
    }

    await ChatbotPersistence.deleteSession(userCode, sessionId);
    final sessions = await ChatbotPersistence.loadSessions(userCode);
    final deletedActive = state.activeSessionId == sessionId;

    if (!deletedActive) {
      state = state.copyWith(sessions: sessions);
      return;
    }

    if (sessions.isEmpty) {
      final nextSessionId = ChatbotPersistence.createSessionId();
      await ChatbotPersistence.setActiveSession(userCode, nextSessionId);
      state = state.copyWith(
        messages: [],
        sessions: sessions,
        activeSessionId: nextSessionId,
        pinnedMessageId: null,
        lastFailedUserMessage: null,
      );
      return;
    }

    final nextSession = sessions.first;
    final messages = await ChatbotPersistence.loadSession(
      userCode,
      nextSession.id,
    );
    await ChatbotPersistence.setActiveSession(userCode, nextSession.id);
    state = state.copyWith(
      messages: messages,
      sessions: sessions,
      activeSessionId: nextSession.id,
      pinnedMessageId: _findPinnedIndex(messages),
      lastFailedUserMessage: null,
    );
  }

  void dismissError() {
    state = state.copyWith(error: null);
  }

  void addSystemMessage(String text) {
    state = state.copyWith(
      messages: [
        ...state.messages,
        ChatMessage(content: text, isUser: false),
      ],
    );

    _persist();
  }

  void showWelcomeBackIfNeeded() {
    if (_welcomeBackShown || state.messages.isEmpty) return;

    _welcomeBackShown = true;

    addSystemMessage(
      'Bienvenido de nuevo. Tu conversación sigue aquí — ¿en qué más puedo ayudarte?',
    );
  }

  Future<void> sendDailyBriefing() {
    return sendMessage(
      'Dame resumen comercial del dia: ventas, pedidos, clientes y top productos.',
    );
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

final chatbotProvider =
    NotifierProvider<ChatbotNotifier, ChatbotState>(ChatbotNotifier.new);

final chatMessagesProvider = Provider<List<ChatMessage>>((ref) {
  return ref.watch(chatbotProvider).messages;
});

final chatIsLoadingProvider = Provider<bool>((ref) {
  return ref.watch(chatbotProvider).isLoading;
});
