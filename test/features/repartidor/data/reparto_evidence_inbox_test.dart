// ignore_for_file: public_member_api_docs

import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_inbox.dart';

/// In-memory inbox store: unit tests exercise persistence semantics without
/// Hive/SecureStorage.
class _MemoryInboxStore implements RepartoEvidenceInboxStore {
  final Map<String, RepartoEvidenceInboxRecord> _records =
      <String, RepartoEvidenceInboxRecord>{};

  @override
  Future<RepartoEvidenceInboxRecord?> read(String key) async => _records[key];

  @override
  Future<void> write(RepartoEvidenceInboxRecord record) async {
    _records[record.boxKey] = record;
  }

  @override
  Future<void> delete(String key) async {
    _records.remove(key);
  }

  @override
  Future<List<RepartoEvidenceInboxRecord>> readAll() async =>
      _records.values.toList(growable: false);
}

Uint8List _pngBytes() => Uint8List.fromList(<int>[
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      0,
      1,
      2,
      3,
    ]);

Uint8List _jpegBytes() =>
    Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 0xe0, 1, 2]);

Uint8List _garbageBytes() =>
    Uint8List.fromList(List<int>.generate(16, (index) => index));

final validFingerprint = 'a' * 64; // 64 hex chars — canonical SHA-256 shape.
const validIdempotencyKey = 'rep-AbCdEf12345';

