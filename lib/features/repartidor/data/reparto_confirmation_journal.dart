// ignore_for_file: public_member_api_docs

import 'dart:convert';
import 'dart:math';

import 'package:gmp_app_mobilidad/core/storage/hive_secure_box.dart';
import 'package:hive_flutter/hive_flutter.dart';

enum RepartoOperationState {
  draft,
  uploading,
  ready,
  submitting,
  acknowledged,
  manualReview,
}

const Set<String> repartoCanonicalEvidenceSlots = <String>{
  'signature',
  'photo-0',
  'photo-1',
  'photo-2',
};

class RepartoEvidenceJournalRecord {
  const RepartoEvidenceJournalRecord({
    required this.fingerprint,
    required this.idempotencyKey,
    this.evidenceId,
  });

  final String fingerprint;
  final String idempotencyKey;
  final String? evidenceId;

  RepartoEvidenceJournalRecord copyWith({String? evidenceId}) =>
      RepartoEvidenceJournalRecord(
        fingerprint: fingerprint,
        idempotencyKey: idempotencyKey,
        evidenceId: evidenceId ?? this.evidenceId,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'fingerprint': fingerprint,
        'idempotencyKey': idempotencyKey,
        if (evidenceId != null) 'evidenceId': evidenceId,
      };

  static RepartoEvidenceJournalRecord fromJson(Map<String, dynamic> json) =>
      _validatedFromJson(json);

  static RepartoEvidenceJournalRecord _validatedFromJson(
    Map<String, dynamic> json,
  ) {
    final fingerprint = json['fingerprint'];
    final idempotencyKey = json['idempotencyKey'];
    final evidenceId = json['evidenceId'];
    if (fingerprint is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint) ||
        idempotencyKey is! String ||
        !RegExp(r'^[A-Za-z0-9_.:-]{8,128}$').hasMatch(idempotencyKey) ||
        (evidenceId != null &&
            (evidenceId is! String ||
                !RegExp(r'^ev_[a-f0-9]{64}$').hasMatch(evidenceId)))) {
      throw const FormatException('Invalid reparto evidence journal record');
    }
    return RepartoEvidenceJournalRecord(
      fingerprint: fingerprint,
      idempotencyKey: idempotencyKey,
      evidenceId: evidenceId as String?,
    );
  }
}

class RepartoConfirmationJournalEntry {
  const RepartoConfirmationJournalEntry({
    required this.deliveryId,
    required this.state,
    required this.evidences,
    this.confirmationFingerprint,
    this.confirmationIdempotencyKey,
    this.confirmationId,
    this.cobroId,
    this.occurredAt,
  });

  final String deliveryId;
  final RepartoOperationState state;
  final Map<String, RepartoEvidenceJournalRecord> evidences;
  final String? confirmationFingerprint;
  final String? confirmationIdempotencyKey;

  /// Server-issued identifiers, stored only after a successful confirmation
  /// acknowledgement. They contain no receiver, signature, or line details.
  final String? confirmationId;
  final String? cobroId;
  final DateTime? occurredAt;

  RepartoConfirmationJournalEntry copyWith({
    RepartoOperationState? state,
    Map<String, RepartoEvidenceJournalRecord>? evidences,
    String? confirmationFingerprint,
    String? confirmationIdempotencyKey,
    DateTime? occurredAt,
    String? confirmationId,
    String? cobroId,
  }) =>
      RepartoConfirmationJournalEntry(
        deliveryId: deliveryId,
        state: state ?? this.state,
        evidences: Map<String, RepartoEvidenceJournalRecord>.unmodifiable(
          evidences ?? this.evidences,
        ),
        confirmationFingerprint:
            confirmationFingerprint ?? this.confirmationFingerprint,
        confirmationIdempotencyKey:
            confirmationIdempotencyKey ?? this.confirmationIdempotencyKey,
        confirmationId: confirmationId ?? this.confirmationId,
        cobroId: cobroId ?? this.cobroId,
        occurredAt: occurredAt ?? this.occurredAt,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'version': 2,
        'deliveryId': deliveryId,
        'state': state.name,
        'evidences': evidences.map(
          (key, value) => MapEntry<String, dynamic>(key, value.toJson()),
        ),
        if (confirmationFingerprint != null)
          'confirmationFingerprint': confirmationFingerprint,
        if (confirmationIdempotencyKey != null)
          'confirmationIdempotencyKey': confirmationIdempotencyKey,
        if (confirmationId != null) 'confirmationId': confirmationId,
        if (cobroId != null) 'cobroId': cobroId,
        if (occurredAt != null) 'occurredAt': occurredAt!.toIso8601String(),
      };

