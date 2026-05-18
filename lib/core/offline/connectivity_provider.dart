import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Represents current connectivity state.
enum ConnectivityStatus {
  online,
  offline,
}

/// Service that monitors connectivity and provides reactive state.
class ConnectivityService {
  static ConnectivityService? _instance;
  final Connectivity _connectivity = Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  final _controller = StreamController<ConnectivityStatus>.broadcast();
  ConnectivityStatus _status = ConnectivityStatus.online;

  ConnectivityService._();

  static ConnectivityService get instance {
    _instance ??= ConnectivityService._();
    return _instance!;
  }

  Stream<ConnectivityStatus> get stream => _controller.stream;
  ConnectivityStatus get currentStatus => _status;

  Future<void> initialize() async {
    try {
      final results = await _connectivity.checkConnectivity();
      _updateStatus(results);
    } catch (_) {
      _status = ConnectivityStatus.online; // assume online if detection fails
    }

    _subscription = _connectivity.onConnectivityChanged.listen(_updateStatus);
    debugPrint('[ConnectivityService] Initialized: $_status');
  }

  void _updateStatus(List<ConnectivityResult> results) {
    final isOnline = results.isNotEmpty && results.first != ConnectivityResult.none;
    final newStatus = isOnline ? ConnectivityStatus.online : ConnectivityStatus.offline;
    if (newStatus != _status) {
      _status = newStatus;
      _controller.add(newStatus);
      debugPrint('[ConnectivityService] Status changed: $newStatus');
    }
  }

  void dispose() {
    _subscription?.cancel();
    _controller.close();
  }
}

/// Riverpod StreamProvider that emits ConnectivityStatus changes.
/// Emits current status immediately, then listens for connectivity changes.
final connectivityStatusProvider = StreamProvider<ConnectivityStatus>((ref) async* {
  final service = ConnectivityService.instance;
  // Emit current status immediately
  yield service.currentStatus;
  // Then follow the stream
  await for (final status in service.stream) {
    yield status;
  }
});

/// Simple provider that gives the current status (for one-shot checks).
final connectivityStatus = Provider<ConnectivityStatus>((ref) {
  return ConnectivityService.instance.currentStatus;
});
