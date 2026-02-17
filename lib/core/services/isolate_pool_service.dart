import 'dart:async';
import 'dart:collection';
import 'dart:isolate';

import 'package:flutter/foundation.dart';

/// IsolatePoolService - Managed pool of Isolates for heavy computations
/// =====================================================================
/// 
/// Features:
/// - Pre-spawned Isolate pool for instant task execution
/// - Priority-based task queue
/// - Automatic load balancing
/// - Memory management with worker recycling
/// - Graceful degradation on Isolate failure
///
/// Usage:
/// ```dart
/// final result = await IsolatePoolService.compute(
///   heavyComputation,
///   inputData,
///   priority: TaskPriority.high,
/// );
/// ```

/// Task priority levels
enum TaskPriority { low, normal, high, critical }

/// Task wrapper for queue management
class _IsolateTask<T, R> {
  final T Function(R message) computation;
  final R message;
  final TaskPriority priority;
  final Completer<T> completer;
  final DateTime createdAt;
  final String? debugLabel;

  _IsolateTask({
    required this.computation,
    required this.message,
    required this.priority,
    required this.completer,
    this.debugLabel,
  }) : createdAt = DateTime.now();

  Duration get queueTime => DateTime.now().difference(createdAt);
}

/// Worker state tracking
class _IsolateWorker {
  final int id;
  Isolate? isolate;
  SendPort? sendPort;
  bool isBusy = false;
  int taskCount = 0;
  DateTime? lastUsed;
  int failureCount = 0;

  _IsolateWorker(this.id);

  bool get isHealthy => failureCount < 3;
  bool get isAvailable => !isBusy && isHealthy && sendPort != null;
}

/// Main Isolate Pool Service
class IsolatePoolService {
  // Configuration
  static int _poolSize = 4;
  static const int _maxTaskQueue = 1000;
  static const int _maxTasksPerWorker = 100;
  static const Duration _workerTimeout = Duration(seconds: 30);

  // Worker pool
  static final List<_IsolateWorker> _workers = [];
  static bool _isInitialized = false;
  static bool _isShuttingDown = false;

  // Task queue (priority queue)
  static final SplayTreeMap<int, Queue<_IsolateTask>> _taskQueue =
      SplayTreeMap<int, Queue<_IsolateTask>>();

  // Statistics
  static int _tasksCompleted = 0;
  static int _tasksFailed = 0;
  static int _totalQueueTime = 0;

  /// Initialize the Isolate pool
  static Future<void> init({int? poolSize}) async {
    if (_isInitialized) return;

    _poolSize = poolSize ?? _calculateOptimalPoolSize();
    debugPrint('[IsolatePool] Initializing pool with $_poolSize workers...');

    for (int i = 0; i < _poolSize; i++) {
      await _spawnWorker(i);
    }

    _isInitialized = true;
    debugPrint('[IsolatePool] ✅ Pool initialized with ${_workers.length} workers');
  }

  /// Calculate optimal pool size based on platform
  static int _calculateOptimalPoolSize() {
    // On mobile, limit to 2-4 isolates to conserve resources
    // Web doesn't support true Isolates
    if (kIsWeb) return 1;
    return 4; // Default for mobile
  }

  /// Spawn a new worker Isolate
  static Future<void> _spawnWorker(int id) async {
    try {
      final worker = _IsolateWorker(id);
      final receivePort = ReceivePort();

      worker.isolate = await Isolate.spawn(
        _workerEntryPoint,
        receivePort.sendPort,
        debugName: 'IsolatePoolWorker_$id',
        errorsAreFatal: false,
      );

      // Get worker's send port
      final sendPort = await receivePort.first as SendPort;
      worker.sendPort = sendPort;

      _workers.add(worker);
      debugPrint('[IsolatePool] Worker $id spawned');
    } catch (e) {
      debugPrint('[IsolatePool] ⚠️ Failed to spawn worker $id: $e');
    }
  }

  /// Worker entry point (runs in Isolate)
  static void _workerEntryPoint(SendPort mainSendPort) {
    final receivePort = ReceivePort();
    mainSendPort.send(receivePort.sendPort);

    receivePort.listen((message) async {
      if (message is _WorkerMessage) {
        try {
          final result = message.computation(message.data);
          message.responsePort.send(_WorkerResponse(
            taskId: message.taskId,
            result: result,
            success: true,
          ));
        } catch (e, stack) {
          message.responsePort.send(_WorkerResponse(
            taskId: message.taskId,
            error: e.toString(),
            stackTrace: stack.toString(),
            success: false,
          ));
        }
      }
    });
  }

  /// Execute computation in Isolate pool
  static Future<T> compute<T, R>(
    T Function(R message) computation,
    R message, {
    TaskPriority priority = TaskPriority.normal,
    String? debugLabel,
  }) async {
    // Initialize if needed
    if (!_isInitialized) await init();

    // Fallback to main thread compute for web
    if (kIsWeb) {
      return await Future(() => computation(message));
    }

    final completer = Completer<T>();
    final task = _IsolateTask<T, R>(
      computation: computation,
      message: message,
      priority: priority,
      completer: completer,
      debugLabel: debugLabel,
    );

    // Add to priority queue
    _enqueueTask(task);

    // Try to process immediately
    _processQueue();

    return completer.future;
  }

