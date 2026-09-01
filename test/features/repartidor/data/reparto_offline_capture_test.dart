// ignore_for_file: public_member_api_docs

import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_inbox.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_upload_service.dart';
import 'package:image_picker/image_picker.dart';

// Real SHA-256 of the byte fixtures below — the coordinator hashes bytes
// before reserving journal slots, so constants must match exactly.
const sigFingerprint =
    '4353a1de7e0dcc4e87350e22d5c9ee9f3e70e8ce9c31533ec991bee8870c4814';
const photoFingerprint0 =
    '9923793242133ba7d7990d8f9d7934b0d0ef6057cf631d68750bfac7f9d6429b';
final signatureEvidenceId = 'ev_${'c' * 64}';

Uint8List _png() => Uint8List.fromList(
      <int>[137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4],
    );
Uint8List _jpeg() => Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 0, 1, 2, 3]);

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

class _NoNetworkUploader implements RepartoEvidenceUploader {
  int calls = 0;

  @override
  Future<String> uploadSignature({
    required String entregaId,
    required Uint8List pngBytes,
    required String idempotencyKey,
    String? repartidorId,
  }) async {
    calls++;
    throw StateError('No debe llamarse al subir en modo offline');
  }

  @override
  Future<String> uploadPhoto({
    required String entregaId,
    required XFile photo,
    required String idempotencyKey,
    String? repartidorId,
  }) async {
    calls++;
    throw StateError('No debe llamarse al subir en modo offline');
  }
}

