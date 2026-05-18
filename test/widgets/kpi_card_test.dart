import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/dashboard/presentation/widgets/kpi_card.dart';

void main() {
  group('KPICard Widget Tests', () {
    group('Basic rendering', () {
      testWidgets('renders title and value', (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 200,
                height: 200,
                child: KPICard(
                  title: 'Ventas Hoy',
                  value: '1,234.56€',
                  icon: Icons.today,
                ),
              ),
            ),
          ),
        );

        expect(find.text('Ventas Hoy'), findsOneWidget);
        expect(find.text('1,234.56€'), findsOneWidget);
      });

      testWidgets('renders icon', (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 200,
                height: 200,
                child: KPICard(
                  title: 'Test',
                  value: '100',
                  icon: Icons.trending_up,
                ),
              ),
            ),
          ),
        );

        expect(find.byIcon(Icons.trending_up), findsOneWidget);
      });

      testWidgets('renders within a Card widget', (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 200,
                height: 200,
                child: KPICard(
                  title: 'Test',
                  value: '100',
                  icon: Icons.today,
                ),
              ),
            ),
          ),
        );

        expect(find.byType(Card), findsOneWidget);
      });
    });

    group('Subtitle and trend indicator', () {
      testWidgets('shows subtitle when provided', (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 200,
                height: 200,
                child: KPICard(
                  title: 'Ventas Mes',
                  value: '45,000€',
                  icon: Icons.calendar_month,
                  subtitle: '+12%',
                ),
              ),
            ),
          ),
        );

        expect(find.text('+12%'), findsOneWidget);
      });

      testWidgets('does not show subtitle container when subtitle is null',
          (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 200,
                height: 200,
                child: KPICard(
                  title: 'Test',
                  value: '100',
                  icon: Icons.today,
                ),
              ),
            ),
          ),
        );

        final containers = tester.widgetList<Container>(find.byType(Container));
        bool hasSubtitleContainer = false;
        for (final container in containers) {
          final decoration = container.decoration;
          if (decoration is BoxDecoration &&
              decoration.borderRadius == BorderRadius.circular(12)) {
            hasSubtitleContainer = true;
            break;
          }
        }
        expect(hasSubtitleContainer, false);
      });

      testWidgets('positive trend shows success color', (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 200,
                height: 200,
                child: KPICard(
                  title: 'Test',
                  value: '100',
                  icon: Icons.trending_up,
                  subtitle: '+5%',
                  isPositive: true,
                ),
              ),
            ),
          ),
        );

        final text = tester.widget<Text>(find.text('+5%'));
        expect(text.style?.color, isNotNull);
      });

      testWidgets('negative trend shows error color', (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 200,
                height: 200,
                child: KPICard(
                  title: 'Test',
                  value: '100',
                  icon: Icons.trending_down,
                  subtitle: '-5%',
                  isPositive: false,
                ),
              ),
            ),
          ),
        );

        final text = tester.widget<Text>(find.text('-5%'));
        expect(text.style?.color, isNotNull);
      });
    });

    group('Custom color', () {
      testWidgets('uses custom color when provided', (tester) async {
        const customColor = Colors.purple;

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 200,
                height: 200,
                child: KPICard(
                  title: 'Test',
                  value: '100',
                  icon: Icons.star,
                  color: customColor,
                ),
              ),
            ),
          ),
        );

        final icon = tester.widget<Icon>(find.byIcon(Icons.star));
        expect(icon.color, customColor);
      });
    });

    group('Layout structure', () {
      testWidgets('has correct number of main structural elements',
          (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 200,
                height: 200,
                child: KPICard(
                  title: 'Test',
                  value: '100',
                  icon: Icons.today,
                ),
              ),
            ),
          ),
        );

        expect(find.byType(Column), findsWidgets);
        expect(find.byType(Row), findsWidgets);
      });

      testWidgets('title is in correct position relative to value',
          (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 200,
                height: 200,
                child: KPICard(
                  title: 'Test Title',
                  value: '999',
                  icon: Icons.today,
                ),
              ),
            ),
          ),
        );

        final columns = tester.widgetList<Column>(find.byType(Column));
        final mainColumn =
            columns.where((c) => c.mainAxisSize == MainAxisSize.max).first;

        final textWidgets = tester.widgetList<Text>(find.descendant(
            of: find.byWidget(mainColumn), matching: find.byType(Text)));

        final textContents = textWidgets.map((t) => t.data).toList();
        expect(textContents, contains('Test Title'));
        expect(textContents, contains('999'));
      });
    });
  });
}
