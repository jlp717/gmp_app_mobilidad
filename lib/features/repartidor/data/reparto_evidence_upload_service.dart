// ignore_for_file: public_member_api_docs

import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/offline/connectivity_provider.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_request.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_evidence_inbox.dart';
import 'package:image_picker/image_picker.dart';

abstract interface class RepartoEvidenceUploader {
  Future<String> uploadSignature({
    required String entregaId,
    required Uint8List pngBytes,
    required String idempotencyKey,
    String? repartidorId,
  });

  Future<String> uploadPhoto({
    required String entregaId,
    required XFile photo,
    required String idempotencyKey,
    String? repartidorId,
  });
}

/// Uploads evidence before confirmation without exposing raw media in errors.
class RepartoEvidenceUploadService implements RepartoEvidenceUploader {
  RepartoEvidenceUploadService({Dio? dio}) : _dio = dio ?? ApiClient.dio;

  static const int maxSignatureBytes = 1024 * 1024;
  static const int maxPhotoBytes = 4 * 1024 * 1024;
  static const int maxPhotos = 3;
  static const Set<String> _safeBackendCodes = <String>{
    'AUTHENTICATED_ACTOR_REQUIRED',
    'REPARTO_CONFIRMATION_ROLE_REQUIRED',
    'EVIDENCE_OWNERSHIP_REQUIRED',
    'EVIDENCE_TOO_LARGE',
    'INVALID_EVIDENCE_REQUEST',
    'INVALID_SIGNATURE_DATA_URI',
    'UNSUPPORTED_EVIDENCE_TYPE',
    'INVALID_EVIDENCE_MAGIC',
    'REPARTO_EVIDENCE_RUNTIME_UNAVAILABLE',
  };

  final Dio _dio;

  @override
  Future<String> uploadSignature({
    required String entregaId,
    required Uint8List pngBytes,
    required String idempotencyKey,
    String? repartidorId,
  }) async {
    _requireEntregaId(entregaId);
    if (pngBytes.lengthInBytes > maxSignatureBytes) {
      throw const RepartoEvidenceUploadException(
        'La firma supera el tamaño permitido.',
        code: 'EVIDENCE_TOO_LARGE',
        statusCode: 413,
      );
    }
    if (pngBytes.isEmpty || !_isPng(pngBytes)) {
      throw const RepartoEvidenceUploadException(
        'La firma debe ser un PNG válido.',
        code: 'INVALID_SIGNATURE_DATA',
        statusCode: 422,
      );
    }
    return _postForEvidenceId(
      '/repartidor-finanzas/rutero/evidence/signature',
      <String, dynamic>{
        'documentId': entregaId.trim(),
        'signature': 'data:image/png;base64,${base64Encode(pngBytes)}',
        if (repartidorId != null && repartidorId.trim().isNotEmpty)
          'repartidorId': repartidorId.trim(),
      },
      idempotencyKey,
    );
  }

  @override
  Future<String> uploadPhoto({
    required String entregaId,
    required XFile photo,
    required String idempotencyKey,
    String? repartidorId,
  }) async {
    _requireEntregaId(entregaId);
    final bytes = await photo.readAsBytes();
    if (bytes.lengthInBytes > maxPhotoBytes) {
      throw const RepartoEvidenceUploadException(
        'La foto supera el límite de 4 MiB.',
        code: 'EVIDENCE_TOO_LARGE',
        statusCode: 413,
      );
    }
    if (bytes.isEmpty || (!_isPng(bytes) && !_isJpeg(bytes))) {
      throw const RepartoEvidenceUploadException(
        'La foto debe ser JPEG o PNG válida.',
        code: 'INVALID_EVIDENCE_MAGIC',
        statusCode: 422,
      );
    }
    final mimeType = _isPng(bytes) ? 'image/png' : 'image/jpeg';
    return _postForEvidenceId(
      '/repartidor-finanzas/rutero/evidence/photo',
      FormData.fromMap(<String, dynamic>{
        'documentId': entregaId.trim(),
        if (repartidorId != null && repartidorId.trim().isNotEmpty)
          'repartidorId': repartidorId.trim(),
        'photo': MultipartFile.fromBytes(
          bytes,
          filename: _safeFilename(photo, mimeType),
          contentType: DioMediaType.parse(mimeType),
        ),
      }),
      idempotencyKey,
    );
  }

