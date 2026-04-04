import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

void main() {
  group('AlbaranEntrega.fromJson', () {
    test('parses basic fields correctly', () {
      final json = {
        'id': '2026-P-93-69',
        'numero': 69,
        'ejercicio': 2026,
        'serie': 'P',
        'terminal': 93,
        'numeroFactura': 219,
        'serieFactura': 'A',
        'codigoCliente': '4300039982',
        'nombreCliente': 'DELEGACION ALMERIA (90)',
        'direccion': 'ALMERIA',
        'poblacion': 'ALMERIA',
        'importe': 570.39,
        'formaPago': '02',
        'formaPagoDesc': 'CREDITO',
        'tipoPago': 'CREDITO',
        'esCTR': false,
        'puedeCobrarse': false,
        'colorEstado': 'green',
        'estado': 'ENTREGADO',
        'items': [],
      };

      final albaran = AlbaranEntrega.fromJson(json);

      expect(albaran.id, '2026-P-93-69');
      expect(albaran.numeroAlbaran, 69);
      expect(albaran.numeroFactura, 219);
      expect(albaran.serieFactura, 'A');
      expect(albaran.importeTotal, 570.39);
      expect(albaran.nombreCliente, 'DELEGACION ALMERIA (90)');
      expect(albaran.formaPagoDesc, 'CREDITO');
    });

    test('uses importe field for importeTotal', () {
      final json = {
        'id': 'test-1',
        'numero': 1,
        'ejercicio': 2026,
        'importe': 105.53,
        'codigoCliente': 'C1',
        'nombreCliente': 'Test',
        'fecha': '02/03/2026',
      };

      final albaran = AlbaranEntrega.fromJson(json);
      expect(albaran.importeTotal, 105.53);
    });

    test('falls back to importeTotal field when importe is missing', () {
      final json = {
        'id': 'test-2',
        'numero': 2,
        'ejercicio': 2026,
        'importeTotal': 200.00,
        'codigoCliente': 'C2',
        'nombreCliente': 'Test 2',
        'fecha': '02/03/2026',
      };

      final albaran = AlbaranEntrega.fromJson(json);
      expect(albaran.importeTotal, 200.00);
    });

    test('handles zero importe', () {
      final json = {
        'id': 'test-3',
        'numero': 3,
        'ejercicio': 2026,
        'importe': 0,
        'codigoCliente': 'C3',
        'nombreCliente': 'Test 3',
        'fecha': '02/03/2026',
      };

      final albaran = AlbaranEntrega.fromJson(json);
      expect(albaran.importeTotal, 0.0);
    });

    test('parses items correctly', () {
      final json = {
        'id': 'test-4',
        'numero': 4,
        'ejercicio': 2026,
        'importe': 98.73,
        'codigoCliente': 'C4',
        'nombreCliente': 'Test 4',
        'fecha': '02/03/2026',
        'items': [
          {
            'itemId': '1',
            'codigoArticulo': '7865',
            'descripcion': 'PAN BARRA RIQUINA MEDIT.(23U)275GR....30',
            'cantidadPedida': 4,
            'precioUnitario': 16.12,
          },
          {
            'itemId': '2',
            'codigoArticulo': '7392',
            'descripcion': 'NAPOLITANA CHOCOLATE FERM.115GR (70U).24',
            'cantidadPedida': 1,
            'precioUnitario': 34.24,
          },
        ],
      };

      final albaran = AlbaranEntrega.fromJson(json);
      expect(albaran.items.length, 2);
      expect(albaran.items[0].codigoArticulo, '7865');
      expect(albaran.items[0].cantidadPedida, 4.0);
      expect(albaran.items[1].descripcion, 'NAPOLITANA CHOCOLATE FERM.115GR (70U).24');
    });

    test('detects factura vs albaran document type', () {
      final facturaJson = {
        'id': 'f-1',
        'numero': 10,
        'ejercicio': 2026,
        'numeroFactura': 219,
        'importe': 100,
        'codigoCliente': 'C5',
        'nombreCliente': 'Test',
        'fecha': '02/03/2026',
      };

      final albaranJson = {
        'id': 'a-1',
        'numero': 10,
        'ejercicio': 2026,
        'numeroFactura': 0,
        'importe': 100,
        'codigoCliente': 'C6',
        'nombreCliente': 'Test',
        'fecha': '02/03/2026',
      };

      final factura = AlbaranEntrega.fromJson(facturaJson);
      final albaran = AlbaranEntrega.fromJson(albaranJson);

      expect(factura.numeroFactura, 219);
      expect(albaran.numeroFactura, 0);
    });
  });

  group('EntregaItem.fromJson', () {
    test('parses basic item fields', () {
      final json = {
        'itemId': '1',
        'codigoArticulo': '7865',
        'descripcion': 'PAN BARRA RIQUINA',
        'cantidadPedida': 4,
        'precioUnitario': 16.12,
      };

      final item = EntregaItem.fromJson(json);
      expect(item.codigoArticulo, '7865');
      expect(item.cantidadPedida, 4.0);
      expect(item.precioUnitario, 16.12);
    });

    test('handles missing optional fields', () {
      final json = {
        'itemId': '1',
        'codigoArticulo': '7865',
        'descripcion': 'Test',
      };

      final item = EntregaItem.fromJson(json);
      expect(item.cantidadPedida, 0.0);
      expect(item.precioUnitario, 0.0);
      expect(item.cantidadEntregada, 0.0);
    });
  });
}
