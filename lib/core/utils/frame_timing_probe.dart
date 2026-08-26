import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

/// Frame timing probe: acumula FrameTiming en ventanas de 5s e imprime
/// percentiles p50/p90/p95/p99 de build/raster/total mas frames dropped
/// (aproximado: buildMs + rasterMs > 16.67ms).
///
/// Cero coste en release: start() es no-op si ni kProfileMode ni kDebugMode.
// ponytail: print por debugPrint en ventana fija de 5s, sin export ni agregacion. upgrade: enviar a endpoint de metricas si hace falta telemetria productiva.
abstract final class FrameTimingProbe {
  /// Solo para tests: fuerza el estado que en runtime viene de
  /// kProfileMode || kDebugMode. Null = comportamiento normal.
  @visibleForTesting
  static bool? enabledOverride;

  static bool get _isEnabled => enabledOverride ?? (kProfileMode || kDebugMode);

  static bool _active = false;
  static final List<FrameTiming> _samples = <FrameTiming>[];
  static Timer? _flushTimer;

  /// Activa el probe. En release no hace nada.
  static void start() {
    if (!_isEnabled) return;
    if (_active) return;
    _active = true;
    SchedulerBinding.instance.addTimingsCallback(_onTimings);
    _flushTimer = Timer.periodic(const Duration(seconds: 5), (_) => _flush());
  }

  /// Desactiva el probe y limpia estado.
  static void stop() {
    if (!_active) return;
    _active = false;
    SchedulerBinding.instance.removeTimingsCallback(_onTimings);
    _flushTimer?.cancel();
    _flushTimer = null;
    _samples.clear();
  }

  static bool get isActive => _active;

  static void _onTimings(List<FrameTiming> timings) {
    _samples.addAll(timings);
  }

  static void _flush() {
    if (_samples.isEmpty) return;
    final samples = List<FrameTiming>.of(_samples);
    _samples.clear();

    final builds = samples.map((t) => t.buildDuration.inMicroseconds / 1000);
    final rasters = samples.map((t) => t.rasterDuration.inMicroseconds / 1000);
    final totals = samples.map((t) => t.totalSpan.inMicroseconds / 1000);

    final dropped = samples
        .where(
          (t) =>
              t.buildDuration.inMicroseconds / 1000 +
                  t.rasterDuration.inMicroseconds / 1000 >
              16.67,
        )
        .length;

    debugPrint(
      '[FrameTimingProbe] ${samples.length} frames | '
      'dropped≈$dropped | '
      'build p50=${_pct(builds, 50)} p90=${_pct(builds, 90)} '
      'p95=${_pct(builds, 95)} p99=${_pct(builds, 99)} ms | '
      'raster p50=${_pct(rasters, 50)} p90=${_pct(rasters, 90)} '
      'p95=${_pct(rasters, 95)} p99=${_pct(rasters, 99)} ms | '
      'total p50=${_pct(totals, 50)} p90=${_pct(totals, 90)} '
      'p95=${_pct(totals, 95)} p99=${_pct(totals, 99)} ms',
    );
  }

  static String _pct(Iterable<double> values, int percentile) {
    if (values.isEmpty) return '0.00';
    final sorted = values.toList()..sort();
    final index = ((percentile / 100) * (sorted.length - 1)).round();
    return sorted[index].toStringAsFixed(2);
  }
}
