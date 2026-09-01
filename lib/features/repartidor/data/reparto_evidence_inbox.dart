// ignore_for_file: public_member_api_docs

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/storage/hive_secure_box.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/reparto_confirmation_journal.dart';
import 'package:hive_flutter/hive_flutter.dart';

/// Durable local storage for delivery evidence bytes captured without
/// connectivity. The drain phase uploads each record before replaying the
/// canonical confirmation POST.
class RepartoEvidenceInboxRecord {
  const RepartoEvidenceInboxRecord({
    required this.deliveryId,
    required this.slot,
    required this.bytes,
    required this.fingerprint,
    required this.idempotencyKey,
    required this.savedAt,
    required this.kind,
    required this.mimeType,
  });

  final String deliveryId;
  final String slot; // 'signature' | 'photo-0' | 'photo-1' | 'photo-2'
  final Uint8List bytes;
  final String fingerprint;
  final String idempotencyKey;
  final DateTime savedAt;
  final RepartoEvidenceInboxKind kind;
  final String mimeType;

  String get boxKey => RepartoEvidenceInbox.boxKeyFor(deliveryId, slot);

  Map<String, dynamic> toJson() => <String, dynamic>{
        'version': 1,
        'deliveryId': deliveryId,
        'slot': slot,
        'bytes': base64Encode(bytes),
        'fingerprint': fingerprint,
        'idempotencyKey': idempotencyKey,
        'savedAt': savedAt.toUtc().toIso8601String(),
        'kind': kind.name,
        'mimeType': mimeType,
      };

  static RepartoEvidenceInboxRecord fromJson(Map<String, dynamic> json) {
    final version = json['version'];
    final deliveryId = json['deliveryId'];
    final slot = json['slot'];
    final rawBytes = json['bytes'];
    final fingerprint = json['fingerprint'];
    final idempotencyKey = json['idempotencyKey'];
    final rawSavedAt = json['savedAt'];
    final kindName = json['kind'];
    final mimeType = json['mimeType'];
    if (version != 1 ||
        deliveryId is! String ||
        deliveryId.trim().isEmpty ||
        deliveryId != deliveryId.trim() ||
        slot is! String ||
        !_isValidSlot(slot) ||
        rawBytes is! String ||
        fingerprint is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint) ||
        idempotencyKey is! String ||
        !RegExp(r'^[A-Za-z0-9_.:-]{8,128}$').hasMatch(idempotencyKey) ||
        kindName is! String ||
        !RepartoEvidenceInboxKind.values.any((k) => k.name == kindName) ||
        mimeType is! String ||
        (mimeType != 'image/png' && mimeType != 'image/jpeg')) {
      throw const FormatException('Invalid reparto evidence inbox record');
    }
    final savedAt =
        rawSavedAt is String ? DateTime.tryParse(rawSavedAt)?.toUtc() : null;
    if (savedAt == null) {
      throw const FormatException('Invalid reparto evidence inbox timestamp');
    }
    Uint8List bytes;
    try {
      bytes = base64Decode(rawBytes);
    } catch (_) {
      throw const FormatException('Invalid reparto evidence inbox bytes');
    }
    if (bytes.isEmpty) {
      throw const FormatException('Invalid reparto evidence inbox bytes');
    }
    return RepartoEvidenceInboxRecord(
      deliveryId: deliveryId,
      slot: slot,
      bytes: bytes,
      fingerprint: fingerprint,
      idempotencyKey: idempotencyKey,
      savedAt: savedAt,
      kind: RepartoEvidenceInboxKind.values.byName(kindName),
      mimeType: mimeType,
    );
  }

  static bool _isValidSlot(String value) =>
      value == 'signature' ||
      value == 'photo-0' ||
      value == 'photo-1' ||
      value == 'photo-2';
}

enum RepartoEvidenceInboxKind { firma, foto }

class RepartoEvidenceInboxException implements Exception {
  const RepartoEvidenceInboxException(this.message, {this.code});

  final String message;
  final String? code;

  @override
  String toString() => code == null ? message : '$code: $message';
}

/// Persistent inbox backed by an encrypted Hive box.
///
/// Limits mirror the server-side evidence contract so a record that could
/// never upload is rejected before it occupies durable storage:
/// signature PNG <= 1 MiB, photo JPEG/PNG <= 4 MiB, at most 3 photo slots.
class RepartoEvidenceInbox {
  RepartoEvidenceInbox(this._store);

  static const String boxName = 'reparto_evidence_inbox_v1';
  static const int maxSignatureBytes = 1024 * 1024;
  static const int maxPhotoBytes = 4 * 1024 * 1024;
  static const int maxPhotos = 3;
  static const Duration maxAge = Duration(days: 7);

  final RepartoEvidenceInboxStore _store;

  static String boxKeyFor(String deliveryId, String slot) =>
      '${deliveryId.trim()}:$slot';