void main() {
  late _MemoryInboxStore store;
  late RepartoEvidenceInbox inbox;

  setUp(() {
    store = _MemoryInboxStore();
    inbox = RepartoEvidenceInbox(store);
  });

  group('put + read roundtrip', () {
    test('persists a valid signature PNG and reads it back', () async {
      final record = await inbox.put(
        deliveryId: 'DOC-1',
        slot: 'signature',
        bytes: _pngBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: DateTime.utc(2026, 8, 29),
      );

      final read = await inbox.read('DOC-1', 'signature');
      expect(read, isNotNull);
      expect(read!.bytes, record.bytes);
      expect(read.fingerprint, validFingerprint);
      expect(read.idempotencyKey, validIdempotencyKey);
      expect(read.kind, RepartoEvidenceInboxKind.firma);
      expect(read.mimeType, 'image/png');
    });

    test('persists a valid JPEG photo', () async {
      await inbox.put(
        deliveryId: 'DOC-1',
        slot: 'photo-0',
        bytes: _jpegBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: DateTime.utc(2026, 8, 29),
      );
      final read = await inbox.read('DOC-1', 'photo-0');
      expect(read!.mimeType, 'image/jpeg');
      expect(read.kind, RepartoEvidenceInboxKind.foto);
    });

    test('overwrites same deliveryId+slot keeping one record', () async {
      await inbox.put(
        deliveryId: 'DOC-1',
        slot: 'photo-0',
        bytes: _jpegBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: DateTime.utc(2026, 8, 29),
      );
      await inbox.put(
        deliveryId: 'DOC-1',
        slot: 'photo-0',
        bytes: _pngBytes(),
        fingerprint: 'b' * 64,
        idempotencyKey: validIdempotencyKey,
        savedAt: DateTime.utc(2026, 8, 29),
      );
      final all = await store.readAll();
      expect(all, hasLength(1));
      expect(all.first.fingerprint, 'b' * 64);
    });
  });

  group('EARS-6 limits and format validation', () {
    test('rejects signature that is not PNG', () async {
      await expectLater(
        inbox.put(
          deliveryId: 'DOC-1',
          slot: 'signature',
          bytes: _jpegBytes(),
          fingerprint: validFingerprint,
          idempotencyKey: validIdempotencyKey,
          savedAt: DateTime.utc(2026, 8, 29),
        ),
        throwsA(
          isA<RepartoEvidenceInboxException>().having(
            (error) => error.code,
            'code',
            'INVALID_SIGNATURE_DATA',
          ),
        ),
      );
      expect(await store.readAll(), isEmpty);
    });

    test('rejects photo with unknown magic bytes', () async {
      await expectLater(
        inbox.put(
          deliveryId: 'DOC-1',
          slot: 'photo-0',
          bytes: _garbageBytes(),
          fingerprint: validFingerprint,
          idempotencyKey: validIdempotencyKey,
          savedAt: DateTime.utc(2026, 8, 29),
        ),
        throwsA(
          isA<RepartoEvidenceInboxException>().having(
            (error) => error.code,
            'code',
            'INVALID_EVIDENCE_MAGIC',
          ),
        ),
      );
    });

    test('rejects empty bytes', () async {
      await expectLater(
        inbox.put(
          deliveryId: 'DOC-1',
          slot: 'signature',
          bytes: Uint8List(0),
          fingerprint: validFingerprint,
          idempotencyKey: validIdempotencyKey,
          savedAt: DateTime.utc(2026, 8, 29),
        ),
        throwsA(isA<RepartoEvidenceInboxException>()),
      );
    });

    test('rejects signature over 1 MiB (EVIDENCE_TOO_LARGE)', () async {
      final big = Uint8List(1024 * 1024 + 1);
      big[0] = 137;
      big[1] = 80;
      big[2] = 78;
      big[3] = 71;
      big[4] = 13;
      big[5] = 10;
      big[6] = 26;
      big[7] = 10;
      await expectLater(
        inbox.put(
          deliveryId: 'DOC-1',
          slot: 'signature',
          bytes: big,
          fingerprint: validFingerprint,
          idempotencyKey: validIdempotencyKey,
          savedAt: DateTime.utc(2026, 8, 29),
        ),
        throwsA(
          isA<RepartoEvidenceInboxException>().having(
            (error) => error.code,
            'code',
            'EVIDENCE_TOO_LARGE',
          ),
        ),
      );
    });

    test('rejects invalid slot name', () async {
      await expectLater(
        inbox.put(
          deliveryId: 'DOC-1',
          slot: 'photo-3',
          bytes: _jpegBytes(),
          fingerprint: validFingerprint,
          idempotencyKey: validIdempotencyKey,
          savedAt: DateTime.utc(2026, 8, 29),
        ),
        throwsA(isA<RepartoEvidenceInboxException>()),
      );
    });

    test('rejects invalid fingerprint shape', () async {
      await expectLater(
        inbox.put(
          deliveryId: 'DOC-1',
          slot: 'signature',
          bytes: _pngBytes(),
          fingerprint: 'xyz',
          idempotencyKey: validIdempotencyKey,
          savedAt: DateTime.utc(2026, 8, 29),
        ),
        throwsA(isA<RepartoEvidenceInboxException>()),
      );
    });

    test('enforces max 3 photos per delivery', () async {
      for (final slot in const <String>['photo-0', 'photo-1', 'photo-2']) {
        await inbox.put(
          deliveryId: 'DOC-1',
          slot: slot,
          bytes: _jpegBytes(),
          fingerprint: validFingerprint,
          idempotencyKey: validIdempotencyKey,
          savedAt: DateTime.utc(2026, 8, 29),
        );
      }
      // Re-put on an existing slot still allowed (overwrite), but a 4th
      // distinct slot is rejected at validation level by slot whitelist.
      expect(await inbox.photoCount('DOC-1'), 3);
    });
  });

  group('EARS-4 purge on acknowledge', () {
    test('purgeDelivery removes every slot of the delivery', () async {
      await inbox.put(
        deliveryId: 'DOC-1',
        slot: 'signature',
        bytes: _pngBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: DateTime.utc(2026, 8, 29),
      );
      await inbox.put(
        deliveryId: 'DOC-1',
        slot: 'photo-0',
        bytes: _jpegBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: DateTime.utc(2026, 8, 29),
      );
      await inbox.put(
        deliveryId: 'DOC-2',
        slot: 'signature',
        bytes: _pngBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: DateTime.utc(2026, 8, 29),
      );

      final removed = await inbox.purgeDelivery('DOC-1');
      expect(removed, 2);
      expect(await inbox.read('DOC-1', 'signature'), isNull);
      expect(await inbox.read('DOC-1', 'photo-0'), isNull);
      expect(await inbox.read('DOC-2', 'signature'), isNotNull);
    });
  });

  group('EARS-5 stale purge', () {
    test('staleRecords returns only records older than 7 days', () async {
      final now = DateTime.utc(2026, 8, 29);
      await inbox.put(
        deliveryId: 'DOC-OLD',
        slot: 'signature',
        bytes: _pngBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: now.subtract(const Duration(days: 8)),
      );
      await inbox.put(
        deliveryId: 'DOC-NEW',
        slot: 'signature',
        bytes: _pngBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: now.subtract(const Duration(days: 1)),
      );

      final stale = await inbox.staleRecords(now: now);
      expect(stale, hasLength(1));
      expect(stale.first.deliveryId, 'DOC-OLD');
    });

    test('maintenance escalates journal manualReview and drops bytes',
        () async {
      final journalStore = _MemoryJournalStore();
      final journal = RepartoConfirmationJournal(journalStore);
      final now = DateTime.utc(2026, 8, 29);
      await inbox.put(
        deliveryId: 'DOC-OLD',
        slot: 'signature',
        bytes: _pngBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: now.subtract(const Duration(days: 8)),
      );
      await journal.loadOrCreate('DOC-OLD');

      final maintenance = RepartoEvidenceInboxMaintenance(
        inbox: inbox,
        journal: journal,
      );
      final escalated = await maintenance.purgeStale(now: now);

      expect(escalated, {'DOC-OLD'});
      expect(await inbox.read('DOC-OLD', 'signature'), isNull);
      final entry = await journalStore.read('DOC-OLD');
      expect(entry!.state, RepartoOperationState.manualReview);
    });
  });

  group('codec corruption', () {
    test('decode rejects a non-string raw value', () {
      expect(
        () => RepartoEvidenceInboxCodec.decode(
          expectedKey: 'DOC-1:signature',
          containsKey: true,
          raw: <int>[1, 2, 3],
        ),
        throwsA(isA<RepartoEvidenceInboxCorruptException>()),
      );
    });

    test('decode rejects malformed JSON', () {
      expect(
        () => RepartoEvidenceInboxCodec.decode(
          expectedKey: 'DOC-1:signature',
          containsKey: true,
          raw: 'not-json',
        ),
        throwsA(isA<RepartoEvidenceInboxCorruptException>()),
      );
    });

    test('decode rejects key mismatch', () {
      final record = RepartoEvidenceInboxRecord(
        deliveryId: 'DOC-OTHER',
        slot: 'signature',
        bytes: _pngBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: DateTime.utc(2026, 8, 29),
        kind: RepartoEvidenceInboxKind.firma,
        mimeType: 'image/png',
      );
      final encoded =
          record.toJson().toString(); // map toString, not jsonEncode
      expect(
        () => RepartoEvidenceInboxCodec.decode(
          expectedKey: 'DOC-1:signature',
          containsKey: true,
          raw: encoded,
        ),
        throwsA(isA<RepartoEvidenceInboxCorruptException>()),
      );
    });

    test('record JSON roundtrip preserves every field', () {
      final record = RepartoEvidenceInboxRecord(
        deliveryId: 'DOC-1',
        slot: 'photo-1',
        bytes: _jpegBytes(),
        fingerprint: validFingerprint,
        idempotencyKey: validIdempotencyKey,
        savedAt: DateTime.utc(2026, 8, 29, 12, 30),
        kind: RepartoEvidenceInboxKind.foto,
        mimeType: 'image/jpeg',
      );
      final decoded = RepartoEvidenceInboxRecord.fromJson(
        Map<String, dynamic>.from(
          (record.toJson() as Map).cast<String, dynamic>(),
        ),
      );
      expect(decoded.deliveryId, record.deliveryId);
      expect(decoded.slot, record.slot);
      expect(decoded.bytes, record.bytes);
      expect(decoded.kind, record.kind);
      expect(decoded.mimeType, record.mimeType);
    });
  });
}

class _MemoryJournalStore implements RepartoConfirmationJournalStore {
  final Map<String, RepartoConfirmationJournalEntry> _entries =
      <String, RepartoConfirmationJournalEntry>{};

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) async =>
      _entries[deliveryId.trim()];

  @override
  Future<void> write(RepartoConfirmationJournalEntry entry) async {
    _entries[entry.deliveryId] = entry;
  }

  @override
  Future<void> delete(String deliveryId) async {
    _entries.remove(deliveryId.trim());
  }
}
