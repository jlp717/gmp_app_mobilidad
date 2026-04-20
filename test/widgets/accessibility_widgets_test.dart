import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/accessibility_widgets.dart';

void main() {
  group('AccessibleWidget Tests', () {
    testWidgets('renders child widget', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleWidget(
              child: Text('Child Content'),
            ),
          ),
        ),
      );

      expect(find.text('Child Content'), findsOneWidget);
    });

    testWidgets('applies semantic label', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleWidget(
              label: 'Test Label',
              child: Text('Content'),
            ),
          ),
        ),
      );

      expect(find.text('Content'), findsOneWidget);
      final semantics = tester.getSemantics(find.text('Content'));
      expect(semantics.label, contains('Test Label'));
    });

    testWidgets('applies semantic hint', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleWidget(
              hint: 'Test Hint',
              child: Text('Content'),
            ),
          ),
        ),
      );

      expect(find.text('Content'), findsOneWidget);
    });
  });

  group('AccessibleButton Tests', () {
    testWidgets('renders child widget', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AccessibleButton(
              onPressed: () {},
              child: const Text('Button Text'),
            ),
          ),
        ),
      );

      expect(find.text('Button Text'), findsOneWidget);
    });

    testWidgets('calls onPressed when tapped', (tester) async {
      bool pressed = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AccessibleButton(
              onPressed: () => pressed = true,
              child: const Text('Press Me'),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Press Me'));
      expect(pressed, true);
    });

    testWidgets('does not call onPressed when disabled', (tester) async {
      bool pressed = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AccessibleButton(
              onPressed: null,
              child: const Text('Disabled Button'),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Disabled Button'));
      expect(pressed, false);
    });

    testWidgets('has semantic button role', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AccessibleButton(
              onPressed: () {},
              semanticLabel: 'Submit button',
              child: const Text('Submit'),
            ),
          ),
        ),
      );

      expect(find.text('Submit'), findsOneWidget);
    });
  });

  group('AccessibleTextField Tests', () {
    testWidgets('renders text field', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleTextField(),
          ),
        ),
      );

      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('displays label', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleTextField(
              label: 'Email',
            ),
          ),
        ),
      );

      expect(find.text('Email'), findsOneWidget);
    });

    testWidgets('displays hint', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleTextField(
              hint: 'Enter email here',
            ),
          ),
        ),
      );

      expect(find.text('Enter email here'), findsOneWidget);
    });

    testWidgets('calls onChanged when text changes', (tester) async {
      String changedValue = '';

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AccessibleTextField(
              onChanged: (value) => changedValue = value,
            ),
          ),
        ),
      );

      await tester.enterText(find.byType(TextField), 'test@example.com');
      expect(changedValue, 'test@example.com');
    });

    testWidgets('displays error text', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleTextField(
              errorText: 'Invalid email',
            ),
          ),
        ),
      );

      expect(find.text('Invalid email'), findsOneWidget);
    });

    testWidgets('obscures text when obscureText is true', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleTextField(
              obscureText: true,
            ),
          ),
        ),
      );

      final textField = tester.widget<TextField>(find.byType(TextField));
      expect(textField.obscureText, true);
    });
  });

  group('AccessibleText Tests', () {
    testWidgets('renders text', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleText('Hello World'),
          ),
        ),
      );

      expect(find.text('Hello World'), findsOneWidget);
    });

    testWidgets('applies custom style', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AccessibleText(
              'Styled Text',
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Colors.blue,
              ),
            ),
          ),
        ),
      );

      final text = tester.widget<Text>(find.text('Styled Text'));
      expect(text.style?.fontSize, 20);
      expect(text.style?.fontWeight, FontWeight.bold);
    });

    testWidgets('enforces minimum font size of 14', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleText(
              'Small Text',
              fontSize: 10,
            ),
          ),
        ),
      );

      final text = tester.widget<Text>(find.text('Small Text'));
      expect(text.style?.fontSize, 14);
    });

    testWidgets('allows font sizes above minimum', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleText(
              'Large Text',
              fontSize: 18,
            ),
          ),
        ),
      );

      final text = tester.widget<Text>(find.text('Large Text'));
      expect(text.style?.fontSize, 18);
    });

    testWidgets('respects font weight parameter', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleText(
              'Bold Text',
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      );

      final text = tester.widget<Text>(find.text('Bold Text'));
      expect(text.style?.fontWeight, FontWeight.w700);
    });

    testWidgets('respects textAlign parameter', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: AccessibleText(
              'Centered Text',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );

      final text = tester.widget<Text>(find.text('Centered Text'));
      expect(text.textAlign, TextAlign.center);
    });
  });

  group('TextScalingHelper Tests', () {
    testWidgets('getScaledFontSize returns scaled value', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              final scaled = TextScalingHelper.getScaledFontSize(context, 10.0);
              expect(scaled, greaterThan(0));
              return Text('Scaled: $scaled');
            },
          ),
        ),
      );
    });

    testWidgets('getScaledFontSize clamps at 1.3x', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              final scaled =
                  TextScalingHelper.getScaledFontSize(context, 100.0);
              expect(scaled, lessThanOrEqualTo(130.0));
              return Text('Scaled: $scaled');
            },
          ),
        ),
      );
    });
  });
}
