import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/shimmer_skeleton.dart';

void main() {
  group('ShimmerLoading Widget Tests', () {
    testWidgets('renders child when isLoading is false', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ShimmerLoading(
              isLoading: false,
              child: const Text('Loaded Content'),
            ),
          ),
        ),
      );

      expect(find.text('Loaded Content'), findsOneWidget);
    });

    testWidgets('shows shimmer effect when isLoading is true', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ShimmerLoading(
              isLoading: true,
              child: const Text('Loading...'),
            ),
          ),
        ),
      );

      expect(find.byType(ShaderMask), findsOneWidget);
    });

    testWidgets('animation repeats indefinitely', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ShimmerLoading(
              isLoading: true,
              child: const Text('Test'),
            ),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 750));
      await tester.pump(const Duration(milliseconds: 750));

      expect(find.byType(ShaderMask), findsOneWidget);
    });

    testWidgets('child is visible when isLoading is false', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ShimmerLoading(
              isLoading: false,
              child: const Text('Visible Child'),
            ),
          ),
        ),
      );

      final text = tester.widget<Text>(find.text('Visible Child'));
      expect(text.data, 'Visible Child');
    });
  });

  group('SkeletonCard Widget Tests', () {
    testWidgets('renders skeleton card with default height', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SkeletonCard(),
          ),
        ),
      );

      expect(find.byType(Container), findsWidgets);
    });

    testWidgets('respects custom height', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SkeletonCard(height: 200),
          ),
        ),
      );

      final container = tester.widget<Container>(
        find.byType(Container).first,
      );
      expect(container.constraints?.maxHeight, 200);
    });

    testWidgets('respects custom width', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SkeletonCard(width: 300),
          ),
        ),
      );

      final container = tester.widget<Container>(
        find.byType(Container).first,
      );
      expect(container.constraints?.maxWidth, 300);
    });
  });

  group('SkeletonList Widget Tests', () {
    testWidgets('renders multiple skeleton cards', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SkeletonList(itemCount: 3),
          ),
        ),
      );

      await tester.pump();

      final containers = tester.widgetList<Container>(find.byType(Container));
      expect(containers.length, greaterThan(3));
    });
  });
}
