import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_audit_log.dart';
import 'package:gmp_app_mobilidad/core/offline/sync_mutation_policy.dart';
import 'package:gmp_app_mobilidad/core/storage/hive_secure_box.dart';
import 'package:hive_flutter/hive_flutter.dart';

/// Represents an offline mutation (write operation) that needs to be
/// synced when connectivity is restored.
class SyncOperation {
  SyncOperation({
    required this.id,
    required this.type,
    required this.endpoint,
    required this.method,
    required this.payload,
    this.headers,
    this.attempts = 0,
    this.createdAt,
    this.lastAttemptAt,
    this.lastError,
    this.failedAt,
    this.sessionScope,
  });

  factory SyncOperation.fromJson(Map<String, dynamic> json) => SyncOperation(
        id: json['id'] as String,
        type: json['type'] as String,
        endpoint: json['endpoint'] as String,
        method: json['method'] as String,
        payload: Map<String, dynamic>.from(json['payload'] as Map),
        headers: json['headers'] is Map
            ? Map<String, String>.from(
                (json['headers'] as Map).map(
                  (k, v) => MapEntry(k.toString(), v.toString()),
                ),
              )
            : null,
        attempts: json['attempts'] as int? ?? 0,
        createdAt: json['createdAt'] != null
            ? DateTime.parse(json['createdAt'] as String)
            : null,
        lastAttemptAt: json['lastAttemptAt'] != null
            ? DateTime.parse(json['lastAttemptAt'] as String)
            : null,
        lastError: json['lastError'] as String?,
        failedAt: json['failedAt'] != null
            ? DateTime.parse(json['failedAt'] as String)
            : null,
        sessionScope: json['sessionScope'] as String?,
      );

  final String id;
  final String type; // 'create_cobro', 'confirm_delivery', etc.
  final String endpoint; // '/repartidor-finanzas/cobros'
  final String method; // 'POST', 'PUT', 'DELETE'
  final Map<String, dynamic> payload;
  final Map<String, String>? headers;
  int attempts;
  DateTime? createdAt;
  DateTime? lastAttemptAt;
  String? lastError;
  DateTime? failedAt;
  String? sessionScope;

  bool get isFailed => failedAt != null;

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'endpoint': endpoint,
        'method': method,
        'payload': payload,
        if (headers != null) 'headers': headers,
        'attempts': attempts,
        'createdAt': createdAt?.toIso8601String(),
        'lastAttemptAt': lastAttemptAt?.toIso8601String(),
        'lastError': lastError,
        'failedAt': failedAt?.toIso8601String(),
        'sessionScope': sessionScope,
      };
}

class SyncProcessResult {
  const SyncProcessResult({
    required this.synced,
    required this.failed,
    required this.pending,
    this.skippedBackoff = 0,
  });

  final int synced;
  final int failed;
  final int pending;
  final int skippedBackoff;
}

class _HttpMutationResult {
  const _HttpMutationResult({
    required this.statusCode,
    required this.body,
  });

  final int statusCode;
  final Map<String, dynamic> body;
}

/// Queue of offline mutations that are processed when connectivity is restored.
/// Backed by Hive for persistence across app restarts.
class SyncQueueService {
  SyncQueueService._();
  static const String _boxName = 'sync_queue';
  static const int _maxAttempts = SyncMutationPolicy.defaultMaxAttempts;
  static const Duration _maxAge =
      Duration(days: 7); // Stale operations require manual review.
  static const String _anonymousScope = 'anonymous';

  static SyncQueueService? _instance;
  Box<String>? _box;
  String _sessionScope = _anonymousScope;

  static SyncQueueService get instance {
    _instance ??= SyncQueueService._();
    return _instance!;
  }

  Future<void> initialize() async {
    _box = await HiveSecureBox.open<String>(
      _boxName,
      migrateUnencryptedLegacy: true,
    );
    await SyncAuditLog.initialize();
    await _purgeStale();
    debugPrint(
      '[SyncQueue] Initialized with ${_box?.length ?? 0} pending operations',
    );
  }

  int get pendingCount =>
      pending.where((operation) => !operation.isFailed).length;
  int get failedCount => failed.length;

