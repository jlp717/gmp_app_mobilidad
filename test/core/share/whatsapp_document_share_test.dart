import 'package:flutter_test/flutter_test.dart';
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
}
