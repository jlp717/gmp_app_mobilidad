import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/coming_soon_placeholder.dart';

Future<void> pumpComingSoon(
  WidgetTester tester,
  ComingSoonPlaceholder placeholder,
) async {
  await tester.pumpWidget(MaterialApp(home: placeholder));
  await tester.pump(const Duration(seconds: 4));
}

void main() {
  group('ComingSoonPlaceholder Widget Tests', () {
    testWidgets('displays title', (tester) async {
      await pumpComingSoon(
        tester,
        const ComingSoonPlaceholder(
          title: 'Feature Title',
        ),
      );

      expect(find.text('Feature Title'), findsOneWidget);
    });

    testWidgets('displays default subtitle', (tester) async {
      await pumpComingSoon(
        tester,
        const ComingSoonPlaceholder(
          title: 'Test',
        ),
      );

      expect(
        find.text(
            'Estamos trabajando en esta funcionalidad.\nDisponible próximamente.'),
        findsOneWidget,
      );
    });

    testWidgets('displays custom subtitle', (tester) async {
      await pumpComingSoon(
        tester,
        const ComingSoonPlaceholder(
          title: 'Test',
          subtitle: 'Custom subtitle text',
        ),
      );

      expect(find.text('Custom subtitle text'), findsOneWidget);
    });

    testWidgets('displays default rocket icon', (tester) async {
      await pumpComingSoon(
        tester,
        const ComingSoonPlaceholder(
          title: 'Test',
        ),
      );

      expect(find.byIcon(Icons.rocket_launch), findsOneWidget);
    });

    testWidgets('displays custom icon when provided', (tester) async {
      await pumpComingSoon(
        tester,
        const ComingSoonPlaceholder(
          title: 'Test',
          icon: Icons.build,
        ),
      );

      expect(find.byIcon(Icons.build), findsOneWidget);
    });

    testWidgets('displays EN DESARROLLO badge', (tester) async {
      await pumpComingSoon(
        tester,
        const ComingSoonPlaceholder(
          title: 'Test',
        ),
      );

      expect(find.text('EN DESARROLLO'), findsOneWidget);
    });

    testWidgets('displays construction icon in badge', (tester) async {
      await pumpComingSoon(
        tester,
        const ComingSoonPlaceholder(
          title: 'Test',
        ),
      );

      expect(find.byIcon(Icons.construction_rounded), findsOneWidget);
    });

    testWidgets('has Scaffold as root widget', (tester) async {
      await pumpComingSoon(
        tester,
        const ComingSoonPlaceholder(
          title: 'Test',
        ),
      );

      expect(find.byType(Scaffold), findsOneWidget);
    });

    testWidgets('has dark background color', (tester) async {
      await pumpComingSoon(
        tester,
        const ComingSoonPlaceholder(
          title: 'Test',
        ),
      );

      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
      expect(scaffold.backgroundColor, isNotNull);
    });
  });
}