  List<SyncOperation> get failed =>
      pending.where((operation) => operation.isFailed).toList(growable: false);

  void setScope(String rawScope) {
    final normalized = rawScope.trim();
    _sessionScope = normalized.isEmpty ? _anonymousScope : normalized;
    debugPrint('[SyncQueue] Session scope changed');
  }

  void clearScope() {
    _sessionScope = _anonymousScope;
    debugPrint('[SyncQueue] Session scope cleared');
  }

  /// Enqueue a new sync operation.
  Future<void> enqueue(SyncOperation operation) async {
    if (_box == null) return;
    operation.createdAt ??= DateTime.now();
    operation.sessionScope ??= _sessionScope;
    await _box!.put(operation.id, jsonEncode(operation.toJson()));
    debugPrint('[SyncQueue] Enqueued: ${operation.type}');
  }

  /// Remove an operation after successful sync.
  Future<void> dequeue(String id) async {
    await _box?.delete(id);
  }

  /// Resets a manual-review or backoff operation so the next drain retries
  /// it immediately (EARS-12). Used by the sync status panel.
  Future<void> retryManual(SyncOperation operation) async {
    if (_box == null) return;
    operation
      ..failedAt = null
      ..lastError = null
      ..attempts = 0;
    await _box!.put(operation.id, jsonEncode(operation.toJson()));
    debugPrint('[SyncQueue] Manual retry armed: ${operation.type}');
  }

  /// Get all pending operations.
  List<SyncOperation> get pending {
    if (_box == null) return [];
    return _box!.keys
        .map((key) {
          final raw = _box!.get(key);
          if (raw == null) return null;
          return SyncOperation.fromJson(
            jsonDecode(raw) as Map<String, dynamic>,
          );
        })
        .whereType<SyncOperation>()
        .where((operation) => operation.sessionScope == _sessionScope)
        .toList()
      ..sort(
        (a, b) => (a.createdAt ?? DateTime.now())
            .compareTo(b.createdAt ?? DateTime.now()),
      );
  }

  /// Process all pending operations.
  /// Returns the number of successfully processed operations.
  Future<int> processAll() async {
    final result = await processAllWithResult();
    return result.synced;
  }

