import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';

/// Deep-link navigation request from chat → main shell tab.
class ChatbotShellNavigation {
  const ChatbotShellNavigation({
    required this.tabLabel,
    this.clientCode,
  });

  final String tabLabel;
  final String? clientCode;
}

final chatbotShellNavigationProvider =
    NotifierProvider<ChatbotShellNavigationNotifier, ChatbotShellNavigation?>(
  ChatbotShellNavigationNotifier.new,
);

class ChatbotShellNavigationNotifier extends Notifier<ChatbotShellNavigation?> {
  @override
  ChatbotShellNavigation? build() => null;

  void navigate(ChatDeepLink link) {
    state = ChatbotShellNavigation(
      tabLabel: link.tab,
      clientCode: link.clientCode,
    );
  }

  void clear() => state = null;
}
