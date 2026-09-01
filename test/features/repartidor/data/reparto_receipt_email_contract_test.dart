import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
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

  test('delivery-note fallback is limited to a not-found response', () {
    expect(
      RepartidorDataService.isDeliveryNoteNotFound(
        const RepartidorDataException(
          'missing',
          statusCode: 404,
          code: 'REPARTO_RECEIPT_NOT_FOUND',
        ),
      ),
      isTrue,
    );
    expect(
      RepartidorDataService.isDeliveryNoteNotFound(
        ApiException('forbidden', statusCode: 403),
      ),
      isFalse,
    );
    expect(
      RepartidorDataService.isDeliveryNoteNotFound(
        const RepartidorDataException(
          'temporarily unavailable',
          statusCode: 503,
        ),
      ),
      isFalse,
    );
  });

  test('canonical email rejects an invalid confirmation lookup', () async {
    await expectLater(
      RepartidorDataService.emailDeliveryNote(
        confirmationId: 'bad/id',
        destinatario: 'cliente@example.test',
        repartidorId: '08',
      ),
      throwsA(
        isA<RepartidorDataException>().having(
          (error) => error.code,
          'code',
          'REPARTO_RECEIPT_INVALID_LOOKUP',
        ),
      ),
    );
  });
}
