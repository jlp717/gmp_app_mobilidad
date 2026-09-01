import 'package:flutter/foundation.dart';

import 'package:gmp_app_mobilidad/core/offline/offline_sync_notifier.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/repartidor_data_service.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_inbox.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_upload_service.dart';
import 'package:image_picker/image_picker.dart';

/// Reconciles local confirmation journal after SyncQueue drains confirm_delivery.
Future<void> defaultConfirmDeliveryReconciler({
  required String deliveryId,
  required String confirmationId,
  required String fingerprint,
  required String idempotencyKey,
  String? cobroId,
}) async {
  final journal = RepartoConfirmationJournal(
    HiveRepartoConfirmationJournalStore(),
  );
  await journal.acknowledge(
    deliveryId,
    expectedFingerprint: fingerprint,
    expectedIdempotencyKey: idempotencyKey,
    confirmationId: confirmationId,
    cobroId: cobroId,
  );
  // EARS-4: server-acknowledged delivery — its inbox bytes are no longer
  // needed and must not occupy durable storage.
  final inbox = RepartoEvidenceInbox(HiveRepartoEvidenceInboxStore());
  await inbox.purgeDelivery(deliveryId);
  await RepartidorDataService.invalidateDeliveryReadCaches();
  OfflineSyncNotifier.deliverySynchronized();
}

/// EARS-5: inbox records older than 7 days without acknowledgement escalate
/// the journal to manualReview and drop their bytes. Runs after every drain.
Future<void> runRepartoEvidenceInboxMaintenance() async {
  try {
    final maintenance = RepartoEvidenceInboxMaintenance(
      inbox: RepartoEvidenceInbox(HiveRepartoEvidenceInboxStore()),
      journal: RepartoConfirmationJournal(
        HiveRepartoConfirmationJournalStore(),
      ),
    );
    await maintenance.purgeStale();
  } catch (e) {
    debugPrint('[EvidenceInbox] Maintenance skipped: $e');
  }
}

/// Builds the [SyncQueueService.confirmEvidenceResolver] hook from the
/// journal + inbox. Slot identity comes from the journal (stable key), so a
/// retry after an interrupted drain resumes exactly where it stopped.
RepartoDeferredEvidenceResolver buildConfirmEvidenceResolver({
  RepartoEvidenceUploader? uploader,
  RepartoConfirmationJournalStore? journalStore,
  RepartoEvidenceInboxStore? inboxStore,
}) {
  final journal = RepartoConfirmationJournal(
    journalStore ?? HiveRepartoConfirmationJournalStore(),
  );
  final inbox = RepartoEvidenceInbox(
    inboxStore ?? HiveRepartoEvidenceInboxStore(),
  );
  final effectiveUploader = uploader ?? RepartoEvidenceUploadService();
  return ({
    required String deliveryId,
    String? repartidorId,
    required Map<String, dynamic> pendingEvidence,
  }) async {
    final resolved = <String, String>{};
    final signatureRef = pendingEvidence['firma'];
    if (signatureRef is Map) {
      resolved['signature'] = await _resolveSlot(
        journal: journal,
        inbox: inbox,
        uploader: effectiveUploader,
        deliveryId: deliveryId,
        repartidorId: repartidorId,
        slot: 'signature',
        ref: Map<String, dynamic>.from(signatureRef),
        expectSignature: true,
      );
    }
    final photoRefs = pendingEvidence['fotos'];
    if (photoRefs is List) {
      for (final rawRef in photoRefs) {
        if (rawRef is! Map) {
          throw StateError('Referencia de foto pendiente invalida');
        }
        final ref = Map<String, dynamic>.from(rawRef);
        final slot = ref['slot']?.toString();
        if (slot == null || slot.isEmpty) {
          throw StateError('Referencia de foto pendiente sin slot');
        }
        resolved[slot] = await _resolveSlot(
          journal: journal,
          inbox: inbox,
          uploader: effectiveUploader,
          deliveryId: deliveryId,
          repartidorId: repartidorId,
          slot: slot,
          ref: ref,
          expectSignature: false,
        );
      }
    }
    return resolved;
  };
}

typedef RepartoDeferredEvidenceResolver = Future<Map<String, String>> Function({
  required String deliveryId,
  required Map<String, dynamic> pendingEvidence,
  String? repartidorId,
});

Future<String> _resolveSlot({
  required RepartoConfirmationJournal journal,
  required RepartoEvidenceInbox inbox,
  required RepartoEvidenceUploader uploader,
  required String deliveryId,
  required String? repartidorId,
  required String slot,
  required Map<String, dynamic> ref,
  required bool expectSignature,
}) async {
  // 1. Slot already resolved by a previous (possibly interrupted) drain.
  final entry = await journal.loadOrCreate(deliveryId);
  final alreadyResolved = entry.evidences[slot]?.evidenceId;
  if (alreadyResolved != null) {
    return alreadyResolved;
  }

  // 2. Validate the deferred reference matches the journal reservation.
  final record = entry.evidences[slot];
  if (record == null) {
    throw StateError(
      'Evidencia pendiente $slot sin reserva en el diario local',
    );
  }
  final refFingerprint = ref['fingerprint']?.toString();
  final refKey = ref['idempotencyKey']?.toString();
  if (refFingerprint != record.fingerprint || refKey != record.idempotencyKey) {
    await journal.markManualReview(deliveryId);
    throw StateError(
      'La referencia de evidencia difiere de la reserva del diario',
    );
  }

  // 3. Upload the inbox bytes with the ORIGINAL slot idempotency key.
  final inboxRecord = await inbox.read(deliveryId, slot);
  if (inboxRecord == null) {
    await journal.markManualReview(deliveryId);
    throw StateError(
      'Evidencia pendiente $slot sin bytes locales; requiere revision manual',
    );
  }
  final evidenceId = expectSignature
      ? await uploader.uploadSignature(
          entregaId: deliveryId,
          pngBytes: inboxRecord.bytes,
          idempotencyKey: record.idempotencyKey,
          repartidorId: repartidorId,
        )
      : await uploader.uploadPhoto(
          entregaId: deliveryId,
          photo: XFile.fromData(
            inboxRecord.bytes,
            mimeType: inboxRecord.mimeType,
            name: 'evidence.'
                '${inboxRecord.mimeType == 'image/png' ? 'png' : 'jpg'}',
          ),
          idempotencyKey: record.idempotencyKey,
          repartidorId: repartidorId,
        );

  if (!RepartoEvidenceUploadService.isValidEvidenceId(evidenceId)) {
    throw StateError('El servidor devolvio una evidencia invalida');
  }
  await journal.markEvidenceUploaded(
    deliveryId: deliveryId,
    slot: slot,
    evidenceId: evidenceId,
  );
  return evidenceId;
}
