import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/offline/verified_pedido_refresh.dart';

void main() {
  test('epoch rotation during invalidation prevents every dependent refresh',
      () async {
    var epoch = 7;
    var refreshCalls = 0;
    final invalidationStarted = Completer<void>();
    final releaseInvalidation = Completer<void>();

    final operation = VerifiedPedidoRefresh.run(
      scope: 'opaque-scope',
      authEpoch: 7,
      orderIds: const [4105],
      isMounted: () => true,
      currentScope: () => 'opaque-scope',
      currentAuthEpoch: () => epoch,
      invalidate: () async {
        invalidationStarted.complete();
        await releaseInvalidation.future;
      },
      refresh: (_) async => refreshCalls++,
    );

    await invalidationStarted.future;
    epoch = 8;
    releaseInvalidation.complete();

    expect(await operation, isFalse);
    expect(refreshCalls, 0);
  });
}
