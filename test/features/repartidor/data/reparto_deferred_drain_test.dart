// ignore_for_file: public_member_api_docs

import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_offline.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_inbox.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_upload_service.dart';
import 'package:image_picker/image_picker.dart';

const signatureFingerprint =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const photoFingerprint =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const signatureKey = 'rep-SigKey000001';
const photoKey = 'rep-PhotoKey00001';
final signatureEvidenceId = 'ev_${'c' * 64}';
final photoEvidenceId = 'ev_${'d' * 64}';

Uint8List _png() => Uint8List.fromList(<int>[
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      1,
      2,
      3,
      4,
    ]);
Uint8List _jpeg() => Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 0, 1, 2]);

class _MemoryInboxStore implements RepartoEvidenceInboxStore {
  final Map<String, RepartoEvidenceInboxRecord> records =
      <String, RepartoEvidenceInboxRecord>{};

  @override
  Future<RepartoEvidenceInboxRecord?> read(String key) async => records[key];

  @override
  Future<void> write(RepartoEvidenceInboxRecord record) async {
    records[record.boxKey] = record;
  }

  @override
  Future<void> delete(String key) async {
    records.remove(key);
  }

  @override
  Future<List<RepartoEvidenceInboxRecord>> readAll() async =>
      records.values.toList(growable: false);
}

class _MemoryJournalStore implements RepartoConfirmationJournalStore {
  final Map<String, RepartoConfirmationJournalEntry> entries =
      <String, RepartoConfirmationJournalEntry>{};

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) async =>
      entries[deliveryId.trim()];

  @override
  Future<void> write(RepartoConfirmationJournalEntry entry) async {
    entries[entry.deliveryId] = entry;
  }

  @override
  Future<void> delete(String deliveryId) async {
    entries.remove(deliveryId.trim());
  }
}

/// Records every upload attempt; fails N first calls of a kind to simulate
/// intermittent connectivity during the drain.
class _FlakyUploader implements RepartoEvidenceUploader {
  final List<String> signatureKeys = <String>[];
  final List<String> photoKeys = <String>[];
  int signatureFailuresLeft;
  int photoFailuresLeft;

  _FlakyUploader({this.signatureFailuresLeft = 0, this.photoFailuresLeft = 0});

  @override
  Future<String> uploadSignature({
    required String entregaId,
    required Uint8List pngBytes,
    required String idempotencyKey,
    String? repartidorId,
  }) async {
    if (signatureFailuresLeft > 0) {
      signatureFailuresLeft--;
      throw const RepartoEvidenceUploadException(
        'red intermitente',
        code: 'EVIDENCE_UPLOAD_FAILED',
        statusCode: 0,
      );
    }
    signatureKeys.add(idempotencyKey);
    return signatureEvidenceId;
  }

  @override
  Future<String> uploadPhoto({
    required String entregaId,
    required XFile photo,
    required String idempotencyKey,
    String? repartidorId,
  }) async {
    if (photoFailuresLeft > 0) {
      photoFailuresLeft--;
      throw const RepartoEvidenceUploadException(
        'red intermitente',
        code: 'EVIDENCE_UPLOAD_FAILED',
        statusCode: 0,
      );
    }
    photoKeys.add(idempotencyKey);
    return photoEvidenceId;
  }
}

Future<
    (
      _MemoryInboxStore,
      _MemoryJournalStore,
      RepartoConfirmationJournal,
      RepartoEvidenceInbox,
    )> _seededStores() async {
  final inboxStore = _MemoryInboxStore();
  final journalStore = _MemoryJournalStore();
  final journal = RepartoConfirmationJournal(journalStore);
  final inbox = RepartoEvidenceInbox(inboxStore);

  // Simulate an offline capture: journal slots reserved + bytes persisted.
  final now = DateTime.utc(2026, 8, 29, 12);
  await inbox.put(
    deliveryId: 'DOC-1',
    slot: 'signature',
    bytes: _png(),
    fingerprint: signatureFingerprint,
    idempotencyKey: signatureKey,
    savedAt: now,
  );
  await inbox.put(
    deliveryId: 'DOC-1',
    slot: 'photo-0',
    bytes: _jpeg(),
    fingerprint: photoFingerprint,
    idempotencyKey: photoKey,
    savedAt: now,
  );

  // Journal entry mirrors the coordinator's reservation flow.
  final entry = await journal.loadOrCreate('DOC-1');
  await journalStore.write(
    entry.copyWith(
      state: RepartoOperationState.ready,
      confirmationFingerprint: 'f' * 64,
      confirmationIdempotencyKey: 'rep-ConfirmKey1',
      occurredAt: now,
      evidences: <String, RepartoEvidenceJournalRecord>{
        'signature': RepartoEvidenceJournalRecord(
          fingerprint: signatureFingerprint,
          idempotencyKey: signatureKey,
        ),
        'photo-0': RepartoEvidenceJournalRecord(
          fingerprint: photoFingerprint,
          idempotencyKey: photoKey,
        ),
      },
    ),
  );
  return (inboxStore, journalStore, journal, inbox);
}

