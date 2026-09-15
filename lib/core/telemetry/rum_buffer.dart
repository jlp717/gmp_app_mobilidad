import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';

/// In-memory RUM buffer. Flush every 60s or on app pause.
/// No PII: no client codes, no money amounts.
class RumBuffer {
  RumBuffer._();

  static const enabled = bool.fromEnvironment(
    'RUM_ENABLED',
    defaultValue: true,
  );
  static const int _maxEvents = 200;
  static final List<Map<String, dynamic>> _events = <Map<String, dynamic>>[];
  static Timer? _timer;
  static String? _lastScreen;
  static bool _flushing = false;

  static void start() {
    _timer ??= Timer.periodic(const Duration(seconds: 60), (_) {
      unawaited(flush());
    });
  }

  static void enqueue(Map<String, dynamic> event) {
    if (!enabled) return;
    if (_events.length >= _maxEvents) {
      _events.removeAt(0);
    }
    _events.add(event);
  }

  static void markRendered(String screen) {
    if (!enabled) return;
    _lastScreen = screen;
    final now = DateTime.now().millisecondsSinceEpoch;
    enqueue({
      'screen': screen,
      'endpoint': 'render',
      'method': 'UI',
      't_req': now,
      't_render': now,
    });
  }

  static String? get lastScreen => _lastScreen;

  static int get pendingCount => _events.length;

  @visibleForTesting
  static void resetForTest() {
    _events.clear();
    _lastScreen = null;
    _timer?.cancel();
    _timer = null;
    _flushing = false;
  }

  static Future<void> flush() async {
    if (!enabled || _flushing || _events.isEmpty) return;
    _flushing = true;
    final batch = List<Map<String, dynamic>>.from(_events);
    _events.clear();
    try {
      await ApiClient.post(
        '/telemetry/rum',
        {'events': batch},
        extra: const {'skipRetry': true, 'skipRum': true},
      );
    } catch (e) {
      debugPrint('[RUM] flush failed: $e');
      if (_events.length + batch.length <= _maxEvents) {
        _events.insertAll(0, batch);
      }
    } finally {
      _flushing = false;
    }
  }
}
