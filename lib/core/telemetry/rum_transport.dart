import 'dart:async';

/// Sends one immutable ordered batch of RUM events.
typedef RumBatchSender = Future<void> Function(
  List<Map<String, dynamic>> events,
);

/// Bounded FIFO transport for RUM events.
///
/// This is best-effort telemetry: the in-memory queue can lose data on reset,
/// process closure, or capacity pressure. A response lost after server receipt
/// can also cause a retry and duplicate an event.
class RumTransport {
  /// Creates a transport that delegates batches to [sender].
  RumTransport({
    required RumBatchSender sender,
    void Function()? onSendFailure,
  })  : _sender = sender,
        _onSendFailure = onSendFailure;

  /// Maximum pending events retained while offline or sending.
  ///
  /// A separate batch of at most [maxBatchSize] can be in flight.
  static const int maxEvents = 200;

  /// Maximum number of events accepted by the server in one request.
  static const int maxBatchSize = 50;

  /// Maximum requests one flush may issue under continuous production.
  static const int maxBatchesPerFlush = 4;

  final RumBatchSender _sender;
  final void Function()? _onSendFailure;
  final List<Map<String, dynamic>> _pending = <Map<String, dynamic>>[];

  Future<void>? _inFlight;
  int _generation = 0;

  /// Number of events awaiting a successful send.
  int get pendingCount => _pending.length;

  /// Adds a flat scalar [event] snapshot and retains the newest bounded queue.
  ///
  /// Supported values are `String`, `num`, `bool`, or `null`; nested objects
  /// are intentionally rejected because RUM consumer events are flat.
  void enqueue(Map<String, dynamic> event) {
    _pending.add(_snapshotEvent(event));
    _retainMostRecent();
  }

  /// Flushes at most four batches. Concurrent callers share the same flush.
  Future<void> flush() {
    final inFlight = _inFlight;
    if (inFlight != null) return inFlight;
    if (_pending.isEmpty) return Future<void>.value();

    final completer = Completer<void>();
    _inFlight = completer.future;
    unawaited(_runFlush(completer, _generation));
    return completer.future;
  }

  /// Discards queued events and prevents an older send from restoring them.
  void reset() {
    _generation++;
    _pending.clear();
    _inFlight = null;
  }

  Future<void> _runFlush(Completer<void> completer, int generation) async {
    try {
      var sentBatches = 0;
      while (generation == _generation &&
          _pending.isNotEmpty &&
          sentBatches < maxBatchesPerFlush) {
        final batchLength =
            _pending.length < maxBatchSize ? _pending.length : maxBatchSize;
        final batch = List<Map<String, dynamic>>.from(
          _pending.take(batchLength),
        );
        _pending.removeRange(0, batchLength);

        try {
          await _sender(_immutableBatch(batch));
        } catch (_) {
          if (generation == _generation) {
            _pending.insertAll(0, batch);
            _retainMostRecent();
            _onSendFailure?.call();
          }
          break;
        }
        sentBatches++;
      }
      completer.complete();
    } catch (error, stackTrace) {
      completer.completeError(error, stackTrace);
    } finally {
      if (identical(_inFlight, completer.future)) {
        _inFlight = null;
      }
    }
  }

  void _retainMostRecent() {
    final overflow = _pending.length - maxEvents;
    if (overflow > 0) {
      _pending.removeRange(0, overflow);
    }
  }

  List<Map<String, dynamic>> _immutableBatch(
    List<Map<String, dynamic>> batch,
  ) {
    return List<Map<String, dynamic>>.unmodifiable(
      batch.map(_snapshotEvent),
    );
  }

  Map<String, dynamic> _snapshotEvent(Map<String, dynamic> event) {
    for (final entry in event.entries) {
      if (!_isScalarOrNull(entry.value)) {
        throw ArgumentError.value(
          entry.value,
          entry.key,
          'RUM event values must be scalar or null',
        );
      }
    }
    return Map<String, dynamic>.unmodifiable(Map<String, dynamic>.from(event));
  }

  bool _isScalarOrNull(Object? value) {
    return value == null || value is String || value is num || value is bool;
  }
}
