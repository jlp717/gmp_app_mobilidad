import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/repartidor/data/rutero_tracking_api.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_tracking.dart';

final ruteroTrackingProvider =
    AutoDisposeNotifierProvider<RuteroTrackingNotifier, RuteroTrackingState>(
        RuteroTrackingNotifier.new);

class RuteroTrackingNotifier extends AutoDisposeNotifier<RuteroTrackingState> {
  final FlutterTts _tts = FlutterTts();
  final List<Map<String, dynamic>> _pending = <Map<String, dynamic>>[];
  final List<RuteroTrackingStop> _stops = <RuteroTrackingStop>[];
  StreamSubscription<Position>? _positionSubscription;
  Timer? _flushTimer;
  bool _disposed = false;
  bool _flushing = false;
  bool _ttsReady = false;
  bool _speaking = false;
  String? _lastAnnouncedStopId;
  String? _lastAnnouncedArrivalId;

  @override
  RuteroTrackingState build() {
    ref.onDispose(_dispose);
    return const RuteroTrackingState();
  }

  Future<void> start({
    required String repartidorId,
    required String routeDate,
    required List<RuteroTrackingStop> stops,
  }) async {
    final owner = repartidorId.trim();
    final date = routeDate.trim();
    if (owner.isEmpty || date.isEmpty) {
      state = state.copyWith(
        status: RuteroTrackingStatus.error,
        error: 'No se ha podido identificar la ruta del repartidor.',
      );
      return;
    }
    if (state.isActive &&
        state.repartidorId == owner &&
        state.routeDate == date) {
      updateStops(stops);
      return;
    }
    if (state.sessionId != null) await stop();

    state = state.copyWith(
      status: RuteroTrackingStatus.starting,
      repartidorId: owner,
      routeDate: date,
      clearPosition: true,
      clearNextStop: true,
      clearDistanceToNextStop: true,
      pendingSamples: 0,
      clearError: true,
    );
    _pending.clear();
    _stops
      ..clear()
      ..addAll(stops);
    _lastAnnouncedStopId = null;
    _lastAnnouncedArrivalId = null;

    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw const _TrackingUserException(
          RuteroTrackingStatus.unavailable,
          'Activa la ubicación del dispositivo para iniciar el seguimiento.',
        );
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw const _TrackingUserException(
          RuteroTrackingStatus.permissionDenied,
          'Permite la ubicación para que GMP pueda registrar tu avance.',
        );
      }

      final sessionId =
          'session-\${DateTime.now().toUtc().microsecondsSinceEpoch}';
      final ack = await RuteroTrackingApi.start(
        repartidorId: owner,
        routeDate: date,
        sessionId: sessionId,
      );
      if (_disposed) return;