  /// Validates and durably persists one evidence slot. Returns the record so
  /// the caller can confirm the persisted fingerprint matches its own.
  Future<RepartoEvidenceInboxRecord> put({
    required String deliveryId,
    required String slot,
    required Uint8List bytes,
    required String fingerprint,
    required String idempotencyKey,
    required DateTime savedAt,
  }) async {
    final normalizedDeliveryId = deliveryId.trim();
    if (normalizedDeliveryId.isEmpty || normalizedDeliveryId.length > 160) {
      throw const RepartoEvidenceInboxException(
        'La entrega no es válida.',
        code: 'INVALID_EVIDENCE_REQUEST',
      );
    }
    if (!RepartoEvidenceInboxRecord._isValidSlot(slot)) {
      throw const RepartoEvidenceInboxException(
        'El tipo de evidencia no es válido.',
        code: 'INVALID_EVIDENCE_REQUEST',
      );
    }
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint)) {
      throw const RepartoEvidenceInboxException(
        'La huella de la evidencia no es válida.',
        code: 'INVALID_EVIDENCE_REQUEST',
      );
    }
    if (!RegExp(r'^[A-Za-z0-9_.:-]{8,128}$').hasMatch(idempotencyKey)) {
      throw const RepartoEvidenceInboxException(
        'La operación de evidencia no es válida.',
        code: 'INVALID_EVIDENCE_REQUEST',
      );
    }
    final isSignature = slot == 'signature';
    final limit = isSignature ? maxSignatureBytes : maxPhotoBytes;
    if (bytes.isEmpty || bytes.lengthInBytes > limit) {
      throw RepartoEvidenceInboxException(
        isSignature
            ? 'La firma debe ser PNG de hasta 1 MiB.'
            : 'La foto debe ser JPEG/PNG de hasta 4 MiB.',
        code: 'EVIDENCE_TOO_LARGE',
      );
    }
    final mimeType = _detectMimeType(bytes);
    if (isSignature && mimeType != 'image/png') {
      throw const RepartoEvidenceInboxException(
        'La firma debe ser un PNG válido.',
        code: 'INVALID_SIGNATURE_DATA',
      );
    }
    if (!isSignature && mimeType == null) {
      throw const RepartoEvidenceInboxException(
        'La foto debe ser JPEG o PNG válida.',
        code: 'INVALID_EVIDENCE_MAGIC',
      );
    }
    if (!isSignature && (await photoCount(normalizedDeliveryId)) >= maxPhotos) {
      throw const RepartoEvidenceInboxException(
        'Solo se permiten tres fotos.',
        code: 'TOO_MANY_EVIDENCE_PHOTOS',
      );
    }

    final record = RepartoEvidenceInboxRecord(
      deliveryId: normalizedDeliveryId,
      slot: slot,
      bytes: bytes,
      fingerprint: fingerprint,
      idempotencyKey: idempotencyKey,
      savedAt: savedAt.toUtc(),
      kind: isSignature
          ? RepartoEvidenceInboxKind.firma
          : RepartoEvidenceInboxKind.foto,
      mimeType: mimeType ?? 'image/png',
    );
    await _store.write(record);
    return record;
  }

  Future<RepartoEvidenceInboxRecord?> read(String deliveryId, String slot) =>
      _store.read(boxKeyFor(deliveryId, slot));

  Future<void> delete(String deliveryId, String slot) =>
      _store.delete(boxKeyFor(deliveryId, slot));

  /// Removes every inbox record of a delivery once its journal is
  /// acknowledged server-side.
  Future<int> purgeDelivery(String deliveryId) async {
    var removed = 0;
    for (final slot in const <String>[
      'signature',
      'photo-0',
      'photo-1',
      'photo-2',
    ]) {
      final key = boxKeyFor(deliveryId, slot);
      if (await _store.read(key) != null) {
        await _store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /// Records older than [maxAge] are stale business data. The journal entry
  /// is escalated to manualReview by the caller; the inbox drops the bytes.
  Future<List<RepartoEvidenceInboxRecord>> staleRecords({
    required DateTime now,
  }) async {
    final cutoff = now.toUtc().subtract(maxAge);
    final all = await _store.readAll();
    return all
        .where((record) => record.savedAt.isBefore(cutoff))
        .toList(growable: false);
  }

  Future<int> photoCount(String deliveryId) async {
    var count = 0;
    for (final slot in const <String>[
      'photo-0',
      'photo-1',
      'photo-2',
    ]) {
      if (await _store.read(boxKeyFor(deliveryId, slot)) != null) count++;
    }
    return count;
  }

  static String? _detectMimeType(Uint8List bytes) {
    if (bytes.length >= 8 &&
        bytes[0] == 137 &&
        bytes[1] == 80 &&
        bytes[2] == 78 &&
        bytes[3] == 71 &&
        bytes[4] == 13 &&
        bytes[5] == 10 &&
        bytes[6] == 26 &&
        bytes[7] == 10) {
      return 'image/png';
    }
    if (bytes.length >= 3 &&
        bytes[0] == 0xff &&
        bytes[1] == 0xd8 &&
        bytes[2] == 0xff) {
      return 'image/jpeg';
    }
    return null;
  }
}

abstract interface class RepartoEvidenceInboxStore {
  Future<RepartoEvidenceInboxRecord?> read(String key);

  Future<void> write(RepartoEvidenceInboxRecord record);

  Future<void> delete(String key);

  Future<List<RepartoEvidenceInboxRecord>> readAll();
}

/// Decoding mirrors the journal codec: a corrupt record is surfaced as a
/// typed exception so the caller can purge it and escalate manualReview.
class RepartoEvidenceInboxCodec {
  const RepartoEvidenceInboxCodec._();

  static RepartoEvidenceInboxRecord? decode({
    required String expectedKey,
    required bool containsKey,
    required Object? raw,
  }) {
    if (!containsKey) return null;
    if (raw is! String) {
      throw const RepartoEvidenceInboxCorruptException();
    }
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) {
        throw const FormatException('Inbox root must be a map');
      }
      final record = RepartoEvidenceInboxRecord.fromJson(
        Map<String, dynamic>.from(decoded),
      );
      if (boxKeyOf(record) != expectedKey) {
        throw const FormatException('Inbox key mismatch');
      }
      return record;
    } on RepartoEvidenceInboxCorruptException {
      rethrow;
    } catch (_) {
      throw const RepartoEvidenceInboxCorruptException();
    }
  }

  static String boxKeyOf(RepartoEvidenceInboxRecord record) =>
      RepartoEvidenceInbox.boxKeyFor(record.deliveryId, record.slot);
}

