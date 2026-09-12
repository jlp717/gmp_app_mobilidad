import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/erp_document_label.dart';
import 'package:gmp_app_mobilidad/features/entregas/providers/entregas_provider.dart';

void main() {
  test('keeps the terminal segment', () {
    expect(
      formatErpDocumentLabel(serie: 'P', terminal: 15, numero: 2296),
      'P-15-2296',
    );
  });

  test('albarán y factura del rutero usan P-15-2296, no P-2296', () {
    final albaran = AlbaranEntrega(
      id: '2026-P-15-2296-C1',
      numeroAlbaran: 2296,
      ejercicio: 2026,
      serie: 'P',
      terminal: 15,
      codigoCliente: 'C1',
      nombreCliente: 'Cliente',
      fecha: '2026-09-12',
      importeTotal: 76,
      codigoRepartidor: '08',
    );
    expect(albaran.erpDocumentId, 'P-15-2296');
    expect(albaran.erpDocumentLabel, 'Albarán P-15-2296');

    final factura = AlbaranEntrega(
      id: '2026-P-15-2296-C1-F',
      numeroAlbaran: 2296,
      ejercicio: 2026,
      serie: 'P',
      terminal: 15,
      numeroFactura: 2296,
      serieFactura: 'P',
      codigoCliente: 'C1',
      nombreCliente: 'Cliente',
      fecha: '2026-09-12',
      importeTotal: 76,
      codigoRepartidor: '08',
    );
    expect(factura.erpDocumentId, 'P-15-2296');
    expect(factura.erpDocumentLabel, 'Factura P-15-2296');
  });
}
