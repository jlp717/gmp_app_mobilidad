import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

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
  });

  final String id;
  final String type; // 'create_cobro', 'confirm_delivery', etc.
  final String endpoint; // '/repartidor-finanzas/cobros'
  final String method; // 'POST', 'PUT', 'DELETE'
  final Map<String, dynamic> payload;
  int attempts;
  DateTime? createdAt;
  String? lastError;

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'endpoint': endpoint,
        'method': method,
        'payload': payload,
        'attempts': attempts,
        'createdAt': createdAt?.toIso8601String(),
        'lastError': lastError,
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
      );
}

/// Queue of offline mutations that are processed when connectivity is restored.
/// Backed by Hive for persistence across app restarts.
class SyncQueueService {
  static const String _boxName = 'sync_queue';
  static const int _maxAttempts = 5;
  static const Duration _baseDelay = Duration(seconds: 2);
  static const Duration _maxAge =
      Duration(days: 7); // Stale operations auto-purge

  static SyncQueueService? _instance;
  Box<String>? _box;

  SyncQueueService._();

  static SyncQueueService get instance {
    _instance ??= SyncQueueService._();
    return _instance!;
  }

  Future<void> initialize() async {
    _box = await Hive.openBox<String>(_boxName);
    _purgeStale(); // Clean up expired operations on startup
    debugPrint(
        '[SyncQueue] Initialized with ${_box?.length ?? 0} pending operations');
  }

  int get pendingCount => _box?.length ?? 0;

  /// Enqueue a new sync operation.
  Future<void> enqueue(SyncOperation operation) async {
    if (_box == null) return;
    operation.createdAt ??= DateTime.now();
    await _box!.put(operation.id, jsonEncode(operation.toJson()));
    debugPrint('[SyncQueue] Enqueued: ${operation.type} (${operation.id})');
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
              jsonDecode(raw) as Map<String, dynamic>);
        })
        .whereType<SyncOperation>()
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
      // Skip if backoff delay not yet elapsed
      final backoff = _calculateBackoff(op.attempts);
      final nextRetry = (op.createdAt ?? DateTime.now()).add(backoff);
      if (DateTime.now().isBefore(nextRetry) && op.attempts > 0) {
        debugPrint(
            '[SyncQueue] ${op.id} in backoff, retry at ${nextRetry.toIso8601String()}');
        continue;
      }

      try {
        await _processOperation(op);
        await dequeue(op.id);
        successCount++;
        debugPrint('[SyncQueue] Synced: ${op.type} (${op.id})');
      } catch (e) {
        op.attempts++;
        op.lastError = e.toString();
        if (op.attempts >= _maxAttempts) {
          debugPrint('[SyncQueue] Max attempts reached for ${op.id}, removing');
          await dequeue(op.id);
        } else {
          // Update with incremented attempts
          await _box?.put(op.id, jsonEncode(op.toJson()));
          final delay = _calculateBackoff(op.attempts);
          debugPrint(
              '[SyncQueue] ${op.id} failed (${op.attempts}/$_maxAttempts), retry in ${delay.inSeconds}s: ${e.toString().substring(0, 100)}');
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

  /// Remove operations older than _maxAge.
  void _purgeStale() {
    if (_box == null) return;
    final cutoff = DateTime.now().subtract(_maxAge);
    final stale = <String>[];
    for (final key in _box!.keys) {
      final raw = _box!.get(key);
      if (raw == null) continue;
      try {
        final op =
            SyncOperation.fromJson(jsonDecode(raw) as Map<String, dynamic>);
        if ((op.createdAt ?? DateTime.now()).isBefore(cutoff)) {
          stale.add(key);
        }
      } catch (_) {
        stale.add(key); // Corrupted entry, remove it
      }
    }
    for (final key in stale) {
      _box!.delete(key);
    }
    if (stale.isNotEmpty) {
      debugPrint(
          '[SyncQueue] Purged ${stale.length} stale operations (>${_maxAge.inDays} days old)');
    }
  }

  Future<void> _processOperation(SyncOperation op) async {
    switch (op.method) {
      case 'POST':
        await ApiClient.post(op.endpoint, op.payload);
        break;
      case 'PUT':
        await ApiClient.put(op.endpoint, data: op.payload);
        break;
      case 'DELETE':
        await ApiClient.delete(op.endpoint,
            data: op.payload.isNotEmpty ? op.payload : null);
        break;
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
