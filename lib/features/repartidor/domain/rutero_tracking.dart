import 'dart:math' as math;

enum RuteroTrackingStatus {
  idle,
  starting,
  active,
  stopping,
  permissionDenied,
  unavailable,
  error,
}

class RuteroTrackingStop {
  const RuteroTrackingStop({
    required this.id,
    required this.name,
    this.latitude,
    this.longitude,
  });

  final String id;
  final String name;
  final double? latitude;
  final double? longitude;

  bool get hasCoordinates =>
      latitude != null &&
      longitude != null &&
      latitude!.isFinite &&
      longitude!.isFinite &&
      latitude! >= -90 &&
      latitude! <= 90 &&
      longitude! >= -180 &&
      longitude! <= 180;
}

class RuteroTrackingPosition {
  const RuteroTrackingPosition({
    required this.latitude,
    required this.longitude,
    required this.accuracy,
    required this.recordedAt,
    this.speedKmh,
    this.heading,
  });

  final double latitude;
  final double longitude;
  final double accuracy;
  final double? speedKmh;
  final double? heading;
  final DateTime recordedAt;
}

class RuteroTrackingState {
  const RuteroTrackingState({
    this.status = RuteroTrackingStatus.idle,
    this.repartidorId,
    this.routeDate,
    this.sessionId,
    this.position,
    this.nextStop,
    this.distanceToNextStopKm,
    this.pendingSamples = 0,
    this.lastSentAt,
    this.updatedAt,
    this.voiceEnabled = true,
    this.error,
  });

  final RuteroTrackingStatus status;
  final String? repartidorId;
  final String? routeDate;
  final String? sessionId;
  final RuteroTrackingPosition? position;
  final RuteroTrackingStop? nextStop;
  final double? distanceToNextStopKm;
  final int pendingSamples;
  final DateTime? lastSentAt;
  final DateTime? updatedAt;
  final bool voiceEnabled;
  final String? error;

  bool get isActive => status == RuteroTrackingStatus.active;

  RuteroTrackingState copyWith({
    RuteroTrackingStatus? status,
    String? repartidorId,
    String? routeDate,
    String? sessionId,
    bool clearSessionId = false,
    RuteroTrackingPosition? position,
    bool clearPosition = false,
    RuteroTrackingStop? nextStop,
    bool clearNextStop = false,
    double? distanceToNextStopKm,
    bool clearDistanceToNextStop = false,
    int? pendingSamples,
    DateTime? lastSentAt,
    DateTime? updatedAt,
    bool? voiceEnabled,
    String? error,
    bool clearError = false,
  }) {
    return RuteroTrackingState(
      status: status ?? this.status,
      repartidorId: repartidorId ?? this.repartidorId,
      routeDate: routeDate ?? this.routeDate,
      sessionId: clearSessionId ? null : sessionId ?? this.sessionId,
      position: clearPosition ? null : position ?? this.position,
      nextStop: clearNextStop ? null : nextStop ?? this.nextStop,
      distanceToNextStopKm: clearDistanceToNextStop
          ? null
          : distanceToNextStopKm ?? this.distanceToNextStopKm,
      pendingSamples: pendingSamples ?? this.pendingSamples,
      lastSentAt: lastSentAt ?? this.lastSentAt,
      updatedAt: updatedAt ?? this.updatedAt,
      voiceEnabled: voiceEnabled ?? this.voiceEnabled,
      error: clearError ? null : error ?? this.error,
    );
  }
}

double distanceKmBetween(
  double latitude1,
  double longitude1,
  double latitude2,
  double longitude2,
) {
  const earthRadiusKm = 6371.0088;
  final lat1 = latitude1 * math.pi / 180;
  final lat2 = latitude2 * math.pi / 180;
  final deltaLat = (latitude2 - latitude1) * math.pi / 180;
  final deltaLon = (longitude2 - longitude1) * math.pi / 180;
  final haversine = math.sin(deltaLat / 2) * math.sin(deltaLat / 2) +
      math.cos(lat1) *
          math.cos(lat2) *
          math.sin(deltaLon / 2) *
          math.sin(deltaLon / 2);
  final centralAngle =
      2 * math.atan2(math.sqrt(haversine), math.sqrt(1 - haversine));
  return earthRadiusKm * centralAngle;
}
