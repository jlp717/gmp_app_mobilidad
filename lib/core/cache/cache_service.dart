import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

/// Cache service using Hive for persistent local storage
/// Implements TTL-based caching for API responses
/// Enhanced with in-memory layer for hot data access
class CacheService {
  static const String _cacheBoxName = 'app_cache';
  static const String _metadataBoxName = 'cache_metadata';

  static Box<dynamic>? _cacheBox;
  static Box<dynamic>? _metadataBox;

  // ============================================================
  // In-Memory Cache Layer (for hot data)
  // ============================================================
  static final Map<String, _MemoryCacheEntry> _memoryCache = {};
  static const int _memoryCacheMaxSize = 50;
  static const Duration _memoryCacheTTL = Duration(minutes: 5);

  // ============================================================
  // TTL Constants
  // ============================================================

  /// Default cache duration (30 minutes)
  static const Duration defaultTTL = Duration(minutes: 30);

  /// Short-lived cache for frequently changing data (5 minutes)
  static const Duration shortTTL = Duration(minutes: 5);

  /// Long-lived cache for static data (24 hours)
  static const Duration longTTL = Duration(hours: 24);

  /// Real-time cache for volatile data (1 minute)
  static const Duration realtimeTTL = Duration(minutes: 1);

  static const int _maxKeyLength = 200;

  /// Sanitizes the key to ensure it fits Hive's limits
  static String _sanitizeKey(String key) {
    if (key.length <= _maxKeyLength) return key;
    // Create a deterministic short key for long strings
    final hash = sha256.convert(utf8.encode(key)).toString();
    final prefix = key.substring(0, 50);
    return 'hashed_${prefix}_$hash';
  }

  /// Initialize Hive and open cache boxes
  /// Call this before runApp()
  static Future<void> init() async {
    await Hive.initFlutter();

    // Generate encryption key
    final key = _generateEncryptionKey();
    final encryptionCipher = HiveAesCipher(key);

    _cacheBox = await Hive.openBox<dynamic>(
      _cacheBoxName,
      encryptionCipher: encryptionCipher,
    );
    _metadataBox = await Hive.openBox<dynamic>(
      _metadataBoxName,
      encryptionCipher: encryptionCipher,
    );
    debugPrint(
      '[CacheService] Initialized with ${_cacheBox?.length ?? 0} '
      'cached items (encrypted)',
    );
  }

  static List<int> _generateEncryptionKey() {
    const seed = 'gmp_app_cache_encryption_key_v1';
    return sha256.convert(utf8.encode(seed)).bytes;
  }

  /// Get cached value with TTL validation
  /// Returns null if not found or expired
  static T? get<T>(String key) {
    if (_cacheBox == null) return null;

    final safeKey = _sanitizeKey(key);
    final memEntry = _memoryCache[safeKey];
    if (memEntry != null && DateTime.now().isBefore(memEntry.expiry)) {
      debugPrint('[CacheService] Memory cache HIT for key: $key');
      return memEntry.value as T?;
    }
    if (memEntry != null) {
      _memoryCache.remove(safeKey);
    }

    final expiryKey = '${safeKey}_expiry';
    final expiryTimestamp = _metadataBox?.get(expiryKey) as int?;

    if (expiryTimestamp != null) {
      final expiryDate = DateTime.fromMillisecondsSinceEpoch(expiryTimestamp);
      if (DateTime.now().isAfter(expiryDate)) {
        debugPrint('[CacheService] Cache expired for key: $key');
        return null;
      }
    }

    final value = _cacheBox?.get(safeKey);
    if (value != null) {
      debugPrint('[CacheService] Cache HIT for key: $key');
      // Limitar la vida en memoria al TTL restante de la entrada: sin esto
      // un dato con realtimeTTL (1 min) podía servirse hasta 5 min desde
      // la capa en memoria.
      Duration? remaining;
      if (expiryTimestamp != null) {
        remaining = DateTime.fromMillisecondsSinceEpoch(expiryTimestamp)
            .difference(DateTime.now());
      }
      _setMemoryCache(safeKey, value, ttl: remaining);
    }
    return value as T?;
  }

  /// Get an expired entry for stale-if-error fallback.
  /// This keeps the app usable on bad mobile networks while the UI can retry
  /// fresh data in the background.
  static T? getStale<T>(
    String key, {
    Duration maxStale = const Duration(hours: 24),
  }) {
    if (_cacheBox == null) return null;

    final safeKey = _sanitizeKey(key);
    final expiryTimestamp = _metadataBox?.get('${safeKey}_expiry') as int?;
    if (expiryTimestamp == null) return null;

    final staleUntil =
        DateTime.fromMillisecondsSinceEpoch(expiryTimestamp).add(maxStale);
    if (DateTime.now().isAfter(staleUntil)) {
      return null;
    }

    final value = _cacheBox?.get(safeKey);
    if (value != null) {
      debugPrint('[CacheService] Cache STALE HIT for key: $key');
    }
    return value as T?;
  }

