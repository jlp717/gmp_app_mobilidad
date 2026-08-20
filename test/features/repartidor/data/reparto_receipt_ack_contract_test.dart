import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_receipt_contract.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_modal.dart';

void main() {
  group('RepartoConfirmationAcknowledgement.fromResponse', () {
    test('accepts numeric confirmationId and cobroId', () {
      final ack = RepartoConfirmationAcknowledgement.fromResponse({
        'success': true,
        'confirmationId': 88,
        'cobroId': 91,
      });
      expect(ack.confirmationId, '88');
      expect(ack.cobroId, '91');
    });

    test('accepts string ids and null cobroId', () {
      final ack = RepartoConfirmationAcknowledgement.fromResponse({
        'success': true,
        'confirmationId': '88',
        'cobroId': null,
      });
      expect(ack.confirmationId, '88');
      expect(ack.cobroId, isNull);
    });

    test('rejects missing confirmationId', () {
      expect(
        () => RepartoConfirmationAcknowledgement.fromResponse({
          'success': true,
          'cobroId': '91',
        }),
        throwsA(isA<RepartoReceiptUnavailableException>()),
      );
    });
  });

  group('payment confirmation error presentation', () {
    test('maps INVALID_PAYMENT_AMOUNT to actionable retryable message', () {
      final presentation = repartoConfirmationErrorPresentation(
        error: ApiException(
          'Importe de cobro superior a la entrega real pendiente',
          statusCode: 422,
          code: 'INVALID_PAYMENT_AMOUNT',
        ),
        acknowledged: false,
      );
      expect(presentation.canRetry, isTrue);
      expect(presentation.message, contains('importe cobrado'));
      expect(presentation.message, isNot(contains('no es concluyente')));
    });

    test('maps PAYMENT_DOCUMENT_UNAVAILABLE without inconclusive wording', () {
      final presentation = repartoConfirmationErrorPresentation(
        error: ApiException(
          'El documento financiero de cobro falta o es ambiguo',
          statusCode: 409,
          code: 'PAYMENT_DOCUMENT_UNAVAILABLE',
        ),
        acknowledged: false,
      );
      expect(presentation.canRetry, isTrue);
      expect(presentation.message, contains('saldo cobrable'));
    });
  });

  test('normalizeRepartoServerId coerces integers', () {
    expect(normalizeRepartoServerId(91), '91');
    expect(normalizeRepartoServerId(' 7 '), '7');
    expect(normalizeRepartoServerId(null), isNull);
  });
}
