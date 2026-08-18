---
name: flutter-dio
description: HTTP con Dio: interceptores, modelos, error handling.
---

# Skill: flutter-dio — HTTP Client con Dio 5

Guía completa para integración HTTP en gmp_app_mobilidad: Dio con interceptors, modelos Freezed y manejo de errores.

## Configuración Base de Dio

```dart
import 'package:dio/dio.dart';

class ApiClient {
  static const String _baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:5000/api/v1', // Android emulator → localhost
  );

  late final Dio _dio;

  ApiClient({required TokenStorage tokenStorage}) {
    _dio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
    ));

    _dio.interceptors.addAll([
      AuthInterceptor(tokenStorage: tokenStorage, dio: _dio),
      LogInterceptor(
        requestHeader: false,
        requestBody: false,  // no logear bodies (pueden tener passwords)
        responseBody: false,
        error: true,
      ),
    ]);
  }

  Dio get client => _dio;
}
```

## Auth Interceptor con Token Refresh

```dart
class AuthInterceptor extends Interceptor {
  final TokenStorage _tokenStorage;
  final Dio _dio;
  bool _isRefreshing = false;

  AuthInterceptor({required TokenStorage tokenStorage, required Dio dio})
      : _tokenStorage = tokenStorage, _dio = dio;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final token = await _tokenStorage.getAccessToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401 && !_isRefreshing) {
      _isRefreshing = true;
      try {
        final newToken = await _refreshAccessToken();
        if (newToken != null) {
          final opts = err.requestOptions;
          opts.headers['Authorization'] = 'Bearer $newToken';
          final response = await _dio.fetch(opts);
          _isRefreshing = false;
          return handler.resolve(response);
        }
      } catch (_) {
        _isRefreshing = false;
        await _tokenStorage.clear(); // logout
      }
    }
    handler.next(err);
  }
}
```

## Modelos con Freezed

```dart
// pubspec.yaml deps: freezed_annotation, json_annotation
// dev_deps: freezed, json_serializable, build_runner

import 'package:freezed_annotation/freezed_annotation.dart';
part 'pedido.freezed.dart';
part 'pedido.g.dart';

@freezed
class Pedido with _$Pedido {
  const factory Pedido({
    required String id,
    required String clienteId,
    required String estado,
    @Default([]) List<LineaPedido> lineas,
    required DateTime fechaCreacion,
  }) = _Pedido;

  factory Pedido.fromJson(Map<String, dynamic> json) => _$PedidoFromJson(json);
}
```

Tras modificar modelos: **siempre ejecutar**:
```bash
dart run build_runner build --delete-conflicting-outputs
```

## Manejo de Errores DioException → Dominio

```dart
class ApiException implements Exception {
  final String message;
  final int? statusCode;
  const ApiException(this.message, {this.statusCode});
}

class NetworkException extends ApiException {
  const NetworkException() : super('Sin conexión a internet');
}

// En el repository:
Future<List<Pedido>> getPedidos() async {
  try {
    final response = await _dio.get('/pedidos');
    return (response.data['data'] as List)
        .map((json) => Pedido.fromJson(json as Map<String, dynamic>))
        .toList();
  } on DioException catch (e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
        throw const NetworkException();
      case DioExceptionType.badResponse:
        throw ApiException(
          e.response?.data['error']?['message'] ?? 'Error del servidor',
          statusCode: e.response?.statusCode,
        );
      default:
        throw ApiException('Error inesperado: ${e.message}');
    }
  }
}
```

## Checklist de Integración
- [ ] Base URL desde env variables, no hardcodeada
- [ ] Timeouts configurados (connect/receive/send)
- [ ] AuthInterceptor con refresh token automático
- [ ] LogInterceptor sin bodies en producción
- [ ] Modelos con Freezed + json_serializable
- [ ] DioException mapeado a excepciones de dominio
- [ ] Repository pattern: widgets nunca llaman Dio directamente
- [ ] Tests con mock de Dio o mock del repository

## Anti-patrones
- `http.get(url)` en widget directamente → usar Repository
- Hardcodear `'http://192.168.1.X:5000'` → usar env variable
- Ignorar DioException con `catch (e) {}` → mapear siempre
- No liberar interceptors en `dispose` → memory leak