Map<String, dynamic> _pendingBlock() => <String, dynamic>{
      'firma': <String, dynamic>{
        'slot': 'signature',
        'fingerprint': signatureFingerprint,
        'idempotencyKey': signatureKey,
      },
      'fotos': <dynamic>[
        <String, dynamic>{
          'slot': 'photo-0',
          'fingerprint': photoFingerprint,
          'idempotencyKey': photoKey,
        },
      ],
    };

void main() {
  test('EARS-2: drain resolves signature and photos with original keys',
      () async {
    final stores = await _seededStores();
    final uploader = _FlakyUploader();
    final resolver = buildConfirmEvidenceResolver(
      uploader: uploader,
      journalStore: stores.$2,
      inboxStore: stores.$1,
    );

    final resolved = await resolver(
      deliveryId: 'DOC-1',
      pendingEvidence: _pendingBlock(),
    );

    expect(resolved['signature'], signatureEvidenceId);
    expect(resolved['photo-0'], photoEvidenceId);
    // Original slot keys, not new ones.
    expect(uploader.signatureKeys, <String>[signatureKey]);
    expect(uploader.photoKeys, <String>[photoKey]);
  });

  test('EARS-3: a retried drain never re-uploads resolved slots', () async {
    final stores = await _seededStores();
    final uploader = _FlakyUploader(photoFailuresLeft: 1);
    final resolver = buildConfirmEvidenceResolver(
      uploader: uploader,
      journalStore: stores.$2,
      inboxStore: stores.$1,
    );

    // First drain attempt: photo upload fails (intermittent signal).
    await expectLater(
      resolver(deliveryId: 'DOC-1', pendingEvidence: _pendingBlock()),
      throwsA(isA<RepartoEvidenceUploadException>()),
    );
    // Signature got resolved and persisted in the journal...
    expect(uploader.signatureKeys, hasLength(1));

    // Second drain attempt: photo retry succeeds, signature NOT re-uploaded.
    final resolved = await resolver(
      deliveryId: 'DOC-1',
      pendingEvidence: _pendingBlock(),
    );
    expect(resolved['signature'], signatureEvidenceId);
    expect(resolved['photo-0'], photoEvidenceId);
    expect(uploader.signatureKeys, hasLength(1)); // no re-upload
    expect(uploader.photoKeys, hasLength(1)); // single successful retry
  });

  test('mismatched reference vs journal escalates manualReview (EARS-7)',
      () async {
    final stores = await _seededStores();
    final resolver = buildConfirmEvidenceResolver(
      uploader: _FlakyUploader(),
      journalStore: stores.$2,
      inboxStore: stores.$1,
    );

    final tampered = _pendingBlock();
    (tampered['firma'] as Map)['fingerprint'] = '0' * 64;

    await expectLater(
      resolver(deliveryId: 'DOC-1', pendingEvidence: tampered),
      throwsA(isA<StateError>()),
    );
    final entry = await stores.$2.read('DOC-1');
    expect(entry!.state, RepartoOperationState.manualReview);
  });

  test('missing inbox bytes escalates manualReview (fail-closed)', () async {
    final stores = await _seededStores();
    // Bytes wiped (e.g. disk cleanup) but journal still has the reservation.
    await stores.$1.delete('DOC-1:signature');
    final resolver = buildConfirmEvidenceResolver(
      uploader: _FlakyUploader(),
      journalStore: stores.$2,
      inboxStore: stores.$1,
    );

    await expectLater(
      resolver(deliveryId: 'DOC-1', pendingEvidence: _pendingBlock()),
      throwsA(isA<StateError>()),
    );
    final entry = await stores.$2.read('DOC-1');
    expect(entry!.state, RepartoOperationState.manualReview);
  });
}
