import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/share/document_share_message.dart';
import 'package:gmp_app_mobilidad/core/share/whatsapp_document_share.dart';
import 'package:gmp_app_mobilidad/core/widgets/whatsapp_form_modal.dart';

void main() {
  test('Spanish 9-digit mobiles get the 34 prefix', () {
    expect(WhatsAppDocumentShare.phoneDigits('600123456'), '34600123456');
    expect(
        WhatsAppDocumentShare.phoneDigits('+34 600 12 34 56'), '34600123456');
  });

  test('numbers that already include the country code stay as digits', () {
    expect(WhatsAppDocumentShare.phoneDigits('34600123456'), '34600123456');
  });

  test('the phone field is prefilled and stays a full number', () {
    expect(WhatsAppFormModal.initialPhone(''), '+34');
    expect(WhatsAppFormModal.initialPhone('612345678'), '+34612345678');
    expect(WhatsAppFormModal.initialPhone('+34 612 345 678'), '+34612345678');
  });

  test('invoice caption greets the client and states only the VAT total', () {
    final morning = DateTime(2026, 10, 8, 10);
    final text = DocumentShareMessage.commercial(
      clientName: 'Panadería López',
      isInvoice: true,
      documentLabel: 'F-15-2296',
      albaranLabel: 'A-15-100',
      date: '2026-10-08',
      totalWithVat: 1234.5,
      now: morning,
    );

    expect(text, startsWith('Buenos días, Panadería López, '));
    expect(
      text,
      contains(
        'le enviamos su factura F-15-2296, correspondiente al albarán A-15-100, emitido el 08/10/2026, por un importe de 1.234,50 €.',
      ),
    );
    expect(text, contains('Granja Mari Pepa'));
    expect(text.toLowerCase(), isNot(contains('iva')));
    expect(text.toLowerCase(), isNot(contains('base')));
  });

  test('greeting follows the time of day', () {
    expect(
      DocumentShareMessage.greeting(now: DateTime(2026, 10, 8, 13)),
      'Buenos días',
    );
    expect(
      DocumentShareMessage.greeting(now: DateTime(2026, 10, 8, 14)),
      'Buenas tardes',
    );
    expect(
      DocumentShareMessage.greeting(now: DateTime(2026, 10, 8, 21)),
      'Buenas noches',
    );
  });

  test('product sheet and an empty caption keep a professional message', () {
    final text = DocumentShareMessage.productSheet(
      clientName: 'Bar Sol',
      productName: 'Jamón ibérico',
      productCode: '12045',
      now: DateTime(2026, 10, 8, 22),
    );
    expect(
      text,
      contains(
        'Buenas noches, Bar Sol, le enviamos la ficha técnica de Jamón ibérico, referencia 12045.',
      ),
    );
    expect(
      DocumentShareMessage.captionOrDefault('  ', text),
      text,
    );
    expect(
      DocumentShareMessage.captionOrDefault('Texto del comercial', text),
      'Texto del comercial',
    );
  });
}