  /// Process queue with strong server-acceptance verification.
  /// Never silently drops: dequeue only on verified success / idempotent 409.
  Future<SyncProcessResult> processAllWithResult() async {
    final ops = pending;
    if (ops.isEmpty) {
      return SyncProcessResult(
        synced: 0,
        failed: failedCount,
        pending: pendingCount,
      );
    }

    var successCount = 0;
    var skippedBackoff = 0;
    final now = DateTime.now();

    for (final op in ops) {
      if (op.isFailed) {
        debugPrint(
          '[SyncQueue] Operation ${op.id} failed; manual review required '
          '(${op.lastError ?? 'sin detalle'})',
        );
        continue;
      }

      if (!SyncMutationPolicy.isBackoffElapsed(
        attempts: op.attempts,
        now: now,
        anchor: op.lastAttemptAt ?? op.createdAt,
      )) {
        skippedBackoff++;
        debugPrint('[SyncQueue] Operation in backoff: ${op.type}');
        continue;
      }

      final startedAt = DateTime.now();
      int? httpStatus;
      try {
        final response = await _processOperation(op);
        httpStatus = response.statusCode;

        if (!SyncMutationPolicy.isAcceptedSuccess(
          type: op.type,
          body: response.body,
          httpStatus: response.statusCode,
        )) {
          throw StateError(
            'Servidor no confirmo exito (HTTP ${response.statusCode})',
          );
        }

        if (op.type == 'confirm_delivery') {
          await _reconcileConfirmDelivery(op, response.body);
        }

        await dequeue(op.id);
        successCount++;
        await SyncAuditLog.record(
          opId: op.id,
          type: op.type,
          endpoint: op.endpoint,
          startedAt: startedAt,
          finishedAt: DateTime.now(),
          httpStatus: httpStatus,
          success: true,
        );
        debugPrint('[SyncQueue] Synced: ${op.type} HTTP $httpStatus');
      } catch (e) {
        final apiError = e is ApiException ? e : null;
        httpStatus ??= apiError?.statusCode;

        if (apiError != null &&
            SyncMutationPolicy.isIdempotentConflict(
              type: op.type,
              statusCode: apiError.statusCode,
              code: apiError.code,
            )) {
          final reconciled = await _reconcileIdempotentConflict(op, apiError);
          if (reconciled) {
            await dequeue(op.id);
            successCount++;
            await SyncAuditLog.record(
              opId: op.id,
              type: op.type,
              endpoint: op.endpoint,
              startedAt: startedAt,
              finishedAt: DateTime.now(),
              httpStatus: 409,
              success: true,
              error: 'idempotent_conflict:${apiError.code}',
            );
            debugPrint('[SyncQueue] Idempotent 409 accepted: ${op.type}');
            continue;
          }
        }

        op.attempts++;
        op.lastAttemptAt = DateTime.now();
        op.lastError = _formatLastError(e);
        final markFailed = SyncMutationPolicy.shouldMarkManualReview(
          attemptsAfterFailure: op.attempts,
          maxAttempts: _maxAttempts,
          statusCode: apiError?.statusCode,
          code: apiError?.code,
          type: op.type,
        );
        if (markFailed) {
          op.failedAt ??= DateTime.now();
          await _box?.put(op.id, jsonEncode(op.toJson()));
          debugPrint(
            '[SyncQueue] Manual review: ${op.type} — ${op.lastError}',
          );
        } else {
          await _box?.put(op.id, jsonEncode(op.toJson()));
          final delay = SyncMutationPolicy.calculateBackoff(op.attempts);
          debugPrint(
            '[SyncQueue] Retry ${op.attempts}/$_maxAttempts in '
            '${delay.inSeconds}s: ${op.lastError}',
          );
        }
        await SyncAuditLog.record(
          opId: op.id,
          type: op.type,
          endpoint: op.endpoint,
          startedAt: startedAt,
          finishedAt: DateTime.now(),
          httpStatus: httpStatus,
          success: false,
          error: op.lastError,
        );
      }
    }

    return SyncProcessResult(
      synced: successCount,
      failed: failedCount,
      pending: pendingCount,
      skippedBackoff: skippedBackoff,
    );
  }

  String _formatLastError(Object error) {
    if (error is ApiException) {
      final status = error.statusCode ?? 0;
      final code = error.code;
      final base = code != null ? '[$code] ${error.message}' : error.message;
      return 'HTTP $status: ${_shortError(base)}';
    }
    return _shortError(error);
  }

  String _shortError(Object error) {
    final text = error.toString();
    return text.length <= 160 ? text : text.substring(0, 160);
  }

  /// Move old operations to manual review instead of deleting business writes.
  Future<void> _purgeStale() async {
    if (_box == null) return;
    final cutoff = DateTime.now().subtract(_maxAge);
    var stale = 0;
    final corrupt = <String>[];
    for (final key in _box!.keys) {
      final raw = _box!.get(key);
      if (raw == null) continue;
      try {
        final op =
            SyncOperation.fromJson(jsonDecode(raw) as Map<String, dynamic>);
        if (!op.isFailed && (op.createdAt ?? DateTime.now()).isBefore(cutoff)) {
          op.failedAt = DateTime.now();
          op.lastError ??=
              'Operacion offline antigua preservada para revision manual';
          await _box!.put(key, jsonEncode(op.toJson()));
          stale++;
        }
      } catch (_) {
        corrupt.add(key.toString());
      }
    }
    for (final key in corrupt) {
      await _box!.delete(key);
    }
    if (stale > 0 || corrupt.isNotEmpty) {
      debugPrint(
        '[SyncQueue] Marked $stale stale operations for manual review and removed ${corrupt.length} corrupt entries',
      );
    }
  }

