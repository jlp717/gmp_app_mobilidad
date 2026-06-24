import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_persistence.dart';
import 'package:gmp_app_mobilidad/features/chatbot/providers/chatbot_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('ChatbotPersistence multi-session history', () {
    test('saves active sessions and loads individual conversations', () async {
      await ChatbotPersistence.saveSession(
        userCode: '80',
        sessionId: 's1',
        title: 'Facturas cliente',
        messages: [
          ChatMessage(content: 'facturas cliente 12345', isUser: true),
        ],
      );
      await ChatbotPersistence.saveSession(
        userCode: '80',
        sessionId: 's2',
        title: 'Objetivo trimestre',
        messages: [
          ChatMessage(content: 'objetivo acumulado enero marzo', isUser: true),
          ChatMessage(content: 'Objetivo acumulado...', isUser: false),
        ],
      );

      final sessions = await ChatbotPersistence.loadSessions('80');
      expect(sessions, hasLength(2));
      expect(sessions.map((session) => session.id), containsAll(['s1', 's2']));
      expect(await ChatbotPersistence.getActiveSessionId('80'), 's2');

      final first = await ChatbotPersistence.loadSession('80', 's1');
      expect(first, hasLength(1));
      expect(first.first.content, 'facturas cliente 12345');

      await ChatbotPersistence.deleteSession('80', 's2');
      final remaining = await ChatbotPersistence.loadSessions('80');
      expect(remaining, hasLength(1));
      expect(remaining.single.id, 's1');
      expect(await ChatbotPersistence.getActiveSessionId('80'), 's1');
    });

    test('migrates the previous single-session storage format', () async {
      SharedPreferences.setMockInitialValues({
        'chatbot_session_80': jsonEncode([
          {
            'content': 'mi comision del mes',
            'isUser': true,
            'timestamp': DateTime(2026, 6, 24).toIso8601String(),
            'isPinned': false,
            'metadata': <String, dynamic>{},
          },
        ]),
      });

      final sessions = await ChatbotPersistence.loadSessions('80');
      expect(sessions, hasLength(1));
      expect(sessions.single.title, 'mi comision del mes');

      final messages = await ChatbotPersistence.load('80');
      expect(messages, hasLength(1));
      expect(messages.single.content, 'mi comision del mes');
    });
  });
}