class RepartoEvidenceInboxCorruptException implements Exception {
  const RepartoEvidenceInboxCorruptException();

  @override
  String toString() => 'El registro local de evidencia no es válido.';
}

class HiveRepartoEvidenceInboxStore implements RepartoEvidenceInboxStore {
  static const String _boxName = RepartoEvidenceInbox.boxName;

  Box<dynamic>? _box;

  Future<Box<dynamic>> _getBox() async {
    final current = _box;
    if (current != null && current.isOpen) return current;
    _box = await HiveSecureBox.open<dynamic>(_boxName);
    return _box!;
  }

  @override
  Future<RepartoEvidenceInboxRecord?> read(String key) async {
    final box = await _getBox();
    if (!box.containsKey(key)) return null;
    return RepartoEvidenceInboxCodec.decode(
      expectedKey: key,
      containsKey: true,
      raw: box.get(key),
    );
  }

  @override
  Future<void> write(RepartoEvidenceInboxRecord record) async {
    await (await _getBox()).put(record.boxKey, jsonEncode(record.toJson()));
  }

  @override
  Future<void> delete(String key) async {
    await (await _getBox()).delete(key);
  }

  @override
  Future<List<RepartoEvidenceInboxRecord>> readAll() async {
    final box = await _getBox();
    final records = <RepartoEvidenceInboxRecord>[];
    for (final entry in box.toMap().entries) {
      final key = entry.key.toString();
      final decoded = RepartoEvidenceInboxCodec.decode(
        expectedKey: key,
        containsKey: true,
        raw: entry.value,
      );
      if (decoded != null) records.add(decoded);
    }
    return records;
  }
}

/// Pairs the inbox with the confirmation journal so lifecycle rules stay in
/// one place: acknowledged deliveries purge bytes, stale records escalate
/// manualReview and are dropped.
class RepartoEvidenceInboxMaintenance {
  RepartoEvidenceInboxMaintenance({
    required this.inbox,
    required this.journal,
  });

  final RepartoEvidenceInbox inbox;
  final RepartoConfirmationJournal journal;

  /// EARS-4: purge inbox bytes once the journal acknowledges the delivery.
  Future<void> onDeliveryAcknowledged(String deliveryId) async {
    final removed = await inbox.purgeDelivery(deliveryId);
    if (removed > 0) {
      debugPrint('[EvidenceInbox] Purged $removed records for $deliveryId');
    }
  }

  /// EARS-5: stale records (>7 days) escalate manualReview and drop bytes.
  /// Returns the deliveryIds escalated so callers can surface them.
  Future<Set<String>> purgeStale({DateTime? now}) async {
    final reference = (now ?? DateTime.now()).toUtc();
    final stale = await inbox.staleRecords(now: reference);
    if (stale.isEmpty) return const <String>{};
    final escalated = <String>{};
    for (final record in stale) {
      escalated.add(record.deliveryId);
      await inbox.delete(record.deliveryId, record.slot);
    }
    for (final deliveryId in escalated) {
      try {
        await journal.markManualReview(deliveryId);
      } catch (_) {
        // Journal may not exist for orphan evidence; bytes are gone either way.
      }
    }
    debugPrint(
      '[EvidenceInbox] Stale purge: ${stale.length} records, '
      '${escalated.length} deliveries escalated',
    );
    return escalated;
  }
}
