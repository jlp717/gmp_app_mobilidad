import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';

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
    PedidosOfflineService.debugResetCreateOrderForTesting();
    PedidosOfflineService.debugResetConfirmOrderForTesting();
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
    expect(result['maxConcurrency'], greaterThanOrEqualTo(2),
        reason: 'create+confirm offline must not be stuck at concurrency=1');
    expect(createCalls, 1);
    expect(confirmCalls, 1);
    expect(PedidosOfflineService.getPendingSyncs(), isEmpty);
  });

  test('create+confirm drains independent orders with real concurrency>1',
      () async {
    var inFlight = 0;
    var peakInFlight = 0;
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
      inFlight++;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      await Future<void>.delayed(const Duration(milliseconds: 60));
      final id = nextId++;
      inFlight--;
      return {'id': id, 'estado': 'BORRADOR'};
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

    for (var i = 0; i < 3; i++) {
      await PedidosOfflineService.queueOrderForSync(
        clientCode: '430000000${i + 1}',
        clientName: 'Parallel $i',
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
        observaciones: 'parallel-$i',
        clientRequestId: 'par${i}${DateTime.now().millisecondsSinceEpoch}',
      );
    }

    final sw = Stopwatch()..start();
    final result = await PedidosOfflineService.syncPendingOrdersWithResult(
      maxBatchSize: 10,
      maxConcurrency: 3,
    );
    sw.stop();

    expect(result['synced'], 3);
    expect(result['maxConcurrency'], 3);
    expect(peakInFlight, greaterThanOrEqualTo(2),
        reason: 'worker pool must overlap createOrder calls');
    expect(sw.elapsedMilliseconds, lessThan(160),
        reason: '3×60ms serial ≈180ms; concurrency=3 should finish sooner');
  });
}
