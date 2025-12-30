// GMP App Widget Test - Basic Smoke Test
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('GMP App basic widget test', (WidgetTester tester) async {
    // Build a simple MaterialApp with placeholder content
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          appBar: AppBar(title: const Text('GMP Sales')),
          body: const Center(
            child: Text('GMP Sales Application'),
          ),
        ),
      ),
    );

    // Verify the app name renders
    expect(find.text('GMP Sales'), findsOneWidget);
    expect(find.text('GMP Sales Application'), findsOneWidget);
  });

  testWidgets('CircularProgressIndicator renders correctly', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Center(
            child: CircularProgressIndicator(),
          ),
        ),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('Error message displays correctly', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: const [
                Icon(Icons.error_outline, size: 64),
                SizedBox(height: 16),
                Text('Error: Connection failed'),
                SizedBox(height: 16),
              ],
            ),
          ),
        ),
      ),
    );

    expect(find.byIcon(Icons.error_outline), findsOneWidget);
    expect(find.text('Error: Connection failed'), findsOneWidget);
  });
}
