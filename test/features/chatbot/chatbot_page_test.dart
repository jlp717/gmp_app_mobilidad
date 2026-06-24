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
    expect(find.text('Asistente'), findsWidgets);
    expect(find.text('Asistente Comercial Inteligente'), findsOneWidget);
    expect(find.byIcon(Icons.sync_rounded), findsOneWidget);
    expect(find.text('Comercial'), findsWidgets);
    expect(find.text('Historial'), findsOneWidget);
    expect(find.text('Respuestas'), findsOneWidget);
    expect(find.text('Briefing'), findsOneWidget);
    expect(find.text('Centro Comercial IA'), findsOneWidget);
    expect(find.text('Factura'), findsWidgets);
    expect(find.text('Comisiones'), findsWidgets);
    expect(find.text('Objetivos'), findsWidgets);
    expect(find.text('Glacius'), findsWidgets);
    expect(find.text('Bolsa'), findsWidgets);
    expect(find.text('Almacen'), findsWidgets);
    expect(find.text('Ruta'), findsWidgets);
    expect(find.textContaining('Objetivo acumulado'), findsWidgets);

    final input = tester.widget<TextField>(find.byType(TextField));
    expect(input.maxLines, 5);
    expect(input.keyboardType, TextInputType.multiline);

    await tester.tap(find.byTooltip('Abrir historial de chats'));
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Historial de chats'), findsOneWidget);
    expect(
      find.textContaining('Todavia no hay conversaciones'),
      findsOneWidget,
    );
  });
}