  static RepartoConfirmationJournalEntry fromJson(
    Map<String, dynamic> json,
  ) {
    final rawDeliveryId = json['deliveryId'];
    final rawEvidences = json['evidences'];
    final stateName = json['state'];
    final rawOccurredAt = json['occurredAt'];
    final occurredAt = rawOccurredAt is String
        ? DateTime.tryParse(rawOccurredAt)?.toUtc()
        : null;
    final version = json['version'];
    if ((version != 1 && version != 2) ||
        rawDeliveryId is! String ||
        rawDeliveryId.isEmpty ||
        rawDeliveryId != rawDeliveryId.trim() ||
        rawEvidences is! Map ||
        stateName is! String ||
        !RepartoOperationState.values.any((state) => state.name == stateName) ||
        (rawOccurredAt != null && occurredAt == null)) {
      throw const FormatException('Invalid reparto confirmation journal');
    }
    final evidences = <String, RepartoEvidenceJournalRecord>{};
    for (final entry in rawEvidences.entries) {
      if (entry.key is! String ||
          !repartoCanonicalEvidenceSlots.contains(entry.key) ||
          entry.value is! Map) {
        throw const FormatException('Invalid reparto evidence map');
      }
      evidences[entry.key as String] = RepartoEvidenceJournalRecord.fromJson(
        Map<String, dynamic>.from(entry.value as Map),
      );
    }
    final confirmationFingerprint = json['confirmationFingerprint'];
    final confirmationIdempotencyKey = json['confirmationIdempotencyKey'];
    final decodedState = RepartoOperationState.values.byName(stateName);
    final confirmationId = normalizeRepartoServerId(json['confirmationId']);
    final cobroId = normalizeRepartoServerId(json['cobroId']);
    final state = version == 1 &&
            decodedState == RepartoOperationState.acknowledged &&
            confirmationId == null
        ? RepartoOperationState.manualReview
        : decodedState;
    if ((confirmationFingerprint != null &&
            (confirmationFingerprint is! String ||
                !RegExp(r'^[a-f0-9]{64}$')
                    .hasMatch(confirmationFingerprint))) ||
        (confirmationIdempotencyKey != null &&
            (confirmationIdempotencyKey is! String ||
                !RegExp(r'^[A-Za-z0-9_.:-]{8,128}$')
                    .hasMatch(confirmationIdempotencyKey))) ||
        (confirmationId != null && !isValidRepartoServerId(confirmationId)) ||
        (cobroId != null && !isValidRepartoServerId(cobroId))) {
      throw const FormatException('Invalid confirmation identity metadata');
    }
    final hasConfirmationIdentity = confirmationFingerprint != null ||
        confirmationIdempotencyKey != null ||
        occurredAt != null;
    if (hasConfirmationIdentity &&
        (confirmationFingerprint == null ||
            confirmationIdempotencyKey == null ||
            occurredAt == null)) {
      throw const FormatException('Incomplete confirmation identity metadata');
    }
    if (state == RepartoOperationState.acknowledged &&
        (!hasConfirmationIdentity || confirmationId == null)) {
      throw const FormatException('Invalid acknowledged reparto tombstone');
    }
    if ((state == RepartoOperationState.ready ||
            state == RepartoOperationState.submitting) &&
        !hasConfirmationIdentity) {
      throw const FormatException(
        'Confirmation identity is required for the operation state',
      );
    }
    return RepartoConfirmationJournalEntry(
      deliveryId: rawDeliveryId,
      state: state,
      evidences:
          Map<String, RepartoEvidenceJournalRecord>.unmodifiable(evidences),
      confirmationFingerprint: confirmationFingerprint as String?,
      confirmationIdempotencyKey: confirmationIdempotencyKey as String?,
      confirmationId: confirmationId,
      cobroId: cobroId,
      occurredAt: occurredAt,
    );
  }
}