  Future<String> _postForEvidenceId(
    String path,
    dynamic data,
    String idempotencyKey,
  ) async {
    _requireIdempotencyKey(idempotencyKey);
    try {
      final response = await _dio.post<dynamic>(
        path,
        data: data,
        options: Options(
          sendTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 15),
          headers: <String, String>{
            'Idempotency-Key': idempotencyKey.trim(),
          },
          // The journal preserves the idempotency key. Return control after
          // the bounded request instead of holding the modal through several
          // mobile-network retries; a retry safely resumes the same upload.
          extra: const <String, dynamic>{'idempotent': true, 'maxRetries': 0},
        ),
      );
      final body = response.data;
      final evidenceId = body is Map && body['success'] == true
          ? body['evidenceId']?.toString().trim() ?? ''
          : '';
      if (!isValidEvidenceId(evidenceId)) {
        throw const RepartoEvidenceUploadException(
          'El servidor devolvió una evidencia inválida.',
          code: 'INVALID_EVIDENCE_RESPONSE',
          statusCode: 503,
        );
      }
      return evidenceId;
    } on RepartoEvidenceUploadException {
      rethrow;
    } on DioException catch (error) {
      throw _safeDioError(error);
    } catch (_) {
      throw const RepartoEvidenceUploadException(
        'No se pudo subir la evidencia.',
      );
    }
  }

  static RepartoEvidenceUploadException _safeDioError(DioException error) {
    final status = error.response?.statusCode;
    final data = error.response?.data;
    final rawCode = data is Map ? data['code']?.toString() : null;
    final code = rawCode != null && _safeBackendCodes.contains(rawCode)
        ? rawCode
        : _fallbackCode(status);
    return RepartoEvidenceUploadException(
      _messageForStatus(status),
      code: code,
      statusCode: status,
    );
  }

  static String _fallbackCode(int? status) => switch (status) {
        401 => 'EVIDENCE_AUTH_REQUIRED',
        403 => 'EVIDENCE_FORBIDDEN',
        413 => 'EVIDENCE_TOO_LARGE',
        422 => 'INVALID_EVIDENCE_REQUEST',
        503 => 'REPARTO_EVIDENCE_RUNTIME_UNAVAILABLE',
        _ => 'EVIDENCE_UPLOAD_FAILED',
      };

  static String _messageForStatus(int? status) => switch (status) {
        401 => 'La sesión ha caducado. Inicia sesión de nuevo.',
        403 => 'No tienes permiso para adjuntar esta evidencia.',
        410 =>
          'Esta versión usa un endpoint retirado. Actualiza la app e inténtalo de nuevo.',
        413 => 'La evidencia supera el límite permitido (foto: 4 MiB).',
        422 => 'La evidencia no es válida. Revisa la foto o la firma.',
        503 => 'El servicio de evidencias no está disponible. Reinténtalo.',
        _ => 'No se pudo subir la evidencia.',
      };

  static void _requireEntregaId(String value) {
    if (value.trim().isEmpty || value.trim().length > 160) {
      throw const RepartoEvidenceUploadException(
        'La entrega no es válida.',
        code: 'INVALID_EVIDENCE_REQUEST',
        statusCode: 422,
      );
    }
  }

  static void _requireIdempotencyKey(String value) {
    final normalized = value.trim();
    if (!RegExp(r'^[A-Za-z0-9_.:-]{8,128}$').hasMatch(normalized)) {
      throw const RepartoEvidenceUploadException(
        'La operación de evidencia no es válida.',
        code: 'INVALID_EVIDENCE_REQUEST',
        statusCode: 422,
      );
    }
  }

  static bool _isPng(Uint8List bytes) =>
      bytes.length >= 8 &&
      bytes[0] == 137 &&
      bytes[1] == 80 &&
      bytes[2] == 78 &&
      bytes[3] == 71 &&
      bytes[4] == 13 &&
      bytes[5] == 10 &&
      bytes[6] == 26 &&
      bytes[7] == 10;

  static bool _isJpeg(Uint8List bytes) =>
      bytes.length >= 3 &&
      bytes[0] == 0xff &&
      bytes[1] == 0xd8 &&
      bytes[2] == 0xff;

  static bool isValidEvidenceId(String value) =>
      RegExp(r'^ev_[a-f0-9]{64}$').hasMatch(value.trim());

  static String _safeFilename(XFile photo, String mimeType) {
    final fallback = mimeType == 'image/png' ? 'evidence.png' : 'evidence.jpg';
    final safe = photo.name.trim().replaceAll(RegExp('[^A-Za-z0-9._-]'), '_');
    return safe.isEmpty ? fallback : safe;
  }
}

