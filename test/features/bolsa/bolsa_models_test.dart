import 'package:gmp_app_mobilidad/features/bolsa/providers/bolsa_provider.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/bolsa/data/bolsa_models.dart';

void main() {
  group('BolsaMovimiento.fromJson', () {
    test('keeps legacy payload compatibility when ledger fields are absent',
        () {
      final movimiento = BolsaMovimiento.fromJson({
        'id': 7,
        'tipo': 'ACUMULACION',
        'importe': 12.5,
        'saldoAnterior': 100,
        'saldoPosterior': 112.5,
        'codigoArticulo': 'ART-1',
        'descripcion': 'Articulo legado',
      });

      expect(movimiento.id, 7);
      expect(movimiento.tipo, BolsaMovimientoTipo.acumulacion);
      expect(movimiento.lineId, isNull);
      expect(movimiento.precioMinimoCongelado, isNull);
      expect(movimiento.precioVenta, isNull);
      expect(movimiento.cantidad, isNull);
      expect(movimiento.unidadMedida, isNull);
      expect(movimiento.idempotencyKey, isNull);
    });

    test('parses detailed ledger context fields when present', () {
      final movimiento = BolsaMovimiento.fromJson({
        'id': '11',
        'tipo': 'CONSUMO',
        'importe': '3.40',
        'saldoAnterior': '25.00',
        'saldoPosterior': '21.60',
        'codigoArticulo': 'SKU-42',
        'descripcion': 'Producto con detalle',
        'pedidoId': '9001',
        'lineId': '3',
        'precioMinimoCongelado': '2.10',
        'precioVenta': '1.95',
        'cantidad': '4.5',
        'unidadMedida': 'kg',
        'idempotencyKey': 'pedido-9001-linea-3',
      });

      expect(movimiento.tipo, BolsaMovimientoTipo.consumo);
      expect(movimiento.pedidoId, 9001);
      expect(movimiento.lineId, 3);
      expect(movimiento.precioMinimoCongelado, 2.10);
      expect(movimiento.precioVenta, 1.95);
      expect(movimiento.cantidad, 4.5);
      expect(movimiento.unidadMedida, 'kg');
      expect(movimiento.idempotencyKey, 'pedido-9001-linea-3');
    });
  });
  group('BolsaProvider vendor selection hygiene', () {
    test('clears stale vendor status instead of loading ALL as a bolsa vendor',
        () async {
      final requestedPaths = <String>[];
      final interceptor = InterceptorsWrapper(
        onRequest: (options, handler) {
          requestedPaths.add(options.path);
          if (options.path.contains('/bolsa/')) {
            if (options.path.endsWith('/status')) {
              final code = options.path.split('/')[2];
              handler.resolve(
                Response<Map<String, dynamic>>(
                  requestOptions: options,
                  data: {
                    'bolsa': {
                      'vendedor': code,
                      'ejercicio': 2026,
                      'mes': 6,
                      'saldoDisponible': code == '57' ? 125 : 999,
                      'consumido': 0,
                      'acumulado': code == '57' ? 125 : 999,
                    },
                  },
                ),
              );
              return;
            }
            if (options.path.endsWith('/movements')) {
              handler.resolve(Response<Map<String, dynamic>>(
                requestOptions: options,
                data: const {'movements': []},
              ));
              return;
            }
            if (options.path.endsWith('/history')) {
              handler.resolve(Response<Map<String, dynamic>>(
                requestOptions: options,
                data: const {'points': []},
              ));
              return;
            }
          }
          handler.next(options);
        },
      );
      ApiClient.dio.interceptors.add(interceptor);
      addTearDown(() => ApiClient.dio.interceptors.remove(interceptor));

      final provider = BolsaProvider();
      await provider.load('57', force: true);
      expect(provider.status?.vendedor, '57');

      await provider.load('ALL', force: true);

      expect(provider.status, isNull);
      expect(provider.currentVendor, isNull);
      expect(requestedPaths.where((path) => path.contains('/ALL/')), isEmpty);
    });
  });
}
