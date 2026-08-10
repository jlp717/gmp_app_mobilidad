import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';

const _signatureId =
    'ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

RepartoConfirmationRequest _request() => RepartoConfirmationRequest(
      itemId: 'delivery-1',
      status: RepartoDeliveryStatus.entregado,
      occurredAt: DateTime.utc(2026, 8, 3, 10),
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
  test('invalid persisted JSON state is rejected before recovery', () {
    expect(
      () => RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{
        'version': 1,
        'deliveryId': 'delivery-1',
        'state': 'unknown-state',
        'evidences': <String, dynamic>{},
      }),
      throwsFormatException,
    );
    expect(
      () => RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{}),
      throwsFormatException,
    );
  });

  test('corrupt journal fails closed without generating a replacement key',
      () async {
    var generatedKeys = 0;
    final operation = RepartoPersistentConfirmationOperation(
      RepartoConfirmationJournal(_CorruptJournalStore()),
      keyGenerator: () => 'confirmation-key-${++generatedKeys}',
    );

    await expectLater(
      operation.prepare(_request()),
      throwsA(isA<RepartoJournalCorruptionException>()),
    );
    expect(generatedKeys, 0);
  });

  test('acknowledged tombstone remains terminal across restart', () async {
    final store = _DeleteFailingJournalStore();
    final first = RepartoPersistentConfirmationOperation(
      RepartoConfirmationJournal(store),
      keyGenerator: () => 'confirmation-key-first',
    );
    final prepared = await first.prepare(_request());
    await first.markSubmitting('delivery-1');
    await first.acknowledge(
      'delivery-1',
      prepared,
      confirmationId: '81',
    );

    expect(store.entry?.state, RepartoOperationState.acknowledged);
    expect(store.entry?.evidences, isEmpty);
    expect(store.deleteCalls, 0);

    var restartedKeys = 0;
    final restarted = RepartoPersistentConfirmationOperation(
      RepartoConfirmationJournal(store),
      keyGenerator: () => 'replacement-key-${++restartedKeys}',
    );
    await expectLater(
      restarted.prepare(_request()),
      throwsA(isA<RepartoAlreadyAcknowledgedException>()),
    );
    expect(restartedKeys, 0);
    expect(store.entry?.state, RepartoOperationState.acknowledged);
  });

  test('existing non-string Hive value is typed corruption', () {
    expect(
      () => RepartoConfirmationJournalCodec.decode(
        requestedDeliveryId: 'delivery-1',
        containsKey: true,
        raw: 7,
      ),
      throwsA(isA<RepartoJournalCorruptionException>()),
    );
    expect(
      RepartoConfirmationJournalCodec.decode(
        requestedDeliveryId: 'delivery-1',
        containsKey: false,
        raw: null,
      ),
      isNull,
    );
  });

  test('empty and mismatched delivery IDs fail closed', () {
    expect(
      () => RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{
        'version': 1,
        'deliveryId': '',
        'state': 'draft',
        'evidences': <String, dynamic>{},
      }),
      throwsFormatException,
    );
    expect(
      () => RepartoConfirmationJournalCodec.decode(
        requestedDeliveryId: 'delivery-1',
        containsKey: true,
        raw: '{"version":1,"deliveryId":"delivery-2",'
            '"state":"draft","evidences":{}}',
      ),
      throwsA(isA<RepartoJournalCorruptionException>()),
    );
  });

  test('invalid evidences container fails closed', () {
    expect(
      () => RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{
        'version': 1,
        'deliveryId': 'delivery-1',
        'state': 'draft',
        'evidences': <String>['not-a-map'],
      }),
      throwsFormatException,
    );
  });

  test('evidence fingerprint must be a canonical SHA-256 hash', () {
    expect(
      () => RepartoEvidenceJournalRecord.fromJson(<String, dynamic>{
        'fingerprint': 'not-a-hash',
        'idempotencyKey': 'evidence-key-first',
      }),
      throwsFormatException,
    );
  });

  test('completed evidence in an arbitrary decoded slot is corruption', () {
    expect(
      () => RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{
        'version': 1,
        'deliveryId': 'delivery-1',
        'state': 'uploading',
        'evidences': <String, dynamic>{
          'photo-3': <String, dynamic>{
            'fingerprint':
                'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            'idempotencyKey': 'evidence-key-first',
            'evidenceId': _signatureId,
          },
        },
      }),
      throwsFormatException,
    );
  });

  test('arbitrary evidence slot is rejected before journal mutation', () async {
    var generatedKeys = 0;
    final store = _DeleteFailingJournalStore();
    final journal = RepartoConfirmationJournal(
      store,
      keyGenerator: () => 'evidence-key-${++generatedKeys}',
    );

    await expectLater(
      journal.reserveEvidence(
        deliveryId: 'delivery-1',
        slot: 'receipt',
        fingerprint:
            'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      ),
      throwsFormatException,
    );
    expect(generatedKeys, 0);
    expect(store.entry, isNull);
  });

  for (final state in <String>['ready', 'submitting']) {
    test('$state without confirmation identity fails closed', () {
      expect(
        () => RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{
          'version': 1,
          'deliveryId': 'delivery-1',
          'state': state,
          'evidences': <String, dynamic>{},
        }),
        throwsFormatException,
      );
    });
  }

  test('numeric fingerprint and key are rejected as format corruption', () {
    for (final invalidIdentity in <Map<String, Object>>[
      <String, Object>{'confirmationFingerprint': 7},
      <String, Object>{'confirmationIdempotencyKey': 9},
    ]) {
      expect(
        () => RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{
          'version': 1,
          'deliveryId': 'delivery-1',
          'state': 'ready',
          'evidences': <String, dynamic>{},
          ...invalidIdentity,
        }),
        throwsFormatException,
      );
    }
  });

  test('confirmation identity metadata must be complete in active states', () {
    expect(
      () => RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{
        'version': 1,
        'deliveryId': 'delivery-1',
        'state': 'submitting',
        'evidences': <String, dynamic>{},
        'confirmationFingerprint':
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'confirmationIdempotencyKey': 'confirmation-key-first',
      }),
      throwsFormatException,
    );
    expect(
      RepartoConfirmationJournalEntry.fromJson(<String, dynamic>{
        'version': 1,
        'deliveryId': 'delivery-1',
        'state': 'manualReview',
        'evidences': <String, dynamic>{},
      }).state,
      RepartoOperationState.manualReview,
    );
  });

  test('canonical already-confirmed conflict reconciles to ACK tombstone',
      () async {
    final store = _DeleteFailingJournalStore();
    final operation = RepartoPersistentConfirmationOperation(
      RepartoConfirmationJournal(store),
      keyGenerator: () => 'confirmation-key-first',
    );
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
    expect(store.entry?.confirmationIdempotencyKey, prepared.idempotencyKey);

    final restarted = RepartoPersistentConfirmationOperation(
      RepartoConfirmationJournal(store),
      keyGenerator: () => 'must-not-be-used',
    );
    await expectLater(
      restarted.prepare(_request()),
      throwsA(isA<RepartoAlreadyAcknowledgedException>()),
    );
  });

  for (final statusCode in <int>[500, 422, 200]) {
    test('$statusCode with canonical code cannot ACK', () async {
      final store = _DeleteFailingJournalStore();
      final operation = RepartoPersistentConfirmationOperation(
        RepartoConfirmationJournal(store),
        keyGenerator: () => 'confirmation-key-first',
      );
      final prepared = await operation.prepare(_request());
      await operation.markSubmitting('delivery-1');

      expect(
        await operation.reconcileConflict(
          deliveryId: 'delivery-1',
          statusCode: statusCode,
          code: 'DELIVERY_ALREADY_CONFIRMED',
          prepared: prepared,
        ),
        isFalse,
      );
      expect(store.entry?.state, RepartoOperationState.manualReview);
      expect(store.entry?.state, isNot(RepartoOperationState.acknowledged));
    });
  }

  test('another 409 enters manual review without ACK', () async {
    final store = _DeleteFailingJournalStore();
    final operation = RepartoPersistentConfirmationOperation(
      RepartoConfirmationJournal(store),
      keyGenerator: () => 'confirmation-key-first',
    );
    final prepared = await operation.prepare(_request());
    await operation.markSubmitting('delivery-1');

    expect(
      await operation.reconcileConflict(
        deliveryId: 'delivery-1',
        statusCode: 409,
        code: 'SOME_OTHER_409',
        prepared: prepared,
      ),
      isFalse,
    );
    expect(store.entry?.state, RepartoOperationState.manualReview);
  });

  test('canonical 409 with mismatched current identity cannot ACK', () async {
    final store = _DeleteFailingJournalStore();
    final operation = RepartoPersistentConfirmationOperation(
      RepartoConfirmationJournal(store),
      keyGenerator: () => 'confirmation-key-first',
    );
    final prepared = await operation.prepare(_request());
    await operation.markSubmitting('delivery-1');
    store.entry = store.entry!.copyWith(
      confirmationFingerprint:
          'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    );

    await expectLater(
      operation.reconcileConflict(
        deliveryId: 'delivery-1',
        statusCode: 409,
        code: 'DELIVERY_ALREADY_CONFIRMED',
        prepared: prepared,
        confirmationId: '81',
      ),
      throwsA(isA<RepartoConfirmationConflictException>()),
    );
    expect(store.entry?.state, RepartoOperationState.manualReview);
  });
}

class _CorruptJournalStore implements RepartoConfirmationJournalStore {
  @override
  Future<void> delete(String deliveryId) async {}

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) =>
      throw const RepartoJournalCorruptionException(
        'El registro local de la operación no es válido.',
      );

  @override
  Future<void> write(RepartoConfirmationJournalEntry entry) async {}
}

class _DeleteFailingJournalStore implements RepartoConfirmationJournalStore {
  RepartoConfirmationJournalEntry? entry;
  int deleteCalls = 0;

  @override
  Future<void> delete(String deliveryId) async {
    deleteCalls++;
    throw StateError('delete must never be called for an ACK tombstone');
  }

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) async =>
      entry;

  @override
  Future<void> write(RepartoConfirmationJournalEntry value) async {
    entry = value;
  }
}