class RepartoUploadedEvidence {
  const RepartoUploadedEvidence({
    required this.signatureId,
    required this.photoIds,
    this.pendingRefs = const <RepartoPendingEvidenceRef>[],
  });

  final String? signatureId;
  final List<String> photoIds;

  /// Slots captured offline: bytes live in the inbox and ids resolve during
  /// the drain. Empty means every evidence id is resolved server-side.
  final List<RepartoPendingEvidenceRef> pendingRefs;

  bool get hasPending => pendingRefs.isNotEmpty;
}

/// Coordinates the bounded upload phase before the canonical confirmation.
class RepartoEvidenceConfirmationCoordinator {
  const RepartoEvidenceConfirmationCoordinator(
    this._uploader,
    this._journal, {
    RepartoEvidenceInbox? inbox,
    bool Function()? offlineDetector,
  })  : _inbox = inbox,
        _offlineDetector = offlineDetector;

  final RepartoEvidenceUploader _uploader;
  final RepartoConfirmationJournal _journal;
  final RepartoEvidenceInbox? _inbox;

  /// Test seam: defaults to the live ConnectivityService. Tests inject a
  /// deterministic detector to exercise the offline capture branch.
  final bool Function()? _offlineDetector;

  Future<T> uploadThenConfirm<T>({
    required String entregaId,
    required Uint8List? signaturePngBytes,
    required List<XFile> photos,
    required Future<T> Function(RepartoUploadedEvidence evidence) confirm,
    String? repartidorId,
  }) async {
    if (photos.length > RepartoEvidenceUploadService.maxPhotos) {
      throw const RepartoEvidenceUploadException(
        'Solo se permiten tres fotos.',
        code: 'TOO_MANY_EVIDENCE_PHOTOS',
        statusCode: 422,
      );
    }

    final entry = await _journal.loadOrCreate(entregaId);
    _journal.ensureActive(entry);
    await _failClosedIfPendingEvidenceHasNoBytes(
      deliveryId: entregaId,
      entry: entry,
      hasSignatureBytes: signaturePngBytes != null,
      photoCount: photos.length,
    );

    // Offline capture: persist bytes durably, keep slot identities in the
    // journal, and hand the caller pending references instead of server ids.
    if (isOfflineCapture) {
      return _confirmWithInboxEvidence<T>(
        entregaId: entregaId,
        signaturePngBytes: signaturePngBytes,
        photos: photos,
        confirm: confirm,
      );
    }
    final signatureId = signaturePngBytes == null
        ? _persistedId(entry, 'signature')
        : await _uploadSignature(
            entregaId,
            signaturePngBytes,
            repartidorId: repartidorId,
          );
    final photo0 = photos.isEmpty
        ? _persistedId(entry, 'photo-0')
        : await _uploadPhoto(
            entregaId,
            photos[0],
            slot: 'photo-0',
            repartidorId: repartidorId,
          );
    final photo1 = photos.length < 2
        ? _persistedId(entry, 'photo-1')
        : await _uploadPhoto(
            entregaId,
            photos[1],
            slot: 'photo-1',
            repartidorId: repartidorId,
          );
    final photo2 = photos.length < 3
        ? _persistedId(entry, 'photo-2')
        : await _uploadPhoto(
            entregaId,
            photos[2],
            slot: 'photo-2',
            repartidorId: repartidorId,
          );
    final evidence = RepartoUploadedEvidence(
      signatureId: signatureId,
      photoIds: List<String>.unmodifiable(<String>[
        if (photo0 != null) photo0,
        if (photo1 != null) photo1,
        if (photo2 != null) photo2,
      ]),
    );
    return confirm(evidence);
  }

