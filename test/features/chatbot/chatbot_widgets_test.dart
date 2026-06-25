import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_data_card.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_export_table.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_message_bubble.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_share_actions.dart';

void main() {
  group('ChatExportTable', () {
    testWidgets('renders headers and rows', (tester) async {
      const data = ChatExportableData(
        headers: ['Cliente', 'Ventas'],
        rows: [
          ['C001', '1.000€'],
          ['C002', '2.500€'],
        ],
        filename: 'ventas.csv',
      );

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: ChatExportTable(data: data)),
        ),
      );

      expect(find.text('Cliente'), findsOneWidget);
      expect(find.text('C001'), findsOneWidget);
      expect(find.text('2.500€'), findsOneWidget);
    });

    testWidgets('shows Ver más when more than 10 rows', (tester) async {
      final rows = List.generate(
        12,
        (i) => ['R$i', '${i * 100}€'],
      );
      final data = ChatExportableData(
        headers: const ['Ref', 'Importe'],
        rows: rows,
        filename: 'large.csv',
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: ChatExportTable(data: data)),
        ),
      );

      expect(find.textContaining('Ver más'), findsOneWidget);
      expect(find.text('R11'), findsNothing);

      await tester.tap(find.textContaining('Ver más'));
      await tester.pumpAndSettle();

      expect(find.text('R11'), findsOneWidget);
    });

    testWidgets('normalizes ragged rows without DataTable assertion',
        (tester) async {
      const data = ChatExportableData(
        headers: ['Cliente', 'Importe'],
        rows: [
          ['C001'],
          ['C002', '200', 'columna extra descartada'],
        ],
        filename: 'ragged.csv',
      );

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: ChatExportTable(data: data)),
        ),
      );

      expect(tester.takeException(), isNull);
      expect(find.text('Cliente'), findsOneWidget);
      expect(find.text('C001'), findsOneWidget);
      expect(find.text('C002'), findsOneWidget);
      expect(find.text('columna extra descartada'), findsNothing);
    });
  });

  group('ChatDataCard', () {
    testWidgets('renders KPI chips', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ChatDataCard(
              kpis: [
                ChatKpiChip(label: 'Ventas', value: '8.432€', trend: 'up'),
                ChatKpiChip(label: 'Margen', value: '18%', trend: 'neutral'),
              ],
            ),
          ),
        ),
      );

      expect(find.text('VENTAS'), findsOneWidget);
      expect(find.text('8.432€'), findsOneWidget);
      expect(find.text('MARGEN'), findsOneWidget);
    });
  });

  group('ChatShareActions CSV', () {
    test('buildCsv uses semicolon separator', () {
      const data = ChatExportableData(
        headers: ['A', 'B'],
        rows: [
          ['1', '2'],
        ],
        filename: 'test.csv',
      );

      final csv = ChatShareActions.buildCsv(data);
      expect(csv, contains('A;B'));
      expect(csv, contains('1;2'));
    });
  });

  group('ChatResponseMetadata', () {
    test('fromJson parses exportable block', () {
      final meta = ChatResponseMetadata.fromJson({
        'exportable': {
          'headers': ['X'],
          'rows': [
            ['1'],
          ],
          'filename': 'x.csv',
        },
        'kpis': [
          {'label': 'Total', 'value': '100€', 'trend': 'neutral'},
        ],
        'suggestedFollowUps': ['Exportar'],
        'deepLink': {'tab': 'Facturas', 'clientCode': 'C1'},
        'documents': [
          {
            'title': 'Factura F/100/2026',
            'url': '/api/facturas/F/100/2026/pdf',
            'type': 'pdf',
            'fileName': 'factura-F-100-2026.pdf',
          },
        ],
      });

      expect(meta.exportable?.filename, 'x.csv');
      expect(meta.kpis, hasLength(1));
      expect(meta.suggestedFollowUps, ['Exportar']);
      expect(meta.deepLink?.tab, 'Facturas');
      expect(meta.documents, hasLength(1));
      expect(meta.documents.first.url, '/api/facturas/F/100/2026/pdf');
    });
  });

  group('ChatMessageBubble documents', () {
    testWidgets('renders PDF action when metadata has documents',
        (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: Scaffold(
              body: ChatMessageBubble(
                message: 'Factura lista',
                isUser: false,
                metadata: ChatResponseMetadata(
                  documents: [
                    ChatDocumentReference(
                      title: 'Factura F/100/2026',
                      url: '/api/facturas/F/100/2026/pdf',
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );

      expect(find.text('IA Comercial'), findsOneWidget);
      expect(find.text('Ver PDF'), findsOneWidget);
      expect(find.text('Factura F/100/2026'), findsOneWidget);
      expect(find.text('Abrir'), findsOneWidget);
      expect(find.byIcon(Icons.picture_as_pdf_outlined), findsWidgets);
    });

    testWidgets('loading bubble renders analysis steps', (tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: Scaffold(
              body: ChatMessageBubble(
                message: '',
                isUser: false,
                isLoading: true,
              ),
            ),
          ),
        ),
      );

      expect(find.text('Analizando consulta...'), findsOneWidget);
      expect(find.text('Interpretando'), findsOneWidget);
      expect(find.text('Permisos'), findsOneWidget);
      expect(find.text('DB2'), findsOneWidget);
      expect(find.text('Respuesta'), findsOneWidget);
    });

    testWidgets('does not overflow on narrow screens with long PDF metadata',
        (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(textScaler: TextScaler.linear(1.6)),
              child: Scaffold(
                body: SingleChildScrollView(
                  child: ChatMessageBubble(
                    message:
                        'Respuesta extensa sobre una factura con muchos datos comerciales, importes, vencimientos y observaciones.',
                    isUser: false,
                    metadata: ChatResponseMetadata(
                      documents: [
                        ChatDocumentReference(
                          title:
                              'Factura F/100/2026 de Central Hoteles con nombre muy largo',
                          url: '/api/facturas/F/100/2026/pdf',
                          fileName:
                              'factura-F-100-2026-central-hoteles-documento-largo.pdf',
                        ),
                      ],
                      suggestedFollowUps: [
                        'Ver facturas pendientes del cliente',
                        'Abrir ficha completa del cliente',
                        'Revisar cobros pendientes',
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Ver PDF'), findsOneWidget);
      expect(find.text('Abrir'), findsOneWidget);
    });
  });
}
