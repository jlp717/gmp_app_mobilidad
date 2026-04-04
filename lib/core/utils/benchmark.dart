import 'dart:math';
import 'package:flutter/foundation.dart';

/// Benchmark Utility V3 Performance Optimization
/// 
/// Use this to measure performance improvements before and after optimization.
/// 
/// Usage:
/// ```dart
/// // Start benchmark
/// final benchmark = Benchmark('Dashboard Load');
/// benchmark.start();
/// 
/// // Your code here
/// await fetchDashboardData();
/// 
/// // End benchmark
/// benchmark.end();
/// benchmark.printResults();
/// ```
/// 
/// Advanced usage with memory tracking:
/// ```dart
/// final benchmark = Benchmark('Cart Operations')
///   ..trackMemory = true
///   ..start();
/// 
/// for (int i = 0; i < 100; i++) {
///   cart.addItem(product);
/// }
/// 
/// benchmark.end();
/// benchmark.printResults();
/// ```
class Benchmark {
  final String name;
  DateTime? _startTime;
  DateTime? _endTime;
  int _iterations = 1;
  bool trackMemory = false;
  
  int? _startMemory;
  int? _endMemory;
  
  static final List<BenchmarkResult> _results = [];
  
  Benchmark(this.name);
  
  /// Start the benchmark
  void start() {
    _startTime = DateTime.now();
    if (trackMemory) {
      _startMemory = _getMemoryUsage();
    }
    debugPrint('[Benchmark] $name: Starting...');
  }
  
  /// End the benchmark
  void end() {
    _endTime = DateTime.now();
    if (trackMemory) {
      _endMemory = _getMemoryUsage();
    }
    
    final result = BenchmarkResult(
      name: name,
      duration: duration,
      iterations: _iterations,
      startMemory: _startMemory,
      endMemory: _endMemory,
    );
    
    _results.add(result);
    debugPrint('[Benchmark] $name: Completed in ${result.formattedDuration}');
  }
  
  /// Set number of iterations (for averaging)
  void setIterations(int iterations) {
    _iterations = iterations;
  }
  
  /// Get duration in milliseconds
  Duration get duration {
    if (_startTime == null || _endTime == null) {
      return Duration.zero;
    }
    return _endTime!.difference(_startTime!);
  }
  
  /// Get average duration per iteration
  Duration get averageDuration {
    return duration ~/ _iterations;
  }
  
  /// Get memory difference in KB
  int? get memoryDifference {
    if (_startMemory == null || _endMemory == null) return null;
    return _endMemory! - _startMemory!;
  }
  
  /// Print results to console
  void printResults() {
    final durationMs = duration.inMilliseconds;
    final avgMs = averageDuration.inMilliseconds;
    
    debugPrint('''
╔═══════════════════════════════════════════════════════════╗
║  BENCHMARK RESULTS: ${name.padRight(36)}║
╠═══════════════════════════════════════════════════════════╣
║  Total Duration:    ${durationMs.toString().padLeft(6)} ms                  ║
║  Iterations:        ${_iterations.toString().padLeft(6)}                      ║
║  Average Duration:  ${avgMs.toString().padLeft(6)} ms                  ║
${trackMemory && memoryDifference != null ? '║  Memory Delta:    ${memoryDifference! > 0 ? '+' : ''}${memoryDifference!.toString().padLeft(6)} KB               ║' : '║                                                           ║'}
╚═══════════════════════════════════════════════════════════╝
''');
  }
  
  /// Get approximate memory usage (platform-dependent)
  int? _getMemoryUsage() {
    // Note: Dart doesn't provide direct memory access
    // This is a placeholder - use dart:io for native apps
    // or implement via MethodChannel for Flutter
    return null;
  }
  
  /// Print all recorded results
  static void printAllResults() {
    if (_results.isEmpty) {
      debugPrint('[Benchmark] No results recorded');
      return;
    }
    
    debugPrint('\n${'=' * 60}');
    debugPrint('ALL BENCHMARK RESULTS (${_results.length} tests)');
    debugPrint('${'=' * 60}\n');
    
    for (final result in _results) {
      debugPrint('${result.name}:');
      debugPrint('  Duration: ${result.formattedDuration}');
      debugPrint('  Iterations: ${result.iterations}');
      debugPrint('  Average: ${result.formattedAverage}');
      if (result.startMemory != null && result.endMemory != null) {
        final delta = result.endMemory! - result.startMemory!;
        debugPrint('  Memory: ${delta > 0 ? '+' : ''}${delta} KB');
      }
      debugPrint('');
    }
  }
  
  /// Compare two benchmarks
  static void compare(String label, Duration before, Duration after) {
    final improvement = ((before.inMilliseconds - after.inMilliseconds) / 
                        before.inMilliseconds * 100).toStringAsFixed(1);
    final speedup = before.inMilliseconds / after.inMilliseconds;
    
    debugPrint('''
╔═══════════════════════════════════════════════════════════╗
║  PERFORMANCE COMPARISON: ${label.padRight(32)}║
╠═══════════════════════════════════════════════════════════╣
║  Before:  ${before.inMilliseconds.toString().padLeft(6)} ms                              ║
║  After:   ${after.inMilliseconds.toString().padLeft(6)} ms                              ║
║  ─────────────────────────────────────────────────────    ║
║  Improvement: ${improvement.padLeft(6)}% faster                          ║
║  Speedup:     ${speedup.toStringAsFixed(2)}x                                  ║
╚═══════════════════════════════════════════════════════════╝
''');
  }
  