  bool get isOfflineCapture {
    final detector = _offlineDetector;
    return detector != null
        ? detector()
        : ConnectivityService.instance.currentStatus !=
            ConnectivityStatus.online;
  }

  Future<T> _confirmWithInboxEvidence<T>({
    required String entregaId,
    required Uint8List? signaturePngBytes,
    required List<XFile> photos,
    required Future<T> Function(RepartoUploadedEvidence evidence) confirm,
  }) async {
    final inbox = _inbox;
    if (inbox == null) {
      throw const RepartoEvidenceUploadException(
        'Sin conexión y sin almacenamiento local disponible.',
        code: 'INBOX_UNAVAILABLE',
        statusCode: 503,
      );
    }
    final pendingRefs = <RepartoPendingEvidenceRef>[];
    final resolvedPhotoIds = <String>[];

    // Slots already resolved by a previous (possibly partial) drain keep
    // their server evidence ids; only un-resolved slots consume inbox bytes.
    var entry = await _journal.loadOrCreate(entregaId);
    final resolvedSignatureId = _persistedId(entry, 'signature');
    if (signaturePngBytes != null && resolvedSignatureId == null) {
      pendingRefs.add(
        await _stashOfflineEvidence(
          inbox: inbox,
          entregaId: entregaId,
          slot: 'signature',
          bytes: signaturePngBytes,
        ),
      );
    }

    for (var index = 0; index < photos.length; index++) {
      final slot = 'photo-$index';
      entry = await _journal.loadOrCreate(entregaId);
      final resolved = _persistedId(entry, slot);
      if (resolved != null) {
        resolvedPhotoIds.add(resolved);
        continue;
      }
      final bytes = await photos[index].readAsBytes();
      pendingRefs.add(
        await _stashOfflineEvidence(
          inbox: inbox,
          entregaId: entregaId,
          slot: slot,
          bytes: bytes,
        ),
      );
    }

    // Every slot must be either resolved or pending for the caller to build
    // a complete deferred payload.
    final effectiveSignatureId = resolvedSignatureId ??
        (signaturePngBytes == null ? _persistedId(entry, 'signature') : null);

    return confirm(
      RepartoUploadedEvidence(
        signatureId: effectiveSignatureId,
        photoIds: List<String>.unmodifiable(resolvedPhotoIds),
        pendingRefs: List<RepartoPendingEvidenceRef>.unmodifiable(
          pendingRefs,
        ),
      ),
    );
  }

  /// Reserves the journal slot (stable fingerprint + idempotency key) and
  /// persists the raw bytes in the encrypted inbox.
  Future<RepartoPendingEvidenceRef> _stashOfflineEvidence({
    required RepartoEvidenceInbox inbox,
    required String entregaId,
    required String slot,
    required Uint8List bytes,
  }) async {
    final record = await _journal.reserveEvidence(
      deliveryId: entregaId,
      slot: slot,
      fingerprint: sha256.convert(bytes).toString(),
    );
    if (record.evidenceId != null) {
      // A previous partial drain already uploaded these exact bytes.
      return RepartoPendingEvidenceRef(
        slot: slot,
        fingerprint: record.fingerprint,
        idempotencyKey: record.idempotencyKey,
      );
    }
    await inbox.put(
      deliveryId: entregaId,
      slot: slot,
      bytes: bytes,
      fingerprint: record.fingerprint,
      idempotencyKey: record.idempotencyKey,
      savedAt: DateTime.now(),
    );
    return RepartoPendingEvidenceRef(
      slot: slot,
      fingerprint: record.fingerprint,
      idempotencyKey: record.idempotencyKey,
    );
  }

