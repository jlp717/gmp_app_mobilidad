import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
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
    this.attempts = 0,
    this.createdAt,
    this.lastError,
    this.failedAt,
    this.sessionScope,
  });

  final String id;
  final String type; // 'create_cobro', 'confirm_delivery', etc.
  final String endpoint; // '/repartidor-finanzas/cobros'
  final String method; // 'POST', 'PUT', 'DELETE'
  final Map<String, dynamic> payload;
  int attempts;
  DateTime? createdAt;
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
        'attempts': attempts,
        'createdAt': createdAt?.toIso8601String(),
        'lastError': lastError,
        'failedAt': failedAt?.toIso8601String(),
        'sessionScope': sessionScope,
      };

  factory SyncOperation.fromJson(Map<String, dynamic> json) => SyncOperation(
        id: json['id'] as String,
        type: json['type'] as String,
        endpoint: json['endpoint'] as String,
        method: json['method'] as String,
        payload: Map<String, dynamic>.from(json['payload'] as Map),
        attempts: json['attempts'] as int? ?? 0,
        createdAt: json['createdAt'] != null
            ? DateTime.parse(json['createdAt'] as String)
            : null,
        lastError: json['lastError'] as String?,
        failedAt: json['failedAt'] != null
            ? DateTime.parse(json['failedAt'] as String)
            : null,
        sessionScope: json['sessionScope'] as String?,
      );
}

/// Queue of offline mutations that are processed when connectivity is restored.
/// Backed by Hive for persistence across app restarts.
class SyncQueueService {
  static const String _boxName = 'sync_queue';
  static const int _maxAttempts = 5;
  static const Duration _baseDelay = Duration(seconds: 2);
  static const Duration _maxAge =
      Duration(days: 7); // Stale operations require manual review.
  static const String _anonymousScope = 'anonymous';

  static SyncQueueService? _instance;
  Box<String>? _box;
  String _sessionScope = _anonymousScope;

  SyncQueueService._();

  static SyncQueueService get instance {
    _instance ??= SyncQueueService._();
    return _instance!;
  }

  Future<void> initialize() async {
    _box = await HiveSecureBox.open<String>(
      _boxName,
      migrateUnencryptedLegacy: true,
    );
    await _purgeStale();
    debugPrint(
      '[SyncQueue] Initialized with ${_box?.length ?? 0} pending operations',
    );
  }

  int get pendingCount => pending.length;
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
      ..sort((a, b) => (a.createdAt ?? DateTime.now())
          .compareTo(b.createdAt ?? DateTime.now()));
  }

  /// Process all pending operations.
  /// Returns the number of successfully processed operations.
  Future<int> processAll() async {
    final ops = pending;
    if (ops.isEmpty) return 0;

    int successCount = 0;
    for (final op in ops) {
      if (op.isFailed) {
        debugPrint('[SyncQueue] Operation is failed; manual review required');
        continue;
      }

      // Skip if backoff delay not yet elapsed
      final backoff = _calculateBackoff(op.attempts);
      final nextRetry = (op.createdAt ?? DateTime.now()).add(backoff);
      if (DateTime.now().isBefore(nextRetry) && op.attempts > 0) {
        debugPrint(
          '[SyncQueue] Operation in backoff, retry at ${nextRetry.toIso8601String()}',
        );
        continue;
      }

      try {
        await _processOperation(op);
        await dequeue(op.id);
        successCount++;
        debugPrint('[SyncQueue] Synced: ${op.type}');
      } catch (e) {
        op.attempts++;
        op.lastError = e.toString();
        if (_requiresManualReview(e) || op.attempts >= _maxAttempts) {
          op.failedAt ??= DateTime.now();
          await _box?.put(op.id, jsonEncode(op.toJson()));
          debugPrint(
              '[SyncQueue] Preserving failed operation for manual review');
        } else {
          // Update with incremented attempts
          await _box?.put(op.id, jsonEncode(op.toJson()));
          final delay = _calculateBackoff(op.attempts);
          debugPrint(
              '[SyncQueue] Operation failed (${op.attempts}/$_maxAttempts), retry in ${delay.inSeconds}s: ${_shortError(e)}');
        }
      }
    }
    return successCount;
  }

  /// Calculate exponential backoff delay: baseDelay * 2^attempts
  Duration _calculateBackoff(int attempts) {
    final seconds = _baseDelay.inSeconds * (1 << attempts); // 2, 4, 8, 16, 32
    return Duration(seconds: seconds.clamp(2, 300)); // Cap at 5 min
  }

  String _shortError(Object error) {
    final text = error.toString();
    return text.length <= 100 ? text : text.substring(0, 100);
  }

  bool _requiresManualReview(Object error) {
    return error is ApiException &&
        (error.statusCode == 409 || error.statusCode == 412);
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
        corrupt.add(key); // Corrupted entry cannot be recovered safely.
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

  Future<void> _processOperation(SyncOperation op) async {
    switch (op.method) {
      case 'POST':
        await ApiClient.post(op.endpoint, op.payload);
        return;
      case 'PUT':
        await ApiClient.put(op.endpoint, data: op.payload);
        return;
      case 'DELETE':
        await ApiClient.delete(
          op.endpoint,
          data: op.payload.isNotEmpty ? op.payload : null,
        );
        return;
      default:
        throw UnsupportedError('Method ${op.method} not supported for sync');
    }
  }

  /// Clear all pending operations.
  Future<void> clear() async {
    await _box?.clear();
    debugPrint('[SyncQueue] Cleared all pending operations');
  }
}
