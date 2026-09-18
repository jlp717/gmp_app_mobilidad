import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/telemetry/rum_privacy_policy.dart';
import 'package:gmp_app_mobilidad/core/telemetry/rum_transport.dart';

/// In-memory RUM buffer. Flush every 60s or on app pause.
/// Reduces direct textual identifiers; numeric client values remain untrusted.
class RumBuffer {
  RumBuffer._();

  /// Whether telemetry collection is enabled for this build.
  static const enabled = bool.fromEnvironment(
    'RUM_ENABLED',
    defaultValue: true,
  );
  static Timer? _timer;
  static String? _lastScreen;
  static final RumTransport _transport = RumTransport(
    sender: _send,
    onSendFailure: _logFlushFailure,
  );

  /// Starts one periodic flush timer; repeated calls are harmless.
  static void start() {
    _timer ??= Timer.periodic(const Duration(seconds: 60), (_) {
      unawaited(flush());
    });
  }

  /// Sanitizes an event before retaining it in the bounded in-memory queue.
  static void enqueue(Map<String, dynamic> event) {
    if (!enabled) return;
    final sanitized = sanitizeRumEvent(event);
    if (sanitized != null) _transport.enqueue(sanitized);
  }

  /// Records a render timestamp using an allowed screen category.
  static void markRendered(String screen) {
    if (!enabled) return;
    _lastScreen = rumScreen(screen);
    final now = DateTime.now().millisecondsSinceEpoch;
    enqueue({
      'screen': _lastScreen,
      'endpoint': 'render',
      'method': 'UI',
      't_req': now,
      't_render': now,
    });
  }

  /// The most recent sanitized screen category, if any.
  static String? get lastScreen => _lastScreen;

  /// Events waiting in the queue, excluding the batch currently in flight.
  static int get pendingCount => _transport.pendingCount;

  /// Whether periodic flushing is active.
  ///
  /// Exposed only for timer lifecycle tests.
  @visibleForTesting
  static bool get isRunningForTest => _timer != null;

  /// Stops periodic flushing while retaining queued events for a later start.
  static void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// Clears test state and prevents older sends from restoring queued events.
  @visibleForTesting
  static void resetForTest() {
    _transport.reset();
    _lastScreen = null;
    stop();
  }

  /// Attempts a bounded flush, sharing any send already in progress.
  static Future<void> flush() async {
    if (!enabled) return;
    await _transport.flush();
  }

  static Future<void> _send(List<Map<String, dynamic>> events) {
    return ApiClient.post(
      '/telemetry/rum',
      {'events': events},
      extra: const {'skipRetry': true, 'skipRum': true},
    );
  }

  static void _logFlushFailure() {
    debugPrint('[RUM] flush failed');
  }
}
