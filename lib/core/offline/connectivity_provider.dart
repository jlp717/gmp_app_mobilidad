import 'dart:async';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/api/api_config.dart';

/// Represents current connectivity state.
///
/// - [online]: Full connectivity verified (HTTP probe succeeds)
/// - [limited]: Network interface exists but server unreachable
///   (VPN without route, captive portal, DNS failure)
/// - [offline]: No network interface at all
enum ConnectivityStatus {
  online,
  limited,
  offline,
}

/// Service that monitors connectivity and provides reactive state.
///
/// Unlike basic connectivity_plus wrappers, this validates REAL connectivity
/// by probing the actual backend server. This correctly handles:
/// - Tailscale/VPN interfaces that exist but can't reach the server
/// - Captive portals that report "connected" but block traffic
/// - DNS resolution failures on certain networks
class ConnectivityService {
  static ConnectivityService? _instance;
  final Connectivity _connectivity = Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  final _controller = StreamController<ConnectivityStatus>.broadcast();
  ConnectivityStatus _status = ConnectivityStatus.online;
  Timer? _healthCheckTimer;
  bool _healthCheckInProgress = false;
  int _consecutiveFailures = 0;
  static const int _maxFailuresBeforeLimited = 2;
  static const Duration _healthCheckInterval = Duration(seconds: 30);

  ConnectivityService._();

  static ConnectivityService get instance {
    _instance ??= ConnectivityService._();
    return _instance!;
  }

  Stream<ConnectivityStatus> get stream => _controller.stream;
  ConnectivityStatus get currentStatus => _status;

  /// Whether we have verified real connectivity to the backend server.
  bool get hasRealConnectivity => _status == ConnectivityStatus.online;

  /// Whether we have a network interface but can't reach the server.
  bool get isLimited => _status == ConnectivityStatus.limited;

  /// Whether we have no network interface at all.
  bool get isOffline => _status == ConnectivityStatus.offline;

  Future<void> initialize() async {
    try {
      final results = await _connectivity.checkConnectivity();
      await _updateStatus(results);
    } catch (_) {
      _status = ConnectivityStatus.online; // assume online if detection fails
    }

    _subscription = _connectivity.onConnectivityChanged.listen(_updateStatus);

    // Start periodic health checks to detect VPN dropouts
    _startPeriodicHealthChecks();

    debugPrint('[ConnectivityService] Initialized: $_status');
  }

  void _startPeriodicHealthChecks() {
    _healthCheckTimer?.cancel();
    _healthCheckTimer = Timer.periodic(_healthCheckInterval, (_) {
      if (_status == ConnectivityStatus.offline) return;
      _verifyRealConnectivity();
    });
  }

  Future<void> _updateStatus(List<ConnectivityResult> results) async {
    final hasInterface =
        results.isNotEmpty && results.first != ConnectivityResult.none;
    final isVpn =
        results.isNotEmpty && results.any((r) => r == ConnectivityResult.vpn);

    if (!hasInterface) {
      _setStatus(ConnectivityStatus.offline);
      _consecutiveFailures = 0;
      return;
    }

    // Interface exists — verify real connectivity
    await _verifyRealConnectivity();

    // If VPN and limited, log it for debugging
    if (isVpn && _status == ConnectivityStatus.limited) {
      debugPrint(
          '[ConnectivityService] ⚠️ VPN interface detected but server unreachable');
    }
  }

  /// HTTP probe to verify REAL connectivity to the backend server.
  /// This is the critical fix for Tailscale/VPN scenarios where
  /// connectivity_plus reports "online" but the server is unreachable.
  Future<void> _verifyRealConnectivity() async {
    if (_healthCheckInProgress) return;
    _healthCheckInProgress = true;

    try {
      // Use the actual production URL from ApiConfig
      final baseUrl = ApiConfig.baseUrl;
      final healthUrl = '$baseUrl/health';

      final uri = Uri.parse(healthUrl);
      final client = HttpClient();
      client.connectionTimeout = const Duration(seconds: 5);

      final request = await client.getUrl(uri);
      request.followRedirects = true;
      final response = await request.close().timeout(
        const Duration(seconds: 8),
        onTimeout: () {
          client.close();
          throw TimeoutException('Health probe timed out');
        },
      );

      client.close();

      if (response.statusCode >= 200 && response.statusCode < 300) {
        _consecutiveFailures = 0;
        _setStatus(ConnectivityStatus.online);
      } else {
        _handleHealthFailure();
      }
    } catch (e) {
      _handleHealthFailure();
    } finally {
      _healthCheckInProgress = false;
    }
  }

  void _handleHealthFailure() {
    _consecutiveFailures++;
    if (_consecutiveFailures >= _maxFailuresBeforeLimited) {
      _setStatus(ConnectivityStatus.limited);
    }
    // Before threshold, keep current status (don't flap on single failure)
  }

  void _setStatus(ConnectivityStatus newStatus) {
    if (newStatus != _status) {
      _status = newStatus;
      _controller.add(newStatus);
      debugPrint('[ConnectivityService] Status changed: $newStatus');
    }
  }

  /// Force an immediate connectivity re-check.
  /// Useful when user manually triggers "retry connection".
  Future<void> forceRecheck() async {
    _consecutiveFailures = 0;
    try {
      final results = await _connectivity.checkConnectivity();
      await _updateStatus(results);
    } catch (_) {}
  }

  void dispose() {
    _healthCheckTimer?.cancel();
    _subscription?.cancel();
    _controller.close();
  }
}

/// Riverpod StreamProvider that emits ConnectivityStatus changes.
/// Emits current status immediately, then listens for connectivity changes.
final connectivityStatusProvider =
    StreamProvider<ConnectivityStatus>((ref) async* {
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
