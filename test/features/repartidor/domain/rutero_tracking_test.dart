import 'package:flutter_test/flutter_test.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_tracking.dart';

void main() {
  group('distanceKmBetween', () {
    test('returns zero for the same coordinates', () {
      expect(distanceKmBetween(40.4168, -3.7038, 40.4168, -3.7038), 0);
    });

    test('calculates a useful straight-line distance', () {
      final distance = distanceKmBetween(40.4168, -3.7038, 40.45, -3.7);
      expect(distance, greaterThan(3));
      expect(distance, lessThan(5));
    });
  });

  test('tracking stop validates usable coordinates', () {
    const withGps = RuteroTrackingStop(
      id: 'A',
      name: 'Cliente A',
      latitude: 40,
      longitude: -3,
    );
    const withoutGps = RuteroTrackingStop(id: 'B', name: 'Cliente B');
    expect(withGps.hasCoordinates, isTrue);
    expect(withoutGps.hasCoordinates, isFalse);
  });

  test('state copyWith can clear nullable route values', () {
    final state = RuteroTrackingState(
      status: RuteroTrackingStatus.active,
      sessionId: 'session-1',
      nextStop: const RuteroTrackingStop(id: 'A', name: 'A'),
      distanceToNextStopKm: 1.2,
      error: 'old',
    );
    final cleared = state.copyWith(
      status: RuteroTrackingStatus.idle,
      clearSessionId: true,
      clearNextStop: true,
      clearDistanceToNextStop: true,
      clearError: true,
    );
    expect(cleared.status, RuteroTrackingStatus.idle);
    expect(cleared.sessionId, isNull);
    expect(cleared.nextStop, isNull);
    expect(cleared.distanceToNextStopKm, isNull);
    expect(cleared.error, isNull);
  });
}