abstract interface class RepartoConfirmationJournalStore {
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId);

  Future<void> write(RepartoConfirmationJournalEntry entry);

  Future<void> delete(String deliveryId);
}

class RepartoConfirmationJournalCodec {
  const RepartoConfirmationJournalCodec._();

  static RepartoConfirmationJournalEntry? decode({
    required String requestedDeliveryId,
    required bool containsKey,
    required Object? raw,
  }) {
    if (!containsKey) return null;
    if (raw is! String) {
      throw const RepartoJournalCorruptionException(
        'El registro local de la operación no es válido.',
      );
    }
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) {
        throw const FormatException('Journal root must be a map');
      }
      final entry = RepartoConfirmationJournalEntry.fromJson(
        Map<String, dynamic>.from(decoded),
      );
      if (entry.deliveryId != requestedDeliveryId) {
        throw const FormatException('Journal deliveryId mismatch');
      }
      return entry;
    } catch (error) {
      if (error is RepartoJournalCorruptionException) rethrow;
      throw const RepartoJournalCorruptionException(
        'El registro local de la operación no es válido.',
      );
    }
  }
}

class HiveRepartoConfirmationJournalStore
    implements RepartoConfirmationJournalStore {
  static const String _boxName = 'reparto_confirmation_journal_v1';

  Box<dynamic>? _box;

  Future<Box<dynamic>> _getBox() async {
    final current = _box;
    if (current != null && current.isOpen) return current;
    _box = await HiveSecureBox.open<dynamic>(_boxName);
    return _box!;
  }

  @override
  Future<RepartoConfirmationJournalEntry?> read(String deliveryId) async {
    final normalized = deliveryId.trim();
    final box = await _getBox();
    return RepartoConfirmationJournalCodec.decode(
      requestedDeliveryId: normalized,
      containsKey: box.containsKey(normalized),
      raw: box.get(normalized),
    );
  }

  @override
  Future<void> write(RepartoConfirmationJournalEntry entry) async {
    await (await _getBox()).put(entry.deliveryId, jsonEncode(entry.toJson()));
  }

  @override
  Future<void> delete(String deliveryId) async {
    await (await _getBox()).delete(deliveryId.trim());
  }
}

class RepartoConfirmationJournal {
  RepartoConfirmationJournal(
    this._store, {
    String Function()? keyGenerator,
  }) : _keyGenerator = keyGenerator ?? _defaultKey;

  final RepartoConfirmationJournalStore _store;
  final String Function() _keyGenerator;

  Future<RepartoConfirmationJournalEntry> loadOrCreate(
    String deliveryId,
  ) async {
    final normalized = deliveryId.trim();
    if (normalized.isEmpty) {
      throw const FormatException('deliveryId is required');
    }
    final existing = await _store.read(normalized);
    if (existing != null) return existing;
    final created = RepartoConfirmationJournalEntry(
      deliveryId: normalized,
      state: RepartoOperationState.draft,
      evidences: const <String, RepartoEvidenceJournalRecord>{},
    );
    await _store.write(created);
    return created;
  }

