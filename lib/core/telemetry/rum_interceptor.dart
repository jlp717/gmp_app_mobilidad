import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:gmp_app_mobilidad/core/api/api_client.dart';
import 'package:gmp_app_mobilidad/core/telemetry/rum_buffer.dart';

/// Dio interceptor that records t_req / t_resp / bytes / request id.
class RumInterceptor extends Interceptor {
  RumInterceptor();

  static const extraSkip = 'skipRum';
  static const _extraTReq = 'rum_t_req';

  static String netLabel(ConnectivityResult result) {
    return switch (result) {
      ConnectivityResult.wifi => 'wifi',
      ConnectivityResult.mobile => 'mobile',
      ConnectivityResult.ethernet => 'wifi',
      ConnectivityResult.vpn => 'mobile',
      ConnectivityResult.none => 'none',
      _ => 'none',
    };
  }

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (options.extra[extraSkip] == true || !RumBuffer.enabled) {
      handler.next(options);
      return;
    }
    options.extra[_extraTReq] = DateTime.now().millisecondsSinceEpoch;
    options.headers['X-GMP-Net'] = netLabel(ApiClient.lastConnectivity);
    handler.next(options);
  }

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    _record(response.requestOptions, response.statusCode, response.data, response);
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    _record(
      err.requestOptions,
      err.response?.statusCode,
      err.response?.data,
      err.response,
    );
    handler.next(err);
  }

  void _record(
    RequestOptions options,
    int? status,
    Object? data,
    Response<dynamic>? response,
  ) {
    if (options.extra[extraSkip] == true || !RumBuffer.enabled) return;
    final tReq = options.extra[_extraTReq];
    if (tReq is! int) return;
    final tResp = DateTime.now().millisecondsSinceEpoch;
    RumBuffer.enqueue({
      'screen': RumBuffer.lastScreen,
      'endpoint': options.uri.path,
      'method': options.method,
      'status': status,
      't_req': tReq,
      't_resp': tResp,
      't_parsed': tResp,
      'bytes': _byteLength(data),
      'net': options.headers['X-GMP-Net'],
      'rid': response?.headers.value('x-request-id'),
    });
  }

  int? _byteLength(Object? data) {
    if (data is List<int>) return data.length;
    if (data is String) return data.length;
    return null;
  }
}
