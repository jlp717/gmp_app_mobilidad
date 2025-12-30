import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

/// Cache service using Hive for persistent local storage
/// Implements TTL-based caching for API responses
class CacheService {
  static const String _cacheBoxName = 'app_cache';
  static const String _metadataBoxName = 'cache_metadata';
  
  static Box<dynamic>? _cacheBox;
  static Box<dynamic>? _metadataBox;
  
  /// Default cache duration (30 minutes)
  static const Duration defaultTTL = Duration(minutes: 30);
  
  /// Short-lived cache for frequently changing data (5 minutes)
  static const Duration shortTTL = Duration(minutes: 5);
  
  /// Long-lived cache for static data (24 hours)
  static const Duration longTTL = Duration(hours: 24);

  /// Initialize Hive and open cache boxes
  /// Call this before runApp()
  static Future<void> init() async {
    await Hive.initFlutter();
    _cacheBox = await Hive.openBox<dynamic>(_cacheBoxName);
    _metadataBox = await Hive.openBox<dynamic>(_metadataBoxName);
    debugPrint('[CacheService] Initialized with ${_cacheBox?.length ?? 0} cached items');
  }

  /// Get cached value with TTL validation
  /// Returns null if not found or expired
  static T? get<T>(String key) {
    if (_cacheBox == null) return null;
    
    final expiryKey = '${key}_expiry';
    final expiryTimestamp = _metadataBox?.get(expiryKey) as int?;
    
    if (expiryTimestamp != null) {
      final expiryDate = DateTime.fromMillisecondsSinceEpoch(expiryTimestamp);
      if (DateTime.now().isAfter(expiryDate)) {
        // Cache expired, clean up
        _cacheBox?.delete(key);
        _metadataBox?.delete(expiryKey);
        debugPrint('[CacheService] Cache expired for key: $key');
        return null;
      }
    }
    
    final value = _cacheBox?.get(key);
    if (value != null) {
      debugPrint('[CacheService] Cache HIT for key: $key');
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
    
    final effectiveTTL = ttl ?? defaultTTL;
    final expiryTimestamp = DateTime.now().add(effectiveTTL).millisecondsSinceEpoch;
    
    await _cacheBox?.put(key, value);
    await _metadataBox?.put('${key}_expiry', expiryTimestamp);
    
    debugPrint('[CacheService] Cache SET for key: $key (TTL: ${effectiveTTL.inMinutes}min)');
  }

  /// Invalidate specific cache entry
  static Future<void> invalidate(String key) async {
    await _cacheBox?.delete(key);
    await _metadataBox?.delete('${key}_expiry');
    debugPrint('[CacheService] Cache INVALIDATED for key: $key');
  }

  /// Invalidate all cache entries matching a prefix
  static Future<void> invalidateByPrefix(String prefix) async {
    if (_cacheBox == null) return;
    
    final keysToDelete = _cacheBox!.keys
        .where((key) => key.toString().startsWith(prefix))
        .toList();
    
    for (final key in keysToDelete) {
      await _cacheBox?.delete(key);
      await _metadataBox?.delete('${key}_expiry');
    }
    
    debugPrint('[CacheService] Invalidated ${keysToDelete.length} entries with prefix: $prefix');
  }

  /// Clear all cached data
  static Future<void> clearAll() async {
    await _cacheBox?.clear();
    await _metadataBox?.clear();
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
}
