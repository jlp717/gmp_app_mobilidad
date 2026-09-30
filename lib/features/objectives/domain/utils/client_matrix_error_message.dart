import 'package:gmp_app_mobilidad/core/api/api_client.dart';

/// Returns a safe, actionable message for a failed client-matrix request.
///
/// Backend details remain available in diagnostic logs, but SQL, bind values,
/// and transport internals are never rendered to the user.
String _failureType(ApiException error) {
  final code = (error.code ?? '').trim();
  final status = error.statusCode;
  if (code.isNotEmpty && status != null) {
    return '$code (HTTP $status)';
  }
  if (status != null) return 'HTTP $status';
  return 'error sin código';
}

String clientMatrixErrorMessage(Object error) {
  if (error is! ApiException) {
    return 'No se pudo cargar la evolución del cliente. Tipo: error interno de la app.';
  }

  final type = _failureType(error);
  switch (error.statusCode) {
    case 0:
      return 'No hay conexión con el servicio. Comprueba la red e inténtalo de nuevo. Tipo: $type.';
    case 401:
      return 'La sesión ha caducado. Inicia sesión de nuevo para continuar. Tipo: $type.';
    case 403:
      return 'Tu usuario no tiene acceso a la evolución de este cliente. Tipo: $type.';
    case 404:
      return 'No se encontró la evolución de este cliente. Tipo: $type.';
    case 408:
    case 429:
      return 'La consulta está tardando más de lo esperado. Inténtalo de nuevo. Tipo: $type.';
    case 503:
      return 'La base de datos no está disponible ahora. Inténtalo de nuevo. Tipo: $type.';
    default:
      if (error.statusCode != null && error.statusCode! >= 500) {
        return 'El servicio no pudo cargar la evolución ahora. Inténtalo de nuevo. Tipo: $type.';
      }
      return 'No se pudo cargar la evolución del cliente. Inténtalo de nuevo. Tipo: $type.';
  }
}
