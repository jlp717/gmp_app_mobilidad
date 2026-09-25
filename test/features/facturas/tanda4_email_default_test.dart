import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/widgets/email_form_modal.dart';

/// REQ-21 tanda4: EmailFormModal acepta defaultEmail DB precargado editable;
/// sin email → campo vacío libre (flujo actual).
void main() {
  Future<void> pumpModal(WidgetTester tester, {String defaultEmail = ''}) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: EmailFormModal(
            defaultEmail: defaultEmail,
            defaultSubject: 'Factura P-15-2296 - Cliente',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('precarga email DB editable', (tester) async {
    await pumpModal(tester, defaultEmail: 'cliente@example.com');
    final field = tester.widget<TextFormField>(
      find.byType(TextFormField).first,
    );
    expect(field.controller?.text, 'cliente@example.com');
  });

  testWidgets('sin email DB → campo vacío libre', (tester) async {
    await pumpModal(tester);
    final field = tester.widget<TextFormField>(
      find.byType(TextFormField).first,
    );
    expect(field.controller?.text ?? '', isEmpty);
  });
}
