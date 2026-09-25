import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/presentation/widgets/rutero_detail_products.dart';

void main() {
  test('pollo a peso keeps decimals and labels kg', () {
    expect(
      ruteroQuantityWithUnit(quantity: 5.75, unit: 'KG'),
      '5,75 kg',
    );
    expect(
      ruteroQuantityWithUnit(quantity: 5.75, unit: ''),
      '5,75 kg',
    );
    expect(quantityStepForUnit('KG'), 0.1);
  });

  test('boxed products keep integer cajas, not kg', () {
    expect(
      ruteroQuantityWithUnit(quantity: 2, unit: 'CAJAS'),
      '2 cajas',
    );
    expect(
      ruteroQuantityWithUnit(quantity: 2, unit: '', bultos: 2),
      '2 cajas',
    );
    expect(quantityStepForUnit('CAJAS'), 1);
  });

  test('piece units stay uds', () {
    expect(
      ruteroQuantityWithUnit(quantity: 1, unit: 'UNIDADES'),
      '1 ud',
    );
    expect(
      ruteroQuantityWithUnit(quantity: 3, unit: ''),
      '3 uds',
    );
  });
}
