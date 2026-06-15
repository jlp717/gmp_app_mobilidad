import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/pages/chatbot_page.dart';

void main() {
  testWidgets(
      'ChatbotPage smoke renders assistant shell without sending network calls',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: ChatbotPage(vendedorCodes: ['80']),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.byType(ChatbotPage), findsOneWidget);
    expect(find.text('NEXUS AI'), findsOneWidget);
    expect(find.text('Asistente Comercial Inteligente'), findsOneWidget);
    expect(find.byIcon(Icons.sync_rounded), findsOneWidget);
    expect(find.text('Navegación'), findsWidgets);
    expect(find.text('Facturas'), findsWidgets);
    expect(find.text('Pedidos'), findsWidgets);
    expect(find.text('Evaluar'), findsWidgets);

    final input = tester.widget<TextField>(find.byType(TextField));
    expect(input.maxLines, 5);
    expect(input.keyboardType, TextInputType.multiline);
  });
}