  /// Set cached value with TTL
  static Future<void> set<T>(
    String key,
    T value, {
    Duration? ttl,
  }) async {
    if (_cacheBox == null) return;

    final safeKey = _sanitizeKey(key);
    final effectiveTTL = ttl ?? defaultTTL;
    final expiryTimestamp =
        DateTime.now().add(effectiveTTL).millisecondsSinceEpoch;

    try {
      await _cacheBox?.put(safeKey, value);
      await _metadataBox?.put('${safeKey}_expiry', expiryTimestamp);
      _setMemoryCache(safeKey, value, ttl: effectiveTTL);
      debugPrint(
        '[CacheService] Cache SET for key: $key '
        '(TTL: ${effectiveTTL.inMinutes}min)',
      );
    } catch (e) {
      debugPrint('[CacheService] Error setting cache: $e');
    }
  }

  /// Invalidate specific cache entry
  static Future<void> invalidate(String key) async {
    final safeKey = _sanitizeKey(key);
    await _cacheBox?.delete(safeKey);
    await _metadataBox?.delete('${safeKey}_expiry');
    _memoryCache.remove(safeKey);
    debugPrint('[CacheService] Cache INVALIDATED for key: $key');
  }

  /// Invalidate all cache entries matching a prefix
  /// Note: This performs a scan, so it might be slow for massive caches
  static Future<void> invalidateByPrefix(String prefix) async {
    if (_cacheBox == null) return;

    // We can only reliably match unhashed keys or keys that are short enough
    // For hashed keys, we can't easily reverse logic unless we store
    // original keys.
    // For now, this best-effort implementation scans all keys.

    final keysToDelete = _cacheBox!.keys
        .where(
          (k) =>
              k.toString().startsWith(prefix) ||
              k.toString().startsWith('hashed_$prefix'),
        )
        .toList();

    for (final key in keysToDelete) {
      await _cacheBox?.delete(key);
      await _metadataBox?.delete('${key}_expiry');
      _memoryCache.remove(key.toString());
    }

    _memoryCache.removeWhere(
      (key, _) => key.startsWith(prefix) || key.startsWith('hashed_$prefix'),
    );

    debugPrint(
      '[CacheService] Invalidated ${keysToDelete.length} entries '
      'with prefix: $prefix',
    );
  }

  /// Clear all cached data
  static Future<void> clearAll() async {
    await _cacheBox?.clear();
    await _metadataBox?.clear();
    clearMemoryCache();
    debugPrint('[CacheService] All cache cleared');
  }

  /// Get cache statistics
  static Map<String, dynamic> getStats() {
    return {
      'totalEntries': _cacheBox?.length ?? 0,
      'metadataEntries': _metadataBox?.length ?? 0,
    };
  }

  /// Check if cache contains valid (non-expired) entry
  static bool hasValidCache(String key) {
    return get<dynamic>(key) != null;
  }

  // ============================================================
  // In-Memory Cache Methods (for hot data)
  // ============================================================

  /// Get from memory cache first, then fall back to Hive
  /// Use this for frequently accessed data within a session
  static T? getWithMemory<T>(String key) {
    final safeKey = _sanitizeKey(key);
    // Check in-memory cache first
    final memEntry = _memoryCache[safeKey];
    if (memEntry != null && DateTime.now().isBefore(memEntry.expiry)) {
      debugPrint('[CacheService] Memory cache HIT for key: $key');
      return memEntry.value as T?;
    }
    if (memEntry != null) {
      _memoryCache.remove(safeKey);
    }

    // Fall back to Hive cache
    final value = get<T>(key);
    return value;
  }

  /// Set value in both memory and Hive cache
  static Future<void> setWithMemory<T>(
    String key,
    T value, {
    Duration? ttl,
  }) async {
    await set(key, value, ttl: ttl);
  }

  /// Internal: Set value in memory cache with LRU eviction.
  /// [ttl] caps the in-memory lifetime (never exceeds [_memoryCacheTTL]).
  static void _setMemoryCache(String key, dynamic value, {Duration? ttl}) {
    final effective = (ttl == null || ttl > _memoryCacheTTL)
        ? _memoryCacheTTL
        : (ttl.isNegative ? Duration.zero : ttl);
    if (effective == Duration.zero) return;

    // Evict oldest entry if at capacity
    if (_memoryCache.length >= _memoryCacheMaxSize) {
      final oldestKey = _memoryCache.entries
          .reduce((a, b) => a.value.expiry.isBefore(b.value.expiry) ? a : b)
          .key;
      _memoryCache.remove(oldestKey);
      debugPrint('[CacheService] Memory cache evicted: $oldestKey');
    }

    _memoryCache[key] = _MemoryCacheEntry(
      value: value,
      expiry: DateTime.now().add(effective),
    );
  }

  /// Clear memory cache (useful on logout or memory pressure)
  static void clearMemoryCache() {
    _memoryCache.clear();
    debugPrint('[CacheService] Memory cache cleared');
  }

  /// Get memory cache statistics
  static Map<String, dynamic> getMemoryStats() {
    return {
      'memoryEntries': _memoryCache.length,
      'maxSize': _memoryCacheMaxSize,
    };
  }
}

/// Helper class for in-memory cache entries with expiry
class _MemoryCacheEntry {
  _MemoryCacheEntry({required this.value, required this.expiry});

  final dynamic value;
  final DateTime expiry;
}
