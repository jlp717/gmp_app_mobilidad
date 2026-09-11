import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/erp_document_label.dart';

void main() {
  test('keeps the terminal segment', () {
    expect(
      formatErpDocumentLabel(serie: 'P', terminal: 15, numero: 2296),
      'P-15-2296',
    );
  });
}
