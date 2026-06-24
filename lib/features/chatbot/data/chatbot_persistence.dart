import 'dart:convert';

import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';
import 'package:gmp_app_mobilidad/features/chatbot/providers/chatbot_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ChatbotSessionSummary {
  const ChatbotSessionSummary({
    required this.id,
    required this.title,
    required this.updatedAt,
    required this.messageCount,
  });

  final String id;
  final String title;
  final DateTime updatedAt;
  final int messageCount;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'updatedAt': updatedAt.toIso8601String(),
        'messageCount': messageCount,
      };

  static ChatbotSessionSummary? fromJson(Map<String, dynamic> json) {
    final id = json['id']?.toString().trim();
    if (id == null || id.isEmpty) return null;
    final rawTitle = json['title']?.toString().trim();
    return ChatbotSessionSummary(
      id: id,
      title: rawTitle == null || rawTitle.isEmpty
          ? 'Conversacion comercial'
          : rawTitle,
      updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? '') ??
          DateTime.now(),
      messageCount: int.tryParse(json['messageCount']?.toString() ?? '') ?? 0,
    );
  }
}

/// Persists bounded multi-chat history per user across tab switches.
class ChatbotPersistence {
  ChatbotPersistence._();

  static const int maxMessages = 40;
  static const int maxSessions = 20;

  static String _legacyStorageKey(String userCode) =>
      'chatbot_session_${userCode.trim()}';

  static String _sessionsIndexKey(String userCode) =>
      'chatbot_sessions_index_${userCode.trim()}';

  static String _activeSessionKey(String userCode) =>
      'chatbot_active_session_${userCode.trim()}';

  static String _sessionStorageKey(String userCode, String sessionId) =>
      'chatbot_session_${userCode.trim()}__$sessionId';

  static String createSessionId() =>
      's${DateTime.now().microsecondsSinceEpoch}';

  static Future<List<ChatMessage>> load(String userCode) async {
    if (userCode.trim().isEmpty) return [];
    final activeId = await getActiveSessionId(userCode);
    if (activeId != null) return loadSession(userCode, activeId);

    final sessions = await loadSessions(userCode);
    if (sessions.isEmpty) return [];
    await setActiveSession(userCode, sessions.first.id);
    return loadSession(userCode, sessions.first.id);
  }

  static Future<List<ChatbotSessionSummary>> loadSessions(
    String userCode,
  ) async {
    if (userCode.trim().isEmpty) return [];
    try {
      final prefs = await SharedPreferences.getInstance();
      final sessions = _readSessionIndex(prefs, userCode);
      if (sessions.isNotEmpty) return sessions;

      final legacyMessages = _readMessages(
        prefs.getString(_legacyStorageKey(userCode)),
      );
      if (legacyMessages.isEmpty) return [];

      final sessionId = createSessionId();
      final summary = _summaryFromMessages(sessionId, legacyMessages);
      await prefs.setString(
        _sessionStorageKey(userCode, sessionId),
        jsonEncode(legacyMessages.map(_messageToJson).toList()),
      );
      await prefs.setString(
        _sessionsIndexKey(userCode),
        jsonEncode([summary.toJson()]),
      );
      await prefs.setString(_activeSessionKey(userCode), sessionId);
      return [summary];
    } catch (_) {
      return [];
    }
  }

  static Future<void> save(String userCode, List<ChatMessage> messages) async {
    if (userCode.trim().isEmpty) return;
    final sessionId = await getActiveSessionId(userCode) ?? createSessionId();
    await saveSession(
      userCode: userCode,
      sessionId: sessionId,
      messages: messages,
    );
  }

  static Future<List<ChatMessage>> loadSession(
    String userCode,
    String sessionId,
  ) async {
    if (userCode.trim().isEmpty || sessionId.trim().isEmpty) return [];
    try {
      final prefs = await SharedPreferences.getInstance();
      return _readMessages(
        prefs.getString(_sessionStorageKey(userCode, sessionId)),
      );
    } catch (_) {
      return [];
    }
  }

  static Future<void> saveSession({
    required String userCode,
    required String sessionId,
    required List<ChatMessage> messages,
    String? title,
  }) async {
    if (userCode.trim().isEmpty || sessionId.trim().isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final slice = messages.length > maxMessages
          ? messages.sublist(messages.length - maxMessages)
          : messages;
      final encoded = jsonEncode(slice.map(_messageToJson).toList());
      await prefs.setString(_sessionStorageKey(userCode, sessionId), encoded);
      await prefs.setString(_activeSessionKey(userCode), sessionId);

      final existing = _readSessionIndex(prefs, userCode)
          .where((session) => session.id != sessionId)
          .toList();
      final next = [
        _summaryFromMessages(sessionId, slice, title: title),
        ...existing,
      ]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      final kept = next.take(maxSessions).toList();
      final dropped = next.skip(maxSessions);
      for (final session in dropped) {
        await prefs.remove(_sessionStorageKey(userCode, session.id));
      }
      await prefs.setString(
        _sessionsIndexKey(userCode),
        jsonEncode(kept.map((session) => session.toJson()).toList()),
      );
    } catch (_) {
      // Non-blocking: chat still works without persistence.
    }
  }

