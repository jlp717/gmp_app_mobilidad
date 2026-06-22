import 'dart:convert';

import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';
import 'package:gmp_app_mobilidad/features/chatbot/providers/chatbot_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists the last N chat messages per user across tab switches.
class ChatbotPersistence {
  ChatbotPersistence._();

  static const int maxMessages = 40;

  static String _storageKey(String userCode) =>
      'chatbot_session_${userCode.trim()}';

  static Future<List<ChatMessage>> load(String userCode) async {
    if (userCode.trim().isEmpty) return [];
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_storageKey(userCode));
      if (raw == null || raw.isEmpty) return [];
      final list = jsonDecode(raw) as List<dynamic>;
      return list
          .map((e) => _messageFromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> save(String userCode, List<ChatMessage> messages) async {
    if (userCode.trim().isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final slice = messages.length > maxMessages
          ? messages.sublist(messages.length - maxMessages)
          : messages;
      final encoded = jsonEncode(slice.map(_messageToJson).toList());
      await prefs.setString(_storageKey(userCode), encoded);
    } catch (_) {
      // Non-blocking — chat still works without persistence.
    }
  }

  static Future<void> clear(String userCode) async {
    if (userCode.trim().isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_storageKey(userCode));
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
          .map((k) => {
                'label': k.label,
                'value': k.value,
                if (k.delta != null) 'delta': k.delta,
                'trend': k.trend,
              })
          .toList(),
      'suggestedFollowUps': meta.suggestedFollowUps,
      if (meta.deepLink != null)
        'deepLink': {
          'tab': meta.deepLink!.tab,
          if (meta.deepLink!.clientCode != null)
            'clientCode': meta.deepLink!.clientCode,
        },
      'chartData': meta.chartData
          .map((p) => {'label': p.label, 'value': p.value})
          .toList(),
    };
  }
}
