import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/chatbot/data/chatbot_models.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_data_card.dart';
import 'package:gmp_app_mobilidad/features/chatbot/presentation/widgets/chat_export_table.dart';
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
      });

      expect(meta.exportable?.filename, 'x.csv');
      expect(meta.kpis, hasLength(1));
      expect(meta.suggestedFollowUps, ['Exportar']);
      expect(meta.deepLink?.tab, 'Facturas');
    });
  });
}