  /// Add task to priority queue
  static void _enqueueTask(_IsolateTask task) {
    final priorityKey = TaskPriority.values.length - task.priority.index;

    if (!_taskQueue.containsKey(priorityKey)) {
      _taskQueue[priorityKey] = Queue();
    }

    _taskQueue[priorityKey]!.add(task);

    // Warn if queue is getting full
    final totalQueued = _taskQueue.values.fold<int>(0, (sum, q) => sum + q.length);
    if (totalQueued > _maxTaskQueue * 0.8) {
      debugPrint('[IsolatePool] ⚠️ Task queue at ${totalQueued}/$_maxTaskQueue');
    }
  }

  /// Process queued tasks
  static void _processQueue() {
    if (_isShuttingDown) return;

    // Find available worker
    final worker = _workers.firstWhere(
      (w) => w.isAvailable,
      orElse: () => _IsolateWorker(-1),
    );

    if (worker.id == -1) return; // No available workers

    // Get highest priority task
    _IsolateTask? task;
    for (final queue in _taskQueue.values) {
      if (queue.isNotEmpty) {
        task = queue.removeFirst();
        break;
      }
    }

    if (task == null) return; // No pending tasks

    // Execute task
    _executeTask(worker, task);
  }

  /// Execute task on worker
  static Future<void> _executeTask(_IsolateWorker worker, _IsolateTask task) async {
    worker.isBusy = true;
    worker.taskCount++;
    final startTime = DateTime.now();

    try {
      final responsePort = ReceivePort();
      final taskId = DateTime.now().microsecondsSinceEpoch.toString();

      // Send work to isolate
      worker.sendPort!.send(_WorkerMessage(
        taskId: taskId,
        computation: task.computation,
        data: task.message,
        responsePort: responsePort.sendPort,
      ));

      // Wait for response with timeout
      final response = await responsePort.first.timeout(
        _workerTimeout,
        onTimeout: () {
          throw TimeoutException('Worker timeout', _workerTimeout);
        },
      );

      if (response is _WorkerResponse) {
        if (response.success) {
          task.completer.complete(response.result);
          _tasksCompleted++;
        } else {
          task.completer.completeError(
            Exception('Worker error: ${response.error}'),
          );
          _tasksFailed++;
        }
      }

      worker.failureCount = 0;
      worker.lastUsed = DateTime.now();

      // Track queue time
      _totalQueueTime += task.queueTime.inMilliseconds;

    } catch (e) {
      task.completer.completeError(e);
      worker.failureCount++;
      _tasksFailed++;

      // Recycle unhealthy worker
      if (!worker.isHealthy) {
        await _recycleWorker(worker);
      }
    } finally {
      worker.isBusy = false;

      // Recycle worker if it's processed too many tasks
      if (worker.taskCount >= _maxTasksPerWorker) {
        await _recycleWorker(worker);
      }

      // Process next task
      _processQueue();
    }
  }

  /// Recycle an unhealthy or overused worker
  static Future<void> _recycleWorker(_IsolateWorker worker) async {
    debugPrint('[IsolatePool] 🔄 Recycling worker ${worker.id}');

    worker.isolate?.kill(priority: Isolate.immediate);
    final index = _workers.indexOf(worker);

    if (index != -1) {
      _workers.removeAt(index);
      await _spawnWorker(worker.id);
    }
  }

  /// Get pool statistics
  static Map<String, dynamic> getStats() {
    final totalQueued = _taskQueue.values.fold<int>(0, (sum, q) => sum + q.length);
    final busyWorkers = _workers.where((w) => w.isBusy).length;
    final avgQueueTime = _tasksCompleted > 0 ? _totalQueueTime / _tasksCompleted : 0;

    return {
      'poolSize': _poolSize,
      'activeWorkers': _workers.length,
      'busyWorkers': busyWorkers,
      'idleWorkers': _workers.length - busyWorkers,
      'queuedTasks': totalQueued,
      'completedTasks': _tasksCompleted,
      'failedTasks': _tasksFailed,
      'avgQueueTimeMs': avgQueueTime.toStringAsFixed(2),
      'workers': _workers.map((w) {
        return {
          'id': w.id,
          'busy': w.isBusy,
          'taskCount': w.taskCount,
          'healthy': w.isHealthy,
        };
      }).toList(),
    };
  }

  /// Shutdown pool gracefully
  static Future<void> shutdown() async {
    if (_isShuttingDown) return;
    _isShuttingDown = true;

    debugPrint('[IsolatePool] Shutting down...');

    // Complete pending tasks with error
    for (final queue in _taskQueue.values) {
      while (queue.isNotEmpty) {
        final task = queue.removeFirst();
        task.completer.completeError(
          Exception('Isolate pool shutting down'),
        );
      }
    }

    // Kill workers
    for (final worker in _workers) {
      worker.isolate?.kill(priority: Isolate.immediate);
    }

    _workers.clear();
    _isInitialized = false;
    _isShuttingDown = false;

    debugPrint('[IsolatePool] ✅ Shutdown complete');
  }
}

/// Message sent to worker
class _WorkerMessage<T, R> {
  final String taskId;
  final T Function(R) computation;
  final R data;
  final SendPort responsePort;

  _WorkerMessage({
    required this.taskId,
    required this.computation,
    required this.data,
    required this.responsePort,
  });
}

/// Response from worker
class _WorkerResponse<T> {
  final String taskId;
  final T? result;
  final bool success;
  final String? error;
  final String? stackTrace;

  _WorkerResponse({
    required this.taskId,
    this.result,
    required this.success,
    this.error,
    this.stackTrace,
  });
}
