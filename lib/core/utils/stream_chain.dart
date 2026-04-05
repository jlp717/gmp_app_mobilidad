import 'dart:async';
import 'package:flutter/foundation.dart';
import '../cache/cache_service_optimized.dart';

/// Stream-Chain Utility V3
/// 
/// Provides stream-based caching and chaining operations for efficient data flow.
/// 
/// Features:
/// - Automatic caching of stream emissions
/// - Debouncing and throttling
/// - Memory-efficient transformations
/// - ReplayCache for late subscribers
/// 
/// Usage:
/// ```dart
/// // Cache stream emissions
/// final cachedStream = StreamChain.cacheStream(
///   orderStream,
///   keyPrefix: 'orders_',
///   ttl: Duration(minutes: 5),
/// );
/// 
/// // Debounced stream (wait for pause in emissions)
/// final debounced = StreamChain.debounce(
///   searchStream,
///   Duration(milliseconds: 300),
/// );
/// 
/// // Throttled stream (max 1 emission per duration)
/// final throttled = StreamChain.throttle(
///   scrollStream,
///   Duration(milliseconds: 100),
/// );
/// ```
class StreamChain<T> {
  final Stream<T> _stream;
  final String? _cacheKey;
  final Duration? _cacheTTL;
  
  StreamChain._(this._stream, this._cacheKey, this._cacheTTL);

  /// Create a StreamChain from a stream
  static StreamChain<T> from<T>(Stream<T> stream) {
    return StreamChain._(stream, null, null);
  }

  /// Cache each emission from the stream
  StreamChain<T> cache({
    String? keyPrefix,
    Duration? ttl,
    bool quantize = false,
  }) {
    if (keyPrefix == null) {
      return this; // No caching without key
    }

    final cachedStream = _stream.map((value) {
      final timestamp = DateTime.now().millisecondsSinceEpoch;
      final key = '${keyPrefix}${timestamp}';
      
      CacheServiceOptimized.set(
        key,
        value,
        ttl: ttl,
        quantize: quantize,
      );
      
      return value;
    });

    return StreamChain._(cachedStream, keyPrefix, ttl);
  }

  /// Cache the latest emission with a fixed key
  StreamChain<T> cacheLatest({
    required String key,
    Duration? ttl,
    bool quantize = false,
  }) {
    final cachedStream = _stream.map((value) {
      CacheServiceOptimized.set(
        key,
        value,
        ttl: ttl,
        quantize: quantize,
      );
      return value;
    });

    return StreamChain._(cachedStream, key, ttl);
  }

  /// Debounce the stream (wait for pause in emissions)
  StreamChain<T> debounce(Duration duration) {
    return StreamChain._(
      _stream.debounce(duration),
      _cacheKey,
      _cacheTTL,
    );
  }

  /// Throttle the stream (max 1 emission per duration)
  StreamChain<T> throttle(Duration duration) {
    return StreamChain._(
      _stream.throttle(duration),
      _cacheKey,
      _cacheTTL,
    );
  }

  /// Buffer emissions and emit as list
  StreamChain<List<T>> buffer(int count) {
    return StreamChain<List<T>>._(
      _stream.buffer(count),
      _cacheKey,
      _cacheTTL,
    );
  }

  /// Buffer emissions by time window
  StreamChain<List<T>> bufferTime(Duration duration) {
    return StreamChain<List<T>>._(
      _stream.bufferTime(duration),
      _cacheKey,
      _cacheTTL,
    );
  }

  /// Transform stream with function
  StreamChain<R> transform<R>(R Function(T) transformer) {
    return StreamChain<R>._(
      _stream.map(transformer),
      null,
      null,
    );
  }

  /// Async transform
  StreamChain<R> transformAsync<R>(Future<R> Function(T) transformer) {
    return StreamChain<R>._(
      _stream.asyncMap(transformer),
      null,
      null,
    );
  }

  /// Filter emissions
  StreamChain<T> where(bool Function(T) test) {
    return StreamChain<T>._(
      _stream.where(test),
      _cacheKey,
      _cacheTTL,
    );
  }

  /// Distinct emissions (only emit when value changes)
  StreamChain<T> distinct([bool Function(T previous, T current)? equals]) {
    return StreamChain<T>._(
      _stream.distinct(equals),
      _cacheKey,
      _cacheTTL,
    );
  }

  /// Skip first N emissions
  StreamChain<T> skip(int count) {
    return StreamChain<T>._(
      _stream.skip(count),
      _cacheKey,
      _cacheTTL,
    );
  }

  /// Take only first N emissions
  StreamChain<T> take(int count) {
    return StreamChain<T>._(
      _stream.take(count),
      _cacheKey,
      _cacheTTL,
    );
  }

  /// Take emissions while test is true
  StreamChain<T> takeWhile(bool Function(T) test) {
    return StreamChain<T>._(
      _stream.takeWhile(test),
      _cacheKey,
      _cacheTTL,
    );
  }

  /// Build the final stream
  Stream<T> build() => _stream;

