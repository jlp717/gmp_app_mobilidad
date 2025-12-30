import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'api_config.dart';

/// API Client for all backend communications
class ApiClient {
  static final Dio _dio = Dio(BaseOptions(
    baseUrl: ApiConfig.baseUrl,
    connectTimeout: ApiConfig.connectTimeout,
    receiveTimeout: ApiConfig.receiveTimeout,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  ));

  /// Set authentication token
  static void setAuthToken(String token) {
    _dio.options.headers['Authorization'] = 'Bearer $token';
  }

  /// Clear authentication token
  static void clearAuthToken() {
    _dio.options.headers.remove('Authorization');
  }

  /// GET request with query parameters
  static Future<Map<String, dynamic>> get(
    String endpoint, {
    Map<String, dynamic>? queryParameters,
  }) async {
    try {
      final response = await _dio.get(
        endpoint,
        queryParameters: queryParameters,
      );
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _handleError(e);
    }
  }

  /// POST request
  static Future<Map<String, dynamic>> post(
    String endpoint,
    Map<String, dynamic> data,
  ) async {
    try {
      final fullUrl = '${_dio.options.baseUrl}$endpoint';
      debugPrint('[ApiClient] POST $fullUrl');
      debugPrint('[ApiClient] Data: $data');
      
      final response = await _dio.post(endpoint, data: data);
      
      debugPrint('[ApiClient] Response status: ${response.statusCode}');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      debugPrint('[ApiClient] DioException: ${e.type} - ${e.message}');
      throw _handleError(e);
    } catch (e) {
      debugPrint('[ApiClient] Unexpected error: $e');
      rethrow;
    }
  }

  static String _handleError(DioException e) {
    if (e.type == DioExceptionType.connectionTimeout) {
      return 'Timeout de conexión - Verifica tu red';
    } else if (e.type == DioExceptionType.connectionError) {
      return 'Error de conexión - Verifica tu red WiFi';
    } else if (e.type == DioExceptionType.receiveTimeout) {
      return 'El servidor está tardando demasiado';
    } else if (e.response != null) {
      final statusCode = e.response?.statusCode;
      final data = e.response?.data;
      
      // Extract server error message
      String? serverMessage;
      if (data is Map<String, dynamic>) {
        serverMessage = data['error'] as String? ?? data['message'] as String?;
      }
      
      if (statusCode == 400) {
        return serverMessage ?? 'Solicitud incorrecta';
      } else if (statusCode == 401) {
        return serverMessage ?? 'Credenciales inválidas';
      } else if (statusCode == 403) {
        return serverMessage ?? 'Acceso denegado';
      } else if (statusCode == 404) {
        return serverMessage ?? 'Recurso no encontrado';
      } else if (statusCode == 429) {
        return serverMessage ?? 'Demasiados intentos - Espera un momento';
      } else if (statusCode == 500) {
        return serverMessage ?? 'Error del servidor';
      }
      return serverMessage ?? 'Error: $statusCode';
    } else if (e.type == DioExceptionType.unknown) {
      if (e.error.toString().contains('SocketException')) {
        return 'No se pudo conectar al servidor';
      }
    }
    return 'Error de red';
  }
}

class ApiException implements Exception {
  final String message;
  final int? statusCode;

  ApiException(this.message, {this.statusCode});

  @override
  String toString() => message;
}
