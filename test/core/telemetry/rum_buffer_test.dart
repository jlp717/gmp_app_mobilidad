import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/telemetry/rum_buffer.dart';
import 'package:gmp_app_mobilidad/core/telemetry/rum_interceptor.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

void main() {
  setUp(RumBuffer.resetForTest);

  test('enqueue caps at 200 events without client codes', () {
    for (var i = 0; i < 205; i++) {
      RumBuffer.enqueue({
        'endpoint': '/dashboard/metrics',
        'method': 'GET',
        't_req': i,
      });
    }
    expect(RumBuffer.pendingCount, 200);
  });

  test('markRendered stores screen without amounts', () {
    RumBuffer.markRendered('dashboard');
    expect(RumBuffer.lastScreen, 'dashboard');
    expect(RumBuffer.pendingCount, 1);
  });

  test('netLabel maps connectivity to wifi|mobile|none', () {
    expect(RumInterceptor.netLabel(ConnectivityResult.wifi), 'wifi');
    expect(RumInterceptor.netLabel(ConnectivityResult.mobile), 'mobile');
    expect(RumInterceptor.netLabel(ConnectivityResult.none), 'none');
  });
}
