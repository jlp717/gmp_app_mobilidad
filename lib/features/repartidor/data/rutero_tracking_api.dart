import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/features/repartidor/domain/rutero_tracking.dart';

class RuteroTrackingStartAck {
  const RuteroTrackingStartAck({
    required this.sessionId,
    required this.routeDate,
    required this.replayed,
  });

  final String sessionId;
  final String routeDate;
  final bool replayed;
}

class RuteroTrackingApi {
  const RuteroTrackingApi._();

  static Future<RuteroTrackingStartAck> start({
    required String repartidorId,
    required String routeDate,
    required String sessionId,
  }) async {
    final response = await ApiClient.post(
      '/repartidor/rutero/tracking/$repartidorId/start',
      <String, dynamic>{
        'date': routeDate,
        'sessionId': sessionId,
      },
      receiveTimeout: const Duration(seconds: 15),
      idempotent: true,
      maxRetries: 2,
    );
    final serverSessionId = response['sessionId']?.toString().trim();
    if (response['success'] != true ||
        serverSessionId == null ||
        serverSessionId.isEmpty) {
      throw ApiException(
        'Tracking start acknowledgement invalid',
        statusCode: 503,
        code: 'RUTERO_TRACKING_START_ACK_INVALID',
      );
    }
    return RuteroTrackingStartAck(
      sessionId: serverSessionId,
      routeDate: response['routeDate']?.toString() ?? routeDate,
      replayed: response['replayed'] == true,
    );
  }

  static Future<int> sendSamples({
    required String repartidorId,
    required String routeDate,
    required String sessionId,
    required List<Map<String, dynamic>> samples,
  }) async {
    if (samples.isEmpty) return 0;
    final response = await ApiClient.post(
      '/repartidor/rutero/tracking/$repartidorId/samples',
      <String, dynamic>{
        'date': routeDate,
        'sessionId': sessionId,
        'samples': samples,
      },
      receiveTimeout: const Duration(seconds: 15),
      idempotent: true,
      maxRetries: 2,
    );
    if (response['success'] != true) {
      throw ApiException(
        'Tracking samples acknowledgement invalid',
        statusCode: 503,
        code: 'RUTERO_TRACKING_SAMPLES_ACK_INVALID',
      );
    }
    final accepted = response['inserted'] ?? response['accepted'] ?? 0;
    return accepted is num ? accepted.toInt() : 0;
  }

  static Future<bool> stop({
    required String repartidorId,
    required String routeDate,
    required String sessionId,
    required String eventId,
  }) async {
    final response = await ApiClient.post(
      '/repartidor/rutero/tracking/$repartidorId/stop',
      <String, dynamic>{
        'date': routeDate,
        'sessionId': sessionId,
        'eventId': eventId,
      },
      receiveTimeout: const Duration(seconds: 15),
      idempotent: true,
      maxRetries: 2,
    );
    if (response['success'] != true) {
      throw ApiException(
        'Tracking stop acknowledgement invalid',
        statusCode: 503,
        code: 'RUTERO_TRACKING_STOP_ACK_INVALID',
      );
    }
    return response['replayed'] != true;
  }

  static Future<RuteroTrackingPosition?> latest({
    required String repartidorId,
    required String routeDate,
  }) async {
    final response = await ApiClient.get(
      '/repartidor/rutero/tracking/$repartidorId/latest',
      queryParameters: <String, dynamic>{'date': routeDate},
      forceRefresh: true,
      allowStale: false,
      receiveTimeout: const Duration(seconds: 10),
    );
    final raw = response['position'];
    if (response['success'] != true || raw is! Map) return null;
    final latitude = _asDouble(raw['latitude']);
    final longitude = _asDouble(raw['longitude']);
    final accuracy = _asDouble(raw['accuracy']);
    final recordedAt = DateTime.tryParse(raw['recordedAt']?.toString() ?? '');
    if (latitude == null ||
        longitude == null ||
        accuracy == null ||
        recordedAt == null) {
      return null;
    }
    return RuteroTrackingPosition(
      latitude: latitude,
      longitude: longitude,
      accuracy: accuracy,
      speedKmh: _asDouble(raw['speedKmh']),
      heading: _asDouble(raw['heading']),
      recordedAt: recordedAt.toLocal(),
    );
  }

  static double? _asDouble(Object? value) {
    if (value is num && value.isFinite) return value.toDouble();
    return double.tryParse(value?.toString() ?? '');
  }
}
