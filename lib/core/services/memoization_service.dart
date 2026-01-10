import 'dart:async';
import 'dart:collection';

import 'package:flutter/foundation.dart';

/// MemoizationService - Intelligent function result caching
/// =========================================================
/// 
/// Features:
/// - Automatic TTL-based expiration
/// - LRU eviction policy
/// - Memory pressure handling
/// - Input validation (compare outputs pre/post)
/// - Thread-safe operations
///
/// Usage:
/// ```dart
/// final result = await MemoizationService.memoize(
///   'loadClientDetails_$clientId',
///   () => api.getClientDetails(clientId),
///   ttl: Duration(minutes: 10),
/// );
/// ```
class MemoizationService {
  // Configuration
  static const int _maxCacheSize = 200;
  static const Duration _defaultTTL = Duration(minutes: 30);
  
  // Internal cache storage
  static final LinkedHashMap<String, _MemoEntry> _cache = LinkedHashMap();
  
  // Statistics
  static int _hits = 0;
  static int _misses = 0;
  static int _evictions = 0;
  
  // Lock for thread safety
  static bool _isProcessing = false;
  static final List<Completer<void>> _waitQueue = [];

  /// Memoize a function result
  /// 
  /// [key] - Unique identifier for this computation
  /// [compute] - Function to execute if not cached
  /// [ttl] - Time to live for cached result
  /// [validator] - Optional function to validate cached result is still valid
  static Future<T> memoize<T>(
    String key,
    Future<T> Function() compute, {
    Duration ttl = _defaultTTL,
    bool Function(T cached)? validator,
  }) async {
    await _acquireLock();
    
    try {
      // Check cache
      final entry = _cache[key];
      
      if (entry != null && !entry.isExpired) {
        // Validate if validator provided
        if (validator != null && !validator(entry.value as T)) {
          debugPrint('[Memoize] ⚠️ Validation failed for: $key');
          _cache.remove(key);
        } else {
          _hits++;
          _promoteLRU(key);
          debugPrint('[Memoize] 📦 HIT: $key');
          return entry.value as T;
        }
      }
      
      // Compute new value
      _misses++;
      final startTime = DateTime.now();
      
      final result = await compute();
      
      final computeTime = DateTime.now().difference(startTime);
      debugPrint('[Memoize] 💾 MISS: $key (computed in ${computeTime.inMilliseconds}ms)');
      
      // Store in cache
      _set(key, result, ttl);
      
      return result;
    } finally {
      _releaseLock();
    }
  }

  /// Synchronous memoization for non-async functions
  static T memoizeSync<T>(
    String key,
    T Function() compute, {
    Duration ttl = _defaultTTL,
    bool Function(T cached)? validator,
  }) {
    // Check cache
    final entry = _cache[key];
    
    if (entry != null && !entry.isExpired) {
      if (validator != null && !validator(entry.value as T)) {
        _cache.remove(key);
      } else {
        _hits++;
        _promoteLRU(key);
        return entry.value as T;
      }
    }
    
    _misses++;
    final result = compute();
    _set(key, result, ttl);
    
    return result;
  }

  /// Store value in cache with LRU eviction
  static void _set<T>(String key, T value, Duration ttl) {
    // Evict if at capacity (LRU)
    while (_cache.length >= _maxCacheSize) {
      final oldestKey = _cache.keys.first;
      _cache.remove(oldestKey);
      _evictions++;
      debugPrint('[Memoize] 🗑️ Evicted: $oldestKey');
    }
    
    _cache[key] = _MemoEntry(
      value: value,
      expiresAt: DateTime.now().add(ttl),
      createdAt: DateTime.now(),
    );
  }

  /// Promote key to most recently used
  static void _promoteLRU(String key) {
    final entry = _cache.remove(key);
    if (entry != null) {
      _cache[key] = entry;
    }
  }

  /// Invalidate a specific cache entry
  static void invalidate(String key) {
    _cache.remove(key);
    debugPrint('[Memoize] 🧹 Invalidated: $key');
  }

