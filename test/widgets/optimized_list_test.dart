import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/optimized_list.dart';

void main() {
  group('OptimizedListView Tests', () {
    testWidgets('renders list with items', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: OptimizedListView(
              itemCount: 10,
              itemBuilder: (context, index) => Text('Item $index'),
            ),
          ),
        ),
      );

      expect(find.text('Item 0'), findsOneWidget);
      expect(find.text('Item 5'), findsOneWidget);
    });

    testWidgets('respects padding parameter', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: OptimizedListView(
              itemCount: 3,
              padding: const EdgeInsets.all(20),
              itemBuilder: (context, index) => Text('Item $index'),
            ),
          ),
        ),
      );

      expect(find.byType(ListView), findsOneWidget);
    });

    testWidgets('respects shrinkWrap parameter', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: OptimizedListView(
              itemCount: 3,
              shrinkWrap: true,
              itemBuilder: (context, index) => Text('Item $index'),
            ),
          ),
        ),
      );

      expect(find.byType(ListView), findsOneWidget);
    });
  });

  group('OptimizedSliverList Tests', () {
    testWidgets('renders sliver list with items', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: CustomScrollView(
              slivers: [
                OptimizedSliverList(
                  itemCount: 5,
                  itemBuilder: (context, index) => Text('Sliver Item $index'),
                ),
              ],
            ),
          ),
        ),
      );

      expect(find.text('Sliver Item 0'), findsOneWidget);
    });
  });

  group('IsolatedWidget Tests', () {
    testWidgets('renders child widget', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: IsolatedWidget(
              child: Text('Isolated Content'),
            ),
          ),
        ),
      );

      expect(find.text('Isolated Content'), findsOneWidget);
    });

    testWidgets('wraps child in RepaintBoundary', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: IsolatedWidget(
              child: Text('Content'),
            ),
          ),
        ),
      );

      expect(find.byType(RepaintBoundary), findsWidgets);
      expect(find.text('Content'), findsOneWidget);
    });
  });

  group('DebouncedCallback Tests', () {
    test('allows call after duration passes', () async {
      final debouncer =
          DebouncedCallback(duration: const Duration(milliseconds: 50));

      expect(debouncer.call(), true);

      await Future.delayed(const Duration(milliseconds: 60));

      expect(debouncer.call(), true);
    });

    test('blocks rapid successive calls', () async {
      final debouncer =
          DebouncedCallback(duration: const Duration(milliseconds: 100));

      expect(debouncer.call(), true);
      expect(debouncer.call(), false);
      expect(debouncer.call(), false);
    });
  });
}
