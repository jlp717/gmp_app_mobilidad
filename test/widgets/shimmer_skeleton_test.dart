import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';

void main() {
  group('SkeletonCard Tests', () {
    testWidgets('renders with default height', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonCard(),
          ),
        ),
      );

      expect(find.byType(SkeletonCard), findsOneWidget);
      expect(find.byType(Container), findsWidgets);
    });

    testWidgets('respects custom height', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonCard(height: 200),
          ),
        ),
      );

      expect(find.byType(SkeletonCard), findsOneWidget);
      final container = tester.widget<Container>(find.descendant(
        of: find.byType(SkeletonCard),
        matching: find.byType(Container).first,
      ));
      expect(container.constraints?.maxHeight, 200);
    });

    testWidgets('respects custom width', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonCard(width: 300),
          ),
        ),
      );

      expect(find.byType(SkeletonCard), findsOneWidget);
    });

    testWidgets('renders Row with icon placeholder', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonCard(),
          ),
        ),
      );

      expect(find.byType(Row), findsWidgets);
    });

    testWidgets('renders Column for content structure', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonCard(),
          ),
        ),
      );

      expect(find.byType(Column), findsWidgets);
    });
  });

  group('SkeletonList Tests', () {
    testWidgets('renders ListView with items', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonList(itemCount: 3),
          ),
        ),
      );

      expect(find.byType(ListView), findsOneWidget);
    });

    testWidgets('respects custom itemCount', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonList(itemCount: 10),
          ),
        ),
      );

      expect(find.byType(ListView), findsOneWidget);
    });

    testWidgets('uses default itemCount of 5', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SkeletonList(),
          ),
        ),
      );

      expect(find.byType(SkeletonCard), findsNWidgets(5));
    });

    testWidgets('respects custom itemHeight', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonList(itemCount: 3, itemHeight: 200),
          ),
        ),
      );

      final cards = tester.widgetList<SkeletonCard>(find.byType(SkeletonCard));
      for (final card in cards) {
        expect(card.height, 200);
      }
    });
  });

  group('SkeletonSummary Tests', () {
    testWidgets('renders container', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SkeletonSummary(),
          ),
        ),
      );

      expect(find.byType(Container), findsWidgets);
    });

    testWidgets('renders Row with summary items', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SkeletonSummary(),
          ),
        ),
      );

      expect(find.byType(Row), findsWidgets);
    });

    testWidgets('renders multiple summary items', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SkeletonSummary(),
          ),
        ),
      );

      expect(find.byType(Column), findsWidgets);
    });
  });
}
