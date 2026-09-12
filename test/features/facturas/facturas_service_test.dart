import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/facturas/data/facturas_service.dart';

void main() {
  group('Factura.fromJson', () {
    test('parses albaran document type and terminal', () {
      final factura = Factura.fromJson({
        'id': 'ALB-2026-J-93-1187',
        'documentType': 'albaran',
        'serie': 'J',
        'numero': 1187,
        'ejercicio': 2026,
        'terminal': 93,
        'fecha': '29/06/2026',
        'clienteId': '4300009588',
        'clienteNombre': 'CASER RESIDENCIAL SANTO ANGEL',
        'total': 711.55,
        'base': 671.66,
        'iva': 39.89,
      });

      expect(factura.isAlbaran, true);
      expect(factura.isFactura, false);
      expect(factura.terminal, 93);
      expect(factura.numeroFormateado, 'J-93-1187');
      expect(factura.pdfFilePrefix, 'Albaran');
      expect(factura.base, 671.66);
      expect(factura.iva, 39.89);
      expect(factura.total, 711.55);
    });
  });

  group('FacturaSummary.fromJson', () {
    test('parses document totals with backwards compatible totalFacturas', () {
      final summary = FacturaSummary.fromJson({
        'totalFacturas': 5,
        'totalDocumentos': 5,
        'totalFacturasEmitidas': 3,
        'totalAlbaranes': 2,
        'totalImporte': 1000,
        'totalBase': 900,
        'totalIva': 100,
      });

      expect(summary.totalDocumentos, 5);
      expect(summary.totalFacturas, 5);
      expect(summary.totalFacturasEmitidas, 3);
      expect(summary.totalAlbaranes, 2);
    });

    test('fromDocuments sums count, base, IVA and total of visible docs', () {
      final summary = FacturaSummary.fromDocuments([
        Factura.fromJson({
          'id': 'F-1-2026',
          'documentType': 'factura',
          'serie': 'A',
          'numero': 1,
          'ejercicio': 2026,
          'fecha': '05/09/2026',
          'clienteId': '1',
          'clienteNombre': 'Restaurante',
          'total': 176.32,
          'base': 160.29,
          'iva': 16.03,
        }),
        Factura.fromJson({
          'id': 'ALB-2026-P-33-2930',
          'documentType': 'albaran',
          'serie': 'P',
          'numero': 2930,
          'ejercicio': 2026,
          'terminal': 33,
          'fecha': '05/09/2026',
          'clienteId': '2',
          'clienteNombre': 'Chiringuito',
          'total': 227.33,
          'base': 206.66,
          'iva': 20.67,
        }),
      ]);

      expect(summary.totalDocumentos, 2);
      expect(summary.totalFacturasEmitidas, 1);
      expect(summary.totalAlbaranes, 1);
      expect(summary.totalBase, closeTo(366.95, 0.001));
      expect(summary.totalIva, closeTo(36.70, 0.001));
      expect(summary.totalImporte, closeTo(403.65, 0.001));
      expect(
        summary.totalBase + summary.totalIva,
        closeTo(summary.totalImporte, 0.001),
      );
    });
  });
}
