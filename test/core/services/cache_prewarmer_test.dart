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

    test('jefe in REPARTO prewarms week and pendientes', () {
      expect(
        CachePreWarmer.immediateTargets(
          isJefeVentas: true,
          isRepartidor: true,
        ),
        equals(const [
          CachePrewarmTarget.repartoPendientes,
          CachePrewarmTarget.repartoWeek,
        ]),
      );
    });

    test('JEFE REPARTO cache keys match first paint, not a sidecar prefix', () {
      const selector = '05,08,09';
      const today = '2026-09-17';
      expect(
        CachePreWarmer.fleetListCacheKey(
          userCode: '98',
          claimsVersion: 3,
          activeMode: 'repartidor',
        ),
        'auth:repartidores:98:claims3:REPARTIDOR',
      );
      expect(
        CachePreWarmer.pendientesFirstPaintCacheKey(
          repartidorId: selector,
          formattedDate: today,
        ),
        'entregas:pendientes:rutero-page-v2:$selector:$today::::default:::0:',
      );
      expect(
        CachePreWarmer.weekFirstPaintCacheKey(selector, today),
        'repartidor:rutero-week:$selector:$today',
      );
      expect(
        CachePreWarmer.pendientesFirstPaintPath(selector, today),
        '/entregas/pendientes/$selector?date=$today&limit=80&offset=0',
      );
      expect(
        CachePreWarmer.weekFirstPaintPath(selector, today),
        '/repartidor/rutero/week/$selector?date=$today',
      );
      expect(
        CachePreWarmer.pendientesFirstPaintCacheKey(
          repartidorId: selector,
          formattedDate: today,
        ),
        isNot(contains('prewarm')),
      );
    });

    test('fleet selector sorts like MainShell ALL and never emits ALL', () {
      expect(
        CachePreWarmer.fleetSelectorFrom([
          {'code': '09', 'name': 'Nueve'},
          {'code': 'ALL'},
          {'code': '05', 'name': 'Cinco'},
          {'code': '08', 'name': 'Ocho'},
        ]),
        '05,08,09',
      );
      expect(CachePreWarmer.fleetSelectorFrom(const <Object?>[]), isNull);
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