  Future<void> _failClosedIfPendingEvidenceHasNoBytes({
    required String deliveryId,
    required RepartoConfirmationJournalEntry entry,
    required bool hasSignatureBytes,
    required int photoCount,
  }) async {
    for (final evidence in entry.evidences.entries) {
      if (evidence.value.evidenceId != null) continue;
      final hasLocalBytes = switch (evidence.key) {
        'signature' => hasSignatureBytes,
        'photo-0' => photoCount > 0,
        'photo-1' => photoCount > 1,
        'photo-2' => photoCount > 2,
        _ => false,
      };
      if (hasLocalBytes) continue;
      await _journal.markManualReview(deliveryId);
      throw const RepartoEvidenceUploadException(
        'Hay una evidencia pendiente sin datos locales para reanudarla.',
        code: 'EVIDENCE_REQUIRES_MANUAL_REVIEW',
        statusCode: 409,
      );
    }
  }

  Future<String> _uploadSignature(
    String deliveryId,
    Uint8List bytes, {
    String? repartidorId,
  }) async {
    const slot = 'signature';
    final record = await _journal.reserveEvidence(
      deliveryId: deliveryId,
      slot: slot,
      fingerprint: sha256.convert(bytes).toString(),
    );
    final uploaded = record.evidenceId;
    if (uploaded != null) return uploaded;
    final evidenceId = await _uploader.uploadSignature(
      entregaId: deliveryId,
      pngBytes: bytes,
      idempotencyKey: record.idempotencyKey,
      repartidorId: repartidorId,
    );
    await _journal.markEvidenceUploaded(
      deliveryId: deliveryId,
      slot: slot,
      evidenceId: evidenceId,
    );
    return evidenceId;
  }

  Future<String> _uploadPhoto(
    String deliveryId,
    XFile photo, {
    required String slot,
    String? repartidorId,
  }) async {
    final bytes = await photo.readAsBytes();
    final record = await _journal.reserveEvidence(
      deliveryId: deliveryId,
      slot: slot,
      fingerprint: sha256.convert(bytes).toString(),
    );
    final uploaded = record.evidenceId;
    if (uploaded != null) return uploaded;
    final evidenceId = await _uploader.uploadPhoto(
      entregaId: deliveryId,
      photo: photo,
      idempotencyKey: record.idempotencyKey,
      repartidorId: repartidorId,
    );
    await _journal.markEvidenceUploaded(
      deliveryId: deliveryId,
      slot: slot,
      evidenceId: evidenceId,
    );
    return evidenceId;
  }

  static String? _persistedId(
    RepartoConfirmationJournalEntry entry,
    String slot,
  ) {
    final evidenceId = entry.evidences[slot]?.evidenceId;
    return evidenceId != null &&
            RepartoEvidenceUploadService.isValidEvidenceId(evidenceId)
        ? evidenceId
        : null;
  }
}

class RepartoEvidenceUploadException implements Exception {
  const RepartoEvidenceUploadException(
    this.message, {
    this.code = 'EVIDENCE_UPLOAD_FAILED',
    this.statusCode,
  });

  final String message;
  final String code;
  final int? statusCode;

  @override
  String toString() => '$code: $message';
}

String repartoEvidenceErrorMessage(RepartoEvidenceUploadException error) =>
    switch (error.statusCode) {
      401 => 'La sesión ha caducado. Inicia sesión de nuevo.',
      409 => 'Hay una evidencia pendiente que requiere revisión manual.',
      403 => 'No tienes permiso para adjuntar esta evidencia.',
      413 => 'La evidencia supera el límite permitido (foto: 4 MiB).',
      422 => 'La evidencia no es válida. Revisa la foto o la firma.',
      503 => 'El servicio de evidencias no está disponible. Reinténtalo.',
      _ => 'No se pudo subir la evidencia.',
    };
