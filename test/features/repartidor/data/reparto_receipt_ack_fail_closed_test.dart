import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';

const _signatureId =
    'ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

RepartoConfirmationRequest _request() => RepartoConfirmationRequest(
      itemId: 'delivery-1',
      status: RepartoDeliveryStatus.entregado,
      occurredAt: DateTime.utc(2026, 8, 9),
      lineas: const <RepartoDeliveryLine>[
        RepartoDeliveryLine(
          lineaId: 'line-1',
          codigoArticulo: 'article-1',
          cantidadPedida: 1,
          cantidadEntregada: 1,
          cantidadRechazada: 0,
          cantidadPendiente: 0,
        ),
      ],
      receiver: const RepartoReceiver(
        nombre: 'Ana',
        apellidos: 'Recibe',
        dni: '12345678Z',
      ),
      firma: _signatureId,
    );

void main() {
  test('malformed success response persists manual review and blocks resend',
      () async {
    final store = _MemoryJournalStore();
    final operation = _operation(store);
    final prepared = await operation.prepare(_request());
    await operation.markSubmitting('delivery-1');

    await expectLater(
      operation.acknowledgeResponse(
        deliveryId: 'delivery-1',
        prepared: prepared,
        response: <String, dynamic>{'success': true},
      ),
      throwsA(isA<RepartoReceiptUnavailableException>()),
    );

    expect(store.entry?.state, RepartoOperationState.manualReview);
    expect(store.entry?.confirmationId, isNull);
    await expectLater(
      _operation(store).prepare(_request()),
      throwsA(isA<RepartoConfirmationConflictException>()),
    );
  });

  test('canonical 409 without ID is manual review, then ID lookup may ACK',
      () async {
    final store = _MemoryJournalStore();
    final operation = _operation(store);
    final prepared = await operation.prepare(_request());
    await operation.markSubmitting('delivery-1');

    expect(
      await operation.reconcileConflict(
        deliveryId: 'delivery-1',
        statusCode: 409,
        code: 'DELIVERY_ALREADY_CONFIRMED',
        prepared: prepared,
      ),
      isFalse,
    );
    expect(store.entry?.state, RepartoOperationState.manualReview);
    expect(store.entry?.confirmationId, isNull);

    expect(
      await operation.reconcileConflict(
        deliveryId: 'delivery-1',
        statusCode: 409,
        code: 'DELIVERY_ALREADY_CONFIRMED',
        prepared: prepared,
        confirmationId: '81',
      ),
      isTrue,
    );
    expect(store.entry?.state, RepartoOperationState.acknowledged);
    expect(store.entry?.confirmationId, '81');
    expect(
      await RepartoConfirmationJournal(store)
          .receiptConfirmationId('delivery-1'),
      '81',
    );
  });

  test('canonical 409 with valid ID creates one terminal tombstone', () async {
    final store = _MemoryJournalStore();
    final operation = _operation(store);
    final prepared = await operation.prepare(_request());
    await operation.markSubmitting('delivery-1');

    expect(
      await operation.reconcileConflict(
        deliveryId: 'delivery-1',
        statusCode: 409,
        code: 'DELIVERY_ALREADY_CONFIRMED',
        prepared: prepared,
        confirmationId: '81',
      ),
      isTrue,
    );
    expect(store.entry?.state, RepartoOperationState.acknowledged);
    expect(store.entry?.confirmationId, '81');
    expect(store.acknowledgedWrites, 1);
  });

  test('v1 ACK without ID migrates to manual review, never draft', () async {
    final migrated = RepartoConfirmationJournalEntry.fromJson(
      <String, dynamic>{
        'version': 1,
        'deliveryId': 'delivery-1',
        'state': 'acknowledged',
        'evidences': <String, dynamic>{},
        'confirmationFingerprint':
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'confirmationIdempotencyKey': 'confirmation-key-1',
        'occurredAt': '2026-08-09T00:00:00.000Z',
      },
    );

    expect(migrated.state, RepartoOperationState.manualReview);
    expect(migrated.state, isNot(RepartoOperationState.draft));
    final store = _MemoryJournalStore()..entry = migrated;
    await expectLater(
      _operation(store).prepare(_request()),
      throwsA(isA<RepartoConfirmationConflictException>()),
    );
  });

  test('v2 acknowledged tombstone without confirmation ID is corruption', () {
    expect(
      () => RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{
        'version': 2,
        'deliveryId': 'delivery-1',
        'state': 'acknowledged',
        'evidences': <String, dynamic>{},
        'confirmationFingerprint':
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'confirmationIdempotencyKey': 'confirmation-key-1',
        'occurredAt': '2026-08-09T00:00:00.000Z',
      }),
      throwsFormatException,
    );
  });
}

RepartoPersistentConfirmationOperation _operation(
  _MemoryJournalStore store,
) =>
    RepartoPersistentConfirmationOperation(
      RepartoConfirmationJournal(store),
      keyGenerator: () => 'confirmation-key-1',
      clock: () => DateTime.utc(2026, 8, 9, 12),
    );

class _MemoryJournalStore implements RepartoConfirmationJournalStore {
  RepartoConfirmationJournalEntry? entry;
  int acknowledgedWrites = 0;

  @override
  Future<void> delete(String deliveryId) async => entry = null;

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) async =>
      entry?.deliveryId == deliveryId ? entry : null;

  @override
  Future<void> write(RepartoConfirmationJournalEntry value) async {
    entry = value;
    if (value.state == RepartoOperationState.acknowledged) {
      acknowledgedWrites++;
    }
  }
}
