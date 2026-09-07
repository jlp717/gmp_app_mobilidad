import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/offline/offline_aware_api.dart';

/// Registers a cobro from the rutero COBRO tab via the existing finance route.
/// Endpoint: POST /repartidor-finanzas/cobros (pantallaOrigen=RUTERO).
class RuteroCobroApi {
  RuteroCobroApi({
    Future<Map<String, dynamic>> Function(
      String endpoint,
      Map<String, dynamic> data, {
      String? syncType,
      bool idempotent,
    })? post,
  }) : _post = post ?? _defaultPost;

  static const endpoint = '/repartidor-finanzas/cobros';

  final Future<Map<String, dynamic>> Function(
    String endpoint,
    Map<String, dynamic> data, {
    String? syncType,
    bool idempotent,
  }) _post;

  static Future<Map<String, dynamic>> _defaultPost(
    String endpoint,
    Map<String, dynamic> data, {
    String? syncType,
    bool idempotent = false,
  }) {
    return OfflineAwareApi.post(
      endpoint,
      data,
      syncType: syncType,
      idempotent: idempotent,
    );
  }

  Future<RuteroCobroSubmitResult> register(Map<String, dynamic> payload) async {
    final response = await _post(
      endpoint,
      payload,
      syncType: 'register_cobro',
      idempotent: true,
    );
    if (response['queued'] == true) {
      return RuteroCobroSubmitResult.queued(
        cobroId: response['id']?.toString() ?? response['syncId']?.toString(),
      );
    }
    final replayed = response['idempotent'] == true;
    if (response['success'] != true && !replayed) {
      throw ApiException(
        response['error']?.toString() ?? 'No se pudo registrar el cobro',
        statusCode: 200,
        code: response['code']?.toString(),
      );
    }
    return RuteroCobroSubmitResult.confirmed(
      cobroId: response['id']?.toString(),
      created: response['created'] == true && !replayed,
    );
  }
}

class RuteroCobroSubmitResult {
  const RuteroCobroSubmitResult._({
    required this.queued,
    required this.created,
    this.cobroId,
  });

  factory RuteroCobroSubmitResult.confirmed({
    String? cobroId,
    bool created = true,
  }) =>
      RuteroCobroSubmitResult._(
        queued: false,
        created: created,
        cobroId: cobroId,
      );

  factory RuteroCobroSubmitResult.queued({String? cobroId}) =>
      RuteroCobroSubmitResult._(
        queued: true,
        created: false,
        cobroId: cobroId,
      );

  final bool queued;
  final bool created;
  final String? cobroId;
}