  /// Listen to the stream
  StreamSubscription<T> listen(
    void Function(T)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    return _stream.listen(
      onData,
      onError: onError,
      onDone: onDone,
      cancelOnError: cancelOnError,
    );
  }
}

/// ReplayCache - Cache last N emissions for late subscribers
class ReplayCache<T> {
  final int _maxSize;
  final List<T> _buffer = [];
  final _controller = StreamController<T>.broadcast();

  ReplayCache({int maxSize = 1}) : _maxSize = maxSize;

  /// Add value to replay cache
  void add(T value) {
    if (_buffer.length >= _maxSize) {
      _buffer.removeAt(0);
    }
    _buffer.add(value);
    _controller.add(value);
  }

  /// Get stream that replays cached values to new subscribers
  Stream<T> get stream {
    return _controller.stream.transform(
      StreamTransformer<T, T>.fromHandlers(
        handleData: (data, sink) {
          sink.add(data);
        },
        handleDone: (sink) {
          sink.close();
        },
        handleError: (error, stackTrace, sink) {
          sink.addError(error, stackTrace);
        },
      ),
    );
  }

  /// Get stream that replays last N values to new subscribers
  Stream<T> getStreamWithReplay({int? replaySize}) {
    final size = replaySize ?? _maxSize;
    final replay = _buffer.takeLast(size);

    return _controller.stream.transform(
      StreamTransformer<T, T>.fromHandlers(
        handleData: (data, sink) {
          sink.add(data);
        },
      ),
    ).transform(
      _ReplayTransformer<T>(replay.toList()),
    );
  }

  /// Clear the cache
  void clear() {
    _buffer.clear();
  }

  /// Get current buffer
  List<T> get buffer => List.unmodifiable(_buffer);

  /// Dispose the controller
  void dispose() {
    _controller.close();
  }
}

class _ReplayTransformer<T> extends StreamTransformerBase<T, T> {
  final List<T> _replayValues;

  _ReplayTransformer(this._replayValues);

  @override
  Stream<T> bind(Stream<T> stream) {
    return stream.transform(
      StreamTransformer<T, T>.fromHandlers(
        handleData: (data, sink) {
          // Send replay values first
          for (final value in _replayValues) {
            sink.add(value);
          }
          // Then send the current value
          sink.add(data);
        },
      ),
    );
  }
}

/// Stream-based caching utilities
class StreamCache {
  /// Cache stream emissions with automatic key generation
  static Stream<T> cacheStream<T>(
    Stream<T> stream, {
    required String keyPrefix,
    Duration? ttl,
    bool quantize = false,
  }) {
    return stream.map((value) {
      final timestamp = DateTime.now().millisecondsSinceEpoch;
      final key = '${keyPrefix}${timestamp}';
      
      CacheServiceOptimized.set(
        key,
        value,
        ttl: ttl,
        quantize: quantize,
      );
      
      return value;
    });
  }

  /// Cache the latest stream emission
  static Stream<T> cacheLatest<T>(
    Stream<T> stream, {
    required String key,
    Duration? ttl,
    bool quantize = false,
  }) {
    return stream.map((value) {
      CacheServiceOptimized.set(
        key,
        value,
        ttl: ttl,
        quantize: quantize,
      );
      return value;
    });
  }

  /// Load cached stream data
  static Future<List<T>?> loadCached<T>(String keyPrefix) async {
    // This would require listing keys by prefix in Hive
    // Implementation depends on cache structure
    return null;
  }

  /// Debounced caching (cache only after pause)
  static Stream<T> cacheDebounced<T>(
    Stream<T> stream, {
    required String key,
    required Duration debounceDuration,
    Duration? ttl,
  }) {
    return stream.debounce(debounceDuration).map((value) {
      CacheServiceOptimized.set(key, value, ttl: ttl);
      return value;
    });
  }

  /// Create a replay cache for a stream
  static ReplayCache<T> createReplayCache<T>({int maxSize = 1}) {
    return ReplayCache<T>(maxSize: maxSize);
  }
}

/// Extensions for easy StreamChain creation
extension StreamChainExtension<T> on Stream<T> {
  /// Convert to StreamChain
  StreamChain<T> get chain => StreamChain.from(this);

  /// Cache stream emissions
  Stream<T> cache({
    required String key,
    Duration? ttl,
    bool quantize = false,
  }) {
    return map((value) {
      CacheServiceOptimized.set(key, value, ttl: ttl, quantize: quantize);
      return value;
    });
  }

  /// Cache latest emission
  Stream<T> cacheLatest({
    required String key,
    Duration? ttl,
    bool quantize = false,
  }) {
    return map((value) {
      CacheServiceOptimized.set(key, value, ttl: ttl, quantize: quantize);
      return value;
    });
  }

  /// Debounce stream
  Stream<T> debounceStream(Duration duration) {
    return debounce(duration);
  }

  /// Throttle stream
  Stream<T> throttleStream(Duration duration) {
    return throttle(duration);
  }
}
