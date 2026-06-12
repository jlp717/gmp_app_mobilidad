import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/smart_sync_header.dart';

void main() {
  group('SmartSyncHeader Tests', () {
    testWidgets('displays title', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SmartSyncHeader(
              title: 'Test Title',
              subtitle: 'Test Subtitle',
              onSync: () {},
            ),
          ),
        ),
      );

      expect(find.text('Test Title'), findsOneWidget);
    });

    testWidgets('displays subtitle', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SmartSyncHeader(
              title: 'Title',
              subtitle: 'Subtitle',
              onSync: () {},
            ),
          ),
        ),
      );

      expect(find.text('Subtitle'), findsOneWidget);
    });

    testWidgets('shows sync icon when not loading', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SmartSyncHeader(
              title: 'Title',
              subtitle: 'Subtitle',
              onSync: () {},
            ),
          ),
        ),
      );

      expect(find.byIcon(Icons.sync_rounded), findsOneWidget);
    });

    testWidgets('shows loading indicator when isLoading', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SmartSyncHeader(
              title: 'Title',
              subtitle: 'Subtitle',
              isLoading: true,
              onSync: () {},
            ),
          ),
        ),
      );

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('calls onSync when sync button tapped', (tester) async {
      bool syncCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SmartSyncHeader(
              title: 'Title',
              subtitle: 'Subtitle',
              onSync: () => syncCalled = true,
            ),
          ),
        ),
      );

      await tester.tap(find.byIcon(Icons.sync_rounded));
      expect(syncCalled, true);
    });

    testWidgets('does not call onSync when loading', (tester) async {
      bool syncCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SmartSyncHeader(
              title: 'Title',
              subtitle: 'Subtitle',
              isLoading: true,
              onSync: () => syncCalled = true,
            ),
          ),
        ),
      );

      await tester.tap(find.byType(CircularProgressIndicator));
      expect(syncCalled, false);
    });

    testWidgets('displays shipping icon', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SmartSyncHeader(
              title: 'Title',
              subtitle: 'Subtitle',
              onSync: () {},
            ),
          ),
        ),
      );

      expect(find.byIcon(Icons.local_shipping_outlined), findsOneWidget);
    });

    testWidgets('compact mode reduces padding', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SmartSyncHeader(
              title: 'Title',
              subtitle: 'Subtitle',
              onSync: () {},
              compact: true,
            ),
          ),
        ),
      );

      expect(find.byType(SmartSyncHeader), findsOneWidget);
    });
  });
}
