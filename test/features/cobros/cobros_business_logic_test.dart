import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/cobros/data/models/cobros_models.dart';
import 'package:gmp_app_mobilidad/features/cobros/providers/cobros_provider.dart';

void main() {
  group('Cobros models', () {
    test('parses pedidos summary separately from facturas and albaranes', () {
      final resumen = ResumenCobros.fromJson({
        'totalPendiente': 42.5,
        'pedidos': {'cantidad': 2, 'total': 42.5},
      });

      expect(resumen.totalPendiente, 42.5);
      expect(resumen.numPedidos, 2);
      expect(resumen.numFacturas, 0);
      expect(resumen.numAlbaranes, 0);
    });
  });

  group('Cobros provider params', () {
    test('uses value equality for Riverpod family keys', () {
      const a = CobrosParams(employeeCode: '01');
      const b = CobrosParams(employeeCode: '01');
      const c = CobrosParams(employeeCode: '02');

      expect(a, b);
      expect(a.hashCode, b.hashCode);
      expect(a == c, isFalse);
    });
  });
}
