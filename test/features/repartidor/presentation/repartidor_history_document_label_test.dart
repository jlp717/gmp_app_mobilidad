import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/pages/repartidor_historico_page.dart';

void main() {
  test('histórico muestra albarán P-15-2296, no P-2296', () {
    expect(
      repartidorHistoryAlbaranLabel(serie: 'P', terminal: 15, numero: 2296),
      'P-15-2296',
    );
  });

  test('histórico muestra factura con serie-terminal-número', () {
    expect(
      repartidorHistoryFacturaLabel(
        serie: 'P',
        serieFactura: 'F',
        terminal: 15,
        numero: 2296,
      ),
      'F-15-2296',
    );
  });

  test('factura sin serie propia reutiliza la del albarán', () {
    expect(
      repartidorHistoryFacturaLabel(
        serie: 'P',
        serieFactura: '',
        terminal: 15,
        numero: 88,
      ),
      'P-15-88',
    );
  });
}
