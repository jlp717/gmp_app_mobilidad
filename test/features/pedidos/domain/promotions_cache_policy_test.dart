import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/pedidos/domain/promotions_cache_policy.dart';

void main() {
  group('promotions cache policy', () {
    test('normalizes CHAR(10) DB2 client codes', () {
      expect(normalizePedidoClientCode(' 4300009324 '), '4300009324');
      expect(normalizePedidoClientCode('4300009324\u00a0'), '4300009324');
      expect(normalizePedidoClientCode(null), isEmpty);
      expect(normalizePedidoClientCode(''), isEmpty);
      expect(normalizePedidoClientCode('12345678901'), '1234567890');
    });

    test('builds the PMR cache key from normalized client and vendor codes',
        () {
      expect(
        promotionsCacheKey(' 4300009324 ', ' 35 '),
        'pedidos:promotions:4300009324:35',
      );
    });

    test('reuses only a non-empty promotion list', () {
      expect(shouldReusePromotionsCache(null), isFalse);
      expect(shouldReusePromotionsCache({'success': true}), isFalse);
      expect(
        shouldReusePromotionsCache({'success': true, 'promotions': []}),
        isFalse,
      );
      expect(
        shouldReusePromotionsCache({
          'success': true,
          'promotions': List<Map<String, Object>>.generate(
            27,
            (i) => {'code': 'P$i', 'promoType': 'GIFT'},
          ),
        }),
        isTrue,
      );
    });
  });
}
