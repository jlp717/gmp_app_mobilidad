import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/lazy_indexed_stack.dart';

void main() {
  group('LazyIndexedStack Tests', () {
    testWidgets('renders only active child initially', (tester) async {
      var buildCount = 0;

      await tester.pumpWidget(
        MaterialApp(
          home: LazyIndexedStack(
            index: 0,
            children: [
              Builder(
                builder: (context) {
                  buildCount++;
                  return const Text('Page 0');
                },
              ),
              Builder(
                builder: (context) {
                  buildCount++;
                  return const Text('Page 1');
                },
              ),
            ],
          ),
        ),
      );

      expect(find.text('Page 0'), findsOneWidget);
      expect(find.text('Page 1'), findsNothing);
      expect(buildCount, 1);
    });

    testWidgets('renders correct child when index changes', (tester) async {
      var currentIndex = 0;

      await tester.pumpWidget(
        StatefulBuilder(
          builder: (context, setState) {
            return MaterialApp(
              home: Scaffold(
                body: LazyIndexedStack(
                  index: currentIndex,
                  children: const [
                    Text('Page 0'),
                    Text('Page 1'),
                    Text('Page 2'),
                  ],
                ),
                floatingActionButton: FloatingActionButton(
                  onPressed: () => setState(() => currentIndex = 1),
                  child: const Icon(Icons.arrow_forward),
                ),
              ),
            );
          },
        ),
      );

      expect(find.text('Page 0'), findsOneWidget);
      expect(find.text('Page 1'), findsNothing);

      await tester.tap(find.byIcon(Icons.arrow_forward));
      await tester.pumpAndSettle();

      expect(find.text('Page 0'), findsNothing);
      expect(find.text('Page 1'), findsOneWidget);
    });

    testWidgets('preserves state of previously active children',
        (tester) async {
      var counterValue = 0;

      await tester.pumpWidget(
        StatefulBuilder(
          builder: (context, setState) {
            return MaterialApp(
              home: Scaffold(
                body: LazyIndexedStack(
                  index: 0,
                  children: [
                    Column(
                      children: [
                        Text('Count: $counterValue'),
                        ElevatedButton(
                          onPressed: () => setState(() => counterValue++),
                          child: const Text('Increment'),
                        ),
                      ],
                    ),
                    const Text('Page 1'),
                  ],
                ),
                floatingActionButton: FloatingActionButton(
                  onPressed: () => setState(() {}),
                  child: const Icon(Icons.refresh),
                ),
              ),
            );
          },
        ),
      );

      await tester.tap(find.text('Increment'));
      await tester.pump();
      expect(find.text('Count: 1'), findsOneWidget);
    });

    testWidgets('handles empty children list', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: LazyIndexedStack(
              index: 0,
              children: [],
            ),
          ),
        ),
      );

      expect(find.byType(LazyIndexedStack), findsOneWidget);
    });

    testWidgets('respects alignment parameter', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: LazyIndexedStack(
            index: 0,
            alignment: Alignment.center,
            children: [
              Text('Centered'),
            ],
          ),
        ),
      );

      expect(find.text('Centered'), findsOneWidget);
    });

    testWidgets('respects sizing parameter', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: LazyIndexedStack(
            index: 0,
            sizing: StackFit.expand,
            children: [
              Text('Expanded'),
            ],
          ),
        ),
      );

      expect(find.text('Expanded'), findsOneWidget);
    });

    testWidgets('activates correct index on init', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: LazyIndexedStack(
            index: 2,
            children: [
              Text('Page 0'),
              Text('Page 1'),
              Text('Page 2'),
            ],
          ),
        ),
      );

      expect(find.text('Page 0'), findsNothing);
      expect(find.text('Page 1'), findsNothing);
      expect(find.text('Page 2'), findsOneWidget);
    });
  });
}
