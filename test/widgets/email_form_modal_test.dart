import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/email_form_modal.dart';

void main() {
  group('EmailFormModal Tests', () {
    testWidgets('displays header title', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () => EmailFormModal.show(context),
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Enviar por Email'), findsOneWidget);
    });

    testWidgets('has email, subject and body fields', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () => EmailFormModal.show(context),
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.byType(TextFormField), findsNWidgets(3));
    });

    testWidgets('shows validation error for empty email', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () => EmailFormModal.show(context),
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();

      expect(find.text('El email es obligatorio'), findsOneWidget);
    });

    testWidgets('shows validation error for invalid email format',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () => EmailFormModal.show(context),
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextFormField).first, 'invalid-email');
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();

      expect(find.text('Email inválido'), findsOneWidget);
    });

    testWidgets('accepts valid email format', (tester) async {
      String? resultEmail;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () async {
                    final result = await EmailFormModal.show(context);
                    resultEmail = result?.email;
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

      await tester.enterText(
          find.byType(TextFormField).first, 'test@example.com');
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();

      expect(resultEmail, 'test@example.com');
    });

    testWidgets('prefills subject and body when provided', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () => EmailFormModal.show(
                    context,
                    defaultSubject: 'Invoice Test',
                    defaultBody: 'Please find attached',
                  ),
                  child: const Text('Open'),
                );
              },
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      final textFields =
          tester.widgetList<TextFormField>(find.byType(TextFormField));
      expect(textFields.elementAt(1).controller?.text, 'Invoice Test');
      expect(textFields.elementAt(2).controller?.text, 'Please find attached');
    });

    testWidgets('cancel button closes modal', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () async {
                    final result = await EmailFormModal.show(context);
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

    testWidgets('close icon closes modal', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () async {
                    final result = await EmailFormModal.show(context);
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

      await tester.tap(find.byIcon(Icons.close));
      await tester.pumpAndSettle();
    });
  });

  group('EmailFormResult Tests', () {
    test('creates result with email, subject and body', () {
      const result = EmailFormResult(
        email: 'test@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      );

      expect(result.email, 'test@example.com');
      expect(result.subject, 'Test Subject');
      expect(result.body, 'Test Body');
    });
  });
}