  Future<RepartoEvidenceJournalRecord> reserveEvidence({
    required String deliveryId,
    required String slot,
    required String fingerprint,
  }) async {
    if (!repartoCanonicalEvidenceSlots.contains(slot)) {
      throw const FormatException(
        'Evidence slot is not part of the canonical reparto contract',
      );
    }
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint)) {
      throw const FormatException(
        'Evidence fingerprint must be a canonical SHA-256 hash',
      );
    }
    var entry = await loadOrCreate(deliveryId);
    ensureActive(entry);
    final existing = entry.evidences[slot];
    if (existing != null && existing.fingerprint == fingerprint) {
      return existing;
    }
    if (entry.confirmationFingerprint != null) {
      await _store
          .write(entry.copyWith(state: RepartoOperationState.manualReview));
      throw const RepartoConfirmationConflictException();
    }
    final record = RepartoEvidenceJournalRecord(
      fingerprint: fingerprint,
      idempotencyKey: _keyGenerator(),
    );
    final evidences = Map<String, RepartoEvidenceJournalRecord>.from(
      entry.evidences,
    )..[slot] = record;
    entry = entry.copyWith(
      state: RepartoOperationState.uploading,
      evidences: evidences,
    );
    await _store.write(entry);
    return record;
  }

  Future<void> markEvidenceUploaded({
    required String deliveryId,
    required String slot,
    required String evidenceId,
  }) async {
    final entry = await loadOrCreate(deliveryId);
    ensureActive(entry);
    final record = entry.evidences[slot];
    if (record == null) throw StateError('Evidence slot was not reserved');
    final evidences = Map<String, RepartoEvidenceJournalRecord>.from(
      entry.evidences,
    )..[slot] = record.copyWith(evidenceId: evidenceId);
    await _store.write(entry.copyWith(evidences: evidences));
  }

  Future<void> writeEntry(RepartoConfirmationJournalEntry entry) async {
    final current = await _store.read(entry.deliveryId);
    if (current != null) ensureActive(current);
    if (entry.state == RepartoOperationState.ready ||
        entry.state == RepartoOperationState.submitting) {
      ensureConfirmationIdentity(entry);
    }
    await _store.write(entry);
  }

  Future<void> markManualReview(String deliveryId) async {
    final entry = await loadOrCreate(deliveryId);
    ensureActive(entry);
    await _store.write(
      entry.copyWith(state: RepartoOperationState.manualReview),
    );
  }

  /// Drop a local journal that is not acknowledged so the driver can confirm.
  /// Acknowledged deliveries stay locked to avoid duplicate confirms.
  Future<void> resetIfNotAcknowledged(String deliveryId) async {
    final normalized = deliveryId.trim();
    final entry = await _store.read(normalized);
    if (entry == null) return;
    if (entry.state == RepartoOperationState.acknowledged) {
      throw const RepartoAlreadyAcknowledgedException();
    }
    await _store.delete(normalized);
  }

  /// Hive tombstone without a live delivered albaran greys CONFIRMAR forever.
  /// Only keep acknowledged when the route still shows the delivery as done.
  Future<void> clearStaleAcknowledgedIfOpen(String deliveryId) async {
    final normalized = deliveryId.trim();
    final entry = await _store.read(normalized);
    if (entry == null) return;
    if (entry.state != RepartoOperationState.acknowledged) {
      await _store.delete(normalized);
      return;
    }
    await _store.delete(normalized);
  }

  Future<RepartoConfirmationJournalEntry> recoverSubmittingForRetry(
    String deliveryId,
  ) async {
    final entry = await _store.read(deliveryId.trim());
    if (entry == null || entry.state != RepartoOperationState.submitting) {
      throw const RepartoConfirmationConflictException();
    }
    ensureConfirmationIdentity(entry);
    final manualReview =
        entry.copyWith(state: RepartoOperationState.manualReview);
    await _store.write(manualReview);
    final ready = manualReview.copyWith(state: RepartoOperationState.ready);
    await _store.write(ready);
    return ready;
  }

  Future<void> acknowledge(
    String deliveryId, {
    required String expectedFingerprint,
    required String expectedIdempotencyKey,
    required String confirmationId,
    String? cobroId,
  }) async {
    final entry = await loadOrCreate(deliveryId);
    ensureConfirmationIdentity(entry);
    if (!isValidRepartoServerId(confirmationId) ||
        (cobroId != null && !isValidRepartoServerId(cobroId))) {
      if (entry.state != RepartoOperationState.acknowledged) {
        await _store.write(
          entry.copyWith(state: RepartoOperationState.manualReview),
        );
      }
      throw const RepartoJournalCorruptionException(
        'La confirmacion del servidor no tiene un identificador valido.',
      );
    }
    if (entry.confirmationFingerprint != expectedFingerprint ||
        entry.confirmationIdempotencyKey != expectedIdempotencyKey) {
      if (entry.state != RepartoOperationState.acknowledged) {
        await _store.write(
          entry.copyWith(state: RepartoOperationState.manualReview),
        );
      }
      throw const RepartoConfirmationConflictException();
    }
    if (entry.state == RepartoOperationState.acknowledged) {
      if (entry.confirmationId != confirmationId || entry.cobroId != cobroId) {
        throw const RepartoConfirmationConflictException();
      }
      return;
    }
    if (!isValidRepartoServerId(confirmationId)) {
      throw const RepartoJournalCorruptionException(
        'La confirmación del servidor no tiene un identificador válido.',
      );
    }
    if (cobroId != null && !isValidRepartoServerId(cobroId)) {
      throw const RepartoJournalCorruptionException(
        'El cobro del servidor no tiene un identificador válido.',
      );
    }
    await _store.write(
      entry.copyWith(
        state: RepartoOperationState.acknowledged,
        evidences: const <String, RepartoEvidenceJournalRecord>{},
        confirmationId: confirmationId,
        cobroId: cobroId,
      ),
    );
  }

  Future<String> receiptConfirmationId(String deliveryId) async {
    final entry = await _store.read(deliveryId.trim());
    if (entry == null || entry.state != RepartoOperationState.acknowledged) {
      throw const RepartoReceiptUnavailableException();
    }
    final confirmationId = entry.confirmationId;
    if (confirmationId == null || !isValidRepartoServerId(confirmationId)) {
      throw const RepartoReceiptUnavailableException();
    }
    return confirmationId;
  }

  Future<String?> knownConfirmationId(String deliveryId) async {
    final entry = await _store.read(deliveryId.trim());
    final confirmationId = entry?.confirmationId;
    return confirmationId != null && isValidRepartoServerId(confirmationId)
        ? confirmationId
        : null;
  }

  void ensureActive(RepartoConfirmationJournalEntry entry) {
    if (entry.state == RepartoOperationState.acknowledged) {
      throw const RepartoAlreadyAcknowledgedException();
    }
    if (entry.state == RepartoOperationState.manualReview) {
      throw const RepartoConfirmationConflictException();
    }
  }

  void ensureConfirmationIdentity(RepartoConfirmationJournalEntry entry) {
    final fingerprint = entry.confirmationFingerprint;
    final idempotencyKey = entry.confirmationIdempotencyKey;
    if (fingerprint == null ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint) ||
        idempotencyKey == null ||
        !RegExp(r'^[A-Za-z0-9_.:-]{8,128}$').hasMatch(idempotencyKey) ||
        entry.occurredAt == null) {
      throw const RepartoJournalCorruptionException(
        'La operación no tiene identidad de confirmación válida.',
      );
    }
  }

  static String _defaultKey() {
    final random = Random.secure();
    final values = List<int>.generate(16, (_) => random.nextInt(256));
    return 'rep-${base64UrlEncode(values).replaceAll('=', '')}';
  }
}