      _positionSubscription = Geolocator.getPositionStream(
        locationSettings: _locationSettings(),
      ).listen(
        _onPosition,
        onError: _onLocationError,
        cancelOnError: false,
      );
      _flushTimer = Timer.periodic(
        const Duration(seconds: 20),
        (_) => unawaited(_flushSamples()),
      );
      state = state.copyWith(
        status: RuteroTrackingStatus.active,
        sessionId: ack.sessionId,
        routeDate: ack.routeDate,
        updatedAt: DateTime.now(),
        clearError: true,
      );
      _recalculateNextStop();
      await _configureTts();
      unawaited(_announce('Seguimiento iniciado. Mantén la ubicación activa.'));
    } catch (error) {
      await _cancelLocationStream();
      if (_disposed) return;
      final trackingError = error is _TrackingUserException
          ? error
          : _TrackingUserException(
              error is ApiException && error.statusCode == 503
                  ? RuteroTrackingStatus.unavailable
                  : RuteroTrackingStatus.error,
              _trackingErrorMessage(error),
            );
      state = state.copyWith(
        status: trackingError.status,
        clearSessionId: true,
        error: trackingError.message,
        pendingSamples: 0,
      );
      _pending.clear();
    }
  }

  void updateStops(List<RuteroTrackingStop> stops) {
    final sameStops = _stops.length == stops.length &&
        List.generate(
          _stops.length,
          (index) =>
              _stops[index].id == stops[index].id &&
              _stops[index].name == stops[index].name &&
              _stops[index].latitude == stops[index].latitude &&
              _stops[index].longitude == stops[index].longitude,
        ).every((same) => same);
    if (sameStops) return;
    _stops
      ..clear()
      ..addAll(stops);
    if (state.position != null) _recalculateNextStop();
  }

  Future<void> setVoiceEnabled(bool enabled) async {
    state = state.copyWith(voiceEnabled: enabled);
    if (enabled) {
      await _configureTts();
      if (state.isActive) {
        unawaited(_announce('Avisos de voz activados.'));
      }
    } else {
      try {
        await _tts.stop();
      } catch (_) {}
    }
  }

  Future<void> stop() async {
    final sessionId = state.sessionId;
    final owner = state.repartidorId;
    final date = state.routeDate;
    if (sessionId == null || owner == null || date == null) {
      await _cancelLocationStream();
      _pending.clear();
      state = state.copyWith(
        status: RuteroTrackingStatus.idle,
        clearPosition: true,
        clearNextStop: true,
        clearDistanceToNextStop: true,
        pendingSamples: 0,
        clearSessionId: true,
      );
      return;
    }

    state = state.copyWith(
      status: RuteroTrackingStatus.stopping,
      clearError: true,
    );
    _flushTimer?.cancel();
    _flushTimer = null;
    await _cancelLocationStream();

    final flushed = await _flushSamples();
    if (!flushed) {
      if (!_disposed) {
        state = state.copyWith(
          status: RuteroTrackingStatus.error,
          error: 'No se han podido sincronizar todos los puntos. '
              'Pulsa «Reintentar cierre».',
        );
      }
      return;
    }

    try {
      await RuteroTrackingApi.stop(
        repartidorId: owner,
        routeDate: date,
        sessionId: sessionId,
        eventId: 'stop-\${DateTime.now().toUtc().microsecondsSinceEpoch}',
      );
      if (_disposed) return;
      _pending.clear();
      state = state.copyWith(
        status: RuteroTrackingStatus.idle,
        clearSessionId: true,
        clearPosition: true,
        clearNextStop: true,
        clearDistanceToNextStop: true,
        pendingSamples: 0,
        updatedAt: DateTime.now(),
        clearError: true,
      );
      try {
        await _tts.stop();
      } catch (_) {}
    } catch (error) {
      if (!_disposed) {
        state = state.copyWith(
          status: RuteroTrackingStatus.error,
          error: 'El seguimiento local ha terminado, pero no se pudo cerrar '
              'la sesión en el servidor. Pulsa «Reintentar cierre».',
        );
      }
    }
  }

  LocationSettings _locationSettings() {
    if (defaultTargetPlatform == TargetPlatform.android) {
      return AndroidSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        distanceFilter: 50,
        intervalDuration: const Duration(seconds: 20),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Seguimiento de ruta activo',
          notificationText: 'GMP está registrando tu avance',
          notificationChannelName: 'Seguimiento de ruta',
          setOngoing: true,
          enableWakeLock: true,
        ),
      );
    }
    return const LocationSettings(
      accuracy: LocationAccuracy.bestForNavigation,
      distanceFilter: 50,
    );
  }

  void _onPosition(Position position) {
    if (_disposed || !state.isActive) return;
    final latitude = position.latitude;
    final longitude = position.longitude;
    final accuracy = position.accuracy;
    if (!latitude.isFinite ||
        !longitude.isFinite ||
        !accuracy.isFinite ||
        accuracy < 0 ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180 ||
        accuracy > 5000) {
      return;
    }
    final recordedAt = position.timestamp.toUtc();
    final speed = _boundedSpeed(position.speed);
    final heading = _boundedHeading(position.heading);
    final sample = <String, dynamic>{
      'eventId': 'position-\${recordedAt.microsecondsSinceEpoch}',
      'latitude': latitude,
      'longitude': longitude,
      'accuracy': accuracy,
      'speed': speed,
      'heading': heading,
      'recordedAt': recordedAt.toIso8601String(),
    };
    final mapped = RuteroTrackingPosition(
      latitude: latitude,
      longitude: longitude,
      accuracy: accuracy,
      speedKmh: speed,
      heading: heading,
      recordedAt: recordedAt,
    );
    _pending.add(sample);
    if (_pending.length > 100) {
      _pending.removeRange(0, _pending.length - 100);
    }
    state = state.copyWith(
      position: mapped,
      pendingSamples: _pending.length,
      updatedAt: DateTime.now(),
      clearError: true,
    );
    _recalculateNextStop();
    if (_pending.length >= 5) unawaited(_flushSamples());
  }

  void _onLocationError(Object error) {
    if (_disposed || !state.isActive) return;
    state = state.copyWith(
      error: 'La señal GPS se ha interrumpido. Se reintentará automáticamente.',
    );
  }

  Future<bool> _flushSamples() async {
    if (_disposed || _flushing || _pending.isEmpty) return _pending.isEmpty;
    final owner = state.repartidorId;
    final date = state.routeDate;
    final sessionId = state.sessionId;
    if (owner == null || date == null || sessionId == null) return false;
    _flushing = true;
    final batch = List<Map<String, dynamic>>.from(_pending);
    try {
      await RuteroTrackingApi.sendSamples(
        repartidorId: owner,
        routeDate: date,
        sessionId: sessionId,
        samples: batch,
      );
      final sentIds = batch.map((sample) => sample['eventId']).toSet();
      _pending.removeWhere((sample) => sentIds.contains(sample['eventId']));
      state = state.copyWith(
        pendingSamples: _pending.length,
        lastSentAt: DateTime.now(),
        clearError: true,
      );
      return true;
    } catch (_) {
      if (!_disposed) {
        state = state.copyWith(
          pendingSamples: _pending.length,
          error: 'Sin conexión: los puntos quedan guardados y se '
              'reintentará la sincronización.',
        );
      }
      return false;
    } finally {
      _flushing = false;
    }
  }

  void _recalculateNextStop() {
    final position = state.position;
    RuteroTrackingStop? next;
    for (final stop in _stops) {
      if (stop.id.trim().isNotEmpty) {
        next = stop;
        break;
      }
    }
    double? distance;
    if (position != null && next?.hasCoordinates == true) {
      distance = distanceKmBetween(
        position.latitude,
        position.longitude,
        next!.latitude!,
        next.longitude!,
      );
    }
    final previousId = state.nextStop?.id;
    state = state.copyWith(
      nextStop: next,
      clearNextStop: next == null,
      distanceToNextStopKm: distance,
      clearDistanceToNextStop: distance == null,
    );
    if (state.isActive && next != null && next.id != previousId) {
      _lastAnnouncedArrivalId = null;
      if (_lastAnnouncedStopId != next.id) {
        _lastAnnouncedStopId = next.id;
        unawaited(_announce('Siguiente parada: \${next.name}.'));
      }
    }
    if (state.isActive &&
        next != null &&
        distance != null &&
        distance <= 0.15 &&
        _lastAnnouncedArrivalId != next.id) {
      _lastAnnouncedArrivalId = next.id;
      unawaited(_announce('Has llegado aproximadamente a \${next.name}.'));
    }
  }

  Future<void> _configureTts() async {
    if (_ttsReady || !_voiceEnabled) return;
    try {
      await _tts.setLanguage('es-ES');
      await _tts.setSpeechRate(0.48);
      await _tts.setVolume(0.9);
      await _tts.awaitSpeakCompletion(false);
      _ttsReady = true;
    } catch (_) {
      _ttsReady = false;
    }
  }

  bool get _voiceEnabled => state.voiceEnabled;

  Future<void> _announce(String message) async {
    if (_disposed || !_voiceEnabled || _speaking) return;
    _speaking = true;
    try {
      await _configureTts();
      if (!_ttsReady) return;
      await _tts.stop();
      await _tts.speak(message);
    } catch (_) {
      // Voice is an enhancement; GPS tracking must continue if TTS is absent.
    } finally {
      _speaking = false;
    }
  }

  double? _boundedSpeed(double value) {
    final kmh = value * 3.6;
    return kmh.isFinite && kmh >= 0 && kmh <= 150 ? kmh : null;
  }

  double? _boundedHeading(double value) =>
      value.isFinite && value >= 0 && value <= 360 ? value : null;

  String _trackingErrorMessage(Object error) {
    if (error is ApiException && error.statusCode == 401) {
      return 'Tu sesión ha caducado. Inicia sesión de nuevo para seguir.';
    }
    if (error is ApiException && error.statusCode == 503) {
      return 'El seguimiento no está habilitado en el servidor.';
    }
    return 'No se pudo iniciar el seguimiento. Comprueba la conexión e inténtalo de nuevo.';
  }

  Future<void> _cancelLocationStream() async {
    _flushTimer?.cancel();
    _flushTimer = null;
    final subscription = _positionSubscription;
    _positionSubscription = null;
    await subscription?.cancel();
  }

  void _dispose() {
    _disposed = true;
    _flushTimer?.cancel();
    _flushTimer = null;
    unawaited(_positionSubscription?.cancel());
    _positionSubscription = null;
    unawaited(_tts.stop());
  }
}

class _TrackingUserException implements Exception {
  const _TrackingUserException(this.status, this.message);

  final RuteroTrackingStatus status;
  final String message;
}