  static Future<void> clear(String userCode) async {
    if (userCode.trim().isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    final activeId = prefs.getString(_activeSessionKey(userCode));
    if (activeId == null || activeId.isEmpty) {
      await prefs.remove(_legacyStorageKey(userCode));
      return;
    }
    await deleteSession(userCode, activeId);
  }

  static Future<void> deleteSession(
    String userCode,
    String sessionId,
  ) async {
    if (userCode.trim().isEmpty || sessionId.trim().isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_sessionStorageKey(userCode, sessionId));
    final remaining = _readSessionIndex(prefs, userCode)
        .where((session) => session.id != sessionId)
        .toList();
    await prefs.setString(
      _sessionsIndexKey(userCode),
      jsonEncode(remaining.map((session) => session.toJson()).toList()),
    );
    if (prefs.getString(_activeSessionKey(userCode)) == sessionId) {
      if (remaining.isEmpty) {
        await prefs.remove(_activeSessionKey(userCode));
      } else {
        await prefs.setString(_activeSessionKey(userCode), remaining.first.id);
      }
    }
  }

  static Future<void> setActiveSession(
    String userCode,
    String sessionId,
  ) async {
    if (userCode.trim().isEmpty || sessionId.trim().isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_activeSessionKey(userCode), sessionId);
  }

  static Future<String?> getActiveSessionId(String userCode) async {
    if (userCode.trim().isEmpty) return null;
    final prefs = await SharedPreferences.getInstance();
    final activeId = prefs.getString(_activeSessionKey(userCode))?.trim();
    return activeId == null || activeId.isEmpty ? null : activeId;
  }

  static List<ChatbotSessionSummary> _readSessionIndex(
    SharedPreferences prefs,
    String userCode,
  ) {
    final raw = prefs.getString(_sessionsIndexKey(userCode));
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw) as List<dynamic>;
      final sessions = decoded
          .whereType<Map<String, dynamic>>()
          .map(ChatbotSessionSummary.fromJson)
          .whereType<ChatbotSessionSummary>()
          .toList()
        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      return sessions;
    } catch (_) {
      return [];
    }
  }

  static List<ChatMessage> _readMessages(String? raw) {
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List<dynamic>;
      return list
          .whereType<Map<String, dynamic>>()
          .map(_messageFromJson)
          .toList();
    } catch (_) {
      return [];
    }
  }

  static ChatbotSessionSummary _summaryFromMessages(
    String sessionId,
    List<ChatMessage> messages, {
    String? title,
  }) {
    final normalizedTitle = title?.trim();
    return ChatbotSessionSummary(
      id: sessionId,
      title: normalizedTitle != null && normalizedTitle.isNotEmpty
          ? normalizedTitle
          : _titleFromMessages(messages),
      updatedAt: DateTime.now(),
      messageCount: messages.length,
    );
  }

  static String _titleFromMessages(List<ChatMessage> messages) {
    String? firstUserMessage;
    for (final message in messages) {
      if (message.isUser && message.content.trim().isNotEmpty) {
        firstUserMessage = message.content.trim();
        break;
      }
    }
    if (firstUserMessage == null) return 'Conversacion comercial';
    final firstLine = firstUserMessage.split('\n').first.trim();
    if (firstLine.length <= 54) return firstLine;
    return '${firstLine.substring(0, 51)}...';
  }

  static Map<String, dynamic> _messageToJson(ChatMessage m) => {
        'content': m.content,
        'isUser': m.isUser,
        'timestamp': m.timestamp.toIso8601String(),
        'isPinned': m.isPinned,
        'metadata': _metadataToJson(m.metadata),
      };

  static ChatMessage _messageFromJson(Map<String, dynamic> json) {
    return ChatMessage(
      content: json['content']?.toString() ?? '',
      isUser: json['isUser'] == true,
      timestamp: DateTime.tryParse(json['timestamp']?.toString() ?? '') ??
          DateTime.now(),
      isPinned: json['isPinned'] == true,
      metadata: ChatResponseMetadata.fromJson(
        json['metadata'] as Map<String, dynamic>?,
      ),
    );
  }

  static Map<String, dynamic> _metadataToJson(ChatResponseMetadata meta) {
    return {
      if (meta.exportable != null)
        'exportable': {
          'headers': meta.exportable!.headers,
          'rows': meta.exportable!.rows,
          'filename': meta.exportable!.filename,
        },
      'kpis': meta.kpis
          .map(
            (k) => {
              'label': k.label,
              'value': k.value,
              if (k.delta != null) 'delta': k.delta,
              'trend': k.trend,
            },
          )
          .toList(),
      'suggestedFollowUps': meta.suggestedFollowUps,
      if (meta.deepLink != null)
        'deepLink': {
          'tab': meta.deepLink!.tab,
          if (meta.deepLink!.clientCode != null)
            'clientCode': meta.deepLink!.clientCode,
        },
      'chartData': meta.chartData
          .map((point) => {'label': point.label, 'value': point.value})
          .toList(),
      'documents': meta.documents
          .map(
            (document) => {
              'title': document.title,
              'url': document.url,
              'type': document.type,
              if (document.fileName != null) 'fileName': document.fileName,
              if (document.clientCode != null)
                'clientCode': document.clientCode,
            },
          )
          .toList(),
    };
  }
}
