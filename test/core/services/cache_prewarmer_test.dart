import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/services/cache_prewarmer.dart';

void main() {
  group('CachePreWarmer.immediateTargets', () {
    test('jefe skips all immediate prewarm', () {
      expect(
        CachePreWarmer.immediateTargets(isJefeVentas: true),
        isEmpty,
      );
    });

    test('repartidor skips all commercial prewarm', () {
      expect(
        CachePreWarmer.immediateTargets(
          isJefeVentas: false,
          isRepartidor: true,
        ),
        isEmpty,
      );
    });

    test('comercial prewarms core tabs', () {
      expect(
        CachePreWarmer.immediateTargets(isJefeVentas: false),
        containsAll(const [
          CachePrewarmTarget.facturas,
          CachePrewarmTarget.clients,
          CachePrewarmTarget.pedidosHeavy,
          CachePrewarmTarget.pedidosCatalog,
          CachePrewarmTarget.ruteroWeek,
        ]),
      );
    });
  });

  group('CachePreWarmer.deferredJefeTargets', () {
    test('jefe deferred catalog is lightweight', () {
      expect(
        CachePreWarmer.deferredJefeTargets(),
        equals(const [
          CachePrewarmTarget.vendedores,
          CachePrewarmTarget.pedidosCatalog,
        ]),
      );
    });
  });
}
