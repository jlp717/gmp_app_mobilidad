import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/storage/hive_secure_box.dart';
import 'package:hive_flutter/hive_flutter.dart';

/// Ring buffer of recent SyncQueue attempts (last [_maxEntries]).
class SyncAuditEntry {
  SyncAuditEntry({
    required this.opId,
    required this.type,
    required this.endpoint,
    required this.startedAt,
    required this.success,
    this.finishedAt,
    this.httpStatus,
    this.error,
  });

  factory SyncAuditEntry.fromJson(Map<String, dynamic> json) => SyncAuditEntry(
        opId: json['opId']?.toString() ?? '',
        type: json['type']?.toString() ?? '',
        endpoint: json['endpoint']?.toString() ?? '',
        startedAt: DateTime.tryParse(json['startedAt']?.toString() ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        finishedAt: json['finishedAt'] != null
            ? DateTime.tryParse(json['finishedAt'].toString())
            : null,
        httpStatus: json['httpStatus'] is int
            ? json['httpStatus'] as int
            : int.tryParse(json['httpStatus']?.toString() ?? ''),
        success: json['success'] == true,
        error: json['error']?.toString(),
      );

  final String opId;
  final String type;
  final String endpoint;
  final DateTime startedAt;
  final DateTime? finishedAt;
  final int? httpStatus;
  final bool success;
  final String? error;

  Map<String, dynamic> toJson() => {
        'opId': opId,
        'type': type,
        'endpoint': endpoint,
        'startedAt': startedAt.toIso8601String(),
        'finishedAt': finishedAt?.toIso8601String(),
        'httpStatus': httpStatus,
        'success': success,
        'error': error,
      };
}

/// Hive-backed audit trail for offline sync attempts.
class SyncAuditLog {
  static const String _boxName = 'sync_audit_log';
  static const String _entriesKey = 'entries';
  static const int _maxEntries = 100;

  static Box<String>? _box;

  static Future<void> initialize() async {
    _box ??= await HiveSecureBox.open<String>(
      _boxName,
      migrateUnencryptedLegacy: true,
    );
  }

  /// Newest-first snapshot for debug / settings UI.
  static List<SyncAuditEntry> recent({int limit = _maxEntries}) {
    final all = _readAll();
    if (limit >= all.length) return List.unmodifiable(all);
    return List.unmodifiable(all.take(limit));
  }

  static Future<void> record({
    required String opId,
    required String type,
    required String endpoint,
    required DateTime startedAt,
    required bool success,
    DateTime? finishedAt,
    int? httpStatus,
    String? error,
  }) async {
    if (_box == null) {
      try {
        await initialize();
      } catch (e) {
        debugPrint('[SyncAuditLog] init failed: $e');
        return;
      }
    }
    final entry = SyncAuditEntry(
      opId: opId,
      type: type,
      endpoint: endpoint,
      startedAt: startedAt,
      finishedAt: finishedAt ?? DateTime.now(),
      httpStatus: httpStatus,
      success: success,
      error: error,
    );
    final next = <SyncAuditEntry>[entry, ..._readAll()];
    if (next.length > _maxEntries) {
      next.removeRange(_maxEntries, next.length);
    }
    await _box!.put(
      _entriesKey,
      jsonEncode(next.map((e) => e.toJson()).toList(growable: false)),
    );
  }

  static List<SyncAuditEntry> _readAll() {
    final raw = _box?.get(_entriesKey);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];
      return decoded
          .whereType<Map>()
          .map((m) => SyncAuditEntry.fromJson(Map<String, dynamic>.from(m)))
          .toList(growable: false);
    } catch (e) {
      debugPrint('[SyncAuditLog] corrupt entries ignored: $e');
      return [];
    }
  }

  @visibleForTesting
  static Future<void> debugClear() async {
    await _box?.delete(_entriesKey);
  }
}
