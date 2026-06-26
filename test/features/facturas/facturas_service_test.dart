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
      expect(factura.numeroFormateado, 'J-093-01187');
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
  });
}