void main() {
  test(
      'EARS-1: offline ENTREGADO with signature+photo stashes bytes and '
      'returns pending refs, never hitting the network', () async {
    final inboxStore = _MemoryInboxStore();
    final journalStore = _MemoryJournalStore();
    final journal = RepartoConfirmationJournal(journalStore);
    final inbox = RepartoEvidenceInbox(inboxStore);
    final uploader = _NoNetworkUploader();
    final coordinator = RepartoEvidenceConfirmationCoordinator(
      uploader,
      journal,
      inbox: inbox,
      offlineDetector: () => true, // SIN COBERTURA
    );

    // The driver confirms an ENTREGADO with mandatory signature + 1 photo.
    RepartoUploadedEvidence? capturedEvidence;
    await coordinator.uploadThenConfirm<bool>(
      entregaId: 'DOC-42',
      signaturePngBytes: _png(),
      photos: <XFile>[XFile.fromData(_jpeg(), mimeType: 'image/jpeg')],
      repartidorId: '05',
      confirm: (evidence) async {
        capturedEvidence = evidence;
        return true;
      },
    );
    final evidence = capturedEvidence!;

    // No upload happened while offline.
    expect(uploader.calls, 0);

    // Bytes persisted durably in the inbox (signature + photo).
    final savedSignature = await inbox.read('DOC-42', 'signature');
    final savedPhoto = await inbox.read('DOC-42', 'photo-0');
    expect(savedSignature, isNotNull);
    expect(savedSignature!.bytes, _png());
    expect(savedPhoto, isNotNull);
    expect(savedPhoto!.bytes, _jpeg());

    // Journal keeps the slot reservations (uploading state, stable keys).
    final entry = await journalStore.read('DOC-42');
    expect(entry!.state, RepartoOperationState.uploading);
    expect(entry.evidences['signature']!.fingerprint, sigFingerprint);
    expect(entry.evidences['photo-0']!.fingerprint, photoFingerprint0);
    // Stable idempotency keys (rep- + base64url, same shape the server
    // accepts on the Idempotency-Key header).
    expect(
      RegExp(r'^[A-Za-z0-9_.:-]{8,128}$')
          .hasMatch(entry.evidences['signature']!.idempotencyKey),
      isTrue,
    );
    expect(
      entry.evidences['signature']!.idempotencyKey,
      isNot(equals(entry.evidences['photo-0']!.idempotencyKey)),
    );

    // Caller receives pending refs instead of server ids.
    expect(evidence.signatureId, isNull);
    expect(evidence.photoIds, isEmpty);
    expect(evidence.hasPending, isTrue);
    expect(evidence.pendingRefs, hasLength(2));
    expect(evidence.pendingRefs.first.slot, 'signature');
    expect(evidence.pendingRefs.last.slot, 'photo-0');
  });

  test('deferred confirmation built from pending refs validates (ENTREGADO)',
      () async {
    // Simulate the modal building the request after the offline coordinator
    // handed pending refs. ENTREGADO must validate without a server firma id.
    final request = RepartoConfirmationRequest(
      itemId: 'DOC-42',
      status: RepartoDeliveryStatus.entregado,
      occurredAt: DateTime.utc(2026, 8, 29, 9),
      lineas: const <RepartoDeliveryLine>[
        RepartoDeliveryLine(
          lineaId: 'L1',
          codigoArticulo: 'ART-9',
          cantidadPedida: 3,
          cantidadEntregada: 3,
          cantidadRechazada: 0,
          cantidadPendiente: 0,
        ),
      ],
      receiver: RepartoReceiver(
        nombre: 'Maria',
        apellidos: 'Fernandez Ruiz',
        dni: '12345678Z',
      ),
      deferEvidence: true,
      pendingEvidence: const <RepartoPendingEvidenceRef>[
        RepartoPendingEvidenceRef(
          slot: 'signature',
          fingerprint: sigFingerprint,
          idempotencyKey: 'rep-SigKey42',
        ),
      ],
    );

    final wire = request.toDeferredJson();
    final delivery = wire['delivery'] as Map<String, dynamic>;
    expect(delivery['firma'], isNull);
    expect(
      (delivery['pendingEvidence'] as Map)['firma'],
      isNotNull,
    );
  });

  test('online path is untouched: uploader called, ids returned', () async {
    final inboxStore = _MemoryInboxStore();
    final journalStore = _MemoryJournalStore();
    final journal = RepartoConfirmationJournal(journalStore);
    final inbox = RepartoEvidenceInbox(inboxStore);
    final coordinator = RepartoEvidenceConfirmationCoordinator(
      _FixedIdUploader(),
      journal,
      inbox: inbox,
      offlineDetector: () => false, // CON COBERTURA
    );

    RepartoUploadedEvidence? capturedEvidence;
    await coordinator.uploadThenConfirm<bool>(
      entregaId: 'DOC-42',
      signaturePngBytes: _png(),
      photos: const <XFile>[],
      confirm: (evidence) async {
        capturedEvidence = evidence;
        return true;
      },
    );
    final evidence = capturedEvidence!;

    expect(evidence.pendingRefs, isEmpty);
    expect(evidence.signatureId, signatureEvidenceId);
    expect(evidence.photoIds, isEmpty);
  });

  test(
      'offline confirmation without evidence still reaches the confirmation callback',
      () async {
    final journal = RepartoConfirmationJournal(_MemoryJournalStore());
    final coordinator = RepartoEvidenceConfirmationCoordinator(
      _NoNetworkUploader(),
      journal,
      inbox: RepartoEvidenceInbox(_MemoryInboxStore()),
      offlineDetector: () => true,
    );

    RepartoUploadedEvidence? capturedEvidence;
    final result = await coordinator.uploadThenConfirm<bool>(
      entregaId: 'DOC-NO-EVIDENCE',
      signaturePngBytes: null,
      photos: const <XFile>[],
      confirm: (evidence) async {
        capturedEvidence = evidence;
        return true;
      },
    );

    expect(result, isTrue);
    expect(capturedEvidence?.signatureId, isNull);
    expect(capturedEvidence?.photoIds, isEmpty);
    expect(capturedEvidence?.pendingRefs, isEmpty);
  });
}

class _FixedIdUploader implements RepartoEvidenceUploader {
  @override
  Future<String> uploadSignature({
    required String entregaId,
    required Uint8List pngBytes,
    required String idempotencyKey,
    String? repartidorId,
  }) async =>
      signatureEvidenceId;

  @override
  Future<String> uploadPhoto({
    required String entregaId,
    required XFile photo,
    required String idempotencyKey,
    String? repartidorId,
  }) async =>
      'ev_${'d' * 64}';
}
