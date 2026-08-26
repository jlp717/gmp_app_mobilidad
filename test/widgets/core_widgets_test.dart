// GMP App Widget Tests - Core Components
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/empty_state_widget.dart';
import 'package:gmp_app_mobilidad/core/widgets/error_state_widget.dart';
import 'package:gmp_app_mobilidad/core/widgets/modern_loading.dart';

Future<void> pumpStateWidget(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: child),
    ),
  );
  await tester.pump(const Duration(seconds: 1));
}

void main() {
  group('ErrorStateWidget Tests', () {
    testWidgets('ErrorStateWidget displays message', (tester) async {
      await pumpStateWidget(
        tester,
        const ErrorStateWidget(
          message: 'Something went wrong',
        ),
      );

      expect(find.text('Something went wrong'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline_rounded), findsOneWidget);
    });

    testWidgets('ErrorStateWidget shows retry button when callback provided',
        (tester) async {
      var retried = false;

      await pumpStateWidget(
        tester,
        ErrorStateWidget(
          message: 'Error occurred',
          onRetry: () => retried = true,
        ),
      );

      expect(find.text('Error occurred'), findsOneWidget);
      expect(find.text('Reintentar'), findsOneWidget);

      await tester.tap(find.text('Reintentar'));
      expect(retried, true);
    });

    testWidgets('ErrorStateWidget uses custom retry label', (tester) async {
      await pumpStateWidget(
        tester,
        ErrorStateWidget(
          message: 'Error',
          onRetry: () {},
          retryLabel: 'Try Again',
        ),
      );

      expect(find.text('Try Again'), findsOneWidget);
    });
  });

  group('EmptyStateWidget Tests', () {
    testWidgets('EmptyStateWidget displays title', (tester) async {
      await pumpStateWidget(
        tester,
        const EmptyStateWidget(
          title: 'No items found',
        ),
      );

      expect(find.text('No items found'), findsOneWidget);
    });

    testWidgets('EmptyStateWidget shows icon', (tester) async {
      await pumpStateWidget(
        tester,
        const EmptyStateWidget(
          title: 'Empty',
          icon: Icons.inbox,
        ),
      );

      expect(find.byIcon(Icons.inbox), findsOneWidget);
    });

    testWidgets('EmptyStateWidget shows action button when provided',
        (tester) async {
      var actionTriggered = false;

      await pumpStateWidget(
        tester,
        EmptyStateWidget(
          title: 'No data',
          actionLabel: 'Add Item',
          onAction: () => actionTriggered = true,
        ),
      );

      expect(find.text('Add Item'), findsOneWidget);

      await tester.tap(find.text('Add Item'));
      expect(actionTriggered, true);
    });
  });

  group('ModernLoading Tests', () {
    testWidgets('ModernLoading displays loading indicator', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ModernLoading(
              message: 'Loading...',
            ),
          ),
        ),
      );

      expect(find.text('Loading...'), findsOneWidget);
      await tester.pump(const Duration(seconds: 2));
    });

    testWidgets('ModernLoading without message renders', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ModernLoading(),
          ),
        ),
      );

      expect(find.byType(ModernLoading), findsOneWidget);
      await tester.pump(const Duration(seconds: 2));
    });
  });
}