  Future<_HttpMutationResult> _processOperation(SyncOperation op) async {
    var cleanPayload = Map<String, dynamic>.from(op.payload)
      ..remove('_journalFingerprint')
      ..remove('_journalIdempotencyKey');

    if (op.type == 'confirm_delivery') {
      cleanPayload = await _resolveDeferredEvidence(op, cleanPayload);
    }

    try {
      late final Response<dynamic> response;
      final options = Options(
        headers:
            op.headers == null ? null : Map<String, String>.from(op.headers!),
        extra: <String, dynamic>{
          if (op.type == 'confirm_delivery' ||
              (op.headers?.containsKey('Idempotency-Key') ?? false))
            'idempotent': true,
        },
      );

      switch (op.method) {
        case 'POST':
          response = await ApiClient.dio.post(
            op.endpoint,
            data: cleanPayload,
            options: options,
          );
        case 'PUT':
          response = await ApiClient.dio.put(
            op.endpoint,
            data: cleanPayload,
            options: options,
          );
        case 'DELETE':
          response = await ApiClient.dio.delete(
            op.endpoint,
            data: cleanPayload.isNotEmpty ? cleanPayload : null,
            options: options,
          );
        default:
          throw UnsupportedError('Method ${op.method} not supported for sync');
      }

      final status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        throw ApiException(
          'HTTP $status sin cuerpo de exito',
          statusCode: status,
        );
      }

      final raw = response.data;
      final body = raw is Map
          ? Map<String, dynamic>.from(raw)
          : <String, dynamic>{'success': true, 'raw': raw};

      return _HttpMutationResult(statusCode: status, body: body);
    } on DioException catch (e) {
      throw _mapDioException(e);
    }
  }

  ApiException _mapDioException(DioException e) {
    final status = e.response?.statusCode ?? 0;
    final data = e.response?.data;
    String? code;
    String? confirmationId;
    var message = e.message ?? 'Error de red durante sync';
    if (data is Map) {
      code = data['code']?.toString();
      confirmationId = data['confirmationId']?.toString();
      message =
          data['error']?.toString() ?? data['message']?.toString() ?? message;
    }
    return ApiException(
      message,
      statusCode: status,
      code: code,
      confirmationId: confirmationId,
    );
  }

  Future<bool> _reconcileIdempotentConflict(
    SyncOperation op,
    ApiException error,
  ) async {
    if (op.type != 'confirm_delivery') {
      return true;
    }
    final deliveryId =
        (op.payload['itemId'] ?? op.payload['deliveryId'])?.toString().trim();
    final fingerprint = op.payload['_journalFingerprint']?.toString();
    final idempotencyKey = op.headers?['Idempotency-Key'] ??
        op.payload['_journalIdempotencyKey']?.toString();
    final confirmationId = error.confirmationId;
    if (deliveryId == null ||
        deliveryId.isEmpty ||
        fingerprint == null ||
        idempotencyKey == null ||
        confirmationId == null) {
      debugPrint(
        '[SyncQueue] 409 idempotent but journal keys incomplete — keep queued',
      );
      return false;
    }
    final reconciler = confirmDeliveryReconciler;
    if (reconciler == null) {
      debugPrint('[SyncQueue] 409 without reconciler — keep queued');
      return false;
    }
    try {
      await reconciler(
        deliveryId: deliveryId,
        confirmationId: confirmationId,
        cobroId: null,
        fingerprint: fingerprint,
        idempotencyKey: idempotencyKey,
      );
      return true;
    } catch (e) {
      debugPrint('[SyncQueue] 409 reconcile failed: $e');
      return false;
    }
  }

  /// Reconcile the local delivery journal after an accepted offline sync.
  ///
  /// A server-side confirmation is not complete from the app's point of view
  /// until its local journal is acknowledged too. Propagating a failure here
  /// deliberately preserves the queued idempotent operation for retry instead
  /// of silently losing the reconciliation work.
  Future<void> _reconcileConfirmDelivery(
    SyncOperation op,
    Map<String, dynamic> response,
  ) async {
    final deliveryId =
        (op.payload['itemId'] ?? op.payload['deliveryId'])?.toString().trim();
    final acknowledgement = response['confirmation'] is Map
        ? Map<String, dynamic>.from(response['confirmation'] as Map)
        : response;
    final confirmationId = (acknowledgement['confirmationId'] ??
            acknowledgement['id'] ??
            response['confirmationId'])
        ?.toString()
        .trim();
    final cobroId = acknowledgement['cobroId']?.toString();
    final fingerprint = op.payload['_journalFingerprint']?.toString().trim();
    final idempotencyKey = op.headers?['Idempotency-Key'] ??
        op.payload['_journalIdempotencyKey']?.toString();
    final reconciler = confirmDeliveryReconciler;

    if (deliveryId == null ||
        deliveryId.isEmpty ||
        confirmationId == null ||
        confirmationId.isEmpty ||
        fingerprint == null ||
        fingerprint.isEmpty ||
        idempotencyKey == null ||
        idempotencyKey.isEmpty) {
      throw StateError(
        'confirm_delivery aceptada sin claves suficientes para '
        'reconciliar el diario',
      );
    }
    if (reconciler == null) {
      throw StateError(
        'confirm_delivery aceptada sin reconciliador de diario disponible',
      );
    }

    await reconciler(
      deliveryId: deliveryId,
      confirmationId: confirmationId,
      cobroId: cobroId,
      fingerprint: fingerprint,
      idempotencyKey: idempotencyKey,
    );
  }

  /// Optional hook set by app bootstrap / repartidor feature.
  static Future<void> Function({
    required String deliveryId,
    required String confirmationId,
    required String fingerprint,
    required String idempotencyKey,
    String? cobroId,
  })? confirmDeliveryReconciler;

  /// Optional hook installed by the repartidor feature. Resolves deferred
  /// evidence slots (inbox bytes -> upload -> evidence id) BEFORE the queued
  /// confirmation POST leaves the device. Null resolver on a deferred payload
  /// fails closed and keeps the operation queued.
  static Future<Map<String, String>> Function({
    required String deliveryId,
    String? repartidorId,
    required Map<String, dynamic> pendingEvidence,
  })? confirmEvidenceResolver;

  Future<Map<String, dynamic>> _resolveDeferredEvidence(
    SyncOperation op,
    Map<String, dynamic> payload,
  ) async {
    final delivery = payload['delivery'];
    if (delivery is! Map) return payload;
    final pending = delivery['pendingEvidence'];
    if (pending is! Map) return payload;

    final resolver = confirmEvidenceResolver;
    if (resolver == null) {
      throw StateError(
        'Confirmacion diferida sin resolvedor de evidencias disponible',
      );
    }
    final deliveryId = delivery['itemId']?.toString().trim();
    if (deliveryId == null || deliveryId.isEmpty) {
      throw StateError('Confirmacion diferida sin entrega');
    }
    final resolved = await resolver(
      deliveryId: deliveryId,
      repartidorId: delivery['repartidorId']?.toString(),
      pendingEvidence: Map<String, dynamic>.from(pending),
    );

    final signatureId = resolved['signature'];
    final expectedSignature = pending['firma'] is Map;
    if (expectedSignature && (signatureId == null || signatureId.isEmpty)) {
      throw StateError(
        'Evidencia de firma pendiente sin id resuelto por el servidor',
      );
    }
    if (signatureId != null && signatureId.isNotEmpty) {
      delivery['firma'] = signatureId;
    }

    final photoIds = <String>[];
    for (final slot in const <String>['photo-0', 'photo-1', 'photo-2']) {
      final id = resolved[slot];
      if (id != null && id.isNotEmpty) photoIds.add(id);
    }
    final expectedPhotos =
        pending['fotos'] is List ? (pending['fotos'] as List).length : 0;
    if (photoIds.length != expectedPhotos) {
      throw StateError(
        'Evidencias pendientes incompletas: $expectedPhotos esperadas, '
        '${photoIds.length} resueltas',
      );
    }
    if (photoIds.isNotEmpty) {
      final existing = delivery['evidencias'];
      final merged = existing is List
          ? <String>[...existing.map((id) => id.toString()), ...photoIds]
          : photoIds;
      delivery['evidencias'] = merged;
    }
    delivery.remove('pendingEvidence');
    return payload;
  }

  /// Clear all pending operations.
  Future<void> clear() async {
    await _box?.clear();
    debugPrint('[SyncQueue] Cleared all pending operations');
  }
}
