import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/multi_select_dialog.dart';

void main() {
  group('MultiSelectDialog Tests', () {
    testWidgets('displays title', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (context) => MultiSelectDialog<String>(
                        items: const ['Option 1', 'Option 2'],
                        selectedItems: const {},
                        title: 'Select Options',
                        labelBuilder: (item) => item,
                      ),
                    );
                  },
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Select Options'), findsOneWidget);
    });

    testWidgets('displays items in list', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (context) => MultiSelectDialog<String>(
                        items: const ['Item A', 'Item B', 'Item C'],
                        selectedItems: const {},
                        title: 'Choose',
                        labelBuilder: (item) => item,
                      ),
                    );
                  },
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Item A'), findsOneWidget);
      expect(find.text('Item B'), findsOneWidget);
      expect(find.text('Item C'), findsOneWidget);
    });

    testWidgets('shows selected items as checked', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (context) => MultiSelectDialog<String>(
                        items: const ['Option 1', 'Option 2'],
                        selectedItems: const {'Option 1'},
                        title: 'Select',
                        labelBuilder: (item) => item,
                      ),
                    );
                  },
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.check_rounded), findsOneWidget);
    });

    testWidgets('allows selecting items', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (context) => MultiSelectDialog<String>(
                        items: const ['Option 1', 'Option 2'],
                        selectedItems: const {},
                        title: 'Select',
                        labelBuilder: (item) => item,
                      ),
                    );
                  },
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Option 1'));
      await tester.pump();

      expect(find.byIcon(Icons.check_rounded), findsOneWidget);
    });

    testWidgets('shows cancel and apply buttons', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (context) => MultiSelectDialog<String>(
                        items: const ['Option 1'],
                        selectedItems: const {},
                        title: 'Select',
                        labelBuilder: (item) => item,
                      ),
                    );
                  },
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Cancelar'), findsOneWidget);
      expect(find.text('Aplicar'), findsOneWidget);
    });

    testWidgets('cancel button closes without result', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () async {
                    final result = await showDialog<Set<String>>(
                      context: context,
                      builder: (context) => MultiSelectDialog<String>(
                        items: const ['Option 1'],
                        selectedItems: const {},
                        title: 'Select',
                        labelBuilder: (item) => item,
                      ),
                    );
                    expect(result, isNull);
                  },
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();
    });

    testWidgets('apply button returns selected items', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () async {
                    final result = await showDialog<Set<String>>(
                      context: context,
                      builder: (context) => MultiSelectDialog<String>(
                        items: const ['Option 1', 'Option 2'],
                        selectedItems: const {},
                        title: 'Select',
                        labelBuilder: (item) => item,
                      ),
                    );
                    expect(result, contains('Option 1'));
                  },
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Option 1'));
      await tester.pump();

      await tester.tap(find.text('Aplicar'));
      await tester.pumpAndSettle();
    });

    testWidgets('filters items with search', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (context) => MultiSelectDialog<String>(
                        items: const ['Apple', 'Banana', 'Cherry'],
                        selectedItems: const {},
                        title: 'Fruit',
                        labelBuilder: (item) => item,
                      ),
                    );
                  },
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'Ban');
      await tester.pump();

      expect(find.text('Banana'), findsOneWidget);
      expect(find.text('Apple'), findsNothing);
      expect(find.text('Cherry'), findsNothing);
    });

    testWidgets('shows empty message when no results', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (context) => MultiSelectDialog<String>(
                        items: const ['Apple', 'Banana'],
                        selectedItems: const {},
                        title: 'Fruit',
                        labelBuilder: (item) => item,
                      ),
                    );
                  },
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'XYZ');
      await tester.pump();

      expect(find.text('No se encontraron resultados'), findsOneWidget);
    });
  });
}
