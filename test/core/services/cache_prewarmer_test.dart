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
    test('jefe deferred targets warm hot ALL routes first', () {
      expect(
        CachePreWarmer.deferredJefeTargets(),
        equals(const [
          CachePrewarmTarget.objectivesEvolution,
          CachePrewarmTarget.objectivesByClient,
          CachePrewarmTarget.commissions,
          CachePrewarmTarget.vendedores,
          CachePrewarmTarget.pedidosCatalog,
        ]),
      );
    });
  });

  group('DashboardFirstPaintGate', () {
    tearDown(DashboardFirstPaintGate.reset);

    test('wait returns immediately when never opened', () async {
      final sw = Stopwatch()..start();
      await DashboardFirstPaintGate.wait();
      sw.stop();
      expect(sw.elapsedMilliseconds, lessThan(200));
    });

    test('markReady unblocks waiters', () async {
      DashboardFirstPaintGate.open();
      var released = false;
      final pending = DashboardFirstPaintGate.wait().then((_) {
        released = true;
      });
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(released, isFalse);
      DashboardFirstPaintGate.markReady();
      await pending;
      expect(released, isTrue);
    });
  });

  group('CachePreWarmer.runWithConcurrency', () {
    test('never exceeds two in-flight tasks', () async {
      var current = 0;
      final tasks = List<Future<void> Function()>.generate(6, (_) {
        return () async {
          current += 1;
          expect(current, lessThanOrEqualTo(2));
          await Future<void>.delayed(const Duration(milliseconds: 30));
          current -= 1;
        };
      });
      await CachePreWarmer.runWithConcurrency(tasks);
      expect(CachePreWarmer.debugMaxInFlight, 2);
    });
  });
}
