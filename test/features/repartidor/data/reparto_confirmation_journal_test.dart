import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';

const _signatureId =
    'ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _evidenceFingerprint =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

RepartoConfirmationRequest _request({String? observations}) =>
    RepartoConfirmationRequest(
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
      observaciones: observations,
    );

void main() {
  test('restart replays the same confirmation key and occurrence time',
      () async {
    final store = _RecordingJournalStore();
    final firstJournal = RepartoConfirmationJournal(
      store,
      keyGenerator: () => 'evidence-key-first',
    );
    final firstOperation = RepartoPersistentConfirmationOperation(
      firstJournal,
      keyGenerator: () => 'confirmation-key-first',
      clock: () => DateTime.utc(2026, 8, 3, 12),
    );

    final first = await firstOperation.prepare(_request());
    await firstOperation.markSubmitting('delivery-1');

    final restartedJournal = RepartoConfirmationJournal(
      store,
      keyGenerator: () => 'evidence-key-after-restart',
    );
    final restartedOperation = RepartoPersistentConfirmationOperation(
      restartedJournal,
      keyGenerator: () => 'confirmation-key-after-restart',
      clock: () => DateTime.utc(2026, 8, 4),
    );
    final replay = await restartedOperation.prepare(_request());

    expect(replay.isRetry, isTrue);
    expect(replay.idempotencyKey, first.idempotencyKey);
    final replayDelivery = replay.toJson()['delivery'] as Map<String, dynamic>;
    final firstDelivery = first.toJson()['delivery'] as Map<String, dynamic>;
    expect(
      replayDelivery['occurredAt'],
      firstDelivery['occurredAt'],
    );
    expect(
      store.writes.map((entry) => entry.state),
      contains(RepartoOperationState.manualReview),
    );
  });

  test('uploaded evidence survives restart and is deduplicated by fingerprint',
      () async {
    final store = _RecordingJournalStore();
    final firstJournal = RepartoConfirmationJournal(
      store,
      keyGenerator: () => 'evidence-key-first',
    );
    final reserved = await firstJournal.reserveEvidence(
      deliveryId: 'delivery-1',
      slot: 'signature',
      fingerprint: _evidenceFingerprint,
    );
    await firstJournal.markEvidenceUploaded(
      deliveryId: 'delivery-1',
      slot: 'signature',
      evidenceId: _signatureId,
    );

    final restartedJournal = RepartoConfirmationJournal(
      store,
      keyGenerator: () => 'evidence-key-after-restart',
    );
    final replay = await restartedJournal.reserveEvidence(
      deliveryId: 'delivery-1',
      slot: 'signature',
      fingerprint: _evidenceFingerprint,
    );

    expect(replay.idempotencyKey, reserved.idempotencyKey);
    expect(replay.evidenceId, _signatureId);
  });

  test('material conflict is preserved for manual review', () async {
    final store = _RecordingJournalStore();
    final journal = RepartoConfirmationJournal(store);
    final operation = RepartoPersistentConfirmationOperation(
      journal,
      keyGenerator: () => 'confirmation-key-first',
    );
    await operation.prepare(_request());

    await expectLater(
      operation.prepare(_request(observations: 'material change')),
      throwsA(isA<RepartoConfirmationConflictException>()),
    );
    expect(
      (await store.read('delivery-1'))?.state,
      RepartoOperationState.manualReview,
    );
  });

  test('acknowledgement persists a terminal metadata-only tombstone', () async {
    final store = _RecordingJournalStore();
    final journal = RepartoConfirmationJournal(store);
    final operation = RepartoPersistentConfirmationOperation(
      journal,
      keyGenerator: () => 'confirmation-key-first',
    );
    final prepared = await operation.prepare(_request());
    await operation.markSubmitting('delivery-1');
    expect(await store.read('delivery-1'), isNotNull);

    await operation.acknowledge(
      'delivery-1',
      prepared,
      confirmationId: '81',
    );

    final tombstone = await store.read('delivery-1');
    expect(store.deleted, isEmpty);
    expect(tombstone?.state, RepartoOperationState.acknowledged);
    expect(tombstone?.evidences, isEmpty);
    expect(tombstone?.confirmationIdempotencyKey, 'confirmation-key-first');
    expect(tombstone?.confirmationFingerprint, isNotEmpty);
    expect(tombstone?.occurredAt, isNotNull);
  });

  test('journal serializes metadata only, without PII or image payloads',
      () async {
    final entry = RepartoConfirmationJournalEntry(
      deliveryId: 'delivery-1',
      state: RepartoOperationState.ready,
      evidences: const <String, RepartoEvidenceJournalRecord>{
        'signature': RepartoEvidenceJournalRecord(
          fingerprint: _evidenceFingerprint,
          idempotencyKey: 'evidence-key-first',
          evidenceId: _signatureId,
        ),
      },
      confirmationFingerprint: 'request-fingerprint',
      confirmationIdempotencyKey: 'confirmation-key-first',
      occurredAt: DateTime.utc(2026, 8, 3, 12),
    );

    final encoded = jsonEncode(entry.toJson());

    expect(encoded, isNot(contains('12345678Z')));
    expect(encoded, isNot(contains('Ana')));
    expect(encoded, isNot(contains('base64')));
    expect(encoded, isNot(contains('data:image')));
  });
}

class _RecordingJournalStore implements RepartoConfirmationJournalStore {
  final Map<String, RepartoConfirmationJournalEntry> entries =
      <String, RepartoConfirmationJournalEntry>{};
  final List<RepartoConfirmationJournalEntry> writes =
      <RepartoConfirmationJournalEntry>[];
  final List<String> deleted = <String>[];

  @override
  Future<void> delete(String deliveryId) async {
    deleted.add(deliveryId);
    entries.remove(deliveryId);
  }

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) async =>
      entries[deliveryId];

  @override
  Future<void> write(RepartoConfirmationJournalEntry entry) async {
    writes.add(entry);
    entries[entry.deliveryId] = entry;
  }
}
