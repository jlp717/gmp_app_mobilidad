// ignore_for_file: public_member_api_docs

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_offline.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_inbox.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_upload_service.dart';
import 'package:image_picker/image_picker.dart';

const signatureFingerprint64 =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const photoFingerprint64 =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const evidenceKey = 'rep-OfflineKey12345';

RepartoReceiver _receiver() => RepartoReceiver(
      nombre: 'Juan',
      apellidos: 'Garcia Lopez',
      dni: '12345678Z',
    );

RepartoConfirmationRequest _deliveredRequest({
  bool defer = false,
  List<RepartoPendingEvidenceRef> pending = const <RepartoPendingEvidenceRef>[],
}) =>
    RepartoConfirmationRequest(
      itemId: 'DOC-1',
      status: RepartoDeliveryStatus.entregado,
      occurredAt: DateTime.utc(2026, 8, 29, 10),
      lineas: const <RepartoDeliveryLine>[
        RepartoDeliveryLine(
          lineaId: 'L1',
          codigoArticulo: 'ART-1',
          cantidadPedida: 10,
          cantidadEntregada: 10,
          cantidadRechazada: 0,
          cantidadPendiente: 0,
        ),
      ],
      receiver: _receiver(),
      firma: defer ? null : 'ev_${'c' * 64}',
      evidencias: const <String>[],
      deferEvidence: defer,
      pendingEvidence: pending,
    );

RepartoPendingEvidenceRef _signatureRef() => RepartoPendingEvidenceRef(
      slot: 'signature',
      fingerprint: signatureFingerprint64,
      idempotencyKey: evidenceKey,
    );

void main() {
  group('deferred payload (G5 / spec 5.3)', () {
    test('deferred json carries pendingEvidence and never ev ids', () {
      final payload = _deliveredRequest(
        defer: true,
        pending: <RepartoPendingEvidenceRef>[_signatureRef()],
      ).toDeferredJson();

      final delivery = payload['delivery'] as Map<String, dynamic>;
      expect(delivery['firma'], isNull);
      expect(delivery['pendingEvidence'], isA<Map>());
      final pending = delivery['pendingEvidence'] as Map<String, dynamic>;
      expect(pending['firma'], isA<Map>());
      expect(
        (pending['firma'] as Map)['fingerprint'],
        signatureFingerprint64,
      );
    });

    test('deferred json includes fotos list for photo slots', () {
      final payload = _deliveredRequest(
        defer: true,
        pending: <RepartoPendingEvidenceRef>[
          _signatureRef(),
          RepartoPendingEvidenceRef(
            slot: 'photo-0',
            fingerprint: photoFingerprint64,
            idempotencyKey: evidenceKey,
          ),
        ],
      ).toDeferredJson();

      final pending = (payload['delivery'] as Map)['pendingEvidence'] as Map;
      expect(pending['fotos'], isA<List>());
      expect((pending['fotos'] as List), hasLength(1));
      expect((pending['fotos'] as List).first['slot'], 'photo-0');
    });

    test('validation accepts deferred payload with signature pending', () {
      final request = _deliveredRequest(
        defer: true,
        pending: <RepartoPendingEvidenceRef>[_signatureRef()],
      );
      // No throw = valid.
      request.toDeferredJson();
    });

    test('validation rejects deferred payload without signature ref', () {
      final request = _deliveredRequest(
        defer: true,
        pending: const <RepartoPendingEvidenceRef>[],
      );
      expect(
        () => request.toDeferredJson(),
        throwsA(
          isA<RepartoConfirmationValidationException>().having(
            (error) => error.message,
            'message',
            contains('firma'),
          ),
        ),
      );
    });

    test('fingerprint identical online vs deferred for same material', () {
      final online = _deliveredRequest();
      final deferred = _deliveredRequest(
        defer: true,
        pending: <RepartoPendingEvidenceRef>[_signatureRef()],
      );
      expect(
        RepartoConfirmationOperation.fingerprintFor(online),
        RepartoConfirmationOperation.fingerprintFor(deferred),
      );
    });

    test('fingerprint changes when business material changes', () {
      final base = _deliveredRequest();
      final changed = RepartoConfirmationRequest(
        itemId: 'DOC-1',
        status: RepartoDeliveryStatus.entregado,
        occurredAt: DateTime.utc(2026, 8, 29, 10),
        lineas: const <RepartoDeliveryLine>[
          RepartoDeliveryLine(
            lineaId: 'L1',
            codigoArticulo: 'ART-1',
            cantidadPedida: 9,
            cantidadEntregada: 9,
            cantidadRechazada: 0,
            cantidadPendiente: 0,
          ),
        ],
        receiver: _receiver(),
        firma: 'ev_${'c' * 64}',
      );
      expect(
        RepartoConfirmationOperation.fingerprintFor(base),
        isNot(
          RepartoConfirmationOperation.fingerprintFor(changed),
        ),
      );
    });

    test('prepared toJson picks deferred wire format automatically', () {
      final operation = RepartoConfirmationOperation(
        keyGenerator: () => 'rep-FixedKey',
        clock: () => DateTime.utc(2026, 8, 29, 10),
      );
      final prepared = operation.prepare(
        _deliveredRequest(
          defer: true,
          pending: <RepartoPendingEvidenceRef>[_signatureRef()],
        ),
      );
      final wire = prepared.toJson();
      expect((wire['delivery'] as Map)['pendingEvidence'], isNotNull);
      expect(prepared.headers['Idempotency-Key'], 'rep-FixedKey');
    });
  });

  group('pending evidence ref codec', () {
    test('json roundtrip', () {
      final ref = _signatureRef();
      final decoded = RepartoPendingEvidenceRef.fromJson(
        Map<String, dynamic>.from(ref.toJson()),
      );
      expect(decoded.slot, ref.slot);
      expect(decoded.fingerprint, ref.fingerprint);
      expect(decoded.idempotencyKey, ref.idempotencyKey);
    });

    test('rejects invalid slot', () {
      expect(
        () => RepartoPendingEvidenceRef.fromJson(
          <String, dynamic>{
            'slot': 'photo-9',
            'fingerprint': signatureFingerprint64,
            'idempotencyKey': evidenceKey,
          },
        ),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
    });

    test('rejects invalid fingerprint', () {
      expect(
        () => RepartoPendingEvidenceRef.fromJson(
          <String, dynamic>{
            'slot': 'signature',
            'fingerprint': 'nope',
            'idempotencyKey': evidenceKey,
          },
        ),
        throwsA(isA<RepartoConfirmationValidationException>()),
      );
    });
  });
}

/// Fake uploader recording every call: verifies drain reuses slot keys and
/// never re-uploads resolved slots (EARS-3).
class _RecordingUploader implements RepartoEvidenceUploader {
  final List<String> signatureCalls = <String>[];
  final List<String> photoCalls = <String>[];
  final Map<String, String> serverEvidenceBySlot;

  _RecordingUploader(this.serverEvidenceBySlot);

  @override
  Future<String> uploadSignature({
    required String entregaId,
    required Uint8List pngBytes,
    required String idempotencyKey,
    String? repartidorId,
  }) async {
    signatureCalls.add(idempotencyKey);
    return serverEvidenceBySlot['signature']!;
  }

  @override
  Future<String> uploadPhoto({
    required String entregaId,
    required XFile photo,
    required String idempotencyKey,
    String? repartidorId,
  }) async {
    photoCalls.add(idempotencyKey);
    return serverEvidenceBySlot['photo-0']!;
  }
}

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

String _boxKey(String deliveryId, String slot) => '$deliveryId $slot';

void main2() {} // placeholder to keep single main; see drain tests file.
