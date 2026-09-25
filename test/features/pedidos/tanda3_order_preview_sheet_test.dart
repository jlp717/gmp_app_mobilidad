/// Tanda 3 — REQ-17 widget test doble diálogo `showOrderPreviewSheet`.
/// - Un tap en CONFIRMAR PEDIDO abre segundo diálogo SIN llamar red.
/// - Revisar vuelve al sheet sin llamada.
/// - Confirmar (segundo diálogo) ejecuta onConfirm UNA sola vez;
///   tras éxito el botón queda deshabilitado (sin doble llamada).
/// - Resultado en cola/offline muestra "guardado localmente".
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_offline_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/data/pedidos_service.dart';
import 'package:gmp_app_mobilidad/features/pedidos/presentation/widgets/order_preview_sheet.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/features/pedidos/providers/pedidos_notifier.dart';
import 'package:hive_flutter/hive_flutter.dart';

class _OnConfirmRecorder {
  _OnConfirmRecorder(this.result);
  final Map<String, dynamic> result;
  int calls = 0;

  Future<dynamic> call(
    String observaciones, {
    String? deliveryDate,
    String? vehicleCode,
    String? driverCode,
    String? routeCode,
    bool cobroPropio = false,
  }) async {
    calls++;
    await Future<void>.delayed(const Duration(milliseconds: 50));
    return Map<String, dynamic>.from(result);
  }
}

({ProviderContainer container, PedidosNotifier notifier}) _providerWithLine() {
  final container = ProviderContainer();
  addTearDown(container.dispose);
  final notifier = container.read(pedidosNotifierProvider.notifier);
  notifier.debugSetRefreshAfterConfirm(false);
  notifier.setClient('C1', 'Cliente Test');
  final err = notifier.addLine(
    Product(
      code: 'P1',
      name: 'Producto 1',
      stockEnvases: 100,
      precioTarifa1: 10,
      precioCliente: 10,
      precioCosto: 5,
    ),
    1,
    0,
    'CAJAS',
    10,
  );
  assert(err == null, 'addLine debe aceptar la línea: $err');
  return (container: container, notifier: notifier);
}

Future<void> _openSheet(
  WidgetTester tester,
  PedidosNotifier provider,
  OrderPreviewConfirm onConfirm,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (ctx) => ElevatedButton(
            onPressed: () => showOrderPreviewSheet(
              context: ctx,
              provider: provider,
              vendedorCode: '15',
              onConfirm: onConfirm,
            ),
            child: const Text('open-sheet'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open-sheet'));
  // Sin pumpAndSettle: el sheet tiene pulse-animation infinito
  // (_pulseController.repeat) que nunca deja asentar frames.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  // _loadDeliveryOptions falla rápido en test (400/backend ausente)
  // y habilita el botón CONFIRMAR.
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump();
}

void main() {
  late Directory hiveDir;

  setUpAll(() async {
    hiveDir = await Directory.systemTemp.createTemp('preview_sheet_test_');
    Hive.init(hiveDir.path);
    await PedidosOfflineService.init();
  });

  tearDownAll(() async {
    await Hive.close();
    if (await hiveDir.exists()) {
      await hiveDir.delete(recursive: true);
    }
  });

  group('REQ-17 doble diálogo anti-toque', () {
    testWidgets('CONFIRMAR abre 2º diálogo sin red; Revisar vuelve sin llamar',
        (tester) async {
      final recorder = _OnConfirmRecorder({
        'estado': 'CONFIRMADO',
        'numeroPedido': 1001,
      });
      await _openSheet(tester, _providerWithLine().notifier, recorder.call);

      expect(find.text('CONFIRMAR PEDIDO'), findsOneWidget);

      // 1er tap: solo abre 2º diálogo, cero red.
      await tester.tap(find.text('CONFIRMAR PEDIDO'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.text('Confirmar pedido'), findsOneWidget);
      expect(recorder.calls, 0);

      // Revisar: vuelve al sheet sin llamar.
      await tester.tap(find.text('Revisar'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.text('Confirmar pedido'), findsNothing);
      expect(find.text('CONFIRMAR PEDIDO'), findsOneWidget);
      expect(recorder.calls, 0);
    });

    testWidgets('Confirmar ejecuta una sola vez; sin doble llamada',
        (tester) async {
      final recorder = _OnConfirmRecorder({
        'estado': 'CONFIRMADO',
        'numeroPedido': 1001,
      });
      await _openSheet(tester, _providerWithLine().notifier, recorder.call);

      await tester.tap(find.text('CONFIRMAR PEDIDO'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      await tester.tap(find.text('Confirmar').last);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(recorder.calls, 1);
      expect(find.textContaining('Pedido #1001 confirmado'), findsOneWidget);

      // Ventana 2s de éxito: el sheet deshabilita (Confirmado) y cierra.
      await tester.pump(const Duration(seconds: 3));
      await tester.pump();
      expect(recorder.calls, 1);
    });

    testWidgets('resultado en cola indica guardado local', (tester) async {
      final recorder = _OnConfirmRecorder({
        'queued': true,
        'pendingConfirmation': true,
        'message':
            'Pedido guardado localmente. Se enviara al recuperar conexion.',
      });
      await _openSheet(tester, _providerWithLine().notifier, recorder.call);

      await tester.tap(find.text('CONFIRMAR PEDIDO'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      await tester.tap(find.text('Confirmar').last);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(recorder.calls, 1);
      expect(find.textContaining('guardado localmente'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      await tester.pump();
    });
  });
}