  /// Clear all results
  static void clear() {
    _results.clear();
  }
}

/// Benchmark result data class
class BenchmarkResult {
  final String name;
  final Duration duration;
  final int iterations;
  final int? startMemory;
  final int? endMemory;
  
  BenchmarkResult({
    required this.name,
    required this.duration,
    required this.iterations,
    this.startMemory,
    this.endMemory,
  });
  
  String get formattedDuration => '${duration.inMilliseconds} ms';
  
  String get formattedAverage {
    final avg = duration.inMilliseconds ~/ iterations;
    return '$avg ms/iter';
  }
}

/// Performance profiler for measuring specific operations
class PerformanceProfiler {
  final Map<String, List<Duration>> _measurements = {};
  
  /// Profile a function execution
  T profile<T>(String label, T Function() fn) {
    final start = DateTime.now();
    try {
      return fn();
    } finally {
      final duration = DateTime.now().difference(start);
      _measurements.putIfAbsent(label, () => []).add(duration);
    }
  }
  
  /// Profile async function execution
  Future<T> profileAsync<T>(String label, Future<T> Function() fn) async {
    final start = DateTime.now();
    try {
      return await fn();
    } finally {
      final duration = DateTime.now().difference(start);
      _measurements.putIfAbsent(label, () => []).add(duration);
    }
  }
  
  /// Get statistics for a label
  ProfileStats? getStats(String label) {
    final measurements = _measurements[label];
    if (measurements == null || measurements.isEmpty) return null;
    
    final sorted = List<Duration>.from(measurements)..sort();
    final total = sorted.reduce((a, b) => a + b);
    
    return ProfileStats(
      label: label,
      count: sorted.length,
      min: sorted.first,
      max: sorted.last,
      average: total ~/ sorted.length,
      median: sorted[sorted.length ~/ 2],
      p95: sorted[(sorted.length * 0.95).floor()],
      p99: sorted[(sorted.length * 0.99).floor()],
    );
  }
  
  /// Print all statistics
  void printStats() {
    debugPrint('\n${'=' * 60}');
    debugPrint('PERFORMANCE PROFILE STATISTICS');
    debugPrint('${'=' * 60}\n');
    
    for (final entry in _measurements.entries) {
      final stats = getStats(entry.key);
      if (stats != null) {
        debugPrint('$stats\n');
      }
    }
  }
  
  /// Clear all measurements
  void clear() {
    _measurements.clear();
  }
}

/// Profile statistics
class ProfileStats {
  final String label;
  final int count;
  final Duration min;
  final Duration max;
  final Duration average;
  final Duration median;
  final Duration p95;
  final Duration p99;
  
  ProfileStats({
    required this.label,
    required this.count,
    required this.min,
    required this.max,
    required this.average,
    required this.median,
    required this.p95,
    required this.p99,
  });
  
  @override
  String toString() {
    return '''$label:
  Count:   $count
  Min:     ${min.inMilliseconds} ms
  Max:     ${max.inMilliseconds} ms
  Average: ${average.inMilliseconds} ms
  Median:  ${median.inMilliseconds} ms
  P95:     ${p95.inMilliseconds} ms
  P99:     ${p99.inMilliseconds} ms''';
  }
}

/// Load testing utility for stress testing
class LoadTester {
  /// Run load test with concurrent operations
  static Future<LoadTestResult> runTest({
    required String name,
    required Future<void> Function() task,
    int concurrentTasks = 10,
    int totalTasks = 100,
  }) async {
    final start = DateTime.now();
    int completed = 0;
    int failed = 0;
    
    final tasks = <Future<void>>[];
    
    for (int i = 0; i < totalTasks; i += concurrentTasks) {
      final batch = <Future<void>>[];
      
      for (int j = 0; j < concurrentTasks && (i + j) < totalTasks; j++) {
        batch.add(
          task().catchError((_) => failed++),
        );
      }
      
      await Future.wait(batch);
      completed += batch.length;
    }
    
    final duration = DateTime.now().difference(start);
    final tasksPerSecond = totalTasks / (duration.inMilliseconds / 1000);
    
    return LoadTestResult(
      name: name,
      totalTasks: totalTasks,
      completed: completed,
      failed: failed,
      duration: duration,
      tasksPerSecond: tasksPerSecond,
    );
  }
}

/// Load test result
class LoadTestResult {
  final String name;
  final int totalTasks;
  final int completed;
  final int failed;
  final Duration duration;
  final double tasksPerSecond;
  
  LoadTestResult({
    required this.name,
    required this.totalTasks,
    required this.completed,
    required this.failed,
    required this.duration,
    required this.tasksPerSecond,
  });
  
  @override
  String toString() {
    final successRate = (completed / totalTasks * 100).toStringAsFixed(1);
    return '''
╔═══════════════════════════════════════════════════════════╗
║  LOAD TEST RESULTS: ${name.padRight(37)}║
╠═══════════════════════════════════════════════════════════╣
║  Total Tasks:      $totalTasks                           ║
║  Completed:        $completed                            ║
║  Failed:           $failed                               ║
║  Success Rate:     ${successRate.padLeft(6)}%                         ║
║  Duration:         ${duration.inMilliseconds.toString().padLeft(6)} ms                  ║
║  Tasks/Second:     ${tasksPerSecond.toStringAsFixed(1).padLeft(6)}                      ║
╚═══════════════════════════════════════════════════════════╝
''';
  }
}