  /// Invalidate entries matching a pattern
  static void invalidatePattern(String pattern) {
    final regex = RegExp(pattern.replaceAll('*', '.*'));
    final keysToRemove = _cache.keys.where((k) => regex.hasMatch(k)).toList();
    
    for (final key in keysToRemove) {
      _cache.remove(key);
    }
    
    debugPrint('[Memoize] 🧹 Invalidated ${keysToRemove.length} entries matching: $pattern');
  }

  /// Clear all cached data
  static void clear() {
    _cache.clear();
    debugPrint('[Memoize] 🧹 Cache cleared');
  }

  /// Remove expired entries
  static void cleanup() {
    final keysToRemove = <String>[];
    
    for (final entry in _cache.entries) {
      if (entry.value.isExpired) {
        keysToRemove.add(entry.key);
      }
    }
    
    for (final key in keysToRemove) {
      _cache.remove(key);
    }
    
    if (keysToRemove.isNotEmpty) {
      debugPrint('[Memoize] 🧹 Cleaned up ${keysToRemove.length} expired entries');
    }
  }

  /// Get cache statistics
  static Map<String, dynamic> getStats() {
    final totalRequests = _hits + _misses;
    final hitRate = totalRequests > 0 ? (_hits / totalRequests * 100) : 0.0;
    
    int expiredCount = 0;
    int validCount = 0;
    
    for (final entry in _cache.values) {
      if (entry.isExpired) {
        expiredCount++;
      } else {
        validCount++;
      }
    }
    
    return {
      'size': _cache.length,
      'maxSize': _maxCacheSize,
      'hits': _hits,
      'misses': _misses,
      'evictions': _evictions,
      'hitRate': '${hitRate.toStringAsFixed(2)}%',
      'validEntries': validCount,
      'expiredEntries': expiredCount,
    };
  }

  /// Handle memory pressure by clearing old entries
  static void handleMemoryPressure() {
    debugPrint('[Memoize] ⚠️ Memory pressure detected, clearing cache...');
    
    // Remove oldest half
    final keysToRemove = _cache.keys.take(_cache.length ~/ 2).toList();
    for (final key in keysToRemove) {
      _cache.remove(key);
    }
    
    _evictions += keysToRemove.length;
    debugPrint('[Memoize] 🧹 Removed ${keysToRemove.length} entries due to memory pressure');
  }

  /// Lock management for thread safety
  static Future<void> _acquireLock() async {
    if (!_isProcessing) {
      _isProcessing = true;
      return;
    }
    
    final completer = Completer<void>();
    _waitQueue.add(completer);
    await completer.future;
  }

  static void _releaseLock() {
    if (_waitQueue.isNotEmpty) {
      final next = _waitQueue.removeAt(0);
      next.complete();
    } else {
      _isProcessing = false;
    }
  }
}

/// Internal cache entry with metadata
class _MemoEntry {
  final dynamic value;
  final DateTime expiresAt;
  final DateTime createdAt;
  
  const _MemoEntry({
    required this.value,
    required this.expiresAt,
    required this.createdAt,
  });
  
  bool get isExpired => DateTime.now().isAfter(expiresAt);
  
  Duration get age => DateTime.now().difference(createdAt);
  Duration get ttlRemaining => expiresAt.difference(DateTime.now());
}

/// Extension methods for easier memoization
extension MemoizeFuture<T> on Future<T> Function() {
  /// Memoize this function with a key
  Future<T> memoized(String key, {Duration? ttl}) {
    return MemoizationService.memoize(
      key,
      this,
      ttl: ttl ?? const Duration(minutes: 30),
    );
  }
}

/// Create a memoized version of a function
class MemoizedFunction<T, R> {
  final String _keyPrefix;
  final R Function(T arg) _fn;
  final Duration _ttl;
  
  MemoizedFunction(
    this._keyPrefix,
    this._fn, {
    Duration ttl = const Duration(minutes: 30),
  }) : _ttl = ttl;
  
  R call(T arg) {
    final key = '${_keyPrefix}_${arg.hashCode}';
    return MemoizationService.memoizeSync(
      key,
      () => _fn(arg),
      ttl: _ttl,
    );
  }
  
  void invalidateFor(T arg) {
    final key = '${_keyPrefix}_${arg.hashCode}';
    MemoizationService.invalidate(key);
  }
  
  void invalidateAll() {
    MemoizationService.invalidatePattern('$_keyPrefix*');
  }
}
