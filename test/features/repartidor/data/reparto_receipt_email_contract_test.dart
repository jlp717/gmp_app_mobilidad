import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';

void main() {
  test('requires sender and ledger acknowledgement', () {
    expect(
      RepartoReceiptEmailResult.fromResponse(const {
        'success': true,
        'messageId': 'smtp-1',
        'ledgerWritten': true,
      }).delivered,
      isTrue,
    );
    expect(
      RepartoReceiptEmailResult.fromResponse(const {
        'success': true,
        'messageId': '',
        'ledgerWritten': true,
      }).delivered,
      isFalse,
    );
    expect(isValidRepartoReceiptEmailAddress('driver@gmp.es'), isTrue);
  });
}