class RepartoConfirmationConflictException implements Exception {
  const RepartoConfirmationConflictException();

  @override
  String toString() =>
      'La operación pendiente cambió y requiere revisión manual.';
}

class RepartoJournalCorruptionException implements Exception {
  const RepartoJournalCorruptionException(this.message);

  final String message;

  @override
  String toString() => message;
}

class RepartoAlreadyAcknowledgedException implements Exception {
  const RepartoAlreadyAcknowledgedException();

  @override
  String toString() =>
      'La operación ya fue confirmada y no se puede volver a enviar.';
}

class RepartoReceiptUnavailableException implements Exception {
  const RepartoReceiptUnavailableException();

  @override
  String toString() =>
      'El recibo todavía no está disponible. Reintenta cuando la confirmación quede sincronizada.';
}

bool isValidRepartoServerId(String value) =>
    value == value.trim() &&
    RegExp(r'^[A-Za-z0-9_.:-]{1,128}$').hasMatch(value);

/// Coerce JSON/DB2 identity scalars to a trimmed server id string.
String? normalizeRepartoServerId(Object? value) {
  if (value == null) return null;
  if (value is String) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
  if (value is num) {
    if (value is double && (value.isNaN || value.isInfinite)) return null;
    if (value == value.roundToDouble()) {
      return value.toInt().toString();
    }
    return value.toString();
  }
  return null;
}
