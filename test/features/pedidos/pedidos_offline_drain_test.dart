import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_sync_bridge.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:hive/hive.dart';

/// Dedicated drain evidence for claim "offline sync" (no physical device).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory hiveDir;

  setUpAll(() async {
    hiveDir = await Directory.systemTemp.createTemp('pedidos_offline_drain_');
    Hive.init(hiveDir.path);
    await PedidosOfflineService.init();
  });

  tearDown(() async {
    await PedidosOfflineService.clearAll();
    PedidosOfflineService.clearScope();
    PedidosOfflineService.debugResetClockForTesting();
    PedidosOfflineService.debugResetAuthEpochForTesting();
    PedidosOfflineService.debugResetCreateOrderForTesting();
    PedidosOfflineService.debugResetConfirmOrderForTesting();
    PedidosOfflineService.onRetryScheduled = null;
    PedidosOfflineService.onAutoSyncThresholdReached = null;
    PedidosOfflineService.onScopeActivated = null;
    OfflineSyncBridge.debugResetRetryScheduler();
  });

  tearDownAll(() async {
    await Hive.close();
    if (await hiveDir.exists()) {
      await hiveDir.delete(recursive: true);
    }
  });

  test('drain empties queue after create+confirm doubles succeed', () async {
    var createCalls = 0;
    var confirmCalls = 0;

    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      createCalls += 1;
      return {'id': 9001, 'estado': 'BORRADOR'};
    });

    PedidosOfflineService.debugSetConfirmOrderForTesting((
      int orderId,
      String saleType, {
      String? deliveryDate,
      String? vehicleCode,
      String? driverCode,
      String? routeCode,
      bool cobroPropio = false,
    }) async {
      confirmCalls += 1;
      expect(orderId, 9001);
      return {'id': orderId, 'estado': 'CONFIRMADO'};
    });

    await PedidosOfflineService.queueOrderForSync(
      clientCode: '4300000001',
      clientName: 'HIT Offline Drain',
      vendedorCode: '35',
      saleType: 'CC',
      lines: [
        OrderLine(
          codigoArticulo: '1412',
          descripcion: 'HIT',
          cantidadEnvases: 1,
          cantidadUnidades: 0,
          unidadMedida: 'CAJAS',
          precioVenta: 10,
        ),
      ],
      observaciones: 'offline-drain-test',
      clientRequestId: 'drainhit${DateTime.now().millisecondsSinceEpoch}',
    );

    expect(PedidosOfflineService.getPendingSyncs(), hasLength(1));

    final result = await PedidosOfflineService.syncPendingOrdersWithResult(
      maxBatchSize: 5,
    );

    expect(result['synced'], 1);
    expect(result['failed'], 0);
    expect(result['remainingPending'], 0);
    expect(result['maxConcurrency'], 1,
        reason: 'the product drain is FIFO by default');
    expect(createCalls, 1);
    expect(confirmCalls, 1);
    expect(PedidosOfflineService.getPendingSyncs(), isEmpty);
  });

  test('default drain preserves FIFO create and confirm order', () async {
    final createdClients = <String>[];
    final confirmedIds = <int>[];
    var nextId = 9100;

    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      createdClients.add(clientCode);
      return {'id': nextId++, 'estado': 'BORRADOR'};
    });

    PedidosOfflineService.debugSetConfirmOrderForTesting((
      int orderId,
      String saleType, {
      String? deliveryDate,
      String? vehicleCode,
      String? driverCode,
      String? routeCode,
      bool cobroPropio = false,
    }) async {
      confirmedIds.add(orderId);
      return {'id': orderId, 'estado': 'CONFIRMADO'};
    });

    for (var i = 0; i < 3; i++) {
      await PedidosOfflineService.queueOrderForSync(
        clientCode: '430000000${i + 1}',
        clientName: 'FIFO $i',
        vendedorCode: '35',
        saleType: 'CC',
        lines: [
          OrderLine(
            codigoArticulo: '1412',
            descripcion: 'HIT',
            cantidadEnvases: 1,
            cantidadUnidades: 0,
            unidadMedida: 'CAJAS',
            precioVenta: 10,
          ),
        ],
        observaciones: 'fifo-$i',
        clientRequestId: 'fifo${i}${DateTime.now().millisecondsSinceEpoch}',
      );
    }

    final result = await PedidosOfflineService.syncPendingOrdersWithResult(
      maxBatchSize: 10,
    );

    expect(result['synced'], 3);
    expect(result['maxConcurrency'], 1);
    expect(createdClients, ['4300000001', '4300000002', '4300000003']);
    expect(confirmedIds, [9100, 9101, 9102]);
  });

  test('two drains for one account share a single in-flight operation',
      () async {
    final createStarted = Completer<void>();
    final releaseCreate = Completer<void>();
    var createCalls = 0;
    var confirmCalls = 0;

    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      createCalls++;
      if (!createStarted.isCompleted) createStarted.complete();
      await releaseCreate.future;
      return {'id': 9200, 'estado': 'BORRADOR'};
    });
    PedidosOfflineService.debugSetConfirmOrderForTesting((
      int orderId,
      String saleType, {
      String? deliveryDate,
      String? vehicleCode,
      String? driverCode,
      String? routeCode,
      bool cobroPropio = false,
    }) async {
      confirmCalls++;
      return {'id': orderId, 'estado': 'CONFIRMADO'};
    });

    await _queueOrder(clientCode: '4300000010', clientName: 'Single flight');

    final first = PedidosOfflineService.syncPendingOrdersWithResult();
    await createStarted.future;
    final second = PedidosOfflineService.syncPendingOrdersWithResult();
    releaseCreate.complete();

    final results = await Future.wait([first, second]);
    expect(results.map((result) => result['synced']), [1, 1]);
    expect(createCalls, 1);
    expect(confirmCalls, 1);
    expect(PedidosOfflineService.getPendingSyncs(), isEmpty);
  });

  test('transient retry persists and honours exponential backoff', () async {
    var now = DateTime.utc(2026, 11, 2, 8);
    PedidosOfflineService.debugSetClockForTesting(() => now);
    var shouldFail = true;
    var createCalls = 0;
    DateTime? scheduledRetry;
    PedidosOfflineService.onRetryScheduled = (_, retryAt) {
      scheduledRetry = retryAt;
    };

    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      createCalls++;
      if (shouldFail) throw StateError('network offline');
      return {'id': 9300, 'estado': 'BORRADOR'};
    });
    PedidosOfflineService.debugSetConfirmOrderForTesting((
      int orderId,
      String saleType, {
      String? deliveryDate,
      String? vehicleCode,
      String? driverCode,
      String? routeCode,
      bool cobroPropio = false,
    }) async {
      return {'id': orderId, 'estado': 'CONFIRMADO'};
    });

    await _queueOrder(clientCode: '4300000020', clientName: 'Backoff');
    final failed = await PedidosOfflineService.syncPendingOrdersWithResult();
    final pendingAfterFailure =
        PedidosOfflineService.getPendingSyncs().single as Map;

    expect(failed['transientFailed'], 1);
    expect(pendingAfterFailure['attempts'], 1);
    expect(pendingAfterFailure['nextRetryAt'],
        now.add(const Duration(seconds: 4)).toIso8601String());
    expect(scheduledRetry, now.add(const Duration(seconds: 4)));
    expect(failed['nextRetryAt'],
        now.add(const Duration(seconds: 4)).toIso8601String());

    shouldFail = false;
    final deferred = await PedidosOfflineService.syncPendingOrdersWithResult();
    expect(deferred['selectedForRun'], 0);
    expect(deferred['deferredByBackoff'], 1);
    expect(deferred['processed'], 0);
    expect(createCalls, 1);

    now = now.add(const Duration(seconds: 4));
    final recovered = await PedidosOfflineService.syncPendingOrdersWithResult();
    expect(recovered['synced'], 1);
    expect(createCalls, 2);
    expect(PedidosOfflineService.getPendingSyncs(), isEmpty);
  });

  test('manual retry resets attempts and retry deadline metadata', () async {
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      return {'queued': true, 'syncId': 'transport-only'};
    });

    await _queueOrder(clientCode: '4300000021', clientName: 'Manual retry');
    await PedidosOfflineService.syncPendingOrdersWithResult();
    final failed = PedidosOfflineService.getFailedSyncs().single as Map;

    expect(failed['attempts'], 1);
    expect(
        await PedidosOfflineService.retryFailedSync(
            failed['syncKey'].toString()),
        isTrue);
    final pending = PedidosOfflineService.getPendingSyncs().single as Map;
    expect(pending['attempts'], 0);
    expect(pending.containsKey('error'), isFalse);
    expect(pending.containsKey('failedAt'), isFalse);
    expect(pending.containsKey('nextRetryAt'), isFalse);
    expect(pending.containsKey('lastAttemptAt'), isFalse);
  });

  test('an account switch defers confirmation under the new account', () async {
    final accountACreateStarted = Completer<void>();
    final releaseAccountA = Completer<void>();
    var confirmCalls = 0;

    PedidosOfflineService.setScope('sales-rep-a');
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      if (!accountACreateStarted.isCompleted) {
        accountACreateStarted.complete();
      }
      await releaseAccountA.future;
      return {'id': 9400, 'estado': 'BORRADOR'};
    });
    PedidosOfflineService.debugSetConfirmOrderForTesting((
      int orderId,
      String saleType, {
      String? deliveryDate,
      String? vehicleCode,
      String? driverCode,
      String? routeCode,
      bool cobroPropio = false,
    }) async {
      confirmCalls++;
      return {'id': orderId, 'estado': 'CONFIRMADO'};
    });

    await _queueOrder(clientCode: '4300000030', clientName: 'Cuenta A');
    final accountADrain = PedidosOfflineService.syncPendingOrdersWithResult();
    await accountACreateStarted.future;

    PedidosOfflineService.setScope('sales-rep-b');
    await _queueOrder(clientCode: '4300000040', clientName: 'Cuenta B');
    expect(PedidosOfflineService.getPendingSyncs(), hasLength(1));

    releaseAccountA.complete();
    final accountAResult = await accountADrain;
    expect(accountAResult['synced'], 0);
    expect(accountAResult['identityDeferred'], 1);
    expect(confirmCalls, 0,
        reason: 'account B credentials must never confirm account A work');
    expect(PedidosOfflineService.getPendingSyncs(), hasLength(1),
        reason: 'account B queue data stays isolated');

    PedidosOfflineService.setScope('sales-rep-a');
    final accountAPending =
        PedidosOfflineService.getPendingSyncs().single as Map;
    expect(accountAPending['serverOrderId'], 9400,
        reason: 'created server draft is retained for idempotent resume');
  });

  test('auth epoch change without scope change stops before confirm', () async {
    var epoch = 10;
    final createStarted = Completer<void>();
    final releaseCreate = Completer<void>();
    var confirmCalls = 0;
    PedidosOfflineService.setScope('sales-rep-a');
    PedidosOfflineService.debugSetAuthEpochForTesting(() => epoch);
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      createStarted.complete();
      await releaseCreate.future;
      return {'id': 9500, 'estado': 'BORRADOR'};
    });
    PedidosOfflineService.debugSetConfirmOrderForTesting((
      int orderId,
      String saleType, {
      String? deliveryDate,
      String? vehicleCode,
      String? driverCode,
      String? routeCode,
      bool cobroPropio = false,
    }) async {
      confirmCalls++;
      return {'id': orderId, 'estado': 'CONFIRMADO'};
    });

    await _queueOrder(clientCode: '4300000050', clientName: 'Epoch A');
    final drain = PedidosOfflineService.syncPendingOrdersWithResult();
    await createStarted.future;
    epoch++;
    releaseCreate.complete();

    final result = await drain;
    expect(result['identityDeferred'], 1);
    expect(confirmCalls, 0);
    expect(
      (PedidosOfflineService.getPendingSyncs().single as Map)['serverOrderId'],
      9500,
    );
  });

  test('blocked confirmation stays failed with actionable server reason',
      () async {
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      return {'id': 9600, 'estado': 'BORRADOR'};
    });
    PedidosOfflineService.debugSetConfirmOrderForTesting((
      int orderId,
      String saleType, {
      String? deliveryDate,
      String? vehicleCode,
      String? driverCode,
      String? routeCode,
      bool cobroPropio = false,
    }) async {
      return {
        'blocked': true,
        'reason': 'STOCK_INSUFICIENTE',
        'message': 'Stock actualizado: revise la cantidad.',
      };
    });

    await _queueOrder(clientCode: '4300000060', clientName: 'Blocked');
    final result = await PedidosOfflineService.syncPendingOrdersWithResult();

    expect(result['synced'], 0);
    expect(result['failed'], 1);
    final failed = PedidosOfflineService.getFailedSyncs().single as Map;
    expect(failed['serverOrderId'], 9600);
    expect(failed['error'], contains('Stock actualizado'));
  });

  test('persisted retry deadline wakes the bridge runner for its account',
      () async {
    PedidosOfflineService.setScope('sales-rep-a');
    final woke = Completer<void>();
    OfflineSyncBridge.retryRunnerOverride = () async {
      if (!woke.isCompleted) woke.complete();
    };

    OfflineSyncBridge.debugSchedulePedidoRetry(
      PedidosOfflineService.currentScopeId,
      DateTime.now().add(const Duration(milliseconds: 20)),
    );

    await woke.future.timeout(const Duration(seconds: 1));
  });

  test('persisted threshold drains the third finalized order FIFO, not drafts',
      () async {
    PedidosOfflineService.setScope('sales-rep-threshold');
    final createdClients = <String>[];
    final confirmedIds = <int>[];
    final drained = Completer<void>();
    var nextId = 9700;
    var thresholdRuns = 0;

    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      createdClients.add(clientCode);
      return {'id': nextId++, 'estado': 'BORRADOR'};
    });
    PedidosOfflineService.debugSetConfirmOrderForTesting((
      int orderId,
      String saleType, {
      String? deliveryDate,
      String? vehicleCode,
      String? driverCode,
      String? routeCode,
      bool cobroPropio = false,
    }) async {
      confirmedIds.add(orderId);
      return {'id': orderId, 'estado': 'CONFIRMADO'};
    });
    PedidosOfflineService.onAutoSyncThresholdReached =
        (scope, vendedorCode) async {
      thresholdRuns++;
      expect(scope, PedidosOfflineService.currentScopeId);
      expect(vendedorCode, '35');
      await PedidosOfflineService.syncPendingOrdersWithResult(
        maxBatchSize: 50,
      );
      if (!drained.isCompleted) drained.complete();
    };
    await PedidosOfflineService.configureAutoSyncThreshold(
      vendedorCode: '35',
      threshold: 3,
    );

    await _queueOrder(clientCode: '4300000101', clientName: 'Primero');
    PedidosOfflineService.setScope('temporary-other-account');
    PedidosOfflineService.setScope('sales-rep-threshold');
    await PedidosOfflineService.saveDraft(
      clientCode: 'DRAFT-ONLY',
      clientName: 'Borrador no finalizado',
      saleType: 'CC',
      vendedorCode: '35',
      lines: const <OrderLine>[],
    );
    await _queueOrder(clientCode: '4300000102', clientName: 'Segundo');
    await Future<void>.delayed(Duration.zero);
    expect(thresholdRuns, 0);
    expect(PedidosOfflineService.getPendingSyncs(), hasLength(2));
    expect(PedidosOfflineService.getDrafts(), hasLength(1));

    await _queueOrder(clientCode: '4300000103', clientName: 'Tercero');
    await drained.future.timeout(const Duration(seconds: 1));

    expect(thresholdRuns, 1);
    expect(createdClients, ['4300000101', '4300000102', '4300000103']);
    expect(confirmedIds, [9700, 9701, 9702]);
    expect(PedidosOfflineService.getPendingSyncs(), isEmpty);
    expect(PedidosOfflineService.getDrafts(), hasLength(1));
  });

  test('retry for A is rearmed once after its deadline passes under B',
      () async {
    var now = DateTime.utc(2026, 11, 2, 8);
    PedidosOfflineService.debugSetClockForTesting(() => now);
    OfflineSyncBridge.debugSetClockForTesting(() => now);
    OfflineSyncBridge.bindPedidosQueueHooks(canAutoSync: () => true);
    final woke = Completer<void>();
    var runs = 0;
    OfflineSyncBridge.retryRunnerOverride = () async {
      runs++;
      if (!woke.isCompleted) woke.complete();
    };

    PedidosOfflineService.setScope('sales-rep-a');
    final scopeA = PedidosOfflineService.currentScopeId;
    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      throw StateError('network offline');
    });
    await _queueOrder(clientCode: '4300000199', clientName: 'Retry durable A');
    final failed = await PedidosOfflineService.syncPendingOrdersWithResult();
    expect(
      failed['nextRetryAt'],
      now.add(const Duration(seconds: 4)).toIso8601String(),
    );
    expect(
      PedidosOfflineService.earliestRetryAtForScope(scopeA),
      now.add(const Duration(seconds: 4)),
    );

    PedidosOfflineService.setScope('sales-rep-b');
    now = now.add(const Duration(seconds: 5));
    await Future<void>.delayed(Duration.zero);
    expect(runs, 0);

    PedidosOfflineService.setScope('sales-rep-a');
    await woke.future.timeout(const Duration(seconds: 1));
    await Future<void>.delayed(Duration.zero);
    expect(runs, 1);
  });

  test('bridge reruns B after active A finishes without confirming A as B',
      () async {
    final aCreateStarted = Completer<void>();
    final releaseA = Completer<void>();
    final bConfirmed = Completer<void>();
    final confirmedIds = <int>[];

    PedidosOfflineService.debugSetCreateOrderForTesting(({
      required String clientCode,
      required String clientName,
      required String vendedorCode,
      required String tipoVenta,
      required List lines,
      required String observaciones,
      required String? clientRequestId,
      double descuentoGlobal = 0,
    }) async {
      if (clientCode == '4300000201') {
        aCreateStarted.complete();
        await releaseA.future;
        return {'id': 9801, 'estado': 'BORRADOR'};
      }
      return {'id': 9802, 'estado': 'BORRADOR'};
    });
    PedidosOfflineService.debugSetConfirmOrderForTesting((
      int orderId,
      String saleType, {
      String? deliveryDate,
      String? vehicleCode,
      String? driverCode,
      String? routeCode,
      bool cobroPropio = false,
    }) async {
      confirmedIds.add(orderId);
      if (orderId == 9802 && !bConfirmed.isCompleted) bConfirmed.complete();
      return {'id': orderId, 'estado': 'CONFIRMADO'};
    });

    PedidosOfflineService.setScope('sales-rep-a');
    await _queueOrder(clientCode: '4300000201', clientName: 'Cuenta A');
    final runA = OfflineSyncBridge.syncAll(notify: false);
    await aCreateStarted.future;

    PedidosOfflineService.setScope('sales-rep-b');
    await _queueOrder(clientCode: '4300000202', clientName: 'Cuenta B');
    final queuedB = await OfflineSyncBridge.syncAll(notify: false);
    expect(queuedB.pedidosSynced, 0);
    releaseA.complete();
    await runA;
    await bConfirmed.future.timeout(const Duration(seconds: 2));
    await OfflineSyncBridge.debugWaitUntilIdle().timeout(
      const Duration(seconds: 2),
    );

    expect(confirmedIds, [9802]);
    expect(PedidosOfflineService.getPendingSyncs(), isEmpty);
    PedidosOfflineService.setScope('sales-rep-a');
    final pendingA = PedidosOfflineService.getPendingSyncs().single as Map;
    expect(pendingA['serverOrderId'], 9801);
  });
}

Future<String> _queueOrder({
  required String clientCode,
  required String clientName,
}) {
  return PedidosOfflineService.queueOrderForSync(
    clientCode: clientCode,
    clientName: clientName,
    vendedorCode: '35',
    saleType: 'CC',
    lines: [
      OrderLine(
        codigoArticulo: '1412',
        descripcion: 'HIT',
        cantidadEnvases: 1,
        cantidadUnidades: 0,
        unidadMedida: 'CAJAS',
        precioVenta: 10,
      ),
    ],
    observaciones: 'offline-drain-test',
  );
}
