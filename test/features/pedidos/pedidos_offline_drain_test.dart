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
    expect(createCalls, 1);
    expect(confirmCalls, 1);
    expect(PedidosOfflineService.getPendingSyncs(), isEmpty);
  });
}
