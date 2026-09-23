import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/product_family_filter.dart';

void main() {
  group('ProductFamilyFilter', () {
    test('fromJson marks Impulso 003 and Nestlé cluster from real FAM names',
        () {
      final impulso = ProductFamilyFilter.fromJson({
        'code': '003',
        'name': 'NESTLE IMPULSO',
        'prefamily': 'Z',
        'artCount': 191,
        'isNestle': true,
        'isImpulso': true,
      });
      expect(impulso.code, '003');
      expect(impulso.isImpulso, isTrue);
      expect(impulso.isNestle, isTrue);
      expect(impulso.chipLabel, 'Impulso');

      final congelado = ProductFamilyFilter.fromJson({
        'code': '001',
        'name': 'CONGELADO',
        'artCount': 779,
      });
      expect(congelado.isImpulso, isFalse);
      expect(congelado.chipLabel, 'Congelado');
    });

    test('orderFamiliesForChips pins Impulso first when present in DB payload',
        () {
      final ordered = orderFamiliesForChips([
        const ProductFamilyFilter(code: '060', name: 'TOPFRESH', artCount: 77),
        const ProductFamilyFilter(
          code: '003',
          name: 'NESTLE IMPULSO',
          artCount: 191,
          isImpulso: true,
          isNestle: true,
        ),
        const ProductFamilyFilter(
            code: '001', name: 'CONGELADO', artCount: 779),
        const ProductFamilyFilter(code: '998', name: 'ENVASES', artCount: 18),
      ]);

      expect(ordered.map((f) => f.code).toList(), [
        '003',
        '001',
        '060',
        '998',
      ]);
      expect(ordered.first.chipLabel, 'Impulso');
    });

    test('orderFamiliesForChips never invents codes missing from API', () {
      final ordered = orderFamiliesForChips([
        const ProductFamilyFilter(code: '001', name: 'CONGELADO'),
      ]);
      expect(ordered.map((f) => f.code), ['001']);
      expect(ordered.any((f) => f.code == '003'), isFalse);
    });
  });
}
