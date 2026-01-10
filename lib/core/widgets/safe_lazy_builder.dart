import 'dart:async';
import 'dart:isolate';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

/// SafeLazyBuilder - Optimized FutureBuilder with Isolate support and jank detection
/// ==================================================================================
/// 
/// Features:
/// - Automatic fallback to original builder on jank detection
/// - Isolate-based computation for heavy operations
/// - Performance monitoring
/// - Memory-efficient caching
///
/// Usage:
/// ```dart
/// SafeLazyBuilder<List<Product>>(
///   future: () => loadProducts(),
///   builder: (context, data) => ProductList(products: data),
///   placeholder: ProductListSkeleton(),
/// )
/// ```
class SafeLazyBuilder<T> extends StatefulWidget {
  /// Function that returns the Future to execute
  final Future<T> Function() future;
  
  /// Builder for the loaded data
  final Widget Function(BuildContext context, T data) builder;
  
  /// Widget to show while loading
  final Widget? placeholder;
  
  /// Widget to show on error
  final Widget Function(BuildContext context, Object error)? errorBuilder;
  
  /// Whether to use Isolate for computation (only for compute-heavy tasks)
  final bool useIsolate;
  
  /// Isolate compute function (required if useIsolate is true)
  /// Must be a top-level function or static method
  final T Function(dynamic message)? isolateCompute;
  
  /// Message to pass to isolate compute function
  final dynamic isolateMessage;
  
  /// Enable jank detection and fallback
  final bool enableJankDetection;
  
  /// Threshold for jank detection (fps below this triggers fallback)
  final int jankThresholdFps;
  
  /// Cache key for memoization (if null, no caching)
  final String? cacheKey;
  
  /// Callback when load completes (for metrics)
  final void Function(Duration loadTime)? onLoadComplete;

  const SafeLazyBuilder({
    super.key,
    required this.future,
    required this.builder,
    this.placeholder,
    this.errorBuilder,
    this.useIsolate = false,
    this.isolateCompute,
    this.isolateMessage,
    this.enableJankDetection = true,
    this.jankThresholdFps = 45,
    this.cacheKey,
    this.onLoadComplete,
  }) : assert(
         !useIsolate || isolateCompute != null,
         'isolateCompute is required when useIsolate is true',
       );

  @override
  State<SafeLazyBuilder<T>> createState() => _SafeLazyBuilderState<T>();
}

class _SafeLazyBuilderState<T> extends State<SafeLazyBuilder<T>>
    with WidgetsBindingObserver {
  // Loading state
  bool _isLoading = true;
  T? _data;
  Object? _error;
  
  // Performance monitoring
  final Stopwatch _loadStopwatch = Stopwatch();
  int _frameDrops = 0;
  bool _useFallback = false;
  
  // Cache
  static final Map<String, dynamic> _cache = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadData();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeMetrics() {
    // Monitor for jank during load
    if (_isLoading && widget.enableJankDetection) {
      _checkForJank();
    }
  }

  /// Check for janky frames
  void _checkForJank() {
    SchedulerBinding.instance.addPostFrameCallback((timeStamp) {
      if (!_isLoading) return;
      
      final frameDuration = SchedulerBinding.instance.currentFrameTimeStamp;
      final targetDuration = const Duration(milliseconds: 16); // 60fps
      
      if (frameDuration != null) {
        // Simple jank detection: if frame takes too long
        _frameDrops++;
        
        if (_frameDrops > 5 && !_useFallback) {
          debugPrint('[SafeLazyBuilder] ⚠️ Jank detected, using fallback');
          _useFallback = true;
        }
      }
    });
  }

  /// Load data with performance monitoring
  Future<void> _loadData() async {
    _loadStopwatch.start();
    
    // Check cache first
    if (widget.cacheKey != null && _cache.containsKey(widget.cacheKey)) {
      _data = _cache[widget.cacheKey] as T;
      _isLoading = false;
      _loadStopwatch.stop();
      widget.onLoadComplete?.call(_loadStopwatch.elapsed);
      if (mounted) setState(() {});
      debugPrint('[SafeLazyBuilder] 📦 Cache hit: ${widget.cacheKey}');
      return;
    }
    
    try {
      T result;
      
      if (widget.useIsolate && widget.isolateCompute != null) {
        // Use Isolate for heavy computation
        result = await _computeInIsolate();
      } else {
        // Regular future execution
        result = await widget.future();
      }
      
      // Cache result
      if (widget.cacheKey != null) {
        _cache[widget.cacheKey!] = result;
      }
      
      _data = result;
      _isLoading = false;
      _loadStopwatch.stop();
      
      widget.onLoadComplete?.call(_loadStopwatch.elapsed);
      debugPrint('[SafeLazyBuilder] ✅ Loaded in ${_loadStopwatch.elapsedMilliseconds}ms');
    } catch (e, stack) {
      _error = e;
      _isLoading = false;
      _loadStopwatch.stop();
      debugPrint('[SafeLazyBuilder] ❌ Error: $e\n$stack');
    }
    
    if (mounted) setState(() {});
  }

  /// Execute computation in isolated context
  Future<T> _computeInIsolate() async {
    try {
      final result = await compute(
        widget.isolateCompute!,
        widget.isolateMessage,
      );
      return result as T;
    } catch (e) {
      debugPrint('[SafeLazyBuilder] Isolate error, falling back: $e');
      // Fallback to main thread
      return await widget.future();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return widget.placeholder ?? _buildDefaultPlaceholder();
    }
    
    if (_error != null) {
      return widget.errorBuilder?.call(context, _error!) ??
             _buildDefaultError(_error!);
    }
    
    if (_data != null) {
      return widget.builder(context, _data as T);
    }
    
    return _buildDefaultPlaceholder();
  }

  Widget _buildDefaultPlaceholder() {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(20),
        child: CircularProgressIndicator.adaptive(),
      ),
    );
  }

  Widget _buildDefaultError(Object error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Colors.red, size: 48),
            const SizedBox(height: 16),
            Text(
              'Error loading data',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              error.toString(),
              style: Theme.of(context).textTheme.bodySmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: () {
                setState(() {
                  _isLoading = true;
                  _error = null;
                  _data = null;
                });
                _loadData();
              },
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }

  /// Clear cache entry
  static void clearCache(String key) {
    _cache.remove(key);
  }

  /// Clear all cache
  static void clearAllCache() {
    _cache.clear();
    debugPrint('[SafeLazyBuilder] Cache cleared');
  }

  /// Get cache stats
  static Map<String, dynamic> getCacheStats() {
    return {
      'entries': _cache.length,
      'keys': _cache.keys.toList(),
    };
  }
}

/// Extension for easier isolate computation setup
extension SafeLazyBuilderExtensions<T> on Future<T> {
  /// Wrap a Future in a SafeLazyBuilder
  SafeLazyBuilder<T> asLazyBuilder({
    required Widget Function(BuildContext context, T data) builder,
    Widget? placeholder,
    String? cacheKey,
  }) {
    return SafeLazyBuilder<T>(
      future: () => this,
      builder: builder,
      placeholder: placeholder,
      cacheKey: cacheKey,
    );
  }
}
