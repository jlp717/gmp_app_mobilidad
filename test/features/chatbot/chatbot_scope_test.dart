import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_service.dart';
import 'package:gmp_app_mobilidad/features/chatbot/providers/chatbot_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(ApiClient.resetForTesting);

  test('ChatbotService sends the effective reparto CSV in the request body',
      () async {
    Map<String, dynamic>? capturedBody;
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        if (options.method == 'POST' && options.path == '/chatbot/message') {
          capturedBody = Map<String, dynamic>.from(options.data as Map);
          handler.resolve(
            Response<Map<String, dynamic>>(
              requestOptions: options,
              statusCode: 200,
              data: const {'response': 'ok', 'metadata': <String, dynamic>{}},
            ),
          );
          return;
        }
        handler.next(options);
      },
    );
    ApiClient.dio.interceptors.add(interceptor);

    final result = await ChatbotService().sendMessage(
      message: 'entregas de hoy',
      repartidorId: '03,05',
      conversationHistory: const [
        {'role': 'user', 'content': 'ruta'},
      ],
    );

    expect(result.response, 'ok');
    expect(capturedBody, containsPair('repartidorId', '03,05'));
    expect(capturedBody, containsPair('message', 'entregas de hoy'));
  });

  test('ChatbotService omits reparto scope outside Reparto mode', () async {
    Map<String, dynamic>? capturedBody;
    final interceptor = InterceptorsWrapper(
      onRequest: (options, handler) {
        if (options.method == 'POST' && options.path == '/chatbot/message') {
          capturedBody = Map<String, dynamic>.from(options.data as Map);
          handler.resolve(
            Response<Map<String, dynamic>>(
              requestOptions: options,
              statusCode: 200,
              data: const {'response': 'ok'},
            ),
          );
          return;
        }
        handler.next(options);
      },
    );
    ApiClient.dio.interceptors.add(interceptor);

    await ChatbotService().sendMessage(message: 'objetivo del mes');

    expect(capturedBody, isNot(contains('repartidorId')));
  });

  test('provider clears the conversation and client context on scope change',
      () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(chatbotProvider.notifier);

    notifier.setClientContext('CLIENTE-1');
    notifier.addSystemMessage('respuesta del alcance anterior');
    notifier.setRepartidorScope('03');
    notifier.addSystemMessage('respuesta de 03');

    notifier.setRepartidorScope('05');

    final state = container.read(chatbotProvider);
    expect(state.repartidorId, '05');
    expect(state.messages, isEmpty);
    expect(state.currentClientCode, isNull);
    expect(state.pinnedMessageId, isNull);
  });

  test('setting the same normalized scope preserves the conversation', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(chatbotProvider.notifier);

    notifier.setRepartidorScope('03');
    notifier.addSystemMessage('misma conversacion');
    notifier.setRepartidorScope('03');

    expect(container.read(chatbotProvider).messages, hasLength(1));
  });
}
