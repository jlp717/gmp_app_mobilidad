import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/quantity_format.dart';

void main() {
  test('enteros sin decimales y fraccionarios con los que tengan', () {
    expect(formatCatalogQuantity(237), '237');
    expect(formatCatalogQuantity(1044), '1.044');
    expect(formatCatalogQuantity(10), '10');
    expect(formatCatalogQuantity(1.5), '1,5');
    expect(formatCatalogQuantity(10.25), '10,25');
    expect(formatCatalogQuantity(2.5), '2,5');
    expect(formatCatalogQuantity(0), '0');
  });
}
