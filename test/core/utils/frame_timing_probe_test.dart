import 'package:fake_async/fake_async.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/core/utils/frame_timing_probe.dart';

FrameTiming _timing(int buildMs, int rasterMs) {
  final buildFinish = buildMs * 1000;
  final total = (buildMs + rasterMs) * 1000;
  return FrameTiming(
    vsyncStart: 0,
    buildStart: 0,
    buildFinish: buildFinish,
    rasterStart: buildFinish,
    rasterFinish: total,
    rasterFinishWallTime: total,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  void report(List<FrameTiming> timings) {
    final dispatcher = SchedulerBinding.instance.platformDispatcher;
    final cb = dispatcher.onReportTimings;
    expect(cb, isNotNull, reason: 'binding debe registrar onReportTimings');
    cb!(List<FrameTiming>.of(timings));
  }

  tearDown(() {
    FrameTimingProbe.stop();
    FrameTimingProbe.enabledOverride = null;
  });

  group('FrameTimingProbe', () {
    test('ciclo start/stop deja sin callback activo', () {
      fakeAsync((async) {
        var prints = 0;
        final prev = debugPrint;
        debugPrint = (String? m, {int? wrapWidth}) => prints++;
        FrameTimingProbe.start();
        expect(FrameTimingProbe.isActive, isTrue);

        report([_timing(10, 1)]);

        FrameTimingProbe.stop();
        expect(FrameTimingProbe.isActive, isFalse);

        async.elapse(const Duration(seconds: 6));
        expect(
          prints,
          0,
          reason: 'tras stop no debe haber flush ni muestra acumulada',
        );
        debugPrint = prev;
      });
    });

    test('agregacion: percentiles y dropped dentro de la ventana', () {
      fakeAsync((async) {
        final buffer = StringBuffer();
        final prev = debugPrint;
        debugPrint = (String? m, {int? wrapWidth}) => buffer.write(m);

        FrameTimingProbe.start();
        report([
          _timing(10, 1), // total 11ms, no dropped
          _timing(20, 2), // total 22ms, dropped
          _timing(30, 3), // total 33ms, dropped
          _timing(40, 4), // total 44ms, dropped
        ]);

        async.elapse(const Duration(seconds: 5));

        final out = buffer.toString();
        expect(out, contains('[FrameTimingProbe] 4 frames'));
        expect(out, contains('dropped≈3'));
        // builds [10,20,30,40]: n=4 -> p50 idx2=30, p90/p95/p99 idx3=40
        expect(out, contains('build p50=30.00 p90=40.00 p95=40.00 p99=40.00'));
        // rasters [1,2,3,4]
        expect(out, contains('raster p50=3.00 p90=4.00 p95=4.00 p99=4.00'));
        // totals [11,22,33,44]
        expect(out, contains('total p50=33.00 p90=44.00 p95=44.00 p99=44.00'));

        FrameTimingProbe.stop();
        debugPrint = prev;
      });
    });

    test('release (enabledOverride=false): start es no-op', () {
      FrameTimingProbe.enabledOverride = false;
      FrameTimingProbe.start();
      expect(FrameTimingProbe.isActive, isFalse);
    });

    test('enabledOverride=null en debug: start activa', () {
      FrameTimingProbe.enabledOverride = null;
      FrameTimingProbe.start();
      expect(FrameTimingProbe.isActive, isTrue);
    });

    test('start doble no duplica registro', () {
      fakeAsync((async) {
        var prints = 0;
        final prev = debugPrint;
        debugPrint = (String? m, {int? wrapWidth}) => prints++;
        FrameTimingProbe.start();
        FrameTimingProbe.start();
        report([_timing(10, 1)]);
        async.elapse(const Duration(seconds: 5));
        expect(prints, 1, reason: 'un solo flush por ventana');
        debugPrint = prev;
      });
    });
  });
}
